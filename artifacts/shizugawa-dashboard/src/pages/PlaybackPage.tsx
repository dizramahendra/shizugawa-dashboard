import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Crosshair, Layers, GitBranchPlus, BarChart2, ArrowUpDown, Activity } from "lucide-react";
import { DashboardState, TOTAL_WEEKS, VARIABLE_OPTIONS, getWeekLabel, valueToConcentration, generateWeekData } from "@/lib/simulatedData";
import TopNav from "@/components/TopNav";
import OceanBasin3D from "@/components/OceanBasin3D";
import PlaybackControls from "@/components/PlaybackControls";
import ColorLegend from "@/components/ColorLegend";
import DepthGraph from "@/components/DepthGraph";
import FlowIndicators from "@/components/FlowIndicators";

type ToolState = "none" | "point-select" | "slice-h" | "slice-v" | "depth-graph";

const tools: { id: ToolState; label: string; icon: typeof Crosshair; desc: string }[] = [
  { id: "point-select", label: "Point Inspection", icon: Crosshair, desc: "Click a voxel to inspect its value" },
  { id: "slice-h", label: "Horizontal Slice", icon: Layers, desc: "Cross-section at fixed depth" },
  { id: "slice-v", label: "Vertical Slice", icon: GitBranchPlus, desc: "Cross-section along a column" },
  { id: "depth-graph", label: "Depth Profile", icon: BarChart2, desc: "Concentration vs. depth" },
];

function toDashboardState(tool: ToolState, isPlaying: boolean): DashboardState {
  if (tool !== "none") return tool as DashboardState;
  return isPlaying ? "playback" : "paused";
}

