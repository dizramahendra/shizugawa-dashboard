import { useMemo, useRef, useEffect, useState } from "react";
import {
  generateRiverData,
  valueToConcentration,
  VARIABLE_OPTIONS,
  RIVER_ROWS,
  RIVER_COLS,
} from "@/lib/simulatedData";

// ── Color interpolation ───────────────────────────────────────
const COLOR_STOPS: Record<string, string[]> = {
  nitrogen:    ["#3b6fa0", "#6ca0c8", "#b8dce8", "#f0e68c", "#e8a030", "#c8401c"],
  phosphorus:  ["#3b6fa0", "#6ca0c8", "#b8dce8", "#f0e68c", "#e8a030", "#c8401c"],
  chlorophyll: ["#1a4a2e", "#2d7a4a", "#5aab6e", "#a8d898", "#e8f4b0", "#f5f5dc"],
  do:          ["#c8401c", "#e8a030", "#f0e68c", "#b8dce8", "#6ca0c8", "#3b6fa0"],
  all:         ["#45007e", "#2060a0", "#168c8c", "#35b870", "#aadb30", "#fce820"],
};

function interpolateColor(stops: string[], t: number): string {
  const n = stops.length - 1;
  const idx = Math.min(n - 1, Math.floor(t * n));
  const frac = t * n - idx;
  const hex = (s: string, o: number) => parseInt(s.slice(o, o + 2), 16);
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * frac);
  const r = lerp(hex(stops[idx], 1), hex(stops[idx + 1], 1));
  const g = lerp(hex(stops[idx], 3), hex(stops[idx + 1], 3));
  const b = lerp(hex(stops[idx], 5), hex(stops[idx + 1], 5));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ── Organic mask generation ───────────────────────────────────
type CP = [number, number];

function cosineInterp(pts: CP[], t: number): number {
  if (t <= pts[0][0]) return pts[0][1];
  if (t >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [t0, v0] = pts[i];
    const [t1, v1] = pts[i + 1];
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0);
      const cf = (1 - Math.cos(f * Math.PI)) / 2;
      return v0 + (v1 - v0) * cf;
    }
  }
  return pts[pts.length - 1][1];
}

const RIVER_PROFILES: Record<string, { center: CP[]; halfW: CP[] }> = {
  shizugawa: {
    center: [
      [0.00, 19.0], [0.05, 18.5], [0.10, 17.0], [0.17, 14.5],
      [0.25, 11.0], [0.32,  7.5], [0.40,  4.5], [0.46,  3.0],
      [0.52,  3.8], [0.58,  6.0], [0.64,  9.0], [0.70, 13.0],
      [0.75, 16.5], [0.80, 18.0], [0.85, 17.5], [0.90, 14.5],
      [0.94, 11.0], [0.97,  8.5], [1.00,  7.0],
    ],
    halfW: [
      [0.00, 0.8], [0.05, 1.5], [0.12, 3.5], [0.20, 5.5],
      [0.28, 4.0], [0.36, 2.5], [0.44, 1.5], [0.50, 1.2],
      [0.56, 2.5], [0.63, 6.0], [0.69, 8.0], [0.74, 7.5],
      [0.79, 4.5], [0.84, 2.5], [0.88, 2.0], [0.92, 4.0],
      [0.96, 5.5], [1.00, 4.0],
    ],
  },
  kitakami: {
    center: [
      [0.00,  3.5], [0.06,  3.0], [0.13,  4.5], [0.20,  7.5],
      [0.28, 11.0], [0.35, 14.5], [0.42, 17.5], [0.49, 19.5],
      [0.55, 19.0], [0.61, 17.0], [0.67, 13.5], [0.73,  9.5],
      [0.80,  5.5], [0.86,  3.0], [0.92,  2.5], [0.96,  3.5],
      [1.00,  5.0],
    ],
    halfW: [
      [0.00, 1.5], [0.07, 3.5], [0.15, 2.0], [0.24, 4.5],
      [0.32, 3.0], [0.40, 2.0], [0.47, 5.5], [0.53, 7.0],
      [0.58, 5.5], [0.65, 3.0], [0.72, 2.0], [0.79, 4.5],
      [0.85, 3.0], [0.90, 1.5], [0.95, 3.0], [1.00, 4.5],
    ],
  },
  hachiman: {
    center: [
      [0.00,  6.0], [0.07,  5.0], [0.14,  6.0], [0.22,  8.5],
      [0.30, 12.0], [0.37, 16.0], [0.43, 19.0], [0.50, 20.5],
      [0.56, 20.0], [0.62, 18.5], [0.68, 15.5], [0.75, 11.5],
      [0.82,  7.5], [0.88,  4.5], [0.93,  3.0], [0.97,  3.5],
      [1.00,  5.0],
    ],
    halfW: [
      [0.00, 2.0], [0.08, 4.5], [0.17, 3.5], [0.26, 6.0],
      [0.33, 4.5], [0.40, 2.5], [0.47, 1.0], [0.52, 1.5],
      [0.58, 2.5], [0.65, 4.5], [0.72, 3.0], [0.79, 6.5],
      [0.85, 4.0], [0.90, 2.5], [0.95, 3.5], [1.00, 4.5],
    ],
  },
};

