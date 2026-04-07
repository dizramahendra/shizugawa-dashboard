import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, Layers3 } from "lucide-react";
import { TOTAL_WEEKS, VARIABLE_OPTIONS, getWeekLabel } from "@/lib/simulatedData";
import TopNav from "@/components/TopNav";
import TerrainCrossSection3D from "@/components/TerrainCrossSection3D";
import PlaybackControls from "@/components/PlaybackControls";
import ColorLegend from "@/components/ColorLegend";

const ZONE_INFO = [
  { key: "forest",  label: "Forest",      color: "#1e4a24", model: null },
  { key: "paddy",   label: "Paddy",       color: "#3a6318", model: null },
  { key: "farm",    label: "Farmland",    color: "#7a5a1e", model: null },
  { key: "urban",   label: "Urban",       color: "#424f5e", model: null },
  { key: "river",   label: "River",       color: "#0d3d6e", model: "SWAT 2D" },
  { key: "bay",     label: "Inner Bay",   color: "#082e52", model: "DELFT 3D" },
  { key: "ocean",   label: "Open Ocean",  color: "#041828", model: "DELFT 3D" },
];

/*
 * Viewport tilt transition:
 * - On mount:  content starts "above" (rotateX(24deg), scaled down, opacity 0)
 *              and transitions to flat / normal over 0.9s.
 *              This simulates the camera tilting down from top-down map view
 *              into the perspective cross-section angle.
 * - On exit:   content tilts back up (same transform applied, opacity → 0)
 *              then the route change fires, so the user sees a smooth reversal.
 */
const TILT_TRANSFORM = "perspective(1000px) rotateX(24deg) scale(0.9)";
const TILT_ORIGIN    = "center bottom";