export default function PlaybackPage() {
  const navigate = useNavigate();
  const [week, setWeek] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [selectedVariable, setSelectedVariable] = useState("nitrogen");
  const [sliceLevel, setSliceLevel] = useState(3);
  const [activeTool, setActiveTool] = useState<ToolState>("none");
  const [selectedPoint, setSelectedPoint] = useState<{ x: number; z: number; depth: number } | null>(null);
  const [showExchange, setShowExchange] = useState(true);
  const [showElution, setShowElution] = useState(true);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const handleCellClick = (x: number, z: number, depth: number) => {
    setSelectedPoint({ x, z, depth });
    if (activeTool === "none") setActiveTool("point-select");
  };

  const handleSeek = (w: number) => { setWeek(w); pause(); };

  const dashboardState = toDashboardState(activeTool, isPlaying);

  const variable = VARIABLE_OPTIONS.find((v) => v.id === selectedVariable) ?? VARIABLE_OPTIONS[0];
  const currentData = selectedPoint ? generateWeekData(week) : null;
  const selectedValue = currentData && selectedPoint
    ? valueToConcentration(
        currentData[selectedPoint.z]?.[selectedPoint.x]?.[selectedPoint.depth] ?? 0,
        selectedVariable
      )
    : null;
  const { label: weekLabel } = getWeekLabel(week);

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-background">
      <TopNav stateLabel={isPlaying ? "Playing" : "Paused"} />

      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-4 px-4 py-2 bg-white border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Basin</span>
          <div className="filter-select">
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
        {/* 3D viewport + playback */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 relative overflow-hidden">
            <OceanBasin3D
              week={week}
              colorScale={selectedVariable}
              dashboardState={dashboardState}
              selectedPoint={selectedPoint}
              sliceLevel={sliceLevel}
              onCellClick={handleCellClick}
            />
            <FlowIndicators
              week={week}
              showExchange={showExchange}
              showElution={showElution}
            />
            <div className="absolute bottom-3 left-3 bg-white/80 border border-border rounded-md px-2.5 py-1.5 pointer-events-none shadow-sm">
              <div className="text-[10px] text-muted-foreground font-mono">Orbit · Zoom · Click voxel to inspect</div>
            </div>
          </div>

          <PlaybackControls
            week={week}
            isPlaying={isPlaying}
            speed={speed}
            onPlay={() => setIsPlaying(true)}
            onPause={pause}
            onSeek={handleSeek}
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
            onClick={() => navigate("/")}
          >
            <ChevronLeft size={14} className="text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Basin Selection</span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-border">
            {/* Location + timestamp */}
            <div className="px-4 py-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
                  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-primary">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">Shizugawa Bay (Ocean)</div>
                  <div className="text-xs text-muted-foreground">Shizugawa · 32.8 km²</div>
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
              <ColorLegend variableId={selectedVariable} variableLabel={variable.label} unit={variable.unit} />
            </div>

            {/* Analysis tools */}
            <div className="px-4 py-4">
              <div className="panel-section-title mb-2">Analysis Tools</div>
              <div className="space-y-1">
                {tools.map((tool) => {
                  const Icon = tool.icon;
                  const isActive = activeTool === tool.id;
                  return (
                    <button
                      key={tool.id}
                      className={`tool-btn ${isActive ? "tool-btn-active" : ""}`}
                      onClick={() => setActiveTool(isActive ? "none" : tool.id)}
                    >
                      <Icon size={14} className="flex-shrink-0" />
                      <div className="text-left">
                        <div className="text-xs font-medium">{tool.label}</div>
                        <div className="text-[10px] text-muted-foreground leading-none mt-0.5">{tool.desc}</div>
                      </div>
                      {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Process Indicators */}
            <div className="px-4 py-4">
              <div className="panel-section-title mb-2 flex items-center gap-1.5">
                <Activity size={11} />
                Process Indicators
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2.5 cursor-pointer group">
                  <button
                    role="switch"
                    aria-checked={showExchange}
                    onClick={() => setShowExchange((v) => !v)}
                    className={`relative inline-flex h-4 w-7 flex-shrink-0 rounded-full border transition-colors focus:outline-none ${showExchange ? "bg-primary border-primary/70" : "bg-muted border-border"}`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-3 w-3 translate-y-0.5 rounded-full bg-white shadow transition-transform ${showExchange ? "translate-x-3.5" : "translate-x-0.5"}`}
                    />
                  </button>
                  <div>
                    <div className="text-xs font-medium text-foreground leading-none">Bay–Ocean Exchange</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">Water &amp; nutrient flux at bay mouth</div>
                  </div>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer group">
                  <button
                    role="switch"
                    aria-checked={showElution}
                    onClick={() => setShowElution((v) => !v)}
                    className={`relative inline-flex h-4 w-7 flex-shrink-0 rounded-full border transition-colors focus:outline-none ${showElution ? "bg-primary border-primary/70" : "bg-muted border-border"}`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-3 w-3 translate-y-0.5 rounded-full bg-white shadow transition-transform ${showElution ? "translate-x-3.5" : "translate-x-0.5"}`}
                    />
                  </button>
                  <div>
                    <div className="text-xs font-medium text-foreground leading-none">Sediment Elution</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">Upward flux from seabed layers</div>
                  </div>
                </label>
              </div>
            </div>

            {/* Slice level */}
            {(activeTool === "slice-h" || activeTool === "slice-v") && (
              <div className="px-4 py-4">
                <div className="panel-section-title mb-2 flex items-center gap-1.5">
                  <ArrowUpDown size={11} />
                  {activeTool === "slice-h" ? "Depth Level" : "Column Index"}
                </div>
                <input
                  type="range"
                  min={0}
                  max={activeTool === "slice-h" ? 7 : 13}
                  value={sliceLevel}
                  onChange={(e) => setSliceLevel(Number(e.target.value))}
                  className="w-full accent-primary cursor-pointer"
                />
                <div className="text-xs text-muted-foreground mt-1.5">
                  {activeTool === "slice-h"
                    ? `Layer ${sliceLevel + 1} · ~${[0, 5, 15, 30, 50, 75, 100, 125][sliceLevel]}m depth`
                    : `Column ${sliceLevel + 1} of 14`}
                </div>
              </div>
            )}

            {/* Selected point */}
            {selectedPoint && (activeTool === "point-select" || activeTool === "depth-graph") && (
              <div className="px-4 py-4">
                <div className="panel-section-title mb-2">Selected Cell</div>
                <div className="bg-muted/40 rounded-md p-3 space-y-2">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[["X", selectedPoint.x], ["Z", selectedPoint.z], ["Layer", `L${selectedPoint.depth + 1}`]].map(([l, v]) => (
                      <div key={l as string} className="bg-white rounded border border-border/60 p-1.5">
                        <div className="text-[9px] text-muted-foreground uppercase tracking-wide">{l}</div>
                        <div className="text-sm font-mono font-semibold text-foreground">{v}</div>
                      </div>
                    ))}
                  </div>
                  {selectedValue !== null && (
                    <div className="pt-2 border-t border-border/40">
                      <div className="text-xs text-muted-foreground">{variable.label}</div>
                      <div className="text-lg font-mono font-bold text-primary mt-0.5">
                        {selectedValue} <span className="text-sm font-normal text-muted-foreground">{variable.unit}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Depth graph */}
            {activeTool === "depth-graph" && (
              <div className="px-4 py-4">
                <DepthGraph
                  week={week}
                  variableId={selectedVariable}
                  variableLabel={variable.label}
                  unit={variable.unit}
                  selectedPoint={selectedPoint}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
