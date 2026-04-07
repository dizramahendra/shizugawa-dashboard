export type DashboardState =
  | "overview"
  | "playback"
  | "paused"
  | "point-select"
  | "slice-h"
  | "slice-v"
  | "depth-graph";

export interface GridCell {
  x: number;
  z: number;
  depth: number;
  value: number; // nutrient concentration 0–1
}

export interface SelectedPoint {
  x: number;
  z: number;
  depth: number;
  label: string;
  value: number;
  unit: string;
}

export const GRID_W = 14;
export const GRID_D = 12;
export const DEPTH_LAYERS = 8;
export const TOTAL_WEEKS = 52;

const BAY_MASK: boolean[][] = [
  [false, false, true,  true,  true,  true,  false, false, false, false, false, false, false, false],
  [false, true,  true,  true,  true,  true,  true,  false, false, false, false, false, false, false],
  [false, true,  true,  true,  true,  true,  true,  true,  false, false, false, false, false, false],
  [true,  true,  true,  true,  true,  true,  true,  true,  true,  false, false, false, false, false],
  [true,  true,  true,  true,  true,  true,  true,  true,  true,  true,  true,  false, false, false],
  [false, true,  true,  true,  true,  true,  true,  true,  true,  true,  true,  true,  false, false],
  [false, false, true,  true,  true,  true,  true,  true,  true,  true,  true,  true,  true,  false],
  [false, false, false, true,  true,  true,  true,  true,  true,  true,  true,  true,  true,  false],
  [false, false, false, false, true,  true,  true,  true,  true,  true,  true,  true,  false, false],
  [false, false, false, false, false, true,  true,  true,  true,  true,  true,  false, false, false],
  [false, false, false, false, false, false, true,  true,  true,  true,  false, false, false, false],
  [false, false, false, false, false, false, false, true,  true,  false, false, false, false, false],
];

export { BAY_MASK };

function noise(x: number, z: number, t: number, scale: number): number {
  return (
    Math.sin(x * 0.7 + t * 0.8) * 0.25 +
    Math.cos(z * 0.5 + t * 0.6) * 0.2 +
    Math.sin((x + z) * 0.4 + t * 1.1) * 0.15 +
    Math.cos(x * 1.2 - z * 0.8 + t * 0.4) * 0.15 +
    scale * 0.25
  );
}

export function generateWeekData(week: number): number[][][] {
  const t = (week / TOTAL_WEEKS) * Math.PI * 2;
  const seasonalBase = Math.sin(t - Math.PI / 2) * 0.3 + 0.5;

  const data: number[][][] = [];
  for (let z = 0; z < GRID_D; z++) {
    data[z] = [];
    for (let x = 0; x < GRID_W; x++) {
      data[z][x] = [];
      for (let d = 0; d < DEPTH_LAYERS; d++) {
        const depthFactor = 1 - d / DEPTH_LAYERS;
        const landInfluence = Math.max(0, 1 - (x * 0.5 + z * 0.3) / 8);
        const v = noise(x, z, t + d * 0.3, landInfluence * 0.4) * depthFactor;
        const val = Math.min(1, Math.max(0, seasonalBase * 0.5 + v * 0.7 + landInfluence * 0.3));
        data[z][x][d] = val;
      }
    }
  }
  return data;
}

export interface WeekLabel {
  week: number;
  label: string;
  monthLabel: string;
}

export function getWeekLabel(week: number): WeekLabel {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayOfYear = week * 7;
  const monthIndex = Math.floor((dayOfYear / 365) * 12);
  const clampedMonth = Math.min(11, Math.max(0, monthIndex));
  const weekInMonth = Math.floor((dayOfYear % 30) / 7) + 1;
  return {
    week,
    label: `W${String(week + 1).padStart(2, "0")} ${months[clampedMonth]}`,
    monthLabel: months[clampedMonth],
  };
}

export const VARIABLE_OPTIONS = [
  { id: "nitrogen", label: "Total Nitrogen", unit: "mg/L", colorScale: "nitrogen" },
  { id: "phosphorus", label: "Total Phosphorus", unit: "μg/L", colorScale: "phosphorus" },
  { id: "chlorophyll", label: "Chlorophyll-a", unit: "μg/L", colorScale: "chlorophyll" },
  { id: "do", label: "Dissolved Oxygen", unit: "mg/L", colorScale: "oxygen" },
];

export function valueToConcentration(value: number, variableId: string): number {
  switch (variableId) {
    case "nitrogen": return +(value * 2.8 + 0.2).toFixed(2);
    case "phosphorus": return +(value * 120 + 10).toFixed(1);
    case "chlorophyll": return +(value * 18 + 0.5).toFixed(2);
    case "do": return +((1 - value) * 6 + 4).toFixed(2);
    default: return +value.toFixed(3);
  }
}

// ── River data (2D, no depth) ────────────────────────────────

export const RIVER_COLS = 28; // along-stream axis (x)
export const RIVER_ROWS = 6;  // cross-stream axis (z)

export const RIVERS = [
  { id: "shizugawa", name: "Shizugawa River", sub: "Minamisanriku · 25.0 km²", length: "18.4 km" },
  { id: "kitakami", name: "Kitakami Upper Tributary", sub: "Motoyoshi · 21.3 km²", length: "12.1 km" },
  { id: "hachiman", name: "Hachiman River", sub: "Minamisanriku · 24.1 km²", length: "9.7 km" },
];

/** Generate a RIVER_ROWS × RIVER_COLS 2D grid of values for a given week */
export function generateRiverData(week: number, riverId: string): number[][] {
  const t = (week / TOTAL_WEEKS) * Math.PI * 2;
  const seasonalBase = Math.sin(t - Math.PI / 2) * 0.3 + 0.5;
  const riverOffset = riverId === "kitakami" ? 1.2 : riverId === "hachiman" ? 0.6 : 0;

  const data: number[][] = [];
  for (let row = 0; row < RIVER_ROWS; row++) {
    data[row] = [];
    for (let col = 0; col < RIVER_COLS; col++) {
      // Upstream (col=0) tends to be higher; values decrease toward the bay
      const upstreamInfluence = Math.max(0, 1 - col / RIVER_COLS) * 0.5;
      const centerBoost = 1 - Math.abs(row - RIVER_ROWS / 2 + 0.5) / (RIVER_ROWS / 2) * 0.3;
      const v = (
        Math.sin(col * 0.4 + t * 0.9 + riverOffset) * 0.2 +
        Math.cos(row * 0.8 + t * 0.7) * 0.15 +
        Math.sin((col + row) * 0.3 + t * 1.2) * 0.1
      );
      const val = Math.min(1, Math.max(0,
        seasonalBase * 0.5 + v * 0.6 + upstreamInfluence * 0.3 + centerBoost * 0.1
      ));
      data[row][col] = val;
    }
  }
  return data;
}