function edgeJitter(col: number, side: "top" | "bot"): number {
  const seed = col * 7 + (side === "top" ? 3 : 11);
  return Math.sin(seed * 2.399) * 0.8 + Math.sin(seed * 5.17) * 0.4;
}

function buildMask(riverId: string): boolean[][] {
  const profile = RIVER_PROFILES[riverId] ?? RIVER_PROFILES.shizugawa;
  return Array.from({ length: RIVER_ROWS }, (_, row) =>
    Array.from({ length: RIVER_COLS }, (_, col) => {
      const t      = col / (RIVER_COLS - 1);
      const center = cosineInterp(profile.center, t);
      const halfW  = cosineInterp(profile.halfW,  t);
      const topEdge = center - halfW + edgeJitter(col, "top");
      const botEdge = center + halfW + edgeJitter(col, "bot");
      return row >= topEdge && row <= botEdge;
    })
  );
}

const MASKS: Record<string, boolean[][]> = {
  shizugawa: buildMask("shizugawa"),
  kitakami:  buildMask("kitakami"),
  hachiman:  buildMask("hachiman"),
};

// ── Coordinate axis config ────────────────────────────────────
const EAST_KM  = 18;   // total distance eastward (along-stream)
const NORTH_KM = 10;   // total distance northward (cross-stream)
const X_TICKS  = [0, 3, 6, 9, 12, 15, 18];  // km marks on X
const Y_TICKS  = [0, 2, 4, 6, 8, 10];       // km marks on Y

