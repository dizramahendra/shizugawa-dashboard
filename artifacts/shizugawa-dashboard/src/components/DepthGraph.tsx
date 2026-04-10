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
const DEPTH_MID_M = [2.5, 10, 22.5, 40, 62.5, 87.5, 112.5, 137.5];
const MAX_DEPTH_M = 150;

const CHART_W = 200;
const CHART_H = 176;
const PAD_LEFT = 46;
const PAD_RIGHT = 12;
const PAD_TOP = 10;
const PAD_BOTTOM = 20;
const INNER_W = CHART_W - PAD_LEFT - PAD_RIGHT;
const INNER_H = CHART_H - PAD_TOP - PAD_BOTTOM;

export default function DepthGraph({ week, variableId, variableLabel, unit, selectedPoint, sliceLevel }: DepthGraphProps) {
  const data = useMemo(() => generateWeekData(week), [week]);

  const profile = useMemo(() => {
    if (!selectedPoint && sliceLevel === undefined) return null;
    const x = selectedPoint?.x ?? 0;
    const z = selectedPoint?.z ?? 0;
    return Array.from({ length: DEPTH_LAYERS }, (_, d) => ({
      depth: d,
      label: DEPTH_LABELS[d],
      depthM: DEPTH_MID_M[d],
      value: valueToConcentration(data[z]?.[x]?.[d] ?? 0, variableId),
      raw: data[z]?.[x]?.[d] ?? 0,
    }));
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
  const valRange = maxVal - minVal || 1;

  const toX = (val: number) => PAD_LEFT + ((val - minVal) / valRange) * INNER_W;
  const toY = (depthM: number) => PAD_TOP + (depthM / MAX_DEPTH_M) * INNER_H;

  const points = profile.map((p) => ({ cx: toX(p.value), cy: toY(p.depthM), ...p }));

  const polylinePoints = points.map((p) => `${p.cx},${p.cy}`).join(" ");

  const areaPoints = [
    `${PAD_LEFT},${toY(DEPTH_MID_M[0])}`,
    ...points.map((p) => `${p.cx},${p.cy}`),
    `${PAD_LEFT},${toY(DEPTH_MID_M[DEPTH_LAYERS - 1])}`,
  ].join(" ");

  const xTicks = [minVal, (minVal + maxVal) / 2, maxVal];

  return (
    <div className="space-y-2">
      <div>
        <div className="panel-section-title">Depth Profile</div>
        {selectedPoint && (
          <div className="data-label text-[9px] mt-0.5">
            Cell ({selectedPoint.x}, {selectedPoint.z}) · {variableLabel}
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        width="100%"
        style={{ display: "block", overflow: "visible" }}
      >
        {/* Grid lines for depth */}
        {profile.map((p) => {
          const y = toY(p.depthM);
          return (
            <line
              key={p.depth}
              x1={PAD_LEFT} y1={y}
              x2={PAD_LEFT + INNER_W} y2={y}
              stroke="hsl(var(--border))"
              strokeWidth={0.5}
              strokeDasharray="2 2"
            />
          );
        })}

        {/* X grid line at min and max */}
        {[PAD_LEFT, PAD_LEFT + INNER_W].map((x, i) => (
          <line key={i} x1={x} y1={PAD_TOP} x2={x} y2={PAD_TOP + INNER_H}
            stroke="hsl(var(--border))" strokeWidth={0.5} />
        ))}

        {/* Area fill */}
        <polygon
          points={areaPoints}
          fill="hsl(var(--primary))"
          fillOpacity={0.08}
        />

        {/* Main line */}
        <polyline
          points={polylinePoints}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Data points */}
        {points.map((p) => {
          const isSelected = selectedPoint?.depth === p.depth;
          return (
            <g key={p.depth}>
              {isSelected && (
                <circle cx={p.cx} cy={p.cy} r={6}
                  fill="hsl(var(--primary))" fillOpacity={0.15} />
              )}
              <circle
                cx={p.cx} cy={p.cy}
                r={isSelected ? 3.5 : 2.5}
                fill={isSelected ? "hsl(var(--primary))" : "white"}
                stroke="hsl(var(--primary))"
                strokeWidth={1.5}
              />
              {/* Value label for selected */}
              {isSelected && (
                <text
                  x={p.cx + 5} y={p.cy + 3.5}
                  fontSize={7} fill="hsl(var(--primary))"
                  fontWeight="600"
                >
                  {p.value} {unit}
                </text>
              )}
            </g>
          );
        })}

        {/* Y-axis depth labels */}
        {profile.map((p) => (
          <text
            key={p.depth}
            x={PAD_LEFT - 4} y={toY(p.depthM) + 3}
            fontSize={7}
            textAnchor="end"
            fill="hsl(var(--muted-foreground))"
          >
            {p.label}
          </text>
        ))}

        {/* X-axis value ticks */}
        {xTicks.map((v, i) => (
          <text
            key={i}
            x={toX(v)}
            y={PAD_TOP + INNER_H + 12}
            fontSize={7}
            textAnchor="middle"
            fill="hsl(var(--muted-foreground))"
          >
            {v.toFixed(1)}
          </text>
        ))}

        {/* Axes */}
        <line x1={PAD_LEFT} y1={PAD_TOP} x2={PAD_LEFT} y2={PAD_TOP + INNER_H}
          stroke="hsl(var(--border))" strokeWidth={1} />
        <line x1={PAD_LEFT} y1={PAD_TOP + INNER_H} x2={PAD_LEFT + INNER_W} y2={PAD_TOP + INNER_H}
          stroke="hsl(var(--border))" strokeWidth={1} />

        {/* Unit label */}
        <text
          x={PAD_LEFT + INNER_W / 2}
          y={CHART_H - 2}
          fontSize={7}
          textAnchor="middle"
          fill="hsl(var(--muted-foreground))"
        >
          {unit}
        </text>
      </svg>
    </div>
  );
}
