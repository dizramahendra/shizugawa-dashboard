import { useMemo, useState } from "react";
import { X, Leaf, Layers, LayoutGrid } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";
import {
  DECARB_MEASURES, MeasureId, getMeasure,
  buildBlueCarbonSeries, getBaselineHsi, getScenarioHsi,
  gridToLonLat, TOTAL_WEEKS,
} from "@/lib/simulatedData";
import HsiGauge, { RainbowStrip } from "@/components/HsiGauge";

export interface PortfolioPixel {
  id: string;
  x: number;
  z: number;
  color: string;
}

interface Props {
  pixels:  PortfolioPixel[];
  measure: MeasureId;
  year:    number;
  onChangeMeasure: (m: MeasureId) => void;
  onRemovePixel:   (id: string) => void;
}

const fmtCoords = (x: number, z: number) => {
  const { lon, lat } = gridToLonLat(x, z);
  return `${lat.toFixed(3)}°N · ${lon.toFixed(3)}°E`;
};

type ViewMode = "per-pixel" | "average";
type CellCarbonMode = "per-cell" | "total";

const EVAL_WEEK = TOTAL_WEEKS - 1; // end-of-year — measure is fully ramped

const SEAGRASS_COLOR  = "#059669"; // emerald-600
const BASELINE_COLOR  = "#94a3b8"; // slate-400

