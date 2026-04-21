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

const N_VAR    = { id: "nitrogen",   label: "N",    color: "#c084fc", varMin: 0.2, varMax: 3.0,  unit: "mg/L",  decimals: 1 };
const P_VAR    = { id: "phosphorus", label: "P",    color: "#fb923c", varMin: 0.010, varMax: 0.130, unit: "mg/L", decimals: 3 };
const FLOW_VAR = { id: "flow",       label: "Flow", color: "#26c6da", varMin: 0,   varMax: 750, unit: "t/ha",  decimals: 0 };

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

type VarDef = { id: string; label: string; color: string; varMin: number; varMax: number; unit: string; decimals: number };

interface MiniChartProps {
  title: string;
  varDef: VarDef;
  values: number[];   // normalized 0–1
  varDef2?: VarDef;
  values2?: number[];
  height: number;
  patId: string;
}

function MiniChart({ title, varDef, values, varDef2, values2, height, patId }: MiniChartProps) {
  const [hovIdx, setHovIdx] = useState<number | null>(null);
  const dual = !!(varDef2 && values2);
  const ptTop = dual ? 34 : PT;
  const IH = height - ptTop - PB;

  const toY = (di: number) => ptTop + (di / (DEPTH_LAYERS - 1)) * IH;
  const toX = (v: number) => PL + v * IW;
  const toPhys1 = (v: number) => varDef.varMin + v * (varDef.varMax - varDef.varMin);
  const toPhys2 = (v: number) => varDef2 ? varDef2.varMin + v * (varDef2.varMax - varDef2.varMin) : 0;
  const fmt1 = (v: number) => v.toFixed(varDef.decimals);
  const fmt2 = (v: number) => varDef2 ? v.toFixed(varDef2.decimals) : "";

  const pts1: [number, number][] = values.map((v, di) => [toX(v), toY(di)]);
  const pts2: [number, number][] = values2 ? values2.map((v, di) => [toX(v), toY(di)]) : [];

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
          const fracY = (svgY - ptTop) / IH;
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
        <rect x={PL} y={ptTop} width={IW} height={IH} fill={`url(#${patId})`} />

        {/* Depth axis */}
        <line x1={PL} y1={ptTop} x2={PL} y2={ptTop + IH} stroke="#374151" strokeWidth={1.2} />
        <line x1={PL} y1={ptTop} x2={PL + IW} y2={ptTop} stroke="#e5e7eb" strokeWidth={0.8} />

        {/* Depth tick labels — left */}
        {DEPTH_LABELS.map((lbl, i) => (
          <text key={i} x={PL - 4} y={toY(i) + 3} fontSize={7} textAnchor="end" fill="#6b7280">
            {lbl}
          </text>
        ))}
        <text x={PL - 4} y={ptTop - (dual ? 20 : 8)} fontSize={7} fill="#374151" fontWeight="500" textAnchor="end">
          Depth
        </text>

        {/* Var1 axis ticks — bottom tick row */}
        {[0, 0.5, 1].map((frac) => (
          <text key={frac} x={toX(frac)} y={ptTop - 4} fontSize={7} textAnchor="middle" fill={varDef.color}>
            {fmt1(toPhys1(frac))}
          </text>
        ))}
        <text x={PL + IW} y={ptTop - 13} fontSize={6.5} textAnchor="end" fill={varDef.color} opacity={0.8}>
          N {varDef.unit}
        </text>

        {/* Var2 axis ticks — top tick row (only if dual) */}
        {dual && varDef2 && [0, 0.5, 1].map((frac) => (
          <text key={frac} x={toX(frac)} y={ptTop - 14} fontSize={7} textAnchor="middle" fill={varDef2.color}>
            {fmt2(toPhys2(frac))}
          </text>
        ))}
        {dual && varDef2 && (
          <text x={PL + IW} y={ptTop - 23} fontSize={6.5} textAnchor="end" fill={varDef2.color} opacity={0.8}>
            P {varDef2.unit}
          </text>
        )}

        {/* Horizontal grid lines */}
        {DEPTH_LABELS.map((_, i) => (
          <line key={i}
            x1={PL} y1={toY(i)} x2={PL + IW} y2={toY(i)}
            stroke="#e5e7eb" strokeWidth={0.5} opacity={0.7}
          />
        ))}

        {/* Smooth curves */}
        <path d={smooth(pts1)} fill="none"
          stroke={varDef.color} strokeWidth={1.8}
          strokeLinecap="round" strokeLinejoin="round" opacity={0.9}
        />
        {dual && pts2.length > 0 && (
          <path d={smooth(pts2)} fill="none"
            stroke={varDef2!.color} strokeWidth={1.8}
            strokeLinecap="round" strokeLinejoin="round" opacity={0.9}
          />
        )}

        {/* Hover indicator */}
        {hovIdx !== null && (
          <>
            <line
              x1={PL} y1={toY(hovIdx)} x2={PL + IW} y2={toY(hovIdx)}
              stroke="#374151" strokeWidth={0.8} strokeDasharray="3 2" opacity={0.5}
            />
            <circle cx={toX(values[hovIdx])} cy={toY(hovIdx)} r={3} fill={varDef.color} stroke="white" strokeWidth={1.2} />
            {dual && values2 && (
              <circle cx={toX(values2[hovIdx])} cy={toY(hovIdx)} r={3} fill={varDef2!.color} stroke="white" strokeWidth={1.2} />
            )}
            <text x={PL - 6} y={toY(hovIdx) + 3} fontSize={6.5} textAnchor="end" fill="#374151" fontWeight="600">
              {DEPTH_MID_M[hovIdx]}m
            </text>
            <text x={PL + IW + 2} y={toY(hovIdx) + (dual ? -3 : 3)} fontSize={6.5} textAnchor="start" fill={varDef.color} fontWeight="600">
              {fmt1(toPhys1(values[hovIdx]))}
            </text>
            {dual && values2 && (
              <text x={PL + IW + 2} y={toY(hovIdx) + 7} fontSize={6.5} textAnchor="start" fill={varDef2!.color} fontWeight="600">
                {fmt2(toPhys2(values2[hovIdx]))}
              </text>
            )}
          </>
        )}

        {/* Legend swatches */}
        <g>
          <line x1={PL + IW - 32} y1={ptTop + 10} x2={PL + IW - 22} y2={ptTop + 10}
            stroke={varDef.color} strokeWidth={2} strokeLinecap="round" />
          <text x={PL + IW - 19} y={ptTop + 13} fontSize={6.5} fill="#374151">{varDef.label}</text>
        </g>
        {dual && varDef2 && (
          <g>
            <line x1={PL + IW - 32} y1={ptTop + 21} x2={PL + IW - 22} y2={ptTop + 21}
              stroke={varDef2.color} strokeWidth={2} strokeLinecap="round" />
            <text x={PL + IW - 19} y={ptTop + 24} fontSize={6.5} fill="#374151">{varDef2.label}</text>
          </g>
        )}
      </svg>
    </div>
  );
}

