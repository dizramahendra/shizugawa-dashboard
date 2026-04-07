import { useMemo } from "react";
import {
  generateRiverData,
  RIVER_COLS,
  RIVER_ROWS,
  valueToConcentration,
  VARIABLE_OPTIONS,
} from "@/lib/simulatedData";

interface RiverGrid2DProps {
  week: number;
  variableId: string;
  riverId: string;
  selectedCell: { row: number; col: number } | null;
  onCellClick: (row: number, col: number) => void;
}

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
  const r1 = hex(stops[idx], 1), g1 = hex(stops[idx], 3), b1 = hex(stops[idx], 5);
  const r2 = hex(stops[idx + 1], 1), g2 = hex(stops[idx + 1], 3), b2 = hex(stops[idx + 1], 5);
  const r = Math.round(r1 + (r2 - r1) * frac);
  const g = Math.round(g1 + (g2 - g1) * frac);
  const b = Math.round(b1 + (b2 - b1) * frac);
  return `rgb(${r},${g},${b})`;
}

const DEPTH_LABELS_SHORT = ["≥0m", "1m", "2m", "3m", "4m", "5m+"];
const KM_LABELS = ["0 km", "3 km", "6 km", "9 km", "12 km", "15 km", "18 km"];

export default function RiverGrid2D({
  week,
  variableId,
  riverId,
  selectedCell,
  onCellClick,
}: RiverGrid2DProps) {
  const data = useMemo(() => generateRiverData(week, riverId), [week, riverId]);
  const stops = COLOR_STOPS[variableId] ?? COLOR_STOPS.nitrogen;
  const variable = VARIABLE_OPTIONS.find((v) => v.id === variableId) ?? VARIABLE_OPTIONS[0];

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-[#eaf2f5] relative select-none overflow-hidden">

      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage:
            "linear-gradient(#94a3b8 1px, transparent 1px), linear-gradient(90deg, #94a3b8 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* Faint terrain wash */}
      <div className="absolute inset-0" style={{
        background: "radial-gradient(ellipse at 50% 50%, rgba(140,195,215,0.18) 0%, transparent 70%)"
      }} />

      {/* River label */}
      <div className="absolute top-4 left-4 bg-white rounded-md shadow-sm border border-border px-3 py-2 z-10">
        <div className="text-xs font-semibold text-foreground">2D River Playback</div>
        <div className="text-[10px] font-mono text-muted-foreground">Horizontal cross-section view</div>
      </div>

      {/* Main grid area */}
      <div className="relative flex flex-col" style={{ gap: 0 }}>

        {/* Y-axis label */}
        <div className="flex items-center">
          <div className="flex flex-col justify-around h-full mr-2 text-right"
            style={{ width: 44, height: RIVER_ROWS * 44 }}>
            {Array.from({ length: RIVER_ROWS }).map((_, row) => (
              <div key={row} className="text-[9px] font-mono text-muted-foreground flex items-center justify-end" style={{ height: 44 }}>
                {DEPTH_LABELS_SHORT[row]}
              </div>
            ))}
          </div>

          {/* Grid cells */}
          <div
            className="grid relative"
            style={{
              gridTemplateColumns: `repeat(${RIVER_COLS}, 44px)`,
              gridTemplateRows: `repeat(${RIVER_ROWS}, 44px)`,
              gap: 2,
            }}
          >
            {Array.from({ length: RIVER_ROWS }).map((_, row) =>
              Array.from({ length: RIVER_COLS }).map((_, col) => {
                const val = data[row]?.[col] ?? 0;
                const bg = interpolateColor(stops, val);
                const isSelected = selectedCell?.row === row && selectedCell?.col === col;
                const conc = valueToConcentration(val, variableId);

                return (
                  <div
                    key={`${row}-${col}`}
                    onClick={() => onCellClick(row, col)}
                    className="relative cursor-pointer group"
                    style={{
                      width: 44,
                      height: 44,
                      backgroundColor: bg,
                      border: isSelected
                        ? "2px solid hsl(var(--primary))"
                        : "1px solid rgba(255,255,255,0.18)",
                      boxSizing: "border-box",
                      outline: isSelected ? "2px solid hsl(var(--primary) / 40%)" : "none",
                      outlineOffset: 1,
                    }}
                    title={`Row ${row + 1}, Col ${col + 1}: ${conc} ${variable.unit}`}
                  >
                    {/* Hover tooltip */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5
                                    bg-foreground/90 text-white text-[9px] font-mono rounded whitespace-nowrap
                                    opacity-0 group-hover:opacity-100 pointer-events-none z-20 transition-opacity">
                      {conc} {variable.unit}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Right: cross-stream arrow */}
          <div className="ml-3 flex flex-col items-center justify-center" style={{ height: RIVER_ROWS * 44 }}>
            <div className="text-[9px] font-mono text-muted-foreground writing-mode-vertical text-center" style={{ writingMode: "vertical-rl" }}>
              cross-stream
            </div>
          </div>
        </div>

        {/* X-axis km labels */}
        <div className="flex items-center mt-1" style={{ paddingLeft: 46 }}>
          <div className="flex justify-between" style={{ width: RIVER_COLS * 44 + (RIVER_COLS - 1) * 2 }}>
            {KM_LABELS.map((l) => (
              <span key={l} className="text-[9px] font-mono text-muted-foreground">{l}</span>
            ))}
          </div>
        </div>

        {/* X-axis label */}
        <div className="text-[9px] font-mono text-muted-foreground text-center mt-1" style={{ paddingLeft: 46 }}>
          ← upstream · downstream →
        </div>
      </div>

      {/* Mini color bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white border border-border rounded-md px-3 py-2 shadow-sm flex items-center gap-3">
        <span className="text-[10px] text-muted-foreground">{variable.label} ({variable.unit})</span>
        <div className="h-3 w-32 rounded-sm" style={{
          background: `linear-gradient(to right, ${stops.join(", ")})`
        }} />
        <div className="flex gap-4 text-[9px] font-mono text-muted-foreground">
          <span>Low</span>
          <span>High</span>
        </div>
      </div>
    </div>
  );
}
