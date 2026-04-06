import { Bell } from "lucide-react";
import { DashboardState } from "@/lib/simulatedData";

interface TopNavProps {
  currentState: DashboardState;
  stateLabel: string;
}

export default function TopNav({ stateLabel }: TopNavProps) {
  return (
    <header className="nav-bar flex-shrink-0 flex items-center px-4 h-13" style={{ height: "52px" }}>
      {/* Left: logo + product name */}
      <div className="flex items-center gap-2.5">
        {/* Logo mark */}
        <div className="flex items-center gap-1.5">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-white">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="text-white font-semibold text-sm tracking-tight">GauDt</span>
        </div>
        <span className="text-white/30 text-xs">·</span>
        <span className="text-white/80 text-sm">3D Time-Series</span>
      </div>

      {/* Center breadcrumb */}
      <div className="mx-auto">
        <span className="text-white/40 text-xs font-mono">{stateLabel}</span>
      </div>

      {/* Right: time + user */}
      <div className="flex items-center gap-3">
        <span className="text-white/50 text-xs font-mono">
          Shizugawa Bay · 38.6°N 141.4°E
        </span>
        <div className="w-px h-4 bg-white/15" />
        <button className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/10 transition-colors cursor-pointer" data-testid="nav-bell">
          <Bell size={14} className="text-white/60" />
        </button>
        <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-white text-[11px] font-semibold cursor-pointer">
          ZM
        </div>
      </div>
    </header>
  );
}
