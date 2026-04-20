import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, Crosshair, Layers, GitBranchPlus, BarChart2, ArrowUpDown, Activity } from "lucide-react";
import { DashboardState, TOTAL_WEEKS, VARIABLE_OPTIONS, getWeekLabel, valueToConcentration, generateWeekData, getColumnMean, BAY_MASK, GRID_W, GRID_D } from "@/lib/simulatedData";
import { usePlayback } from "@/context/PlaybackContext";
import { YEARS } from "@/lib/weekUtils";
import WeekRangePicker from "@/components/WeekRangePicker";
import TopNav from "@/components/TopNav";
import OceanBasin3D from "@/components/OceanBasin3D";
import PlaybackControls from "@/components/PlaybackControls";
import DepthGraph from "@/components/DepthGraph";

const COLOR_STOPS: Record<string, string[]> = {
  nitrogen:   ["#2c5f8a","#3d6fa0","#6a9fc0","#90c4de","#c5dfe8","#f5f0d8","#f0d090","#e8a030","#d45820","#c8401c"],
  phosphorus: ["#1a6b4a","#2d8a5e","#4da876","#7ec89a","#b8e0c0","#f0ebb8","#f0d080","#e8a030","#d45820","#c8401c"],
  flow:       ["#0f0527","#1f0a4e","#3a0f7a","#5a1eb0","#7c3ad8","#9d61e8","#bb8ef2","#d4b6f7","#e9d7fb","#f7f0fe"],
};

type SliceTool   = "none" | "slice-h" | "slice-v";
type InspectTool = "none" | "point-select" | "depth-graph";
type ToolState   = SliceTool | InspectTool;

const sliceTools: { id: SliceTool; label: string; icon: typeof Crosshair; desc: string }[] = [
  { id: "slice-h", label: "Horizontal Slice", icon: Layers,       desc: "Cross-section at fixed depth" },
  { id: "slice-v", label: "Vertical Slice",   icon: GitBranchPlus, desc: "Draw a transect · drag the mini-map line" },
];

const inspectTools: { id: InspectTool; label: string; icon: typeof Crosshair; desc: string }[] = [
  { id: "point-select", label: "Point Inspection", icon: Crosshair, desc: "Click any voxel to inspect its column" },
  { id: "depth-graph",  label: "Depth Profile",    icon: BarChart2, desc: "Concentration vs. depth chart" },
];

// ── Mini-map constants (top-down bay view for vertical slice) ─────────────────
const MINI_CELL = 3;            // px per grid cell
const MINI_W = GRID_W * MINI_CELL; // 168
const MINI_H = GRID_D * MINI_CELL; // 144

function toDashboardState(tool: ToolState, isPlaying: boolean): DashboardState {
  if (tool !== "none") return tool as DashboardState;
  return isPlaying ? "playback" : "paused";
}

/*
 * Shizugawa Bay real-world coordinate bounds (DELFT3D model domain):
 *   Longitude: 141.383°E → 141.468°E  (west → east,  grid x 0→13)
 *   Latitude:  38.582°N  → 38.651°N   (south → north, grid z 0→11)
 *   Depth:     0 m (surface) → 35 m (bottom, grid depth 0→7)
 */
const BAY_LON_W = 141.383;
const BAY_LON_E = 141.468;
const BAY_LAT_S = 38.582;
const BAY_LAT_N = 38.651;
const MAX_DEPTH_M = 35;

function gridToCoords(x: number, z: number, depthLayer: number) {
  const lon = BAY_LON_W + (x / 13) * (BAY_LON_E - BAY_LON_W);
  const lat = BAY_LAT_S + (z / 11) * (BAY_LAT_N - BAY_LAT_S);
  const depthM = Math.round((depthLayer / 7) * MAX_DEPTH_M);
  return {
    lat: lat.toFixed(4),
    lon: lon.toFixed(4),
    depthM,
  };
}

