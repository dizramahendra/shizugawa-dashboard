import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { DAYS_PER_YEAR, dayFullLabel, monthBoundariesInRange } from "@/lib/dayUtils";

interface PlaybackControlsProps {
  /** 0-indexed day of year. */
  day: number;
  isPlaying: boolean;
  speed: number;
  year?: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (day: number) => void;
  onSpeedChange: (speed: number) => void;
  onBack: () => void;
  onForward: () => void;
  windowStart?: number;
  windowEnd?: number;
}

const SPEED_OPTIONS = [0.5, 1, 2, 4];

export default function PlaybackControls({
  day,
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
  windowEnd = DAYS_PER_YEAR - 1,
}: PlaybackControlsProps) {
  const longLabel = dayFullLabel(day, year);

  const windowLen = Math.max(1, windowEnd - windowStart);
  const progress = (day - windowStart) / windowLen;
  const progressPct = Math.max(0, Math.min(100, progress * 100));

  // One tick every 7 days (≈ weekly), with the every-fourth tick taller.
  // For a full-year window that's 53 weekly ticks — comparable density to
  // the previous 52-week scrubber but now at true daily resolution under
  // the user's mouse.
  const TICK_STRIDE = 7;
  const tickCount = Math.floor(windowLen / TICK_STRIDE) + 1;

  // Month label boundaries in the current window.
  const monthLabels = monthBoundariesInRange(windowStart, windowEnd, year);

  return (
    <div className="bg-white border-t border-border px-6 pt-3 pb-3 shadow-sm">
      {/* Top row: label · transport · speed */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 mb-2.5">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground tracking-tight truncate" data-testid="playback-day-label">
            {longLabel}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition"
            onClick={onBack}
            data-testid="playback-back"
            title="Previous day"
            aria-label="Previous day"
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
            title="Next day"
            aria-label="Next day"
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

      {/* Bottom row: scrubber rail · weekly tick marks · month labels */}
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
            step={1}
            value={day}
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

        {/* Weekly tick marks (one every 7 days, taller every 4 weeks) */}
        <div className="relative h-1.5">
          {Array.from({ length: tickCount }).map((_, i) => {
            const pct = (i * TICK_STRIDE / windowLen) * 100;
            return (
              <div
                key={i}
                className={`absolute top-0 w-px ${i % 4 === 0 ? "h-1.5 bg-border" : "h-1 bg-border/50"}`}
                style={{ left: `${Math.min(100, pct)}%` }}
              />
            );
          })}
        </div>

        {/* Month labels positioned by their first-of-month day index */}
        <div className="relative h-3 mt-1">
          {monthLabels.map(({ day: dayIdx, label }) => {
            const pct = ((dayIdx - windowStart) / windowLen) * 100;
            return (
              <span
                key={label}
                className="absolute -translate-x-1/2 text-[10px] text-muted-foreground/80"
                style={{ left: `${Math.max(0, Math.min(100, pct))}%` }}
              >
                {label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
