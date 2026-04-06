interface ColorLegendProps {
  variableId: string;
  variableLabel: string;
  unit: string;
}

const SCALES: Record<string, { stops: string[]; low: string; high: string }> = {
  nitrogen: {
    stops: ["#3b6fa0", "#6ca0c8", "#b8dce8", "#f0e68c", "#e8a030", "#c8401c"],
    low: "0.2 mg/L",
    high: "3.0 mg/L",
  },
  phosphorus: {
    stops: ["#3b6fa0", "#6ca0c8", "#b8dce8", "#f0e68c", "#e8a030", "#c8401c"],
    low: "10 μg/L",
    high: "130 μg/L",
  },
  chlorophyll: {
    stops: ["#1a4a2e", "#2d7a4a", "#5aab6e", "#a8d898", "#e8f4b0", "#f5f5dc"],
    low: "0.5 μg/L",
    high: "18.5 μg/L",
  },
  oxygen: {
    stops: ["#c8401c", "#e8a030", "#f0e68c", "#b8dce8", "#6ca0c8", "#3b6fa0"],
    low: "4.0 mg/L",
    high: "10.0 mg/L",
  },
};

const DEPTH_LABELS = ["0–5m", "5–15m", "15–30m", "30–50m", ">50m"];

export default function ColorLegend({ variableId, variableLabel, unit }: ColorLegendProps) {
  const scale = SCALES[variableId] ?? SCALES.nitrogen;
  const gradient = `linear-gradient(to right, ${scale.stops.join(", ")})`;

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium text-foreground">{variableLabel}</div>
        <div className="text-xs text-muted-foreground">{unit}</div>
      </div>

      {/* Color ramp */}
      <div className="space-y-1.5">
        <div className="h-3.5 rounded border border-border/50" style={{ background: gradient }} />
        <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
          <span>{scale.low}</span>
          <span>{scale.high}</span>
        </div>
        <div className="flex justify-between text-[8px] text-muted-foreground/60 uppercase tracking-wide">
          <span>Low</span>
          <span>High</span>
        </div>
      </div>

      {/* Depth key */}
      <div className="space-y-1.5 pt-2 border-t border-border/40">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Depth</div>
        <div className="space-y-1">
          {DEPTH_LABELS.map((d, i) => (
            <div key={d} className="flex items-center gap-2">
              <div
                className="h-2 w-6 rounded-sm border border-border/40 flex-shrink-0 bg-primary/60"
                style={{ opacity: 1 - i * 0.16 }}
              />
              <span className="text-[10px] font-mono text-muted-foreground">{d}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
