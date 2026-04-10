import { useMemo } from "react";
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
// Cosine-blend between control points for smooth-but-varied curves
type CP = [number, number]; // [t, value]

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

// Per-river control points: rows 0=N bank, RIVER_ROWS-1=S bank
// center: row index of thalweg (0..RIVER_ROWS-1)
// halfW:  half-width in row units — goes from near-trickle to wide delta
const RIVER_PROFILES: Record<string, { center: CP[]; halfW: CP[] }> = {
  shizugawa: {
    // Double-meander snake: S-bank start → sweeps N → belly south → rises N again
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
    // Full S-curve: starts at N, plunges deep south, rises sharply back to N
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
    // Hairpin: starts mid-N, wide approach, tight hairpin at S, wide exit
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

// Deterministic jitter to roughen the bank edges — ±1.2 row variation
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

// ── km tick positions ─────────────────────────────────────────
// RIVER_COLS=120, total length=18 km → every 20 cols = 3 km
const KM_TICKS = [0, 20, 40, 60, 80, 100, 120].map(col => ({
  col: Math.min(col, RIVER_COLS),
  label: `${Math.round((Math.min(col, RIVER_COLS) / RIVER_COLS) * 18)} km`,
}));

// ── Layout constants ──────────────────────────────────────────
const CELL = 7;   // px per cell — 120 cols × 7px = 840px wide
const GAP  = 0;   // no gap

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
  const data  = useMemo(() => generateRiverData(week, riverId), [week, riverId]);
  const mask  = MASKS[riverId] ?? MASKS.shizugawa;
  const stops = COLOR_STOPS[variableId] ?? COLOR_STOPS.nitrogen;
  const variable = VARIABLE_OPTIONS.find(v => v.id === variableId) ?? VARIABLE_OPTIONS[0];

  const gridW = RIVER_COLS * CELL + (RIVER_COLS - 1) * GAP;
  const gridH = RIVER_ROWS * CELL + (RIVER_ROWS - 1) * GAP;

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center relative select-none overflow-hidden"
      style={{
        background: "#eaf2f5",
        backgroundImage: "radial-gradient(circle, rgba(148,163,184,0.30) 1.5px, transparent 1.5px)",
        backgroundSize: "23px 23px",
      }}
    >
      {/* Badge */}
      <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm rounded-md shadow-sm border border-border px-3 py-2 z-10 pointer-events-none">
        <div className="text-xs font-semibold text-foreground">River Playback (2D)</div>
        <div className="text-[10px] font-mono text-muted-foreground">Raster channel · upstream → downstream</div>
      </div>

      {/* Grid + axes */}
      <div className="flex flex-col items-start">

        {/* Y-axis + grid */}
        <div className="flex items-start">

          {/* Y-axis labels — aligned to grid rows */}
          <div
            className="flex flex-col justify-between text-right pr-2 flex-shrink-0"
            style={{ height: gridH, width: 54 }}
          >
            <span className="text-[9px] font-mono text-muted-foreground leading-none" style={{ marginTop: CELL / 2 - 5 }}>N bank</span>
            <span className="text-[9px] font-mono text-muted-foreground leading-none">thalweg</span>
            <span className="text-[9px] font-mono text-muted-foreground leading-none" style={{ marginBottom: CELL / 2 - 5 }}>S bank</span>
          </div>

          {/* Pixel grid */}
          <div
            className="relative flex-shrink-0 overflow-visible"
            style={{ width: gridW, height: gridH }}
          >
            {Array.from({ length: RIVER_ROWS }, (_, row) =>
              Array.from({ length: RIVER_COLS }, (_, col) => {
                const inCh = mask[row][col];
                const isSelected = selectedCell?.row === row && selectedCell?.col === col;
                const val = data[row]?.[col] ?? 0;
                const color = inCh ? interpolateColor(stops, Math.max(0, Math.min(1, val))) : "transparent";
                const conc = inCh ? valueToConcentration(val, variableId) : null;

                return (
                  <div
                    key={`${row}-${col}`}
                    onClick={() => inCh && onCellClick(row, col)}
                    className={`absolute group ${inCh ? "cursor-crosshair" : "cursor-default"}`}
                    style={{
                      left:   col * (CELL + GAP),
                      top:    row * (CELL + GAP),
                      width:  CELL,
                      height: CELL,
                      borderRadius: 0,
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

        {/* X-axis km labels */}
        <div className="flex items-start mt-2" style={{ paddingLeft: 54 }}>
          <div className="relative" style={{ width: gridW, height: 14 }}>
            {KM_TICKS.map(({ col, label }) => (
              <span
                key={col}
                className="absolute text-[9px] font-mono text-muted-foreground -translate-x-1/2"
                style={{ left: col * (CELL + GAP) + (col < RIVER_COLS ? CELL / 2 : 0) }}
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Direction */}
        <div
          className="mt-5 text-[9px] font-mono text-muted-foreground/60 text-center"
          style={{ paddingLeft: 54, width: gridW + 54 }}
        >
          ← upstream · downstream →
        </div>
      </div>

      {/* Color scale legend */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/90 border border-border rounded-md px-3 py-2 shadow-sm flex items-center gap-3 whitespace-nowrap">
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
    </div>
  );
}