export default function CarbonPortfolioPanel({
  pixels, measure, year,
  onChangeMeasure, onRemovePixel,
}: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("per-pixel");
  const [cellCarbonMode, setCellCarbonMode] = useState<CellCarbonMode>("per-cell");

  // Per-pixel annual seagrass-carbon series (year-long, measure applied at week 0).
  // Time is intentionally fixed: we evaluate the steady-state annual outlook.
  const series = useMemo(() => {
    return pixels.map((p) => ({
      pixel: p,
      carbon: buildBlueCarbonSeries(0, EVAL_WEEK, year, p.x, p.z, measure, 0),
    }));
  }, [pixels, year, measure]);

  // Baseline + scenario annual sequestration (tCO₂e/ha · year), summed across
  // all selected pixels (project-area total).
  const annual = useMemo(() => {
    let baseline = 0, scenario = 0;
    for (const s of series) {
      const last = s.carbon[s.carbon.length - 1];
      if (last) {
        baseline += last.baselineCum;
        scenario += last.scenarioCum;
      }
    }
    return { baseline, scenario, delta: scenario - baseline };
  }, [series]);

  const hasMeasure = measure !== "none";

  const compareData = useMemo(() => {
    const rows = [{ key: "baseline", label: "Baseline", value: annual.baseline, color: BASELINE_COLOR }];
    if (hasMeasure) {
      rows.push({ key: "scenario", label: "Scenario", value: annual.scenario, color: SEAGRASS_COLOR });
    }
    return rows;
  }, [annual, hasMeasure]);

  // Per-pixel HSI at fully-ramped state (end of evaluation horizon).
  const hsiNow = useMemo(() => {
    return pixels.map((p) => ({
      pixel: p,
      baseline: getBaselineHsi(EVAL_WEEK, year, p.x, p.z),
      scenario: getScenarioHsi(EVAL_WEEK, year, p.x, p.z, measure, 0),
    }));
  }, [pixels, year, measure]);

  // Average HSI across the project area
  const hsiAvg = useMemo(() => {
    if (hsiNow.length === 0) return { baseline: 0, scenario: 0 };
    const sum = hsiNow.reduce(
      (a, c) => ({ baseline: a.baseline + c.baseline, scenario: a.scenario + c.scenario }),
      { baseline: 0, scenario: 0 },
    );
    return { baseline: sum.baseline / hsiNow.length, scenario: sum.scenario / hsiNow.length };
  }, [hsiNow]);

  const m = getMeasure(measure);

  // The measure selector is always visible — even before any sample points
  // are dropped — so the user can pre-pick a measure for their project area.
  const MeasureSelect = (
    <div>
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
        Project-area measure
      </label>
      <select
        className="mt-1 w-full text-xs h-8 px-2 rounded border border-border bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
        value={measure}
        onChange={(e) => onChangeMeasure(e.target.value as MeasureId)}
        data-testid="portfolio-measure-select"
      >
        {DECARB_MEASURES.map((opt) => (
          <option key={opt.id} value={opt.id}>{opt.label}</option>
        ))}
      </select>
      {measure !== "none" && (
        <div className="mt-1 text-[10px] text-muted-foreground leading-snug">{m.desc}</div>
      )}
    </div>
  );

  // ── EMPTY STATE ──────────────────────────────────────────────────────────
  if (pixels.length === 0) {
    return (
      <div className="px-4 py-4 space-y-4">
        {MeasureSelect}
        <div className="px-2 py-6 text-center border border-dashed border-border rounded-md">
          <div className="mx-auto w-10 h-10 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-3">
            <Leaf className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="text-sm font-medium text-foreground mb-1">Project area · no sample points</div>
          <div className="text-xs text-muted-foreground leading-relaxed max-w-[240px] mx-auto">
            Click up to 4 ocean cells to define your project area. Annual seagrass-carbon
            sequestration and HSI gauges appear once you drop at least one sample point.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 space-y-4">
      {MeasureSelect}

      {/* Hero KPI — Ocean Carbon Storage card */}
      {(() => {
        // Hero shows the project-area TOTAL annual sequestration
        // (tCO₂e/yr) — the headline figure used in J-Blue Credit, Verra
        // VM0033 and IPCC inventories. Per-hectare intensity sits below
        // as a secondary stat for science-minded readers and for
        // comparing across sites of different size.
        //
        // Each sample point implicitly represents 1 hectare of project
        // area, so total = Σ baselineCum across pixels and the ceiling
        // scales linearly: N × 8 tCO₂e/yr (8 = top of the published
        // Zostera marina range).
        const PER_PIXEL_CAPACITY = 8;
        const n                  = Math.max(1, pixels.length);
        const baselineTotal      = annual.baseline;
        const scenarioTotal      = annual.scenario;
        const deltaTotal         = scenarioTotal - baselineTotal;
        const heroValue          = hasMeasure ? scenarioTotal : baselineTotal;
        const baselineAvg        = baselineTotal / n;
        const scenarioAvg        = scenarioTotal / n;
        const intensityValue     = hasMeasure ? scenarioAvg : baselineAvg;
        const capacityCeiling    = PER_PIXEL_CAPACITY * n;
        const capacityPct        = Math.min(100, (heroValue / capacityCeiling) * 100);
        const baselineCapPct     = Math.min(100, (baselineTotal / capacityCeiling) * 100);
        return (
          <div>
            <div className="rounded-xl overflow-hidden border border-border bg-white">
              {/* Blue gradient hero */}
              <div className="bg-gradient-to-b from-slate-400 via-sky-500 to-blue-600 px-4 py-5 text-white text-center">
                <div className="text-[10px] uppercase tracking-[0.18em] font-semibold opacity-95">
                  Seagrass Carbon Sequestration
                </div>
                <div className="mt-2 flex items-baseline justify-center gap-2 flex-wrap">
                  <span className="text-5xl font-bold leading-none tracking-tight tabular-nums">
                    {heroValue.toFixed(2)}
                  </span>
                  <span className="text-xs opacity-95 font-medium">tCO₂e / year</span>
                </div>
                <div className="mt-1 text-[10px] opacity-90 font-medium">
                  project total · {pixels.length} sample point{pixels.length > 1 ? "s" : ""} (~{n} ha)
                </div>
                {hasMeasure ? (
                  <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/20 backdrop-blur text-[11px] font-mono font-semibold">
                    <span>{deltaTotal >= 0 ? "▲" : "▼"}</span>
                    <span>
                      {deltaTotal >= 0 ? "+" : ""}{deltaTotal.toFixed(2)} vs baseline
                    </span>
                  </div>
                ) : (
                  <div className="mt-2 inline-flex items-center px-2 py-0.5 rounded-full bg-white/15 text-[10px] uppercase tracking-wide font-semibold">
                    Baseline · no measure
                  </div>
                )}
              </div>

              {/* Capacity bar */}
              <div className="px-4 pt-3 pb-3">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-semibold text-foreground">Sequestration Capacity</span>
                  <span className="font-bold text-blue-600 tabular-nums">{capacityPct.toFixed(0)}%</span>
                </div>
                <div className="relative h-2 rounded-full overflow-hidden bg-slate-100">
                  {/* current fill (black → blue gradient like the mock) */}
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
                    style={{
                      width: `${capacityPct}%`,
                      background: "linear-gradient(to right, #0f172a, #2563eb)",
                    }}
                  />
                  {/* baseline tick — only meaningful when a scenario is shown */}
                  {hasMeasure && baselineTotal > 0 && (
                    <div
                      className="absolute top-[-2px] bottom-[-2px] w-[2px] bg-slate-700"
                      style={{ left: `calc(${baselineCapPct}% - 1px)` }}
                      title={`Baseline ${baselineTotal.toFixed(2)} tCO₂e/yr`}
                    />
                  )}
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
                  <span>0</span>
                  <span>{capacityCeiling.toFixed(0)} tCO₂e/yr</span>
                </div>

                {/* Intensity sub-stat — per-hectare rate for scientific comparison */}
                <div className="mt-3 pt-2 border-t border-slate-100 flex items-baseline justify-between">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Intensity
                  </span>
                  <span className="text-[11px] font-mono tabular-nums text-slate-700">
                    <span className="font-bold text-slate-900">{intensityValue.toFixed(2)}</span>
                    <span className="ml-1 text-muted-foreground">tCO₂e / ha / yr</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-2 text-[10px] text-muted-foreground leading-snug">
              {hasMeasure
                ? `Total annual seagrass carbon across the ${pixels.length}-cell project area once the measure is fully established, against the theoretical maximum for an equivalent area of ideal Zostera marina meadow.`
                : `Total annual seagrass carbon across the ${pixels.length}-cell project area, against the theoretical maximum for an equivalent area of ideal Zostera marina meadow.`}
              {hasMeasure && (
                <>
                  <br />
                  <span className="text-slate-700">▎</span> dark tick = baseline position on the same scale.
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* Per-cell seagrass carbon breakdown */}
      {(() => {
        const PER_PIXEL_CAPACITY = 8; // matches the hero card scale
        const n                  = pixels.length;
        const totalCapacity      = PER_PIXEL_CAPACITY * Math.max(1, n);
        const isTotal            = cellCarbonMode === "total";

        // ---------- TOTAL-mode rows (project-area sums) ----------
        const totalRows: Array<{
          key: string;
          label: string;
          value: number;
          colorBg: string;
        }> = [
          {
            key: "baseline",
            label: "Baseline · total",
            value: annual.baseline,
            colorBg: "linear-gradient(to right, #475569, #94a3b8)",
          },
        ];
        if (hasMeasure) {
          totalRows.push({
            key: "scenario",
            label: "Scenario · total",
            value: annual.scenario,
            colorBg: "linear-gradient(to right, #0f172a, #2563eb)",
          });
        }

        return (
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="panel-section-title">Per-cell seagrass carbon</div>
              <div className="inline-flex rounded border border-border bg-white overflow-hidden text-[10px]">
                <button
                  type="button"
                  onClick={() => setCellCarbonMode("per-cell")}
                  className={`px-2 py-0.5 flex items-center gap-1 ${cellCarbonMode === "per-cell" ? "bg-emerald-600 text-white" : "text-muted-foreground hover:bg-muted"}`}
                  data-testid="cell-carbon-per-cell"
                  title="One bar per sample point (tCO₂e/ha/yr)"
                >
                  <LayoutGrid className="w-2.5 h-2.5" /> per-cell
                </button>
                <button
                  type="button"
                  onClick={() => setCellCarbonMode("total")}
                  className={`px-2 py-0.5 flex items-center gap-1 ${cellCarbonMode === "total" ? "bg-emerald-600 text-white" : "text-muted-foreground hover:bg-muted"}`}
                  data-testid="cell-carbon-total"
                  title="Project-area sum across all sample points (tCO₂e/yr)"
                >
                  <Layers className="w-2.5 h-2.5" /> total
                </button>
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground mb-2 leading-snug">
              {isTotal
                ? <>Project-area total across {n} sample point{n > 1 ? "s" : ""} · tCO₂e per year · {hasMeasure ? "scenario at full ramp vs baseline" : "baseline"}.</>
                : <>Carbon captured by seagrass meadows · tCO₂e per hectare per year · {hasMeasure ? "scenario at full ramp" : "baseline"}.</>}
            </div>

            {isTotal ? (
              /* ---------- TOTAL view: 1 or 2 sum bars ---------- */
              <div className="space-y-1.5">
                {totalRows.map((row) => {
                  const pct         = Math.min(100, (row.value / totalCapacity) * 100);
                  const overflow    = row.value > totalCapacity;
                  const labelInside = pct >= 22;
                  return (
                    <div key={row.key} className="flex items-center gap-2">
                      <div
                        className="flex-shrink-0 w-20 text-[10px] font-medium text-slate-700 truncate"
                        title={row.label}
                      >
                        {row.label}
                      </div>
                      <div className="relative flex-1 h-5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{ width: `${pct}%`, background: row.colorBg }}
                        />
                        <div
                          className="absolute top-1/2 text-[11px] font-mono font-semibold whitespace-nowrap leading-none tabular-nums"
                          style={{
                            left: `${pct}%`,
                            transform: labelInside
                              ? "translate(calc(-100% - 6px), -50%)"
                              : "translate(6px, -50%)",
                            color: labelInside ? "#ffffff" : "#1e293b",
                          }}
                        >
                          {row.value.toFixed(2)}
                          {overflow && <span className="ml-0.5 opacity-80">▶</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="text-[9px] text-muted-foreground mt-2 leading-snug">
                  Bars fill toward {totalCapacity.toFixed(0)} tCO₂e/yr — the theoretical
                  max for {n} hectare{n > 1 ? "s" : ""} of ideal Zostera marina meadow
                  ({PER_PIXEL_CAPACITY} × {n}).
                </div>
              </div>
            ) : (
              /* ---------- PER-CELL view: one bar per sample point ---------- */
              <>
                <div className="space-y-1.5">
                  {series.map((s, idx) => {
                    const p = s.pixel;
                    const last = s.carbon[s.carbon.length - 1];
                    const baselineVal = last?.baselineCum ?? 0;
                    const scenarioVal = last?.scenarioCum ?? 0;
                    const value       = hasMeasure ? scenarioVal : baselineVal;
                    const pct         = Math.min(100, (value / PER_PIXEL_CAPACITY) * 100);
                    const baselinePct = Math.min(100, (baselineVal / PER_PIXEL_CAPACITY) * 100);
                    const overflow    = value > PER_PIXEL_CAPACITY;
                    const labelInside = pct >= 22;
                    return (
                      <div key={p.id} className="flex items-center gap-2">
                        {/* index badge in the cell's palette color */}
                        <div
                          className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm"
                          style={{ backgroundColor: p.color }}
                          title={fmtCoords(p.x, p.z)}
                        >
                          {idx + 1}
                        </div>
                        {/* horizontal bar */}
                        <div className="relative flex-1 h-5 rounded-full bg-slate-100 overflow-hidden">
                          {/* fill — black → blue gradient (matches the hero card) */}
                          <div
                            className="absolute inset-y-0 left-0 rounded-full"
                            style={{
                              width: `${pct}%`,
                              background: "linear-gradient(to right, #0f172a, #2563eb)",
                            }}
                          />
                          {/* baseline tick on the same scale */}
                          {hasMeasure && baselineVal > 0 && (
                            <div
                              className="absolute top-0 bottom-0 w-[2px] bg-slate-700/80"
                              style={{ left: `calc(${baselinePct}% - 1px)` }}
                              title={`Baseline ${baselineVal.toFixed(2)}`}
                            />
                          )}
                          {/* value label, right-aligned to the fill edge */}
                          <div
                            className="absolute top-1/2 text-[11px] font-mono font-semibold whitespace-nowrap leading-none tabular-nums"
                            style={{
                              left: `${pct}%`,
                              transform: labelInside
                                ? "translate(calc(-100% - 6px), -50%)"
                                : "translate(6px, -50%)",
                              color: labelInside ? "#ffffff" : "#1e293b",
                            }}
                          >
                            {value.toFixed(2)}
                            {overflow && <span className="ml-0.5 opacity-80">▶</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="text-[9px] text-muted-foreground mt-2 leading-snug">
                  Each bar fills toward {PER_PIXEL_CAPACITY} tCO₂e/ha/yr — the theoretical max for an
                  ideal Zostera marina meadow
                  {hasMeasure && <> · <span className="text-slate-700">▎</span> tick = baseline</>}
                  .
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* HSI gauges with view-mode toggle */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="panel-section-title">Seagrass HSI · steady-state</div>
          <div className="inline-flex rounded border border-border bg-white overflow-hidden text-[10px]">
            <button
              type="button"
              onClick={() => setViewMode("per-pixel")}
              className={`px-2 py-0.5 flex items-center gap-1 ${viewMode === "per-pixel" ? "bg-emerald-600 text-white" : "text-muted-foreground hover:bg-muted"}`}
              data-testid="hsi-view-per-pixel"
              title="Show one gauge per sample point"
            >
              <LayoutGrid className="w-2.5 h-2.5" /> per-pixel
            </button>
            <button
              type="button"
              onClick={() => setViewMode("average")}
              className={`px-2 py-0.5 flex items-center gap-1 ${viewMode === "average" ? "bg-emerald-600 text-white" : "text-muted-foreground hover:bg-muted"}`}
              data-testid="hsi-view-average"
              title="Average HSI across the project area"
            >
              <Layers className="w-2.5 h-2.5" /> average
            </button>
          </div>
        </div>
        <div className="mb-2">
          <RainbowStrip height={10} />
        </div>

        {viewMode === "average" ? (
          <div className="rounded-md border border-border bg-white p-3 flex flex-col items-center">
            <div className="text-[10px] text-muted-foreground mb-1">
              Mean across {pixels.length} sample point{pixels.length > 1 ? "s" : ""}
            </div>
            <HsiGauge
              value={hasMeasure ? hsiAvg.scenario : hsiAvg.baseline}
              size={156}
              accentColor={hasMeasure ? SEAGRASS_COLOR : BASELINE_COLOR}
              baselineValue={hasMeasure ? hsiAvg.baseline : undefined}
              label={
                hasMeasure
                  ? `baseline ${hsiAvg.baseline.toFixed(2)} → scenario ${hsiAvg.scenario.toFixed(2)}`
                  : `baseline ${hsiAvg.baseline.toFixed(2)}`
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {hsiNow.map(({ pixel: p, baseline, scenario }) => (
              <div key={p.id} className="relative rounded-md border border-border bg-white p-2">
                <button
                  onClick={() => onRemovePixel(p.id)}
                  className="absolute top-1 right-1 w-4 h-4 rounded hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"
                  title="Remove sample point"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
                <div className="flex items-center gap-1 mb-1">
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: p.color }} />
                  <span className="text-[10px] font-mono text-muted-foreground truncate">{fmtCoords(p.x, p.z)}</span>
                </div>
                <HsiGauge
                  value={hasMeasure ? scenario : baseline}
                  size={104}
                  accentColor={hasMeasure ? p.color : BASELINE_COLOR}
                  baselineValue={hasMeasure ? baseline : undefined}
                  label={
                    hasMeasure
                      ? `baseline ${baseline.toFixed(2)} → scenario ${scenario.toFixed(2)}`
                      : `baseline ${baseline.toFixed(2)}`
                  }
                />
              </div>
            ))}
          </div>
        )}

        <div className="text-[9px] text-muted-foreground mt-1 leading-snug">
          {hasMeasure
            ? "Coloured arc = scenario seagrass HSI · dark tick = baseline · gradient strip is the bay's HSI legend."
            : "Showing baseline seagrass HSI · pick a measure above to overlay the scenario."}
        </div>
      </div>

      {/* Dumbbell — baseline → scenario at a glance */}
      <div>
        <div className="panel-section-title mb-1">
          Seagrass carbon · {hasMeasure ? "baseline → scenario" : "baseline"}
        </div>
        <div className="text-[9px] text-muted-foreground mb-2">
          Annual sequestration · tCO₂e/ha · summed across {pixels.length} sample point{pixels.length > 1 ? "s" : ""}
        </div>
        {(() => {
          // Scale: a touch of headroom so dots don't kiss the right edge.
          const axisMax = Math.max(annual.baseline, annual.scenario, 0.01) * 1.15;
          const baselinePct = (annual.baseline / axisMax) * 100;
          const scenarioPct = (annual.scenario / axisMax) * 100;
          const lo = Math.min(baselinePct, scenarioPct);
          const hi = Math.max(baselinePct, scenarioPct);
          const midPct = (baselinePct + scenarioPct) / 2;
          return (
            <div className="rounded-md border border-border bg-white px-3 pt-7 pb-6">
              <div className="relative h-3">
                {/* full-range track */}
                <div className="absolute left-1.5 right-1.5 top-1/2 -translate-y-1/2 h-px bg-border" />

                {/* connector segment between baseline and scenario */}
                {hasMeasure && (
                  <div
                    className="absolute top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-emerald-400"
                    style={{ left: `${lo}%`, width: `${hi - lo}%` }}
                  />
                )}

                {/* baseline dot + label */}
                <div
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-slate-400 border-2 border-white ring-1 ring-slate-300 z-10"
                  style={{ left: `${baselinePct}%` }}
                  title={`Baseline ${annual.baseline.toFixed(2)} tCO₂e/ha`}
                />
                <div
                  className="absolute -translate-x-1/2 text-[9px] font-mono text-muted-foreground whitespace-nowrap"
                  style={{ left: `${baselinePct}%`, top: "calc(100% + 4px)" }}
                >
                  {annual.baseline.toFixed(2)}
                </div>

                {/* scenario dot + label (only when a measure is applied) */}
                {hasMeasure && (
                  <>
                    <div
                      className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-emerald-600 border-2 border-white ring-1 ring-emerald-300 z-10"
                      style={{ left: `${scenarioPct}%` }}
                      title={`Scenario ${annual.scenario.toFixed(2)} tCO₂e/ha`}
                    />
                    <div
                      className="absolute -translate-x-1/2 text-[9px] font-mono font-semibold text-emerald-700 whitespace-nowrap"
                      style={{ left: `${scenarioPct}%`, top: "calc(100% + 4px)" }}
                    >
                      {annual.scenario.toFixed(2)}
                    </div>
                    <div
                      className={`absolute -translate-x-1/2 text-[10px] font-mono font-bold whitespace-nowrap
                        ${annual.delta >= 0 ? "text-emerald-700" : "text-rose-700"}`}
                      style={{ left: `${midPct}%`, top: "-20px" }}
                    >
                      Δ {annual.delta >= 0 ? "+" : ""}{annual.delta.toFixed(2)}
                    </div>
                  </>
                )}
              </div>

              {/* axis end-labels */}
              <div className="flex justify-between text-[9px] font-mono text-muted-foreground mt-3">
                <span>0</span>
                <span>{axisMax.toFixed(2)}</span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Baseline vs scenario annual sequestration */}
      <div>
        <div className="panel-section-title mb-1">
          {hasMeasure ? "Seagrass carbon · baseline vs scenario" : "Seagrass carbon · baseline"}
        </div>
        <div className="text-[9px] text-muted-foreground mb-1">
          Annual sequestration · tCO₂e/ha · summed across {pixels.length} sample point{pixels.length > 1 ? "s" : ""}
        </div>
        <div className="h-[140px] -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={compareData} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="2 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#6b7280" }} />
              <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} />
              <Tooltip
                contentStyle={{ fontSize: 10, padding: "4px 8px", borderRadius: 4 }}
                formatter={(v: number) => [`${v.toFixed(2)} tCO₂e/ha`, "annual"]}
              />
              <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {compareData.map((d) => (
                  <Cell key={d.key} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: BASELINE_COLOR }} />
            Baseline {annual.baseline.toFixed(2)}
          </span>
          {hasMeasure && (
            <>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: SEAGRASS_COLOR }} />
                Scenario {annual.scenario.toFixed(2)}
              </span>
              <span className={`font-mono ${annual.delta >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                Δ {annual.delta >= 0 ? "+" : ""}{annual.delta.toFixed(2)}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="text-[9px] text-muted-foreground italic leading-snug pt-1 border-t border-border/50">
        Modeled values · synthetic baseline + measure response. Eelgrass
        (Zostera marina) is Shizugawa Bay's signature blue-carbon habitat;
        all measures are valued by their effect on seagrass carbon.
        Replace with calibrated J-Blue Credit factors for production use.
      </div>
    </div>
  );
}
