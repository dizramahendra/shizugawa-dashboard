import { useMemo, useState, type ReactNode } from "react";
import {
  X, Layers, BarChart3, Sigma, MapPin, Mountain, TreePine,
  Hexagon, Sparkles, Info,
} from "lucide-react";
import {
  SUB_BASIN_INDICATORS,
  SUB_BASIN_META,
  SUB_BASIN_BASELINE_AVG,
  SUB_BASIN_MEASURES,
  aggregateSubBasins,
  getSubBasin,
  getSubBasinMeasure,
  type SubBasinMeta,
  type SubBasinIndicatorDef,
  type SubBasinIndicatorId,
  type SubBasinMeasureId,
} from "@/lib/simulatedData";

// ── Visual constants ────────────────────────────────────────────────────────
//
// The sidebar is 360px wide; each mini-chart consumes the inner width
// (≈ 312px after padding).  Per-basin cards stay vertical and stacked so all
// 5 indicators read at the same scale on screen.
const CHART_INNER_W   = 308;
const CHART_H         = 110;
const CHART_H_AGG     = 96;
const PAD_L = 38, PAD_R = 8, PAD_T = 8, PAD_B = 22;

const RADAR_W = CHART_INNER_W;
const RADAR_H = 250;

const LAND_USE_LABEL: Record<string, string> = {
  forest: "Forest",
  agricultural: "Agricultural",
  mixed: "Mixed",
  urban: "Urban",
  coastal: "Coastal",
};

// Reference-line color (avg of 25 sub-basins)
const REF_COLOR = "#0ea5e9";
const REF_COLOR_DARK = "#0369a1";

// Before / After palette (used in aggregate-with-measure mode)
const BEFORE_FILL = "#94a3b8";
const AFTER_FILL  = "#0f172a";

// ── Number formatting ──────────────────────────────────────────────────────
function fmt(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e6) return (value / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (value / 1e3).toFixed(1) + "k";
  if (abs >= 100)  return value.toFixed(0);
  if (abs >= 10)   return value.toFixed(Math.max(decimals, 1));
  return value.toFixed(Math.max(decimals, 2));
}

function fmtPctDelta(before: number, after: number): string {
  if (!Number.isFinite(before) || before === 0) return "—";
  const d = (after - before) / before;
  const sign = d >= 0 ? "+" : "−";
  return `${sign}${(Math.abs(d) * 100).toFixed(0)}%`;
}

// ── Hover tooltip primitive ────────────────────────────────────────────────

interface TipState {
  x: number;
  y: number;
  node: ReactNode;
}

/**
 * Container that lets a child SVG show a rich hover tooltip near the cursor.
 * Each bar / polygon vertex calls `setTip(...)` on mouse-enter / mouse-move
 * and `setTip(null)` on leave.  The tooltip floats above the chart with
 * pointer-events disabled so the user can keep moving the mouse.
 */
function ChartHoverable({
  render,
  height,
}: {
  render: (api: {
    setTip: (t: TipState | null) => void;
  }) => ReactNode;
  height: number;
}) {
  const [tip, setTip] = useState<TipState | null>(null);
  return (
    <div className="relative" style={{ width: CHART_INNER_W, height }}>
      {render({ setTip })}
      {tip && (
        <div
          className="absolute z-20 pointer-events-none bg-slate-900 text-white text-[10px] px-2 py-1.5 rounded-md shadow-lg whitespace-nowrap leading-snug"
          style={{
            left:  Math.min(Math.max(tip.x - 60, 4), CHART_INNER_W - 120),
            top:   Math.max(tip.y - 8, 0),
            transform: "translateY(-100%)",
          }}
        >
          {tip.node}
        </div>
      )}
    </div>
  );
}

// ── Per-basin compare bar chart (n>=2, measure not relevant) ───────────────

interface BarRow {
  id: number;
  name: string;
  color: string;
  value: number;
}

