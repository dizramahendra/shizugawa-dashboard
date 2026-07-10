import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import LegendOverlay from "@/components/LegendOverlay";
import { sampleSvgPath, type Pt } from "@/lib/svgSample";
import {
  generateRiverData,
  generateCompositeRiverData,
  getCompositeRiver,
  valueToConcentration,
  VARIABLE_OPTIONS,
  RIVER_ROWS,
  RIVER_COLS,
  RIVER_SVG_BY_SLUG,
  RIVER_SVG_W,
  RIVER_SVG_H,
} from "@/lib/simulatedData";

// ── Colour ramp (SMOOTH — continuously interpolated, matches the 3D/map) ──────
const COLOR_STOPS: Record<string, string[]> = {
  nitrogen:   ["#2c5f8a","#3d6fa0","#6a9fc0","#90c4de","#c5dfe8","#f5f0d8","#f0d090","#e8a030","#d45820","#c8401c"],
  phosphorus: ["#2c5f8a","#3d6fa0","#6a9fc0","#90c4de","#c5dfe8","#f5f0d8","#f0d090","#e8a030","#d45820","#c8401c"],
  flow:       ["#0f0527","#1f0a4e","#3a0f7a","#5a1eb0","#7c3ad8","#9d61e8","#bb8ef2","#d4b6f7","#e9d7fb","#f7f0fe"],
  all:        ["#45007e","#2060a0","#168c8c","#35b870","#aadb30","#fce820"],
};

const _rgbCache = new Map<string, [number, number, number]>();
function hexToRgb(hex: string): [number, number, number] {
  let c = _rgbCache.get(hex);
  if (!c) {
    c = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    _rgbCache.set(hex, c);
  }
  return c;
}
/** Continuous blend across the ramp → smooth gradient (no hard bands). */
function lerpColor(stops: string[], t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const a = hexToRgb(stops[i]);
  if (i >= stops.length - 1) return `rgb(${a[0]},${a[1]},${a[2]})`;
  const b = hexToRgb(stops[i + 1]);
  const f = x - i;
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

// ── SVG-space → lon/lat georeference (same transform the bay/rivers use) ──────
// Used only to (a) size the scale bar in real km and (b) find the mouth end
// (the endpoint nearest the bay). svgY=0 is NORTH (lat max), so north is "up".
function svgLonLat(x: number, y: number): [number, number] {
  return [141.36568 + (x / RIVER_SVG_W) * 0.16158, 38.59295 + (1 - y / RIVER_SVG_H) * 0.15515];
}
const KM_PER_SVGX = (0.16158 / RIVER_SVG_W) * 111320 * Math.cos((38.63 * Math.PI) / 180);
const BAY_CENTER: [number, number] = [141.45, 38.63]; // approx, for mouth detection

// ── Along-stream sampling of the river's real path ────────────────────────────
const SAMPLES = 110; // resampled centreline points per reach

interface Segment {
  pts: Pt[];              // resampled path points (SVG space), oriented upstream→mouth
  colStart: number; colEnd: number;
  rowStart: number; rowEnd: number;
}

/** Resample a dense point list to n evenly-indexed points. */
function resample(dense: Pt[], n: number): Pt[] {
  if (dense.length <= n) return dense;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) out.push(dense[Math.round((i / (n - 1)) * (dense.length - 1))]);
  return out;
}

/** Build the render segments for a river (one for a plain river, one per
 *  sub-basin reach for a composite corridor), each oriented so pts[0] is the
 *  upstream (headwater) end and pts[last] is the downstream (mouth) end. */
function buildSegments(riverId: string): Segment[] {
  const composite = getCompositeRiver(riverId);
  const raw: { slug: string; colStart: number; colEnd: number; rowStart: number; rowEnd: number }[] =
    composite
      ? composite.segments.map(s => ({
          slug: s.riverId, colStart: s.colStart, colEnd: s.colEnd,
          rowStart: s.rowStart ?? 0, rowEnd: s.rowEnd ?? RIVER_ROWS - 1,
        }))
      : [{ slug: riverId, colStart: 0, colEnd: RIVER_COLS - 1, rowStart: 0, rowEnd: RIVER_ROWS - 1 }];

  const out: Segment[] = [];
  for (const r of raw) {
    const d = RIVER_SVG_BY_SLUG[r.slug];
    if (!d) continue;
    let pts = resample(sampleSvgPath(d, 1), SAMPLES);
    if (pts.length < 2) continue;
    // Orient upstream→mouth: the endpoint nearer the bay is the mouth (last).
    const distToBay = (p: Pt) => {
      const [lon, lat] = svgLonLat(p.x, p.y);
      return Math.hypot((lon - BAY_CENTER[0]) * Math.cos((lat * Math.PI) / 180), lat - BAY_CENTER[1]);
    };
    if (distToBay(pts[0]) < distToBay(pts[pts.length - 1])) pts = pts.slice().reverse();
    out.push({ pts, colStart: r.colStart, colEnd: r.colEnd, rowStart: r.rowStart, rowEnd: r.rowEnd });
  }
  return out;
}

