import { useMemo } from "react";
import { X, Layers, BarChart3, Sigma, MapPin, Mountain, TreePine } from "lucide-react";
import {
  SUB_BASIN_INDICATORS,
  SUB_BASIN_META,
  aggregateSubBasins,
  getSubBasin,
  type SubBasinMeta,
  type SubBasinIndicatorDef,
} from "@/lib/simulatedData";

// ── Visual constants ────────────────────────────────────────────────────────
//
// The sidebar is 360px wide; each mini-chart consumes the inner width
// (≈ 312px after padding) and stacks vertically.  Height per chart is fixed
// so all 5 indicators read at the same scale on screen.
const CHART_INNER_W = 308;
const CHART_H        = 110;
const PAD_L = 36, PAD_R = 8, PAD_T = 8, PAD_B = 22;

const LAND_USE_LABEL: Record<string, string> = {
  forest: "Forest",
  agricultural: "Agricultural",
  mixed: "Mixed",
  urban: "Urban",
  coastal: "Coastal",
};

// ── Number formatting ──────────────────────────────────────────────────────
function fmt(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(1) + "M";
  if (Math.abs(value) >= 1e3) return (value / 1e3).toFixed(1) + "k";
  return value.toFixed(decimals);
}

// ── Comparison bar chart (per-basin bars) ───────────────────────────────────

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

  // Y axis spans 0 → max(healthy×1.3, observed×1.1) so the healthy reference
  // line sits in the upper portion of the chart and bars never get clipped
  // when a basin exceeds the threshold.
  const observedMax = rows.reduce((m, r) => Math.max(m, r.value), 0);
  const yMax = Math.max(indicator.healthy * 1.3, observedMax * 1.1, 1);

  const n      = Math.max(1, rows.length);
  const slot   = innerW / n;
  const barW   = Math.max(4, Math.min(28, slot * 0.7));
  const barGap = slot - barW;

  const toY = (v: number) => PAD_T + innerH - (v / yMax) * innerH;
  const yHealthy = toY(indicator.healthy);

  // Show 3 y-ticks: 0, healthy, yMax
  const yTicks = [
    { v: 0,                 label: "0" },
    { v: indicator.healthy, label: fmt(indicator.healthy, 0) },
    { v: yMax,              label: fmt(yMax, 0) },
  ];

  return (
    <svg width={CHART_INNER_W} height={CHART_H} className="overflow-visible block">
      {/* Y grid + tick labels */}
      {yTicks.map(({ v, label }) => {
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

      {/* Healthy threshold line */}
      <g>
        <line
          x1={PAD_L} y1={yHealthy} x2={CHART_INNER_W - PAD_R} y2={yHealthy}
          stroke="#10b981" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.85"
        />
        <text x={CHART_INNER_W - PAD_R} y={yHealthy - 3} textAnchor="end"
          fontSize="8" fill="#059669" fontFamily="monospace" fontWeight="600">
          healthy {fmt(indicator.healthy, 0)}
        </text>
      </g>

      {/* Bars */}
      {rows.map((r, i) => {
        const x = PAD_L + i * slot + barGap / 2;
        const y = toY(r.value);
        const h = (PAD_T + innerH) - y;
        const overHealthy = r.value > indicator.healthy;
        return (
          <g key={r.id}>
            <rect
              x={x} y={y} width={barW} height={Math.max(0, h)}
              fill={r.color}
              stroke={overHealthy ? "#dc2626" : "transparent"}
              strokeWidth={overHealthy ? 1 : 0}
              rx="1.5"
            >
              <title>{`${r.name}: ${fmt(r.value, indicator.decimals)} ${indicator.unit}`}</title>
            </rect>
            {/* Sub-basin id label below each bar */}
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
  );
}

// ── Aggregate (single-bar) chart ───────────────────────────────────────────

function AggregateBarChart({
  indicator,
  total,
  effectiveHealthy,
  totalUnit,
}: {
  indicator: SubBasinIndicatorDef;
  total: number;
  // For density indicators the user-facing healthy threshold also gets scaled
  // by total area, so the dashed reference line still lives in the same
  // "100% of healthy" position even though the unit is now absolute kg.
  effectiveHealthy: number;
  totalUnit: string;
}) {
  const innerW = CHART_INNER_W - PAD_L - PAD_R;
  const innerH = CHART_H - PAD_T - PAD_B;
  const yMax = Math.max(effectiveHealthy * 1.3, total * 1.1, 1);
  const toY = (v: number) => PAD_T + innerH - (v / yMax) * innerH;
  const yHealthy = toY(effectiveHealthy);
  const overHealthy = total > effectiveHealthy;

  const barW = Math.min(160, innerW * 0.6);
  const barX = PAD_L + (innerW - barW) / 2;
  const barY = toY(total);
  const barH = (PAD_T + innerH) - barY;

  return (
    <svg width={CHART_INNER_W} height={CHART_H} className="overflow-visible block">
      {/* Y axis labels (0 / healthy / max) */}
      {[
        { v: 0,                label: "0" },
        { v: effectiveHealthy, label: fmt(effectiveHealthy, 0) },
        { v: yMax,             label: fmt(yMax, 0) },
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

      {/* Healthy line (area-weighted for densities) */}
      <line
        x1={PAD_L} y1={yHealthy} x2={CHART_INNER_W - PAD_R} y2={yHealthy}
        stroke="#10b981" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.85"
      />
      <text x={CHART_INNER_W - PAD_R} y={yHealthy - 3} textAnchor="end"
        fontSize="8" fill="#059669" fontFamily="monospace" fontWeight="600">
        healthy {fmt(effectiveHealthy, 0)}
      </text>

      {/* Total bar */}
      <rect
        x={barX} y={barY} width={barW} height={Math.max(0, barH)}
        fill="#0f172a"
        stroke={overHealthy ? "#dc2626" : "transparent"}
        strokeWidth={overHealthy ? 1.2 : 0}
        rx="2"
      />
      <text x={barX + barW / 2} y={barY - 4} textAnchor="middle"
        fontSize="10" fill="#0f172a" fontFamily="monospace" fontWeight="700">
        {fmt(total, indicator.decimals)} {totalUnit}
      </text>

      {/* Caption */}
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

// ── Single-basin radar (used for n=1 selection) ────────────────────────────

function SingleBasinRadar({ basin, color }: { basin: SubBasinMeta; color: string }) {
  const W = CHART_INNER_W;
  const H = 240;
  const cx = W / 2, cy = H / 2 + 6;
  const R  = 78;

  const N = SUB_BASIN_INDICATORS.length;
  // Each axis is normalised to its own healthy threshold (so the healthy
  // polygon is a regular pentagon).  Numeric labels stay in absolute units.
  const angleFor = (i: number) => -Math.PI / 2 + (i / N) * Math.PI * 2;

  // Healthy reference polygon at radius corresponding to "1.0 × healthy"
  const HEALTHY_FRAC = 1.0;
  // Outer ring at "1.3 × healthy" matches the bar chart envelope
  const MAX_FRAC     = 1.3;

  const ringFrac = HEALTHY_FRAC / MAX_FRAC;     // healthy ring radius / R

  const point = (frac: number, i: number) => {
    const r = (Math.min(MAX_FRAC, Math.max(0, frac)) / MAX_FRAC) * R;
    const a = angleFor(i);
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  };

  // Build the basin polygon
  const basinPts = SUB_BASIN_INDICATORS.map((ind, i) => {
    const v = basin.indicators[ind.id];
    return point(v / ind.healthy, i);
  });
  const basinPath = basinPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  // Healthy reference polygon (HEALTHY_FRAC ring)
  const healthyPath = SUB_BASIN_INDICATORS
    .map((_, i) => point(HEALTHY_FRAC, i))
    .map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  return (
    <svg width={W} height={H} className="block">
      {/* Concentric grid circles at 0.25, 0.5, 0.75, 1.0, max */}
      {[0.25, 0.5, 0.75].map(f => (
        <circle key={f} cx={cx} cy={cy} r={(f * HEALTHY_FRAC / MAX_FRAC) * R}
          fill="none" stroke="#e2e8f0" strokeWidth="0.6" />
      ))}
      {/* Healthy ring */}
      <circle cx={cx} cy={cy} r={ringFrac * R}
        fill="none" stroke="#10b981" strokeWidth="1" strokeDasharray="3 2" opacity="0.6" />
      {/* Outer ring (max) */}
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="#cbd5e1" strokeWidth="0.8" />

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
      {basinPts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2.2" fill={color}
          stroke="white" strokeWidth="1" />
      ))}
    </svg>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────

interface Props {
  selectedIds: number[];
  colorFor:    (id: number) => string;
  aggregate:   boolean;
  onSetAggregate:    (v: boolean) => void;
  onRemove:          (id: number) => void;
  onClear:           () => void;
  onSelectAll:       () => void;
  onSelectAllDeselect: () => void;
}

export default function SubBasinComparisonPanel({
  selectedIds,
  colorFor,
  aggregate,
  onSetAggregate,
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
  const aggResult = useMemo(
    () => aggregateSubBasins(selectedIds),
    [selectedIds],
  );

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
          <div className="px-3 py-3 space-y-4">
            {/* Mode banner */}
            <div className={[
              "rounded-md border px-2.5 py-1.5 text-[10.5px] flex items-center gap-1.5",
              aggregate
                ? "bg-primary/8 border-primary/25 text-primary"
                : "bg-muted/40 border-border text-muted-foreground",
            ].join(" ")}>
              {aggregate ? <Sigma size={11} /> : <BarChart3 size={11} />}
              {aggregate
                ? `Showing total across ${selectedIds.length} sub-basins (${totalArea.toLocaleString()} ha)`
                : `Comparing ${selectedIds.length} sub-basins side-by-side`}
            </div>

            {/* 5 mini-charts, one per indicator */}
            {SUB_BASIN_INDICATORS.map(ind => {
              if (aggregate) {
                const total = aggResult.values[ind.id];
                const effectiveHealthy = ind.additive
                  ? ind.healthy
                  : ind.healthy * aggResult.totalArea;
                return (
                  <ChartCard key={ind.id} indicator={ind} aggregate={true}>
                    <AggregateBarChart
                      indicator={ind}
                      total={total}
                      effectiveHealthy={effectiveHealthy}
                      totalUnit={ind.totalUnit}
                    />
                  </ChartCard>
                );
              }
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
            % of healthy ring shown
          </span>
        </div>
        <SingleBasinRadar basin={basin} color={color} />
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
