import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { getWeekLabel, TOTAL_WEEKS } from "@/lib/simulatedData";

interface PlaybackControlsProps {
  week: number;
  isPlaying: boolean;
  speed: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (week: number) => void;
  onSpeedChange: (speed: number) => void;
  onBack: () => void;
  onForward: () => void;
}

const SPEED_OPTIONS = [0.5, 1, 2, 4];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function PlaybackControls({
  week,
  isPlaying,
  speed,
  onPlay,
  onPause,
  onSeek,
  onSpeedChange,
  onBack,
  onForward,
}: PlaybackControlsProps) {
  const { label } = getWeekLabel(week);
  const progress = week / (TOTAL_WEEKS - 1);

  return (
    <div className="bg-white border-t border-border px-4 py-3 flex items-center gap-4 shadow-sm">
      {/* Play controls */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button className="ctrl-btn" onClick={onBack} data-testid="playback-back" title="Previous week">
          <SkipBack size={12} />
        </button>
        <button
          className={`ctrl-btn w-9 h-9 ${isPlaying ? "ctrl-btn-primary" : ""}`}
          onClick={isPlaying ? onPause : onPlay}
          data-testid="playback-toggle"
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
        </button>
        <button className="ctrl-btn" onClick={onForward} data-testid="playback-forward" title="Next week">
          <SkipForward size={12} />
        </button>
      </div>

      {/* Timestamp */}
      <div className="flex-shrink-0 w-24">
        <div className="text-xs font-mono font-semibold text-foreground">{label}</div>
        <div className="text-[10px] text-muted-foreground">2023–2024</div>
      </div>

      {/* Timeline */}
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        {/* Month labels */}
        <div className="flex justify-between px-0.5">
          {MONTHS.map((m) => (
            <span key={m} className="text-[8px] font-mono text-muted-foreground/60">{m}</span>
          ))}
        </div>

        {/* Track */}
        <div className="relative h-6 flex items-center">
          <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary/70 rounded-full transition-all duration-150"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={TOTAL_WEEKS - 1}
            value={week}
            onChange={(e) => onSeek(Number(e.target.value))}
            className="absolute inset-0 opacity-0 cursor-pointer w-full"
            data-testid="playback-scrubber"
          />
          {/* Thumb */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-primary border-2 border-white shadow pointer-events-none"
            style={{ left: `calc(${progress * 100}% - 7px)` }}
          />
        </div>

        {/* Week ticks */}
        <div className="relative h-1">
          {Array.from({ length: 52 }).map((_, i) => (
            <div
              key={i}
              className={`absolute top-0 w-px ${i % 4 === 0 ? "h-1 bg-border" : "h-0.5 bg-border/50"}`}
              style={{ left: `${(i / 51) * 100}%` }}
            />
          ))}
        </div>
      </div>

      {/* Speed */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className="text-[10px] text-muted-foreground">Speed</span>
        <div className="flex gap-0.5">
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
  );
}
