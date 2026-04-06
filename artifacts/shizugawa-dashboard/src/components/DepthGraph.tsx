import { useMemo } from "react";
import { generateWeekData, valueToConcentration, DEPTH_LAYERS } from "@/lib/simulatedData";

interface DepthGraphProps {
  week: number;
  variableId: string;
  variableLabel: string;
  unit: string;
  selectedPoint: { x: number; z: number; depth: number } | null;
  sliceLevel?: number;
}

const DEPTH_LABELS = ["0–5m", "5–15m", "15–30m", "30–50m", "50–75m", "75–100m", "100–125m", "125–150m"];

export default function DepthGraph({ week, variableId, variableLabel, unit, selectedPoint, sliceLevel }: DepthGraphProps) {
  const data = useMemo(() => generateWeekData(week), [week]);

  const profile = useMemo(() => {
    if (!selectedPoint && sliceLevel === undefined) return null;

    const x = selectedPoint?.x ?? 0;
    const z = selectedPoint?.z ?? 0;

    return Array.from({ length: DEPTH_LAYERS }, (_, d) => {
      const rawVal = data[z]?.[x]?.[d] ?? 0;
      return {
        depth: d,
        label: DEPTH_LABELS[d],
        value: valueToConcentration(rawVal, variableId),
        raw: rawVal,
      };
    });
  }, [data, selectedPoint, sliceLevel, variableId]);

  if (!profile) {
    return (
      <div className="text-center py-6 text-muted-foreground text-xs">
        Select a cell to view depth profile
      </div>
    );
  }

  const maxVal = Math.max(...profile.map((p) => p.value));
  const minVal = Math.min(...profile.map((p) => p.value));
  const range = maxVal - minVal || 1;

  return (
    <div className="space-y-3">
      <div>
        <div className="panel-section-title">Depth Profile</div>
        {selectedPoint && (
          <div className="data-label text-[9px] mt-0.5">
            Cell ({selectedPoint.x}, {selectedPoint.z}) · {variableLabel}
          </div>
        )}
      </div>

      {/* Horizontal bar chart */}
      <div className="space-y-1">
        {profile.map((p) => {
          const barWidth = ((p.value - minVal) / range) * 100;
          const isSelected = selectedPoint?.depth === p.depth;
          return (
            <div key={p.depth} className="flex items-center gap-2">
              <div className="data-label text-[9px] w-14 text-right flex-shrink-0">{p.label}</div>
              <div className="flex-1 relative h-4">
                <div className="absolute inset-0 bg-muted/40 rounded-sm" />
                <div
                  className={`absolute left-0 top-0 h-full rounded-sm transition-all ${
                    isSelected ? "bg-primary" : "bg-primary/50"
                  }`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
              <div className={`data-label text-[9px] w-12 flex-shrink-0 ${isSelected ? "text-primary font-medium" : ""}`}>
                {p.value} {unit}
              </div>
            </div>
          );
        })}
      </div>

      {/* Axis labels */}
      <div className="flex justify-between pt-1 border-t border-border/30">
        <span className="data-label text-[8px]">{minVal.toFixed(2)} {unit}</span>
        <span className="data-label text-[8px]">{maxVal.toFixed(2)} {unit}</span>
      </div>
    </div>
  );
}
