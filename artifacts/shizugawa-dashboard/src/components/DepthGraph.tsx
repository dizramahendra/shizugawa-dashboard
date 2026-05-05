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

type VarDef = { id: string; label: string; color: string; varMin: number; varMax: number; unit: string; decimals: number };

// Series colors chosen to match the Figma palette: blue N, green P, purple Flow.
const N_VAR:    VarDef = { id: "nitrogen",   label: "Nitrogen",   color: "#60a5fa", varMin: 0.2, varMax: 3.0,  unit: "mg/L",  decimals: 2 };
const P_VAR:    VarDef = { id: "phosphorus", label: "Phosphorus", color: "#34d399", varMin: 10,  varMax: 130,  unit: "μg/L",  decimals: 0 };
const FLOW_VAR: VarDef = { id: "flow",       label: "Water Flow", color: "#a78bfa", varMin: 0,   varMax: 100,  unit: "cm/s",  decimals: 1 };

// Geometry — sized for the 288px sidebar (inner width ≈ 256px after px-4 padding).
const SVG_W = 256;
const PL = 38;     // left padding for depth labels
const PR = 14;     // right padding
const PT_SINGLE = 22;
const PT_DUAL   = 36;
const PB = 8;
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
  varDef: VarDef;
  values: number[];   // normalized 0–1, length === DEPTH_LAYERS
  varDef2?: VarDef;
  values2?: number[];
  height: number;
  patId: string;
}

