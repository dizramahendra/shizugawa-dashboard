import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import {
  generateRiverData,
  valueToConcentration,
  VARIABLE_OPTIONS,
  RIVER_ROWS,
  RIVER_COLS,
} from "@/lib/simulatedData";

// ── Color interpolation ───────────────────────────────────────
const COLOR_STOPS: Record<string, string[]> = {
  nitrogen:   ["#2c5f8a","#3d6fa0","#6a9fc0","#90c4de","#c5dfe8","#f5f0d8","#f0d090","#e8a030","#d45820","#c8401c"],
  phosphorus: ["#3b6fa0", "#6ca0c8", "#b8dce8", "#f0e68c", "#e8a030", "#c8401c"],
  flow:       ["#e1f5fe", "#81d4fa", "#26c6da", "#66bb6a", "#ffa726", "#ef6c00"],
  all:         ["#45007e", "#2060a0", "#168c8c", "#35b870", "#aadb30", "#fce820"],
};

function interpolateColor(stops: string[], t: number): string {
  const n = stops.length;
  const idx = Math.min(n - 1, Math.floor(Math.min(1, Math.max(0, t)) * n));
  return stops[idx];
}

// ── Organic mask generation ───────────────────────────────────
type CP = [number, number];

function cosineInterp(pts: CP[], t: number): number {
  if (t <= pts[0][0]) return pts[0][1];
  if (t >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [t0, v0] = pts[i], [t1, v1] = pts[i + 1];
    if (t >= t0 && t <= t1) {
      const cf = (1 - Math.cos(((t - t0) / (t1 - t0)) * Math.PI)) / 2;
      return v0 + (v1 - v0) * cf;
    }
  }
  return pts[pts.length - 1][1];
}

const RIVER_PROFILES: Record<string, { center: CP[]; halfW: CP[] }> = {
  shizugawa: {
    center: [
      [0.00,19.0],[0.05,18.5],[0.10,17.0],[0.17,14.5],[0.25,11.0],[0.32, 7.5],
      [0.40, 4.5],[0.46, 3.0],[0.52, 3.8],[0.58, 6.0],[0.64, 9.0],[0.70,13.0],
      [0.75,16.5],[0.80,18.0],[0.85,17.5],[0.90,14.5],[0.94,11.0],[0.97, 8.5],[1.00, 7.0],
    ],
    halfW: [
      [0.00,0.8],[0.05,1.5],[0.12,3.5],[0.20,5.5],[0.28,4.0],[0.36,2.5],
      [0.44,1.5],[0.50,1.2],[0.56,2.5],[0.63,6.0],[0.69,8.0],[0.74,7.5],
      [0.79,4.5],[0.84,2.5],[0.88,2.0],[0.92,4.0],[0.96,5.5],[1.00,4.0],
    ],
  },
  kitakami: {
    center: [
      [0.00, 3.5],[0.06, 3.0],[0.13, 4.5],[0.20, 7.5],[0.28,11.0],[0.35,14.5],
      [0.42,17.5],[0.49,19.5],[0.55,19.0],[0.61,17.0],[0.67,13.5],[0.73, 9.5],
      [0.80, 5.5],[0.86, 3.0],[0.92, 2.5],[0.96, 3.5],[1.00, 5.0],
    ],
    halfW: [
      [0.00,1.5],[0.07,3.5],[0.15,2.0],[0.24,4.5],[0.32,3.0],[0.40,2.0],
      [0.47,5.5],[0.53,7.0],[0.58,5.5],[0.65,3.0],[0.72,2.0],[0.79,4.5],
      [0.85,3.0],[0.90,1.5],[0.95,3.0],[1.00,4.5],
    ],
  },
  hachiman: {
    center: [
      [0.00, 6.0],[0.07, 5.0],[0.14, 6.0],[0.22, 8.5],[0.30,12.0],[0.37,16.0],
      [0.43,19.0],[0.50,20.5],[0.56,20.0],[0.62,18.5],[0.68,15.5],[0.75,11.5],
      [0.82, 7.5],[0.88, 4.5],[0.93, 3.0],[0.97, 3.5],[1.00, 5.0],
    ],
    halfW: [
      [0.00,2.0],[0.08,4.5],[0.17,3.5],[0.26,6.0],[0.33,4.5],[0.40,2.5],
      [0.47,1.0],[0.52,1.5],[0.58,2.5],[0.65,4.5],[0.72,3.0],[0.79,6.5],
      [0.85,4.0],[0.90,2.5],[0.95,3.5],[1.00,4.5],
    ],
  },
};

