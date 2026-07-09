import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import LegendOverlay from "@/components/LegendOverlay";
import { sampleSvgPath, type Pt } from "@/lib/svgSample";
import {
  generateRiverData,
  generateCompositeRiverData,
  getCompositeRiver,
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
const SAMPLES = 96; // resampled points per segment → smooth colored ribbon

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
  const centerRow = Math.floor(RIVER_ROWS / 2);

  // Column-range mean concentration at along-fraction f of a segment.
  const valueAt = useCallback((seg: Segment, f: number): number => {
    const col = Math.round(seg.colStart + f * (seg.colEnd - seg.colStart));
    let sum = 0, n = 0;
    for (let r = seg.rowStart; r <= seg.rowEnd; r++) { sum += data[r]?.[col] ?? 0; n++; }
    return n ? sum / n : 0;
  }, [data]);

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
    if (!Number.isFinite(minX)) return { scale: 1, ox: 0, oy: 0, minX: 0, minY: 0 };
    const bboxW = Math.max(1, maxX - minX), bboxH = Math.max(1, maxY - minY);
    const pad = 60;
    const scale = Math.min((size.w - pad * 2) / bboxW, (size.h - pad * 2) / bboxH);
    // Centre the fitted river in the content area.
    const ox = (size.w - bboxW * scale) / 2 - minX * scale;
    const oy = (size.h - bboxH * scale) / 2 - minY * scale;
    return { scale, ox, oy, minX, minY };
  }, [segments, size]);

  const toContent = useCallback((p: Pt): [number, number] => [p.x * fit.scale + fit.ox, p.y * fit.scale + fit.oy], [fit]);

  // Fitted, colored polyline segments (recompute on week/variable/fit).
  const drawn = useMemo(() => segments.map(seg => {
    const cpts = seg.pts.map(toContent);
    const lines: { x1: number; y1: number; x2: number; y2: number; color: string }[] = [];
    for (let i = 0; i < cpts.length - 1; i++) {
      const f = (i + 0.5) / (cpts.length - 1);
      lines.push({ x1: cpts[i][0], y1: cpts[i][1], x2: cpts[i + 1][0], y2: cpts[i + 1][1], color: lerpColor(stops, valueAt(seg, f)) });
    }
    return { cpts, lines, seg };
  }), [segments, toContent, stops, valueAt]);

  // Mouth = downstream end of the reach nearest the bay (largest segment's last pt).
  const mouth = useMemo(() => {
    let best: [number, number] | null = null;
    for (const d of drawn) { const last = d.cpts[d.cpts.length - 1]; if (last) best = last; }
    // pick the reach whose last point is nearest the bay
    let bestDist = Infinity;
    for (const d of drawn) {
      const p = d.seg.pts[d.seg.pts.length - 1];
      const [lon, lat] = svgLonLat(p.x, p.y);
      const dist = Math.hypot((lon - BAY_CENTER[0]) * Math.cos((lat * Math.PI) / 180), lat - BAY_CENTER[1]);
      if (dist < bestDist) { bestDist = dist; best = d.cpts[d.cpts.length - 1]; }
    }
    return best;
  }, [drawn]);

  // River stroke width in CONTENT px (a touch wider toward the mouth).
  const strokeW = Math.max(5, Math.min(14, 9 * (fit.scale / 2.2)));

  // ── Zoom / pan ─────────────────────────────────────────────────────────────
  const [xform, setXform] = useState<Transform>(DEFAULT_TRANSFORM);
  const xformRef = useRef(xform); xformRef.current = xform;
  const draggingRef = useRef(false);
  const dragOriginRef = useRef({ x: 0, y: 0 });
  const downRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const onDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    draggingRef.current = true;
    dragOriginRef.current = { x: e.clientX - xformRef.current.tx, y: e.clientY - xformRef.current.ty };
    downRef.current = { x: e.clientX, y: e.clientY, moved: false };
    e.preventDefault();
  }, []);
  const onMove = useCallback((e: React.MouseEvent) => {
    if (!draggingRef.current) return;
    if (downRef.current && Math.hypot(e.clientX - downRef.current.x, e.clientY - downRef.current.y) > 4) downRef.current.moved = true;
    setXform(prev => ({ ...prev, tx: e.clientX - dragOriginRef.current.x, ty: e.clientY - dragOriginRef.current.y }));
  }, []);
  const onUp = useCallback((e: React.MouseEvent) => {
    draggingRef.current = false;
    // A click (no meaningful drag) selects the nearest reach point.
    if (downRef.current && !downRef.current.moved && contentRef.current) {
      const rect = contentRef.current.getBoundingClientRect();
      const { tx, ty, scale } = xformRef.current;
      const cx = (e.clientX - rect.left - tx) / scale; // content-space click
      const cy = (e.clientY - rect.top - ty) / scale;
      let best: { row: number; col: number } | null = null, bestD = Infinity;
      for (const d of drawn) {
        for (let i = 0; i < d.cpts.length; i++) {
          const dist = Math.hypot(d.cpts[i][0] - cx, d.cpts[i][1] - cy);
          if (dist < bestD) {
            bestD = dist;
            const f = i / (d.cpts.length - 1);
            best = { row: centerRow, col: Math.round(d.seg.colStart + f * (d.seg.colEnd - d.seg.colStart)) };
          }
        }
      }
      if (best && bestD < 26) onCellClick(best.row, best.col);
    }
    downRef.current = null;
  }, [drawn, onCellClick, centerRow]);

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

  // Selected-reach highlight point.
  const selectedPt = useMemo(() => {
    if (!selectedCell) return null;
    for (const d of drawn) {
      if (selectedCell.col < d.seg.colStart || selectedCell.col > d.seg.colEnd) continue;
      const f = (selectedCell.col - d.seg.colStart) / Math.max(1, d.seg.colEnd - d.seg.colStart);
      const i = Math.round(f * (d.cpts.length - 1));
      return d.cpts[i] ?? null;
    }
    return null;
  }, [selectedCell, drawn]);

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
        onMouseLeave={() => { draggingRef.current = false; downRef.current = null; }}
        onDoubleClick={() => setXform(DEFAULT_TRANSFORM)}
      >
        <div style={{ position: "absolute", inset: 0, transform: `translate(${xform.tx}px, ${xform.ty}px) scale(${xform.scale})`, transformOrigin: "0 0" }}>
          <svg width={size.w} height={size.h} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            {/* soft casing under the river so it reads as a channel */}
            {drawn.map((d, si) => (
              <polyline
                key={`case-${si}`}
                points={d.cpts.map(p => `${p[0]},${p[1]}`).join(" ")}
                fill="none" stroke="#ffffff" strokeOpacity={0.9}
                strokeWidth={strokeW + 4} strokeLinecap="round" strokeLinejoin="round"
              />
            ))}
            {/* colored concentration ribbon (smooth, per-segment) */}
            {drawn.map((d, si) => (
              <g key={`riv-${si}`}>
                {d.lines.map((ln, li) => (
                  <line key={li} x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2}
                        stroke={ln.color} strokeWidth={strokeW} strokeLinecap="round" />
                ))}
              </g>
            ))}
            {/* animated downstream flow shimmer */}
            {drawn.map((d, si) => (
              <polyline
                key={`flow-${si}`}
                points={d.cpts.map(p => `${p[0]},${p[1]}`).join(" ")}
                fill="none" stroke="#ffffff" strokeOpacity={0.55}
                strokeWidth={Math.max(1.5, strokeW * 0.16)} strokeLinecap="round"
                strokeDasharray="2 22"
                style={{ animation: "riverFlow 1.1s linear infinite" }}
              />
            ))}
            {/* mouth marker */}
            {mouth && (
              <g>
                <circle cx={mouth[0]} cy={mouth[1]} r={strokeW * 0.7} fill="#0f766e" stroke="#fff" strokeWidth={2} />
              </g>
            )}
            {/* selected reach */}
            {selectedPt && (
              <circle cx={selectedPt[0]} cy={selectedPt[1]} r={strokeW * 0.75}
                      fill="none" stroke="hsl(var(--primary))" strokeWidth={2.5} />
            )}
          </svg>
        </div>
      </div>

      {/* mouth label (screen-space, follows the marker) */}
      {mouth && (
        <div className="absolute z-10 pointer-events-none text-[10px] font-mono font-semibold text-teal-700 bg-white/85 px-1.5 py-0.5 rounded shadow-sm"
             style={{ left: mouth[0] * xform.scale + xform.tx + 10, top: mouth[1] * xform.scale + xform.ty - 8 }}>
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
        real river course · scroll to zoom · drag to pan · dbl-click to reset · click a reach
      </div>
    </div>
  );
}