// ── Pixel rasterisation of the channel ────────────────────────────────────────
// The channel is rendered as PIXELS (like the model's voxel grid), not a line:
// a grid of CELL_PX cells over the fitted view, where a cell belongs to the
// channel when it lies within the river's half-width of the real centreline.
// Along-stream position maps to the data COLUMN (upstream col 0 → mouth col 119)
// and the SIGNED cross-stream offset maps to the data ROW — so the 2D shows the
// full cross-stream structure of the reach data, cell by cell, along the true
// course. Width is schematic (real widths are sub-pixel at map scale): it swells
// from the headwater toward the mouth, with organic bank jitter.
const CELL_PX = 6;            // pixel size in content space (chunky, readable)
const HALF_W_HEAD  = 14;      // channel half-width at the headwater (px)
const HALF_W_MOUTH = 36;      // channel half-width at the mouth (px)

interface ChannelCell {
  x: number; y: number;       // content-space top-left of the cell
  row: number; col: number;   // data indices (cross-stream, along-stream)
}

interface Transform { tx: number; ty: number; scale: number }
const DEFAULT_TRANSFORM: Transform = { tx: 0, ty: 0, scale: 1 };

interface RiverGrid2DProps {
  week: number;
  variableId: string;
  riverId: string;
  selectedCell: { row: number; col: number } | null;
  onCellClick: (row: number, col: number) => void;
}

