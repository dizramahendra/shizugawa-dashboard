import { useState } from "react";
import { BAY_MASK, GRID_W, GRID_D, RIVERS } from "@/lib/simulatedData";

interface BasinOverviewProps {
  onSelectOcean: () => void;
  onSelectRiver: (riverId: string) => void;
}

const RIVER_PATHS: {
  id: string;
  label: string;
  points: [number, number][];   // SVG coords in the 520×400 viewBox
  labelPos: [number, number];
}[] = [
  {
    id: "shizugawa",
    label: "Shizugawa River",
    points: [[180, 90], [210, 130], [230, 170], [245, 215]],
    labelPos: [158, 78],
  },
  {
    id: "kitakami",
    label: "Kitakami Tributary",
    points: [[100, 60], [140, 100], [175, 140], [210, 180], [230, 210]],
    labelPos: [60, 52],
  },
  {
    id: "hachiman",
    label: "Hachiman River",
    points: [[310, 80], [295, 120], [270, 160], [255, 200], [245, 220]],
    labelPos: [302, 68],
  },
];

export default function BasinOverview({ onSelectOcean, onSelectRiver }: BasinOverviewProps) {
  const [hoveredOcean, setHoveredOcean] = useState(false);
  const [hoveredRiver, setHoveredRiver] = useState<string | null>(null);

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
      <div className="absolute inset-0" style={{
        background: "radial-gradient(ellipse at 30% 40%, rgba(148,196,210,0.25) 0%, transparent 55%), radial-gradient(ellipse at 70% 60%, rgba(120,180,200,0.2) 0%, transparent 50%)"
      }} />

      {/* Location badge */}
      <div className="absolute top-4 left-4 bg-white rounded-md shadow-sm border border-border px-3 py-2 z-10">
        <div className="text-xs font-semibold text-foreground">Shizugawa Bay, Tohoku</div>
        <div className="text-[10px] font-mono text-muted-foreground">38.6°N 141.4°E · Japan</div>
      </div>

      {/* Legend */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white rounded-md shadow-sm border border-border px-3 py-2 z-10 flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-primary/60 border border-primary/40" />
          <span className="text-[10px] text-foreground">Ocean Basin</span>
        </div>
        <div className="w-px h-3 bg-border" />
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-1.5 rounded-full bg-blue-400" />
          <span className="text-[10px] text-foreground">River</span>
        </div>
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

      {/* Zoom controls */}
      <div className="absolute top-16 left-4 flex flex-col gap-0.5 z-10">
        <button className="w-7 h-7 bg-white rounded-t-md border border-border shadow-sm flex items-center justify-center text-muted-foreground hover:text-foreground text-sm font-light cursor-pointer">+</button>
        <button className="w-7 h-7 bg-white rounded-b-md border border-border shadow-sm flex items-center justify-center text-muted-foreground hover:text-foreground text-sm font-light cursor-pointer">−</button>
      </div>

      {/* Main SVG map */}
      <div className="relative" style={{ width: "520px", height: "400px" }}>

        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 520 400"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Land masses */}
          <path d="M0,0 L220,0 L220,80 L160,105 L130,150 L0,150 Z" fill="#c8d0d8" />
          <path d="M300,0 L520,0 L520,180 L455,150 L395,110 L320,80 Z" fill="#c8d0d8" />
          <path d="M0,310 L0,400 L520,400 L520,310 L390,285 L330,305 L260,300 L170,305 Z" fill="#c8d0d8" />

          {/* Bay water fill */}
          <path d="M130,95 L220,62 L300,62 L395,90 L450,135 L470,190 L460,250 L410,300 L330,315 L260,308 L190,300 L140,268 L110,220 L108,160 Z"
            fill="#b8d4e4" opacity="0.55" />

          {/* River paths */}
          {RIVER_PATHS.map((rp) => {
            const isHovered = hoveredRiver === rp.id;
            const pathD = rp.points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
            return (
              <g key={rp.id}>
                {/* Wider invisible hit area */}
                <path
                  d={pathD}
                  stroke="transparent"
                  strokeWidth="20"
                  fill="none"
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredRiver(rp.id)}
                  onMouseLeave={() => setHoveredRiver(null)}
                  onClick={() => onSelectRiver(rp.id)}
                />
                {/* Visible river stroke */}
                <path
                  d={pathD}
                  stroke={isHovered ? "#3b82f6" : "#60a5fa"}
                  strokeWidth={isHovered ? 5 : 3}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="pointer-events-none transition-all duration-150"
                />
                {/* Hover glow */}
                {isHovered && (
                  <path
                    d={pathD}
                    stroke="#93c5fd"
                    strokeWidth="9"
                    fill="none"
                    strokeLinecap="round"
                    opacity="0.35"
                    className="pointer-events-none"
                  />
                )}
                {/* River label on hover */}
                {isHovered && (
                  <g>
                    <rect
                      x={rp.labelPos[0] - 4} y={rp.labelPos[1] - 13}
                      width={108} height={18} rx={3}
                      fill="white" stroke="#bfdbfe" strokeWidth="1"
                    />
                    <text
                      x={rp.labelPos[0]} y={rp.labelPos[1]}
                      fontSize="10" fill="#1e40af" fontFamily="system-ui, sans-serif" fontWeight="600"
                    >
                      {rp.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Minor tributary lines */}
          <path d="M190,300 L175,355" stroke="#94b8cc" strokeWidth="1.5" opacity="0.4" />
          <path d="M330,308 L345,370" stroke="#94b8cc" strokeWidth="1.5" opacity="0.4" />
        </svg>

        {/* Ocean basin grid cells overlay */}
        <div className="absolute" style={{ top: "58px", left: "110px", width: "310px", height: "240px" }}>
          <div style={{ width: "100%", height: "100%", position: "relative" }}>
            {Array.from({ length: GRID_D }).map((_, row) =>
              Array.from({ length: GRID_W }).map((_, col) => {
                const inBay = BAY_MASK[row]?.[col] ?? false;
                if (!inBay) return null;
                return (
                  <div
                    key={`${row}-${col}`}
                    className="absolute border border-[#7ab0cc]/30"
                    style={{
                      left: `${col * cellW}%`,
                      top: `${row * cellH}%`,
                      width: `${cellW}%`,
                      height: `${cellH}%`,
                      background: hoveredOcean
                        ? "rgba(89,86,214,0.22)"
                        : "rgba(120,176,210,0.16)",
                      transition: "background 0.15s",
                    }}
                  />
                );
              })
            )}
            {/* Ocean click target */}
            <div
              className="absolute inset-0 cursor-pointer z-10"
              onMouseEnter={() => setHoveredOcean(true)}
              onMouseLeave={() => setHoveredOcean(false)}
              onClick={onSelectOcean}
            />
          </div>
        </div>

        {/* Ocean hover tooltip */}
        {hoveredOcean && (
          <div className="absolute pointer-events-none z-20"
            style={{ top: "155px", left: "175px", transform: "translate(-50%,-50%)" }}>
            <div className="bg-white border border-primary/30 rounded-md px-3 py-2 shadow-md text-center">
              <div className="text-xs font-semibold text-primary">Shizugawa Bay (Ocean)</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Click → Ocean Playback 3D view</div>
            </div>
          </div>
        )}

        {/* River hover tooltip */}
        {hoveredRiver && (
          <div className="absolute pointer-events-none z-20"
            style={{ top: "20px", right: "10px" }}>
            <div className="bg-white border border-blue-200 rounded-md px-3 py-2 shadow-md text-center">
              <div className="text-xs font-semibold text-blue-600">
                {RIVER_PATHS.find(r => r.id === hoveredRiver)?.label}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Click → River Playback 2D view</div>
            </div>
          </div>
        )}

        {/* Static ocean label */}
        {!hoveredOcean && !hoveredRiver && (
          <div className="absolute pointer-events-none z-5 text-center"
            style={{ top: "155px", left: "175px", transform: "translate(-50%,-50%)" }}>
            <div className="text-[9px] font-semibold text-[#5956d6]/60 uppercase tracking-widest">Ocean Basin</div>
          </div>
        )}

        <div className="absolute bottom-1 right-2 text-[8px] font-mono text-muted-foreground/50">max ~45m</div>
      </div>

      {/* Instruction card */}
      <div className="mt-4 bg-white rounded-md shadow-sm border border-border px-4 py-2.5 text-center max-w-sm">
        <div className="text-sm font-medium text-foreground">Select a water body</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          Click a <span className="text-blue-500 font-medium">river</span> for 2D playback · Click the <span className="text-primary font-medium">ocean basin</span> for 3D playback
        </div>
      </div>
    </div>
  );
}