function ComparisonBarChart({
  indicator,
  rows,
}: {
  indicator: SubBasinIndicatorDef;
  rows: BarRow[];
}) {
  const innerW = CHART_INNER_W - PAD_L - PAD_R;
  const innerH = CHART_H - PAD_T - PAD_B;
  const baseline = SUB_BASIN_BASELINE_AVG[indicator.id];

  const observedMax = rows.reduce((m, r) => Math.max(m, r.value), 0);
  const yMax = Math.max(baseline * 1.5, observedMax * 1.1, baseline * 1.05, 1e-9);

  const n      = Math.max(1, rows.length);
  const slot   = innerW / n;
  const barW   = Math.max(4, Math.min(28, slot * 0.7));
  const barGap = slot - barW;

  const toY = (v: number) => PAD_T + innerH - (v / yMax) * innerH;
  const yBaseline = toY(baseline);

  return (
    <ChartHoverable
      height={CHART_H}
      render={({ setTip }) => (
        <svg width={CHART_INNER_W} height={CHART_H} className="overflow-visible block">
          {/* Y grid + tick labels */}
          {[
            { v: 0,        label: "0" },
            { v: baseline, label: fmt(baseline, indicator.decimals) },
            { v: yMax,     label: fmt(yMax, indicator.decimals) },
          ].map(({ v, label }) => {
            const y = toY(v);
            return (
              <g key={label}>
                <line x1={PAD_L} y1={y} x2={CHART_INNER_W - PAD_R} y2={y}
                  stroke="#e2e8f0" strokeWidth="0.6" />
                <text x={PAD_L - 4} y={y + 3} textAnchor="end"
                  fontSize="8" fill="#94a3b8" fontFamily="monospace">
                  {label}
                </text>
              </g>
            );
          })}

          {/* Baseline reference line */}
          <g>
            <line
              x1={PAD_L} y1={yBaseline} x2={CHART_INNER_W - PAD_R} y2={yBaseline}
              stroke={REF_COLOR} strokeWidth="1.2" strokeDasharray="4 3" opacity="0.85"
            />
            <text x={CHART_INNER_W - PAD_R} y={yBaseline - 3} textAnchor="end"
              fontSize="8" fill={REF_COLOR_DARK} fontFamily="monospace" fontWeight="600">
              avg {fmt(baseline, indicator.decimals)}
            </text>
          </g>

          {/* Bars */}
          {rows.map((r, i) => {
            const x = PAD_L + i * slot + barGap / 2;
            const y = toY(r.value);
            const h = (PAD_T + innerH) - y;
            const overBaseline = r.value > baseline;
            const delta = r.value - baseline;
            return (
              <g key={r.id}>
                <rect
                  x={x} y={y} width={barW} height={Math.max(0.5, h)}
                  fill={r.color}
                  stroke={overBaseline ? "#0f172a" : "transparent"}
                  strokeWidth={overBaseline ? 0.6 : 0}
                  rx="1.5"
                  onMouseEnter={() => setTip({
                    x: x + barW / 2,
                    y,
                    node: (
                      <div>
                        <div className="font-semibold mb-0.5">
                          <span className="font-mono opacity-70">#{r.id}</span> {r.name}
                        </div>
                        <div>{indicator.label}: <span className="font-mono">{fmt(r.value, indicator.decimals)} {indicator.unit}</span></div>
                        <div className="opacity-80 text-[9.5px]">
                          {delta >= 0 ? "+" : "−"}{fmt(Math.abs(delta), indicator.decimals)} vs avg
                        </div>
                      </div>
                    ),
                  })}
                  onMouseLeave={() => setTip(null)}
                  style={{ cursor: "pointer" }}
                />
                <text
                  x={x + barW / 2} y={PAD_T + innerH + 10}
                  textAnchor="middle" fontSize="8"
                  fill="#64748b" fontFamily="monospace"
                >
                  {r.id}
                </text>
              </g>
            );
          })}

          {/* Axis lines */}
          <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + innerH}
            stroke="#cbd5e1" strokeWidth="1" />
          <line x1={PAD_L} y1={PAD_T + innerH} x2={CHART_INNER_W - PAD_R} y2={PAD_T + innerH}
            stroke="#cbd5e1" strokeWidth="1" />
        </svg>
      )}
    />
  );
}

// ── Aggregate bar chart (single-bar OR before/after pair) ──────────────────

