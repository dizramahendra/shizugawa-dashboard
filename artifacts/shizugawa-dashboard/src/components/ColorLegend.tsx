interface ColorLegendProps {
  variableId: string;
  variableLabel: string;
  unit: string;
}

const SCALES: Record<string, { stops: string[]; low: string; high: string }> = {
  nitrogen: {
    stops: ["#3b6fa0", "#6ca0c8", "#b8dce8", "#f0e68c", "#e8a030", "#c8401c"],
    low: "0.2",
    high: "3.0",
  },
  phosphorus: {
    stops: ["#3b6fa0", "#6ca0c8", "#b8dce8", "#f0e68c", "#e8a030", "#c8401c"],
    low: "10",
    high: "130",
  },
  chlorophyll: {
    stops: ["#1a4a2e", "#2d7a4a", "#5aab6e", "#a8d898", "#e8f4b0", "#f5f5dc"],
    low: "0.5",
    high: "18.5",
  },
  oxygen: {
    stops: ["#c8401c", "#e8a030", "#f0e68c", "#b8dce8", "#6ca0c8", "#3b6fa0"],
    low: "4.0",
    high: "10.0",
  },
};

export default function ColorLegend({ variableId, variableLabel, unit }: ColorLegendProps) {
  const scale = SCALES[variableId] || SCALES.nitrogen;
  const gradient = `linear-gradient(to right, ${scale.stops.join(", ")})`;

  return (
    <div className="space-y-2">
      <div className="panel-header">Variable</div>
      <div className="text-sm font-medium text-foreground">{variableLabel}</div>

      <div className="mt-3 space-y-1.5">
        <div className="h-3 rounded-sm border border-border/40" style={{ background: gradient }} />
        <div className="flex justify-between">
          <span className="data-label">{scale.low} {unit}</span>
          <span className="data-label">{scale.high} {unit}</span>
        </div>
        <div className="flex justify-between">
          <span className="data-label text-[9px]">LOW</span>
          <span className="data-label text-[9px]">HIGH</span>
        </div>
      </div>

      <div className="pt-2 space-y-1 border-t border-border/30">
        <div className="panel-header text-[9px]">Depth Key</div>
        <div className="space-y-0.5">
          {["0–5m", "5–15m", "15–30m", "30–50m", ">50m"].map((d, i) => (
            <div key={d} className="flex items-center gap-2">
              <div
                className="h-2 w-5 rounded-sm border border-border/30 flex-shrink-0"
                style={{ opacity: 1 - i * 0.15 }}
              />
              <span className="data-label">{d}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
