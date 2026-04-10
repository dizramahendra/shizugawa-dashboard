import { useCallback } from "react";
import { TOTAL_WEEKS } from "@/lib/simulatedData";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKS_PER_MONTH = TOTAL_WEEKS / 12;

function weekToMonth(week: number): number {
  return Math.floor(week / WEEKS_PER_MONTH);
}

function monthToWeek(month: number): number {
  return Math.round(month * WEEKS_PER_MONTH);
}

interface TimeWindowControlProps {
  startWeek: number;
  endWeek: number;
  onStartChange: (week: number) => void;
  onEndChange: (week: number) => void;
}

export default function TimeWindowControl({
  startWeek,
  endWeek,
  onStartChange,
  onEndChange,
}: TimeWindowControlProps) {
  const startMonth = weekToMonth(startWeek);
  const endMonth = Math.min(11, weekToMonth(endWeek));

  const handleStartMonth = useCallback((m: number) => {
    const w = monthToWeek(m);
    onStartChange(Math.min(w, endWeek - 1));
  }, [endWeek, onStartChange]);

  const handleEndMonth = useCallback((m: number) => {
    const w = Math.min(monthToWeek(m + 1) - 1, TOTAL_WEEKS - 1);
    onEndChange(Math.max(w, startWeek + 1));
  }, [startWeek, onEndChange]);

  const windowWidth = ((endWeek - startWeek) / (TOTAL_WEEKS - 1)) * 100;
  const windowOffset = (startWeek / (TOTAL_WEEKS - 1)) * 100;

  return (
    <div className="bg-white border-t border-border px-4 py-2.5 flex items-center gap-4">
      <div className="flex-shrink-0 w-24">
        <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">Time Window</div>
        <div className="text-[10px] font-mono text-foreground mt-0.5">
          {MONTHS[startMonth]} – {MONTHS[endMonth]}
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground w-6">From</span>
          <div className="flex gap-1">
            {MONTHS.map((m, i) => (
              <button
                key={m}
                className="text-[8px] px-1 py-0.5 rounded transition-colors cursor-pointer"
                style={{
                  background: i === startMonth ? "hsl(var(--primary))" : i < startMonth ? "#e2e8f0" : "transparent",
                  color: i === startMonth ? "white" : i >= startMonth ? "hsl(var(--foreground))" : "#94a3b8",
                  fontWeight: i === startMonth ? 600 : 400,
                }}
                onClick={() => handleStartMonth(i)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground w-6">To</span>
          <div className="flex gap-1">
            {MONTHS.map((m, i) => (
              <button
                key={m}
                className="text-[8px] px-1 py-0.5 rounded transition-colors cursor-pointer"
                style={{
                  background: i === endMonth ? "hsl(var(--primary))" : i > endMonth ? "#e2e8f0" : "transparent",
                  color: i === endMonth ? "white" : i <= endMonth ? "hsl(var(--foreground))" : "#94a3b8",
                  fontWeight: i === endMonth ? 600 : 400,
                }}
                onClick={() => handleEndMonth(i)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="absolute h-full bg-primary/60 rounded-full"
            style={{ left: `${windowOffset}%`, width: `${windowWidth}%` }}
          />
        </div>
      </div>

      <div className="flex-shrink-0 text-[9px] text-muted-foreground">
        <span className="font-mono">{endWeek - startWeek}</span>
        <span className="ml-0.5">wks</span>
      </div>
    </div>
  );
}
