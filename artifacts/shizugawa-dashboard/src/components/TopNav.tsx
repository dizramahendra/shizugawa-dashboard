import { Bell } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";

interface TopNavProps {
  stateLabel?: string;
}

export default function TopNav({ stateLabel }: TopNavProps) {
  return (
    <>
      {/* Dark navy nav bar */}
      <header
        className="nav-bar flex-shrink-0 flex items-center px-4"
        style={{ height: "52px" }}
      >
        {/* Left: logo + product name */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-white">
                <path
                  d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <span className="text-white font-semibold text-sm tracking-tight">GauDt</span>
          </div>
          <span className="text-white/30 text-xs">·</span>
          <span className="text-white/80 text-sm">3D Time-Series</span>
        </div>

        {/* Center breadcrumb */}
        <div className="mx-auto">
          {stateLabel && (
            <span className="text-white/40 text-xs font-mono">{stateLabel}</span>
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

      {/* Tab bar */}
      <nav className="tab-bar flex items-end px-4 flex-shrink-0">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `tab-item ${isActive ? "tab-item-active" : ""}`
          }
        >
          Basin Selection
        </NavLink>
        <NavLink
          to="/playback"
          className={({ isActive }) =>
            `tab-item ${isActive ? "tab-item-active" : ""}`
          }
        >
          3D Playback
        </NavLink>
      </nav>
    </>
  );
}
