import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, Crosshair, Layers, GitBranchPlus, BarChart2, ArrowUpDown, Activity, Waves, MapPin, Droplets, Maximize2, Trees } from "lucide-react";
import { PropRow, OCEAN_DETAILS } from "@/components/IdentificationCard";
import { DashboardState, TOTAL_WEEKS, VARIABLE_OPTIONS, valueToConcentration, generateWeekData, getColumnMean, BAY_MASK, GRID_W, GRID_D } from "@/lib/simulatedData";
import { usePlayback } from "@/context/PlaybackContext";
import { YEARS } from "@/lib/weekUtils";
import WeekRangePicker from "@/components/WeekRangePicker";
import TopNav from "@/components/TopNav";
import OceanBasin3D from "@/components/OceanBasin3D";
import LegendOverlay from "@/components/LegendOverlay";
import PlaybackControls from "@/components/PlaybackControls";
import DepthGraph from "@/components/DepthGraph";
import VoxelRadar from "@/components/VoxelRadar";

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
  { id: "point-select", label: "Point Inspection",        icon: Crosshair, desc: "Click any voxel to inspect its column" },
  { id: "depth-graph",  label: "Depth Profile",           icon: BarChart2, desc: "Concentration vs. depth chart" },
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
  const _initDir   = searchParams.get("dir");
  const _initLevel = searchParams.get("level");
  const [sliceDir, setSliceDir] = useState<"north" | "south" | "east" | "west">(
    (["north","south","east","west"].includes(_initDir ?? "")) ? (_initDir as "north"|"south"|"east"|"west") : "north"
  );
  const [sliceCutType, setSliceCutType] = useState<"one-side" | "both-sides">(
    searchParams.get("cut") === "both" ? "both-sides" : "one-side"
  );
  const [showCutPlane, setShowCutPlane] = useState(searchParams.get("plane") !== "0");
  const [sliceLevel, setSliceLevel] = useState(() => {
    if (_initLevel !== null) return Number(_initLevel);
    if (_initTool === "slice-v") return Math.floor((GRID_D - 1) / 2);
    return 3;
  });
  const [sliceTool,   setSliceTool]   = useState<SliceTool>(  (["none","slice-h","slice-v"].includes(_initTool)    ? _initTool : "none") as SliceTool);
  const _initPx = searchParams.get("px");
  const _initPz = searchParams.get("pz");
  // If px/pz are in the URL but no inspect tool, default to point-select
  const _initInspect = (["none","point-select","depth-graph"].includes(_initTool) ? _initTool : "none") as InspectTool;
  const [inspectTool, setInspectTool] = useState<InspectTool>(
    _initInspect === "none" && _initPx !== null && _initPz !== null ? "point-select" : _initInspect
  );
  const [selectedPoint, setSelectedPoint] = useState<{ x: number; z: number } | null>(() => {
    if (_initPx !== null && _initPz !== null) {
      const x = Number(_initPx), z = Number(_initPz);
      if (Number.isFinite(x) && Number.isFinite(z)) return { x, z };
    }
    return null;
  });
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; z: number } | null>(null);
  // Default: UI hidden on the Ocean Playback 3D page so the bay reads as the
  // primary visual on first paint. Pass `?ui=1` to deep-link with UI visible.
  const [showUI, setShowUI] = useState(searchParams.get("ui") === "1");
  const _initView = searchParams.get("view");
  // Accept both short ("n") and long ("north") forms for backwards-compat
  // with any older deep links, then normalise to the short code that the
  // rest of the app uses.
  const _viewAlias: Record<string, string> = {
    iso: "iso",
    top: "top",
    n: "n", north: "n",
    s: "s", south: "s",
    e: "e", east:  "e",
    w: "w", west:  "w",
  };
  const [cameraPreset, setCameraPreset] = useState(
    _viewAlias[_initView ?? ""] ?? "iso"
  );
  // Counter that bumps on every preset-button click so the 3D camera
  // re-applies the preset even when the user clicks the same button twice
  // (e.g. after manually orbiting). Without this, the CameraController guard
  // would skip the second click.
  const [cameraPresetTick, setCameraPresetTick] = useState(0);
  const applyCameraPreset = useCallback((id: string) => {
    setCameraPreset(id);
    setCameraPresetTick((t) => t + 1);
  }, []);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pause = useCallback(() => setIsPlaying(false), []);

  // Sync state → URL
  useEffect(() => {
    setSearchParams(p => {
      const next = new URLSearchParams(p);

      // Variable
      if (selectedVariable && selectedVariable !== "nitrogen") next.set("variable", selectedVariable);
      else next.delete("variable");

      // Active tool (slice or inspect)
      const activeTool = sliceTool !== "none" ? sliceTool : inspectTool !== "none" ? inspectTool : null;
      if (activeTool) next.set("tool", activeTool);
      else next.delete("tool");

      // Vertical slice: encode direction + cut type + position + cut-plane visibility
      if (sliceTool === "slice-v") {
        if (sliceDir !== "north") next.set("dir", sliceDir); else next.delete("dir");
        if (sliceCutType === "both-sides") next.set("cut", "both"); else next.delete("cut");
        if (!showCutPlane) next.set("plane", "0"); else next.delete("plane");
        next.set("level", String(sliceLevel));
      } else {
        next.delete("dir");
        next.delete("cut");
        next.delete("plane");
        next.delete("level");
      }

      // Selected point (pixel click / point inspection / depth profile)
      if (selectedPoint) {
        next.set("px", String(selectedPoint.x));
        next.set("pz", String(selectedPoint.z));
      } else {
        next.delete("px");
        next.delete("pz");
      }

      // UI visibility — only encode when visible (ui=1); hidden is the default
      if (showUI) next.set("ui", "1");
      else next.delete("ui");

      // Camera view preset — only encode when not default isometric view
      if (cameraPreset && cameraPreset !== "iso") next.set("view", cameraPreset);
      else next.delete("view");

      return next;
    }, { replace: true });
  }, [selectedVariable, sliceTool, inspectTool, sliceDir, sliceCutType, showCutPlane, sliceLevel, selectedPoint, showUI, cameraPreset]);

  // ── Slice helpers ────────────────────────────────────────────────────────────
  const sliceDirIsX = sliceDir === "east" || sliceDir === "west";
  const sliceMax = sliceTool === "slice-h" ? 7
    : sliceDirIsX ? GRID_W - 1
    : GRID_D - 1;

  function handleDirChange(dir: "north" | "south" | "east" | "west") {
    const isX = dir === "east" || dir === "west";
    setSliceDir(dir);
    setSliceLevel(isX ? Math.floor((GRID_W - 1) / 2) : Math.floor((GRID_D - 1) / 2));
  }

  function handleMiniPointer(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (sliceDirIsX) {
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

        {/* Year dropdown */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Year</span>
          <select
            value={year}
            onChange={e => { setYear(Number(e.target.value)); setWeek(0); }}
            className="h-7 px-2 pr-6 text-[11px] font-mono bg-white border border-border rounded-md shadow-sm text-foreground cursor-pointer appearance-none focus:outline-none focus:ring-1 focus:ring-primary"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' viewBox='0 0 10 6'%3E%3Cpath stroke='%2364748b' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round' d='M1 1l4 4 4-4'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center" }}
          >
            {YEARS.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {/* Calendar date range picker */}
        <WeekRangePicker year={year} weekRange={weekRange} onChange={r => { setWeekRange(r); pause(); }} />

        <div className="w-px h-5 bg-border" />

        {/* Camera view presets */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground font-medium">View</span>
          <div className="flex bg-muted rounded-md p-0.5 gap-0.5">
            {(["iso","top","N","S","E","W"] as const).map((label) => {
              const id = label === "top" || label === "iso" ? label : label.toLowerCase();
              const display =
                label === "top" ? "↑ Top" :
                label === "iso" ? "◆ 3D"  :
                label;
              const tip =
                label === "top" ? "Top-down view" :
                label === "iso" ? "Default 3D perspective" :
                `View from ${label}`;
              return (
                <button
                  key={id}
                  onClick={() => applyCameraPreset(id)}
                  title={tip}
                  className={`px-2 py-1 text-[11px] font-mono rounded-sm transition-colors ${
                    cameraPreset === id
                      ? "bg-white text-foreground shadow-sm font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >{display}</button>
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
              sliceDir={sliceDir}
              sliceCutType={sliceCutType}
              showCutPlane={showCutPlane}
              onCellClick={handleCellClick}
              onCellHover={(x, z) => setHoveredPoint({ x, z })}
              showAnnotations={showUI}
              cameraPreset={cameraPreset}
              cameraPresetTick={cameraPresetTick}
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

            {/* Top-left: Orbit/Zoom hint (still toggles with Hide UI) */}
            {showUI && (
              <div className="absolute top-3 left-3 z-10 pointer-events-none">
                <div className="bg-white/80 border border-border rounded-md px-2.5 py-1.5 shadow-sm">
                  <div className="text-[10px] text-muted-foreground font-mono">Orbit · Zoom · Click water column to inspect depth</div>
                </div>
              </div>
            )}

            {/* Bottom-left: legend overlay (always visible, even when UI is hidden) */}
            <div className="absolute bottom-3 left-3 z-10 pointer-events-none">
              <LegendOverlay
                stops={COLOR_STOPS[selectedVariable] ?? COLOR_STOPS.nitrogen}
                min={variable.min}
                max={variable.max}
                unit={variable.unit}
                decimals={variable.decimals ?? 1}
              />
            </div>

            {/* ── Vertical-slice mini-map overlay ────────────────────────────── */}
            {showUI && activeTool === "slice-v" && (
              <div className="absolute bottom-3 right-3 z-20 pointer-events-auto select-none">
                <div className="bg-white/96 border border-border rounded-lg shadow-lg overflow-hidden" style={{ backdropFilter: "blur(4px)" }}>
                  {/* Header */}
                  <div className="px-2.5 py-1.5 bg-slate-50 border-b border-border flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">
                      From {sliceDir.charAt(0).toUpperCase() + sliceDir.slice(1)} · drag to reposition
                    </span>
                  </div>
                  {/* Bay top-down SVG */}
                  <svg
                    width={MINI_W}
                    height={MINI_H}
                    viewBox={`0 0 ${MINI_W} ${MINI_H}`}
                    style={{ display: "block", cursor: sliceDirIsX ? "col-resize" : "row-resize" }}
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
                    {sliceDirIsX ? (
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
            {/* Identification card — same shape as the Map Viewport sidebar */}
            <div className="px-4 py-4">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-9 h-9 rounded-full bg-sky-50 flex items-center justify-center border border-sky-200 flex-shrink-0">
                  <Waves size={16} className="text-sky-600" />
                </div>
                <div className="text-sm font-semibold text-foreground leading-tight min-w-0 truncate">
                  Shizugawa Bay
                </div>
              </div>

              <div className="bg-muted/40 rounded-lg p-3 border border-border/60">
                <PropRow icon={<MapPin size={12} />}    label="Region"     value={OCEAN_DETAILS.region} />
                <PropRow icon={<Droplets size={12} />}  label="Water Body" value={OCEAN_DETAILS.waterBody} />
                <PropRow icon={<Maximize2 size={12} />} label="Area"       value={OCEAN_DETAILS.area} />
                <PropRow icon={<Waves size={12} />}     label="Depth"      value={OCEAN_DETAILS.depth} />
                <PropRow icon={<Trees size={12} />}     label="Land Use"   value={OCEAN_DETAILS.landUse} />
              </div>
            </div>

            {/* Basin Mean */}
            <div className="px-4 py-4">
              <div className="mb-2">
                <div className="panel-section-title">Basin Mean</div>
                <div className="text-[9px] text-muted-foreground mt-0.5">Depth-integrated · all water columns</div>
              </div>
              <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{variable.label}</div>
                <div className="text-xl font-mono font-bold text-primary leading-none">
                  {basinMean ?? "—"}
                  <span className="text-sm font-normal text-muted-foreground ml-1">{variable.unit}</span>
                </div>
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
                            setSliceDir("north");
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

                {/* ── Vertical slice controls ── */}
                {sliceTool === "slice-v" && (
                  <>
                    {/* Step 1: all 6 cut buttons together */}
                    <div>
                      <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1.5 font-medium">
                        Step 1 · Cut direction
                      </div>

                      {/* ── Both-sides (symmetric) ── 2 axis buttons */}
                      <div className="text-[8px] text-muted-foreground/70 mb-1 tracking-wide">Both sides · thin slab</div>
                      <div className="flex bg-muted rounded-md p-0.5 gap-0.5 mb-2">
                        {([
                          { axis: "z" as const, label: "E–W Cut", sub: "sweeps N→S", dir: "north" as const },
                          { axis: "x" as const, label: "N–S Cut", sub: "sweeps W→E", dir: "east"  as const },
                        ]).map(({ axis, label, sub, dir: defaultDir }) => {
                          const active = sliceCutType === "both-sides" && (sliceDirIsX ? axis === "x" : axis === "z");
                          return (
                            <button
                              key={axis}
                              onClick={() => {
                                setSliceCutType("both-sides");
                                setSliceDir(defaultDir);
                                setSliceLevel(axis === "x" ? Math.floor((GRID_W - 1) / 2) : Math.floor((GRID_D - 1) / 2));
                              }}
                              className={`flex-1 py-1.5 px-1 rounded-sm text-[10px] transition-colors flex flex-col items-center gap-0.5 ${
                                active
                                  ? "bg-white text-foreground shadow-sm font-semibold"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              <span>{label}</span>
                              <span className="text-[8px] opacity-60">{sub}</span>
                            </button>
                          );
                        })}
                      </div>

                      {/* ── One-side (directional) ── 2×2 compass grid */}
                      <div className="text-[8px] text-muted-foreground/70 mb-1 tracking-wide">One side · half-volume</div>
                      <div className="grid grid-cols-2 gap-0.5">
                        {([
                          { dir: "north" as const, label: "↑ From North", sub: "looking south" },
                          { dir: "south" as const, label: "↓ From South", sub: "looking north" },
                          { dir: "west"  as const, label: "← From West",  sub: "looking east"  },
                          { dir: "east"  as const, label: "→ From East",  sub: "looking west"  },
                        ]).map(({ dir, label, sub }) => {
                          const active = sliceCutType === "one-side" && sliceDir === dir;
                          return (
                            <button
                              key={dir}
                              onClick={() => { setSliceCutType("one-side"); handleDirChange(dir); }}
                              className={`py-1.5 px-1 rounded-sm text-[10px] transition-colors flex flex-col items-center gap-0.5 border ${
                                active
                                  ? "bg-primary/10 text-primary border-primary/30 font-semibold shadow-sm"
                                  : "bg-muted border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/70"
                              }`}
                            >
                              <span>{label}</span>
                              <span className="text-[8px] opacity-60">{sub}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Cut plane toggle */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowCutPlane(v => !v)}
                        className={`w-7 h-4 rounded-full transition-colors relative flex-shrink-0 ${showCutPlane ? "bg-amber-400" : "bg-muted-foreground/30"}`}
                      >
                        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${showCutPlane ? "translate-x-3.5" : "translate-x-0.5"}`} />
                      </button>
                      <span className="text-[10px] text-muted-foreground">Show cut plane</span>
                    </div>

                    {/* Draw hint */}
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
                      : sliceDirIsX
                        ? `Column ${sliceLevel + 1} of ${GRID_W} · ${(141.383 + (sliceLevel / (GRID_W - 1)) * 0.085).toFixed(3)}°E`
                        : `Row ${sliceLevel + 1} of ${GRID_D} · ${(38.582 + (sliceLevel / (GRID_D - 1)) * 0.069).toFixed(4)}°N`}
                  </div>
                </div>
              </div>
            )}

            {/* Selected column — visible whenever a single-point inspect tool is active */}
            {selectedPoint && inspectTool !== "none" && (() => {
              const coords = gridToCoords(selectedPoint.x, selectedPoint.z, 0);
              const copy = (text: string) => {
                if (typeof navigator !== "undefined" && navigator.clipboard) {
                  navigator.clipboard.writeText(text).catch(() => {});
                }
              };
              const CopyIcon = (
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="w-3.5 h-3.5">
                  <rect x="5" y="5" width="8" height="8" rx="1.2" />
                  <path d="M3 11V4a1 1 0 0 1 1-1h7" />
                </svg>
              );
              return (
                <div className="px-4 py-4">
                  {/* Header row */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-semibold text-foreground">Selected Water Column</div>
                    <button
                      onClick={() => setSelectedPoint(null)}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-foreground border border-border rounded-md hover:bg-muted/60 transition-colors"
                    >
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
                        <line x1="3" y1="3" x2="13" y2="13" />
                        <line x1="13" y1="3" x2="3" y2="13" />
                      </svg>
                      Deselect
                    </button>
                  </div>

                  {/* Lat / Lon / Depth card */}
                  <div className="bg-muted/40 rounded-md p-3 space-y-1.5 mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-24 text-xs text-muted-foreground">Lat.</div>
                      <div className="flex-1 text-sm font-mono font-medium text-foreground">{coords.lat}°N</div>
                      <button
                        onClick={() => copy(`${coords.lat}°N`)}
                        title="Copy latitude"
                        className="text-muted-foreground hover:text-foreground p-0.5 transition-colors"
                      >{CopyIcon}</button>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-24 text-xs text-muted-foreground">Lon.</div>
                      <div className="flex-1 text-sm font-mono font-medium text-foreground">{coords.lon}°E</div>
                      <button
                        onClick={() => copy(`${coords.lon}°E`)}
                        title="Copy longitude"
                        className="text-muted-foreground hover:text-foreground p-0.5 transition-colors"
                      >{CopyIcon}</button>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-24 text-xs text-muted-foreground">Column Depth</div>
                      <div className="flex-1 text-sm font-mono font-medium text-foreground">0–99 m</div>
                      <div className="w-3.5" aria-hidden />
                    </div>
                  </div>

                  {/* Column-integrated total — kept as-is per spec */}
                  {selectedValue !== null && (
                    <div className="bg-muted/40 rounded-md p-3">
                      <div className="text-xs text-muted-foreground">Column-Integrated {variable.label}</div>
                      <div className="text-lg font-mono font-bold text-primary mt-0.5">
                        {selectedValue} <span className="text-sm font-normal text-muted-foreground">{variable.unit}</span>
                      </div>
                    </div>
                  )}

                  {/* Voxel radar — Point Inspection mode only (static placeholder) */}
                  {inspectTool === "point-select" && (
                    <div className="mt-3">
                      <VoxelRadar />
                    </div>
                  )}
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
