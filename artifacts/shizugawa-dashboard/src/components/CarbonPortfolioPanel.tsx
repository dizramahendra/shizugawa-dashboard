import { useMemo } from "react";
import { X, Leaf, TrendingUp } from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis,
  ReferenceLine, Tooltip, CartesianGrid,
} from "recharts";
import {
  DECARB_MEASURES, MeasureId, getMeasure,
  buildBlueCarbonSeries, getBaselineHsi, getScenarioHsi, getWeekLabel,
  CHANNEL_LABELS, CHANNEL_COLORS, gridToLonLat,
} from "@/lib/simulatedData";
import HsiGauge, { RainbowStrip } from "@/components/HsiGauge";

export interface PortfolioPixel {
  id: string;
  x: number;
  z: number;
  color: string;
}

interface Props {
  pixels:        PortfolioPixel[];
  measure:       MeasureId;
  appliedAtWeek: number;
  week:          number;
  weekRange:     [number, number];
  year:          number;
  onChangeMeasure: (m: MeasureId) => void;
  onRemovePixel:   (id: string) => void;
}

const fmtCoords = (x: number, z: number) => {
  const { lon, lat } = gridToLonLat(x, z);
  return `${lat.toFixed(3)}°N · ${lon.toFixed(3)}°E`;
};

