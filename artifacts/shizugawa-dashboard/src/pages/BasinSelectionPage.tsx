import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { useState } from "react";
import TopNav from "@/components/TopNav";
import BasinOverview from "@/components/BasinOverview";
import { RIVERS } from "@/lib/simulatedData";

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

  const filtered = ALL_ITEMS.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase()) ||
    b.sub.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelectOcean = () => navigate("/playback");
  const handleSelectRiver = (riverId: string) => navigate(`/river?river=${riverId}`);

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-background">
      <TopNav />

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Map Viewport */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <BasinOverview
            onSelectOcean={handleSelectOcean}
            onSelectRiver={handleSelectRiver}
          />
        </div>

        {/* Right: water-body list */}
        <div className="w-72 flex-shrink-0 border-l border-border flex flex-col bg-white overflow-hidden">

          {/* Header */}
          <div className="px-4 py-3.5 border-b border-border flex-shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Water Bodies</h2>
              <span className="text-xs text-muted-foreground">{ALL_ITEMS.length} total</span>
            </div>
          </div>

          {/* Search */}
          <div className="px-4 py-3 border-b border-border flex-shrink-0">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                className="search-input"
                placeholder="Search location or name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">

            {/* Ocean section */}
            {filtered.some((b) => b.type === "ocean") && (
              <>
                <div className="px-4 pt-3 pb-1">
                  <span className="panel-section-title">Ocean Basin</span>
                </div>
                {filtered.filter((b) => b.type === "ocean").map((item) => (
                  <div
                    key={item.id}
                    className="basin-list-item basin-list-item-active cursor-pointer"
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

            {/* Rivers section */}
            {filtered.some((b) => b.type === "river") && (
              <>
                <div className="px-4 pt-4 pb-1">
                  <span className="panel-section-title">Rivers</span>
                </div>
                {filtered.filter((b) => b.type === "river").map((item, idx) => (
                  <div
                    key={item.id}
                    className="basin-list-item cursor-pointer"
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
                ))}
              </>
            )}

            {filtered.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">No results</div>
            )}
          </div>

          {/* Footer hint */}
          <div className="px-4 py-3 border-t border-border bg-muted/20 flex-shrink-0">
            <div className="text-[10px] text-muted-foreground text-center">
              Select from the list or click directly on the map
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