function edgeJitter(col: number, side: "top" | "bot"): number {
  const seed = col * 7 + (side === "top" ? 3 : 11);
  return Math.sin(seed * 2.399) * 0.8 + Math.sin(seed * 5.17) * 0.4;
}

function buildMask(riverId: string): boolean[][] {
  const p = RIVER_PROFILES[riverId] ?? RIVER_PROFILES.shizugawa;
  return Array.from({ length: RIVER_ROWS }, (_, row) =>
    Array.from({ length: RIVER_COLS }, (_, col) => {
      const t = col / (RIVER_COLS - 1);
      const center = cosineInterp(p.center, t);
      const halfW  = cosineInterp(p.halfW, t);
      return row >= center - halfW + edgeJitter(col, "top")
          && row <= center + halfW + edgeJitter(col, "bot");
    })
  );
}

const MASKS: Record<string, boolean[][]> = {
  shizugawa: buildMask("shizugawa"),
  kitakami:  buildMask("kitakami"),
  hachiman:  buildMask("hachiman"),
};

// ── Coordinate axis config ────────────────────────────────────
const EAST_KM  = 18;
const NORTH_KM = 10;
const CELL     = 7;
const Y_AXIS_W = 62;
const X_AXIS_H = 42;

// Adaptive tick interval: find smallest interval that gives >= minSpacePx spacing
const TICK_CANDIDATES = [0.5, 1, 2, 3, 5, 10, 15];
function adaptiveTicks(totalKm: number, gridPx: number, scale: number, minSpacePx = 50): number[] {
  const pxPerKm = (gridPx / totalKm) * scale;
  const interval = TICK_CANDIDATES.find(c => c * pxPerKm >= minSpacePx) ?? 15;
  const ticks: number[] = [];
  for (let km = 0; km <= totalKm + 1e-9; km = +(km + interval).toFixed(6)) ticks.push(km);
  return ticks;
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
  const data     = useMemo(() => generateRiverData(week, riverId), [week, riverId]);
  const mask     = MASKS[riverId] ?? MASKS.shizugawa;
  const stops    = COLOR_STOPS[variableId] ?? COLOR_STOPS.nitrogen;
  const variable = VARIABLE_OPTIONS.find(v => v.id === variableId) ?? VARIABLE_OPTIONS[0];

  const gridW = RIVER_COLS * CELL;
  const gridH = RIVER_ROWS * CELL;

  // Measure content area for centering
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentSize, setContentSize] = useState({ w: 840, h: 300 });
  useEffect(() => {
    if (!contentRef.current) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setContentSize({ w: width, h: height });
    });
    obs.observe(contentRef.current);
    return () => obs.disconnect();
  }, []);

  // Grid natural center in content space
  const gridOffsetX = (contentSize.w - gridW) / 2;
  const gridOffsetY = (contentSize.h - gridH) / 2;

  // Zoom / pan state
  const [xform, setXform] = useState<Transform>(DEFAULT_TRANSFORM);
  const xformRef = useRef(xform);
  xformRef.current = xform;

  // Convert km → screen pixel within content area (accounting for current transform)
  // point (cx, cy) in content space → screen: cx * scale + tx, cy * scale + ty
  const xKmToScreen = (km: number) =>
    (gridOffsetX + (km / EAST_KM) * gridW) * xform.scale + xform.tx;
  const yKmToScreen = (km: number) =>
    (gridOffsetY + (1 - km / NORTH_KM) * gridH) * xform.scale + xform.ty;

  // Drag handling
  const draggingRef = useRef(false);
  const dragOriginRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    draggingRef.current = true;
    dragOriginRef.current = { x: e.clientX - xformRef.current.tx, y: e.clientY - xformRef.current.ty };
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!draggingRef.current) return;
    setXform(prev => ({
      ...prev,
      tx: e.clientX - dragOriginRef.current.x,
      ty: e.clientY - dragOriginRef.current.y,
    }));
  }, []);

  const handleMouseUp = useCallback(() => { draggingRef.current = false; }, []);

  // Wheel zoom — must be non-passive to call preventDefault
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx   = e.clientX - rect.left;
      const my   = e.clientY - rect.top;
      const { tx, ty, scale } = xformRef.current;
      const factor   = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newScale = Math.max(0.4, Math.min(16, scale * factor));
      const ratio    = newScale / scale;
      setXform({ scale: newScale, tx: mx - (mx - tx) * ratio, ty: my - (my - ty) * ratio });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []); // intentionally empty — uses xformRef

  // Double-click to reset view
  const handleDblClick = () => setXform(DEFAULT_TRANSFORM);

  // Adaptive ticks
  const xTicks = adaptiveTicks(EAST_KM,  gridW, xform.scale);
  const yTicks = adaptiveTicks(NORTH_KM, gridH, xform.scale);

  return (
    <div
      className="w-full h-full relative select-none overflow-hidden"
      style={{
        background: "#eaf2f5",
        backgroundImage: "radial-gradient(circle, rgba(148,163,184,0.30) 1.5px, transparent 1.5px)",
        backgroundSize: "23px 23px",
      }}
    >
      {/* ── Y axis strip ─── left edge, white background ─────── */}
      <div
        className="absolute left-0 top-0 bg-white border-r border-slate-200 shadow-sm z-20 pointer-events-none flex flex-col"
        style={{ width: Y_AXIS_W, bottom: X_AXIS_H }}
      >
        {/* Rotated label */}
        <div
          className="absolute text-[9px] font-mono text-slate-400 tracking-wide whitespace-nowrap"
          style={{ transform: "rotate(-90deg) translateX(-50%)", transformOrigin: "0 0", top: "50%", left: 10 }}
        >
          Distance Northward (km)
        </div>

        {/* Tick marks */}
        {yTicks.map(km => {
          const py = yKmToScreen(km);
          if (py < 0 || py > contentSize.h) return null;
          return (
            <div
              key={km}
              className="absolute right-0 flex items-center"
              style={{ top: py, transform: "translateY(-50%)" }}
            >
              <span className="text-[9px] font-mono text-slate-600 leading-none pr-1.5">{km}</span>
              <div className="w-2.5 h-px bg-slate-400" />
            </div>
          );
        })}
      </div>

      {/* ── Main content area — zoom/pan target ───────────────── */}
      <div
        ref={contentRef}
        className="absolute overflow-hidden"
        style={{
          left: Y_AXIS_W, top: 0, right: 0, bottom: X_AXIS_H,
          cursor: draggingRef.current ? "grabbing" : "grab",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDblClick}
      >
        {/* Transform wrapper */}
        <div
          style={{
            position: "absolute",
            left: 0, top: 0, right: 0, bottom: 0,
            transform: `translate(${xform.tx}px, ${xform.ty}px) scale(${xform.scale})`,
            transformOrigin: "0 0",
          }}
        >
          {/* Grid at natural center */}
          <div
            style={{
              position: "absolute",
              left: gridOffsetX, top: gridOffsetY,
              width: gridW, height: gridH,
            }}
          >
            {Array.from({ length: RIVER_ROWS }, (_, row) =>
              Array.from({ length: RIVER_COLS }, (_, col) => {
                const inCh = mask[row][col];
                const isSelected = selectedCell?.row === row && selectedCell?.col === col;
                const val   = data[row]?.[col] ?? 0;
                const color = inCh ? interpolateColor(stops, Math.max(0, Math.min(1, val))) : "transparent";
                const conc  = inCh ? valueToConcentration(val, variableId) : null;
                return (
                  <div
                    key={`${row}-${col}`}
                    onClick={e => { if (inCh) { e.stopPropagation(); onCellClick(row, col); } }}
                    className={`absolute group ${inCh ? "cursor-crosshair" : "pointer-events-none"}`}
                    style={{
                      left: col * CELL, top: row * CELL,
                      width: CELL, height: CELL,
                      borderRadius: 0,
                      backgroundColor: color,
                      outline: isSelected ? "2px solid hsl(var(--primary))" : "none",
                      outlineOffset: "-1px",
                      zIndex: isSelected ? 10 : 1,
                    }}
                  >
                    {inCh && (
                      <div
                        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5
                                   bg-foreground/85 text-white text-[9px] font-mono rounded whitespace-nowrap
                                   opacity-0 group-hover:opacity-100 pointer-events-none z-30 transition-opacity"
                        style={{ transform: `translate(-50%, 0) scale(${1 / xform.scale})`, transformOrigin: "bottom center" }}
                      >
                        {conc} {variable.unit}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── X axis strip ─── bottom edge, white background ────── */}
      <div
        className="absolute bottom-0 right-0 bg-white border-t border-slate-200 shadow-sm z-20 pointer-events-none flex items-start"
        style={{ left: Y_AXIS_W, height: X_AXIS_H }}
      >
        {/* Tick marks */}
        {xTicks.map(km => {
          const px = xKmToScreen(km);
          if (px < 0 || px > contentSize.w) return null;
          return (
            <div
              key={km}
              className="absolute top-0 flex flex-col items-center"
              style={{ left: px, transform: "translateX(-50%)" }}
            >
              <div className="w-px h-2.5 bg-slate-400" />
              <span className="text-[9px] font-mono text-slate-600 leading-none mt-0.5">{km}</span>
            </div>
          );
        })}

        {/* Axis label */}
        <div
          className="absolute bottom-1.5 text-[9px] font-mono text-slate-400 tracking-wide whitespace-nowrap"
          style={{ left: "50%", transform: "translateX(-50%)" }}
        >
          Distance Eastward (km)
        </div>
      </div>

      {/* ── Corner square where axes meet ─────────────────────── */}
      <div
        className="absolute bg-white border-r border-t border-slate-200 z-30"
        style={{ left: 0, bottom: 0, width: Y_AXIS_W, height: X_AXIS_H }}
      />

      {/* ── Legend ────────────────────────────────────────────── */}
      <div
        className="absolute bg-white/95 border border-border rounded-md px-3 py-2 shadow-sm flex items-center gap-3 whitespace-nowrap z-10 pointer-events-none"
        style={{ bottom: X_AXIS_H + 12, left: Y_AXIS_W + 12 }}
      >
        <span className="text-[10px] text-muted-foreground">{variable.label} ({variable.unit})</span>
        <div className="flex flex-col gap-0.5">
          <div className="flex rounded-sm overflow-hidden border border-border/30">
            {stops.map((color, i) => {
              const lo = (variable.min + (i / stops.length) * (variable.max - variable.min)).toFixed(1);
              const hi = (variable.min + ((i + 1) / stops.length) * (variable.max - variable.min)).toFixed(1);
              return <div key={i} style={{ backgroundColor: color, width: 20, height: 10 }} title={`${lo}–${hi} ${variable.unit}`} />;
            })}
          </div>
          <div className="flex justify-between text-[9px] font-mono text-muted-foreground" style={{ width: stops.length * 20 }}>
            <span>{variable.min}</span>
            <span>{variable.max} {variable.unit}</span>
          </div>
        </div>
      </div>

      {/* ── Hint ──────────────────────────────────────────────── */}
      <div className="absolute top-3 right-3 z-10 text-[9px] font-mono text-slate-400 pointer-events-none bg-white/80 px-2 py-1 rounded">
        scroll to zoom · drag to pan · dbl-click to reset
      </div>
    </div>
  );
}
