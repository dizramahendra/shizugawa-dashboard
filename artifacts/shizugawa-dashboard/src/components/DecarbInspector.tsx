import { useMemo } from "react";
import { X, Leaf, TrendingUp } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, ReferenceArea, ReferenceLine,
  Tooltip, AreaChart, Area, CartesianGrid,
} from "recharts";
import {
  DECARB_MEASURES, MeasureId, getMeasure, hsiBand, HSI_BANDS,
  buildHsiSeries, buildCarbonSeries, getWeekLabel, GRID_W, GRID_D,
} from "@/lib/simulatedData";

const BAY_LON_W = 141.383, BAY_LON_E = 141.468;
const BAY_LAT_S = 38.582,  BAY_LAT_N = 38.651;

export interface SelectedPixel {
  id: string;             // stable key, e.g. "x:z"
  x: number;
  z: number;
  color: string;          // PIXEL_PALETTE entry
  measure: MeasureId;
  /** week at which the measure was switched on (default = weekRange[0]) */
  appliedAtWeek: number;
}

interface Props {
  pixels:     SelectedPixel[];
  week:       number;
  weekRange:  [number, number];
  year:       number;
  onChangeMeasure: (id: string, measure: MeasureId) => void;
  onRemovePixel:   (id: string) => void;
}

const fmtCoords = (x: number, z: number) => {
  const lon = (BAY_LON_W + (x / (GRID_W - 1)) * (BAY_LON_E - BAY_LON_W)).toFixed(3);
  const lat = (BAY_LAT_S + (z / (GRID_D - 1)) * (BAY_LAT_N - BAY_LAT_S)).toFixed(3);
  return `${lat}°N · ${lon}°E`;
};

