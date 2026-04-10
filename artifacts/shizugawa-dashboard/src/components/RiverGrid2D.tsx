import { useMemo } from "react";
import {
  generateRiverData,
  valueToConcentration,
  VARIABLE_OPTIONS,
  RIVER_ROWS,
  RIVER_COLS,
} from "@/lib/simulatedData";

// ── Per-river Bezier arch channel mask ───────────────────────
// Row fractions: 0 = N bank (top), 1 = S bank (bottom)
// Three control points: [startFrac, peakFrac, endFrac]
const ARCH_PARAMS: Record<string, [number, number, number]> = {
  shizugawa: [0.80, 0.13, 0.56],
  kitakami:  [0.52, 0.80, 0.16],
  hachiman:  [0.20, 0.50, 0.82],
};

function buildMask(riverId: string): boolean[][] {
  const [s, p, e] = ARCH_PARAMS[riverId] ?? ARCH_PARAMS.shizugawa;
  return Array.from({ length: RIVER_ROWS }, (_, row) =>
    Array.from({ length: RIVER_COLS }, (_, col) => {
      const t = col / (RIVER_COLS - 1);
      const frac = (1 - t) * (1 - t) * s + 2 * t * (1 - t) * p + t * t * e;
      const center = frac * (RIVER_ROWS - 1);
      const halfW = 1.7 + Math.sin(t * Math.PI) * 1.3;
      return Math.abs(row - center) <= halfW;
    })
  );
}

const MASKS: Record<string, boolean[][]> = {
  shizugawa: buildMask("shizugawa"),
  kitakami:  buildMask("kitakami"),
  hachiman:  buildMask("hachiman"),
};

// ── Color interpolation ───────────────────────────────────────
const COLOR_STOPS: Record<string, string[]> = {
  nitrogen:    ["#3b6fa0", "#6ca0c8", "#b8dce8", "#f0e68c", "#e8a030", "#c8401c"],
  phosphorus:  ["#3b6fa0", "#6ca0c8", "#b8dce8", "#f0e68c", "#e8a030", "#c8401c"],
  chlorophyll: ["#1a4a2e", "#2d7a4a", "#5aab6e", "#a8d898", "#e8f4b0", "#f5f5dc"],
  do:          ["#c8401c", "#e8a030", "#f0e68c", "#b8dce8", "#6ca0c8", "#3b6fa0"],
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

// ── km tick positions ─────────────────────────────────────────
const KM_TICKS = [0, 6, 12, 18, 24, 30, 36].map(col => ({
  col,
  label: `${Math.round((col / RIVER_COLS) * 18)} km`,
}));

// ── Layout constants ──────────────────────────────────────────
const CELL = 20;   // px per cell
const GAP  = 3;    // gap between cells — creates the "separated pixel" look

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
        backgroundImage: "radial-gradient(circle, rgba(148,163,184,0.35) 1px, transparent 1px)",
        backgroundSize: `${CELL + GAP}px ${CELL + GAP}px`,
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
            className="relative flex-shrink-0 rounded-sm overflow-visible"
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
                      left:  col * (CELL + GAP),
                      top:   row * (CELL + GAP),
                      width: CELL,
                      height: CELL,
                      borderRadius: 3,
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
          className="h-3 w-32 rounded-sm border border-border/30"
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
