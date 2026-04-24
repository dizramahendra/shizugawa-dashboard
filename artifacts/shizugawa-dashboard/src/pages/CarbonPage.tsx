import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Leaf } from "lucide-react";
import TopNav from "@/components/TopNav";
import OceanBasin3D from "@/components/OceanBasin3D";
import CarbonPortfolioPanel, { PortfolioPixel } from "@/components/CarbonPortfolioPanel";
import { RainbowStrip } from "@/components/HsiGauge";
import { usePlayback } from "@/context/PlaybackContext";
import {
  PIXEL_PALETTE, MeasureId,
  gridToLonLat, BAY_COORDS,
} from "@/lib/simulatedData";
import { YEARS } from "@/lib/weekUtils";

export default function CarbonPage() {
  const navigate = useNavigate();
  const { year, setYear } = usePlayback();

  const [showUI, setShowUI]       = useState(true);
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; z: number } | null>(null);

  const [pixels,  setPixels]  = useState<PortfolioPixel[]>([]);
  const [measure, setMeasure] = useState<MeasureId>("none");

  // Click-to-toggle pixel into the project area
  const handleCellClick = (x: number, z: number) => {
    setPixels((prev) => {
      const id = `${x}:${z}`;
      const existing = prev.findIndex((p) => p.id === id);
      if (existing >= 0) return prev.filter((p) => p.id !== id);
      if (prev.length >= 4) return prev;
      const used = new Set(prev.map((p) => p.color));
      const color = PIXEL_PALETTE.find((c) => !used.has(c)) ?? PIXEL_PALETTE[prev.length % PIXEL_PALETTE.length];
      return [...prev, { id, x, z, color }];
    });
  };

  const handleRemovePixel = (id: string) =>
    setPixels((prev) => prev.filter((p) => p.id !== id));

  // Hover/selection HUD coordinates
  const huePt = hoveredPoint ?? (pixels.length > 0 ? { x: pixels[0].x, z: pixels[0].z } : null);
  const huePtLL = huePt ? gridToLonLat(huePt.x, huePt.z) : null;

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-background">
      <TopNav stateLabel="Planning" />

      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 bg-white border-b border-border flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Project area</span>
          <div className="filter-select">
            <span className="text-sm">Shizugawa Bay</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Baseline year</span>
          <select
            className="filter-select pr-8 appearance-none"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{
              backgroundImage: "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")",
              backgroundPosition: "right 0.5rem center",
              backgroundRepeat: "no-repeat",
              backgroundSize: "1.25rem",
            }}
          >
            {YEARS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Sample points</span>
          <span className="text-xs font-mono text-foreground">{pixels.length} / 4</span>
          {pixels.length > 0 && (
            <button
              className="text-[10px] underline text-muted-foreground hover:text-foreground"
              onClick={() => setPixels([])}
            >
              clear
            </button>
          )}
        </div>

        <button
          className="ml-1 text-xs px-2 py-1 rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
          onClick={() => setShowUI((s) => !s)}
        >
          {showUI ? "Hide UI" : "Show UI"}
        </button>

        <div className="ml-auto flex items-center gap-1.5 text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span className="text-emerald-700">Annual outlook · steady-state</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* 3D viewport (no playback bar — carbon outlook is time-independent) */}
        <div className="flex-1 flex flex-col min-w-0">
          <div
            className="flex-1 relative overflow-hidden"
            onPointerLeave={() => setHoveredPoint(null)}
          >
            <OceanBasin3D
              week={0}
              colorScale="nitrogen"
              dashboardState="paused"
              selectedPoint={null}
              sliceLevel={0}
              sliceDir="north"
              onCellClick={handleCellClick}
              onCellHover={(x, z) => setHoveredPoint({ x, z })}
              showAnnotations={showUI}
              markerPixels={pixels}
            />

            {/* Coordinate HUD — top-right */}
            <div className="absolute top-3 right-3 pointer-events-none">
              <div className={`rounded-md px-2.5 py-1.5 flex items-center gap-2 ${huePtLL ? "bg-black/55" : "bg-black/35"} backdrop-blur-sm`}>
                <span className={`w-1.5 h-1.5 rounded-full ${huePtLL ? "bg-emerald-400" : "bg-white/40"}`} />
                <span className="text-[10px] font-mono text-white/90 leading-none">
                  {huePtLL
                    ? `${huePtLL.lat.toFixed(3)}°N · ${huePtLL.lon.toFixed(3)}°E`
                    : "— °N · — °E"}
                </span>
              </div>
            </div>

            {/* Top-left: page identity */}
            {showUI && (
              <div className="absolute top-3 left-3 pointer-events-none">
                <div className="bg-emerald-700/90 backdrop-blur-sm rounded-md px-2.5 py-1.5 flex items-center gap-1.5 shadow">
                  <Leaf className="w-3.5 h-3.5 text-emerald-100" />
                  <span className="text-[11px] font-semibold text-white tracking-wide">Carbon sequestration · Shizugawa Bay</span>
                </div>
              </div>
            )}

            {/* Bottom-left: HSI legend strip */}
            {showUI && (
              <div className="absolute bottom-3 left-3 z-10 pointer-events-none flex flex-col gap-2">
                <div className="bg-white/95 border border-border rounded-md px-3 py-2 shadow-sm w-[220px]">
                  <div className="text-[10px] text-muted-foreground mb-1">Habitat Suitability Index (HSI)</div>
                  <RainbowStrip height={12} />
                </div>
                <div className="bg-white/80 border border-border rounded-md px-2.5 py-1.5 shadow-sm">
                  <div className="text-[10px] text-muted-foreground font-mono">
                    Click ocean cells to add sample points · max 4 · {BAY_COORDS.lonW.toFixed(2)}°E – {BAY_COORDS.lonE.toFixed(2)}°E
                  </div>
                </div>
              </div>
            )}

            {/* Empty-state hint when no pixels selected */}
            {pixels.length === 0 && showUI && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-white/90 backdrop-blur-sm border border-border rounded-lg px-4 py-3 shadow-md max-w-[320px] text-center">
                  <Leaf className="w-5 h-5 text-emerald-600 mx-auto mb-1.5" />
                  <div className="text-sm font-medium text-foreground mb-0.5">Define your project area</div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    Click up to 4 ocean cells to drop sample points. They define
                    where your decarbonization measure is applied.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: portfolio panel */}
        <div className="w-80 flex-shrink-0 border-l border-border flex flex-col bg-white overflow-hidden">
          <div
            className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border cursor-pointer hover:bg-muted/40 transition-colors flex-shrink-0"
            onClick={() => navigate("/")}
          >
            <ChevronLeft size={14} className="text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Basin Selection</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            <CarbonPortfolioPanel
              pixels={pixels}
              measure={measure}
              year={year}
              onChangeMeasure={setMeasure}
              onRemovePixel={handleRemovePixel}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
