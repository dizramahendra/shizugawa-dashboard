import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { useState } from "react";
import TopNav from "@/components/TopNav";
import BasinOverview from "@/components/BasinOverview";

const BASIN_LIST = [
  { id: 1, name: "Shizugawa Bay (Ocean)", sub: "Shizugawa · 32.8 km²", icon: true },
  { id: 2, name: "Estuary Basin", sub: "Minamisanriku · 12.8 km²" },
  { id: 3, name: "Kitakami Tributary", sub: "Motoyoshi · 21.3 km²" },
  { id: 4, name: "Tokura Mountain", sub: "Minamisanriku · 17.2 km²" },
  { id: 5, name: "Hachiman River", sub: "Minamisanriku · 24.1 km²" },
  { id: 6, name: "Shizugawa River", sub: "Minamisanriku · 25.0 km²" },
  { id: 7, name: "Oritate River", sub: "Minamisanriku · 14.2 km²" },
  { id: 8, name: "Utatsu Highland", sub: "Motoyoshi · 24.1 km²" },
];

export default function BasinSelectionPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const filtered = BASIN_LIST.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelectBasin = () => navigate("/playback");

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-background">
      <TopNav />

      <div className="flex-1 flex overflow-hidden">
        {/* Left: map */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <BasinOverview onSelectBasin={handleSelectBasin} />
        </div>

        {/* Right: basin list panel */}
        <div className="w-72 flex-shrink-0 border-l border-border flex flex-col bg-white overflow-hidden">
          {/* Panel header */}
          <div className="px-4 py-3.5 border-b border-border flex-shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Sub-basin</h2>
              <span className="text-xs text-muted-foreground">{BASIN_LIST.length} total</span>
            </div>
          </div>

          {/* Search */}
          <div className="px-4 py-3 border-b border-border flex-shrink-0">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                className="search-input"
                placeholder="Search location or basin name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Basin list */}
          <div className="flex-1 overflow-y-auto">
            {filtered.map((basin) => (
              <div
                key={basin.id}
                className={`basin-list-item ${basin.id === 1 ? "basin-list-item-active" : ""}`}
                onClick={basin.id === 1 ? handleSelectBasin : undefined}
                data-testid={`basin-item-${basin.id}`}
              >
                {basin.icon ? (
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 border border-primary/20">
                    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-primary">
                      <path
                        d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
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
      </div>
    </div>
  );
}
