export const YEARS = [2021, 2022, 2023, 2024, 2025] as const;
export const DEFAULT_YEAR = 2023;
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** Date at the start of week `week` (0-indexed) within `year`. */
export function weekToDate(week: number, year: number): Date {
  return new Date(new Date(year, 0, 1).getTime() + week * 7 * 86_400_000);
}

/** Week index (0–51) that contains `date` within `year`. Days before Jan 1 → 0; after Dec 31 → 51. */
export function dateToWeek(date: Date, year: number): number {
  const jan1 = new Date(year, 0, 1).getTime();
  return Math.max(0, Math.min(51, Math.floor((date.getTime() - jan1) / (7 * 86_400_000))));
}

/** Human-readable label for a week index and year. E.g. "W03 Jan". */
export function weekLabel(week: number, year: number): string {
  const d = weekToDate(week, year);
  return `W${String(week + 1).padStart(2, "0")} ${MONTH_SHORT[d.getMonth()]}`;
}

/** Button / pill label for the current range. */
export function formatWeekRange(startWeek: number, endWeek: number, year: number): string {
  if (startWeek === 0 && endWeek === 51) return "All year";
  const s = weekToDate(startWeek, year);
  const e = weekToDate(endWeek, year);
  const sm = MONTH_SHORT[s.getMonth()], em = MONTH_SHORT[e.getMonth()];
  if (startWeek === endWeek) return `${sm} ${s.getDate()}, ${year}`;
  return sm === em
    ? `${sm} ${s.getDate()}–${e.getDate()}, ${year}`
    : `${sm} ${s.getDate()} – ${em} ${e.getDate()}, ${year}`;
}
