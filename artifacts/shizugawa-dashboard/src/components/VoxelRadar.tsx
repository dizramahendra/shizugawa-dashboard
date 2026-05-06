// Static, hardcoded radar chart for the Ocean Playback "Point Inspection" mode.
// Step 1 of the feature: render the SHAPE only so we can judge axis layout,
// sizing, and overall readability before wiring real per-voxel data.
//
// All values, baselines, and units below are placeholder constants — they do
// NOT reflect the selected voxel. Replaced with real/derived values in step 3.

type AxisDef = {
  id:         "nitrogen" | "phosphorus" | "chla" | "temperature" | "waterFlow";
  shortLabel: string;
  unit:       string;
  decimals:   number;
};

// Axis order (clockwise from top): nutrients grouped at the top, their
// downstream signal (Chl-a) next to them, ambient conditions on the left.
const VOXEL_AXES: readonly AxisDef[] = [
  { id: "nitrogen",    shortLabel: "Nitrogen",    unit: "mg/L",   decimals: 2 },
  { id: "phosphorus",  shortLabel: "Phosphorus",  unit: "mg/L",   decimals: 2 },
  { id: "chla",        shortLabel: "Chlorophyll-a", unit: "mg/m³", decimals: 1 },
  { id: "temperature", shortLabel: "Temperature", unit: "°C",     decimals: 1 },
  { id: "waterFlow",   shortLabel: "Water Flow",  unit: "m/s",    decimals: 2 },
] as const;

// Placeholder per-voxel values + bay-average baselines (so ratio = 1.0× = avg).
// These exist only to give the polygon a non-trivial shape for review.
const SAMPLE_VALUES: Record<AxisDef["id"], number> = {
  nitrogen:    1.42,
  phosphorus:  0.38,
  chla:         4.6,
  temperature: 14.8,
  waterFlow:   0.09,
};
const SAMPLE_BASELINE: Record<AxisDef["id"], number> = {
  nitrogen:    0.90,
  phosphorus:  0.30,
  chla:         2.6,
  temperature: 14.5,
  waterFlow:   0.13,
};

const fmt = (v: number, d: number) =>
  Number.isFinite(v) ? v.toFixed(d) : "—";

export default function VoxelRadar({ depthLabel }: { depthLabel?: string } = {}) {
  const W  = 248;
  const H  = 248;
  const cx = W / 2;
  const cy = H / 2 + 4;
  const R  = 78;

  const N = VOXEL_AXES.length;
  const angleFor = (i: number) => -Math.PI / 2 + (i / N) * Math.PI * 2;

  const BASELINE_FRAC = 1.0;
  const MAX_FRAC      = 2.5; // 5 rings: 0.5, 1.0, 1.5, 2.0, 2.5 (1.0× = ring 2)

  const point = (frac: number, i: number) => {
    const r = (Math.min(MAX_FRAC, Math.max(0, frac)) / MAX_FRAC) * R;
    const a = angleFor(i);
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  };

  const pts = VOXEL_AXES.map((ax, i) => {
    const v = SAMPLE_VALUES[ax.id];
    const b = SAMPLE_BASELINE[ax.id];
    return point(b > 0 ? v / b : 0, i);
  });
  const path = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const baselineRingR = (BASELINE_FRAC / MAX_FRAC) * R;

  const FILL = "#0ea5e9"; // sky-500 — matches the ocean theme

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <div className="text-xs font-semibold text-foreground">
          Voxel indicator profile · radar
          {depthLabel && (
            <span className="ml-1.5 font-mono font-normal text-muted-foreground">
              @ {depthLabel}
            </span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground">1.0× = bay avg</div>
      </div>

      <div className="relative mx-auto" style={{ width: W, height: H }}>
        {/* overflow:visible lets the outermost axis labels (Phosphorus on the
            right, Water Flow on the left) render past the SVG's 248-px box
            instead of being clipped by the default svg overflow:hidden. */}
        <svg width={W} height={H} className="block" style={{ overflow: "visible" }}>
          {/* 5 grid rings + tick labels at vertical (1.0× and above) */}
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

          {/* Baseline (1.0×) ring emphasised */}
          <circle cx={cx} cy={cy} r={baselineRingR}
            fill="none" stroke="#64748b" strokeWidth="1.1"
            strokeDasharray="3 2" opacity="0.7" />

          {/* Axis spokes + labels */}
          {VOXEL_AXES.map((ax, i) => {
            const outer  = point(MAX_FRAC, i);
            const labelR = R + 22;
            const a  = angleFor(i);
            const lx = cx + Math.cos(a) * labelR;
            const ly = cy + Math.sin(a) * labelR;
            const anchor   = Math.abs(Math.cos(a)) < 0.2 ? "middle" : (Math.cos(a) > 0 ? "start" : "end");
            const baseline = Math.abs(Math.sin(a)) < 0.3 ? "middle" : (Math.sin(a) > 0 ? "hanging" : "auto");
            return (
              <g key={ax.id}>
                <line x1={cx} y1={cy} x2={outer.x} y2={outer.y}
                  stroke="#cbd5e1" strokeWidth="0.5" />
                <text
                  x={lx} y={ly}
                  textAnchor={anchor}
                  dominantBaseline={baseline}
                  fontSize="9.5" fill="#334155" fontWeight={600}
                >
                  {ax.shortLabel}
                </text>
                <text
                  x={lx} y={ly + 11}
                  textAnchor={anchor}
                  dominantBaseline={baseline}
                  fontSize="8" fill="#64748b" fontFamily="monospace"
                >
                  {ax.unit}
                </text>
              </g>
            );
          })}

          {/* Voxel polygon */}
          <polygon points={path}
            fill={FILL} fillOpacity="0.28"
            stroke={FILL} strokeWidth="1.6" strokeLinejoin="round" />
          {pts.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="3" fill={FILL}
              stroke="white" strokeWidth="1.1" />
          ))}

          {/* Footer legend chip */}
          <g transform={`translate(8, ${H - 14})`} style={{ pointerEvents: "none" }}>
            <circle cx="4" cy="4" r="3" fill="#64748b" opacity="0.7" />
            <text x="11" y="7" fontSize="8" fill="#64748b">bay avg · outer = 2.5×</text>
          </g>
        </svg>
      </div>

      {/* Per-axis value table (placeholder values shown alongside the polygon) */}
      <div className="mt-2 pt-1.5 border-t border-border/60 space-y-0.5">
        {VOXEL_AXES.map(ax => {
          const v = SAMPLE_VALUES[ax.id];
          const b = SAMPLE_BASELINE[ax.id];
          const delta = b > 0 ? (v - b) / b : 0;
          const positive = delta >= 0;
          return (
            <div key={ax.id} className="flex items-center text-[10.5px] gap-2">
              <span className="text-foreground/80 flex-1 truncate">{ax.shortLabel}</span>
              <span className="font-mono text-foreground tabular-nums">
                {fmt(v, ax.decimals)}
              </span>
              <span className="text-[9.5px] text-muted-foreground">
                / {fmt(b, ax.decimals)} {ax.unit}
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
      </div>

      <p className="text-[9.5px] text-muted-foreground leading-relaxed mt-2 pt-1.5 border-t border-border/60">
        <span className="font-semibold">Static placeholder values.</span> Wired to the
        selected voxel in a later step.
      </p>
    </div>
  );
}
