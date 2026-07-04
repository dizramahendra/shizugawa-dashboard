import { createContext, useContext, useState, ReactNode } from "react";
import { DEFAULT_YEAR } from "@/lib/weekUtils";

interface PlaybackContextValue {
  year: number;
  setYear: (y: number) => void;
  weekRange: [number, number];
  setWeekRange: (r: [number, number]) => void;
}

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [weekRange, setWeekRange] = useState<[number, number]>([0, 51]);

  const handleSetYear = (y: number) => {
    setYear(y);
    setWeekRange([0, 51]);
  };

  return (
    <PlaybackContext.Provider value={{ year, setYear: handleSetYear, weekRange, setWeekRange }}>
      {children}
    </PlaybackContext.Provider>
  );
}

export function usePlayback() {
  const ctx = useContext(PlaybackContext);
  if (!ctx) throw new Error("usePlayback must be used within PlaybackProvider");
  return ctx;
}
