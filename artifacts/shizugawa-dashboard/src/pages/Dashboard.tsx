import { useState, useEffect, useRef, useCallback } from "react";
import { DashboardState, TOTAL_WEEKS } from "@/lib/simulatedData";
import BasinOverview from "@/components/BasinOverview";
import OceanBasin3D from "@/components/OceanBasin3D";
import PlaybackControls from "@/components/PlaybackControls";
import InfoPanel from "@/components/InfoPanel";
import TopNav from "@/components/TopNav";

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
  } | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startPlayback = useCallback(() => {
    setIsPlaying(true);
    if (dashboardState === "overview") setDashboardState("playback");
    else if (dashboardState === "paused") setDashboardState("playback");
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
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isPlaying, speed]);

  const handleSelectBasin = () => {
    setDashboardState("playback");
    setIsPlaying(true);
  };

  const handleCellClick = (x: number, z: number) => {
    setSelectedPoint({ x, z });
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

  const stateLabel: Record<DashboardState, string> = {
    "overview": "2D Overview",
    "playback": "3D Playback",
    "paused": "Paused",
    "point-select": "Point Inspection",
    "slice-h": "Horizontal Slice",
    "slice-v": "Vertical Slice",
    "depth-graph": "Depth Profile",
  };

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-background">
      {/* Top navigation bar — dark navy, GauDt-style */}
      <TopNav stateLabel={stateLabel[dashboardState]} />

      {/* Tab bar — white, with active tab underline */}
      <div className="tab-bar flex items-end px-4 flex-shrink-0">
        <div
          className={`tab-item ${!isIn3D ? "tab-item-active" : ""}`}
          onClick={isIn3D ? handleReturnToOverview : undefined}
          data-testid="tab-overview"
        >
          Basin Selection
        </div>
        <div
          className={`tab-item ${isIn3D ? "tab-item-active" : ""}`}
          onClick={!isIn3D ? handleSelectBasin : undefined}
          data-testid="tab-3d"
        >
          3D Playback
        </div>
      </div>

      {/* Toolbar — filter bar mimicking GauDt's Basin / Layer dropdowns */}
      {isIn3D && (
        <div className="flex-shrink-0 flex items-center gap-4 px-4 py-2 bg-white border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">Basin</span>
            <div className="filter-select" data-testid="filter-basin">
              <span className="text-sm">Shizugawa Bay</span>
              <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m6 9 6 6 6-6" />
              </svg>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">Variable</span>
            <select
              className="filter-select pr-8 appearance-none"
              value={selectedVariable}
              onChange={(e) => setSelectedVariable(e.target.value)}
              data-testid="filter-variable"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")", backgroundPosition: "right 0.5rem center", backgroundRepeat: "no-repeat", backgroundSize: "1.25rem" }}
            >
              <option value="nitrogen">Total Nitrogen</option>
              <option value="phosphorus">Total Phosphorus</option>
              <option value="flow">Water Flow</option>
            </select>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {isPlaying ? (
              <div className="flex items-center gap-1.5 text-xs text-green-600">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                Playing
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-amber-600">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                Paused
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: viewport */}
        <div className="flex-1 flex flex-col min-w-0 relative">
          <div className="flex-1 relative overflow-hidden">
            {dashboardState === "overview" ? (
              <BasinOverview
                onSelectOcean={handleSelectBasin}
                onSelectRiver={() => {}}
                selectedWatershed={null}
                onSelectWatershed={() => {}}
              />
            ) : (
              <OceanBasin3D
                week={week}
                colorScale={selectedVariable}
                dashboardState={dashboardState}
                selectedPoint={selectedPoint}
                sliceLevel={sliceLevel}
                sliceDir="east"
                onCellClick={handleCellClick}
              />
            )}

            {/* Viewport help text */}
            {isIn3D && (
              <div className="absolute bottom-3 left-3 bg-white/80 border border-border rounded-md px-2.5 py-1.5 pointer-events-none shadow-sm">
                <div className="text-[10px] text-muted-foreground font-mono">
                  Orbit · Zoom · Click voxel to inspect
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

        {/* Right: info panel */}
        <div className="w-72 flex-shrink-0 border-l border-border overflow-hidden">
          <InfoPanel
            dashboardState={dashboardState}
            setDashboardState={setDashboardState}
            week={week}
            selectedPoint={selectedPoint ? { ...selectedPoint, depth: 0 } : null}
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
