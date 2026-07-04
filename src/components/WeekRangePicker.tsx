import { useState, useRef, useEffect } from "react";
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";
import { weekToDate, dateToWeek, formatWeekRange } from "@/lib/weekUtils";

const DAY_HEADERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS_FULL = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function getMonthCells(y: number, m: number): Date[] {
  const firstDay = new Date(y, m, 1);
  const cells: Date[] = [];
  for (let i = firstDay.getDay() - 1; i >= 0; i--)
    cells.push(new Date(y, m, -i));
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, m, d));
  while (cells.length < 42) {
    const last = cells[cells.length - 1];
    cells.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
  }
  return cells;
}

interface Props {
  year: number;
  weekRange: [number, number];
  onChange: (range: [number, number]) => void;
}

export default function WeekRangePicker({ year, weekRange, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [dm, setDm] = useState(() => new Date(year, 0, 1));
  const [pickStart, setPickStart] = useState<number | null>(null);
  const [hoverWeek, setHoverWeek] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setDm(new Date(year, 0, 1)); setPickStart(null); }, [year]);

  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setPickStart(null);
      }
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [open]);

  const rangeStart = pickStart !== null && hoverWeek !== null ? Math.min(pickStart, hoverWeek) : weekRange[0];
  const rangeEnd   = pickStart !== null && hoverWeek !== null ? Math.max(pickStart, hoverWeek) : weekRange[1];

  const handleDayClick = (date: Date) => {
    if (date.getFullYear() !== year) return;
    const w = dateToWeek(date, year);
    if (pickStart === null) {
      setPickStart(w);
    } else {
      onChange([Math.min(pickStart, w), Math.max(pickStart, w)]);
      setPickStart(null);
      setOpen(false);
    }
  };

  const cells = getMonthCells(dm.getFullYear(), dm.getMonth());
  const isFullYear = weekRange[0] === 0 && weekRange[1] === 51;
  const label = formatWeekRange(weekRange[0], weekRange[1], year);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      {/* Trigger button */}
      <button
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] border rounded-md transition-colors whitespace-nowrap ${
          open
            ? "bg-primary/10 border-primary/40 text-primary"
            : "bg-white border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
        }`}
        onClick={() => { setOpen(o => !o); setPickStart(null); }}
      >
        <Calendar size={11} className="flex-shrink-0" />
        <span className="font-mono">{label}</span>
        {!isFullYear && (
          <span
            className="ml-0.5 hover:text-destructive"
            onClick={e => { e.stopPropagation(); onChange([0, 51]); setPickStart(null); }}
          >
            <X size={10} />
          </span>
        )}
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-50 bg-white border border-border rounded-xl shadow-xl select-none"
             style={{ width: 276 }}>
          {/* Month nav */}
          <div className="flex items-center justify-between px-3 pt-3 pb-2">
            <button
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground"
              onClick={() => setDm(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
            ><ChevronLeft size={13} /></button>
            <span className="text-xs font-semibold text-foreground">
              {MONTHS_FULL[dm.getMonth()]} {dm.getFullYear()}
            </span>
            <button
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground"
              onClick={() => setDm(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
            ><ChevronRight size={13} /></button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 px-2 mb-0.5">
            {DAY_HEADERS.map(d => (
              <div key={d} className="text-center text-[8px] font-mono text-muted-foreground/50 py-0.5">{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-y-0.5 px-2 pb-2">
            {cells.map((date, i) => {
              const inYear  = date.getFullYear() === year;
              const inMonth = date.getMonth() === dm.getMonth();
              const w       = inYear ? dateToWeek(date, year) : -1;
              const inRange = inYear && w >= rangeStart && w <= rangeEnd;
              const isBound = inYear && (w === rangeStart || w === rangeEnd);
              const isPick  = pickStart !== null && w === pickStart;

              return (
                <button
                  key={i}
                  disabled={!inYear || !inMonth}
                  className={[
                    "h-8 w-full text-[10px] font-mono rounded-sm transition-colors leading-none",
                    !inMonth || !inYear ? "opacity-20 cursor-default pointer-events-none" : "cursor-pointer",
                    inRange && inYear
                      ? isBound || isPick
                        ? "bg-primary text-white font-bold"
                        : "bg-primary/15 text-primary"
                      : inYear && inMonth
                        ? "hover:bg-muted text-foreground"
                        : "",
                  ].join(" ")}
                  onMouseEnter={() => inYear && inMonth && setHoverWeek(w)}
                  onMouseLeave={() => setHoverWeek(null)}
                  onClick={() => handleDayClick(date)}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-border">
            <span className="text-[9px] text-muted-foreground font-mono">
              {pickStart !== null
                ? "Click an end date…"
                : isFullYear
                  ? "Click to start a range"
                  : `Wk ${weekRange[0] + 1}–${weekRange[1] + 1} · ${weekToDate(weekRange[0], year).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${weekToDate(weekRange[1], year).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
              }
            </span>
            {!isFullYear && (
              <button
                className="text-[9px] font-mono text-muted-foreground hover:text-destructive"
                onClick={() => { onChange([0, 51]); setPickStart(null); }}
              >Clear</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
