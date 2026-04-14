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

const DEPTH_LABELS = ["1m", "5m", "15m", "30m", "50m", "75m", "100m", "125m"];
const DEPTH_MID_M  = [2.5, 10, 22.5, 40, 62.5, 87.5, 112.5, 137.5];

const NP_VARS = [
  { id: "nitrogen",   label: "N",   color: "#c084fc" },
  { id: "phosphorus", label: "P",   color: "#fb923c" },
];
const FLOW_VARS = [
  { id: "flow", label: "Flow", color: "#26c6da" },
];

const SVG_W = 200;
const PL = 34;
const PR = 12;
const PT = 22;
const PB = 10;
const IW = SVG_W - PL - PR;

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

interface MiniChartProps {
  title: string;
  unit: string;
  vars: { id: string; label: string; color: string }[];
  profiles: { id: string; label: string; color: string; values: number[] }[];
  height: number;
  patId: string;
}

function MiniChart({ title, unit, vars, profiles, height, patId }: MiniChartProps) {
  const [hovIdx, setHovIdx] = useState<number | null>(null);
  const IH = height - PT - PB;

  const toY = (di: number) => PT + (di / (DEPTH_LAYERS - 1)) * IH;
  const toX = (v: number) => PL + v * IW;

  const myProfiles = profiles.filter(p => vars.some(v => v.id === p.id));

  return (
    <div>
      <div className="data-label text-[9px] mb-0.5">{title}</div>
      <svg
        viewBox={`0 0 ${SVG_W} ${height}`}
        width="100%"
        style={{ display: "block", overflow: "visible", cursor: "crosshair" }}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const svgY = ((e.clientY - rect.top) / rect.height) * height;
          const fracY = (svgY - PT) / IH;
          const idx = Math.round(fracY * (DEPTH_LAYERS - 1));
          setHovIdx(idx >= 0 && idx < DEPTH_LAYERS ? idx : null);
        }}
        onMouseLeave={() => setHovIdx(null)}
      >
        <defs>
          <pattern id={patId} x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.8" fill="#d1d5db" />
          </pattern>
        </defs>

        {/* Dotted background */}
        <rect x={PL} y={PT} width={IW} height={IH} fill={`url(#${patId})`} />

        {/* Left border — depth axis */}
        <line x1={PL} y1={PT} x2={PL} y2={PT + IH} stroke="#374151" strokeWidth={1.2} />

        {/* Top border — value axis baseline */}
        <line x1={PL} y1={PT} x2={PL + IW} y2={PT} stroke="#e5e7eb" strokeWidth={0.8} />

        {/* Depth tick labels — left */}
        {DEPTH_LABELS.map((lbl, i) => (
          <text key={i} x={PL - 4} y={toY(i) + 3} fontSize={7} textAnchor="end" fill="#6b7280">
            {lbl}
          </text>
        ))}

        {/* "Depth" label */}
        <text x={PL - 4} y={PT - 8} fontSize={7} fill="#374151" fontWeight="500" textAnchor="end">
          Depth
        </text>

        {/* Value axis tick labels — TOP */}
        {[0, 0.5, 1].map((v, i) => (
          <text key={i} x={toX(v)} y={PT - 4} fontSize={7} textAnchor="middle" fill="#6b7280">
            {i === 2 ? "max" : i === 0 ? "0" : "0.5"}
          </text>
        ))}

        {/* Unit label — top right of axis */}
        <text x={PL + IW} y={PT - 12} fontSize={6.5} textAnchor="end" fill="#9ca3af">
          {unit}
        </text>

        {/* Horizontal grid lines */}
        {DEPTH_LABELS.map((_, i) => (
          <line key={i}
            x1={PL} y1={toY(i)} x2={PL + IW} y2={toY(i)}
            stroke="#e5e7eb" strokeWidth={0.5} opacity={0.7}
          />
        ))}

        {/* Smooth curves */}
        {myProfiles.map((prof) => {
          const pts: [number, number][] = prof.values.map((v, di) => [toX(v), toY(di)]);
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

        {/* Hover indicator */}
        {hovIdx !== null && (
          <>
            <line
              x1={PL} y1={toY(hovIdx)}
              x2={PL + IW} y2={toY(hovIdx)}
              stroke="#374151" strokeWidth={0.8} strokeDasharray="3 2"
              opacity={0.5}
            />
            {myProfiles.map((prof) => (
              <circle
                key={prof.id}
                cx={toX(prof.values[hovIdx])}
                cy={toY(hovIdx)}
                r={3}
                fill={prof.color}
                stroke="white"
                strokeWidth={1.2}
              />
            ))}
            <rect
              x={PL + IW + 1} y={toY(hovIdx) - 6}
              width={PR - 1} height={11}
              rx={2} fill="#1f2937" opacity={0.85}
            />
            <text
              x={PL + IW + PR / 2} y={toY(hovIdx) + 3}
              fontSize={6.5} textAnchor="middle" fill="white"
            >
              {DEPTH_MID_M[hovIdx]}
            </text>
          </>
        )}

        {/* Legend — top right inside */}
        {myProfiles.map((prof, i) => {
          const lx = PL + IW - 42;
          const ly = PT + 12 + i * 11;
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

export default function DepthGraph({
  week,
  variableId,
  variableLabel,
  unit,
  selectedPoint,
  sliceLevel,
}: DepthGraphProps) {
  const data = useMemo(() => generateWeekData(week), [week]);

  const profiles = useMemo(() => {
    if (!selectedPoint && sliceLevel === undefined) return null;
    const x = selectedPoint?.x ?? 0;
    const z = selectedPoint?.z ?? 0;

    return [...NP_VARS, ...FLOW_VARS].map((v) => ({
      ...v,
      values: Array.from({ length: DEPTH_LAYERS }, (_, d) => {
        const raw = data[z]?.[x]?.[d] ?? 0;
        const f = d / (DEPTH_LAYERS - 1);
        let shaped: number;
        if (v.id === "nitrogen") {
          shaped = raw * (1 - f * 0.5);
        } else if (v.id === "phosphorus") {
          shaped = raw * (0.5 + 0.5 * Math.sin(f * Math.PI * 0.9 + 0.1));
        } else {
          shaped = raw * Math.exp(-Math.pow(f - 0.2, 2) * 4);
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

  return (
    <div className="space-y-1">
      <div className="panel-section-title">Depth Profile</div>
      {selectedPoint && (
        <div className="data-label text-[9px] mb-2">
          Cell ({selectedPoint.x}, {selectedPoint.z})
        </div>
      )}

      <div className="space-y-4">
        <MiniChart
          title="Nitrogen · Phosphorus"
          unit="norm."
          vars={NP_VARS}
          profiles={profiles}
          height={230}
          patId="dg-dots-np"
        />
        <MiniChart
          title="Water Flow"
          unit="norm."
          vars={FLOW_VARS}
          profiles={profiles}
          height={180}
          patId="dg-dots-flow"
        />
      </div>
    </div>
  );
}
