import type { MouseEvent } from "react";
import { Bell } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

interface TopNavProps {
  stateLabel?: string;
  watershedName?: string;
  onMapNavRequest?: () => void;
}

export default function TopNav({ stateLabel, watershedName, onMapNavRequest }: TopNavProps) {
  const location = useLocation();
  const isOcean  = location.pathname.startsWith("/playback");
  const isCS     = location.pathname.startsWith("/cross-section");
  const isRiver  = location.pathname.startsWith("/river");
  const isCarbon = location.pathname.startsWith("/carbon");
  const isSubBasin = location.pathname.startsWith("/sub-basin");
  const isMap    = !isOcean && !isCS && !isRiver && !isCarbon && !isSubBasin;

  /*
   * Cross-section tab href:
   * - When already on /cross-section: preserve current search (watershed params intact).
   * - When on another route: carry forward wname + watershed/river context from
   *   the current page's own URL params so the header shows the right label.
   */
  const buildCSHref = (): string => {
    if (isCS) return `/cross-section${location.search}`;
    const sp = new URLSearchParams(location.search);
    const wname = sp.get("wname");
    const watershed = sp.get("watershed") || sp.get("river");
    if (!wname) return "/cross-section";
    const out = new URLSearchParams();
    if (watershed) out.set("watershed", watershed);
    out.set("wname", wname);
    return `/cross-section?${out.toString()}`;
  };

  const handleMapTabClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (onMapNavRequest) {
      e.preventDefault();
      onMapNavRequest();
    }
  };

  return (
    <>
      {/* Dark navy nav bar */}
      <header className="nav-bar flex-shrink-0 flex items-center px-4" style={{ height: "52px" }}>
        {/* Logo + product name */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-white">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="text-white font-semibold text-sm tracking-tight">GauDt</span>
          </div>
          <span className="text-white/30 text-xs">·</span>
          <span className="text-white/80 text-sm">3D Time-Series</span>
        </div>

        {/* Center: watershed context + state label */}
        <div className="mx-auto flex items-center gap-2">
          {watershedName && (
            <>
              <span className="text-[10px] font-semibold text-white/60 uppercase tracking-widest">Watershed</span>
              <span className="text-white/30 text-xs">·</span>
              <span className="text-xs font-medium text-white/80">{watershedName}</span>
            </>
          )}
          {stateLabel && !watershedName && (
            <span className="text-white/40 text-xs font-mono">{stateLabel}</span>
          )}
          {stateLabel && watershedName && (
            <>
              <span className="text-white/30 text-xs">·</span>
              <span className="text-white/40 text-xs font-mono">{stateLabel}</span>
            </>
          )}
        </div>

        {/* Right: coordinates + icons */}
        <div className="flex items-center gap-3">
          <span className="text-white/50 text-xs font-mono hidden sm:block">
            Shizugawa Bay · 38.6°N 141.4°E
          </span>
          <div className="w-px h-4 bg-white/15" />
          <button className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/10 transition-colors cursor-pointer">
            <Bell size={14} className="text-white/60" />
          </button>
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-white text-[11px] font-semibold cursor-pointer">
            ZM
          </div>
        </div>
      </header>

      {/* Tab bar — four views */}
      <nav className="tab-bar flex items-end px-4 flex-shrink-0">
        <NavLink
          to="/"
          end
          className={`tab-item ${isMap ? "tab-item-active" : ""}`}
          onClick={handleMapTabClick}
        >
          Map Viewport
        </NavLink>
        <NavLink
          to="/sub-basin"
          className={`tab-item ${isSubBasin ? "tab-item-active" : ""}`}
        >
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-sm bg-amber-400 inline-block" />
            Sub-basin
          </span>
        </NavLink>
        {/* HIDDEN – uncomment to restore Cross-Section tab
        <NavLink
          to={buildCSHref()}
          className={`tab-item ${isCS ? "tab-item-active" : ""}`}
        >
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-sm bg-emerald-400 inline-block" />
            Cross-Section
          </span>
        </NavLink>
        */}
        <NavLink
          to="/river"
          className={`tab-item ${isRiver ? "tab-item-active" : ""}`}
        >
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
            River Playback (2D)
          </span>
        </NavLink>
        <NavLink
          to="/playback"
          className={`tab-item ${isOcean ? "tab-item-active" : ""}`}
        >
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-primary/60 inline-block" />
            Ocean Playback (3D)
          </span>
        </NavLink>
        <NavLink
          to="/carbon"
          className={`tab-item ${isCarbon ? "tab-item-active" : ""}`}
        >
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
            Carbon Sequestration
          </span>
        </NavLink>
      </nav>
    </>
  );
}
