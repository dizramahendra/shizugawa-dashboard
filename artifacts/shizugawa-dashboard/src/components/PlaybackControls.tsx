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
  const { label, monthLabel } = getWeekLabel(week);
  const progress = week / (TOTAL_WEEKS - 1);

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return (
    <div className="bg-card border-t border-border/60 px-4 py-2.5 flex items-center gap-4">
      {/* Play controls */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          className="control-btn"
          onClick={onBack}
          data-testid="playback-back"
          title="Previous week"
        >
          <SkipBack size={11} />
        </button>
        <button
          className={`control-btn h-8 w-8 ${isPlaying ? "control-btn-active" : ""}`}
          onClick={isPlaying ? onPause : onPlay}
          data-testid="playback-toggle"
        >
          {isPlaying ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <button
          className="control-btn"
          onClick={onForward}
          data-testid="playback-forward"
          title="Next week"
        >
          <SkipForward size={11} />
        </button>
      </div>

      {/* Timestamp */}
      <div className="flex-shrink-0 text-center min-w-[90px]">
        <div className="text-xs font-mono font-semibold text-foreground">{label}</div>
        <div className="data-label text-[9px] text-muted-foreground">2023–2024</div>
      </div>

      {/* Timeline scrubber */}
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        {/* Month markers */}
        <div className="flex justify-between px-0">
          {months.map((m) => (
            <span key={m} className="data-label text-[8px] text-muted-foreground/60">{m}</span>
          ))}
        </div>

        {/* Slider track */}
        <div className="relative h-5 flex items-center group">
          <div className="w-full h-1.5 bg-muted rounded-full relative overflow-hidden">
            <div
              className="absolute left-0 top-0 h-full bg-primary/70 rounded-full transition-all"
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
          {/* Thumb indicator */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary border-2 border-card shadow-sm pointer-events-none transition-all"
            style={{ left: `calc(${progress * 100}% - 6px)` }}
          />
        </div>

        {/* Week ticks */}
        <div className="relative h-1">
          {Array.from({ length: 52 }).map((_, i) => (
            <div
              key={i}
              className={`absolute top-0 w-px h-1 ${i % 4 === 0 ? "bg-muted-foreground/40" : "bg-muted-foreground/15"}`}
              style={{ left: `${(i / 51) * 100}%` }}
            />
          ))}
        </div>
      </div>

      {/* Speed control */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="data-label text-[9px] text-muted-foreground mr-1">Speed</span>
        {SPEED_OPTIONS.map((s) => (
          <button
            key={s}
            className={`px-1.5 py-0.5 text-[10px] font-mono rounded-sm border transition-colors cursor-pointer
              ${speed === s
                ? "bg-primary/10 border-primary/30 text-primary"
                : "border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            onClick={() => onSpeedChange(s)}
            data-testid={`speed-${s}`}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