function AggregateBarChart({
  indicator,
  beforeValue,
  afterValue,
  expectedSum,
  measureLabel,
  hasMeasure,
  unit,
}: {
  indicator: SubBasinIndicatorDef;
  beforeValue: number;
  afterValue: number;
  /** "Expected sum if every selected basin were exactly regional-average". */
  expectedSum: number;
  measureLabel: string;
  hasMeasure: boolean;
  unit: string;
}) {
  const innerW = CHART_INNER_W - PAD_L - PAD_R;
  const innerH = CHART_H_AGG - PAD_T - PAD_B;

  const yMax = Math.max(beforeValue * 1.1, afterValue * 1.1, expectedSum * 1.2, 1e-9);
  const toY = (v: number) => PAD_T + innerH - (v / yMax) * innerH;
  const yExpected = toY(expectedSum);

  return (
    <ChartHoverable
      height={CHART_H_AGG}
      render={({ setTip }) => {
        if (!hasMeasure) {
          // Single sum bar with expected reference line
          const barW = Math.min(160, innerW * 0.55);
          const barX = PAD_L + (innerW - barW) / 2;
          const y    = toY(beforeValue);
          const h    = (PAD_T + innerH) - y;
          return (
            <svg width={CHART_INNER_W} height={CHART_H_AGG} className="overflow-visible block">
              {/* Y axis labels */}
              {[
                { v: 0,            label: "0" },
                { v: expectedSum,  label: fmt(expectedSum, indicator.decimals) },
                { v: yMax,         label: fmt(yMax, indicator.decimals) },
              ].map(({ v, label }) => {
                const yy = toY(v);
                return (
                  <g key={label}>
                    <line x1={PAD_L} y1={yy} x2={CHART_INNER_W - PAD_R} y2={yy}
                      stroke="#e2e8f0" strokeWidth="0.6" />
                    <text x={PAD_L - 4} y={yy + 3} textAnchor="end"
                      fontSize="8" fill="#94a3b8" fontFamily="monospace">
                      {label}
                    </text>
                  </g>
                );
              })}

              {/* Expected (baseline × scaling) reference */}
              <line
                x1={PAD_L} y1={yExpected} x2={CHART_INNER_W - PAD_R} y2={yExpected}
                stroke={REF_COLOR} strokeWidth="1.2" strokeDasharray="4 3" opacity="0.85"
              />
              <text x={CHART_INNER_W - PAD_R} y={yExpected - 3} textAnchor="end"
                fontSize="8" fill={REF_COLOR_DARK} fontFamily="monospace" fontWeight="600">
                expected {fmt(expectedSum, indicator.decimals)}
              </text>

              {/* Sum bar */}
              <rect
                x={barX} y={y} width={barW} height={Math.max(0.5, h)}
                fill={AFTER_FILL} rx="2"
                onMouseEnter={() => setTip({
                  x: barX + barW / 2,
                  y,
                  node: (
                    <div>
                      <div className="font-semibold mb-0.5">{indicator.label} · regional sum</div>
                      <div>Total: <span className="font-mono">{fmt(beforeValue, indicator.decimals)} {unit}</span></div>
                      <div className="opacity-80 text-[9.5px]">
                        Expected if avg: <span className="font-mono">{fmt(expectedSum, indicator.decimals)} {unit}</span>
                      </div>
                      <div className="opacity-80 text-[9.5px]">
                        Δ vs expected: <span className="font-mono">{fmtPctDelta(expectedSum, beforeValue)}</span>
                      </div>
                    </div>
                  ),
                })}
                onMouseLeave={() => setTip(null)}
                style={{ cursor: "pointer" }}
              />
              <text x={barX + barW / 2} y={y - 4} textAnchor="middle"
                fontSize="10" fill="#0f172a" fontFamily="monospace" fontWeight="700">
                {fmt(beforeValue, indicator.decimals)} {unit}
              </text>

              <text x={PAD_L + innerW / 2} y={PAD_T + innerH + 14} textAnchor="middle"
                fontSize="8" fill="#64748b">
                Total Regional Sum
              </text>

              {/* Axis lines */}
              <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + innerH}
                stroke="#cbd5e1" strokeWidth="1" />
              <line x1={PAD_L} y1={PAD_T + innerH} x2={CHART_INNER_W - PAD_R} y2={PAD_T + innerH}
                stroke="#cbd5e1" strokeWidth="1" />
            </svg>
          );
        }

        // Before / After paired bars
        const groupGap = 12;
        const barW = Math.min(70, (innerW - groupGap) / 2);
        const totalW = barW * 2 + groupGap;
        const x0 = PAD_L + (innerW - totalW) / 2;
        const xBefore = x0;
        const xAfter  = x0 + barW + groupGap;
        const yBefore = toY(beforeValue);
        const yAfter  = toY(afterValue);
        const hBefore = (PAD_T + innerH) - yBefore;
        const hAfter  = (PAD_T + innerH) - yAfter;
        const deltaPct = fmtPctDelta(beforeValue, afterValue);
        const isImprovement = (() => {
          // forestC / soilC: more is better.  N / P / waterFlow: less is better.
          const improvedByDecrease: SubBasinIndicatorId[] = ["nitrogen", "phosphorus", "waterFlow"];
          if (improvedByDecrease.includes(indicator.id)) return afterValue < beforeValue;
          return afterValue > beforeValue;
        })();

        return (
          <svg width={CHART_INNER_W} height={CHART_H_AGG} className="overflow-visible block">
            {/* Y axis labels */}
            {[
              { v: 0,    label: "0" },
              { v: yMax, label: fmt(yMax, indicator.decimals) },
            ].map(({ v, label }) => {
              const yy = toY(v);
              return (
                <g key={label}>
                  <line x1={PAD_L} y1={yy} x2={CHART_INNER_W - PAD_R} y2={yy}
                    stroke="#e2e8f0" strokeWidth="0.6" />
                  <text x={PAD_L - 4} y={yy + 3} textAnchor="end"
                    fontSize="8" fill="#94a3b8" fontFamily="monospace">
                    {label}
                  </text>
                </g>
              );
            })}

            {/* Before bar */}
            <rect
              x={xBefore} y={yBefore} width={barW} height={Math.max(0.5, hBefore)}
              fill={BEFORE_FILL} rx="2"
              onMouseEnter={() => setTip({
                x: xBefore + barW / 2,
                y: yBefore,
                node: (
                  <div>
                    <div className="font-semibold mb-0.5">{indicator.label} · Before</div>
                    <div>Baseline: <span className="font-mono">{fmt(beforeValue, indicator.decimals)} {unit}</span></div>
                    <div className="opacity-80 text-[9.5px]">No measure applied</div>
                  </div>
                ),
              })}
              onMouseLeave={() => setTip(null)}
              style={{ cursor: "pointer" }}
            />
            <text x={xBefore + barW / 2} y={yBefore - 4} textAnchor="middle"
              fontSize="9" fill="#475569" fontFamily="monospace">
              {fmt(beforeValue, indicator.decimals)}
            </text>
            <text x={xBefore + barW / 2} y={PAD_T + innerH + 12} textAnchor="middle"
              fontSize="8.5" fill="#64748b" fontWeight="600">
              Before
            </text>

            {/* After bar */}
            <rect
              x={xAfter} y={yAfter} width={barW} height={Math.max(0.5, hAfter)}
              fill={AFTER_FILL} rx="2"
              onMouseEnter={() => setTip({
                x: xAfter + barW / 2,
                y: yAfter,
                node: (
                  <div>
                    <div className="font-semibold mb-0.5">{indicator.label} · After</div>
                    <div>With {measureLabel}: <span className="font-mono">{fmt(afterValue, indicator.decimals)} {unit}</span></div>
                    <div className="opacity-80 text-[9.5px]">
                      Δ: <span className="font-mono">{deltaPct}</span> vs baseline
                    </div>
                  </div>
                ),
              })}
              onMouseLeave={() => setTip(null)}
              style={{ cursor: "pointer" }}
            />
            <text x={xAfter + barW / 2} y={yAfter - 4} textAnchor="middle"
              fontSize="9" fill="#0f172a" fontFamily="monospace" fontWeight="700">
              {fmt(afterValue, indicator.decimals)}
            </text>
            <text x={xAfter + barW / 2} y={PAD_T + innerH + 12} textAnchor="middle"
              fontSize="8.5" fill="#0f172a" fontWeight="600">
              After
            </text>

            {/* Delta badge */}
            <g>
              <rect
                x={CHART_INNER_W - PAD_R - 50} y={PAD_T - 1}
                width={50} height={14} rx="3"
                fill={isImprovement ? "#dcfce7" : "#fee2e2"}
                stroke={isImprovement ? "#22c55e" : "#ef4444"}
                strokeWidth="0.6"
              />
              <text
                x={CHART_INNER_W - PAD_R - 25} y={PAD_T + 9}
                textAnchor="middle" fontSize="9" fontWeight="700"
                fill={isImprovement ? "#15803d" : "#b91c1c"}
                fontFamily="monospace"
              >
                {deltaPct}
              </text>
            </g>

            {/* Axis lines */}
            <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + innerH}
              stroke="#cbd5e1" strokeWidth="1" />
            <line x1={PAD_L} y1={PAD_T + innerH} x2={CHART_INNER_W - PAD_R} y2={PAD_T + innerH}
              stroke="#cbd5e1" strokeWidth="1" />
          </svg>
        );
      }}
    />
  );
}

