import React from "react";

interface LegendOverlayProps {
  stops:    string[];
  min:      number;
  max:      number;
  unit:     string;
  decimals?: number;
  label?:    string;
  cellWidth?: number;
  className?: string;
}

export default function LegendOverlay({
  stops,
  min,
  max,
  unit,
  decimals = 1,
  label    = "Legend",
  cellWidth = 32,
  className,
}: LegendOverlayProps) {
  const N      = stops.length;
  const totalW = N * cellWidth;

  if (N === 0) {
    return (
      <div
        className={[
          "bg-white/95 backdrop-blur-sm border border-border rounded-lg shadow-sm px-3 py-2",
          className ?? "",
        ].join(" ")}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-medium text-foreground">{label}</span>
          <span className="text-[10px] text-muted-foreground">{unit}</span>
        </div>
        <div className="text-[10px] text-slate-600 tabular-nums mt-1">
          {min.toFixed(decimals)} – {max.toFixed(decimals)}
        </div>
      </div>
    );
  }

  return (
    <div
      className={[
        "bg-white/95 backdrop-blur-sm border border-border rounded-lg shadow-sm px-3 py-2",
        className ?? "",
      ].join(" ")}
    >
      <div
        className="flex items-baseline justify-between mb-1.5"
        style={{ width: totalW }}
      >
        <span className="text-[11px] font-medium text-foreground">{label}</span>
        <span className="text-[10px] text-muted-foreground">{unit}</span>
      </div>

      <div
        className="flex rounded-sm overflow-hidden"
        style={{ width: totalW }}
      >
        {stops.map((color, i) => (
          <div
            key={i}
            style={{ backgroundColor: color, width: cellWidth, height: 14 }}
          />
        ))}
      </div>

      <div
        className="flex justify-between mt-1"
        style={{ width: totalW }}
      >
        {stops.map((_, i) => {
          const v = N > 1
            ? min + (i / (N - 1)) * (max - min)
            : min;
          return (
            <span
              key={i}
              className="text-[10px] text-slate-600 tabular-nums leading-none"
            >
              {v.toFixed(decimals)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
