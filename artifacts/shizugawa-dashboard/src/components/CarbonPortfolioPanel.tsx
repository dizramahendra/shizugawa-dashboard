import { useMemo, useState } from "react";
import { X, Leaf, TrendingUp, Layers, LayoutGrid } from "lucide-react";
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

  const compareData = useMemo(
    () => [
      { key: "baseline", label: "Baseline", value: annual.baseline, color: BASELINE_COLOR },
      { key: "scenario", label: "Scenario", value: annual.scenario, color: SEAGRASS_COLOR },
    ],
    [annual],
  );

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

      {/* Avoided-emissions KPI (annual, steady-state) */}
      <div className="rounded-md border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-emerald-700 font-semibold">
          <TrendingUp className="w-3 h-3" />
          Annual seagrass-carbon gain
        </div>
        <div className="mt-1 flex items-baseline gap-1">
          <span className={`text-2xl font-mono font-bold ${annual.delta >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
            {annual.delta >= 0 ? "+" : ""}{annual.delta.toFixed(2)}
          </span>
          <span className="text-xs text-muted-foreground">tCO₂e/ha · per year</span>
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          Scenario − baseline at full ramp · summed across {pixels.length} sample point{pixels.length > 1 ? "s" : ""}.
        </div>
      </div>

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
              value={hsiAvg.scenario}
              size={156}
              accentColor={SEAGRASS_COLOR}
              baselineValue={hsiAvg.baseline}
              label={`baseline ${hsiAvg.baseline.toFixed(2)} → scenario ${hsiAvg.scenario.toFixed(2)}`}
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
                  value={scenario}
                  size={104}
                  accentColor={p.color}
                  baselineValue={baseline}
                  label={`baseline ${baseline.toFixed(2)} → scenario ${scenario.toFixed(2)}`}
                />
              </div>
            ))}
          </div>
        )}

        <div className="text-[9px] text-muted-foreground mt-1 leading-snug">
          Coloured arc = scenario seagrass HSI · dark tick = baseline · gradient strip is the bay's HSI legend.
        </div>
      </div>

      {/* Baseline vs scenario annual sequestration */}
      <div>
        <div className="panel-section-title mb-1">Seagrass carbon · baseline vs scenario</div>
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
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: SEAGRASS_COLOR }} />
            Scenario {annual.scenario.toFixed(2)}
          </span>
          <span className={`font-mono ${annual.delta >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
            Δ {annual.delta >= 0 ? "+" : ""}{annual.delta.toFixed(2)}
          </span>
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