// ── Aggregate radar chart (sum of selected vs. baseline ring) ──────────────

function AggregateRadarChart({
  values,
  baseValues,
  expectedSums,
  hasMeasure,
  measureLabel,
  units,
}: {
  values:       Record<SubBasinIndicatorId, number>;
  baseValues:   Record<SubBasinIndicatorId, number>;
  expectedSums: Record<SubBasinIndicatorId, number>;
  hasMeasure:   boolean;
  measureLabel: string;
  units:        Record<SubBasinIndicatorId, string>;
}) {
  const W = RADAR_W;
  const H = RADAR_H;
  const cx = W / 2, cy = H / 2 + 4;
  const R  = 84;

  const N = SUB_BASIN_INDICATORS.length;
  const angleFor = (i: number) => -Math.PI / 2 + (i / N) * Math.PI * 2;

  // Each axis normalised to its own expected sum (= baseline avg × scaling).
  // baseline ring sits at 1.0; outer ring at 1.5 so above-avg basins fit.
  const BASELINE_FRAC = 1.0;
  const MAX_FRAC      = 1.5;

  const point = (frac: number, i: number) => {
    const r = (Math.min(MAX_FRAC, Math.max(0, frac)) / MAX_FRAC) * R;
    const a = angleFor(i);
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  };

  const fracOf = (id: SubBasinIndicatorId, v: number) => {
    const exp = expectedSums[id];
    if (!exp || !Number.isFinite(exp)) return 0;
    return v / exp;
  };

  const beforePts = SUB_BASIN_INDICATORS.map((ind, i) =>
    point(fracOf(ind.id, baseValues[ind.id]), i),
  );
  const afterPts  = SUB_BASIN_INDICATORS.map((ind, i) =>
    point(fracOf(ind.id, values[ind.id]), i),
  );

  const beforePath = beforePts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const afterPath  = afterPts .map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const baselineRingR = (BASELINE_FRAC / MAX_FRAC) * R;

  return (
    <ChartHoverable
      height={RADAR_H}
      render={({ setTip }) => (
        <svg width={W} height={H} className="block">
          {/* Concentric rings */}
          {[0.25, 0.5, 0.75, 1.25, 1.5].map(f => (
            <circle key={f} cx={cx} cy={cy} r={(f / MAX_FRAC) * R}
              fill="none" stroke="#e2e8f0" strokeWidth="0.6" />
          ))}
          {/* Baseline reference ring */}
          <circle cx={cx} cy={cy} r={baselineRingR}
            fill="none" stroke={REF_COLOR} strokeWidth="1.1"
            strokeDasharray="3 2" opacity="0.7" />

          {/* Axes + labels */}
          {SUB_BASIN_INDICATORS.map((ind, i) => {
            const outer = point(MAX_FRAC, i);
            const labelR = R + 14;
            const a = angleFor(i);
            const lx = cx + Math.cos(a) * labelR;
            const ly = cy + Math.sin(a) * labelR;
            return (
              <g key={ind.id}>
                <line x1={cx} y1={cy} x2={outer.x} y2={outer.y}
                  stroke="#cbd5e1" strokeWidth="0.5" />
                <text
                  x={lx} y={ly}
                  textAnchor={Math.abs(Math.cos(a)) < 0.2 ? "middle" : (Math.cos(a) > 0 ? "start" : "end")}
                  dominantBaseline={Math.abs(Math.sin(a)) < 0.3 ? "middle" : (Math.sin(a) > 0 ? "hanging" : "auto")}
                  fontSize="8.5" fill="#334155" fontWeight="600"
                >
                  {ind.shortLabel}
                </text>
              </g>
            );
          })}

          {/* Before polygon (light, only when measure active) */}
          {hasMeasure && (
            <polygon points={beforePath}
              fill={BEFORE_FILL} fillOpacity="0.18"
              stroke={BEFORE_FILL} strokeWidth="1.2"
              strokeDasharray="3 2"
              strokeLinejoin="round" />
          )}

          {/* Main polygon (current values; dark in measure mode, primary otherwise) */}
          <polygon
            points={afterPath}
            fill={hasMeasure ? AFTER_FILL : "#3b82f6"} fillOpacity="0.22"
            stroke={hasMeasure ? AFTER_FILL : "#3b82f6"} strokeWidth="1.6"
            strokeLinejoin="round"
          />

          {/* Vertices (hoverable) on the After polygon */}
          {SUB_BASIN_INDICATORS.map((ind, i) => {
            const p = afterPts[i];
            return (
              <circle
                key={ind.id} cx={p.x} cy={p.y} r="3.2"
                fill={hasMeasure ? AFTER_FILL : "#3b82f6"}
                stroke="white" strokeWidth="1.2"
                onMouseEnter={() => setTip({
                  x: p.x,
                  y: p.y,
                  node: (
                    <div>
                      <div className="font-semibold mb-0.5">{ind.label}</div>
                      {hasMeasure ? (
                        <>
                          <div>Before: <span className="font-mono">{fmt(baseValues[ind.id], ind.decimals)} {units[ind.id]}</span></div>
                          <div>After:  <span className="font-mono">{fmt(values[ind.id], ind.decimals)} {units[ind.id]}</span></div>
                          <div className="opacity-80 text-[9.5px]">
                            Δ: {fmtPctDelta(baseValues[ind.id], values[ind.id])} ({measureLabel})
                          </div>
                        </>
                      ) : (
                        <>
                          <div>Sum: <span className="font-mono">{fmt(values[ind.id], ind.decimals)} {units[ind.id]}</span></div>
                          <div className="opacity-80 text-[9.5px]">
                            Expected: {fmt(expectedSums[ind.id], ind.decimals)} {units[ind.id]}
                          </div>
                          <div className="opacity-80 text-[9.5px]">
                            Δ vs expected: {fmtPctDelta(expectedSums[ind.id], values[ind.id])}
                          </div>
                        </>
                      )}
                    </div>
                  ),
                })}
                onMouseLeave={() => setTip(null)}
                style={{ cursor: "pointer" }}
              />
            );
          })}

          {/* Legend */}
          <g transform={`translate(${cx - 70}, ${H - 18})`}>
            <circle cx="6" cy="6" r="3.5" fill={REF_COLOR} opacity="0.7" />
            <text x="14" y="9" fontSize="8.5" fill="#334155">Avg of 25 (baseline ring)</text>
          </g>
        </svg>
      )}
    />
  );
}

