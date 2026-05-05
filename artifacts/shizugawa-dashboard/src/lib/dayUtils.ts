/**
 * Day-based time utilities (replaces the old weekUtils.ts).
 *
 * The dashboard now operates at daily granularity to mirror the SWAT
 * `outputRch` data set (2021-01-01 → 2023-12-31, exactly 1095 days, none
 * leap). Every consumer page indexes its current playback frame by a
 * day-of-year (0–364).
 */

export const YEARS = [2021, 2022, 2023] as const;
export type Year = (typeof YEARS)[number];

export const DEFAULT_YEAR: Year = 2023;

/** All three years in our SWAT data set are 365-day (non-leap). */
export const DAYS_PER_YEAR = 365;

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_FULL = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const WEEKDAY_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

/** Date for a 0-indexed day-of-year within `year`. */
export function dayToDate(day: number, year: number): Date {
  return new Date(year, 0, 1 + day);
}

/** 0-indexed day-of-year that contains `date` within `year`. Clamps to [0, 364]. */
export function dateToDay(date: Date, year: number): number {
  const jan1 = new Date(year, 0, 1).getTime();
  return Math.max(0, Math.min(DAYS_PER_YEAR - 1, Math.floor((date.getTime() - jan1) / 86_400_000)));
}

/** "Jun 16" — short label used in tick marks and small UI. */
export function dayLabel(day: number, year: number): string {
  const d = dayToDate(day, year);
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

/** "Mon, Jun 16, 2023" — full label used in PlaybackControls. */
export function dayFullLabel(day: number, year: number): string {
  const d = dayToDate(day, year);
  return `${WEEKDAY_SHORT[d.getDay()]}, ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}, ${year}`;
}

/** Month name (short) for a given day-of-year. */
export function monthOfDay(day: number, year: number): string {
  return MONTH_SHORT[dayToDate(day, year).getMonth()];
}

/** Full month label, e.g. "June 2023". */
export function monthFullLabel(day: number, year: number): string {
  const d = dayToDate(day, year);
  return `${MONTH_FULL[d.getMonth()]} ${year}`;
}

/** Pill / button label for a date range. */
export function formatDayRange(startDay: number, endDay: number, year: number): string {
  if (startDay === 0 && endDay === DAYS_PER_YEAR - 1) return "All year";
  const s = dayToDate(startDay, year);
  const e = dayToDate(endDay, year);
  const sm = MONTH_SHORT[s.getMonth()], em = MONTH_SHORT[e.getMonth()];
  if (startDay === endDay) return `${sm} ${s.getDate()}, ${year}`;
  return sm === em
    ? `${sm} ${s.getDate()}–${e.getDate()}, ${year}`
    : `${sm} ${s.getDate()} – ${em} ${e.getDate()}, ${year}`;
}

/** First-of-month day indices that fall inside [startDay, endDay], used to
 *  draw month tick labels under the playback scrubber. */
export function monthBoundariesInRange(startDay: number, endDay: number, year: number): Array<{ day: number; label: string }> {
  const out: Array<{ day: number; label: string }> = [];
  for (let m = 0; m < 12; m++) {
    const day = dateToDay(new Date(year, m, 1), year);
    if (day >= startDay && day <= endDay) {
      out.push({ day, label: MONTH_SHORT[m] });
    }
  }
  return out;
}
