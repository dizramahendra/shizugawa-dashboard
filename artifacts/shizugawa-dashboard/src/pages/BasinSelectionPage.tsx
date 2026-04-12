import { useNavigate, useLocation } from "react-router-dom";
import { Search, Map } from "lucide-react";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import TopNav from "@/components/TopNav";
import MapLibreMap from "@/components/MapLibreMap";
import TimeWindowControl from "@/components/TimeWindowControl";
import PlaybackControls from "@/components/PlaybackControls";
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
} from "@/lib/simulatedData";

const OCEAN_ENTRY = {
  id: "ocean",
  name: "Shizugawa Bay (Ocean)",
  sub: "Shizugawa · 32.8 km²",
  type: "ocean" as const,
};

const ALL_ITEMS = [
  OCEAN_ENTRY,
  ...RIVERS.map((r) => ({ id: r.id, name: r.name, sub: r.sub, type: "river" as const })),
];

export default function BasinSelectionPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const fromCS = (location.state as { fromCS?: boolean } | null)?.fromCS ?? false;

  const [search, setSearch] = useState("");
  const [selectedWatershed, setSelectedWatershed] = useState<string | null>(null);
  const [selectedRiver, setSelectedRiver] = useState<string | null>(null);
  const [isTiltingOut, setIsTiltingOut] = useState(false);
  const [tiltedIn, setTiltedIn] = useState(!fromCS);
  const navTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [week, setWeek] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedVariable, setSelectedVariable] = useState("nitrogen");
  const [startWeek, setStartWeek] = useState(0);
  const [endWeek, setEndWeek] = useState(TOTAL_WEEKS - 1);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pause = useCallback(() => setIsPlaying(false), []);

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
  const { label: weekLabel } = getWeekLabel(week);
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
    const data = generateRiverData(week, selectedRiver);
    let sum = 0, count = 0;
    for (let row = 0; row < RIVER_ROWS; row++) {
      for (let col = 0; col < RIVER_COLS; col++) {
        sum += data[row]?.[col] ?? 0;
        count++;
      }
    }
    return count > 0 ? valueToConcentration(sum / count, selectedVariable) : null;
  }, [selectedRiver, week, selectedVariable]);

  const handleSelectOcean = useCallback(() => {
    navigate(`/playback${activeWS ? `?watershed=${activeWS.id}&wname=${encodeURIComponent(activeWS.name)}` : ""}`);
  }, [navigate, activeWS]);

  const handleSelectRiver = useCallback((riverId: string | null) => {
    setSelectedRiver(riverId);
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

            <div className="ml-auto flex items-center gap-3 text-xs">
              <span className="font-mono text-foreground">{weekLabel} · 2023–2024</span>
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
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden relative">
            <MapLibreMap
              week={week}
              variableId={selectedVariable}
              selectedRiver={selectedRiver}
              onSelectRiver={handleSelectRiver}
              onSelectOcean={handleSelectOcean}
            />
          </div>

          <TimeWindowControl
            startWeek={startWeek}
            endWeek={endWeek}
            onStartChange={(w) => { setStartWeek(w); if (week < w) setWeek(w); }}
            onEndChange={(w) => { setEndWeek(w); if (week > w) setWeek(w); }}
          />

          <PlaybackControls
            week={week}
            isPlaying={isPlaying}
            speed={speed}
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

            {selectedRiverObj ? (
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

                <div className="rounded-md border border-blue-200 bg-blue-50 p-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Reach Mean</div>
                    <div className="text-[10px] text-muted-foreground">{variable.label}</div>
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
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 border border-primary/20">
                          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-primary">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
                          <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0 border border-blue-200">
                            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-blue-500">
                              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" stroke="currentColor" strokeWidth="1.5" />
                              <path d="M4 15s2-2 5-2 5 2 5 2" stroke="currentColor" strokeWidth="1" opacity="0.5" />
                            </svg>
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

                {filtered.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">No results</div>
                )}
              </>
            )}
          </div>

          <div className="px-4 py-3 border-t border-border bg-muted/20 flex-shrink-0">
            <div className="text-[10px] text-muted-foreground text-center">
              {selectedRiver
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
