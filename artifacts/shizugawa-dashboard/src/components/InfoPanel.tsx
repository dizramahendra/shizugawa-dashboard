import { useState } from "react";
import { ChevronRight, Crosshair, Layers, GitBranchPlus, BarChart2 } from "lucide-react";
import {
  DashboardState,
  VARIABLE_OPTIONS,
  TOTAL_WEEKS,
  getWeekLabel,
  valueToConcentration,
  generateWeekData,
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

export default function InfoPanel({
  dashboardState,
  setDashboardState,
  week,
  selectedPoint,
  selectedVariable,
  setSelectedVariable,
  sliceLevel,
  setSliceLevel,
  onReturnToOverview,
}: InfoPanelProps) {
  const { label } = getWeekLabel(week);
  const isIn3D = dashboardState !== "overview";
  const variable = VARIABLE_OPTIONS.find((v) => v.id === selectedVariable) ?? VARIABLE_OPTIONS[0];

  const tools: { id: DashboardState; label: string; icon: typeof Crosshair; desc: string }[] = [
    { id: "point-select", label: "Point Selection", icon: Crosshair, desc: "Click a voxel to inspect" },
    { id: "slice-h", label: "Horizontal Slice", icon: Layers, desc: "Cross-section at depth" },
    { id: "slice-v", label: "Vertical Slice", icon: GitBranchPlus, desc: "Cross-section by column" },
    { id: "depth-graph", label: "Depth Graph", icon: BarChart2, desc: "Concentration vs. depth" },
  ];

  const currentData = selectedPoint
    ? generateWeekData(week)
    : null;

  const selectedValue = currentData && selectedPoint
    ? valueToConcentration(
        currentData[selectedPoint.z]?.[selectedPoint.x]?.[selectedPoint.depth] ?? 0,
        selectedVariable
      )
    : null;

  return (
    <div className="h-full flex flex-col bg-card border-l border-border/60 overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary/80" />
          <div className="text-xs font-semibold text-foreground tracking-wide">Shizugawa Bay</div>
        </div>
        <div className="data-label mt-0.5">38.6°N 141.4°E · Japan</div>
      </div>

      <div className="flex-1 px-4 py-3 space-y-5 overflow-y-auto">

        {/* Basin Context */}
        <div className="space-y-2">
          <div className="panel-header">Basin Context</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            <div>
              <div className="data-label">Type</div>
              <div className="data-value text-xs">Semi-enclosed bay</div>
            </div>
            <div>
              <div className="data-label">Area</div>
              <div className="data-value text-xs">~22 km²</div>
            </div>
            <div>
              <div className="data-label">Max Depth</div>
              <div className="data-value text-xs">~45 m</div>
            </div>
            <div>
              <div className="data-label">Dataset</div>
              <div className="data-value text-xs">52 weeks</div>
            </div>
          </div>
        </div>

        {/* Current Timestamp */}
        {isIn3D && (
          <div className="space-y-2">
            <div className="panel-header">Current Timestep</div>
            <div className="bg-muted/40 rounded-sm px-3 py-2 border border-border/30">
              <div className="text-sm font-mono font-semibold text-foreground">{label}</div>
              <div className="data-label mt-0.5">Week {week + 1} of {TOTAL_WEEKS} · Year 2023–2024</div>
            </div>
          </div>
        )}

        {/* Variable Selector */}
        {isIn3D && (
          <div className="space-y-2">
            <div className="panel-header">Data Variable</div>
            <div className="space-y-1">
              {VARIABLE_OPTIONS.map((v) => (
                <button
                  key={v.id}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-sm border text-left cursor-pointer transition-colors text-xs
                    ${selectedVariable === v.id
                      ? "bg-primary/8 border-primary/25 text-primary"
                      : "border-border/30 text-muted-foreground hover:text-foreground hover:bg-muted/40"
                    }`}
                  onClick={() => setSelectedVariable(v.id)}
                  data-testid={`variable-${v.id}`}
                >
                  <span className="font-medium">{v.label}</span>
                  <span className="data-label">{v.unit}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Color Legend */}
        {isIn3D && (
          <ColorLegend
            variableId={selectedVariable}
            variableLabel={variable.label}
            unit={variable.unit}
          />
        )}

        {/* Analysis Tools */}
        {isIn3D && (
          <div className="space-y-2">
            <div className="panel-header">Analysis Tools</div>
            <div className="space-y-0.5">
              {tools.map((tool) => {
                const Icon = tool.icon;
                const isActive = dashboardState === tool.id;
                return (
                  <button
                    key={tool.id}
                    className={`analysis-tool-btn ${isActive ? "analysis-tool-btn-active" : ""}`}
                    onClick={() => setDashboardState(isActive ? "playback" : tool.id)}
                    data-testid={`tool-${tool.id}`}
                  >
                    <Icon size={12} />
                    <div className="flex-1 text-left">
                      <div className="text-xs font-medium">{tool.label}</div>
                      <div className="text-[9px] text-muted-foreground">{tool.desc}</div>
                    </div>
                    {isActive && <div className="w-1.5 h-1.5 rounded-full bg-primary/80 flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Slice Level Control */}
        {(dashboardState === "slice-h" || dashboardState === "slice-v") && (
          <div className="space-y-2 pt-2 border-t border-border/30">
            <div className="panel-header">
              {dashboardState === "slice-h" ? "Depth Level" : "Column Index"}
            </div>
            <input
              type="range"
              min={0}
              max={dashboardState === "slice-h" ? 7 : 13}
              value={sliceLevel}
              onChange={(e) => setSliceLevel(Number(e.target.value))}
              className="w-full cursor-pointer"
              data-testid="slice-level"
            />
            <div className="data-label text-[10px]">
              {dashboardState === "slice-h"
                ? `Depth layer ${sliceLevel + 1} · ~${[0, 5, 15, 30, 50, 75, 100, 125][sliceLevel]}m`
                : `Column ${sliceLevel + 1} of 14`}
            </div>
          </div>
        )}

        {/* Selected Point Info */}
        {selectedPoint && (dashboardState === "point-select" || dashboardState === "depth-graph") && (
          <div className="space-y-2 pt-2 border-t border-border/30">
            <div className="panel-header">Selected Cell</div>
            <div className="bg-muted/40 rounded-sm px-3 py-2 border border-border/30 space-y-1.5">
              <div className="grid grid-cols-3 gap-1">
                <div>
                  <div className="data-label">X</div>
                  <div className="data-value text-xs">{selectedPoint.x}</div>
                </div>
                <div>
                  <div className="data-label">Z</div>
                  <div className="data-value text-xs">{selectedPoint.z}</div>
                </div>
                <div>
                  <div className="data-label">Depth</div>
                  <div className="data-value text-xs">L{selectedPoint.depth + 1}</div>
                </div>
              </div>
              {selectedValue !== null && (
                <div className="pt-1.5 border-t border-border/30">
                  <div className="data-label">{variable.label}</div>
                  <div className="text-sm font-mono font-semibold text-primary">
                    {selectedValue} {variable.unit}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Depth Graph */}
        {dashboardState === "depth-graph" && (
          <DepthGraph
            week={week}
            variableId={selectedVariable}
            variableLabel={variable.label}
            unit={variable.unit}
            selectedPoint={selectedPoint}
          />
        )}

        {/* Return to overview */}
        {isIn3D && (
          <div className="pt-2 border-t border-border/30">
            <button
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              onClick={onReturnToOverview}
              data-testid="return-to-overview"
            >
              <ChevronRight size={12} className="rotate-180" />
              Return to 2D overview
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
