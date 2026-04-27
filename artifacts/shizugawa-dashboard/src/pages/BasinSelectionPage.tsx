import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { Search, Map } from "lucide-react";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import TopNav from "@/components/TopNav";
import MapLibreMap from "@/components/MapLibreMap";
import WeekRangePicker from "@/components/WeekRangePicker";
import PlaybackControls from "@/components/PlaybackControls";
import { usePlayback } from "@/context/PlaybackContext";
import { YEARS } from "@/lib/weekUtils";
import {
  RIVERS,
  WATERSHEDS,
  TOTAL_WEEKS,
  VARIABLE_OPTIONS,
  getWeekLabel,
  generateRiverData,
  valueToConcentration,
  RIVER_ROWS,
  RIVER_COLS,
  COMPOSITE_RIVERS,
  getCompositeRiver,
  getCompositeSegmentMeans,
} from "@/lib/simulatedData";

const OCEAN_ENTRY = {
  id: "ocean",
  name: "Shizugawa Bay (Ocean)",
  sub: "Shizugawa · 32.8 km²",
  type: "ocean" as const,
};

// ── Shared chart constants ───────────────────────────────────────────────────
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const CHART_COLORS: Record<string, string> = {
  nitrogen: "#3b6fa0", phosphorus: "#2d8a5e", flow: "#7c3ad8",
};

// Palette used by corridor segment cards — kept in sync with the card renderer
const CORRIDOR_UPPER_COLORS = ["#1d4ed8", "#5b21b6"];
const CORRIDOR_LOWER_COLOR  = "#0f766e";

