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
    <div className="w-full h-full relative flex flex-col items-center justify-center bg-[#e8edf2] select-none overflow-hidden">

      {/* Map background grid */}
      <div className="absolute inset-0 opacity-15"
        style={{
          backgroundImage: "linear-gradient(#94a3b8 1px, transparent 1px), linear-gradient(90deg, #94a3b8 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* Subtle terrain texture */}
      <div className="absolute inset-0" style={{
        background: "radial-gradient(ellipse at 30% 40%, rgba(148,196,210,0.25) 0%, transparent 55%), radial-gradient(ellipse at 70% 60%, rgba(120,180,200,0.2) 0%, transparent 50%)"
      }} />

      {/* Top-left info badge */}
      <div className="absolute top-4 left-4 bg-white rounded-md shadow-sm border border-border px-3 py-2 z-10">
        <div className="text-xs font-semibold text-foreground">Shizugawa Bay, Tohoku</div>
        <div className="text-[10px] font-mono text-muted-foreground">38.6°N 141.4°E · Japan</div>
      </div>

      {/* Compass */}
      <div className="absolute top-4 right-4 bg-white rounded-full shadow-sm border border-border w-9 h-9 flex items-center justify-center z-10">
        <div className="flex flex-col items-center gap-0">
          <div className="text-[8px] font-bold text-foreground leading-none">N</div>
          <div className="w-px h-2 bg-muted-foreground/50" />
          <div className="w-0 h-0 border-l-[3px] border-r-[3px] border-b-[5px] border-l-transparent border-r-transparent border-b-muted-foreground/50" />
        </div>
      </div>

      {/* Scale bar */}
      <div className="absolute bottom-4 right-4 bg-white rounded-md shadow-sm border border-border px-2 py-1.5 flex flex-col gap-1 z-10">
        <div className="flex items-center">
          <div className="h-1.5 w-8 border border-muted-foreground/50 bg-muted-foreground/20" />
          <div className="h-1.5 w-8 border border-muted-foreground/50 bg-white" />
        </div>
        <div className="flex justify-between text-[8px] font-mono text-muted-foreground">
          <span>0</span><span>2km</span>
        </div>
      </div>

      {/* Zoom controls (GauDt style) */}
      <div className="absolute top-16 left-4 flex flex-col gap-0.5 z-10">
        <button className="w-7 h-7 bg-white rounded-t-md border border-border shadow-sm flex items-center justify-center text-muted-foreground hover:text-foreground text-sm font-light cursor-pointer">+</button>
        <button className="w-7 h-7 bg-white rounded-b-md border border-border shadow-sm flex items-center justify-center text-muted-foreground hover:text-foreground text-sm font-light cursor-pointer">−</button>
      </div>

      {/* Bay SVG + grid cells */}
      <div className="relative" style={{ width: "360px", height: "280px" }}>

        {/* Water body base */}
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 360 280" fill="none">
          {/* Land masses */}
          <path d="M0,0 L155,0 L155,55 L110,75 L90,110 L0,110 Z" fill="#c8d0d8" />
          <path d="M205,0 L360,0 L360,130 L315,105 L270,78 L225,55 Z" fill="#c8d0d8" />
          <path d="M0,220 L0,280 L360,280 L360,220 L270,200 L225,215 L180,210 L110,215 Z" fill="#c8d0d8" />

          {/* Bay water fill */}
          <path d="M90,60 L155,42 L205,42 L270,60 L310,95 L330,135 L320,175 L280,210 L225,220 L180,215 L135,210 L95,185 L72,150 L72,108 Z"
            fill="#b8d4e4" opacity="0.55" />

          {/* Minor rivers / inflows */}
          <path d="M135,210 L120,250" stroke="#94b8cc" strokeWidth="1.5" opacity="0.5"/>
          <path d="M225,220 L240,260" stroke="#94b8cc" strokeWidth="1.5" opacity="0.5"/>
        </svg>

        {/* Bay grid cells */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div style={{ width: "224px", height: "192px", position: "relative" }}>
            {Array.from({ length: GRID_D }).map((_, row) =>
              Array.from({ length: GRID_W }).map((_, col) => {
                const inBay = BAY_MASK[row]?.[col] ?? false;
                if (!inBay) return null;
                return (
                  <div
                    key={`${row}-${col}`}
                    className="absolute border border-[#7ab0cc]/40"
                    style={{
                      left: `${col * cellW}%`,
                      top: `${row * cellH}%`,
                      width: `${cellW}%`,
                      height: `${cellH}%`,
                      background: hovered
                        ? "rgba(89, 86, 214, 0.2)"
                        : "rgba(120, 176, 210, 0.18)",
                      transition: "background 0.15s",
                    }}
                  />
                );
              })
            )}

            {/* Click target */}
            <div
              className="absolute inset-0 cursor-pointer z-10"
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              onClick={onSelectBasin}
              data-testid="basin-select-trigger"
            />
          </div>
        </div>

        {/* Hover tooltip */}
        {hovered && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20
                         bg-white border border-primary/30 rounded-md px-3 py-2 shadow-md text-center">
            <div className="text-xs font-semibold text-primary">Shizugawa Bay (Ocean)</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Click to enter 3D playback</div>
          </div>
        )}

        {/* Static label when not hovered */}
        {!hovered && (
          <div className="absolute pointer-events-none z-5 text-center"
            style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}>
            <div className="text-[9px] font-semibold text-[#5956d6]/70 uppercase tracking-widest">Ocean Basin</div>
          </div>
        )}

        {/* Depth info tag */}
        <div className="absolute bottom-1 right-2 text-[8px] font-mono text-muted-foreground/50">max ~45m</div>
      </div>

      {/* Bottom instruction card */}
      <div className="mt-4 bg-white rounded-md shadow-sm border border-border px-4 py-2.5 text-center max-w-xs">
        <div className="text-sm font-medium text-foreground">Select a Sub-basin</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          Choose the ocean basin to view 1-year nutrient flow and run time-series playback
        </div>
      </div>
    </div>
  );
}
