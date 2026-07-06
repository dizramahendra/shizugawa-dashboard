import type { ReactNode } from "react";
import { X } from "lucide-react";

// Static identification facts for Shizugawa Bay — single ocean entity in the
// app, shared between the Map Viewport (sidebar card) and the 3D Ocean
// Playback page (right info panel).
export const OCEAN_DETAILS = {
  region:    "Shizugawa, Miyagi",
  waterBody: "Shizugawa Bay (Pacific)",
  area:      "32.8 km²",
  depth:     "0 to −54 m",
  landUse:   "Coastal / Open Water",
};

// Parse a RIVERS.sub string of the form
// "Sub-basin 6 · Minamisanriku · 7.1 km²" into its region + area pieces.
export function parseRiverSub(sub: string): { region: string; area: string } {
  const parts = sub.split(" · ");
  return { region: parts[1] ?? "—", area: parts[2] ?? "—" };
}

// Single uniform "icon + label + value" row used by every identification card
// across the app (Map Viewport sidebar, River Playback, Ocean Playback).
export function PropRow({
  icon, label, value,
}: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className="w-4 h-4 flex items-center justify-center text-muted-foreground/70 flex-shrink-0">
        {icon}
      </span>
      <span className="text-[11px] text-muted-foreground flex-1">{label}</span>
      <span className="text-[11px] font-semibold text-foreground font-mono text-right">
        {value}
      </span>
    </div>
  );
}

// Compact outlined "× Deselect" button used in the Map Viewport sidebar
// header. Not used on the playback pages, which have a back link instead.
export function DeselectButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground border border-border hover:border-foreground/40 rounded-md px-2 py-1 transition-colors flex-shrink-0"
    >
      <X size={10} />
      Deselect
    </button>
  );
}