export default function RiverGrid2D({
  week, variableId, riverId, selectedCell, onCellClick,
}: RiverGrid2DProps) {
  const composite = useMemo(() => getCompositeRiver(riverId), [riverId]);
  const data = useMemo(
    () => composite ? generateCompositeRiverData(week, riverId) : generateRiverData(week, riverId),
    [week, riverId, composite],
  );
  const segments = useMemo(() => buildSegments(riverId), [riverId]);
  const stops    = COLOR_STOPS[variableId] ?? COLOR_STOPS.nitrogen;
  const variable = VARIABLE_OPTIONS.find(v => v.id === variableId) ?? VARIABLE_OPTIONS[0];

  // ── Content sizing + fit the river's SVG bbox into it ──────────────────────
  const contentRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 840, h: 420 });
  useEffect(() => {
    if (!contentRef.current) return;
    const obs = new ResizeObserver(e => setSize({ w: e[0].contentRect.width, h: e[0].contentRect.height }));
    obs.observe(contentRef.current);
    return () => obs.disconnect();
  }, []);

  const fit = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const s of segments) for (const p of s.pts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX)) return { scale: 1, ox: 0, oy: 0 };
    const bboxW = Math.max(1, maxX - minX), bboxH = Math.max(1, maxY - minY);
    const pad = 48 + HALF_W_MOUTH; // keep the widened mouth inside the view
    const scale = Math.min((size.w - pad * 2) / bboxW, (size.h - pad * 2) / bboxH);
    const ox = (size.w - bboxW * scale) / 2 - minX * scale;
    const oy = (size.h - bboxH * scale) / 2 - minY * scale;
    return { scale, ox, oy };
  }, [segments, size]);

  // ── Channel geometry (content space) — independent of week/colours ─────────
  const geom = useMemo(() => {
    // Content-space centrelines with along-fraction per vertex.
    const chains = segments.map(seg => ({
      seg,
      cpts: seg.pts.map(p => [p.x * fit.scale + fit.ox, p.y * fit.scale + fit.oy] as [number, number]),
    }));

    // Flatten into line segments for nearest-point queries.
    interface SegLine { ax: number; ay: number; bx: number; by: number; t0: number; t1: number; ci: number }
    const segLines: SegLine[] = [];
    chains.forEach((ch, ci) => {
      const n = ch.cpts.length;
      for (let i = 0; i < n - 1; i++) {
        segLines.push({
          ax: ch.cpts[i][0], ay: ch.cpts[i][1], bx: ch.cpts[i + 1][0], by: ch.cpts[i + 1][1],
          t0: i / (n - 1), t1: (i + 1) / (n - 1), ci,
        });
      }
    });

    // Rasterise: every CELL_PX cell whose centre is within halfW(t) of a
    // centreline belongs to the channel.
    const halfW = (t: number) => HALF_W_HEAD + (HALF_W_MOUTH - HALF_W_HEAD) * Math.pow(t, 0.85);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const ch of chains) for (const p of ch.cpts) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    const cells: ChannelCell[] = [];
    if (!Number.isFinite(minX)) return { cells, chains };
    const x0 = Math.floor((minX - HALF_W_MOUTH - CELL_PX) / CELL_PX) * CELL_PX;
    const x1 = Math.ceil((maxX + HALF_W_MOUTH + CELL_PX) / CELL_PX) * CELL_PX;
    const y0 = Math.floor((minY - HALF_W_MOUTH - CELL_PX) / CELL_PX) * CELL_PX;
    const y1 = Math.ceil((maxY + HALF_W_MOUTH + CELL_PX) / CELL_PX) * CELL_PX;

    for (let gy = y0; gy <= y1; gy += CELL_PX) {
      for (let gx = x0; gx <= x1; gx += CELL_PX) {
        const px = gx + CELL_PX / 2, py = gy + CELL_PX / 2;
        // Nearest centreline point across all reaches.
        let bestD2 = Infinity, bestT = 0, bestCi = 0, bestSign = 1;
        for (const L of segLines) {
          const dx = L.bx - L.ax, dy = L.by - L.ay;
          const len2 = dx * dx + dy * dy || 1;
          let u = ((px - L.ax) * dx + (py - L.ay) * dy) / len2;
          u = Math.max(0, Math.min(1, u));
          const qx = L.ax + dx * u, qy = L.ay + dy * u;
          const d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy);
          if (d2 < bestD2) {
            bestD2 = d2;
            bestT = L.t0 + (L.t1 - L.t0) * u;
            bestCi = L.ci;
            bestSign = (dx * (py - L.ay) - dy * (px - L.ax)) >= 0 ? 1 : -1;
          }
        }
        const dist = Math.sqrt(bestD2);
        // Organic bank jitter — deterministic per cell, ~±12% of the width.
        const jitter = (Math.sin(gx * 0.113 + gy * 0.071) + Math.sin(gx * 0.041 - gy * 0.097)) * 0.06;
        const hw = halfW(bestT) * (1 + jitter);
        if (dist > hw) continue;

        const seg = chains[bestCi].seg;
        const col = Math.round(seg.colStart + bestT * (seg.colEnd - seg.colStart));
        // Signed cross-stream offset → data row within this reach's row band.
        const frac = (bestSign * dist / hw) * 0.5 + 0.5; // 0..1 across the channel
        const row = Math.max(seg.rowStart, Math.min(seg.rowEnd,
          seg.rowStart + Math.round(frac * (seg.rowEnd - seg.rowStart))));
        cells.push({ x: gx, y: gy, row, col });
      }
    }
    return { cells, chains };
  }, [segments, fit]);

  // Mouth marker: downstream end of the reach nearest the bay.
  const mouth = useMemo(() => {
    let best: [number, number] | null = null, bestDist = Infinity;
    for (const ch of geom.chains) {
      const p = ch.seg.pts[ch.seg.pts.length - 1];
      const [lon, lat] = svgLonLat(p.x, p.y);
      const dist = Math.hypot((lon - BAY_CENTER[0]) * Math.cos((lat * Math.PI) / 180), lat - BAY_CENTER[1]);
      if (dist < bestDist) { bestDist = dist; best = ch.cpts[ch.cpts.length - 1]; }
    }
    return best;
  }, [geom]);

  // ── Zoom / pan ─────────────────────────────────────────────────────────────
  const [xform, setXform] = useState<Transform>(DEFAULT_TRANSFORM);
  const xformRef = useRef(xform); xformRef.current = xform;
  const draggingRef = useRef(false);
  const dragOriginRef = useRef({ x: 0, y: 0 });

  const onDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    draggingRef.current = true;
    dragOriginRef.current = { x: e.clientX - xformRef.current.tx, y: e.clientY - xformRef.current.ty };
    e.preventDefault();
  }, []);
  const onMove = useCallback((e: React.MouseEvent) => {
    if (!draggingRef.current) return;
    setXform(prev => ({ ...prev, tx: e.clientX - dragOriginRef.current.x, ty: e.clientY - dragOriginRef.current.y }));
  }, []);
  const onUp = useCallback(() => { draggingRef.current = false; }, []);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const { tx, ty, scale } = xformRef.current;
      const ns = Math.max(0.4, Math.min(16, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const ratio = ns / scale;
      setXform({ scale: ns, tx: mx - (mx - tx) * ratio, ty: my - (my - ty) * ratio });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Scale bar (real km) for the current zoom.
  const kmPerScreenPx = KM_PER_SVGX / (fit.scale * xform.scale);
  const targetPx = 90;
  const niceKm = [0.5, 1, 2, 3, 5, 10].find(k => k / kmPerScreenPx >= targetPx) ?? 10;
  const scaleBarPx = niceKm / kmPerScreenPx;

  return (
    <div
      className="w-full h-full relative select-none overflow-hidden"
      style={{
        background: "#eef4f6",
        backgroundImage: "radial-gradient(circle, rgba(148,163,184,0.22) 1.5px, transparent 1.5px)",
        backgroundSize: "24px 24px",
      }}
    >
      <style>{`@keyframes riverFlow { to { stroke-dashoffset: -24; } }`}</style>

      <div
        ref={contentRef}
        className="absolute inset-0 overflow-hidden"
        style={{ cursor: draggingRef.current ? "grabbing" : "grab" }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onDoubleClick={() => setXform(DEFAULT_TRANSFORM)}
      >
        <div style={{ position: "absolute", inset: 0, transform: `translate(${xform.tx}px, ${xform.ty}px) scale(${xform.scale})`, transformOrigin: "0 0" }}>
          {/* ── Pixel channel body — one cell per (row, col) sample ─────────── */}
          {geom.cells.map((c, i) => {
            const isSelected = selectedCell?.row === c.row && selectedCell?.col === c.col;
            const val  = data[c.row]?.[c.col] ?? 0;
            const conc = valueToConcentration(val, variableId);
            return (
              <div
                key={i}
                onClick={e => { e.stopPropagation(); onCellClick(c.row, c.col); }}
                className="absolute group cursor-crosshair"
                style={{
                  left: c.x, top: c.y,
                  width: CELL_PX, height: CELL_PX,
                  backgroundColor: lerpColor(stops, val),
                  outline: isSelected ? "2px solid hsl(var(--primary))" : "none",
                  outlineOffset: "-1px",
                  zIndex: isSelected ? 10 : 1,
                }}
              >
                <div
                  className="absolute px-1.5 py-0.5 bg-foreground/85 text-white text-[9px] font-mono rounded whitespace-nowrap
                             opacity-0 group-hover:opacity-100 pointer-events-none z-30 transition-opacity"
                  style={{
                    bottom: "100%", left: "100%",
                    transform: `scale(${1 / xform.scale})`,
                    transformOrigin: "bottom left",
                  }}
                >
                  {conc} {variable.unit} · reach {c.col}
                </div>
              </div>
            );
          })}

          {/* ── Flow shimmer + mouth marker (SVG overlay, non-interactive) ──── */}
          <svg width={size.w} height={size.h} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none", zIndex: 20 }}>
            {geom.chains.map((ch, si) => (
              <polyline
                key={`flow-${si}`}
                points={ch.cpts.map(p => `${p[0]},${p[1]}`).join(" ")}
                fill="none" stroke="#ffffff" strokeOpacity={0.5}
                strokeWidth={1.6} strokeLinecap="round"
                strokeDasharray="2 22"
                style={{ animation: "riverFlow 1.1s linear infinite" }}
              />
            ))}
            {mouth && <circle cx={mouth[0]} cy={mouth[1]} r={7} fill="#0f766e" stroke="#fff" strokeWidth={2} />}
          </svg>
        </div>
      </div>

      {/* mouth label (screen-space, follows the marker) */}
      {mouth && (
        <div className="absolute z-10 pointer-events-none text-[10px] font-mono font-semibold text-teal-700 bg-white/85 px-1.5 py-0.5 rounded shadow-sm"
             style={{ left: mouth[0] * xform.scale + xform.tx + 12, top: mouth[1] * xform.scale + xform.ty - 8 }}>
          → to bay
        </div>
      )}

      {/* scale bar — bottom-centre, clear of the legend (left) and compass (right) */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center pointer-events-none">
        <span className="text-[9px] font-mono text-slate-500 mb-0.5">{niceKm} km</span>
        <div className="h-1.5 bg-slate-600 rounded-sm" style={{ width: scaleBarPx }} />
      </div>

      {/* legend */}
      <div className="absolute z-10 pointer-events-none" style={{ bottom: 12, left: 12 }}>
        <LegendOverlay stops={stops} min={variable.min} max={variable.max} unit={variable.unit} decimals={variable.decimals ?? 1} />
      </div>

      {/* hint */}
      <div className="absolute top-3 right-3 z-10 text-[9px] font-mono text-slate-400 pointer-events-none bg-white/80 px-2 py-1 rounded">
        real river course · scroll to zoom · drag to pan · dbl-click to reset · click a cell
      </div>
    </div>
  );
}
