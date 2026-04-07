import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import {
  TOTAL_WEEKS,
  VARIABLE_OPTIONS,
  getWeekLabel,
  valueToConcentration,
  generateRiverData,
  RIVERS,
  RIVER_ROWS,
  RIVER_COLS,
} from "@/lib/simulatedData";
import TopNav from "@/components/TopNav";
import PlaybackControls from "@/components/PlaybackControls";
import RiverGrid2D from "@/components/RiverGrid2D";

const COLOR_STOPS: Record<string, string[]> = {
  nitrogen:   ["#3b6fa0", "#6ca0c8", "#b8dce8", "#f0e68c", "#e8a030", "#c8401c"],
  phosphorus: ["#3b6fa0", "#6ca0c8", "#b8dce8", "#f0e68c", "#e8a030", "#c8401c"],
  chlorophyll:["#1a4a2e", "#2d7a4a", "#5aab6e", "#a8d898", "#e8f4b0", "#f5f5dc"],
  do:         ["#c8401c", "#e8a030", "#f0e68c", "#b8dce8", "#6ca0c8", "#3b6fa0"],
};

export default function RiverPlaybackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const riverId = searchParams.get("river") ?? "shizugawa";
  const watershedName = searchParams.get("wname") ?? undefined;

  const river = RIVERS.find((r) => r.id === riverId) ?? RIVERS[0];
  const [week, setWeek] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [selectedVariable, setSelectedVariable] = useState("nitrogen");
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);

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

  const variable = VARIABLE_OPTIONS.find((v) => v.id === selectedVariable) ?? VARIABLE_OPTIONS[0];
  const { label: weekLabel } = getWeekLabel(week);
  const stops = COLOR_STOPS[selectedVariable] ?? COLOR_STOPS.nitrogen;

  const riverWeekData = useMemo(() => generateRiverData(week, riverId), [week, riverId]);

  const cellValue = selectedCell
    ? valueToConcentration(
        riverWeekData[selectedCell.row]?.[selectedCell.col] ?? 0,
        selectedVariable
      )
    : null;

  const reachMean = useMemo(() => {
    let sum = 0;
    let count = 0;
    for (let row = 0; row < RIVER_ROWS; row++) {
      for (let col = 0; col < RIVER_COLS; col++) {
        sum += riverWeekData[row]?.[col] ?? 0;
        count++;
      }
    }
    return count > 0 ? valueToConcentration(sum / count, selectedVariable) : null;
  }, [riverWeekData, selectedVariable]);

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-background">
      <TopNav stateLabel={`River Playback View (2D) · ${isPlaying ? "Playing" : "Paused"}`} watershedName={watershedName} />

      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-4 px-4 py-2 bg-white border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">River</span>
          <div className="flex items-center gap-2 px-3 h-10 rounded-md border border-border bg-white text-sm text-foreground min-w-[200px]">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-blue-500 flex-shrink-0">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M4 18c2-4 6-6 8-6s6 2 8 6" stroke="currentColor" strokeWidth="1" opacity="0.5" strokeDasharray="2 2"/>
            </svg>
            <span>{river.name}</span>
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
          {isPlaying
            ? <><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /><span className="text-green-600">Playing</span></>
            : <><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /><span className="text-amber-600">Paused</span></>}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left: 2D grid + playback */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <RiverGrid2D
              week={week}
              variableId={selectedVariable}
              riverId={riverId}
              selectedCell={selectedCell}
              onCellClick={(row, col) => setSelectedCell({ row, col })}
            />
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
            onClick={() => navigate("/")}
          >
            <ChevronLeft size={14} className="text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Map Viewport</span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-border">

            {/* 1. River context */}
            <div className="px-4 py-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center border border-blue-200">
                  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-blue-500">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" stroke="currentColor" strokeWidth="1.5"/>
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">{river.name}</div>
                  <div className="text-xs text-muted-foreground">{river.sub}</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="bg-muted/40 rounded-md p-2.5">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Length</div>
                  <div className="text-sm font-semibold text-foreground font-mono">{river.length}</div>
                </div>
                <div className="bg-muted/40 rounded-md p-2.5">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">View</div>
                  <div className="text-sm font-semibold text-foreground">2D Grid</div>
                </div>
              </div>
            </div>

            {/* 2. Playback status / time */}
            <div className="px-4 py-4">
              <div className="panel-section-title mb-3">Playback Status</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-muted/40 rounded-md p-2.5">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Current week</div>
                  <div className="text-sm font-semibold text-foreground font-mono">{weekLabel}</div>
                </div>
                <div className="bg-muted/40 rounded-md p-2.5">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Progress</div>
                  <div className="text-sm font-semibold text-foreground font-mono">{week + 1}/{TOTAL_WEEKS}w</div>
                </div>
              </div>
              <div className="mt-2 w-full h-1 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-blue-400 rounded-full transition-all duration-150" style={{ width: `${(week / (TOTAL_WEEKS - 1)) * 100}%` }} />
              </div>
            </div>

            {/* 3. Variable + Legend */}
            <div className="px-4 py-4">
              <div className="panel-section-title mb-3">Variable</div>
              <div className="text-sm font-medium text-foreground">{variable.label}</div>
              <div className="text-xs text-muted-foreground mb-3">{variable.unit}</div>
              <div className="h-3.5 rounded border border-border/50" style={{
                background: `linear-gradient(to right, ${stops.join(", ")})`
              }} />
              <div className="flex justify-between text-[10px] font-mono text-muted-foreground mt-1">
                <span>Low</span>
                <span>High</span>
              </div>
            </div>

            {/* 3b. Reach Mean */}
            <div className="px-4 py-4">
              <div className="panel-section-title mb-2">Reach Mean</div>
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{variable.label}</div>
                  <div className="text-xl font-mono font-bold text-blue-600 leading-none">
                    {reachMean ?? "—"}
                    <span className="text-sm font-normal text-muted-foreground ml-1">{variable.unit}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">Spatial mean · all reach cells</div>
                </div>
                <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-blue-300 flex-shrink-0">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M4 18c2-4 6-6 8-6s6 2 8 6" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2"/>
                </svg>
              </div>
            </div>

            {/* 4. Selected cell */}
            {selectedCell && (
              <div className="px-4 py-4">
                <div className="panel-section-title mb-2">Selected Cell</div>
                <div className="bg-muted/40 rounded-md p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-center">
                    {[["Row", selectedCell.row + 1], ["Col", selectedCell.col + 1]].map(([l, v]) => (
                      <div key={l as string} className="bg-white rounded border border-border/60 p-1.5">
                        <div className="text-[9px] text-muted-foreground uppercase tracking-wide">{l}</div>
                        <div className="text-sm font-mono font-semibold text-foreground">{v}</div>
                      </div>
                    ))}
                  </div>
                  {cellValue !== null && (
                    <div className="pt-2 border-t border-border/40">
                      <div className="text-xs text-muted-foreground">{variable.label}</div>
                      <div className="text-lg font-mono font-bold text-blue-600 mt-0.5">
                        {cellValue} <span className="text-sm font-normal text-muted-foreground">{variable.unit}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* No depth section — river is 2D only */}
            <div className="px-4 py-4">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
                <div className="w-3 h-px bg-muted-foreground/30" />
                <span>2D view · no depth section</span>
                <div className="flex-1 h-px bg-muted-foreground/30" />
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