export default function PlaybackPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const watershedName = searchParams.get("wname") ?? undefined;

  const { year, setYear, weekRange, setWeekRange } = usePlayback();
  const [week, setWeek] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [selectedVariable, setSelectedVariable] = useState(searchParams.get("variable") ?? "nitrogen");
  const _initTool  = searchParams.get("tool")  ?? "none";
  const _initAxis  = searchParams.get("axis");
  const _initLevel = searchParams.get("level");
  const [sliceAxis,  setSliceAxis]  = useState<"x" | "z">(
    (_initAxis === "x" || _initAxis === "z") ? _initAxis : "z"
  );
  const [sliceLevel, setSliceLevel] = useState(() => {
    if (_initLevel !== null) return Number(_initLevel);
    if (_initTool === "slice-v") return Math.floor((GRID_D - 1) / 2);
    return 3;
  });
  const [sliceTool,   setSliceTool]   = useState<SliceTool>(  (["none","slice-h","slice-v"].includes(_initTool)    ? _initTool : "none") as SliceTool);
  const [inspectTool, setInspectTool] = useState<InspectTool>((["none","point-select","depth-graph"].includes(_initTool) ? _initTool : "none") as InspectTool);
  const [selectedPoint, setSelectedPoint] = useState<{ x: number; z: number } | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; z: number } | null>(null);
  const [showUI, setShowUI] = useState(true);
  const [cameraPreset, setCameraPreset] = useState("top");

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pause = useCallback(() => setIsPlaying(false), []);

  // Sync state → URL
  useEffect(() => {
    setSearchParams(p => {
      const next = new URLSearchParams(p);
      if (selectedVariable && selectedVariable !== "nitrogen") next.set("variable", selectedVariable);
      else next.delete("variable");
      const activeTool = sliceTool !== "none" ? sliceTool : inspectTool !== "none" ? inspectTool : null;
      if (activeTool) next.set("tool", activeTool);
      else next.delete("tool");
      // Vertical slice: encode axis + position so the URL fully reproduces the view
      if (sliceTool === "slice-v") {
        next.set("axis", sliceAxis);
        next.set("level", String(sliceLevel));
      } else {
        next.delete("axis");
        next.delete("level");
      }
      return next;
    }, { replace: true });
  }, [selectedVariable, sliceTool, inspectTool, sliceAxis, sliceLevel]);

  // ── Slice helpers ────────────────────────────────────────────────────────────
  const sliceMax = sliceTool === "slice-h" ? 7
    : sliceAxis === "x" ? GRID_W - 1
    : GRID_D - 1;

  function handleSliceAxisChange(axis: "x" | "z") {
    setSliceAxis(axis);
    setSliceLevel(axis === "x" ? Math.floor((GRID_W - 1) / 2) : Math.floor((GRID_D - 1) / 2));
  }

  function handleMiniPointer(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (sliceAxis === "x") {
      const frac = (e.clientX - rect.left) / rect.width;
      setSliceLevel(Math.round(Math.max(0, Math.min(1, frac)) * (GRID_W - 1)));
    } else {
      const frac = (e.clientY - rect.top) / rect.height;
      // After y-flip: top=north=high gz, bottom=south=low gz
      setSliceLevel((GRID_D - 1) - Math.round(Math.max(0, Math.min(1, frac)) * (GRID_D - 1)));
    }
  }

  // Pre-render bay cells as SVG rects (memoised — shape never changes)
  const miniMapCells = useMemo(() => {
    const cells: React.ReactElement[] = [];
    for (let gz = 0; gz < GRID_D; gz++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        if (BAY_MASK[gz]?.[gx]) {
          cells.push(
            <rect
              key={`mc-${gz}-${gx}`}
              x={gx * MINI_CELL}
              y={(GRID_D - 1 - gz) * MINI_CELL}
              width={MINI_CELL}
              height={MINI_CELL}
              fill="#93c5d9"
              opacity={0.72}
            />
          );
        }
      }
    }
    return cells;
  }, []);

  useEffect(() => {
    setWeek(w => Math.max(weekRange[0], Math.min(weekRange[1], w)));
  }, [weekRange]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setWeek((w) => {
          if (w >= weekRange[1]) { setIsPlaying(false); return weekRange[0]; }
          return w + 1;
        });
      }, 800 / speed);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isPlaying, speed, weekRange]);

  const handleCellClick = (x: number, z: number) => {
    setSelectedPoint({ x, z });
    // Auto-activate point inspection when the user clicks with no inspect tool selected
    if (inspectTool === "none") setInspectTool("point-select");
  };

  const handleSeek = (w: number) => { setWeek(w); pause(); };

  // Slice tool takes priority for 3D rendering; inspect tool is a fallback for state labelling
  const activeTool: ToolState = sliceTool !== "none" ? sliceTool
    : inspectTool !== "none" ? inspectTool
    : "none";
  const dashboardState = toDashboardState(activeTool, isPlaying);

  const variable = VARIABLE_OPTIONS.find((v) => v.id === selectedVariable) ?? VARIABLE_OPTIONS[0];
  const weekData = useMemo(() => generateWeekData(week, year), [week, year]);

  const selectedValue = selectedPoint
    ? valueToConcentration(
        getColumnMean(weekData, selectedPoint.x, selectedPoint.z),
        selectedVariable
      )
    : null;

  const basinMean = useMemo(() => {
    let sum = 0;
    let count = 0;
    for (let z = 0; z < GRID_D; z++) {
      for (let x = 0; x < GRID_W; x++) {
        if (!BAY_MASK[z]?.[x]) continue;
        sum += getColumnMean(weekData, x, z);
        count++;
      }
    }
    return count > 0 ? valueToConcentration(sum / count, selectedVariable) : null;
  }, [weekData, selectedVariable]);

  const { label: weekLabel } = getWeekLabel(week, year);

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-background">
      <TopNav stateLabel={isPlaying ? "Playing" : "Paused"} watershedName={watershedName} />

      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 bg-white border-b border-border flex-wrap">
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
            {VARIABLE_OPTIONS.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        </div>

        <div className="w-px h-5 bg-border" />

        {/* Year segmented control */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Year</span>
          <div className="flex bg-muted rounded-md p-0.5 gap-0.5">
            {YEARS.map(y => (
              <button
                key={y}
                onClick={() => { setYear(y); setWeek(0); }}
                className={`px-2 py-1 text-[11px] font-mono rounded-sm transition-colors ${
                  year === y
                    ? "bg-white text-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >{y}</button>
            ))}
          </div>
        </div>

        {/* Calendar date range picker */}
        <WeekRangePicker year={year} weekRange={weekRange} onChange={r => { setWeekRange(r); pause(); }} />

        <div className="w-px h-5 bg-border" />

        {/* Camera view presets */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground font-medium">View</span>
          <div className="flex bg-muted rounded-md p-0.5 gap-0.5">
            {(["top","N","S","E","W"] as const).map((label) => {
              const id = label === "top" ? "top" : label.toLowerCase();
              return (
                <button
                  key={id}
                  onClick={() => setCameraPreset(id)}
                  title={label === "top" ? "Top-down view" : `View from ${label}`}
                  className={`px-2 py-1 text-[11px] font-mono rounded-sm transition-colors ${
                    cameraPreset === id
                      ? "bg-white text-foreground shadow-sm font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >{label === "top" ? "↑ Top" : label}</button>
              );
            })}
          </div>
        </div>

        <div className="w-px h-5 bg-border" />

        {/* Hide UI toggle */}
        <button
          onClick={() => setShowUI(v => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
            showUI
              ? "bg-white border-border text-foreground hover:bg-muted/60"
              : "bg-slate-800 border-slate-600 text-white/80 hover:bg-slate-700"
          }`}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="w-3.5 h-3.5 flex-shrink-0">
            {showUI
              ? <><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5Z"/><circle cx="8" cy="8" r="2"/></>
              : <><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5Z"/><line x1="2" y1="2" x2="14" y2="14"/></>
            }
          </svg>
          {showUI ? "Hide UI" : "Show UI"}
        </button>

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
          <div
            className="flex-1 relative overflow-hidden"
            onPointerLeave={() => setHoveredPoint(null)}
          >
            <OceanBasin3D
              week={week}
              colorScale={selectedVariable}
              dashboardState={dashboardState}
              selectedPoint={selectedPoint}
              sliceLevel={sliceLevel}
              sliceAxis={sliceAxis}
              onCellClick={handleCellClick}
              onCellHover={(x, z) => setHoveredPoint({ x, z })}
              showAnnotations={showUI}
              cameraPreset={cameraPreset}
            />

            {/* Live coordinate HUD — top-right corner */}
            {(() => {
              const pt = hoveredPoint ?? selectedPoint;
              if (!pt) return (
                <div className="absolute top-3 right-3 pointer-events-none">
                  <div className="bg-black/40 backdrop-blur-sm rounded-md px-2.5 py-1.5 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-white/40" />
                    <span className="text-[10px] font-mono text-white/40">— °N · — °E · — m</span>
                  </div>
                </div>
              );
              const c = gridToCoords(pt.x, pt.z, 0);
              const isHover = hoveredPoint !== null;
              return (
                <div className="absolute top-3 right-3 pointer-events-none">
                  <div className={`rounded-md px-2.5 py-1.5 flex items-center gap-2 transition-all ${isHover ? "bg-black/60 backdrop-blur-sm" : "bg-black/35 backdrop-blur-sm"}`}>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isHover ? "bg-emerald-400" : "bg-amber-400"}`} />
                    <span className="text-[10px] font-mono text-white leading-none">
                      {c.lat}°N&nbsp;·&nbsp;{c.lon}°E
                    </span>
                    <span className="text-white/40 text-[10px]">|</span>
                    <span className="text-[10px] font-mono text-white/80 leading-none">
                      Surface column
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Bottom-left: legend overlay (same system as Map & River views) */}
            {showUI && (() => {
              const stops = COLOR_STOPS[selectedVariable] ?? COLOR_STOPS.nitrogen;
              return (
                <div className="absolute bottom-3 left-3 z-10 pointer-events-none flex flex-col gap-2">
                  <div className="bg-white/95 border border-border rounded-md px-3 py-2 shadow-sm flex items-center gap-3 whitespace-nowrap">
                    <span className="text-[10px] text-muted-foreground">{variable.label} ({variable.unit})</span>
                    <div className="flex flex-col gap-0.5">
                      <div className="flex rounded-sm overflow-hidden border border-border/30">
                        {stops.map((color, i) => {
                          const lo = (variable.min + (i / stops.length) * (variable.max - variable.min)).toFixed(variable.id === "phosphorus" ? 3 : 1);
                          const hi = (variable.min + ((i + 1) / stops.length) * (variable.max - variable.min)).toFixed(variable.id === "phosphorus" ? 3 : 1);
                          return <div key={i} style={{ backgroundColor: color, width: 22, height: 11 }} title={`${lo}–${hi} ${variable.unit}`} />;
                        })}
                      </div>
                      <div className="flex">
                        {stops.map((_, i) => (
                          <div key={i} className="text-[7px] font-mono text-slate-500 text-center" style={{ width: 22 }}>
                            {(variable.min + (i / stops.length) * (variable.max - variable.min)).toFixed(variable.id === "phosphorus" ? 3 : 1)}
                          </div>
                        ))}
                      </div>
                      <div className="text-[7px] font-mono text-slate-400 text-right" style={{ width: stops.length * 22 }}>
                        {variable.unit}
                      </div>
                    </div>
                  </div>
                  <div className="bg-white/80 border border-border rounded-md px-2.5 py-1.5 shadow-sm">
                    <div className="text-[10px] text-muted-foreground font-mono">Orbit · Zoom · Click surface cell to inspect column</div>
                  </div>
                </div>
              );
            })()}

            {/* ── Vertical-slice mini-map overlay ────────────────────────────── */}
            {activeTool === "slice-v" && (
              <div className="absolute bottom-3 right-3 z-20 pointer-events-auto select-none">
                <div className="bg-white/96 border border-border rounded-lg shadow-lg overflow-hidden" style={{ backdropFilter: "blur(4px)" }}>
                  {/* Header */}
                  <div className="px-2.5 py-1.5 bg-slate-50 border-b border-border flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">
                      {sliceAxis === "x" ? "N–S Slice" : "E–W Slice"} · drag to reposition
                    </span>
                  </div>
                  {/* Bay top-down SVG */}
                  <svg
                    width={MINI_W}
                    height={MINI_H}
                    viewBox={`0 0 ${MINI_W} ${MINI_H}`}
                    style={{ display: "block", cursor: sliceAxis === "x" ? "col-resize" : "row-resize" }}
                    onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); handleMiniPointer(e); }}
                    onPointerMove={(e) => { if (e.buttons > 0) handleMiniPointer(e); }}
                    onPointerUp={() => {}}
                  >
                    {/* Bay water cells */}
                    {miniMapCells}
                    {/* Cardinal labels */}
                    <text x={MINI_W / 2} y={9} textAnchor="middle" fontSize={8} fill="#64748b" fontWeight="600">N</text>
                    <text x={MINI_W / 2} y={MINI_H - 1} textAnchor="middle" fontSize={8} fill="#64748b" fontWeight="600">S</text>
                    <text x={5} y={MINI_H / 2 + 3} textAnchor="middle" fontSize={8} fill="#64748b" fontWeight="600">W</text>
                    <text x={MINI_W - 5} y={MINI_H / 2 + 3} textAnchor="middle" fontSize={8} fill="#64748b" fontWeight="600">E</text>
                    {/* Slice line */}
                    {sliceAxis === "x" ? (
                      <>
                        {/* Glow */}
                        <line
                          x1={sliceLevel * MINI_CELL + MINI_CELL / 2} y1={0}
                          x2={sliceLevel * MINI_CELL + MINI_CELL / 2} y2={MINI_H}
                          stroke="#f59e0b" strokeWidth={6} opacity={0.22}
                        />
                        {/* Line */}
                        <line
                          x1={sliceLevel * MINI_CELL + MINI_CELL / 2} y1={0}
                          x2={sliceLevel * MINI_CELL + MINI_CELL / 2} y2={MINI_H}
                          stroke="#f59e0b" strokeWidth={1.5} opacity={0.95}
                        />
                      </>
                    ) : (
                      <>
                        <line
                          x1={0} y1={(GRID_D - 1 - sliceLevel) * MINI_CELL + MINI_CELL / 2}
                          x2={MINI_W} y2={(GRID_D - 1 - sliceLevel) * MINI_CELL + MINI_CELL / 2}
                          stroke="#f59e0b" strokeWidth={6} opacity={0.22}
                        />
                        <line
                          x1={0} y1={(GRID_D - 1 - sliceLevel) * MINI_CELL + MINI_CELL / 2}
                          x2={MINI_W} y2={(GRID_D - 1 - sliceLevel) * MINI_CELL + MINI_CELL / 2}
                          stroke="#f59e0b" strokeWidth={1.5} opacity={0.95}
                        />
                      </>
                    )}
                  </svg>
                </div>
              </div>
            )}
          </div>

          <PlaybackControls
            week={week}
            isPlaying={isPlaying}
            speed={speed}
            year={year}
            windowStart={weekRange[0]}
            windowEnd={weekRange[1]}
            onPlay={() => setIsPlaying(true)}
            onPause={pause}
            onSeek={handleSeek}
            onSpeedChange={setSpeed}
            onBack={() => { setWeek((w) => Math.max(weekRange[0], w - 1)); pause(); }}
            onForward={() => { setWeek((w) => Math.min(weekRange[1], w + 1)); pause(); }}
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

            {/* Basin Mean */}
            <div className="px-4 py-4">
              <div className="panel-section-title mb-2">Basin Mean</div>
              <div className="rounded-md border border-primary/20 bg-primary/5 p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{variable.label}</div>
                  <div className="text-xl font-mono font-bold text-primary leading-none">
                    {basinMean ?? "—"}
                    <span className="text-sm font-normal text-muted-foreground ml-1">{variable.unit}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">Depth-integrated · all active cells</div>
                </div>
                <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-primary/30 flex-shrink-0">
                  <ellipse cx="12" cy="12" rx="10" ry="4" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M2 12c0 4 4.5 7 10 7s10-3 10-7" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M2 12V8m20 4V8" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2"/>
                </svg>
              </div>
            </div>

            {/* Analysis tools */}
            <div className="px-4 py-4 space-y-3">
              {/* Slice tools (independent of inspect tools) */}
              <div>
                <div className="panel-section-title mb-1.5">Slice View</div>
                <div className="space-y-1">
                  {sliceTools.map((tool) => {
                    const Icon = tool.icon;
                    const isActive = sliceTool === tool.id;
                    return (
                      <button
                        key={tool.id}
                        className={`tool-btn ${isActive ? "tool-btn-active" : ""}`}
                        onClick={() => {
                          if (isActive) { setSliceTool("none"); return; }
                          setSliceTool(tool.id as SliceTool);
                          if (tool.id === "slice-v") {
                            setSliceAxis("z");
                            setSliceLevel(Math.floor((GRID_D - 1) / 2));
                          }
                        }}
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
              {/* Inspect tools (combinable with any slice) */}
              <div>
                <div className="panel-section-title mb-1.5">Inspection</div>
                <div className="space-y-1">
                  {inspectTools.map((tool) => {
                    const Icon = tool.icon;
                    const isActive = inspectTool === tool.id;
                    return (
                      <button
                        key={tool.id}
                        className={`tool-btn ${isActive ? "tool-btn-active" : ""}`}
                        onClick={() => setInspectTool(isActive ? "none" : tool.id)}
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
                {/* Prompt shown when an inspect tool is active but no voxel has been picked yet */}
                {inspectTool !== "none" && !selectedPoint && (
                  <div className="mt-2 flex items-center gap-1.5 rounded-md bg-primary/8 border border-primary/20 px-2.5 py-2">
                    <Crosshair size={11} className="text-primary flex-shrink-0" />
                    <span className="text-[10px] text-primary leading-tight">
                      Click any voxel in the 3D view to inspect
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* HIDDEN – uncomment to restore Process Indicators section
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
            */}

            {/* Slice controls */}
            {sliceTool !== "none" && (
              <div className="px-4 py-4 space-y-3">
                <div className="panel-section-title flex items-center gap-1.5">
                  <ArrowUpDown size={11} />
                  {sliceTool === "slice-h" ? "Horizontal Slice" : "Vertical Slice"}
                </div>

                {/* ── Vertical slice: step-by-step ── */}
                {sliceTool === "slice-v" && (
                  <>
                    {/* Step 1: cut direction */}
                    <div>
                      <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1.5 font-medium">
                        Step 1 · Cut direction
                      </div>
                      <div className="flex bg-muted rounded-md p-0.5 gap-0.5">
                        {([
                          { axis: "z" as const, label: "E–W Cut", sub: "sweeps N→S" },
                          { axis: "x" as const, label: "N–S Cut", sub: "sweeps W→E" },
                        ]).map(({ axis, label, sub }) => (
                          <button
                            key={axis}
                            onClick={() => handleSliceAxisChange(axis)}
                            className={`flex-1 py-1.5 px-1 rounded-sm text-[10px] transition-colors flex flex-col items-center gap-0.5 ${
                              sliceAxis === axis
                                ? "bg-white text-foreground shadow-sm font-semibold"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <span>{label}</span>
                            <span className="text-[8px] opacity-60">{sub}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Step 2: draw hint */}
                    <div className="bg-amber-50 border border-amber-100 rounded-md px-2.5 py-2 flex items-start gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-0.5 flex-shrink-0" />
                      <div className="text-[10px] text-amber-700 leading-snug">
                        <span className="font-semibold">Step 2 · Draw</span> — drag the yellow line on the mini-map (bottom-right of the 3D view)
                      </div>
                    </div>
                  </>
                )}

                {/* Step 3 (both modes): slider */}
                <div>
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1.5 font-medium">
                    {sliceTool === "slice-v" ? "Step 3 · Fine-tune" : "Depth layer"}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={sliceMax}
                    value={sliceLevel}
                    onChange={(e) => setSliceLevel(Number(e.target.value))}
                    className="w-full accent-primary cursor-pointer"
                  />
                  <div className="text-[10px] text-muted-foreground mt-1.5 font-mono">
                    {sliceTool === "slice-h"
                      ? `Layer ${sliceLevel + 1} of 8 · ~${[0, 5, 15, 30, 50, 75, 100, 125][sliceLevel]}m depth`
                      : sliceAxis === "x"
                        ? `Column ${sliceLevel + 1} of ${GRID_W} · ${(141.383 + (sliceLevel / (GRID_W - 1)) * 0.085).toFixed(3)}°E`
                        : `Row ${sliceLevel + 1} of ${GRID_D} · ${(38.582 + (sliceLevel / (GRID_D - 1)) * 0.069).toFixed(4)}°N`}
                  </div>
                </div>
              </div>
            )}

            {/* Selected column — visible whenever an inspect tool is active */}
            {selectedPoint && inspectTool !== "none" && (() => {
              const coords = gridToCoords(selectedPoint.x, selectedPoint.z, 0);
              return (
                <div className="px-4 py-4">
                  <div className="panel-section-title mb-2 flex items-center gap-1.5">
                    Selected Column
                    <span className="ml-auto text-[9px] font-mono bg-primary/10 text-primary border border-primary/20 rounded px-1.5 py-0.5">
                      Surface → 99m
                    </span>
                  </div>
                  <div className="bg-muted/40 rounded-md p-3 space-y-2">
                    {/* Lat / Lon row */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-white rounded border border-border/60 p-1.5 text-center">
                        <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Latitude</div>
                        <div className="text-xs font-mono font-semibold text-foreground">{coords.lat}°N</div>
                      </div>
                      <div className="bg-white rounded border border-border/60 p-1.5 text-center">
                        <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Longitude</div>
                        <div className="text-xs font-mono font-semibold text-foreground">{coords.lon}°E</div>
                      </div>
                    </div>
                    {/* Integration depth badge */}
                    <div className="bg-white rounded border border-border/60 p-1.5 flex items-center justify-between px-2">
                      <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Integration</div>
                      <div className="text-xs font-mono font-semibold text-foreground">
                        All 8 layers
                        <span className="text-muted-foreground font-normal ml-1 text-[9px]">(depth-weighted)</span>
                      </div>
                    </div>
                    {selectedValue !== null && (
                      <div className="pt-2 border-t border-border/40">
                        <div className="text-xs text-muted-foreground">Column-Integrated {variable.label}</div>
                        <div className="text-lg font-mono font-bold text-primary mt-0.5">
                          {selectedValue} <span className="text-sm font-normal text-muted-foreground">{variable.unit}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Depth graph — visible whenever depth-graph inspect tool is active */}
            {inspectTool === "depth-graph" && (
              <div className="px-4 py-4">
                <DepthGraph
                  week={week}
                  variableId={selectedVariable}
                  variableLabel={variable.label}
                  unit={variable.unit}
                  selectedPoint={selectedPoint ? { ...selectedPoint, depth: 0 } : null}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