export default function CrossSectionPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const watershedName = searchParams.get("wname") ?? undefined;
  const riverId = searchParams.get("river") ?? searchParams.get("watershed") ?? "shizugawa";

  const [week, setWeek] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [selectedVariable, setSelectedVariable] = useState("nitrogen");

  /* Tilt-in: starts false (tilted / invisible), flips to true on mount */
  const [tiltedIn, setTiltedIn] = useState(false);
  /* Tilt-out: starts false, set to true right before navigating away */
  const [tiltingOut, setTiltingOut] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const navRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Trigger tilt-in on mount; clear pending nav timeout on unmount */
  useEffect(() => {
    const t = setTimeout(() => setTiltedIn(true), 60);
    return () => {
      clearTimeout(t);
      if (navRef.current) clearTimeout(navRef.current);
    };
  }, []);

  const pause = useCallback(() => setIsPlaying(false), []);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setWeek((w) => {
          if (w >= TOTAL_WEEKS - 1) { setIsPlaying(false); return 0; }
          return w + 1;
        });
      }, 800 / speed);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isPlaying, speed]);

  /* Navigate back with reverse tilt animation; pass state so map can tilt in */
  const handleBack = useCallback(() => {
    if (tiltingOut) return;
    setTiltingOut(true);
    if (navRef.current) clearTimeout(navRef.current);
    navRef.current = setTimeout(() => navigate("/", { state: { fromCS: true } }), 680);
  }, [tiltingOut, navigate]);

  const { label: weekLabel } = getWeekLabel(week);
  const variable = VARIABLE_OPTIONS.find((v) => v.id === selectedVariable) ?? VARIABLE_OPTIONS[0];

  /* Compute CSS transform for the viewport container */
  const isAnimating = !tiltedIn || tiltingOut;
  const viewportStyle: React.CSSProperties = {
    transform: isAnimating ? TILT_TRANSFORM : "none",
    opacity: isAnimating ? 0 : 1,
    transition: tiltedIn
      ? "transform 0.72s cubic-bezier(0.4, 0, 0.8, 0.6), opacity 0.55s ease-in"
      : "transform 0.88s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.65s ease-out",
    transformOrigin: TILT_ORIGIN,
  };

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-background">
      <TopNav
        stateLabel={isPlaying ? "Playing" : "Paused"}
        watershedName={watershedName}
        onMapNavRequest={handleBack}
      />

      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-4 px-4 py-2 bg-white border-b border-border">
        <button
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          onClick={handleBack}
          disabled={tiltingOut}
        >
          <ChevronLeft size={14} />
          Map Viewport
        </button>

        <div className="w-px h-4 bg-border" />

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Variable</span>
          <select
            className="filter-select pr-8 appearance-none"
            value={selectedVariable}
            onChange={(e) => setSelectedVariable(e.target.value)}
            style={{
              backgroundImage: "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")",
              backgroundPosition: "right 0.5rem center",
              backgroundRepeat: "no-repeat",
              backgroundSize: "1.25rem",
            }}
          >
            <option value="nitrogen">Total Nitrogen</option>
            <option value="phosphorus">Total Phosphorus</option>
            <option value="chlorophyll">Chlorophyll-a</option>
            <option value="do">Dissolved Oxygen</option>
          </select>
        </div>

        <div className="ml-auto flex items-center gap-1.5 text-xs">
          {isPlaying ? (
            <><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /><span className="text-green-600">Playing</span></>
          ) : (
            <><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /><span className="text-amber-600">Paused</span></>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">

        {/* 3D cross-section viewport */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Viewport container with tilt-in / tilt-out transition */}
          <div className="flex-1 relative overflow-hidden" style={viewportStyle}>
            <TerrainCrossSection3D week={week} colorScale={selectedVariable} riverId={riverId} />

            {/* Zone label strip */}
            <div className="absolute top-3 left-3 right-3 flex items-center gap-1.5 pointer-events-none flex-wrap">
              {ZONE_INFO.map((z) => (
                <span
                  key={z.key}
                  className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                  style={{ background: z.color + "e0", color: "rgba(255,255,255,0.9)" }}
                >
                  {z.label}
                </span>
              ))}
              <span className="text-[8px] font-mono text-white/40 ml-2">← upstream · downstream →</span>
            </div>

            {/* Sea level marker */}
            <div
              className="absolute pointer-events-none"
              style={{ bottom: "52px", right: "12px" }}
            >
              <div className="flex items-center gap-1.5 bg-black/40 border border-blue-400/30 rounded px-2 py-1">
                <div className="w-4 h-px bg-blue-400/70" />
                <span className="text-[9px] font-mono text-blue-300/80">sea level</span>
              </div>
            </div>

            {/* Orbit hint */}
            <div className="absolute bottom-3 left-3 bg-black/50 text-white/60 border border-white/10 rounded-md px-2.5 py-1.5 pointer-events-none">
              <div className="text-[10px] font-mono">Orbit · Zoom · Cross-Section View</div>
            </div>
          </div>

          <PlaybackControls
            week={week}
            isPlaying={isPlaying}
            speed={speed}
            onPlay={() => setIsPlaying(true)}
            onPause={pause}
            onSeek={(w) => { setWeek(w); pause(); }}
            onSpeedChange={setSpeed}
            onBack={() => { setWeek((w) => Math.max(0, w - 1)); pause(); }}
            onForward={() => { setWeek((w) => Math.min(TOTAL_WEEKS - 1, w + 1)); pause(); }}
          />
        </div>

        {/* Right info panel */}
        <div className="w-72 flex-shrink-0 border-l border-border flex flex-col bg-white overflow-hidden">
          {/* Back link */}
          <div
            className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border cursor-pointer hover:bg-muted/40 transition-colors flex-shrink-0"
            onClick={handleBack}
          >
            <ChevronLeft size={14} className="text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Basin Selection</span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-border">
            {/* Location + timestamp */}
            <div className="px-4 py-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
                  <Layers3 size={16} className="text-primary" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">Cross-Section View</div>
                  <div className="text-xs text-muted-foreground">Shizugawa Bay · Terrain Profile</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="bg-muted/40 rounded-md p-2.5">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Week</div>
                  <div className="text-sm font-semibold text-foreground font-mono">{weekLabel}</div>
                </div>
                <div className="bg-muted/40 rounded-md p-2.5">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Progress</div>
                  <div className="text-sm font-semibold text-foreground font-mono">{week + 1}/{TOTAL_WEEKS}w</div>
                </div>
              </div>
            </div>

            {/* Legend */}
            <div className="px-4 py-4">
              <div className="panel-section-title mb-3">Data Legend</div>
              <ColorLegend
                variableId={selectedVariable}
                variableLabel={variable.label}
                unit={variable.unit}
              />
            </div>

            {/* Zone guide */}
            <div className="px-4 py-4">
              <div className="panel-section-title mb-3">Cross-Section Zones</div>
              <div className="space-y-2">
                {ZONE_INFO.map((z) => (
                  <div key={z.key} className="flex items-center gap-2.5">
                    <div
                      className="w-3 h-3 rounded-sm flex-shrink-0"
                      style={{ background: z.color }}
                    />
                    <span className="text-xs text-foreground">{z.label}</span>
                    {z.model ? (
                      <span
                        className="ml-auto text-[9px] font-semibold px-1.5 py-0.5 rounded border"
                        style={{
                          color: z.model === "SWAT 2D" ? "#1d4ed8" : "hsl(var(--primary))",
                          borderColor: z.model === "SWAT 2D" ? "#bfdbfe" : "hsl(var(--primary) / 25%)",
                          background: z.model === "SWAT 2D" ? "#eff6ff" : "hsl(var(--primary) / 8%)",
                        }}
                      >
                        {z.model}
                      </span>
                    ) : (
                      <span className="ml-auto text-[9px] text-muted-foreground">Land</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Model info */}
            <div className="px-4 py-4">
              <div className="panel-section-title mb-2">Data Sources</div>
              <div className="space-y-2">
                <div className="bg-blue-50 border border-blue-100 rounded-md px-3 py-2">
                  <div className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">River Zone</div>
                  <div className="text-[10px] text-blue-600 mt-0.5">SWAT 2D · Raster channel cells</div>
                  <div className="text-[9px] text-blue-400 mt-0.5">Shizugawa River · upstream→bay</div>
                </div>
                <div className="bg-primary/5 border border-primary/15 rounded-md px-3 py-2">
                  <div className="text-[10px] font-semibold text-primary uppercase tracking-wide">Bay / Ocean Zone</div>
                  <div className="text-[10px] text-primary/80 mt-0.5">DELFT3D · 3D voxel grid</div>
                  <div className="text-[9px] text-primary/50 mt-0.5">Inner bay → open ocean</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