export default function DecarbInspector({
  pixels, week, weekRange, year, onChangeMeasure, onRemovePixel,
}: Props) {
  // Build per-pixel time-series across the active playback range
  const series = useMemo(() => {
    return pixels.map((p) => ({
      pixel: p,
      hsi:    buildHsiSeries   (weekRange[0], weekRange[1], year, p.x, p.z, p.measure, p.appliedAtWeek),
      carbon: buildCarbonSeries(weekRange[0], weekRange[1], year, p.x, p.z, p.measure, p.appliedAtWeek),
    }));
  }, [pixels, weekRange, year]);

  // Joined dataset for the HSI line chart (one row per week, one series per pixel)
  const hsiData = useMemo(() => {
    const rows: Record<string, number | string>[] = [];
    for (let w = weekRange[0]; w <= weekRange[1]; w++) {
      const row: Record<string, number | string> = { week: w, label: getWeekLabel(w, year).label };
      series.forEach((s, i) => {
        const point = s.hsi[w - weekRange[0]];
        row[`b${i}`] = point.baseline;
        row[`s${i}`] = point.scenario;
      });
      rows.push(row);
    }
    return rows;
  }, [series, weekRange, year]);

  const carbonData = useMemo(() => {
    const rows: Record<string, number | string>[] = [];
    for (let w = weekRange[0]; w <= weekRange[1]; w++) {
      const row: Record<string, number | string> = { week: w, label: getWeekLabel(w, year).label };
      series.forEach((s, i) => {
        const point = s.carbon[w - weekRange[0]];
        row[`bc${i}`] = point.baselineCum;
        row[`sc${i}`] = point.scenarioCum;
      });
      rows.push(row);
    }
    return rows;
  }, [series, weekRange, year]);

  // Cumulative carbon delta = sum across pixels of (scenario − baseline) at the
  // last week in the playback range.
  const cumDelta = useMemo(() => {
    let total = 0;
    series.forEach((s) => {
      const last = s.carbon[s.carbon.length - 1];
      if (last) total += last.scenarioCum - last.baselineCum;
    });
    return total;
  }, [series]);

  // ── EMPTY STATE ──────────────────────────────────────────────────────────
  if (pixels.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <div className="mx-auto w-10 h-10 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-3">
          <Leaf className="w-5 h-5 text-emerald-600" />
        </div>
        <div className="text-sm font-medium text-foreground mb-1">Decarbonization simulator</div>
        <div className="text-xs text-muted-foreground leading-relaxed max-w-[220px] mx-auto">
          Click up to 4 ocean cells to compare habitat suitability and seagrass-carbon flux. Apply a measure to see the avoided emissions.
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Cumulative-impact KPI */}
      <div className="rounded-md border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-emerald-700 font-semibold">
          <TrendingUp className="w-3 h-3" />
          Avoided emissions · selected pixels
        </div>
        <div className="mt-1 flex items-baseline gap-1">
          <span className={`text-2xl font-mono font-bold ${cumDelta >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
            {cumDelta >= 0 ? "+" : ""}{cumDelta.toFixed(2)}
          </span>
          <span className="text-xs text-muted-foreground">tCO₂e/ha · over playback range</span>
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          Scenario − baseline, summed across {pixels.length} pixel{pixels.length > 1 ? "s" : ""}.
        </div>
      </div>

      {/* Per-pixel cards with measure dropdown */}
      <div className="space-y-2">
        <div className="panel-section-title">Selected pixels & measures</div>
        {pixels.map((p) => {
          const baselineHsiNow = hsiData[week - weekRange[0]]?.[`b${pixels.indexOf(p)}`] as number ?? 0;
          const scenarioHsiNow = hsiData[week - weekRange[0]]?.[`s${pixels.indexOf(p)}`] as number ?? 0;
          const band = hsiBand(scenarioHsiNow);
          return (
            <div key={p.id} className="rounded-md border border-border bg-white p-2.5">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: p.color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-mono text-foreground truncate">{fmtCoords(p.x, p.z)}</div>
                  <div className="text-[9px] text-muted-foreground">grid ({p.x}, {p.z})</div>
                </div>
                <span
                  className="text-[9px] font-semibold rounded px-1.5 py-0.5"
                  style={{ backgroundColor: band.color, color: band.text }}
                  title={`Current scenario HSI: ${scenarioHsiNow.toFixed(2)}`}
                >
                  {band.label}
                </span>
                <button
                  onClick={() => onRemovePixel(p.id)}
                  className="w-5 h-5 rounded hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"
                  title="Remove pixel"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="mt-2">
                <label className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold">
                  Decarbonization measure
                </label>
                <select
                  className="mt-0.5 w-full text-[11px] h-7 px-1.5 rounded border border-border bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                  value={p.measure}
                  onChange={(e) => onChangeMeasure(p.id, e.target.value as MeasureId)}
                >
                  {DECARB_MEASURES.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                {p.measure !== "none" && (
                  <div className="mt-1 text-[9px] text-muted-foreground leading-snug">
                    {getMeasure(p.measure).desc}
                  </div>
                )}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1 text-[10px]">
                <div className="bg-muted/50 rounded p-1">
                  <div className="text-muted-foreground">Baseline HSI</div>
                  <div className="font-mono font-semibold">{baselineHsiNow.toFixed(2)}</div>
                </div>
                <div className="rounded p-1" style={{ backgroundColor: p.color + "18" }}>
                  <div className="text-muted-foreground">Scenario HSI</div>
                  <div className="font-mono font-semibold" style={{ color: p.color }}>{scenarioHsiNow.toFixed(2)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* HSI banded line chart */}
      <div>
        <div className="panel-section-title mb-1">Habitat suitability (HSI)</div>
        <div className="text-[9px] text-muted-foreground mb-1">0 = unsuitable · 1 = excellent · solid = scenario · dashed = baseline</div>
        <div className="h-[160px] -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={hsiData} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
              {HSI_BANDS.map((b) => (
                <ReferenceArea key={b.label} y1={b.from} y2={Math.min(1, b.to)} fill={b.color} fillOpacity={0.35} stroke="none" />
              ))}
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="2 3" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 9, fill: "#6b7280" }} interval="preserveStartEnd" />
              <YAxis domain={[0, 1]} tick={{ fontSize: 9, fill: "#6b7280" }} ticks={[0, 0.3, 0.6, 0.85, 1]} />
              <Tooltip
                contentStyle={{ fontSize: 10, padding: "4px 8px", borderRadius: 4 }}
                labelFormatter={(w) => `Week ${(w as number) + 1}`}
                formatter={(v: number) => v.toFixed(2)}
              />
              <ReferenceLine x={week} stroke="#0f172a" strokeWidth={1} strokeDasharray="3 2" />
              {pixels.map((p, i) => (
                <Line key={`b${i}`} type="monotone" dataKey={`b${i}`} stroke={p.color} strokeOpacity={0.45} strokeDasharray="3 3" strokeWidth={1} dot={false} isAnimationActive={false} name={`P${i + 1} baseline`} />
              ))}
              {pixels.map((p, i) => (
                <Line key={`s${i}`} type="monotone" dataKey={`s${i}`} stroke={p.color} strokeWidth={1.8} dot={false} isAnimationActive={false} name={`P${i + 1} scenario`} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Cumulative seagrass carbon */}
      <div>
        <div className="panel-section-title mb-1">Cumulative seagrass carbon</div>
        <div className="text-[9px] text-muted-foreground mb-1">tCO₂e / ha · accumulated since week {weekRange[0] + 1}</div>
        <div className="h-[160px] -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={carbonData} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
              <defs>
                {pixels.map((p, i) => (
                  <linearGradient key={i} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={p.color} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={p.color} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="2 3" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 9, fill: "#6b7280" }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} />
              <Tooltip
                contentStyle={{ fontSize: 10, padding: "4px 8px", borderRadius: 4 }}
                labelFormatter={(w) => `Week ${(w as number) + 1}`}
                formatter={(v: number) => `${v.toFixed(2)} tCO₂e/ha`}
              />
              <ReferenceLine x={week} stroke="#0f172a" strokeWidth={1} strokeDasharray="3 2" />
              {pixels.map((p, i) => (
                <Area key={`bc${i}`} type="monotone" dataKey={`bc${i}`} stroke={p.color} strokeOpacity={0.4} strokeDasharray="3 3" fill="none" strokeWidth={1} isAnimationActive={false} name={`P${i + 1} baseline`} />
              ))}
              {pixels.map((p, i) => (
                <Area key={`sc${i}`} type="monotone" dataKey={`sc${i}`} stroke={p.color} strokeWidth={1.8} fill={`url(#grad-${i})`} isAnimationActive={false} name={`P${i + 1} scenario`} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="text-[9px] text-muted-foreground italic leading-snug pt-1 border-t border-border/50">
        Modeled values · synthetic baseline + measure response. Replace with calibrated HSI and eelgrass-carbon model for production use.
      </div>
    </div>
  );
}
