import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import {
  TOTAL_WEEKS,
  VARIABLE_OPTIONS,
  getWeekLabel,
  valueToConcentration,
  generateRiverData,
  generateCompositeRiverData,
  getCompositeRiver,
  COMPOSITE_RIVERS,
  RIVERS,
  RIVER_ROWS,
  RIVER_COLS,
} from "@/lib/simulatedData";
import { usePlayback } from "@/context/PlaybackContext";
import { YEARS } from "@/lib/weekUtils";
import WeekRangePicker from "@/components/WeekRangePicker";

// ── Inline sparkline chart ────────────────────────────────────
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function ReachMeanChart({
  series, currentWeek, unit, color,
}: {
  series: number[];
  currentWeek: number;
  unit: string;
  color: string;
}) {
  const W = 228, H = 72, PAD_L = 28, PAD_R = 6, PAD_T = 6, PAD_B = 20;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const minV = Math.min(...series);
  const maxV = Math.max(...series);
  const range = maxV - minV || 1;

  const toX = (i: number) => PAD_L + (i / (series.length - 1)) * innerW;
  const toY = (v: number) => PAD_T + (1 - (v - minV) / range) * innerH;

  const points = series.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
  const areaPoints = [
    `${toX(0)},${PAD_T + innerH}`,
    ...series.map((v, i) => `${toX(i)},${toY(v)}`),
    `${toX(series.length - 1)},${PAD_T + innerH}`,
  ].join(" ");

  const cx = toX(currentWeek);
  const cy = toY(series[currentWeek] ?? minV);

  // Month ticks: week 0 = Jan w1, 52 weeks across 12 months
  const monthTicks = [0, 4, 9, 13, 17, 22, 26, 30, 35, 39, 43, 48].map((w, i) => ({
    x: toX(w), label: MONTHS[i],
  }));

  const yTicks = [minV, (minV + maxV) / 2, maxV].map(v => ({
    y: toY(v), label: v.toFixed(1),
  }));

  return (
    <svg width={W} height={H} className="overflow-visible">
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Y grid lines */}
      {yTicks.map(({ y, label }) => (
        <g key={label}>
          <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#e2e8f0" strokeWidth="1" />
          <text x={PAD_L - 3} y={y + 3.5} textAnchor="end" fontSize="7" fill="#94a3b8" fontFamily="monospace">
            {label}
          </text>
        </g>
      ))}

      {/* Area fill */}
      <polygon points={areaPoints} fill="url(#areaGrad)" />

      {/* Line */}
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />

      {/* Current-week cursor */}
      <line x1={cx} y1={PAD_T} x2={cx} y2={PAD_T + innerH} stroke={color} strokeWidth="1" strokeDasharray="3 2" opacity="0.6" />
      <circle cx={cx} cy={cy} r="3" fill={color} stroke="white" strokeWidth="1.5" />

      {/* Value label above dot */}
      <rect x={cx - 18} y={cy - 17} width={36} height={12} rx="2" fill={color} opacity="0.9" />
      <text x={cx} y={cy - 8} textAnchor="middle" fontSize="7" fill="white" fontFamily="monospace" fontWeight="bold">
        {(series[currentWeek] ?? 0).toFixed(2)} {unit}
      </text>

      {/* X axis month labels */}
      {monthTicks.map(({ x, label }) => (
        <text key={label} x={x} y={H - 4} textAnchor="middle" fontSize="7" fill="#94a3b8" fontFamily="monospace">
          {label}
        </text>
      ))}

      {/* Axis lines */}
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + innerH} stroke="#cbd5e1" strokeWidth="1" />
      <line x1={PAD_L} y1={PAD_T + innerH} x2={W - PAD_R} y2={PAD_T + innerH} stroke="#cbd5e1" strokeWidth="1" />
    </svg>
  );
}
import TopNav from "@/components/TopNav";
import PlaybackControls from "@/components/PlaybackControls";
import RiverGrid2D from "@/components/RiverGrid2D";