// ── Layout constants ──────────────────────────────────────────
const CELL      = 7;   // px per cell
const GAP       = 0;
const Y_AXIS_W  = 62;  // px reserved for left Y-axis strip
const X_AXIS_H  = 40;  // px reserved for bottom X-axis strip

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

  const gridW = RIVER_COLS * (CELL + GAP);
  const gridH = RIVER_ROWS * (CELL + GAP);

  // Measure the content area so we can align axis ticks to the grid
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

  // Grid top-left offset within the content area (centered)
  const gridOffsetX = (contentSize.w - gridW) / 2;
  const gridOffsetY = (contentSize.h - gridH) / 2;

  // Map a km value → pixel position within the content area
  // X: 0 km = grid left, EAST_KM = grid right
  const xKmToPx = (km: number) => gridOffsetX + (km / EAST_KM) * gridW;
  // Y: 0 km = grid bottom (S bank), NORTH_KM = grid top (N bank)
  const yKmToPx = (km: number) => gridOffsetY + (1 - km / NORTH_KM) * gridH;

  return (
    <div
      className="w-full h-full relative select-none overflow-hidden"
      style={{
        background: "#eaf2f5",
        backgroundImage: "radial-gradient(circle, rgba(148,163,184,0.30) 1.5px, transparent 1.5px)",
        backgroundSize: "23px 23px",
      }}
    >
      {/* ── Y axis strip — left edge ──────────────────────────── */}
      <div
        className="absolute left-0 top-0 flex flex-col items-end pointer-events-none"
        style={{ width: Y_AXIS_W, bottom: X_AXIS_H }}
      >
        {/* Rotated axis label */}
        <div
          className="absolute text-[9px] font-mono text-slate-400 tracking-wide whitespace-nowrap"
          style={{
            transform: "rotate(-90deg)",
            transformOrigin: "center center",
            left: -28,
            top: "50%",
          }}
        >
          Distance Northward (km)
        </div>

        {/* Tick marks — positioned relative to content area */}
        {Y_TICKS.map(km => {
          const py = yKmToPx(km);
          if (py < 0 || py > contentSize.h) return null;
          return (
            <div
              key={km}
              className="absolute right-0 flex items-center gap-1"
              style={{ top: py, transform: "translateY(-50%)" }}
            >
              <span className="text-[9px] font-mono text-slate-500 leading-none">{km}</span>
              <div className="w-2 h-px bg-slate-300" />
            </div>
          );
        })}
      </div>

      {/* ── Main content area — holds the grid, centered ─────── */}
      <div
        ref={contentRef}
        className="absolute overflow-visible"
        style={{
          left: Y_AXIS_W,
          top: 0,
          right: 0,
          bottom: X_AXIS_H,
        }}
      >
        {/* Grid container, centered */}
        <div
          className="absolute"
          style={{
            left: gridOffsetX,
            top:  gridOffsetY,
            width: gridW,
            height: gridH,
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
                  onClick={() => inCh && onCellClick(row, col)}
                  className={`absolute group ${inCh ? "cursor-crosshair" : "cursor-default"}`}
                  style={{
                    left:            col * (CELL + GAP),
                    top:             row * (CELL + GAP),
                    width:           CELL,
                    height:          CELL,
                    borderRadius:    0,
                    backgroundColor: color,
                    outline: isSelected ? "2px solid hsl(var(--primary))" : "none",
                    outlineOffset: "-1px",
                    zIndex: isSelected ? 10 : 1,
                  }}
                >
                  {inCh && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5
                                    bg-foreground/85 text-white text-[9px] font-mono rounded whitespace-nowrap
                                    opacity-0 group-hover:opacity-100 pointer-events-none z-20 transition-opacity">
                      {conc} {variable.unit}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── X axis strip — bottom edge ────────────────────────── */}
      <div
        className="absolute bottom-0 right-0 pointer-events-none"
        style={{ left: Y_AXIS_W, height: X_AXIS_H }}
      >
        {/* Tick marks */}
        {X_TICKS.map(km => {
          const px = xKmToPx(km);
          if (px < 0 || px > contentSize.w) return null;
          return (
            <div
              key={km}
              className="absolute top-0 flex flex-col items-center gap-0.5"
              style={{ left: px, transform: "translateX(-50%)" }}
            >
              <div className="w-px h-2 bg-slate-300" />
              <span className="text-[9px] font-mono text-slate-500 leading-none">{km}</span>
            </div>
          );
        })}

        {/* Axis label */}
        <div
          className="absolute bottom-1 text-[9px] font-mono text-slate-400 tracking-wide whitespace-nowrap"
          style={{ left: "50%", transform: "translateX(-50%)" }}
        >
          Distance Eastward (km)
        </div>
      </div>

      {/* ── Axis border lines ─────────────────────────────────── */}
      {/* Left axis line */}
      <div
        className="absolute bg-slate-300 pointer-events-none"
        style={{ left: Y_AXIS_W, top: 0, bottom: X_AXIS_H, width: 1 }}
      />
      {/* Bottom axis line */}
      <div
        className="absolute bg-slate-300 pointer-events-none"
        style={{ left: Y_AXIS_W, bottom: X_AXIS_H, right: 0, height: 1 }}
      />

      {/* ── Color scale legend ────────────────────────────────── */}
      <div
        className="absolute bg-white/90 border border-border rounded-md px-3 py-2 shadow-sm flex items-center gap-3 whitespace-nowrap pointer-events-none"
        style={{ bottom: X_AXIS_H + 12, left: Y_AXIS_W + 12 }}
      >
        <span className="text-[10px] text-muted-foreground">{variable.label} ({variable.unit})</span>
        <div
          className="h-3 w-32 border border-border/30"
          style={{ background: `linear-gradient(to right, ${stops.join(", ")})` }}
        />
        <div className="flex justify-between text-[9px] font-mono text-muted-foreground" style={{ width: "8rem" }}>
          <span>{variable.min} {variable.unit}</span>
          <span>{variable.max} {variable.unit}</span>
        </div>
      </div>

      {/* ── Badge ─────────────────────────────────────────────── */}
      <div
        className="absolute top-3 bg-white/90 backdrop-blur-sm rounded-md shadow-sm border border-border px-3 py-2 z-10 pointer-events-none"
        style={{ left: Y_AXIS_W + 12 }}
      >
        <div className="text-xs font-semibold text-foreground">River Playback (2D)</div>
        <div className="text-[10px] font-mono text-muted-foreground">Raster channel · upstream → downstream</div>
      </div>
    </div>
  );
}
