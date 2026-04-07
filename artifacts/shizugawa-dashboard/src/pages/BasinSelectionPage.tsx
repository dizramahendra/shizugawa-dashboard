import { useNavigate } from "react-router-dom";
import { Search, Map } from "lucide-react";
import { useState, useRef, useCallback } from "react";
import TopNav from "@/components/TopNav";
import BasinOverview from "@/components/BasinOverview";
import { RIVERS, WATERSHEDS } from "@/lib/simulatedData";

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
  const [search, setSearch] = useState("");
  const [selectedWatershed, setSelectedWatershed] = useState<string | null>(null);
  const [isTiltingOut, setIsTiltingOut] = useState(false);
  const navTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeWS = WATERSHEDS.find((w) => w.id === selectedWatershed) ?? null;

  const lowerSearch = search.toLowerCase();

  const filteredWatersheds = WATERSHEDS.filter((w) =>
    !search ||
    w.name.toLowerCase().includes(lowerSearch) ||
    w.description.toLowerCase().includes(lowerSearch)
  );

  const filtered = ALL_ITEMS.filter((b) =>
    !search ||
    b.name.toLowerCase().includes(lowerSearch) ||
    b.sub.toLowerCase().includes(lowerSearch)
  );

  const wnameSuffix = activeWS ? `&wname=${encodeURIComponent(activeWS.name)}` : "";

  const handleSelectOcean = () =>
    navigate(`/playback${activeWS ? `?watershed=${activeWS.id}&wname=${encodeURIComponent(activeWS.name)}` : ""}`);
  const handleSelectRiver = (riverId: string) =>
    navigate(`/river?river=${riverId}${wnameSuffix}`);

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

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-background">
      <TopNav />

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Map Viewport — animates tilt-out when loading cross-section */}
        <div
          className="flex-1 min-w-0 overflow-hidden"
          style={{
            transform: isTiltingOut
              ? "perspective(1000px) rotateX(24deg) scale(0.9)"
              : "none",
            opacity: isTiltingOut ? 0 : 1,
            transition: isTiltingOut
              ? "transform 0.68s cubic-bezier(0.4, 0, 0.8, 0.6), opacity 0.55s ease-in"
              : "none",
            transformOrigin: "center bottom",
          }}
        >
          <BasinOverview
            onSelectOcean={handleSelectOcean}
            onSelectRiver={handleSelectRiver}
            selectedWatershed={selectedWatershed}
            onSelectWatershed={setSelectedWatershed}
          />
        </div>

        {/* Right: selection panel */}
        <div className="w-72 flex-shrink-0 border-l border-border flex flex-col bg-white overflow-hidden">

          {/* Header */}
          <div className="px-4 py-3.5 border-b border-border flex-shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Map Viewport</h2>
              <span className="text-xs text-muted-foreground">{filteredWatersheds.length + filtered.length} features</span>
            </div>
          </div>

          {/* Search */}
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

            {/* ── Watersheds section ── */}
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
                      {/* Color dot / check */}
                      <div
                        className="mt-0.5 w-3 h-3 rounded-sm flex-shrink-0 border flex items-center justify-center"
                        style={{
                          background: isSelected ? ws.color : "transparent",
                          borderColor: ws.color,
                        }}
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
                        {/* Included basins chips */}
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {ws.basinIds.map((bid) => {
                            const name = bid === "ocean"
                              ? "Ocean"
                              : RIVERS.find((r) => r.id === bid)?.name.replace(" River", "").replace(" Tributary", " Trib.") ?? bid;
                            return (
                              <span
                                key={bid}
                                className="inline-block text-[8px] font-semibold px-1.5 py-0.5 rounded-full"
                                style={{
                                  background: ws.color + "20",
                                  color: ws.color,
                                  border: `1px solid ${ws.color}40`,
                                }}
                              >
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

            {/* Load Watershed button — shown only when a watershed is selected */}
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

            {/* ── Ocean Basin section ── */}
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
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary uppercase tracking-wide flex-shrink-0">
                      3D
                    </span>
                  </div>
                ))}
              </>
            )}

            {/* ── Rivers section ── */}
            {filtered.some((b) => b.type === "river") && (
              <>
                <div className="px-4 pt-4 pb-1">
                  <span className="panel-section-title">Rivers</span>
                </div>
                {filtered.filter((b) => b.type === "river").map((item) => {
                  const inWS = isBasinInWatershed(item.id);
                  return (
                    <div
                      key={item.id}
                      className="basin-list-item cursor-pointer"
                      style={inWS && activeWS ? { borderLeft: `3px solid ${activeWS.color}`, paddingLeft: "12px" } : {}}
                      onClick={() => handleSelectRiver(item.id)}
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
                        2D
                      </span>
                    </div>
                  );
                })}
              </>
            )}

            {filtered.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">No results</div>
            )}
          </div>

          {/* Footer hint */}
          <div className="px-4 py-3 border-t border-border bg-muted/20 flex-shrink-0">
            <div className="text-[10px] text-muted-foreground text-center">
              {activeWS
                ? `${activeWS.name} · ${activeWS.basinIds.length} sub-basins selected`
                : "Select a watershed box or individual water body"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
