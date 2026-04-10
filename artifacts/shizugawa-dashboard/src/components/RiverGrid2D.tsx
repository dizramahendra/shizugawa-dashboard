import { useMemo } from "react";
import {
  generateRiverData,
  valueToConcentration,
  VARIABLE_OPTIONS,
} from "@/lib/simulatedData";

// ── Grid dimensions ──────────────────────────────────────────
const COLS = 36;   // along-stream (left = upstream, right = downstream)
const ROWS = 12;   // cross-stream (total canvas height)

// ── River channel mask ────────────────────────────────────────
// For each column, define the center row (0-indexed, float).
// This traces a meandering course from upstream to downstream.
function riverCenter(col: number): number {
  // Two overlapping sine waves for a natural meander
  return (
    5.5 +
    2.4 * Math.sin(col * 0.28 + 0.6) +
    0.9 * Math.sin(col * 0.6 + 1.8)
  );
}

// Channel half-width at each column (varies 0.9–1.8 cells)
function channelHalfWidth(col: number): number {
  return 1.1 + 0.7 * Math.abs(Math.sin(col * 0.35 + 0.4));
}

// Pre-compute mask once
const RIVER_MASK: boolean[][] = Array.from({ length: ROWS }, (_, row) =>
  Array.from({ length: COLS }, (_, col) => {
    const center = riverCenter(col);
    const hw = channelHalfWidth(col);
    return Math.abs(row - center) <= hw;
  })
);

// ── Colour interpolation ──────────────────────────────────────
const COLOR_STOPS: Record<string, string[]> = {
  nitrogen:   ["#3b6fa0", "#6ca0c8", "#b8dce8", "#f0e68c", "#e8a030", "#c8401c"],
  phosphorus: ["#3b6fa0", "#6ca0c8", "#b8dce8", "#f0e68c", "#e8a030", "#c8401c"],
  chlorophyll:["#1a4a2e", "#2d7a4a", "#5aab6e", "#a8d898", "#e8f4b0", "#f5f5dc"],
  do:         ["#c8401c", "#e8a030", "#f0e68c", "#b8dce8", "#6ca0c8", "#3b6fa0"],
};

function interpolateColor(stops: string[], t: number): string {
  const n = stops.length - 1;
  const idx = Math.min(n - 1, Math.floor(t * n));
  const frac = t * n - idx;
  const hex = (s: string, o: number) => parseInt(s.slice(o, o + 2), 16);
  const [r1, g1, b1] = [hex(stops[idx], 1), hex(stops[idx], 3), hex(stops[idx], 5)];
  const [r2, g2, b2] = [hex(stops[idx + 1], 1), hex(stops[idx + 1], 3), hex(stops[idx + 1], 5)];
  return `rgb(${Math.round(r1 + (r2 - r1) * frac)},${Math.round(g1 + (g2 - g1) * frac)},${Math.round(b1 + (b2 - b1) * frac)})`;
}

// ── km tick labels ────────────────────────────────────────────
const KM_TICKS = [0, 6, 12, 18, 24, 30, 36].map((col) => ({
  col,
  label: `${Math.round((col / COLS) * 18)} km`,
}));

// ── Props ─────────────────────────────────────────────────────
interface RiverGrid2DProps {
  week: number;
  variableId: string;
  riverId: string;
  selectedCell: { row: number; col: number } | null;
  onCellClick: (row: number, col: number) => void;
}

const CELL = 24; // px per cell
const GAP  = 0;  // no gap — flush tiles like SWAT HRU output

