import { useState } from "react";
import { Search, ChevronLeft, Crosshair, Layers, GitBranchPlus, BarChart2, ArrowUpDown } from "lucide-react";
import {
  DashboardState,
  VARIABLE_OPTIONS,
  TOTAL_WEEKS,
  getWeekLabel,
  valueToConcentration,
  generateWeekData,
  BAY_MASK,
  GRID_W,
  GRID_D,
} from "@/lib/simulatedData";
import ColorLegend from "./ColorLegend";
import DepthGraph from "./DepthGraph";

interface InfoPanelProps {
  dashboardState: DashboardState;
  setDashboardState: (s: DashboardState) => void;
  week: number;
  selectedPoint: { x: number; z: number; depth: number } | null;
  selectedVariable: string;
  setSelectedVariable: (v: string) => void;
  sliceLevel: number;
  setSliceLevel: (l: number) => void;
  onReturnToOverview: () => void;
}

const BASIN_LIST = [
  { id: 1, name: "Shizugawa Bay (Ocean)", sub: "Shizugawa · 32.8 km²", icon: true },
  { id: 2, name: "Estuary Basin", sub: "Minamisanriku · 12.8 km²" },
  { id: 3, name: "Kitakami", sub: "Motoyoshi · 21.3 km²" },
  { id: 4, name: "Tokura Mountain", sub: "Minamisanriku · 17.2 km²" },
  { id: 5, name: "Hachiman", sub: "Minamisanriku · 24.1 km²" },
  { id: 6, name: "Shizugawa", sub: "Minamisanriku · 25.0 km²" },
  { id: 7, name: "Oritate River", sub: "Minamisanriku · 14.2 km²" },
  { id: 8, name: "Utatsu Highland", sub: "Motoyoshi · 24.1 km²" },
];

const tools: { id: DashboardState; label: string; icon: typeof Crosshair; desc: string }[] = [
  { id: "point-select", label: "Point Inspection", icon: Crosshair, desc: "Click a voxel to inspect its value" },
  { id: "slice-h", label: "Horizontal Slice", icon: Layers, desc: "Cross-section at fixed depth" },
  { id: "slice-v", label: "Vertical Slice", icon: GitBranchPlus, desc: "Cross-section along a column" },
  { id: "depth-graph", label: "Depth Profile", icon: BarChart2, desc: "Concentration vs. depth" },
];

export default function InfoPanel({
  dashboardState,
  setDashboardState,
  week,
  selectedPoint,
  selectedVariable,
  sliceLevel,
  setSliceLevel,
  onReturnToOverview,
}: InfoPanelProps) {
  const [search, setSearch] = useState("");
  const isIn3D = dashboardState !== "overview";
  const { label } = getWeekLabel(week);
  const variable = VARIABLE_OPTIONS.find((v) => v.id === selectedVariable) ?? VARIABLE_OPTIONS[0];

  const currentData = selectedPoint ? generateWeekData(week) : null;
  const selectedValue = currentData && selectedPoint
    ? valueToConcentration(
        currentData[selectedPoint.z]?.[selectedPoint.x]?.[selectedPoint.depth] ?? 0,
        selectedVariable
      )
    : null;

  const filteredBasins = BASIN_LIST.filter(
    (b) => b.name.toLowerCase().includes(search.toLowerCase())
  );

  if (!isIn3D) {
    return (
      <div className="h-full flex flex-col bg-white">
        {/* Panel header */}
        <div className="px-4 py-3.5 border-b border-border">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Sub-basin</h2>
            <span className="text-xs text-muted-foreground">{BASIN_LIST.length} total</span>
          </div>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-border">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              className="search-input"
              placeholder="Search location or basin name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="search-basin"
            />
          </div>
        </div>

        {/* Basin list */}
        <div className="flex-1 overflow-y-auto">
          {filteredBasins.map((basin) => (
            <div
              key={basin.id}
              className={`basin-list-item ${basin.id === 1 ? "basin-list-item-active" : ""}`}
              data-testid={`basin-item-${basin.id}`}
            >
              {basin.icon ? (
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 border border-primary/20">
                  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-primary">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              ) : (
                <div className="basin-number flex-shrink-0">{basin.id}</div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{basin.name}</div>
                <div className="text-xs text-muted-foreground">{basin.sub}</div>
              </div>
              {basin.id === 1 && (
                <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white overflow-y-auto">
      {/* Back to overview */}
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border cursor-pointer hover:bg-muted/40 transition-colors" onClick={onReturnToOverview} data-testid="return-to-overview">
        <ChevronLeft size={14} className="text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Basin Selection</span>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {/* Location header */}
        <div className="px-4 py-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-primary">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">Shizugawa Bay (Ocean)</div>
              <div className="text-xs text-muted-foreground">Shizugawa · 32.8 km²</div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="bg-muted/40 rounded-md p-2.5">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Current week</div>
              <div className="text-sm font-semibold text-foreground font-mono">{label}</div>
            </div>
            <div className="bg-muted/40 rounded-md p-2.5">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Progress</div>
              <div className="text-sm font-semibold text-foreground font-mono">{week + 1}/{TOTAL_WEEKS}w</div>
            </div>
          </div>
        </div>

        {/* Variable legend */}
        <div className="px-4 py-4">
          <div className="panel-section-title mb-3">Data Legend</div>
          <ColorLegend
            variableId={selectedVariable}
            variableLabel={variable.label}
            unit={variable.unit}
          />
        </div>

        {/* Analysis tools */}
        <div className="px-4 py-4">
          <div className="panel-section-title mb-2">Analysis Tools</div>
          <div className="space-y-1">
            {tools.map((tool) => {
              const Icon = tool.icon;
              const isActive = dashboardState === tool.id;
              return (
                <button
                  key={tool.id}
                  className={`tool-btn ${isActive ? "tool-btn-active" : ""}`}
                  onClick={() => setDashboardState(isActive ? "playback" : tool.id)}
                  data-testid={`tool-${tool.id}`}
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

        {/* Slice level */}
        {(dashboardState === "slice-h" || dashboardState === "slice-v") && (
          <div className="px-4 py-4">
            <div className="panel-section-title mb-2 flex items-center gap-1.5">
              <ArrowUpDown size={11} />
              {dashboardState === "slice-h" ? "Depth Level" : "Column Index"}
            </div>
            <input
              type="range"
              min={0}
              max={dashboardState === "slice-h" ? 7 : 13}
              value={sliceLevel}
              onChange={(e) => setSliceLevel(Number(e.target.value))}
              className="w-full accent-primary cursor-pointer"
              data-testid="slice-level"
            />
            <div className="text-xs text-muted-foreground mt-1.5">
              {dashboardState === "slice-h"
                ? `Layer ${sliceLevel + 1} · ~${[0, 5, 15, 30, 50, 75, 100, 125][sliceLevel]}m depth`
                : `Column ${sliceLevel + 1} of 14`}
            </div>
          </div>
        )}

        {/* Selected point */}
        {selectedPoint && (dashboardState === "point-select" || dashboardState === "depth-graph") && (
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
        {dashboardState === "depth-graph" && (
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
  );
}
