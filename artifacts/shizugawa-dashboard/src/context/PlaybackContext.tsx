import { createContext, useContext, useState, ReactNode } from "react";
import { DEFAULT_YEAR, DAYS_PER_YEAR } from "@/lib/dayUtils";

interface PlaybackContextValue {
  year: number;
  setYear: (y: number) => void;
  /** Inclusive day-of-year window [start, end] used by the scrubber. */
  dayRange: [number, number];
  setDayRange: (r: [number, number]) => void;
}

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

const FULL_YEAR_RANGE: [number, number] = [0, DAYS_PER_YEAR - 1];

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [dayRange, setDayRange] = useState<[number, number]>(FULL_YEAR_RANGE);

  const handleSetYear = (y: number) => {
    setYear(y);
    // Reset to the full year span any time the user switches calendar year.
    setDayRange(FULL_YEAR_RANGE);
  };

  return (
    <PlaybackContext.Provider value={{ year, setYear: handleSetYear, dayRange, setDayRange }}>
      {children}
    </PlaybackContext.Provider>
  );
}

export function usePlayback() {
  const ctx = useContext(PlaybackContext);
  if (!ctx) throw new Error("usePlayback must be used within PlaybackProvider");
  return ctx;
}