function MultiLineChart({
  series, currentWeek, unit,
}: {
  series: { name: string; color: string; data: number[] }[];
  currentWeek: number;
  unit: string;
}) {
  const W = 236, H = 90, PAD_L = 30, PAD_R = 6, PAD_T = 8, PAD_B = 20;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const n = series[0]?.data.length ?? 1;

  const allValues = series.flatMap(s => s.data);
  const minV = Math.min(...allValues);
  const maxV = Math.max(...allValues);
  const range = maxV - minV || 1;

  const toX = (i: number) => PAD_L + (i / Math.max(n - 1, 1)) * innerW;
  const toY = (v: number) => PAD_T + (1 - (v - minV) / range) * innerH;

  const monthTicks = [0, 4, 9, 13, 17, 22, 26, 30, 35, 39, 43, 48].map((w, i) => ({
    x: toX(w), label: MONTHS[i],
  }));
  const yTicks = [minV, (minV + maxV) / 2, maxV].map(v => ({ y: toY(v), label: v.toFixed(1) }));
  const cx = toX(currentWeek);

  return (
    <div>
      {/* Legend */}
      {series.length > 1 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-1.5">
          {series.map(s => (
            <div key={s.name} className="flex items-center gap-1 text-[9px] text-muted-foreground">
              <span className="w-3 h-0.5 rounded-full inline-block" style={{ background: s.color }} />
              {s.name}
            </div>
          ))}
        </div>
      )}

      <svg width={W} height={H} className="overflow-visible">
        <defs>
          {series.map((s, si) => (
            <linearGradient key={si} id={`mapGrad-${si}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.14" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0.01" />
            </linearGradient>
          ))}
        </defs>

        {/* Y grid */}
        {yTicks.map(({ y, label }) => (
          <g key={label}>
            <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#e2e8f0" strokeWidth="1" />
            <text x={PAD_L - 3} y={y + 3.5} textAnchor="end" fontSize="7" fill="#94a3b8" fontFamily="monospace">
              {label}
            </text>
          </g>
        ))}

        {/* Area + line per series */}
        {series.map((s, si) => {
          const pts     = s.data.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
          const areaPts = [
            `${toX(0)},${PAD_T + innerH}`,
            ...s.data.map((v, i) => `${toX(i)},${toY(v)}`),
            `${toX(s.data.length - 1)},${PAD_T + innerH}`,
          ].join(" ");
          return (
            <g key={s.name}>
              <polygon points={areaPts} fill={`url(#mapGrad-${si})`} />
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth="1.5"
                strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}

        {/* Current-week cursor */}
        <line x1={cx} y1={PAD_T} x2={cx} y2={PAD_T + innerH}
          stroke="#64748b" strokeWidth="1" strokeDasharray="3 2" opacity="0.5" />

        {/* Dots at cursor (+ inline label for single-series) */}
        {series.map((s, si) => {
          const val = s.data[currentWeek] ?? 0;
          const cy  = toY(val);
          return (
            <g key={`dot-${si}`}>
              <circle cx={cx} cy={cy} r="3" fill={s.color} stroke="white" strokeWidth="1.5" />
              {series.length === 1 && (
                <>
                  <rect x={cx - 22} y={cy - 17} width={44} height={12} rx="2" fill={s.color} opacity="0.9" />
                  <text x={cx} y={cy - 8} textAnchor="middle" fontSize="7"
                    fill="white" fontFamily="monospace" fontWeight="bold">
                    {val.toFixed(2)} {unit}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {/* Multi-series value row at cursor */}
        {series.length > 1 && (() => {
          const rowY = PAD_T + innerH - 2;
          return series.map((s, si) => {
            const val = s.data[currentWeek] ?? 0;
            return (
              <text key={`val-${si}`} x={cx + 5 + si * 38} y={rowY}
                fontSize="7" fill={s.color} fontFamily="monospace" fontWeight="bold">
                {val.toFixed(1)}
              </text>
            );
          });
        })()}

        {/* Month labels */}
        {monthTicks.map(({ x, label }) => (
          <text key={label} x={x} y={H - 4} textAnchor="middle" fontSize="7"
            fill="#94a3b8" fontFamily="monospace">{label}</text>
        ))}

        {/* Axis lines */}
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + innerH} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={PAD_L} y1={PAD_T + innerH} x2={W - PAD_R} y2={PAD_T + innerH} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
    </div>
  );
}

const ALL_ITEMS = [
  OCEAN_ENTRY,
  ...RIVERS.map((r) => ({ id: r.id, name: r.name, sub: r.sub, basin: r.basin, type: "river" as const })),
];

export default function BasinSelectionPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const fromCS = (location.state as { fromCS?: boolean } | null)?.fromCS ?? false;

  const [searchParams, setSearchParams] = useSearchParams();
  const _initRiver    = searchParams.get("river");
  const _initCorridor = searchParams.get("corridor");
  const _initVariable = searchParams.get("variable");

  const [search, setSearch] = useState("");
  const [selectedWatershed, setSelectedWatershed] = useState<string | null>(searchParams.get("ws"));
  const [selectedRiver, setSelectedRiver] = useState<string | null>(_initRiver);
  const [selectedCorridorId, setSelectedCorridorId] = useState<string | null>(_initCorridor);
  const [isTiltingOut, setIsTiltingOut] = useState(false);
  const [tiltedIn, setTiltedIn] = useState(!fromCS);
  const navTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shared playback window: same context the River + Ocean Playback pages use,
  // so a range selected on one page persists across the others.
  const { year, setYear, weekRange, setWeekRange } = usePlayback();
  const [startWeek, endWeek] = weekRange;
  // Initialise `week` from the shared range so a deep-link / cross-page nav
  // never paints an out-of-range frame on first render.
  const [week, setWeek] = useState(weekRange[0]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedVariable, setSelectedVariable] = useState(_initVariable ?? "nitrogen");

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pause = useCallback(() => setIsPlaying(false), []);

  // Sync state → URL so the address bar always reflects current view
  useEffect(() => {
    setSearchParams(p => {
      const next = new URLSearchParams(p);
      if (selectedVariable && selectedVariable !== "nitrogen") next.set("variable", selectedVariable);
      else next.delete("variable");
      if (selectedRiver) next.set("river", selectedRiver);
      else next.delete("river");
      if (selectedCorridorId) next.set("corridor", selectedCorridorId);
      else next.delete("corridor");
      if (selectedWatershed) next.set("ws", selectedWatershed);
      else next.delete("ws");
      return next;
    }, { replace: true });
  }, [selectedVariable, selectedRiver, selectedCorridorId, selectedWatershed]);

  useEffect(() => {
    let tiltTimer: ReturnType<typeof setTimeout> | null = null;
    if (fromCS && !tiltedIn) {
      tiltTimer = setTimeout(() => setTiltedIn(true), 60);
    }
    return () => {
      if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
      if (tiltTimer) clearTimeout(tiltTimer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setWeek((w) => {
          const next = w + 1;
          if (next > endWeek) {
            setWeek(startWeek);
            setIsPlaying(false);
            return startWeek;
          }
          return next;
        });
      }, 800 / speed);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isPlaying, speed, startWeek, endWeek]);

  useEffect(() => {
    if (week < startWeek) setWeek(startWeek);
    if (week > endWeek) setWeek(endWeek);
  }, [startWeek, endWeek, week]);

  const activeWS = WATERSHEDS.find((w) => w.id === selectedWatershed) ?? null;
  const { label: weekLabel } = getWeekLabel(week, year);
  const variable = VARIABLE_OPTIONS.find((v) => v.id === selectedVariable) ?? VARIABLE_OPTIONS[0];

  const lowerSearch = search.toLowerCase();
  const filteredWatersheds = WATERSHEDS.filter((w) =>
    !search || w.name.toLowerCase().includes(lowerSearch) || w.description.toLowerCase().includes(lowerSearch)
  );
  const filtered = ALL_ITEMS.filter((b) =>
    !search || b.name.toLowerCase().includes(lowerSearch) || b.sub.toLowerCase().includes(lowerSearch)
  );

  const selectedRiverObj = RIVERS.find((r) => r.id === selectedRiver) ?? null;

  const reachMean = useMemo(() => {
    if (!selectedRiver) return null;
    const data = generateRiverData(week, selectedRiver, year);
    let sum = 0, count = 0;
    for (let row = 0; row < RIVER_ROWS; row++) {
      for (let col = 0; col < RIVER_COLS; col++) {
        sum += data[row]?.[col] ?? 0;
        count++;
      }
    }
    return count > 0 ? valueToConcentration(sum / count, selectedVariable) : null;
  }, [selectedRiver, week, selectedVariable, year]);

  // Corridor derived state
  const corridorObj = useMemo(
    () => selectedCorridorId ? getCompositeRiver(selectedCorridorId) : null,
    [selectedCorridorId]
  );
  const corridorSegments = useMemo(
    () => corridorObj
      ? { rivers: corridorObj.segments.map(s => ({ id: s.riverId, role: s.role })), corridorId: corridorObj.id }
      : null,
    [corridorObj]
  );
  const corridorMeans = useMemo(
    () => corridorObj && selectedCorridorId
      ? getCompositeSegmentMeans(week, selectedCorridorId, selectedVariable, year)
      : null,
    [corridorObj, selectedCorridorId, week, selectedVariable, year]
  );

  // 52-week time series for single river (recomputes only when river or variable changes)
  const riverTimeSeries = useMemo(() => {
    if (!selectedRiver) return null;
    return Array.from({ length: TOTAL_WEEKS }, (_, w) => {
      const grid = generateRiverData(w, selectedRiver, year);
      let s = 0, c = 0;
      for (let r = 0; r < RIVER_ROWS; r++)
        for (let col = 0; col < RIVER_COLS; col++) { s += grid[r]?.[col] ?? 0; c++; }
      return c > 0 ? valueToConcentration(s / c, selectedVariable) : 0;
    });
  }, [selectedRiver, selectedVariable, year]);

  // Per-segment 52-week time series for corridor
  const corridorTimeSeries = useMemo(() => {
    if (!corridorObj || !selectedCorridorId) return null;
    const nSeg = corridorObj.segments.length;
    const series: number[][] = Array.from({ length: nSeg }, () => []);
    for (let w = 0; w < TOTAL_WEEKS; w++) {
      const means = getCompositeSegmentMeans(w, selectedCorridorId, selectedVariable, year);
      for (let i = 0; i < nSeg; i++) series[i].push(means[i] ?? 0);
    }
    return series;
  }, [corridorObj, selectedCorridorId, selectedVariable, year]);

  const handleSelectOcean = useCallback(() => {
    navigate(`/playback${activeWS ? `?watershed=${activeWS.id}&wname=${encodeURIComponent(activeWS.name)}` : ""}`);
  }, [navigate, activeWS]);

  const handleSelectRiver = useCallback((riverId: string | null) => {
    setSelectedRiver(riverId);
    if (riverId) setSelectedCorridorId(null); // river selection clears corridor
  }, []);

  const handleSelectCorridor = useCallback((corridorId: string | null) => {
    setSelectedCorridorId(corridorId);
    if (corridorId) setSelectedRiver(null); // corridor selection clears river
  }, []);

  const wnameSuffix = activeWS ? `&wname=${encodeURIComponent(activeWS.name)}` : "";

  const handleLoadWatershed = useCallback(() => {
    if (!activeWS) return;
    const target = `/cross-section?watershed=${activeWS.id}&wname=${encodeURIComponent(activeWS.name)}`;
    setIsTiltingOut(true);
    if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
    navTimeoutRef.current = setTimeout(() => navigate(target), 720);
  }, [activeWS, navigate]);

  function isBasinInWatershed(id: string) {
    return activeWS ? activeWS.basinIds.includes(id) : false;
  }

  const handleSeek = useCallback((w: number) => {
    const clamped = Math.max(startWeek, Math.min(endWeek, w));
    setWeek(clamped);
    pause();
  }, [startWeek, endWeek, pause]);

  const handleBack = useCallback(() => {
    setWeek((w) => Math.max(startWeek, w - 1));
    pause();
  }, [startWeek, pause]);

  const handleForward = useCallback(() => {
    setWeek((w) => Math.min(endWeek, w + 1));
    pause();
  }, [endWeek, pause]);

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-background">
      <TopNav />

      <div className="flex-1 flex overflow-hidden min-h-0">
        <div
          className="flex-1 flex flex-col min-w-0 overflow-hidden"
          style={{
            transform: (isTiltingOut || !tiltedIn)
              ? "perspective(1000px) rotateX(24deg) scale(0.9)"
              : "none",
            opacity: (isTiltingOut || !tiltedIn) ? 0 : 1,
            transition: isTiltingOut
              ? "transform 0.68s cubic-bezier(0.4, 0, 0.8, 0.6), opacity 0.55s ease-in"
              : tiltedIn && fromCS
              ? "transform 0.88s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.65s ease-out"
              : "none",
            transformOrigin: "center bottom",
          }}
        >
          {/* Toolbar */}
          <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 bg-white border-b border-border">
            <span className="text-xs text-muted-foreground font-medium">Variable</span>
            <select
              className="filter-select pr-8 appearance-none text-xs"
              value={selectedVariable}
              onChange={(e) => setSelectedVariable(e.target.value)}
              style={{
                backgroundImage: "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")",
                backgroundPosition: "right 0.4rem center",
                backgroundRepeat: "no-repeat",
                backgroundSize: "1.1rem",
              }}
            >
              {VARIABLE_OPTIONS.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>

            <div className="w-px h-5 bg-border" />

            {/* Year dropdown — same control as the playback pages */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium">Year</span>
              <select
                value={year}
                onChange={e => { setYear(Number(e.target.value)); setWeek(0); pause(); }}
                className="h-7 px-2 pr-6 text-[11px] font-mono bg-white border border-border rounded-md shadow-sm text-foreground cursor-pointer appearance-none focus:outline-none focus:ring-1 focus:ring-primary"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' viewBox='0 0 10 6'%3E%3Cpath stroke='%2364748b' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round' d='M1 1l4 4 4-4'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center" }}
              >
                {YEARS.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            {/* Calendar date-range picker — identical mechanism to the
                River + Ocean Playback pages */}
            <WeekRangePicker
              year={year}
              weekRange={weekRange}
              onChange={r => { setWeekRange(r); pause(); }}
            />

            <div className="ml-auto flex items-center gap-3 text-xs">
              <span className="font-mono text-foreground">{weekLabel} · {year}</span>
              <div className="flex items-center gap-1.5">
                {isPlaying
                  ? <><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /><span className="text-green-600">Playing</span></>
                  : <><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /><span className="text-amber-600">Paused</span></>}
              </div>
              {selectedRiver && (
                <button
                  className="text-[10px] px-2 py-0.5 rounded bg-muted/60 text-muted-foreground hover:bg-muted cursor-pointer"
                  onClick={() => setSelectedRiver(null)}
                >
                  ✕ Deselect river
                </button>
              )}
              {selectedCorridorId && (
                <button
                  className="text-[10px] px-2 py-0.5 rounded bg-violet-100 text-violet-600 hover:bg-violet-200 cursor-pointer border border-violet-200"
                  onClick={() => setSelectedCorridorId(null)}
                >
                  ✕ Deselect corridor
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden relative">
            <MapLibreMap
              week={week}
              variableId={selectedVariable}
              selectedRiver={selectedRiver}
              onSelectRiver={handleSelectRiver}
              onSelectOcean={handleSelectOcean}
              corridorSegments={corridorSegments}
            />
          </div>

          <PlaybackControls
            week={week}
            isPlaying={isPlaying}
            speed={speed}
            year={year}
            onPlay={() => setIsPlaying(true)}
            onPause={pause}
            onSeek={handleSeek}
            onSpeedChange={setSpeed}
            onBack={handleBack}
            onForward={handleForward}
            windowStart={startWeek}
            windowEnd={endWeek}
          />
        </div>

        {/* Right: selection panel */}
        <div className="w-72 flex-shrink-0 border-l border-border flex flex-col bg-white overflow-hidden">

          <div className="px-4 py-3.5 border-b border-border flex-shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Map Viewport</h2>
              <span className="text-xs text-muted-foreground">{filtered.length} features</span>
            </div>
          </div>

          <div className="px-4 py-3 border-b border-border flex-shrink-0">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                className="search-input"
                placeholder="Search watershed or basin"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">

            {corridorObj ? (
              /* ── Corridor detail panel ── */
              <div className="px-4 py-4">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-8 h-8 rounded-full bg-violet-50 flex items-center justify-center border border-violet-200 flex-shrink-0">
                    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-violet-500">
                      <path d="M3 17c2-4 5-6 7-5s4 5 7 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      <path d="M3 12c3-3 5-1 7 1s4 4 8 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">{corridorObj.name}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{corridorObj.description}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-muted/40 rounded-md p-2.5">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Total Length</div>
                    <div className="text-sm font-semibold text-foreground font-mono">{corridorObj.totalLength}</div>
                  </div>
                  <div className="bg-violet-50 border border-violet-100 rounded-md p-2.5">
                    <div className="text-[10px] text-violet-400 uppercase tracking-wide mb-0.5">Topology</div>
                    <div className="text-sm font-semibold text-violet-700 capitalize">{corridorObj.topology}</div>
                  </div>
                </div>

                {/* Per-segment values */}
                <div className="mb-2">
                  <div className="panel-section-title">Sub-basin Values</div>
                  <div className="text-[9px] text-muted-foreground mt-0.5">Per river segment · current week</div>
                </div>
                {(() => {
                  const UPPER_PALETTES = [
                    { border: "#93c5fd", bg: "#eff6ff", labelColor: "#2563eb", valColor: "#1d4ed8" },
                    { border: "#c4b5fd", bg: "#f5f3ff", labelColor: "#7c3aed", valColor: "#5b21b6" },
                  ];
                  const LOWER_PALETTE = { border: "#5eead4", bg: "#f0fdfa", labelColor: "#0d9488", valColor: "#0f766e" };
                  let upperCount = 0;
                  return corridorObj.segments.map((seg, i) => {
                    const val = corridorMeans ? corridorMeans[i] : null;
                    const palette = seg.role === "lower" ? LOWER_PALETTE : UPPER_PALETTES[upperCount++ % 2];
                    const roleLabel = seg.role === "lower"
                      ? "Lower (→ Bay)"
                      : `Upper ${corridorObj.topology === "convergent" ? upperCount : ""} · ${seg.sub}`;
                    return (
                      <div
                        key={seg.riverId}
                        className="rounded-md border p-3 mb-2 last:mb-0"
                        style={{ borderColor: palette.border, background: palette.bg }}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-[9px] font-medium uppercase tracking-wide mb-0.5"
                                 style={{ color: palette.labelColor }}>
                              {roleLabel}
                            </div>
                            <div className="text-xs font-semibold text-foreground">{seg.name}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-mono font-bold leading-none"
                                 style={{ color: palette.valColor }}>
                              {val ?? "—"}
                            </div>
                            <div className="text-[9px] text-muted-foreground">{variable.unit}</div>
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}

                {/* Δ lower vs upper(s) */}
                {corridorMeans && (() => {
                  const uppers = corridorObj.segments.filter(s => s.role === "upper");
                  const lowerIdx = corridorObj.segments.findIndex(s => s.role === "lower");
                  if (lowerIdx < 0) return null;
                  const upperAvg = uppers.reduce((sum, _, i) => sum + (corridorMeans[i] ?? 0), 0) / (uppers.length || 1);
                  const lowerVal = corridorMeans[lowerIdx] ?? 0;
                  const delta = lowerVal - upperAvg;
                  const up = delta >= 0;
                  return (
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground mb-3">
                      <span>Δ lower vs upper{uppers.length > 1 ? " avg" : ""}:</span>
                      <span className={`font-mono font-semibold ${up ? "text-teal-600" : "text-blue-600"}`}>
                        {up ? "+" : ""}{delta.toFixed(2)} {variable.unit}
                      </span>
                    </div>
                  );
                })()}

                {/* Time-series chart — one line per segment */}
                {corridorTimeSeries && (() => {
                  let upperCount = 0;
                  const seriesData = corridorObj.segments.map((seg, i) => {
                    const color = seg.role === "lower"
                      ? CORRIDOR_LOWER_COLOR
                      : CORRIDOR_UPPER_COLORS[upperCount++ % CORRIDOR_UPPER_COLORS.length];
                    const shortName = seg.role === "lower"
                      ? `${seg.name.split(" ")[0]} (lower)`
                      : seg.name.split(" ")[0];
                    return { name: shortName, color, data: corridorTimeSeries[i] ?? [] };
                  });
                  return (
                    <div className="border border-border rounded-md p-2.5 bg-white mb-3">
                      <div className="panel-section-title mb-1.5">Annual Time Series</div>
                      <div className="text-[9px] text-muted-foreground mb-2">
                        {variable.label} · {variable.unit} · per segment
                      </div>
                      <MultiLineChart
                        series={seriesData}
                        currentWeek={week}
                        unit={variable.unit}
                      />
                    </div>
                  );
                })()}

                <button
                  className="w-full py-2 rounded-md text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 transition-colors cursor-pointer mb-2"
                  onClick={() => navigate(`/river?river=${corridorObj.id}`)}
                >
                  View in 2D River →
                </button>
                <button
                  className="w-full py-1.5 rounded-md text-xs text-muted-foreground border border-border hover:bg-muted/40 cursor-pointer"
                  onClick={() => setSelectedCorridorId(null)}
                >
                  ← Back to full map
                </button>
              </div>

            ) : selectedRiverObj ? (
              /* ── Single-river detail panel ── */
              <div className="px-4 py-4">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center border border-blue-200">
                    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-blue-500">
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" stroke="currentColor" strokeWidth="1.5"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">{selectedRiverObj.name}</div>
                    <div className="text-xs text-muted-foreground">{selectedRiverObj.sub}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-muted/40 rounded-md p-2.5">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Length</div>
                    <div className="text-sm font-semibold text-foreground font-mono">{selectedRiverObj.length}</div>
                  </div>
                  <div className="bg-muted/40 rounded-md p-2.5">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Week</div>
                    <div className="text-sm font-semibold text-foreground font-mono">{weekLabel}</div>
                  </div>
                </div>

                <div className="mb-2">
                  <div className="panel-section-title">River Mean</div>
                  <div className="text-[9px] text-muted-foreground mt-0.5">Spatial mean · all reaches in river</div>
                </div>
                <div className="rounded-md border border-blue-200 bg-blue-50 p-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{variable.label}</div>
                    <div className="text-xl font-mono font-bold text-blue-600 leading-none">
                      {reachMean ?? "—"}
                      <span className="text-sm font-normal text-muted-foreground ml-1">{variable.unit}</span>
                    </div>
                  </div>
                  <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-blue-300 flex-shrink-0">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M4 18c2-4 6-6 8-6s6 2 8 6" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2"/>
                  </svg>
                </div>

                {/* Time-series chart */}
                {riverTimeSeries && (
                  <div className="mt-3 border border-border rounded-md p-2.5 bg-white">
                    <div className="panel-section-title mb-1.5">Annual Time Series</div>
                    <div className="text-[9px] text-muted-foreground mb-2">
                      {variable.label} · {variable.unit} · river mean
                    </div>
                    <MultiLineChart
                      series={[{ name: selectedRiverObj?.name ?? "", color: CHART_COLORS[selectedVariable] ?? "#3b6fa0", data: riverTimeSeries }]}
                      currentWeek={week}
                      unit={variable.unit}
                    />
                  </div>
                )}

                <button
                  className="mt-3 w-full py-1.5 rounded-md text-xs text-muted-foreground border border-border hover:bg-muted/40 cursor-pointer"
                  onClick={() => setSelectedRiver(null)}
                >
                  ← Back to full map
                </button>
              </div>
            ) : (
              <>
                {/* HIDDEN – uncomment to restore Watersheds section
                <div className="px-4 pt-3 pb-1">
                  <div className="flex items-center gap-1.5">
                    <Map size={11} className="text-muted-foreground" />
                    <span className="panel-section-title">Watersheds</span>
                  </div>
                </div>
                {filteredWatersheds.map((ws) => {
                  const isSelected = selectedWatershed === ws.id;
                  return (
                    <div
                      key={ws.id}
                      className="mx-3 mb-2 rounded-md border cursor-pointer transition-all duration-150"
                      style={{
                        borderColor: isSelected ? ws.color : "hsl(var(--border))",
                        background: isSelected ? ws.color + "10" : "transparent",
                      }}
                      onClick={() => setSelectedWatershed(isSelected ? null : ws.id)}
                      data-testid={`watershed-item-${ws.id}`}
                    >
                      <div className="px-3 py-2.5">
                        <div className="flex items-start gap-2">
                          <div
                            className="mt-0.5 w-3 h-3 rounded-sm flex-shrink-0 border flex items-center justify-center"
                            style={{ background: isSelected ? ws.color : "transparent", borderColor: ws.color }}
                          >
                            {isSelected && (
                              <svg width="8" height="8" viewBox="0 0 8 8">
                                <path d="M1.5 4l2 2 3-3" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-foreground leading-tight">{ws.name}</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">{ws.description} · {ws.area}</div>
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {ws.basinIds.map((bid) => {
                                const name = bid === "ocean"
                                  ? "Ocean"
                                  : RIVERS.find((r) => r.id === bid)?.name.replace(" River", "").replace(" Tributary", " Trib.") ?? bid;
                                return (
                                  <span key={bid} className="inline-block text-[8px] font-semibold px-1.5 py-0.5 rounded-full"
                                    style={{ background: ws.color + "20", color: ws.color, border: `1px solid ${ws.color}40` }}>
                                    {name}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                */}

                {/* HIDDEN – uncomment to restore Load Watershed button (requires Cross-Section)
                {activeWS && (
                  <div className="mx-3 mb-3">
                    <button
                      className="w-full py-2 rounded-md text-xs font-semibold text-white transition-colors cursor-pointer"
                      style={{ background: activeWS.color }}
                      onClick={handleLoadWatershed}
                      data-testid="load-watershed-btn"
                      disabled={isTiltingOut}
                    >
                      Load Watershed →
                    </button>
                    <div className="text-[10px] text-muted-foreground text-center mt-1.5">
                      Opens Terrain Cross-Section with {activeWS.name} context
                    </div>
                  </div>
                )}
                */}

                {filtered.some((b) => b.type === "ocean") && (
                  <>
                    <div className="px-4 pt-3 pb-1">
                      <span className="panel-section-title">Ocean Basin</span>
                    </div>
                    {filtered.filter((b) => b.type === "ocean").map((item) => (
                      <div
                        key={item.id}
                        className={`basin-list-item cursor-pointer ${isBasinInWatershed(item.id) ? "basin-list-item-active" : ""}`}
                        style={isBasinInWatershed(item.id) && activeWS ? { borderLeft: `3px solid ${activeWS.color}`, paddingLeft: "12px" } : {}}
                        onClick={handleSelectOcean}
                        data-testid="basin-item-ocean"
                      >
                        <div className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center flex-shrink-0 border border-sky-200">
                          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-sky-600">
                            <path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M2 7c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.45" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">{item.name}</div>
                          <div className="text-xs text-muted-foreground">{item.sub}</div>
                        </div>
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary uppercase tracking-wide flex-shrink-0">3D</span>
                      </div>
                    ))}
                  </>
                )}

                {filtered.some((b) => b.type === "river") && (
                  <>
                    <div className="px-4 pt-4 pb-1">
                      <span className="panel-section-title">Rivers</span>
                    </div>
                    {filtered.filter((b) => b.type === "river").map((item) => {
                      const inWS = isBasinInWatershed(item.id);
                      const isActive = selectedRiver === item.id;
                      return (
                        <div
                          key={item.id}
                          className="basin-list-item cursor-pointer"
                          style={{
                            ...(inWS && activeWS ? { borderLeft: `3px solid ${activeWS.color}`, paddingLeft: "12px" } : {}),
                            ...(isActive ? { background: "rgba(96,165,250,0.08)", borderLeft: "3px solid #60a5fa", paddingLeft: "12px" } : {}),
                          }}
                          onClick={() => handleSelectRiver(isActive ? null : item.id)}
                          data-testid={`river-item-${item.id}`}
                        >
                          <div className="w-8 flex items-center justify-center flex-shrink-0 text-base font-bold text-foreground tabular-nums">
                            {(item as { basin?: number }).basin ?? ""}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-foreground truncate">{item.name}</div>
                            <div className="text-xs text-muted-foreground">{item.sub}</div>
                          </div>
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 uppercase tracking-wide flex-shrink-0 border border-blue-200">
                            Map
                          </span>
                        </div>
                      );
                    })}
                  </>
                )}

                {/* Multi-basin corridors section */}
                {!search && (
                  <>
                    <div className="px-4 pt-4 pb-1 flex items-center gap-1.5">
                      <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3 text-violet-500">
                        <path d="M4 20c0-6 4-8 8-8s8-2 8-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        <path d="M4 12c0-2 2-4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        <circle cx="4" cy="20" r="1.5" fill="currentColor"/>
                        <circle cx="20" cy="4" r="1.5" fill="currentColor"/>
                        <circle cx="4" cy="12" r="1.5" fill="currentColor"/>
                      </svg>
                      <span className="panel-section-title">Multi-basin Corridors</span>
                    </div>
                    {COMPOSITE_RIVERS.map((cr) => {
                      const isActive = selectedCorridorId === cr.id;
                      return (
                        <div
                          key={cr.id}
                          className="basin-list-item cursor-pointer"
                          style={isActive
                            ? { background: "rgba(139,92,246,0.07)", borderLeft: "3px solid #8b5cf6", paddingLeft: "12px" }
                            : {}
                          }
                          onClick={() => handleSelectCorridor(isActive ? null : cr.id)}
                          data-testid={`corridor-item-${cr.id}`}
                        >
                          <div className="w-8 h-8 rounded-full bg-violet-50 flex items-center justify-center flex-shrink-0 border border-violet-200">
                            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-violet-500">
                              <path d="M5 20c0-6 4-8 8-8s7-2 7-8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                              <path d="M5 12c0-2 2-3 4-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                              <circle cx="5" cy="20" r="1.6" fill="currentColor"/>
                              <circle cx="5" cy="12" r="1.6" fill="currentColor"/>
                              <circle cx="20" cy="4" r="1.6" fill="currentColor"/>
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-foreground truncate">{cr.name}</div>
                            <div className="text-xs text-muted-foreground">{cr.totalLength} · 2 sub-basins</div>
                          </div>
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 uppercase tracking-wide flex-shrink-0 border border-violet-200">
                            2D
                          </span>
                        </div>
                      );
                    })}
                  </>
                )}

                {filtered.length === 0 && !COMPOSITE_RIVERS.length && (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">No results</div>
                )}
              </>
            )}
          </div>

          <div className="px-4 py-3 border-t border-border bg-muted/20 flex-shrink-0">
            <div className="text-[10px] text-muted-foreground text-center">
              {selectedCorridorId
                ? `Corridor view active · map zoomed to both rivers`
                : selectedRiver
                ? `River zoom active · click map to deselect`
                : activeWS
                ? `${activeWS.name} · ${activeWS.basinIds.length} sub-basins selected`
                : "Select a water body or click map to zoom"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