function MiniChart({ varDef, values, varDef2, values2, height, patId }: MiniChartProps) {
  const [hovIdx, setHovIdx] = useState<number | null>(null);
  const dual = !!(varDef2 && values2);
  const ptTop = dual ? PT_DUAL : PT_SINGLE;
  const IH = height - ptTop - PB;

  const toY = (di: number) => ptTop + (di / (DEPTH_LAYERS - 1)) * IH;
  const toX = (v: number) => PL + v * IW;
  const toPhys1 = (v: number) => varDef.varMin + v * (varDef.varMax - varDef.varMin);
  const toPhys2 = (v: number) => (varDef2 ? varDef2.varMin + v * (varDef2.varMax - varDef2.varMin) : 0);
  const fmt1 = (v: number) => v.toFixed(varDef.decimals);
  const fmt2 = (v: number) => (varDef2 ? v.toFixed(varDef2.decimals) : "");

  const pts1: [number, number][] = values.map((v, di) => [toX(v), toY(di)]);
  const pts2: [number, number][] = values2 ? values2.map((v, di) => [toX(v), toY(di)]) : [];

  // External legend row (HTML, above SVG) — fixes the colliding-text issue
  // by lifting series labels out of the SVG axis area.
  const legend = (
    <div className="flex items-center gap-3 mb-1.5 text-[10.5px]">
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: varDef.color }} />
        <span className="text-foreground">{varDef.label}</span>
        <span className="text-muted-foreground">({varDef.unit})</span>
      </span>
      {dual && varDef2 && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: varDef2.color }} />
          <span className="text-foreground">{varDef2.label}</span>
          <span className="text-muted-foreground">({varDef2.unit})</span>
        </span>
      )}
    </div>
  );

  // Tooltip card — pinned to the side OPPOSITE the data points so it never
  // covers the dashed hover line or the curves themselves. Vertical position
  // is clamped so the card stays inside the chart bounds at top/bottom.
  let tooltipNode: React.ReactNode = null;
  if (hovIdx !== null) {
    const x1 = values[hovIdx];
    const x2 = dual && values2 ? values2[hovIdx] : x1;
    const meanX = (x1 + x2) / 2;
    const cardOnLeft = meanX > 0.5;        // data on right → card on left
    const yPct = (toY(hovIdx) / height) * 100;
    const fy = (toY(hovIdx) - ptTop) / IH; // 0 = top of plot, 1 = bottom
    let yTransform = "translateY(-50%)";
    if (fy < 0.2)      yTransform = "translateY(0)";
    else if (fy > 0.8) yTransform = "translateY(-100%)";

    tooltipNode = (
      <div
        className="absolute pointer-events-none bg-white border border-border/60 rounded-md shadow-md px-2.5 py-1.5 z-10"
        style={{
          top: `${yPct}%`,
          [cardOnLeft ? "left" : "right"]: "10%",
          transform: yTransform,
          minWidth: dual ? 130 : 110,
        }}
      >
        <div className="text-[11px] font-semibold text-foreground mb-1">
          {DEPTH_MID_M[hovIdx]} m
        </div>
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: varDef.color }} />
          <span className="text-muted-foreground">{varDef.label}:</span>
          <span className="font-semibold text-foreground ml-auto">
            {fmt1(toPhys1(values[hovIdx]))}
            <span className="font-normal text-muted-foreground ml-0.5">{varDef.unit}</span>
          </span>
        </div>
        {dual && values2 && varDef2 && (
          <div className="flex items-center gap-1.5 text-[10px] mt-0.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: varDef2.color }} />
            <span className="text-muted-foreground">{varDef2.label}:</span>
            <span className="font-semibold text-foreground ml-auto">
              {fmt2(toPhys2(values2[hovIdx]))}
              <span className="font-normal text-muted-foreground ml-0.5">{varDef2.unit}</span>
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {legend}
      <div className="relative">
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
              <circle cx="1" cy="1" r="0.7" fill="#e5e7eb" />
            </pattern>
          </defs>

          {/* Dotted plot background */}
          <rect x={PL} y={ptTop} width={IW} height={IH} fill={`url(#${patId})`} />

          {/* Y-axis spine */}
          <line x1={PL} y1={ptTop} x2={PL} y2={ptTop + IH} stroke="#9ca3af" strokeWidth={0.8} />

          {/* Depth tick labels (Y-axis, left) */}
          {DEPTH_LABELS.map((lbl, i) => (
            <text key={i} x={PL - 5} y={toY(i) + 3} fontSize={9} textAnchor="end" fill="#6b7280">
              {lbl}
            </text>
          ))}

          {/* Top axis: var1 ticks (single mode bottom row, dual mode bottom of two rows) */}
          {[0, 0.5, 1].map((frac, i) => (
            <text
              key={`t1-${i}`}
              x={toX(frac)}
              y={ptTop - 4}
              fontSize={9.5}
              textAnchor={frac === 0 ? "start" : frac === 1 ? "end" : "middle"}
              fill={varDef.color}
              fontWeight={500}
            >
              {fmt1(toPhys1(frac))}
            </text>
          ))}

          {/* Top axis: var2 ticks (dual only — sits ABOVE var1 row, color = green/P) */}
          {dual && varDef2 && [0, 0.5, 1].map((frac, i) => (
            <text
              key={`t2-${i}`}
              x={toX(frac)}
              y={ptTop - 17}
              fontSize={9.5}
              textAnchor={frac === 0 ? "start" : frac === 1 ? "end" : "middle"}
              fill={varDef2.color}
              fontWeight={500}
            >
              {fmt2(toPhys2(frac))}
            </text>
          ))}

          {/* Horizontal grid lines */}
          {DEPTH_LABELS.map((_, i) => (
            <line
              key={`g-${i}`}
              x1={PL}
              y1={toY(i)}
              x2={PL + IW}
              y2={toY(i)}
              stroke="#e5e7eb"
              strokeWidth={0.5}
              opacity={0.7}
            />
          ))}

          {/* Smooth curves */}
          <path
            d={smooth(pts1)}
            fill="none"
            stroke={varDef.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {dual && pts2.length > 0 && (
            <path
              d={smooth(pts2)}
              fill="none"
              stroke={varDef2!.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Hover indicator — red dashed depth line + colored data dots.
              All numeric labels live in the HTML tooltip card overlay so the
              SVG stays uncluttered. */}
          {hovIdx !== null && (
            <>
              <line
                x1={PL}
                y1={toY(hovIdx)}
                x2={PL + IW}
                y2={toY(hovIdx)}
                stroke="#ef4444"
                strokeWidth={1}
                strokeDasharray="4 3"
                opacity={0.85}
              />
              <circle
                cx={toX(values[hovIdx])}
                cy={toY(hovIdx)}
                r={3.5}
                fill={varDef.color}
                stroke="white"
                strokeWidth={1.5}
              />
              {dual && values2 && (
                <circle
                  cx={toX(values2[hovIdx])}
                  cy={toY(hovIdx)}
                  r={3.5}
                  fill={varDef2!.color}
                  stroke="white"
                  strokeWidth={1.5}
                />
              )}
            </>
          )}
        </svg>
        {tooltipNode}
      </div>
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
  const t = (week / TOTAL_WEEKS) * Math.PI * 2;
  const seasonalFlow = 0.5 + 0.35 * Math.sin(t + 0.8) + 0.15 * Math.sin(2 * t + 1.2);
  const spatialMod = 0.4 + 0.6 * (x / 13);
  const cellVar = 0.85 + 0.15 * Math.sin(x * 1.3 + z * 0.9 + week * 0.17);

  return Array.from({ length: DEPTH_LAYERS }, (_, d) => {
    const f = d / (DEPTH_LAYERS - 1);
    const depthProfile =
      0.85 * Math.exp(-Math.pow(f - 0.0, 2) / 0.08) +
      0.45 * Math.exp(-Math.pow(f - 1.0, 2) / 0.12) +
      0.05;
    return Math.min(1, Math.max(0, depthProfile * seasonalFlow * spatialMod * cellVar));
  });
}

export default function DepthGraph({
  week,
  variableId: _variableId,
  variableLabel: _variableLabel,
  unit: _unit,
  selectedPoint,
  sliceLevel,
}: DepthGraphProps) {
  const data = useMemo(() => generateWeekData(week), [week]);

  const profiles = useMemo(() => {
    if (!selectedPoint && sliceLevel === undefined) return null;
    const x = selectedPoint?.x ?? 0;
    const z = selectedPoint?.z ?? 0;

    // N and P from the nutrient field; Flow is computed independently.
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
    <div className="space-y-4">
      <div className="text-sm font-semibold text-foreground">Depth Profile</div>

      <MiniChart
        varDef={N_VAR}
        values={profiles.nValues}
        varDef2={P_VAR}
        values2={profiles.pValues}
        height={210}
        patId="dg-np"
      />
      <MiniChart
        varDef={FLOW_VAR}
        values={profiles.flowValues}
        height={170}
        patId="dg-flow"
      />
    </div>
  );
}
