import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import {
  X, Layers, BarChart3, Sigma, MapPin, Mountain, TreePine,
  Hexagon, Sparkles, Info, Columns3,
} from "lucide-react";
import {
  SUB_BASIN_INDICATORS,
  SUB_BASIN_META,
  isPixelId,
  pixelIdToLetter,
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
const RADAR_H = 280;

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

// ── Reusable explainer for the "1.0× = baseline" reference ────────────────
//
// "Baseline" = the fixed arithmetic mean of each indicator across all 25
// sub-basins (`SUB_BASIN_BASELINE_AVG`).  Doesn't change with selection.
// Same chart family (radar + combined bars) on both aggregate and compare
// tabs uses this badge so the meaning of the dashed ring / 1.0 gridline is
// consistent and discoverable.  Hovering surfaces the full explanation;
// the visible pill makes the convention obvious at a glance.
const BASELINE_HINT_TEXT =
  "Baseline = arithmetic mean of each indicator across all 25 sub-basins. " +
  "1.0× equals the baseline. Above 1.0× = above baseline; " +
  "below 1.0× = below baseline.";

function BaselineBadge() {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[9.5px] font-medium text-sky-700 bg-sky-50 border border-sky-200/80 px-1.5 py-0.5 rounded cursor-help"
      title={BASELINE_HINT_TEXT}
      aria-label={BASELINE_HINT_TEXT}
    >
      <Info size={9} />
      1.0× = baseline (avg of 25 sub-basins)
    </span>
  );
}

// ── Reusable indicator breakdown table (value vs baseline) ────────────────
//
// Used by the aggregate radar AND the aggregate combined bars view so the
// two chart types of the same data show an identical companion table.
/** Per-basin value-vs-baseline breakdown shown beneath the per-basin
 *  compare radar.  Mirrors the single-basin and aggregate breakdown cards
 *  but lists every selected basin in its own colour-keyed section. */
