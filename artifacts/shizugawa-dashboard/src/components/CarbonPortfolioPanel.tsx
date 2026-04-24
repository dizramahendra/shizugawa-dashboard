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

const EVAL_WEEK = TOTAL_WEEKS - 1; // end-of-year — measure is fully ramped

const SEAGRASS_COLOR  = "#059669"; // emerald-600
const BASELINE_COLOR  = "#94a3b8"; // slate-400

export default function CarbonPortfolioPanel({
  pixels, measure, year,
  onChangeMeasure, onRemovePixel,
}: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("per-pixel");

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
        // Theoretical max per hectare for an ideal Zostera marina meadow.
        // ~6 tCO₂e/ha/yr is a published upper bound for healthy eelgrass.
        // Project-area ceiling scales with the number of selected pixels so
        // the % stays meaningful regardless of project size.
        const PER_PIXEL_CAPACITY = 6;
        const capacityCeiling   = PER_PIXEL_CAPACITY * pixels.length;
        const heroValue         = hasMeasure ? annual.scenario : annual.baseline;
        const capacityPct       = capacityCeiling > 0
          ? Math.min(100, (heroValue / capacityCeiling) * 100)
          : 0;
        const baselineCapPct    = capacityCeiling > 0
          ? Math.min(100, (annual.baseline / capacityCeiling) * 100)
          : 0;
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
                  <span className="text-xs opacity-95 font-medium">tCO₂e / ha / year</span>
                </div>
                {hasMeasure ? (
                  <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/20 backdrop-blur text-[11px] font-mono font-semibold">
                    <span>{annual.delta >= 0 ? "▲" : "▼"}</span>
                    <span>
                      {annual.delta >= 0 ? "+" : ""}{annual.delta.toFixed(2)} vs baseline
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
                  {hasMeasure && annual.baseline > 0 && (
                    <div
                      className="absolute top-[-2px] bottom-[-2px] w-[2px] bg-slate-700"
                      style={{ left: `calc(${baselineCapPct}% - 1px)` }}
                      title={`Baseline ${annual.baseline.toFixed(2)} tCO₂e/ha/yr`}
                    />
                  )}
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
                  <span>0</span>
                  <span>{capacityCeiling.toFixed(0)} tCO₂e/ha/yr</span>
                </div>
              </div>
            </div>

            <div className="mt-2 text-[10px] text-muted-foreground leading-snug">
              {hasMeasure
                ? "Annual seagrass carbon at full ramp under the selected measure, against the theoretical maximum for an ideal Zostera marina meadow."
                : "Baseline annual seagrass carbon for the selected sample points, against the theoretical maximum for an ideal Zostera marina meadow."}
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