export default function RiverGrid2D({
  week,
  variableId,
  riverId,
  selectedCell,
  onCellClick,
}: RiverGrid2DProps) {
  // Use the full data grid but only render cells inside the mask
  const data = useMemo(() => generateRiverData(week, riverId), [week, riverId]);
  const stops = COLOR_STOPS[variableId] ?? COLOR_STOPS.nitrogen;
  const variable = VARIABLE_OPTIONS.find((v) => v.id === variableId) ?? VARIABLE_OPTIONS[0];

  const gridW = COLS * CELL + (COLS - 1) * GAP;
  const gridH = ROWS * CELL + (ROWS - 1) * GAP;

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-[#eaf2f5] relative select-none overflow-hidden">

      {/* Background grid texture */}
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage: "linear-gradient(#94a3b8 1px, transparent 1px), linear-gradient(90deg, #94a3b8 1px, transparent 1px)",
        backgroundSize: "40px 40px",
      }} />

      {/* Badge */}
      <div className="absolute top-4 left-4 bg-white rounded-md shadow-sm border border-border px-3 py-2 z-10">
        <div className="text-xs font-semibold text-foreground">River Playback (2D)</div>
        <div className="text-[10px] font-mono text-muted-foreground">Raster channel · upstream → downstream</div>
      </div>

      {/* Main grid + axes wrapper */}
      <div className="flex flex-col items-start">

        {/* Row: y-axis label + grid */}
        <div className="flex items-start">

          {/* Y-axis */}
          <div
            className="flex flex-col justify-between pr-2 text-right flex-shrink-0"
            style={{ height: gridH, width: 54, paddingTop: 0 }}
          >
            {["N bank", "", "", "", "thalweg", "", "", "", "", "", "", "S bank"].map((lbl, i) => (
              <div
                key={i}
                className="flex items-center justify-end"
                style={{ height: CELL }}
              >
                <span className="text-[8px] font-mono text-muted-foreground leading-none">{lbl}</span>
              </div>
            ))}
          </div>

          {/* Grid */}
          <div
            className="relative flex-shrink-0"
            style={{ width: gridW, height: gridH }}
          >
            {Array.from({ length: ROWS }).map((_, row) =>
              Array.from({ length: COLS }).map((_, col) => {
                const inRiver = RIVER_MASK[row][col];
                const isSelected = selectedCell?.row === row && selectedCell?.col === col;

                // Map data: use col as the x-dimension, row as z-dimension,
                // but clamp to the smaller generateRiverData dimensions
                const dataCol = Math.min(col, (data[0]?.length ?? 1) - 1);
                const dataRow = Math.min(row, data.length - 1);
                const val = data[dataRow]?.[dataCol] ?? 0;
                const bg = inRiver ? interpolateColor(stops, val) : undefined;
                const conc = inRiver ? valueToConcentration(val, variableId) : null;

                return (
                  <div
                    key={`${row}-${col}`}
                    onClick={() => inRiver && onCellClick(row, col)}
                    className={`absolute group ${inRiver ? "cursor-pointer" : "cursor-default"}`}
                    style={{
                      left: col * (CELL + GAP),
                      top: row * (CELL + GAP),
                      width: CELL,
                      height: CELL,
                      backgroundColor: inRiver ? bg : "#dde5ec",
                      opacity: inRiver ? 1 : 0.45,
                      zIndex: isSelected ? 10 : 1,
                      boxShadow: isSelected
                        ? "inset 0 0 0 2px hsl(var(--primary)), 0 0 0 2px hsl(var(--primary) / 35%)"
                        : "none",
                    }}
                  >
                    {/* Tooltip for active cells */}
                    {inRiver && (
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
        <div className="flex items-start mt-1.5" style={{ paddingLeft: 54 }}>
          <div className="relative" style={{ width: gridW }}>
            {KM_TICKS.map(({ col, label }) => (
              <span
                key={col}
                className="absolute text-[9px] font-mono text-muted-foreground -translate-x-1/2"
                style={{ left: col * (CELL + GAP) + CELL / 2 }}
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Direction label */}
        <div className="mt-5 text-[9px] font-mono text-muted-foreground/70 text-center" style={{ paddingLeft: 54, width: gridW + 54 }}>
          ← upstream · downstream →
        </div>
      </div>

      {/* Color bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white border border-border rounded-md px-3 py-2 shadow-sm flex items-center gap-3 whitespace-nowrap">
        <span className="text-[10px] text-muted-foreground">{variable.label} ({variable.unit})</span>
        <div className="h-3 w-32 rounded-sm border border-border/30" style={{
          background: `linear-gradient(to right, ${stops.join(", ")})`
        }} />
        <div className="flex justify-between gap-6 text-[9px] font-mono text-muted-foreground">
          <span>Low</span><span>High</span>
        </div>
      </div>
    </div>
  );
}