// ── Single-basin radar (n=1, baseline-avg reference ring) ──────────────────

function SingleBasinRadar({ basin, color }: { basin: SubBasinMeta; color: string }) {
  const W = RADAR_W;
  const H = RADAR_H;
  const cx = W / 2, cy = H / 2 + 4;
  const R  = 78;

  const N = SUB_BASIN_INDICATORS.length;
  const angleFor = (i: number) => -Math.PI / 2 + (i / N) * Math.PI * 2;

  // Each axis normalised to its own baseline avg (so the regional-avg basin
  // would land exactly on the dashed ring).  Outer ring at 1.5×.
  const BASELINE_FRAC = 1.0;
  const MAX_FRAC      = 1.5;

  const point = (frac: number, i: number) => {
    const r = (Math.min(MAX_FRAC, Math.max(0, frac)) / MAX_FRAC) * R;
    const a = angleFor(i);
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  };

  const basinPts = SUB_BASIN_INDICATORS.map((ind, i) => {
    const v = basin.indicators[ind.id];
    const baseline = SUB_BASIN_BASELINE_AVG[ind.id];
    return point(baseline > 0 ? v / baseline : 0, i);
  });
  const basinPath = basinPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const baselineRingR = (BASELINE_FRAC / MAX_FRAC) * R;

  return (
    <ChartHoverable
      height={RADAR_H}
      render={({ setTip }) => (
        <svg width={W} height={H} className="block">
          {[0.25, 0.5, 0.75, 1.25, 1.5].map(f => (
            <circle key={f} cx={cx} cy={cy} r={(f / MAX_FRAC) * R}
              fill="none" stroke="#e2e8f0" strokeWidth="0.6" />
          ))}
          {/* Baseline reference ring */}
          <circle cx={cx} cy={cy} r={baselineRingR}
            fill="none" stroke={REF_COLOR} strokeWidth="1.1"
            strokeDasharray="3 2" opacity="0.7" />

          {/* Axes + labels */}
          {SUB_BASIN_INDICATORS.map((ind, i) => {
            const outer = point(MAX_FRAC, i);
            const labelR = R + 14;
            const a = angleFor(i);
            const lx = cx + Math.cos(a) * labelR;
            const ly = cy + Math.sin(a) * labelR;
            const v  = basin.indicators[ind.id];
            return (
              <g key={ind.id}>
                <line x1={cx} y1={cy} x2={outer.x} y2={outer.y}
                  stroke="#cbd5e1" strokeWidth="0.5" />
                <text
                  x={lx} y={ly}
                  textAnchor={Math.abs(Math.cos(a)) < 0.2 ? "middle" : (Math.cos(a) > 0 ? "start" : "end")}
                  dominantBaseline={Math.abs(Math.sin(a)) < 0.3 ? "middle" : (Math.sin(a) > 0 ? "hanging" : "auto")}
                  fontSize="8.5" fill="#334155" fontWeight="600"
                >
                  {ind.shortLabel}
                </text>
                <text
                  x={lx} y={ly + (Math.sin(a) >= 0 ? 11 : -11)}
                  textAnchor={Math.abs(Math.cos(a)) < 0.2 ? "middle" : (Math.cos(a) > 0 ? "start" : "end")}
                  dominantBaseline={Math.abs(Math.sin(a)) < 0.3 ? "middle" : (Math.sin(a) > 0 ? "hanging" : "auto")}
                  fontSize="7.5" fill="#64748b" fontFamily="monospace"
                >
                  {fmt(v, ind.decimals)} {ind.unit}
                </text>
              </g>
            );
          })}

          {/* Basin polygon */}
          <polygon points={basinPath} fill={color} fillOpacity="0.28"
            stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
          {basinPts.map((p, i) => {
            const ind = SUB_BASIN_INDICATORS[i];
            const v = basin.indicators[ind.id];
            const baseline = SUB_BASIN_BASELINE_AVG[ind.id];
            return (
              <circle
                key={i} cx={p.x} cy={p.y} r="3" fill={color}
                stroke="white" strokeWidth="1.1"
                onMouseEnter={() => setTip({
                  x: p.x,
                  y: p.y,
                  node: (
                    <div>
                      <div className="font-semibold mb-0.5">{ind.label}</div>
                      <div>This basin: <span className="font-mono">{fmt(v, ind.decimals)} {ind.unit}</span></div>
                      <div className="opacity-80 text-[9.5px]">
                        Avg of 25: <span className="font-mono">{fmt(baseline, ind.decimals)} {ind.unit}</span>
                      </div>
                      <div className="opacity-80 text-[9.5px]">
                        Δ vs avg: {fmtPctDelta(baseline, v)}
                      </div>
                    </div>
                  ),
                })}
                onMouseLeave={() => setTip(null)}
                style={{ cursor: "pointer" }}
              />
            );
          })}

          {/* Legend */}
          <g transform={`translate(${cx - 70}, ${H - 18})`}>
            <circle cx="6" cy="6" r="3.5" fill={REF_COLOR} opacity="0.7" />
            <text x="14" y="9" fontSize="8.5" fill="#334155">Avg of 25 (baseline ring)</text>
          </g>
        </svg>
      )}
    />
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────

interface Props {
  selectedIds: number[];
  colorFor:    (id: number) => string;
  aggregate:   boolean;
  measureId:   SubBasinMeasureId;
  aggregateView: "bars" | "radar";
  onSetAggregate:    (v: boolean) => void;
  onSetMeasure:      (id: SubBasinMeasureId) => void;
  onSetAggregateView:(v: "bars" | "radar") => void;
  onRemove:          (id: number) => void;
  onClear:           () => void;
  onSelectAll:       () => void;
  onSelectAllDeselect: () => void;
}

export default function SubBasinComparisonPanel({
  selectedIds,
  colorFor,
  aggregate,
  measureId,
  aggregateView,
  onSetAggregate,
  onSetMeasure,
  onSetAggregateView,
  onRemove,
  onClear,
  onSelectAll,
  onSelectAllDeselect,
}: Props) {
  const basins = useMemo(
    () => selectedIds.map(getSubBasin).filter((b): b is SubBasinMeta => !!b),
    [selectedIds],
  );
  const totalArea = useMemo(
    () => basins.reduce((s, b) => s + b.area_ha, 0),
    [basins],
  );
  const measure = useMemo(() => getSubBasinMeasure(measureId), [measureId]);
  const hasMeasure = measureId !== "none";

  const aggResult = useMemo(
    () => aggregateSubBasins(selectedIds, measureId),
    [selectedIds, measureId],
  );

  // Expected sum per indicator = baseline_avg × scaling factor.
  //   per-area densities ⇒ × totalArea
  //   additive (waterFlow) ⇒ × N basins
  const expectedSums = useMemo(() => {
    const out: Record<SubBasinIndicatorId, number> = { forestC: 0, soilC: 0, nitrogen: 0, phosphorus: 0, waterFlow: 0 };
    for (const ind of SUB_BASIN_INDICATORS) {
      const baseline = SUB_BASIN_BASELINE_AVG[ind.id];
      out[ind.id] = ind.additive
        ? baseline * basins.length
        : baseline * totalArea;
    }
    return out;
  }, [basins.length, totalArea]);

  const units = useMemo(() => {
    const u: Record<SubBasinIndicatorId, string> = { forestC: "", soilC: "", nitrogen: "", phosphorus: "", waterFlow: "" };
    for (const ind of SUB_BASIN_INDICATORS) u[ind.id] = ind.totalUnit;
    return u;
  }, []);

  const allSelected = selectedIds.length === SUB_BASIN_META.length;
  const isComparing = selectedIds.length >= 2;
  const isSingle    = selectedIds.length === 1;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-border flex-shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Layers size={14} className="text-primary" />
            Sub-basin Compare
          </h2>
          <span className="text-[10px] text-muted-foreground">
            {selectedIds.length} of {SUB_BASIN_META.length} selected
          </span>
        </div>
        {selectedIds.length > 0 && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Combined area · <span className="font-mono text-foreground">{totalArea.toLocaleString()}</span> ha
          </p>
        )}
      </div>

      {/* Action toolbar */}
      <div className="px-4 py-2.5 border-b border-border flex-shrink-0 flex items-center gap-1.5 flex-wrap">
        <button
          onClick={allSelected ? onSelectAllDeselect : onSelectAll}
          className="text-[10.5px] px-2 py-1 rounded bg-muted/60 text-foreground hover:bg-muted border border-border cursor-pointer"
          title={allSelected ? "Clear all 25" : "Select all 25 sub-basins"}
        >
          {allSelected ? "Deselect all" : "Select all 25"}
        </button>
        {selectedIds.length > 0 && !allSelected && (
          <button
            onClick={onClear}
            className="text-[10.5px] px-2 py-1 rounded bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground border border-border cursor-pointer"
          >
            Clear
          </button>
        )}
        {isComparing && (
          <button
            onClick={() => onSetAggregate(!aggregate)}
            className={[
              "ml-auto text-[10.5px] px-2.5 py-1 rounded cursor-pointer border flex items-center gap-1 transition-colors",
              aggregate
                ? "bg-primary text-white border-primary hover:bg-primary/90"
                : "bg-white text-primary border-primary/40 hover:bg-primary/5",
            ].join(" ")}
            title="Toggle between per-basin comparison and Total Regional Sum"
          >
            {aggregate ? <Sigma size={11} /> : <BarChart3 size={11} />}
            {aggregate ? "Aggregate ON" : "Aggregate"}
          </button>
        )}
      </div>

      {/* Aggregate-only sub-toolbar (measure + chart-type toggle) */}
      {isComparing && aggregate && (
        <div className="px-4 py-2.5 border-b border-border flex-shrink-0 space-y-2 bg-slate-50/60">
          {/* Chart type toggle */}
          <div className="flex items-center gap-1">
            <span className="text-[9.5px] uppercase tracking-wide text-muted-foreground font-semibold mr-1">
              View
            </span>
            <button
              onClick={() => onSetAggregateView("bars")}
              className={[
                "text-[10.5px] px-2 py-1 rounded border flex items-center gap-1 cursor-pointer",
                aggregateView === "bars"
                  ? "bg-foreground text-white border-foreground"
                  : "bg-white text-foreground border-border hover:bg-muted",
              ].join(" ")}
            >
              <BarChart3 size={11} /> Bars
            </button>
            <button
              onClick={() => onSetAggregateView("radar")}
              className={[
                "text-[10.5px] px-2 py-1 rounded border flex items-center gap-1 cursor-pointer",
                aggregateView === "radar"
                  ? "bg-foreground text-white border-foreground"
                  : "bg-white text-foreground border-border hover:bg-muted",
              ].join(" ")}
            >
              <Hexagon size={11} /> Radar
            </button>
          </div>

          {/* Measure dropdown */}
          <div>
            <label className="text-[9.5px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1 mb-1">
              <Sparkles size={10} /> Decarbonization measure
              <span className="text-[8.5px] font-normal text-muted-foreground/70 normal-case tracking-normal">
                (simulated)
              </span>
            </label>
            <select
              value={measureId}
              onChange={e => onSetMeasure(e.target.value as SubBasinMeasureId)}
              className="w-full text-[11px] py-1 px-2 rounded border border-border bg-white text-foreground cursor-pointer"
            >
              {SUB_BASIN_MEASURES.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            {hasMeasure && (
              <p className="text-[9.5px] text-muted-foreground mt-1 leading-snug flex items-start gap-1">
                <Info size={9} className="mt-0.5 flex-shrink-0" />
                <span>{measure.description}</span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Selection chips */}
      {selectedIds.length > 0 && (
        <div className="px-4 py-2 border-b border-border flex-shrink-0">
          <div className="flex flex-wrap gap-1">
            {basins.map(b => (
              <span
                key={b.id}
                className="inline-flex items-center gap-1 text-[10px] pl-1.5 pr-1 py-0.5 rounded bg-muted/40 border border-border"
              >
                <span className="w-2 h-2 rounded-sm" style={{ background: colorFor(b.id) }} />
                <span className="font-mono text-foreground/80">{b.id}</span>
                <span className="text-foreground/70 truncate max-w-[80px]">{b.name}</span>
                <button
                  onClick={() => onRemove(b.id)}
                  className="ml-0.5 w-3.5 h-3.5 rounded-sm flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                  title={`Deselect ${b.name}`}
                >
                  <X size={9} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {selectedIds.length === 0 && <EmptyState />}

        {isSingle && basins[0] && (
          <SingleBasinDetail basin={basins[0]} color={colorFor(basins[0].id)} />
        )}

        {isComparing && (
          <div className="px-3 py-3 space-y-3">
            {/* Mode banner */}
            <div className={[
              "rounded-md border px-2.5 py-1.5 text-[10.5px] flex items-center gap-1.5",
              aggregate
                ? hasMeasure
                  ? "bg-amber-50 border-amber-300 text-amber-900"
                  : "bg-primary/8 border-primary/25 text-primary"
                : "bg-muted/40 border-border text-muted-foreground",
            ].join(" ")}>
              {aggregate
                ? hasMeasure
                  ? <Sparkles size={11} />
                  : <Sigma size={11} />
                : <BarChart3 size={11} />}
              {!aggregate && `Comparing ${selectedIds.length} sub-basins side-by-side`}
              {aggregate && !hasMeasure &&
                `Regional sum across ${selectedIds.length} sub-basins (${totalArea.toLocaleString()} ha)`}
              {aggregate && hasMeasure &&
                `Scenario: ${measure.shortLabel} on ${selectedIds.length} sub-basins — Before vs After`}
            </div>

            {/* Per-basin compare: 5 stacked vertical bar cards (no measure) */}
            {!aggregate && SUB_BASIN_INDICATORS.map(ind => {
              const rows: BarRow[] = basins.map(b => ({
                id: b.id,
                name: b.name,
                color: colorFor(b.id),
                value: b.indicators[ind.id],
              }));
              return (
                <ChartCard key={ind.id} indicator={ind} aggregate={false}>
                  <ComparisonBarChart indicator={ind} rows={rows} />
                </ChartCard>
              );
            })}

            {/* Aggregate · bars view */}
            {aggregate && aggregateView === "bars" && SUB_BASIN_INDICATORS.map(ind => (
              <ChartCard key={ind.id} indicator={ind} aggregate={true}>
                <AggregateBarChart
                  indicator={ind}
                  beforeValue={aggResult.baseValues[ind.id]}
                  afterValue={aggResult.values[ind.id]}
                  expectedSum={expectedSums[ind.id]}
                  measureLabel={measure.shortLabel}
                  hasMeasure={hasMeasure}
                  unit={ind.totalUnit}
                />
              </ChartCard>
            ))}

            {/* Aggregate · radar view */}
            {aggregate && aggregateView === "radar" && (
              <div className="bg-white border border-border rounded-md p-2.5">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-[11px] font-semibold text-foreground">
                    Regional fingerprint
                  </span>
                  <span className="text-[9px] text-muted-foreground">
                    sum normalised to baseline
                  </span>
                </div>
                <AggregateRadarChart
                  values={aggResult.values}
                  baseValues={aggResult.baseValues}
                  expectedSums={expectedSums}
                  hasMeasure={hasMeasure}
                  measureLabel={measure.shortLabel}
                  units={units}
                />
                {hasMeasure && (
                  <div className="flex items-center gap-3 px-2 pt-1 text-[9.5px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-1 rounded-sm" style={{ background: BEFORE_FILL, opacity: 0.5 }} />
                      Before
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-1 rounded-sm" style={{ background: AFTER_FILL }} />
                      After ({measure.shortLabel})
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function ChartCard({
  indicator, aggregate, children,
}: {
  indicator: SubBasinIndicatorDef;
  aggregate: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-border rounded-md p-2.5">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[11px] font-semibold text-foreground">
          {indicator.label}
        </span>
        <span className="text-[9px] text-muted-foreground font-mono">
          {aggregate ? indicator.totalUnit : indicator.unit}
        </span>
      </div>
      {children}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="px-6 py-10 text-center">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-muted/50 border border-border flex items-center justify-center">
        <Layers size={18} className="text-muted-foreground" />
      </div>
      <p className="text-xs font-semibold text-foreground mb-1">
        No sub-basins selected
      </p>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Click any sub-basin polygon on the map to start.
        Pick <span className="font-medium text-foreground">2 or more</span> to compare them
        side-by-side, or use <span className="font-medium text-foreground">Select all 25</span>
        for a regional view.
      </p>
    </div>
  );
}

function SingleBasinDetail({ basin, color }: { basin: SubBasinMeta; color: string }) {
  // Show the basin's own indicator values + a baseline-avg row for context.
  const rows = SUB_BASIN_INDICATORS.map(ind => ({
    ind,
    value: basin.indicators[ind.id],
    baseline: SUB_BASIN_BASELINE_AVG[ind.id],
  }));
  return (
    <div className="px-4 py-4">
      {/* Identification card */}
      <div className="bg-muted/40 rounded-lg p-3 mb-3 border border-border/60">
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border"
            style={{ background: color + "22", borderColor: color }}
          >
            <MapPin size={14} style={{ color }} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground truncate">{basin.name}</div>
            <div className="text-[10px] text-muted-foreground font-mono">Sub-basin {basin.id}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-y-1 gap-x-3 text-[10.5px] mt-2 pt-2 border-t border-border/60">
          <PropMini icon={<TreePine size={10} />} label="Land use"
            value={LAND_USE_LABEL[basin.landUse]} />
          <PropMini icon={<Mountain size={10} />} label="Elevation"
            value={`${basin.elevation} m`} />
          <PropMini icon={<MapPin size={10} />} label="Area"
            value={`${basin.area_ha.toLocaleString()} ha`} />
        </div>
      </div>

      {/* Radar */}
      <div className="bg-white border border-border rounded-md p-2.5">
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-[11px] font-semibold text-foreground">
            Indicator profile
          </span>
          <span className="text-[9px] text-muted-foreground">
            vs avg of 25 (ring = 1.0)
          </span>
        </div>
        <SingleBasinRadar basin={basin} color={color} />
      </div>

      {/* Compact value vs baseline table */}
      <div className="mt-3 bg-white border border-border rounded-md p-2.5">
        <div className="text-[10.5px] font-semibold text-foreground mb-1.5">
          Indicator values vs regional avg
        </div>
        <div className="space-y-1">
          {rows.map(({ ind, value, baseline }) => {
            const delta = baseline > 0 ? (value - baseline) / baseline : 0;
            const positive = delta >= 0;
            return (
              <div key={ind.id} className="flex items-center text-[10.5px] gap-2">
                <span className="text-foreground/80 flex-1 truncate">{ind.shortLabel}</span>
                <span className="font-mono text-foreground tabular-nums">{fmt(value, ind.decimals)}</span>
                <span className="text-muted-foreground text-[9.5px]">/ {fmt(baseline, ind.decimals)}</span>
                <span
                  className={[
                    "text-[9.5px] font-mono w-10 text-right",
                    positive ? "text-emerald-700" : "text-rose-700",
                  ].join(" ")}
                >
                  {positive ? "+" : "−"}{(Math.abs(delta) * 100).toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed mt-3 px-1">
        Pick a second sub-basin to switch to side-by-side comparison.
      </p>
    </div>
  );
}

function PropMini({
  icon, label, value,
}: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground">{label}:</span>
      <span className="text-foreground font-medium truncate">{value}</span>
    </div>
  );
}
