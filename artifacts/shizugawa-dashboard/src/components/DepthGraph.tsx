import { useMemo, useState } from "react";
import { generateWeekData, DEPTH_LAYERS } from "@/lib/simulatedData";

interface DepthGraphProps {
  week: number;
  variableId: string;
  variableLabel: string;
  unit: string;
  selectedPoint: { x: number; z: number; depth: number } | null;
  sliceLevel?: number;
}

const DEPTH_LABELS = ["1m", "5", "15", "30", "50", "75", "100", "125"];
const DEPTH_MID_M  = [2.5, 10, 22.5, 40, 62.5, 87.5, 112.5, 137.5];

const ALL_VARS = [
  { id: "nitrogen",    label: "Nitrogen",    color: "#c084fc" },
  { id: "phosphorus",  label: "Phosphorus",  color: "#fb923c" },
  { id: "chlorophyll", label: "Chlorophyll", color: "#4ade80" },
  { id: "do",          label: "DO",          color: "#60a5fa" },
];

const SVG_W = 240;
const SVG_H = 160;
const PL = 8;
const PR = 46;
const PT = 26;
const PB = 30;
const IW = SVG_W - PL - PR;
const IH = SVG_H - PT - PB;

function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p0[1]) / 6;
    d += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2[0]},${p2[1]}`;
  }
  return d;
}

export default function DepthGraph({
  week,
  variableId,
  variableLabel,
  unit,
  selectedPoint,
  sliceLevel,
}: DepthGraphProps) {
  const [hoveredDepth, setHoveredDepth] = useState<number | null>(null);
  const data = useMemo(() => generateWeekData(week), [week]);

  const profiles = useMemo(() => {
    if (!selectedPoint && sliceLevel === undefined) return null;
    const x = selectedPoint?.x ?? 0;
    const z = selectedPoint?.z ?? 0;

    return ALL_VARS.map((v) => ({
      ...v,
      values: Array.from({ length: DEPTH_LAYERS }, (_, d) => {
        const raw = data[z]?.[x]?.[d] ?? 0;
        const f = d / (DEPTH_LAYERS - 1); // 0 = surface, 1 = bottom
        let shaped: number;
        if (v.id === "nitrogen") {
          // River-driven: highest near surface, gradual decrease
          shaped = raw * (1 - f * 0.5);
        } else if (v.id === "phosphorus") {
          // Sediment-driven: builds toward mid-bottom
          shaped = raw * (0.5 + 0.5 * Math.sin(f * Math.PI * 0.9 + 0.1));
        } else if (v.id === "chlorophyll") {
          // Photosynthesis: peaks near surface, drops sharply at depth
          shaped = raw * Math.exp(-f * 2.8);
        } else {
          // DO: high at surface (atm exchange), decreasing with depth
          shaped = raw * (1 - f * 0.55 + f * f * 0.15);
        }
        return Math.min(1, Math.max(0, shaped));
      }),
    }));
  }, [data, selectedPoint, sliceLevel]);

  if (!profiles) {
    return (
      <div className="text-center py-6 text-muted-foreground text-xs">
        Select a cell to view depth profile
      </div>
    );
  }

  const toX = (di: number) => PL + (di / (DEPTH_LAYERS - 1)) * IW;
  const toY = (v: number) => PT + (1 - v) * IH;

  // Dot grid pattern id
  const patId = "dg-dots";

  // Active depth index from hover
  const hovIdx = hoveredDepth;

  return (
    <div className="space-y-1">
      <div>
        <div className="panel-section-title">Depth Profile</div>
        {selectedPoint && (
          <div className="data-label text-[9px] mt-0.5">
            Cell ({selectedPoint.x}, {selectedPoint.z}) · all variables
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="100%"
        style={{ display: "block", overflow: "visible", cursor: "crosshair" }}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const svgX = ((e.clientX - rect.left) / rect.width) * SVG_W;
          const fracX = (svgX - PL) / IW;
          const idx = Math.round(fracX * (DEPTH_LAYERS - 1));
          setHoveredDepth(idx >= 0 && idx < DEPTH_LAYERS ? idx : null);
        }}
        onMouseLeave={() => setHoveredDepth(null)}
      >
        <defs>
          <pattern id={patId} x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.8" fill="#d1d5db" />
          </pattern>
        </defs>

        {/* Dotted background */}
        <rect x={PL} y={PT} width={IW} height={IH} fill={`url(#${patId})`} />

        {/* X-axis line at top */}
        <line x1={PL} y1={PT} x2={PL + IW} y2={PT} stroke="#374151" strokeWidth={1.2} />

        {/* Depth tick labels along top */}
        {DEPTH_LABELS.map((lbl, i) => (
          <text key={i} x={toX(i)} y={PT - 6} fontSize={8} textAnchor="middle" fill="#6b7280">
            {lbl}
          </text>
        ))}

        {/* "Depth" label at far right */}
        <text x={PL + IW + 4} y={PT + 4} fontSize={8} fill="#374151" fontWeight="500">Depth</text>

        {/* Y-axis left border */}
        <line x1={PL} y1={PT} x2={PL} y2={PT + IH} stroke="#e5e7eb" strokeWidth={0.8} />

        {/* Smooth variable curves */}
        {profiles.map((prof) => {
          const pts: [number, number][] = prof.values.map((v, i) => [toX(i), toY(v)]);
          return (
            <path
              key={prof.id}
              d={smooth(pts)}
              fill="none"
              stroke={prof.color}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.9}
            />
          );
        })}

        {/* Hover vertical indicator */}
        {hovIdx !== null && (
          <>
            <line
              x1={toX(hovIdx)} y1={PT}
              x2={toX(hovIdx)} y2={PT + IH}
              stroke="#374151" strokeWidth={0.8} strokeDasharray="3 2"
              opacity={0.5}
            />
            {profiles.map((prof) => (
              <circle
                key={prof.id}
                cx={toX(hovIdx)}
                cy={toY(prof.values[hovIdx])}
                r={3}
                fill={prof.color}
                stroke="white"
                strokeWidth={1.2}
              />
            ))}
            {/* Depth label on hover */}
            <rect
              x={toX(hovIdx) - 14} y={PT + IH + 2}
              width={28} height={11}
              rx={2} fill="#1f2937" opacity={0.85}
            />
            <text
              x={toX(hovIdx)} y={PT + IH + 10}
              fontSize={7} textAnchor="middle" fill="white"
            >
              {DEPTH_MID_M[hovIdx]}m
            </text>
          </>
        )}

        {/* "Metric (mg/L)" bottom-left label */}
        <text x={PL} y={SVG_H - 2} fontSize={7} fill="#9ca3af">
          Metric ({unit})
        </text>

        {/* Legend bottom-right */}
        {profiles.map((prof, i) => {
          const lx = PL + IW + 4;
          const ly = PT + 14 + i * 11;
          return (
            <g key={prof.id}>
              <line x1={lx} y1={ly - 2} x2={lx + 10} y2={ly - 2}
                stroke={prof.color} strokeWidth={2} strokeLinecap="round" />
              <text x={lx + 13} y={ly + 1} fontSize={6.5} fill="#374151">{prof.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
