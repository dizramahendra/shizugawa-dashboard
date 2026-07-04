import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { TOTAL_WEEKS } from "@/lib/simulatedData";
import { weekToDate } from "@/lib/weekUtils";

interface PlaybackControlsProps {
  week: number;
  isPlaying: boolean;
  speed: number;
  year?: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (week: number) => void;
  onSpeedChange: (speed: number) => void;
  onBack: () => void;
  onForward: () => void;
  windowStart?: number;
  windowEnd?: number;
}

const SPEED_OPTIONS = [0.5, 1, 2, 4];
const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function PlaybackControls({
  week,
  isPlaying,
  speed,
  year = 2023,
  onPlay,
  onPause,
  onSeek,
  onSpeedChange,
  onBack,
  onForward,
  windowStart = 0,
  windowEnd = TOTAL_WEEKS - 1,
}: PlaybackControlsProps) {
  const date = weekToDate(week, year);
  const weekNum = String(week + 1).padStart(2, "0");
  const longLabel = `Week ${weekNum}, ${MONTHS_FULL[date.getMonth()]} ${year}`;

  const windowLen = Math.max(1, windowEnd - windowStart);
  const progress = (week - windowStart) / windowLen;
  const progressPct = Math.max(0, Math.min(100, progress * 100));

  const weeksPerMonth = TOTAL_WEEKS / 12;
  const startMonth = Math.floor(windowStart / weeksPerMonth);
  const endMonth = Math.min(11, Math.floor(windowEnd / weeksPerMonth));
  const windowMonths = MONTHS_SHORT.slice(startMonth, endMonth + 1);

  return (
    <div className="bg-white border-t border-border px-6 pt-3 pb-3 shadow-sm">
      {/* Top row: label · transport · speed */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 mb-2.5">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground tracking-tight truncate" data-testid="playback-week-label">
            {longLabel}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition"
            onClick={onBack}
            data-testid="playback-back"
            title="Previous week"
            aria-label="Previous week"
          >
            <SkipBack size={14} />
          </button>
          <button
            className="w-10 h-10 rounded-full bg-primary hover:bg-primary/90 flex items-center justify-center text-white shadow-sm transition"
            onClick={isPlaying ? onPause : onPlay}
            data-testid="playback-toggle"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" fill="currentColor" />}
          </button>
          <button
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition"
            onClick={onForward}
            data-testid="playback-forward"
            title="Next week"
            aria-label="Next week"
          >
            <SkipForward size={14} />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">Speed</span>
          <div className="flex gap-1">
            {SPEED_OPTIONS.map((s) => (
              <button
                key={s}
                className={`speed-btn ${speed === s ? "speed-btn-active" : ""}`}
                onClick={() => onSpeedChange(s)}
                data-testid={`speed-${s}`}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom row: scrubber rail · tick marks · month labels */}
      <div>
        <div className="relative h-6 flex items-center">
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-150"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <input
            type="range"
            min={windowStart}
            max={windowEnd}
            value={week}
            onChange={(e) => onSeek(Number(e.target.value))}
            className="absolute inset-0 opacity-0 cursor-pointer w-full"
            data-testid="playback-scrubber"
            aria-label="Playback position"
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-primary border-2 border-white shadow pointer-events-none"
            style={{ left: `calc(${progressPct}% - 8px)` }}
          />
        </div>

        {/* Tick marks (one per week, taller every 4 weeks) */}
        <div className="relative h-1.5">
          {Array.from({ length: windowEnd - windowStart + 1 }).map((_, i) => {
            const pct = windowLen > 0 ? (i / windowLen) * 100 : 0;
            return (
              <div
                key={i}
                className={`absolute top-0 w-px ${i % 4 === 0 ? "h-1.5 bg-border" : "h-1 bg-border/50"}`}
                style={{ left: `${pct}%` }}
              />
            );
          })}
        </div>

        {/* Month labels under the rail */}
        <div className="flex justify-between px-0.5 mt-1">
          {windowMonths.map((m) => (
            <span key={m} className="text-[10px] text-muted-foreground/80">{m}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
