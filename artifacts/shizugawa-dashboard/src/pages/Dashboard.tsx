import { useState, useEffect, useRef, useCallback } from "react";
import { DashboardState, TOTAL_WEEKS } from "@/lib/simulatedData";
import BasinOverview from "@/components/BasinOverview";
import OceanBasin3D from "@/components/OceanBasin3D";
import PlaybackControls from "@/components/PlaybackControls";
import InfoPanel from "@/components/InfoPanel";

export default function Dashboard() {
  const [dashboardState, setDashboardState] = useState<DashboardState>("overview");
  const [week, setWeek] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedVariable, setSelectedVariable] = useState("nitrogen");
  const [sliceLevel, setSliceLevel] = useState(3);
  const [selectedPoint, setSelectedPoint] = useState<{
    x: number;
    z: number;
    depth: number;
  } | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startPlayback = useCallback(() => {
    setIsPlaying(true);
    if (dashboardState === "overview") {
      setDashboardState("playback");
    } else if (dashboardState === "paused") {
      setDashboardState("playback");
    }
  }, [dashboardState]);

  const pausePlayback = useCallback(() => {
    setIsPlaying(false);
    setDashboardState("paused");
  }, []);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setWeek((w) => {
          if (w >= TOTAL_WEEKS - 1) {
            setIsPlaying(false);
            setDashboardState("paused");
            return 0;
          }
          return w + 1;
        });
      }, 800 / speed);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, speed]);

  const handleSelectBasin = () => {
    setDashboardState("playback");
    setIsPlaying(true);
  };

  const handleCellClick = (x: number, z: number, depth: number) => {
    setSelectedPoint({ x, z, depth });
    if (dashboardState !== "point-select" && dashboardState !== "depth-graph") {
      setDashboardState("point-select");
    }
  };

  const handleReturnToOverview = () => {
    setIsPlaying(false);
    setDashboardState("overview");
    setSelectedPoint(null);
  };

  const handleSeek = (w: number) => {
    setWeek(w);
    if (isPlaying) pausePlayback();
    else setDashboardState("paused");
  };

  const handleBack = () => {
    setWeek((w) => Math.max(0, w - 1));
    if (isPlaying) pausePlayback();
  };

  const handleForward = () => {
    setWeek((w) => Math.min(TOTAL_WEEKS - 1, w + 1));
    if (isPlaying) pausePlayback();
  };

  const isIn3D = dashboardState !== "overview";

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-background">
      {/* Top header bar */}
      <header className="flex-shrink-0 h-10 border-b border-border/50 bg-card flex items-center px-4 gap-4">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-5 bg-primary rounded-sm" />
          <span className="text-sm font-semibold tracking-tight text-foreground">3D Time-Series</span>
          <span className="text-muted-foreground/50 text-xs">·</span>
          <span className="data-label text-[10px] text-muted-foreground">Environmental Analytics</span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="data-label text-[9px] text-muted-foreground/60 uppercase tracking-widest">
            {dashboardState === "overview" && "2D Overview"}
            {dashboardState === "playback" && "3D Playback"}
            {dashboardState === "paused" && "3D Paused"}
            {dashboardState === "point-select" && "Point Selection"}
            {dashboardState === "slice-h" && "Horizontal Slice"}
            {dashboardState === "slice-v" && "Vertical Slice"}
            {dashboardState === "depth-graph" && "Depth Graph"}
          </div>
          <div className="h-4 w-px bg-border/40" />
          <span className="data-label text-[9px] text-muted-foreground/60">Shizugawa Bay · Japan</span>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Viewport */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 relative overflow-hidden">
            {dashboardState === "overview" ? (
              <BasinOverview onSelectBasin={handleSelectBasin} />
            ) : (
              <OceanBasin3D
                week={week}
                colorScale={selectedVariable}
                dashboardState={dashboardState}
                selectedPoint={selectedPoint}
                sliceLevel={sliceLevel}
                onCellClick={handleCellClick}
              />
            )}

            {/* State indicator */}
            {isIn3D && (
              <div className="absolute top-3 left-3 bg-card/90 border border-border/40 rounded-sm px-2 py-1 flex items-center gap-2 pointer-events-none">
                <div className={`w-1.5 h-1.5 rounded-full ${isPlaying ? "bg-green-500 animate-pulse" : "bg-amber-500"}`} />
                <span className="data-label text-[9px]">
                  {isPlaying ? "Playing" : "Paused"}
                </span>
              </div>
            )}

            {/* 3D viewport instructions */}
            {isIn3D && (
              <div className="absolute bottom-3 left-3 bg-card/80 border border-border/30 rounded-sm px-2 py-1 pointer-events-none">
                <div className="data-label text-[8px] text-muted-foreground/70">
                  Orbit: drag · Zoom: scroll · Click voxel: inspect
                </div>
              </div>
            )}
          </div>

          {/* Playback controls */}
          {isIn3D && (
            <PlaybackControls
              week={week}
              isPlaying={isPlaying}
              speed={speed}
              onPlay={startPlayback}
              onPause={pausePlayback}
              onSeek={handleSeek}
              onSpeedChange={setSpeed}
              onBack={handleBack}
              onForward={handleForward}
            />
          )}
        </div>

        {/* Right: Info Panel */}
        <div className="w-[260px] flex-shrink-0">
          <InfoPanel
            dashboardState={dashboardState}
            setDashboardState={setDashboardState}
            week={week}
            selectedPoint={selectedPoint}
            selectedVariable={selectedVariable}
            setSelectedVariable={setSelectedVariable}
            sliceLevel={sliceLevel}
            setSliceLevel={setSliceLevel}
            onReturnToOverview={handleReturnToOverview}
          />
        </div>
      </div>
    </div>
  );
}
