import { useState } from "react";
import { BAY_MASK, GRID_W, GRID_D } from "@/lib/simulatedData";

interface BasinOverviewProps {
  onSelectBasin: () => void;
}

export default function BasinOverview({ onSelectBasin }: BasinOverviewProps) {
  const [hovered, setHovered] = useState(false);

  const cellW = 100 / GRID_W;
  const cellH = 100 / GRID_D;

  return (
    <div className="w-full h-full relative flex flex-col items-center justify-center bg-[#edf0f3] select-none">

      {/* Grid reference lines */}
      <div className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: "linear-gradient(#c0c8d0 1px, transparent 1px), linear-gradient(90deg, #c0c8d0 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* Compass */}
      <div className="absolute top-4 right-4 flex flex-col items-center gap-0.5 opacity-60">
        <div className="text-[9px] font-mono text-muted-foreground font-bold">N</div>
        <div className="w-px h-4 bg-muted-foreground/60" />
        <div className="w-0 h-0 border-l-[4px] border-r-[4px] border-b-[7px] border-l-transparent border-r-transparent border-b-muted-foreground/60" />
      </div>

      {/* Scale bar */}
      <div className="absolute bottom-4 left-4 flex flex-col gap-1">
        <div className="flex items-center gap-0">
          <div className="h-2 w-8 border border-muted-foreground/40 bg-muted-foreground/20" />
          <div className="h-2 w-8 border border-muted-foreground/40 bg-transparent" />
        </div>
        <div className="flex justify-between">
          <span className="data-label">0</span>
          <span className="data-label ml-4">2km</span>
        </div>
      </div>

      {/* Area labels */}
      <div className="absolute top-4 left-4 space-y-1">
        <div className="data-label font-semibold text-[10px] text-foreground/70">SHIZUGAWA BAY</div>
        <div className="data-label text-[9px]">38.6°N 141.4°E</div>
      </div>

      {/* SVG bay map */}
      <div className="relative" style={{ width: "320px", height: "260px" }}>

        {/* Land context background */}
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 260" fill="none">
          {/* Simplified land shapes around the bay */}
          <path d="M0,0 L140,0 L140,50 L100,70 L80,100 L0,100 Z" fill="#d4cfc8" opacity="0.8"/>
          <path d="M180,0 L320,0 L320,120 L280,100 L240,70 L200,50 Z" fill="#d4cfc8" opacity="0.8"/>
          <path d="M0,200 L0,260 L320,260 L320,200 L240,180 L200,200 L160,190 L100,200 Z" fill="#d4cfc8" opacity="0.8"/>

          {/* Bay water fill */}
          <path
            d="M80,60 L140,40 L180,40 L240,60 L280,90 L300,130 L290,170 L250,200 L200,210 L160,205 L120,195 L80,170 L60,140 L60,100 Z"
            fill="#c8dce8" opacity="0.5"
          />
        </svg>

        {/* Bay grid cells */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div style={{ width: "200px", height: "192px", position: "relative" }}>
            {Array.from({ length: GRID_D }).map((_, row) =>
              Array.from({ length: GRID_W }).map((_, col) => {
                const inBay = BAY_MASK[row]?.[col] ?? false;
                if (!inBay) return null;
                return (
                  <div
                    key={`${row}-${col}`}
                    className="absolute border border-[#8ab4cc]/30"
                    style={{
                      left: `${col * cellW}%`,
                      top: `${row * cellH}%`,
                      width: `${cellW}%`,
                      height: `${cellH}%`,
                      background: hovered
                        ? "rgba(58, 110, 165, 0.25)"
                        : "rgba(100, 160, 200, 0.15)",
                    }}
                  />
                );
              })
            )}

            {/* Interactive ocean basin overlay */}
            <div
              className="absolute inset-0 cursor-pointer z-10 rounded-sm"
              style={{ background: "transparent" }}
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              onClick={onSelectBasin}
              data-testid="basin-select-trigger"
            />
          </div>
        </div>

        {/* Hover tooltip / call to action */}
        {hovered && (
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20
                       bg-card/95 border border-primary/30 rounded-sm px-3 py-2 shadow-md text-center"
          >
            <div className="text-xs font-semibold text-primary">Ocean Basin</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Click to enter 3D view</div>
          </div>
        )}

        {/* Basin label */}
        {!hovered && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none text-center">
            <div className="data-label text-[9px] text-[#3b6fa0]/80 font-semibold uppercase tracking-widest">
              Ocean Basin
            </div>
            <div className="data-label text-[9px] text-muted-foreground/60 mt-0.5">Select to explore</div>
          </div>
        )}

        {/* Depth indicator */}
        <div className="absolute bottom-1 right-1 data-label text-[8px] text-muted-foreground/50">
          max depth ~45m
        </div>
      </div>

      {/* Entry instruction */}
      <div className="mt-6 text-center space-y-1">
        <div className="text-xs text-muted-foreground">
          Select the <span className="text-primary font-medium">ocean basin</span> to begin 3D time-series playback
        </div>
        <div className="data-label text-[9px] text-muted-foreground/60">
          1-year nutrient flow dataset · 52 timesteps · 4 variables
        </div>
      </div>
    </div>
  );
}
