/*
 * HsiGauge — semi-circular gauge dial showing a 0–1 HSI value.
 * Inspired by Mobadas's "Habitat Suitability at a Selected Location" widget.
 *
 * Companion components in this file:
 *   - <RainbowStrip> — full 0→1 gradient legend with optional value indicator
 *   - turboColor() / RAINBOW_GRADIENT_CSS — shared color helpers
 */

const RAINBOW_STOPS: { p: number; c: [number, number, number] }[] = [
  { p: 0.0,  c: [49,  54,  149] },   // deep blue
  { p: 0.15, c: [69,  117, 180] },   // blue
  { p: 0.3,  c: [116, 173, 209] },   // cyan
  { p: 0.45, c: [171, 217, 233] },   // pale cyan
  { p: 0.55, c: [222, 235, 161] },   // pale yellow-green
  { p: 0.7,  c: [254, 224, 144] },   // yellow
  { p: 0.85, c: [253, 174, 97]  },   // orange
  { p: 1.0,  c: [215, 48,  39]  },   // red
];

export function turboColor(v: number): string {
  const x = Math.max(0, Math.min(1, v));
  for (let i = 1; i < RAINBOW_STOPS.length; i++) {
    const a = RAINBOW_STOPS[i - 1];
    const b = RAINBOW_STOPS[i];
    if (x <= b.p) {
      const t = (x - a.p) / (b.p - a.p);
      const r = Math.round(a.c[0] + (b.c[0] - a.c[0]) * t);
      const g = Math.round(a.c[1] + (b.c[1] - a.c[1]) * t);
      const blue = Math.round(a.c[2] + (b.c[2] - a.c[2]) * t);
      return `rgb(${r},${g},${blue})`;
    }
  }
  return `rgb(${RAINBOW_STOPS[RAINBOW_STOPS.length - 1].c.join(",")})`;
}

export const RAINBOW_GRADIENT_CSS =
  "linear-gradient(to right, " +
  RAINBOW_STOPS.map((s) => `rgb(${s.c.join(",")}) ${(s.p * 100).toFixed(0)}%`).join(", ") +
  ")";

export interface HsiGaugeProps {
  value: number;          // 0–1
  size?: number;          // outer width in px (height ≈ size * 0.6)
  label?: string;
  /** Override the arc color; defaults to rainbow-mapped color of value. */
  accentColor?: string;
  /** Optional baseline reference shown as a small tick on the arc. */
  baselineValue?: number;
}

/**
 * Semi-circular gauge — half-donut at the top of an SVG, with a thicker
 * coloured arc filling 0 → value and a thin grey track behind. Numeric
 * value is centered below the arc.
 */
export default function HsiGauge({
  value, size = 96, label, accentColor, baselineValue,
}: HsiGaugeProps) {
  const v = Math.max(0, Math.min(1, value));
  const cx = size / 2;
  const cy = size * 0.62;
  const r  = size * 0.40;
  const stroke = size * 0.10;

  const start = 180;        // svg angles: 180° = left, 0° = right
  const end   = 360;        // top half-circle going clockwise

  const polar = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const arcPath = (a0: number, a1: number) => {
    if (a1 - a0 < 0.01) return "";
    const [x0, y0] = polar(a0);
    const [x1, y1] = polar(a1);
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
  };

  const valueAngle    = start + (end - start) * v;
  const baselineAngle = baselineValue !== undefined
    ? start + (end - start) * Math.max(0, Math.min(1, baselineValue))
    : null;

  const color = accentColor ?? turboColor(v);
  const svgH  = size * 0.78;

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={svgH} viewBox={`0 0 ${size} ${svgH}`}>
        {/* background half-circle */}
        <path d={arcPath(start, end)} fill="none" stroke="#e5e7eb" strokeWidth={stroke} strokeLinecap="round" />

        {/* value arc */}
        <path d={arcPath(start, valueAngle)} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" />

        {/* baseline reference tick */}
        {baselineAngle !== null && (() => {
          const [bx, by] = polar(baselineAngle);
          const inset = r - stroke * 0.7;
          const ix = cx + inset * Math.cos((baselineAngle * Math.PI) / 180);
          const iy = cy + inset * Math.sin((baselineAngle * Math.PI) / 180);
          return (
            <line x1={ix} y1={iy} x2={bx} y2={by} stroke="#0f172a" strokeWidth={1.2} strokeLinecap="round" />
          );
        })()}

        {/* end-of-scale labels */}
        <text x={polar(start)[0] - 2} y={polar(start)[1] + 12} fontSize={size * 0.10} fill="#64748b" textAnchor="middle">0</text>
        <text x={cx} y={cy - r - stroke * 0.6} fontSize={size * 0.10} fill="#64748b" textAnchor="middle">0.5</text>
        <text x={polar(end)[0] + 2}   y={polar(end)[1] + 12}   fontSize={size * 0.10} fill="#64748b" textAnchor="middle">1</text>

        {/* center value */}
        <text x={cx} y={cy + size * 0.04} fontSize={size * 0.30} fontWeight={700} fill="#0f172a" textAnchor="middle">
          {v.toFixed(2)}
        </text>
      </svg>
      {label && (
        <div className="text-[10px] text-muted-foreground mt-0.5 text-center leading-tight">{label}</div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * RainbowStrip — horizontal gradient bar (legend), optional droplet indicator
 * matching Mobadas's HSI legend strip.
 * ─────────────────────────────────────────────────────────────────────────── */

export interface RainbowStripProps {
  /** 0–1; if provided, renders a droplet indicator at this position. */
  value?: number;
  height?: number;
  showTicks?: boolean;
  className?: string;
}

export function RainbowStrip({
  value, height = 14, showTicks = true, className = "",
}: RainbowStripProps) {
  const v = value !== undefined ? Math.max(0, Math.min(1, value)) : null;
  return (
    <div className={`relative w-full ${className}`}>
      <div
        className="w-full rounded-sm border border-border/40"
        style={{ height, background: RAINBOW_GRADIENT_CSS }}
      />
      {v !== null && (
        <div
          className="absolute -top-1.5 -translate-x-1/2 pointer-events-none"
          style={{ left: `${v * 100}%` }}
        >
          <svg width="10" height="14" viewBox="0 0 10 14">
            <path d="M5 0 L9 6 A4 4 0 1 1 1 6 Z" fill="#ffffff" stroke="#0f172a" strokeWidth="1" />
          </svg>
        </div>
      )}
      {showTicks && (
        <div className="flex justify-between text-[9px] font-mono text-muted-foreground mt-0.5">
          <span>0</span>
          <span>~</span>
          <span>1</span>
        </div>
      )}
    </div>
  );
}