export default function RiverPlaybackPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [riverId, setRiverId] = useState(searchParams.get("river") ?? "shizugawa");
  const watershedName = searchParams.get("wname") ?? undefined;

  const { year, setYear, weekRange, setWeekRange } = usePlayback();
  const composite = getCompositeRiver(riverId);
  const river = composite ? null : (RIVERS.find((r) => r.id === riverId) ?? RIVERS[0]);
  const [week, setWeek] = useState(weekRange[0]);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [selectedVariable, setSelectedVariable] = useState(searchParams.get("variable") ?? "nitrogen");
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pause = useCallback(() => setIsPlaying(false), []);

  // Sync state → URL
  useEffect(() => {
    setSearchParams(p => {
      const next = new URLSearchParams(p);
      if (riverId && riverId !== "shizugawa") next.set("river", riverId);
      else next.delete("river");
      if (selectedVariable && selectedVariable !== "nitrogen") next.set("variable", selectedVariable);
      else next.delete("variable");
      return next;
    }, { replace: true });
  }, [riverId, selectedVariable]);

  // Clamp week to weekRange when range changes
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

  const variable = VARIABLE_OPTIONS.find((v) => v.id === selectedVariable) ?? VARIABLE_OPTIONS[0];
  const { label: weekLabel } = getWeekLabel(week, year);

  const riverWeekData = useMemo(
    () => composite
      ? generateCompositeRiverData(week, riverId, year)
      : generateRiverData(week, riverId, year),
    [week, riverId, year, composite]
  );

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

  // Full 52-week time series — recompute only when river, variable, or year changes
  const allWeekMeans = useMemo(() => {
    return Array.from({ length: TOTAL_WEEKS }, (_, w) => {
      const grid = composite
        ? generateCompositeRiverData(w, riverId, year)
        : generateRiverData(w, riverId, year);
      let s = 0, c = 0;
      for (let r = 0; r < RIVER_ROWS; r++)
        for (let col = 0; col < RIVER_COLS; col++) { s += grid[r]?.[col] ?? 0; c++; }
      return c > 0 ? valueToConcentration(s / c, selectedVariable) : 0;
    });
  }, [riverId, selectedVariable, year, composite]);

  const CHART_COLORS: Record<string, string> = {
    nitrogen: "#3b6fa0", phosphorus: "#4a7fb5", flow: "#26c6da",
  };

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-background">
      <TopNav stateLabel={`River Playback View (2D) · ${isPlaying ? "Playing" : "Paused"}`} watershedName={watershedName} />

      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 bg-white border-b border-border flex-wrap">
        {/* River selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">River</span>
          <select
            value={riverId}
            onChange={e => { setRiverId(e.target.value); setSelectedCell(null); }}
            className="filter-select pr-8 appearance-none min-w-[220px]"
            style={{
              backgroundImage: "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")",
              backgroundPosition: "right 0.5rem center",
              backgroundRepeat: "no-repeat",
              backgroundSize: "1.25rem",
            }}
          >
            <optgroup label="── Single-basin rivers ──">
              {RIVERS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </optgroup>
            <optgroup label="── Multi-basin corridors ──">
              {COMPOSITE_RIVERS.map(c => (
                <option key={c.id} value={c.id}>⇢ {c.name}</option>
              ))}
            </optgroup>
          </select>
        </div>

        {/* Variable selector */}
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
            <option value="flow">Water Flow</option>
          </select>
        </div>

        {/* Separator */}
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

        {/* Playing indicator */}
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
            year={year}
            windowStart={weekRange[0]}
            windowEnd={weekRange[1]}
            onPlay={() => setIsPlaying(true)}
            onPause={pause}
            onSeek={(w) => { setWeek(w); pause(); }}
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
            <span className="text-xs text-muted-foreground">Map Viewport</span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-border">

            {/* 1. River / corridor context */}
            <div className="px-4 py-4">
              {composite ? (
                <>
                  {/* Composite corridor header */}
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-violet-50 flex items-center justify-center border border-violet-200 flex-shrink-0">
                      <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-violet-500">
                        <path d="M3 17c2-4 5-6 7-5s4 5 7 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        <path d="M3 12c3-3 5-1 7 1s4 4 8 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground">{composite.name}</div>
                      <div className="text-[10px] text-muted-foreground leading-snug mt-0.5">{composite.description}</div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="bg-muted/40 rounded-md p-2.5">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Total Length</div>
                      <div className="text-sm font-semibold text-foreground font-mono">{composite.totalLength}</div>
                    </div>
                    <div className="bg-violet-50 border border-violet-100 rounded-md p-2.5">
                      <div className="text-[10px] text-violet-400 uppercase tracking-wide mb-0.5">Topology</div>
                      <div className="text-sm font-semibold text-violet-700 capitalize">{composite.topology}</div>
                    </div>
                  </div>
                  {/* Segment chips */}
                  {(() => {
                    const UPPER_BORDERS = ["#93c5fd", "#c4b5fd"];
                    const UPPER_BG      = ["#eff6ff", "#f5f3ff"];
                    const UPPER_COLORS  = ["#2563eb", "#7c3aed"];
                    let ui = 0;
                    return (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {composite.segments.map(seg => {
                          const isLower = seg.role === "lower";
                          const border = isLower ? "#5eead4" : UPPER_BORDERS[ui % 2];
                          const bg     = isLower ? "#f0fdfa"  : UPPER_BG[ui % 2];
                          const color  = isLower ? "#0d9488"  : UPPER_COLORS[ui % 2];
                          const label  = isLower ? "Lower (→ Bay)" : `Upper ${composite.topology === "convergent" ? ui + 1 : ""}`;
                          if (!isLower) ui++;
                          return (
                            <div
                              key={seg.riverId}
                              className="flex-1 min-w-[5rem] rounded border px-2 py-1.5"
                              style={{ borderColor: border, background: bg }}
                            >
                              <div className="text-[9px] uppercase tracking-wide font-medium" style={{ color }}>
                                {label}
                              </div>
                              <div className="text-[11px] font-semibold text-foreground">{seg.name}</div>
                              <div className="text-[9px] text-muted-foreground">{seg.sub}</div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center border border-blue-200">
                      <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-blue-500">
                        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" stroke="currentColor" strokeWidth="1.5"/>
                      </svg>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground">{river!.name}</div>
                      <div className="text-xs text-muted-foreground">{river!.sub}</div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="bg-muted/40 rounded-md p-2.5">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Length</div>
                      <div className="text-sm font-semibold text-foreground font-mono">{river!.length}</div>
                    </div>
                    <div className="bg-muted/40 rounded-md p-2.5">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">View</div>
                      <div className="text-sm font-semibold text-foreground">2D Grid</div>
                    </div>
                  </div>
                </>
              )}
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

            {/* 3b. Reach Mean — spatial average across all reach cells */}
            <div className="px-4 py-4">
              <div className="panel-section-title mb-2">Reach Mean</div>
              {composite && (
                <div className="text-[9px] text-muted-foreground mb-1.5">
                  Corridor average · {composite.segments.map(s => s.name).join(" + ")}
                </div>
              )}
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{variable.label}</div>
                  <div className="text-xl font-mono font-bold text-blue-600 leading-none">
                    {reachMean ?? "—"}
                    <span className="text-sm font-normal text-muted-foreground ml-1">{variable.unit}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {composite ? "Spatial mean · all corridor cells" : "Spatial mean · all reach cells"}
                  </div>
                </div>
                <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-blue-300 flex-shrink-0">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M4 18c2-4 6-6 8-6s6 2 8 6" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2"/>
                </svg>
              </div>
            </div>

            {/* 3c. Time-series line chart */}
            <div className="px-4 py-4">
              <div className="panel-section-title mb-2">Annual Trend</div>
              <div className="text-[9px] text-muted-foreground mb-2 font-mono">
                Reach mean · {variable.label} ({variable.unit}) · {year}
              </div>
              <ReachMeanChart
                series={allWeekMeans}
                currentWeek={week}
                unit={variable.unit}
                color={CHART_COLORS[selectedVariable] ?? "#3b6fa0"}
              />
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