/**
 * Generate a depth profile for water flow at a bay cell.
 * Flow is driven by tidal/wind forcing (peaks spring/autumn), not nutrient runoff.
 * Depth structure: estuarine — surface outflow layer, mid-depth minimum, bottom inflow layer.
 */
function generateFlowProfile(week: number, x: number, z: number): number[] {
  const TOTAL_WEEKS = 52;
  // Flow peaks in spring (snowmelt/storms) and autumn — two annual peaks
  const t = (week / TOTAL_WEEKS) * Math.PI * 2;
  const seasonalFlow = 0.5 + 0.35 * Math.sin(t + 0.8) + 0.15 * Math.sin(2 * t + 1.2);
  // Spatial variation: stronger flow at bay mouth (high x), calmer in inner bay
  const spatialMod = 0.4 + 0.6 * (x / 13);
  // Cell-to-cell texture
  const cellVar = 0.85 + 0.15 * Math.sin(x * 1.3 + z * 0.9 + week * 0.17);

  return Array.from({ length: DEPTH_LAYERS }, (_, d) => {
    const f = d / (DEPTH_LAYERS - 1);
    // Estuarine two-layer circulation: strong at surface, weak at mid, moderate at bottom
    const depthProfile =
      0.85 * Math.exp(-Math.pow(f - 0.0, 2) / 0.08) +   // surface outflow peak
      0.45 * Math.exp(-Math.pow(f - 1.0, 2) / 0.12) +   // bottom inflow layer
      0.05;                                                // residual at mid-depth
    return Math.min(1, Math.max(0, depthProfile * seasonalFlow * spatialMod * cellVar));
  });
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

    // N and P from the nutrient field; Flow is computed independently
    const nValues = Array.from({ length: DEPTH_LAYERS }, (_, d) => {
      const raw = data[z]?.[x]?.[d] ?? 0;
      const f = d / (DEPTH_LAYERS - 1);
      return Math.min(1, Math.max(0, raw * (1 - f * 0.5)));
    });
    const pValues = Array.from({ length: DEPTH_LAYERS }, (_, d) => {
      const raw = data[z]?.[x]?.[d] ?? 0;
      const f = d / (DEPTH_LAYERS - 1);
      return Math.min(1, Math.max(0, raw * (0.5 + 0.5 * Math.sin(f * Math.PI * 0.9 + 0.1))));
    });
    const flowValues = generateFlowProfile(week, x, z);

    return { nValues, pValues, flowValues };
  }, [data, week, selectedPoint, sliceLevel]);

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
          varDef={N_VAR}    values={profiles.nValues}
          varDef2={P_VAR}   values2={profiles.pValues}
          height={175} patId="dg-np"
        />
        <MiniChart title="Water Flow" varDef={FLOW_VAR} values={profiles.flowValues} height={145} patId="dg-flow" />
      </div>
    </div>
  );
}