function PerBasinBreakdownList({
  basins, colorFor,
}: {
  basins:   SubBasinMeta[];
  colorFor: (id: number) => string;
}) {
  return (
    <div className="bg-white border border-border rounded-md p-2.5">
      <div className="text-[10.5px] font-semibold text-foreground mb-1.5">
        Per-indicator breakdown vs baseline
      </div>
      <div className="space-y-2.5">
        {SUB_BASIN_INDICATORS.map((ind, iIdx) => {
          const baseline = SUB_BASIN_BASELINE_AVG[ind.id];
          // Preserve the order in which basins were selected (no ranking) so
          // the same basin sits in the same row across every indicator block.
          const ordered = basins;
          // Selection-average: simple arithmetic mean across the picked basins.
          // For per-ha indicators this is the mean per-ha value; for waterFlow
          // (m³/s) it's the mean flow.  Sums are intentionally NOT shown — the
          // sum of per-ha values isn't a meaningful quantity (use Aggregate
          // mode for area-weighted absolute totals).
          const selAvg = ordered.length > 0
            ? ordered.reduce((s, b) => s + b.indicators[ind.id], 0) / ordered.length
            : 0;
          const selDelta    = baseline > 0 ? (selAvg - baseline) / baseline : 0;
          const selPositive = selDelta >= 0;
          return (
            <div
              key={ind.id}
              className={[
                "space-y-1",
                iIdx > 0 ? "pt-2 border-t border-border/60" : "",
              ].join(" ")}
            >
              <div className="flex items-baseline gap-2 text-[10.5px]">
                <span className="font-medium text-foreground">{ind.shortLabel}</span>
                <span className="text-[9.5px] text-muted-foreground">
                  baseline {fmt(baseline, ind.decimals)} {ind.unit}
                </span>
              </div>
              {ordered.map(b => {
                const value    = b.indicators[ind.id];
                const delta    = baseline > 0 ? (value - baseline) / baseline : 0;
                const positive = delta >= 0;
                return (
                  <div key={b.id} className="flex items-center text-[10.5px] gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                      style={{ background: colorFor(b.id) }}
                    />
                    <span className="text-foreground/80 flex-1 truncate">{b.name}</span>
                    <span className="font-mono text-foreground tabular-nums">
                      {fmt(value, ind.decimals)}
                    </span>
                    <span
                      className={[
                        "text-[9.5px] font-mono w-12 text-right",
                        positive ? "text-emerald-700" : "text-rose-700",
                      ].join(" ")}
                    >
                      {positive ? "+" : "−"}{(Math.abs(delta) * 100).toFixed(0)}%
                    </span>
                  </div>
                );
              })}
              {/* Selection average row — mean across the picked basins,
                  visually demoted (italic + muted) so it doesn't compete
                  with the per-basin rows. */}
              {ordered.length > 1 && (
                <div className="flex items-center text-[10.5px] gap-2 pt-0.5 mt-0.5 border-t border-border/40">
                  <span className="w-2.5 h-2.5 flex-shrink-0" aria-hidden />
                  <span className="text-muted-foreground italic flex-1 truncate">
                    Selection avg
                  </span>
                  <span className="font-mono text-foreground tabular-nums">
                    {fmt(selAvg, ind.decimals)}
                  </span>
                  <span
                    className={[
                      "text-[9.5px] font-mono w-12 text-right",
                      selPositive ? "text-emerald-700" : "text-rose-700",
                    ].join(" ")}
                  >
                    {selPositive ? "+" : "−"}{(Math.abs(selDelta) * 100).toFixed(0)}%
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[9.5px] text-muted-foreground leading-relaxed mt-2 pt-1.5 border-t border-border/60">
        Per-hectare values vs baseline (avg of all 25 sub-basins);
        basins listed in selection order. Selection avg = simple arithmetic
        mean across the picked basins. (For area-weighted absolute totals,
        switch to Aggregate mode.)
      </p>
    </div>
  );
}

function IndicatorBreakdownTable({
  values,
  baseValues,
  expectedSums,
  units,
  hasMeasure,
  measureLabel,
}: {
  values:       Record<SubBasinIndicatorId, number>;
  baseValues:   Record<SubBasinIndicatorId, number>;
  expectedSums: Record<SubBasinIndicatorId, number>;
  units:        Record<SubBasinIndicatorId, string>;
  hasMeasure:   boolean;
  measureLabel: string;
}) {
  return (
    <div className="bg-white border border-border rounded-md p-2.5">
      <div className="flex items-baseline justify-between mb-1.5">
        <div className="text-[10.5px] font-semibold text-foreground">
          {hasMeasure
            ? `Indicator values · Before vs After (${measureLabel})`
            : "Indicator values vs baseline"}
        </div>
        {hasMeasure && (
          <div className="flex items-center gap-2 text-[8.5px] text-muted-foreground font-medium uppercase tracking-wide">
            <span className="w-14 text-right">Before</span>
            <span className="w-14 text-right">After</span>
            <span className="w-12 text-right">Δ</span>
          </div>
        )}
      </div>
      <div className="space-y-1">
        {SUB_BASIN_INDICATORS.map(ind => {
          const after    = values[ind.id];
          const before   = baseValues[ind.id];
          const expected = expectedSums[ind.id];
          if (hasMeasure) {
            // Before / After / Δ vs Before columns.
            const measureDelta = before > 0 ? (after - before) / before : 0;
            const positive = measureDelta >= 0;
            const flat     = Math.abs(measureDelta) < 5e-4;
            return (
              <div key={ind.id} className="flex items-center text-[10.5px] gap-2">
                <span className="text-foreground/80 flex-1 truncate">{ind.shortLabel}</span>
                <span className="font-mono text-muted-foreground tabular-nums w-14 text-right">
                  {fmt(before, ind.decimals)}
                </span>
                <span className="font-mono text-foreground tabular-nums w-14 text-right">
                  {fmt(after, ind.decimals)}
                </span>
                <span
                  className={[
                    "text-[9.5px] font-mono w-12 text-right",
                    flat ? "text-muted-foreground" : positive ? "text-emerald-700" : "text-rose-700",
                  ].join(" ")}
                >
                  {flat ? "—" : `${positive ? "+" : "−"}${(Math.abs(measureDelta) * 100).toFixed(0)}%`}
                </span>
              </div>
            );
          }
          // No measure: single value vs baseline.
          const delta    = expected > 0 ? (after - expected) / expected : 0;
          const positive = delta >= 0;
          return (
            <div key={ind.id} className="flex items-center text-[10.5px] gap-2">
              <span className="text-foreground/80 flex-1 truncate">{ind.shortLabel}</span>
              <span className="font-mono text-foreground tabular-nums">
                {fmt(after, ind.decimals)}
              </span>
              <span className="text-muted-foreground text-[9.5px]">
                / {fmt(expected, ind.decimals)} {units[ind.id]}
              </span>
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
      <p className="text-[9.5px] text-muted-foreground leading-relaxed mt-2 pt-1.5 border-t border-border/60">
        {hasMeasure
          ? `Δ shows change from current selection sum to sum after ${measureLabel} is applied to all basins. Units: ${SUB_BASIN_INDICATORS.map(i => units[i.id]).join(", ")}.`
          : "Selection sum vs baseline sum (per-ha baseline × area, or per-basin baseline × N)."}
      </p>
    </div>
  );
}

// ── Radar axis-hover system (shared across all 3 radar variants) ──────────
//
// Hovering inside a 72° axis wedge opens a popover that lists every series'
// value on that axis, sorted descending by raw value, with swatch + label +
// value/unit + ±Δ% vs baseline.  Same component used on single-basin,
// per-basin compare, and aggregate radars so the interaction model
// is identical.  Replaces the per-vertex dot tooltip (which doesn't scale
// past ~3 basins because of overlapping vertices).

export interface RadarPopoverRow {
  label:     string;
  color:     string;
  value:     number;
  formatted: string;
  unit:      string;
  /** Signed fraction (e.g. 0.42 = +42%). Hides the ± column when undefined. */
  deltaPct?: number;
  /** Bold + tinted background (selection/header rows). */
  emphasis?: boolean;
}

/** Shared hover-state hook for all 3 radar variants: tracks the active axis
 *  and provides mouse handlers for a transparent hit-area `<rect>`.  Keeps
 *  the wedge-detection logic in one place so Single/Multi/Aggregate radars
 *  all behave identically. */
function useRadarAxisHover(cx: number, cy: number, R: number, N: number) {
  const [activeAxis, setActiveAxis] = useState<number | null>(null);
  const onMouseMove = (e: MouseEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt  = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const { x, y } = pt.matrixTransform(ctm.inverse());
    setActiveAxis(axisIndexFromPoint(x, y, cx, cy, R, N));
  };
  const onMouseLeave = () => setActiveAxis(null);
  return { activeAxis, onMouseMove, onMouseLeave };
}

/** Map a cursor position (in svg coords) to the nearest axis index, or null
 *  when outside the chart disk (with a small tolerance for label area). */
function axisIndexFromPoint(
  px: number, py: number,
  cx: number, cy: number,
  R: number, N: number,
): number | null {
  const dx = px - cx, dy = py - cy;
  const dist = Math.hypot(dx, dy);
  if (dist > R + 18) return null;
  // atan2 returns 0 = +x. Shift so 0 = -y (top axis at index 0), CW.
  let t = Math.atan2(dy, dx) + Math.PI / 2;
  if (t < 0) t += Math.PI * 2;
  const wedge = (Math.PI * 2) / N;
  return Math.round(t / wedge) % N;
}

/** Reordered indicator slots used only by the 3 radar charts (clockwise from
 *  top): Forest C → Soil C → Water Flow → Nitrogen → Phosphorus.  This puts
 *  Water Flow on the bottom-right, Nitrogen on the bottom-left, and
 *  Phosphorus on the left.  The bar / table views keep the canonical
 *  SUB_BASIN_INDICATORS order. */
const RADAR_AXES: SubBasinIndicatorDef[] = (() => {
  const order: SubBasinIndicatorId[] = ["forestC", "soilC", "waterFlow", "nitrogen", "phosphorus"];
  return order.map(id => SUB_BASIN_INDICATORS.find(i => i.id === id)!);
})();

function RadarAxisPopover({
  indicator,
  baseline,
  rows,
  axisIdx,
  N,
  containerW,
  cx, cy, R,
}: {
  indicator:  SubBasinIndicatorDef;
  baseline:   number;
  rows:       RadarPopoverRow[];
  axisIdx:    number;
  N:          number;
  containerW: number;
  cx: number; cy: number; R: number;
}) {
  // Sort header rows first (they encode selection/Before/After context),
  // then rest by raw value descending so rank is read at a glance.
  const headerRows  = rows.filter(r => r.emphasis);
  const detailRows  = rows.filter(r => !r.emphasis).sort((a, b) => b.value - a.value);
  const sortedRows  = [...headerRows, ...detailRows];

  // Anchor at the outer end of the active axis, then flip horizontally so
  // the popover never clips the panel edge (axes pointing right ⇒ popover
  // on left of axis end, and vice versa).
  const a = -Math.PI / 2 + (axisIdx / N) * Math.PI * 2;
  const ax = cx + Math.cos(a) * (R + 6);
  const ay = cy + Math.sin(a) * (R + 6);

  const PW = 196;
  const cosA = Math.cos(a);
  const sinA = Math.sin(a);
  const flipCenter = Math.abs(cosA) < 0.05;
  const flipRight  = cosA < -0.05;

  const left = flipCenter
    ? Math.min(Math.max(ax - PW / 2, 4), containerW - PW - 4)
    : flipRight
      ? Math.min(ax + 6, containerW - PW - 4)
      : Math.max(ax - PW - 6, 4);

  const above = sinA > 0.3;
  const top = above ? ay - 6 : ay + 4;
  const transform = above ? "translateY(-100%)" : "none";

  return (
    <div
      className="absolute z-30 pointer-events-none bg-white border border-slate-300 rounded-md shadow-lg text-[10px]"
      style={{ left, top, width: PW, transform }}
      role="tooltip"
    >
      <div className="px-2 py-1 border-b border-slate-200 bg-slate-50 rounded-t-md">
        <div className="font-semibold text-slate-900 text-[10.5px] leading-tight">
          {indicator.label}
        </div>
        <div className="text-[9px] text-slate-500 font-mono">
          baseline {fmt(baseline, indicator.decimals)} {indicator.unit}
        </div>
      </div>
      <div className="px-1.5 py-1 space-y-0.5 max-h-[200px] overflow-y-auto">
        {sortedRows.length === 0 && (
          <div className="px-1 py-1 text-slate-400 italic">No data</div>
        )}
        {sortedRows.map((r, i) => (
          <div
            key={i}
            className={[
              "flex items-center gap-1.5 px-1 py-0.5 rounded",
              r.emphasis ? "font-semibold bg-slate-100" : "",
            ].join(" ")}
          >
            <span
              className="inline-block w-2 h-2 rounded-sm shrink-0 border border-white/60"
              style={{ background: r.color }}
            />
            <span className="flex-1 truncate text-slate-700">{r.label}</span>
            <span className="font-mono tabular-nums text-slate-900">
              {r.formatted}
            </span>
            <span className="font-mono text-[9px] text-slate-400 shrink-0">
              {r.unit}
            </span>
            {r.deltaPct !== undefined && Number.isFinite(r.deltaPct) ? (
              <span
                className={[
                  "font-mono tabular-nums w-9 text-right text-[9.5px] shrink-0",
                  r.deltaPct >= 0 ? "text-emerald-600" : "text-rose-600",
                ].join(" ")}
              >
                {r.deltaPct >= 0 ? "+" : "−"}
                {Math.round(Math.abs(r.deltaPct) * 100)}%
              </span>
            ) : (
              <span className="w-9 shrink-0" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
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
  /** Baseline sum = per-ha baseline × selection area (or per-basin baseline × N
   *  for additive indicators). The reference the bar's height is compared to. */
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
          // Single sum bar with baseline reference line
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

              {/* Baseline (per-ha baseline × scaling) reference */}
              <line
                x1={PAD_L} y1={yExpected} x2={CHART_INNER_W - PAD_R} y2={yExpected}
                stroke={REF_COLOR} strokeWidth="1.2" strokeDasharray="4 3" opacity="0.85"
              />
              <text x={CHART_INNER_W - PAD_R} y={yExpected - 3} textAnchor="end"
                fontSize="8" fill={REF_COLOR_DARK} fontFamily="monospace" fontWeight="600">
                baseline {fmt(expectedSum, indicator.decimals)}
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
                      <div className="font-semibold mb-0.5">{indicator.label} · selection sum</div>
                      <div>Total: <span className="font-mono">{fmt(beforeValue, indicator.decimals)} {unit}</span></div>
                      <div className="opacity-80 text-[9.5px]">
                        Baseline: <span className="font-mono">{fmt(expectedSum, indicator.decimals)} {unit}</span>
                      </div>
                      <div className="opacity-80 text-[9.5px]">
                        Δ vs baseline: <span className="font-mono">{fmtPctDelta(expectedSum, beforeValue)}</span>
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
                Total Selection Sum
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

// ── Combined aggregate chart (all indicators in one normalised bar chart) ──
//
// All five indicators on a single shared y-axis ("× baseline"), so
// different units stay visually comparable at a glance.  One bar per
// indicator; with a measure, the slot holds an overlaid pair (lighter
// "Before" wide bar behind + darker "After" narrow bar in front).
// Tooltip on every bar shows the raw value with its real unit, the
// baseline, and the ratio.

const COMBINED_CHART_H = 210;
const COMB_PAD_L = 32, COMB_PAD_R = 8, COMB_PAD_T = 18, COMB_PAD_B = 40;

function CombinedAggregateChart({
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
  const innerW = CHART_INNER_W - COMB_PAD_L - COMB_PAD_R;
  const innerH = COMBINED_CHART_H - COMB_PAD_T - COMB_PAD_B;

  const N      = SUB_BASIN_INDICATORS.length;
  const slotW  = innerW / N;

  // Y-axis: "× baseline".  Auto-fit to data with a floor of 1.5×.
  const ratios = SUB_BASIN_INDICATORS.flatMap(ind => {
    const exp = expectedSums[ind.id];
    if (!exp || !Number.isFinite(exp)) return [];
    return [baseValues[ind.id] / exp, values[ind.id] / exp];
  });
  const maxRatio = Math.max(1.5, ...ratios) * 1.1;

  const toY = (ratio: number) => COMB_PAD_T + innerH - (Math.max(0, ratio) / maxRatio) * innerH;

  // Y-axis ticks: always 0, 0.5, 1.0, then 0.5 increments up to maxRatio.
  const ticks: number[] = [0, 0.5, 1.0];
  for (let t = 1.5; t <= maxRatio - 0.05; t += 0.5) ticks.push(t);

  return (
    <ChartHoverable
      height={COMBINED_CHART_H}
      render={({ setTip }) => (
        <svg width={CHART_INNER_W} height={COMBINED_CHART_H} className="overflow-visible block">
          {/* Y-axis title */}
          <text x={2} y={COMB_PAD_T - 6} fontSize="8.5" fill="#64748b" fontWeight="600">
            × baseline
          </text>

          {/* Y axis grid + labels (baseline ring at 1.0× highlighted) */}
          {ticks.map(t => {
            const yy = toY(t);
            const isBaseline = Math.abs(t - 1.0) < 1e-6;
            return (
              <g key={t}>
                <line
                  x1={COMB_PAD_L} y1={yy}
                  x2={CHART_INNER_W - COMB_PAD_R} y2={yy}
                  stroke={isBaseline ? REF_COLOR : "#e2e8f0"}
                  strokeWidth={isBaseline ? 1.1 : 0.6}
                  strokeDasharray={isBaseline ? "3 2" : undefined}
                  opacity={isBaseline ? 0.75 : 1}
                />
                <text
                  x={COMB_PAD_L - 4} y={yy + 3} textAnchor="end"
                  fontSize="8"
                  fill={isBaseline ? REF_COLOR_DARK : "#94a3b8"}
                  fontFamily="monospace"
                  fontWeight={isBaseline ? "600" : "400"}
                >
                  {t.toFixed(1)}×
                </text>
              </g>
            );
          })}

          {/* Per-indicator bars */}
          {SUB_BASIN_INDICATORS.map((ind, i) => {
            const exp     = expectedSums[ind.id];
            const safeExp = exp && Number.isFinite(exp) ? exp : 1e-9;
            const beforeR = baseValues[ind.id] / safeExp;
            const afterR  = values[ind.id] / safeExp;
            const slotX   = COMB_PAD_L + i * slotW;
            const cx      = slotX + slotW / 2;

            const wideW   = Math.min(slotW * 0.62, 38);
            const narrowW = Math.max(8, wideW * 0.55);
            const xWide   = cx - wideW / 2;
            const xNarrow = cx - narrowW / 2;

            const yBefore = toY(beforeR);
            const yAfter  = toY(afterR);
            const hBefore = Math.max(0.5, (COMB_PAD_T + innerH) - yBefore);
            const hAfter  = Math.max(0.5, (COMB_PAD_T + innerH) - yAfter);

            const tipNoMeasure = (
              <div>
                <div className="font-semibold mb-0.5">{ind.label}</div>
                <div>Sum: <span className="font-mono">{fmt(values[ind.id], ind.decimals)} {units[ind.id]}</span></div>
                <div className="opacity-80 text-[9.5px]">
                  Baseline: <span className="font-mono">{fmt(exp, ind.decimals)} {units[ind.id]}</span>
                </div>
                <div className="opacity-80 text-[9.5px]">
                  Ratio: <span className="font-mono">{afterR.toFixed(2)}× avg</span>
                </div>
              </div>
            );

            // Single combined popup for the Before/After pair — covers the
            // whole slot so hovering anywhere over the indicator shows both
            // values at once (no jitter between two side-by-side popups).
            const tipBeforeAfter = (
              <div>
                <div className="font-semibold mb-0.5">{ind.label} · Before vs After</div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: BEFORE_FILL, opacity: 0.55 }} />
                  <span className="opacity-80">Before:</span>
                  <span className="font-mono">{fmt(baseValues[ind.id], ind.decimals)} {units[ind.id]}</span>
                  <span className="font-mono opacity-60">({beforeR.toFixed(2)}× avg)</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: AFTER_FILL }} />
                  <span className="opacity-80">After:</span>
                  <span className="font-mono">{fmt(values[ind.id], ind.decimals)} {units[ind.id]}</span>
                  <span className="font-mono opacity-60">({afterR.toFixed(2)}× avg)</span>
                </div>
                <div className="opacity-80 text-[9.5px] mt-0.5 pt-0.5 border-t border-white/15">
                  Δ vs Before: <span className="font-mono">{fmtPctDelta(baseValues[ind.id], values[ind.id])}</span>
                  {" · "}With {measureLabel}
                </div>
              </div>
            );

            // Annotation y position — above whichever bar is taller.
            const annotateY = Math.min(yBefore, yAfter) - 3;
            const annotateLabel = `${afterR.toFixed(2)}×`;

            // Hit-rect: full slot height, used to drive the combined tooltip
            // when there's a measure. Drawn last so it sits above the bars
            // (transparent fill keeps the bars fully visible).
            const slotHitY = COMB_PAD_T;
            const slotHitH = innerH;

            return (
              <g key={ind.id}>
                {hasMeasure ? (
                  <>
                    {/* Before — wider, lighter, behind (no pointer events) */}
                    <rect
                      x={xWide} y={yBefore}
                      width={wideW} height={hBefore}
                      fill={BEFORE_FILL} fillOpacity="0.55" rx="2"
                      pointerEvents="none"
                    />
                    {/* After — narrower, darker, in front (no pointer events) */}
                    <rect
                      x={xNarrow} y={yAfter}
                      width={narrowW} height={hAfter}
                      fill={AFTER_FILL} rx="2"
                      pointerEvents="none"
                    />
                    {/* Single hover hit-rect spanning the whole slot */}
                    <rect
                      x={slotX} y={slotHitY}
                      width={slotW} height={slotHitH}
                      fill="transparent"
                      onMouseEnter={() => setTip({ x: cx, y: Math.min(yBefore, yAfter), node: tipBeforeAfter })}
                      onMouseLeave={() => setTip(null)}
                      style={{ cursor: "pointer" }}
                    />
                  </>
                ) : (
                  <rect
                    x={xWide} y={yAfter}
                    width={wideW} height={hAfter}
                    fill={AFTER_FILL} rx="2"
                    onMouseEnter={() => setTip({ x: cx, y: yAfter, node: tipNoMeasure })}
                    onMouseLeave={() => setTip(null)}
                    style={{ cursor: "pointer" }}
                  />
                )}

                {/* Ratio annotation above bar */}
                <text
                  x={cx} y={annotateY} textAnchor="middle"
                  fontSize="8.5" fill="#0f172a"
                  fontFamily="monospace" fontWeight="700"
                >
                  {annotateLabel}
                </text>

                {/* X-axis label (indicator short label) */}
                <text
                  x={cx} y={COMB_PAD_T + innerH + 11} textAnchor="middle"
                  fontSize="8.5" fill="#475569" fontWeight="600"
                >
                  {ind.shortLabel}
                </text>
                {/* Unit subtitle under x-axis label */}
                <text
                  x={cx} y={COMB_PAD_T + innerH + 22} textAnchor="middle"
                  fontSize="7" fill="#94a3b8" fontFamily="monospace"
                >
                  {units[ind.id]}
                </text>
              </g>
            );
          })}

          {/* Axis lines */}
          <line
            x1={COMB_PAD_L} y1={COMB_PAD_T}
            x2={COMB_PAD_L} y2={COMB_PAD_T + innerH}
            stroke="#cbd5e1" strokeWidth="1"
          />
          <line
            x1={COMB_PAD_L} y1={COMB_PAD_T + innerH}
            x2={CHART_INNER_W - COMB_PAD_R} y2={COMB_PAD_T + innerH}
            stroke="#cbd5e1" strokeWidth="1"
          />
        </svg>
      )}
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
  basins,
  colorFor,
}: {
  values:       Record<SubBasinIndicatorId, number>;
  baseValues:   Record<SubBasinIndicatorId, number>;
  expectedSums: Record<SubBasinIndicatorId, number>;
  hasMeasure:   boolean;
  measureLabel: string;
  units:        Record<SubBasinIndicatorId, string>;
  basins:       SubBasinMeta[];
  colorFor:     (id: number) => string;
}) {
  const W = RADAR_W;
  const H = RADAR_H;
  const cx = W / 2, cy = H / 2 + 4;
  const R  = 84;

  // Use radar-specific axis order (Forest, Soil, Water, N, P clockwise).
  // eslint-disable-next-line @typescript-eslint/no-shadow
  const SUB_BASIN_INDICATORS = RADAR_AXES;
  const N = SUB_BASIN_INDICATORS.length;
  const angleFor = (i: number) => -Math.PI / 2 + (i / N) * Math.PI * 2;

  // Each axis normalised to its own baseline sum (= per-ha baseline × scaling).
  // baseline ring sits at 1.0; outer ring at 1.5 so above-avg basins fit.
  const BASELINE_FRAC = 1.0;
  // Always 5 rings, with 1.0× landing on the 2nd ring (0.5, 1.0, 1.5, 2.0, 2.5).
  const MAX_FRAC      = 2.5;

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

  const { activeAxis, onMouseMove, onMouseLeave } = useRadarAxisHover(cx, cy, R, N);

  // Build popover rows for the active axis: selection Before/After (or
  // Sum/Baseline when no measure) at top, then per-basin contributors.
  const popoverRows: RadarPopoverRow[] = activeAxis !== null
    ? (() => {
        const ind  = SUB_BASIN_INDICATORS[activeAxis];
        const exp  = expectedSums[ind.id];
        const base = SUB_BASIN_BASELINE_AVG[ind.id];
        const out: RadarPopoverRow[] = [];
        if (hasMeasure) {
          const before = baseValues[ind.id];
          const after  = values[ind.id];
          out.push({
            label: "Selection · Before",
            color: BEFORE_FILL,
            value: before,
            formatted: fmt(before, ind.decimals),
            unit: units[ind.id],
            deltaPct: exp > 0 ? (before - exp) / exp : undefined,
            emphasis: true,
          });
          out.push({
            label: `Selection · After (${measureLabel})`,
            color: AFTER_FILL,
            value: after,
            formatted: fmt(after, ind.decimals),
            unit: units[ind.id],
            deltaPct: before > 0 ? (after - before) / before : undefined,
            emphasis: true,
          });
        } else {
          const sum = values[ind.id];
          out.push({
            label: "Selection sum",
            color: "#3b82f6",
            value: sum,
            formatted: fmt(sum, ind.decimals),
            unit: units[ind.id],
            deltaPct: exp > 0 ? (sum - exp) / exp : undefined,
            emphasis: true,
          });
          out.push({
            label: "Baseline (avg × scale)",
            color: REF_COLOR,
            value: exp,
            formatted: fmt(exp, ind.decimals),
            unit: units[ind.id],
            emphasis: true,
          });
        }
        for (const b of basins) {
          const v = b.indicators[ind.id];
          out.push({
            label: `#${b.id} ${b.name}`,
            color: colorFor(b.id),
            value: v,
            formatted: fmt(v, ind.decimals),
            unit: ind.unit,
            deltaPct: base > 0 ? (v - base) / base : undefined,
          });
        }
        return out;
      })()
    : [];

  return (
    <div className="relative" style={{ width: W, height: H }}>
      <svg width={W} height={H} className="block">
        {/* 5 rings (1.0× baseline lines up on ring #2) + scale tick labels */}
        {[0.5, 1.0, 1.5, 2.0, 2.5].map((f, idx) => {
          const r = (f / MAX_FRAC) * R;
          return (
            <g key={idx}>
              <circle cx={cx} cy={cy} r={r}
                fill="none" stroke="#e2e8f0" strokeWidth="0.6" />
              {f >= 1.0 && (
                <text x={cx + 4} y={cy - r + 3} fontSize="7.5"
                  fill="#94a3b8" fontFamily="monospace"
                  style={{ pointerEvents: "none" }}>
                  {f.toFixed(1)}×
                </text>
              )}
            </g>
          );
        })}
        {/* Baseline reference ring */}
        <circle cx={cx} cy={cy} r={baselineRingR}
          fill="none" stroke={REF_COLOR} strokeWidth="1.1"
          strokeDasharray="3 2" opacity="0.7" />

        {/* Axes + labels (avg moved into popover header) */}
        {SUB_BASIN_INDICATORS.map((ind, i) => {
          const outer = point(MAX_FRAC, i);
          const labelR = R + 22;
          const a = angleFor(i);
          const lx = cx + Math.cos(a) * labelR;
          const ly = cy + Math.sin(a) * labelR;
          const isActive = activeAxis === i;
          const anchor = Math.abs(Math.cos(a)) < 0.2 ? "middle" : (Math.cos(a) > 0 ? "start" : "end");
          const baseline = Math.abs(Math.sin(a)) < 0.3 ? "middle" : (Math.sin(a) > 0 ? "hanging" : "auto");
          return (
            <g key={ind.id}>
              <line x1={cx} y1={cy} x2={outer.x} y2={outer.y}
                stroke={isActive ? "#0f172a" : "#cbd5e1"}
                strokeWidth={isActive ? 1.2 : 0.5} />
              <text
                x={lx} y={ly}
                textAnchor={anchor}
                dominantBaseline={baseline}
                fontSize="9.5" fill={isActive ? "#0f172a" : "#334155"}
                fontWeight={isActive ? 700 : 600}
              >
                {ind.shortLabel}
              </text>
              <text
                x={lx} y={ly + 11}
                textAnchor={anchor}
                dominantBaseline={baseline}
                fontSize="8" fill={isActive ? "#334155" : "#64748b"}
                fontFamily="monospace"
              >
                {ind.unit}
              </text>
            </g>
          );
        })}

        {/* Before polygon (only when measure active) */}
        {hasMeasure && (
          <polygon points={beforePath}
            fill={BEFORE_FILL} fillOpacity="0.18"
            stroke={BEFORE_FILL} strokeWidth="1.2"
            strokeDasharray="3 2"
            strokeLinejoin="round"
            style={{ pointerEvents: "none" }} />
        )}

        {/* Main polygon (current/After values) */}
        <polygon
          points={afterPath}
          fill={hasMeasure ? AFTER_FILL : "#3b82f6"} fillOpacity="0.22"
          stroke={hasMeasure ? AFTER_FILL : "#3b82f6"} strokeWidth="1.6"
          strokeLinejoin="round"
          style={{ pointerEvents: "none" }}
        />

        {/* Decorative vertices (hover handled at axis level) */}
        {SUB_BASIN_INDICATORS.map((ind, i) => {
          const p = afterPts[i];
          return (
            <circle
              key={ind.id} cx={p.x} cy={p.y} r="3.2"
              fill={hasMeasure ? AFTER_FILL : "#3b82f6"}
              stroke="white" strokeWidth="1.2"
              style={{ pointerEvents: "none" }}
            />
          );
        })}

        {/* Active-axis vertex halos */}
        {activeAxis !== null && (
          <>
            {hasMeasure && (
              <circle cx={beforePts[activeAxis].x} cy={beforePts[activeAxis].y}
                r="6.5" fill="none" stroke="white" strokeOpacity="0.85"
                strokeWidth="2" style={{ pointerEvents: "none" }} />
            )}
            <circle cx={afterPts[activeAxis].x} cy={afterPts[activeAxis].y}
              r="6.5" fill="none" stroke="white" strokeOpacity="0.85"
              strokeWidth="2" style={{ pointerEvents: "none" }} />
          </>
        )}

        {/* Hit area for axis-wedge hover */}
        <rect
          x={0} y={0} width={W} height={H}
          fill="transparent" pointerEvents="all"
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
        />

        {/* Legend (1.0× baseline already explained by the BaselineBadge in the chart header) */}
        <g transform={`translate(8, ${H - 14})`} style={{ pointerEvents: "none" }}>
          <circle cx="4" cy="4" r="3" fill={REF_COLOR} opacity="0.7" />
          <text x="11" y="7" fontSize="8" fill="#64748b">avg of 25</text>
        </g>
      </svg>
      {activeAxis !== null && (
        <RadarAxisPopover
          indicator={SUB_BASIN_INDICATORS[activeAxis]}
          baseline={SUB_BASIN_BASELINE_AVG[SUB_BASIN_INDICATORS[activeAxis].id]}
          rows={popoverRows}
          axisIdx={activeAxis}
          N={N}
          containerW={W}
          cx={cx} cy={cy} R={R}
        />
      )}
    </div>
  );
}

// ── Single-basin radar (n=1, baseline-avg reference ring) ──────────────────

function SingleBasinRadar({ basin, color }: { basin: SubBasinMeta; color: string }) {
  const W = RADAR_W;
  const H = RADAR_H;
  const cx = W / 2, cy = H / 2 + 4;
  const R  = 78;

  // Use radar-specific axis order (Forest, Soil, Water, N, P clockwise).
  // eslint-disable-next-line @typescript-eslint/no-shadow
  const SUB_BASIN_INDICATORS = RADAR_AXES;
  const N = SUB_BASIN_INDICATORS.length;
  const angleFor = (i: number) => -Math.PI / 2 + (i / N) * Math.PI * 2;

  const BASELINE_FRAC = 1.0;
  // Always 5 rings, with 1.0× landing on the 2nd ring (0.5, 1.0, 1.5, 2.0, 2.5).
  const MAX_FRAC      = 2.5;

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

  const { activeAxis, onMouseMove, onMouseLeave } = useRadarAxisHover(cx, cy, R, N);

  const popoverRows: RadarPopoverRow[] = activeAxis !== null
    ? (() => {
        const ind = SUB_BASIN_INDICATORS[activeAxis];
        const v = basin.indicators[ind.id];
        const baseline = SUB_BASIN_BASELINE_AVG[ind.id];
        return [
          {
            label: basin.name,
            color,
            value: v,
            formatted: fmt(v, ind.decimals),
            unit: ind.unit,
            deltaPct: baseline > 0 ? (v - baseline) / baseline : undefined,
            emphasis: true,
          },
          {
            label: "Baseline (avg of 25 basins)",
            color: REF_COLOR,
            value: baseline,
            formatted: fmt(baseline, ind.decimals),
            unit: ind.unit,
            emphasis: true,
          },
        ];
      })()
    : [];

  return (
    <div className="relative" style={{ width: W, height: H }}>
      <svg width={W} height={H} className="block">
        {/* 5 rings (1.0× baseline lines up on ring #2) + scale tick labels */}
        {[0.5, 1.0, 1.5, 2.0, 2.5].map((f, idx) => {
          const r = (f / MAX_FRAC) * R;
          return (
            <g key={idx}>
              <circle cx={cx} cy={cy} r={r}
                fill="none" stroke="#e2e8f0" strokeWidth="0.6" />
              {f >= 1.0 && (
                <text x={cx + 4} y={cy - r + 3} fontSize="7.5"
                  fill="#94a3b8" fontFamily="monospace"
                  style={{ pointerEvents: "none" }}>
                  {f.toFixed(1)}×
                </text>
              )}
            </g>
          );
        })}
        <circle cx={cx} cy={cy} r={baselineRingR}
          fill="none" stroke={REF_COLOR} strokeWidth="1.1"
          strokeDasharray="3 2" opacity="0.7" />

        {/* Axes + labels (value moved into popover header) */}
        {SUB_BASIN_INDICATORS.map((ind, i) => {
          const outer = point(MAX_FRAC, i);
          const labelR = R + 22;
          const a = angleFor(i);
          const lx = cx + Math.cos(a) * labelR;
          const ly = cy + Math.sin(a) * labelR;
          const isActive = activeAxis === i;
          const anchor = Math.abs(Math.cos(a)) < 0.2 ? "middle" : (Math.cos(a) > 0 ? "start" : "end");
          const baseline = Math.abs(Math.sin(a)) < 0.3 ? "middle" : (Math.sin(a) > 0 ? "hanging" : "auto");
          return (
            <g key={ind.id}>
              <line x1={cx} y1={cy} x2={outer.x} y2={outer.y}
                stroke={isActive ? "#0f172a" : "#cbd5e1"}
                strokeWidth={isActive ? 1.2 : 0.5} />
              <text
                x={lx} y={ly}
                textAnchor={anchor}
                dominantBaseline={baseline}
                fontSize="9.5" fill={isActive ? "#0f172a" : "#334155"}
                fontWeight={isActive ? 700 : 600}
              >
                {ind.shortLabel}
              </text>
              <text
                x={lx} y={ly + 11}
                textAnchor={anchor}
                dominantBaseline={baseline}
                fontSize="8" fill={isActive ? "#334155" : "#64748b"}
                fontFamily="monospace"
              >
                {ind.unit}
              </text>
            </g>
          );
        })}

        {/* Basin polygon */}
        <polygon points={basinPath} fill={color} fillOpacity="0.28"
          stroke={color} strokeWidth="1.6" strokeLinejoin="round"
          style={{ pointerEvents: "none" }} />
        {basinPts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill={color}
            stroke="white" strokeWidth="1.1"
            style={{ pointerEvents: "none" }} />
        ))}

        {/* Active-axis halo */}
        {activeAxis !== null && (
          <circle cx={basinPts[activeAxis].x} cy={basinPts[activeAxis].y}
            r="6" fill="none" stroke="white" strokeOpacity="0.85"
            strokeWidth="2" style={{ pointerEvents: "none" }} />
        )}

        {/* Hit area */}
        <rect
          x={0} y={0} width={W} height={H}
          fill="transparent" pointerEvents="all"
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
        />

        {/* Legend (1.0× baseline already explained by the BaselineBadge in the chart header) */}
        <g transform={`translate(8, ${H - 14})`} style={{ pointerEvents: "none" }}>
          <circle cx="4" cy="4" r="3" fill={REF_COLOR} opacity="0.7" />
          <text x="11" y="7" fontSize="8" fill="#64748b">avg of 25</text>
        </g>
      </svg>
      {activeAxis !== null && (
        <RadarAxisPopover
          indicator={SUB_BASIN_INDICATORS[activeAxis]}
          baseline={SUB_BASIN_BASELINE_AVG[SUB_BASIN_INDICATORS[activeAxis].id]}
          rows={popoverRows}
          axisIdx={activeAxis}
          N={N}
          containerW={W}
          cx={cx} cy={cy} R={R}
        />
      )}
    </div>
  );
}

// ── Multi-basin radar (n≥2, baseline-avg reference ring, 1 polygon per basin)

function MultiBasinRadar({
  basins,
  colorFor,
}: {
  basins:   SubBasinMeta[];
  colorFor: (id: number) => string;
}) {
  const W = RADAR_W;
  const H = RADAR_H;
  const cx = W / 2, cy = H / 2 + 4;
  const R  = 78;

  // Use radar-specific axis order (Forest, Soil, Water, N, P clockwise).
  // eslint-disable-next-line @typescript-eslint/no-shadow
  const SUB_BASIN_INDICATORS = RADAR_AXES;
  const N = SUB_BASIN_INDICATORS.length;
  const angleFor = (i: number) => -Math.PI / 2 + (i / N) * Math.PI * 2;

  const allRatios = basins.flatMap(b =>
    SUB_BASIN_INDICATORS.map(ind => {
      const baseline = SUB_BASIN_BASELINE_AVG[ind.id];
      const v = b.indicators[ind.id];
      if (!(baseline > 0) || !Number.isFinite(v)) return 0;
      const r = v / baseline;
      return Number.isFinite(r) ? r : 0;
    }),
  );
  // Fixed 2.5× scale across all 3 radars: 5 rings (0.5/1.0/1.5/2.0/2.5) with
  // the 1.0× baseline on ring #2.  Rare values >2.5× clamp to the outer ring
  // (see `point()`); we don't auto-scale because doing so shrinks every other
  // polygon for one outlier.
  void allRatios;
  const MAX_FRAC = 2.5;
  const BASELINE_FRAC  = 1.0;
  const baselineRingR  = (BASELINE_FRAC / MAX_FRAC) * R;

  const point = (frac: number, i: number) => {
    const r = (Math.min(MAX_FRAC, Math.max(0, frac)) / MAX_FRAC) * R;
    const a = angleFor(i);
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  };

  const basinPolygons = basins.map(b => {
    const pts = SUB_BASIN_INDICATORS.map((ind, i) => {
      const baseline = SUB_BASIN_BASELINE_AVG[ind.id];
      const frac = baseline > 0 ? b.indicators[ind.id] / baseline : 0;
      return point(frac, i);
    });
    return {
      basin: b,
      color: colorFor(b.id),
      pts,
      path: pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "),
    };
  });

  // Always 5 rings; step depends on snapped MAX_FRAC (0.5 step at 2.5×, 1.0 step at 5.0×).
  const ringStep  = MAX_FRAC / 5;
  const gridFracs: number[] = [1, 2, 3, 4, 5].map(i => i * ringStep);
  const fillOpacity = Math.max(0.06, 0.22 / Math.max(1, basins.length * 0.35));

  const { activeAxis, onMouseMove, onMouseLeave } = useRadarAxisHover(cx, cy, R, N);

  const popoverRows: RadarPopoverRow[] = activeAxis !== null
    ? (() => {
        const ind = SUB_BASIN_INDICATORS[activeAxis];
        const baseline = SUB_BASIN_BASELINE_AVG[ind.id];
        return basins.map(b => {
          const v = b.indicators[ind.id];
          return {
            label: `#${b.id} ${b.name}`,
            color: colorFor(b.id),
            value: v,
            formatted: fmt(v, ind.decimals),
            unit: ind.unit,
            deltaPct: baseline > 0 ? (v - baseline) / baseline : undefined,
          };
        });
      })()
    : [];

  return (
    <div className="relative" style={{ width: W, height: H }}>
      <svg width={W} height={H} className="block">
        {gridFracs.map((f, idx) => {
          const r = (f / MAX_FRAC) * R;
          return (
            <g key={idx}>
              <circle cx={cx} cy={cy} r={r}
                fill="none" stroke="#e2e8f0" strokeWidth="0.6" />
              {f >= 1.0 && (
                <text x={cx + 4} y={cy - r + 3} fontSize="7.5"
                  fill="#94a3b8" fontFamily="monospace"
                  style={{ pointerEvents: "none" }}>
                  {f.toFixed(1)}×
                </text>
              )}
            </g>
          );
        })}
        <circle cx={cx} cy={cy} r={baselineRingR}
          fill="none" stroke={REF_COLOR} strokeWidth="1.1"
          strokeDasharray="3 2" opacity="0.7" />

        {/* Axes + labels (avg moved into popover header) */}
        {SUB_BASIN_INDICATORS.map((ind, i) => {
          const outer = point(MAX_FRAC, i);
          const labelR = R + 22;
          const a = angleFor(i);
          const lx = cx + Math.cos(a) * labelR;
          const ly = cy + Math.sin(a) * labelR;
          const isActive = activeAxis === i;
          const anchor = Math.abs(Math.cos(a)) < 0.2 ? "middle" : (Math.cos(a) > 0 ? "start" : "end");
          const baseline = Math.abs(Math.sin(a)) < 0.3 ? "middle" : (Math.sin(a) > 0 ? "hanging" : "auto");
          return (
            <g key={ind.id}>
              <line x1={cx} y1={cy} x2={outer.x} y2={outer.y}
                stroke={isActive ? "#0f172a" : "#cbd5e1"}
                strokeWidth={isActive ? 1.2 : 0.5} />
              <text
                x={lx} y={ly}
                textAnchor={anchor}
                dominantBaseline={baseline}
                fontSize="9.5" fill={isActive ? "#0f172a" : "#334155"}
                fontWeight={isActive ? 700 : 600}
              >
                {ind.shortLabel}
              </text>
              <text
                x={lx} y={ly + 11}
                textAnchor={anchor}
                dominantBaseline={baseline}
                fontSize="8" fill={isActive ? "#334155" : "#64748b"}
                fontFamily="monospace"
              >
                {ind.unit}
              </text>
            </g>
          );
        })}

        {/* One polygon per basin */}
        {basinPolygons.map(({ basin, color, path }) => (
          <polygon key={basin.id} points={path}
            fill={color} fillOpacity={fillOpacity}
            stroke={color} strokeWidth="1.4" strokeLinejoin="round"
            style={{ pointerEvents: "none" }} />
        ))}

        {/* Decorative vertices */}
        {basinPolygons.map(({ basin, color, pts }) =>
          pts.map((p, i) => (
            <circle
              key={`${basin.id}-${i}`} cx={p.x} cy={p.y} r="2.6"
              fill={color} stroke="white" strokeWidth="1"
              style={{ pointerEvents: "none" }}
            />
          )),
        )}

        {/* Active-axis halos on every basin polygon */}
        {activeAxis !== null && basinPolygons.map(({ basin, pts }) => {
          const p = pts[activeAxis];
          return (
            <circle key={`halo-${basin.id}`} cx={p.x} cy={p.y} r="5.5"
              fill="none" stroke="white" strokeOpacity="0.85"
              strokeWidth="1.8" style={{ pointerEvents: "none" }} />
          );
        })}

        {/* Hit area */}
        <rect
          x={0} y={0} width={W} height={H}
          fill="transparent" pointerEvents="all"
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
        />

        {/* Legend */}
        <g transform={`translate(8, ${H - 14})`} style={{ pointerEvents: "none" }}>
          <circle cx="4" cy="4" r="3" fill={REF_COLOR} opacity="0.7" />
          <text x="11" y="7" fontSize="8" fill="#64748b">
            avg of 25 · outer = {MAX_FRAC.toFixed(1)}×
          </text>
        </g>
      </svg>
      {activeAxis !== null && (
        <RadarAxisPopover
          indicator={SUB_BASIN_INDICATORS[activeAxis]}
          baseline={SUB_BASIN_BASELINE_AVG[SUB_BASIN_INDICATORS[activeAxis].id]}
          rows={popoverRows}
          axisIdx={activeAxis}
          N={N}
          containerW={W}
          cx={cx} cy={cy} R={R}
        />
      )}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────

interface Props {
  selectedIds: number[];
  colorFor:    (id: number) => string;
  aggregate:   boolean;
  measureId:   SubBasinMeasureId;
  aggregateView: "bars" | "combined" | "radar";
  onSetAggregate:    (v: boolean) => void;
  onSetMeasure:      (id: SubBasinMeasureId) => void;
  onSetAggregateView:(v: "bars" | "combined" | "radar") => void;
  onRemove:          (id: number) => void;
  onClear:           () => void;
  onSelectAll:       () => void;
  onSelectAllDeselect: () => void;
  /** Hidden Pixel-mode prototype (Sub-basin tab, ?pixel=1).  When true the
   *  panel relabels itself for "pixels" instead of "sub-basins" and hides
   *  controls that don't apply (e.g. "Select all 25"). */
  pixelMode?: boolean;
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
  pixelMode = false,
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

  // Baseline sum per indicator = baseline_avg × scaling factor.
  //   per-area densities ⇒ × totalArea
  //   additive (waterFlow) ⇒ × N basins
  // (Internal name kept as `expectedSums` to limit churn; the UI labels it
  // "baseline" everywhere so the per-ha "baseline" and aggregate "baseline"
  // both refer to the same conceptual reference.)
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
            {pixelMode ? "Pixel Compare" : "Sub-basin Compare"}
          </h2>
          <span className="text-[10px] text-muted-foreground">
            {pixelMode
              ? `${selectedIds.length} pixel${selectedIds.length === 1 ? "" : "s"}`
              : `${selectedIds.length} of ${SUB_BASIN_META.length} selected`}
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
        {!pixelMode && (
          <button
            onClick={allSelected ? onSelectAllDeselect : onSelectAll}
            className="text-[10.5px] px-2 py-1 rounded bg-muted/60 text-foreground hover:bg-muted border border-border cursor-pointer"
            title={allSelected ? "Clear all 25" : "Select all 25 sub-basins"}
          >
            {allSelected ? "Deselect all" : "Select all 25"}
          </button>
        )}
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
            title="Toggle between per-basin comparison and Total Selection Sum"
          >
            {aggregate ? <Sigma size={11} /> : <BarChart3 size={11} />}
            {aggregate ? "Aggregate ON" : "Aggregate"}
          </button>
        )}
      </div>

      {/* Compare-mode sub-toolbar (chart-type toggle, plus measure when aggregate). */}
      {isComparing && (
        <div className="px-4 py-2.5 border-b border-border flex-shrink-0 space-y-2 bg-slate-50/60">
          {/* Chart type toggle — always shown when comparing.  "Combined"
              only makes sense for the single aggregated sum, so it's
              hidden in non-aggregate compare mode. */}
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
              title="One card per indicator"
            >
              <BarChart3 size={11} /> Bars
            </button>
            {aggregate && (
              <button
                onClick={() => onSetAggregateView("combined")}
                className={[
                  "text-[10.5px] px-2 py-1 rounded border flex items-center gap-1 cursor-pointer",
                  aggregateView === "combined"
                    ? "bg-foreground text-white border-foreground"
                    : "bg-white text-foreground border-border hover:bg-muted",
                ].join(" ")}
                title="All indicators in one chart, normalised to baseline"
              >
                <Columns3 size={11} /> Combined
              </button>
            )}
            <button
              onClick={() => onSetAggregateView("radar")}
              className={[
                "text-[10.5px] px-2 py-1 rounded border flex items-center gap-1 cursor-pointer",
                aggregateView === "radar"
                  ? "bg-foreground text-white border-foreground"
                  : "bg-white text-foreground border-border hover:bg-muted",
              ].join(" ")}
              title="Radar polygon (5 indicators)"
            >
              <Hexagon size={11} /> Radar
            </button>
          </div>

          {/* Measure dropdown — aggregate-only */}
          {aggregate && (
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
          )}
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
                <span className="font-mono text-foreground/80">
                  {isPixelId(b.id) ? pixelIdToLetter(b.id) : b.id}
                </span>
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
        {selectedIds.length === 0 && <EmptyState pixelMode={pixelMode} />}

        {isSingle && basins[0] && (
          <SingleBasinDetail basin={basins[0]} color={colorFor(basins[0].id)} />
        )}

        {isComparing && (
          <div className="px-3 py-3 space-y-3">
            {/* Mode banner — title (what's shown) + explainer (how the numbers
                are derived, so the contrast between Aggregate ON/OFF is
                obvious without having to dig into chart tooltips). */}
            <div className={[
              "rounded-md border px-2.5 py-1.5",
              aggregate
                ? hasMeasure
                  ? "bg-amber-50 border-amber-300 text-amber-900"
                  : "bg-primary/8 border-primary/25 text-primary"
                : "bg-muted/40 border-border text-muted-foreground",
            ].join(" ")}>
              <div className="flex items-center gap-1.5 text-[10.5px] font-medium">
                {aggregate
                  ? hasMeasure
                    ? <Sparkles size={11} />
                    : <Sigma size={11} />
                  : <BarChart3 size={11} />}
                {!aggregate && `Comparing ${selectedIds.length} sub-basins side-by-side`}
                {aggregate && !hasMeasure &&
                  `Sum across ${selectedIds.length} sub-basins (${totalArea.toLocaleString()} ha)`}
                {aggregate && hasMeasure &&
                  `Scenario: ${measure.shortLabel} on ${selectedIds.length} sub-basins — Before vs After`}
              </div>
              <div className="text-[9.5px] leading-snug opacity-80 mt-0.5 pl-[18px]">
                {!aggregate && (
                  <>Each basin shown on its own, in <em>per-hectare</em> units
                    so big and small basins are fair to compare.</>
                )}
                {aggregate && !hasMeasure && (
                  <>Selection added up into one regional total — bigger basins
                    contribute more. Numbers switch from per-hectare to
                    real-world totals (tonnes, kg/yr, m³/s).</>
                )}
                {aggregate && hasMeasure && (
                  <>Same regional total, shown <em>before</em> vs <em>after</em>
                    {" "}applying this measure to all {selectedIds.length} basins.</>
                )}
              </div>
            </div>

            {/* Per-basin compare · bars view (5 stacked vertical bar cards).
                "combined" has no per-basin meaning here, so it falls back
                to bars rendering. */}
            {!aggregate && aggregateView !== "radar" && SUB_BASIN_INDICATORS.map(ind => {
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

            {/* Per-basin compare · radar view (one polygon per basin,
                shared 5-axis radar normalised to baseline). */}
            {!aggregate && aggregateView === "radar" && (
              <div className="bg-white border border-border rounded-md p-2.5">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="text-[11px] font-semibold text-foreground">
                    Per-basin indicator profile · radar
                  </span>
                  <BaselineBadge />
                </div>
                <MultiBasinRadar basins={basins} colorFor={colorFor} />
                {/* Per-basin colour key */}
                <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 pt-1 text-[9.5px] text-muted-foreground">
                  {basins.map(b => (
                    <span key={b.id} className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: colorFor(b.id) }} />
                      <span className="text-foreground/80 truncate max-w-[110px]">{b.name}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Per-basin compare · radar breakdown table (one section per
                selected basin, mirrors the aggregate radar's table). */}
            {!aggregate && aggregateView === "radar" && (
              <PerBasinBreakdownList basins={basins} colorFor={colorFor} />
            )}

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

            {/* Aggregate · combined view (all indicators on one chart) */}
            {aggregate && aggregateView === "combined" && (
              <>
                <div className="bg-white border border-border rounded-md p-2.5">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="text-[11px] font-semibold text-foreground">
                      Selection indicator profile · combined bars
                    </span>
                    <BaselineBadge />
                  </div>
                  <CombinedAggregateChart
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
                        <span className="w-3 h-2 rounded-sm" style={{ background: BEFORE_FILL, opacity: 0.55 }} />
                        Before
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm" style={{ background: AFTER_FILL }} />
                        After ({measure.shortLabel})
                      </span>
                    </div>
                  )}
                </div>

                <IndicatorBreakdownTable
                  values={aggResult.values}
                  baseValues={aggResult.baseValues}
                  expectedSums={expectedSums}
                  units={units}
                  hasMeasure={hasMeasure}
                  measureLabel={measure.shortLabel}
                />
              </>
            )}

            {/* Aggregate · radar view */}
            {aggregate && aggregateView === "radar" && (
              <>
                <div className="bg-white border border-border rounded-md p-2.5">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="text-[11px] font-semibold text-foreground">
                      Selection indicator profile · radar
                    </span>
                    <BaselineBadge />
                  </div>
                  <AggregateRadarChart
                    values={aggResult.values}
                    baseValues={aggResult.baseValues}
                    expectedSums={expectedSums}
                    hasMeasure={hasMeasure}
                    measureLabel={measure.shortLabel}
                    units={units}
                    basins={basins}
                    colorFor={colorFor}
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

                <IndicatorBreakdownTable
                  values={aggResult.values}
                  baseValues={aggResult.baseValues}
                  expectedSums={expectedSums}
                  units={units}
                  hasMeasure={hasMeasure}
                  measureLabel={measure.shortLabel}
                />
              </>
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

function EmptyState({ pixelMode = false }: { pixelMode?: boolean }) {
  return (
    <div className="px-6 py-10 text-center">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-muted/50 border border-border flex items-center justify-center">
        <Layers size={18} className="text-muted-foreground" />
      </div>
      <p className="text-xs font-semibold text-foreground mb-1">
        {pixelMode ? "No pixels selected" : "No sub-basins selected"}
      </p>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        {pixelMode ? (
          <>
            Click anywhere on the map to drop a 1-ha pixel
            (labeled <span className="font-medium text-foreground">A, B, C…</span>).
            Pick <span className="font-medium text-foreground">2 or more</span> to compare them
            side-by-side. Click a marker to remove it.
          </>
        ) : (
          <>
            Click any sub-basin polygon on the map to start.
            Pick <span className="font-medium text-foreground">2 or more</span> to compare them
            side-by-side, or use <span className="font-medium text-foreground">Select all 25</span>
            for a watershed-wide view.
          </>
        )}
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
            <div className="text-[10px] text-muted-foreground font-mono">
              {isPixelId(basin.id) ? `Pixel ${pixelIdToLetter(basin.id)}` : `Sub-basin ${basin.id}`}
            </div>
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
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <span className="text-[11px] font-semibold text-foreground">
            Single-basin indicator profile · radar
          </span>
          <BaselineBadge />
        </div>
        <SingleBasinRadar basin={basin} color={color} />
      </div>

      {/* Compact value vs baseline table */}
      <div className="mt-3 bg-white border border-border rounded-md p-2.5">
        <div className="text-[10.5px] font-semibold text-foreground mb-1.5">
          Indicator values vs baseline
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