export default function CarbonPortfolioPanel({
  pixels, measure, appliedAtWeek, week, weekRange, year,
  onChangeMeasure, onRemovePixel,
}: Props) {
  // Per-pixel time series across the active playback range
  const series = useMemo(() => {
    return pixels.map((p) => ({
      pixel: p,
      carbon: buildBlueCarbonSeries(weekRange[0], weekRange[1], year, p.x, p.z, measure, appliedAtWeek),
    }));
  }, [pixels, weekRange, year, measure, appliedAtWeek]);

  // Avoided emissions across the project area = sum across pixels of
  // (scenarioCum − baselineCum) at the last week in the range.
  const cumDelta = useMemo(() => {
    let total = 0;
    for (const s of series) {
      const last = s.carbon[s.carbon.length - 1];
      if (last) total += last.scenarioCum - last.baselineCum;
    }
    return total;
  }, [series]);

  // Stacked-area data: weekly cumulative scenario contribution per channel,
  // averaged across selected pixels (the project-area contribution per ha).
  const stackedData = useMemo(() => {
    if (series.length === 0) return [];
    const weeks = series[0].carbon.length;
    const rows: Record<string, number | string>[] = [];
    for (let i = 0; i < weeks; i++) {
      const w = weekRange[0] + i;
      let s = 0, m = 0, o = 0;
      for (const ser of series) {
        const pt = ser.carbon[i];
        if (!pt) continue;
        s += pt.channelsCum.seagrass;
        m += pt.channelsCum.macroalgae;
        o += pt.channelsCum.oyster;
      }
      const n = series.length;
      rows.push({
        week: w,
        label: getWeekLabel(w, year).label,
        seagrass:   s / n,
        macroalgae: m / n,
        oyster:     o / n,
      });
    }
    return rows;
  }, [series, weekRange, year]);

  // Per-pixel HSI sparkline data + current-week gauge values
  const hsiNow = useMemo(() => {
    return pixels.map((p) => ({
      pixel: p,
      baseline: getBaselineHsi(week, year, p.x, p.z),
      scenario: getScenarioHsi(week, year, p.x, p.z, measure, appliedAtWeek),
    }));
  }, [pixels, week, year, measure, appliedAtWeek]);

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
            Click up to 4 ocean cells to define your project area. Avoided emissions and HSI gauges appear once you drop at least one sample point.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 space-y-4">
      {MeasureSelect}

      {/* Avoided-emissions KPI */}
      <div className="rounded-md border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-emerald-700 font-semibold">
          <TrendingUp className="w-3 h-3" />
          Avoided emissions · project area
        </div>
        <div className="mt-1 flex items-baseline gap-1">
          <span className={`text-2xl font-mono font-bold ${cumDelta >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
            {cumDelta >= 0 ? "+" : ""}{cumDelta.toFixed(2)}
          </span>
          <span className="text-xs text-muted-foreground">tCO₂e/ha · over playback range</span>
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          Scenario − baseline, summed across {pixels.length} sample point{pixels.length > 1 ? "s" : ""}.
        </div>
      </div>

      {/* HSI gauges per sample point */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="panel-section-title">Habitat suitability · sample points</div>
          <div className="text-[9px] font-mono text-muted-foreground">week {week + 1}</div>
        </div>
        <div className="mb-2">
          <RainbowStrip height={10} />
        </div>
        <div className={`grid ${pixels.length <= 2 ? "grid-cols-2" : "grid-cols-2"} gap-2`}>
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
        <div className="text-[9px] text-muted-foreground mt-1 leading-snug">
          Coloured arc = scenario HSI · dark tick = baseline HSI · gradient strip is the bay's HSI legend.
        </div>
      </div>

      {/* Cumulative blue carbon, stacked by channel */}
      <div>
        <div className="panel-section-title mb-1">Blue carbon · cumulative breakdown</div>
        <div className="text-[9px] text-muted-foreground mb-1">
          tCO₂e/ha (project-area mean) · stacked by mechanism · since week {weekRange[0] + 1}
        </div>
        <div className="h-[170px] -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stackedData} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="2 3" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 9, fill: "#6b7280" }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} />
              <Tooltip
                contentStyle={{ fontSize: 10, padding: "4px 8px", borderRadius: 4 }}
                labelFormatter={(w) => `Week ${(w as number) + 1}`}
                formatter={(v: number, name: string) => [`${v.toFixed(2)} tCO₂e/ha`, name]}
              />
              <ReferenceLine x={week} stroke="#0f172a" strokeWidth={1} strokeDasharray="3 2" />
              <Area type="monotone" dataKey="seagrass"   stackId="bc" stroke={CHANNEL_COLORS.seagrass}   fill={CHANNEL_COLORS.seagrass}   fillOpacity={0.55} name={CHANNEL_LABELS.seagrass}   isAnimationActive={false} />
              <Area type="monotone" dataKey="macroalgae" stackId="bc" stroke={CHANNEL_COLORS.macroalgae} fill={CHANNEL_COLORS.macroalgae} fillOpacity={0.55} name={CHANNEL_LABELS.macroalgae} isAnimationActive={false} />
              <Area type="monotone" dataKey="oyster"     stackId="bc" stroke={CHANNEL_COLORS.oyster}     fill={CHANNEL_COLORS.oyster}     fillOpacity={0.55} name={CHANNEL_LABELS.oyster}     isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[9px]">
          {(["seagrass", "macroalgae", "oyster"] as const).map((ch) => (
            <span key={ch} className="inline-flex items-center gap-1 text-muted-foreground">
              <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: CHANNEL_COLORS[ch] }} />
              {CHANNEL_LABELS[ch]}
            </span>
          ))}
        </div>
      </div>

      {/* Per-pixel scenario rate sparkline (one line per pixel, total flux) */}
      <div>
        <div className="panel-section-title mb-1">Scenario flux per sample point</div>
        <div className="text-[9px] text-muted-foreground mb-1">tCO₂e/ha/yr · solid scenario · scrub to inspect</div>
        <div className="h-[110px] -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={(() => {
                const rows: Record<string, number | string>[] = [];
                for (let i = 0; i < (series[0]?.carbon.length ?? 0); i++) {
                  const w = weekRange[0] + i;
                  const row: Record<string, number | string> = { week: w };
                  series.forEach((s, idx) => {
                    const pt = s.carbon[i];
                    row[`p${idx}`] = pt ? pt.scenarioRate : 0;
                  });
                  rows.push(row);
                }
                return rows;
              })()}
              margin={{ top: 4, right: 8, bottom: 0, left: -22 }}
            >
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="2 3" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 9, fill: "#6b7280" }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} />
              <Tooltip
                contentStyle={{ fontSize: 10, padding: "4px 8px", borderRadius: 4 }}
                labelFormatter={(w) => `Week ${(w as number) + 1}`}
                formatter={(v: number) => `${v.toFixed(2)} tCO₂e/ha/yr`}
              />
              <ReferenceLine x={week} stroke="#0f172a" strokeWidth={1} strokeDasharray="3 2" />
              {pixels.map((p, i) => (
                <Line key={i} type="monotone" dataKey={`p${i}`} stroke={p.color} strokeWidth={1.6} dot={false} isAnimationActive={false} name={`P${i + 1}`} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="text-[9px] text-muted-foreground italic leading-snug pt-1 border-t border-border/50">
        Modeled values · synthetic baseline + measure response. The portfolio
        approach treats the selected cells as sample points inside one project
        area sharing the same measure. Replace with calibrated HSI + J-Blue
        Credit factors for production use.
      </div>
    </div>
  );
}
