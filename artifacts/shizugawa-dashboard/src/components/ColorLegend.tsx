interface ColorLegendProps {
  variableId: string;
  variableLabel: string;
  unit: string;
}

const SCALES: Record<string, { stops: string[]; low: string; high: string }> = {
  nitrogen: {
    stops: ["#2c5f8a","#3d6fa0","#6a9fc0","#90c4de","#c5dfe8","#f5f0d8","#f0d090","#e8a030","#d45820","#c8401c"],
    low: "0.2 mg/L",
    high: "3.0 mg/L",
  },
  phosphorus: {
    stops: ["#1a6b4a","#2d8a5e","#4da876","#7ec89a","#b8e0c0","#f0ebb8","#f0d080","#e8a030","#d45820","#c8401c"],
    low: "0.010 mg/L",
    high: "0.130 mg/L",
  },
  flow: {
    stops: ["#0f0527","#1f0a4e","#3a0f7a","#5a1eb0","#7c3ad8","#9d61e8","#bb8ef2","#d4b6f7","#e9d7fb","#f7f0fe"],
    low: "0 cm/s",
    high: "80 cm/s",
  },
  all: {
    stops: ["#45007e", "#2060a0", "#168c8c", "#35b870", "#aadb30", "#fce820"],
    low: "0.00",
    high: "1.00",
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
