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

export const GRID_W = 28;
export const GRID_D = 24;
export const DEPTH_LAYERS = 8;
export const TOTAL_WEEKS = 52;

// Rasterized from the actual OCEAN_BASIN_PATH SVG polygon (main connected component)
// gz 0 = south shore, gz 23 = north; gx 0 = west (inner bay head), gx 27 = east (bay mouth)
const T = true, F = false;
const BAY_MASK: boolean[][] = [
  [F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,T,F,F,F,F,F,F,F,F,F,F,F,F], // gz  0
  [F,F,F,F,F,T,T,F,F,F,F,F,F,F,F,T,F,F,F,F,F,F,F,F,F,F,F,F], // gz  1
  [F,F,F,F,F,T,T,T,F,F,F,F,F,T,F,T,T,F,F,F,F,T,T,T,F,T,F,F], // gz  2
  [F,F,F,F,F,T,T,T,F,F,F,F,T,T,T,T,T,F,T,T,T,T,T,T,T,T,F,F], // gz  3
  [F,F,F,F,T,T,T,T,T,F,F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F,F], // gz  4
  [F,F,F,F,T,T,T,T,T,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F], // gz  5
  [F,F,T,T,T,T,T,T,T,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F], // gz  6
  [F,F,T,T,T,T,T,T,T,T,T,T,T,F,T,T,T,T,T,T,T,T,T,T,T,T,T,F], // gz  7
  [F,F,T,T,T,T,T,T,T,T,T,T,T,T,F,T,T,T,T,T,T,T,T,T,T,T,T,F], // gz  8
  [F,F,T,T,T,T,T,T,T,T,T,T,T,F,T,T,T,T,T,T,T,T,T,T,T,T,F,F], // gz  9
  [F,F,T,T,T,T,T,T,T,T,T,T,T,T,F,T,T,T,T,T,T,T,T,T,T,T,F,F], // gz 10
  [F,F,T,T,T,T,T,T,T,T,T,T,T,T,F,T,T,T,T,T,T,T,T,T,T,T,T,F], // gz 11
  [F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,F,T,T,T,T,T,T,T,T,T,T,T,T], // gz 12
  [F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F,T,T,T,T,T,T,T,T,T,T,T], // gz 13
  [F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F,T,T,T,T,T,T,T,T,T,F], // gz 14
  [F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F,T,T,T,T,T,T,T,T,T], // gz 15
  [F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F,T,T,T,T,T,T,T,T,F], // gz 16
  [T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F,T,T,T,T,T,T,T,F], // gz 17
  [T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F,T,T,T,T,T,T,F], // gz 18
  [T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F,T,T,T,T,T,F], // gz 19
  [T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F,T,T,T,T,T,T], // gz 20
  [F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F,T,T,T,T,F], // gz 21
  [F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F,F], // gz 22
  [F,F,T,T,T,F,F,F,T,T,T,F,F,T,F,T,T,T,F,F,F,F,F,F,F,T,F,F], // gz 23
];

export { BAY_MASK };

// ── River voxel cells (gz >= 24, north of bay) ──────────────────────────────
// Each cell maps to one voxel in the 3D scene rendered as a single shallow layer.
// Rivers widen near gz=24 (delta mouth) and narrow upstream (higher gz).
// mouthGx = center gx used to sample bay-mouth data for the colour value.

export interface RiverCell {
  gx: number;
  gz: number;      // row index ≥ 24 (north of BAY_MASK boundary)
  mouthGx: number; // bay-mouth column for value / colour sampling
}

export const RIVER_CELLS: RiverCell[] = [
  // ── West River (Shizugawa) — mouth at gz=23, gx=[2,3,4] ─────────────────
  { gx:2, gz:24, mouthGx:3 }, { gx:3, gz:24, mouthGx:3 }, { gx:4, gz:24, mouthGx:3 }, // delta fan
  { gx:3, gz:25, mouthGx:3 }, { gx:4, gz:25, mouthGx:3 },
  { gx:3, gz:26, mouthGx:3 },
  { gx:3, gz:27, mouthGx:3 },
  { gx:2, gz:28, mouthGx:3 }, { gx:3, gz:28, mouthGx:3 }, // meander west
  { gx:2, gz:29, mouthGx:3 },
  { gx:2, gz:30, mouthGx:3 },

  // ── Center River (Hachiman) — mouth at gz=23, gx=[8,9,10] ───────────────
  { gx:8, gz:24, mouthGx:9 }, { gx:9, gz:24, mouthGx:9 }, { gx:10, gz:24, mouthGx:9 }, // delta fan
  { gx:9, gz:25, mouthGx:9 }, { gx:10, gz:25, mouthGx:9 },
  { gx:10, gz:26, mouthGx:9 },
  { gx:10, gz:27, mouthGx:9 },
  { gx:10, gz:28, mouthGx:9 }, { gx:11, gz:28, mouthGx:9 }, // meander east
  { gx:11, gz:29, mouthGx:9 },
  { gx:11, gz:30, mouthGx:9 },

  // ── East River (Kitakami) — mouth at gz=23, gx=[15,16,17] ───────────────
  { gx:15, gz:24, mouthGx:16 }, { gx:16, gz:24, mouthGx:16 }, { gx:17, gz:24, mouthGx:16 }, // delta fan
  { gx:16, gz:25, mouthGx:16 }, { gx:17, gz:25, mouthGx:16 },
  { gx:16, gz:26, mouthGx:16 },
  { gx:16, gz:27, mouthGx:16 },
  { gx:16, gz:28, mouthGx:16 }, { gx:17, gz:28, mouthGx:16 }, // meander east
  { gx:17, gz:29, mouthGx:16 },
  { gx:17, gz:30, mouthGx:16 },
];

function noise(x: number, z: number, t: number, scale: number): number {
  return (
    Math.sin(x * 0.7 + t * 0.8) * 0.25 +
    Math.cos(z * 0.5 + t * 0.6) * 0.2 +
    Math.sin((x + z) * 0.4 + t * 1.1) * 0.15 +
    Math.cos(x * 1.2 - z * 0.8 + t * 0.4) * 0.15 +
    scale * 0.25
  );
}

export function generateWeekData(week: number, year: number = 2023): number[][][] {
  const yearShift = (year - 2023) * 0.29;
  const t = (week / TOTAL_WEEKS) * Math.PI * 2 + yearShift;
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

export function getWeekLabel(week: number, year: number = 2023): WeekLabel {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const date = new Date(new Date(year, 0, 1).getTime() + week * 7 * 86_400_000);
  const m = months[date.getMonth()];
  return {
    week,
    label: `W${String(week + 1).padStart(2, "0")} ${m}`,
    monthLabel: m,
  };
}

export const VARIABLE_OPTIONS = [
  { id: "nitrogen",   label: "Total Nitrogen",   unit: "mg/L", colorScale: "nitrogen",   min: 0.2, max: 3.0  },
  { id: "phosphorus", label: "Total Phosphorus", unit: "μg/L", colorScale: "phosphorus", min: 10,  max: 130  },
  { id: "flow",       label: "Water Flow",       unit: "cm/s", colorScale: "flow",       min: 0,   max: 80   },
];

/**
 * Compute bay-ocean exchange intensity (0–1) for a given week.
 * Based on the average value of the rightmost active cells in each row.
 */
export function getBayOceanExchangeIntensity(week: number, year: number = 2023): number {
  const data = generateWeekData(week, year);
  // Rightmost active column per row in the BAY_MASK
  const edgeCols: number[] = [];
  for (let z = 0; z < GRID_D; z++) {
    for (let x = GRID_W - 1; x >= 0; x--) {
      if (BAY_MASK[z]?.[x]) { edgeCols.push(x); break; }
    }
  }
  let sum = 0, count = 0;
  for (let z = 0; z < GRID_D; z++) {
    const x = edgeCols[z];
    if (x === undefined) continue;
    for (let d = 0; d < 3; d++) {          // top 3 depth layers for exchange
      sum += data[z]?.[x]?.[d] ?? 0;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Compute sediment elution intensity (0–1) for a given week.
 * Based on the average bottom-two-layer values across all active cells.
 */
export function getSedimentElutionIntensity(week: number, year: number = 2023): number {
  const data = generateWeekData(week, year);
  let sum = 0, count = 0;
  for (let z = 0; z < GRID_D; z++) {
    for (let x = 0; x < GRID_W; x++) {
      if (!BAY_MASK[z]?.[x]) continue;
      for (let d = DEPTH_LAYERS - 2; d < DEPTH_LAYERS; d++) {  // bottom 2 layers
        sum += data[z]?.[x]?.[d] ?? 0;
        count++;
      }
    }
  }
  return count > 0 ? sum / count : 0;
}

export function valueToConcentration(value: number, variableId: string): number {
  switch (variableId) {
    case "nitrogen":   return +(value * 2.8 + 0.2).toFixed(2);
    case "phosphorus": return +(value * 120 + 10).toFixed(1);
    case "flow":       return +(value * 80).toFixed(1);
    default:           return +value.toFixed(3);
  }
}

// ── Watershed bounding boxes ─────────────────────────────────

export interface Watershed {
  id: string;
  name: string;
  description: string;
  area: string;
  basinIds: string[];           // river ids + "ocean"
  svgBox: { x: number; y: number; w: number; h: number };
  color: string;                // CSS hex for stroke/fill
}

/**
 * Pre-defined watershed bounding boxes rendered on the Map Viewport.
 * SVG coordinates are in the 520×400 viewBox used by BasinOverview.
 */
export const WATERSHEDS: Watershed[] = [
  {
    id: "shizugawa-bay",
    name: "Shizugawa Bay Watershed",
    description: "Complete drainage basin",
    area: "78.9 km²",
    basinIds: ["shizugawa", "kitakami", "hachiman", "ocean"],
    svgBox: { x: 62, y: 40, w: 378, h: 278 },
    color: "#7c6fcd",
  },
  {
    id: "inner-bay-zone",
    name: "Inner Bay Study Zone",
    description: "Shizugawa · Hachiman catchment",
    area: "44.1 km²",
    basinIds: ["shizugawa", "hachiman", "ocean"],
    svgBox: { x: 135, y: 55, w: 285, h: 253 },
    color: "#0ea5e9",
  },
];

// ── River data (2D, no depth) ────────────────────────────────

export const RIVER_COLS = 120; // along-stream axis (x)
export const RIVER_ROWS = 22;  // cross-stream axis (z)

export const RIVERS = [
  { id: "shizugawa", name: "Shizugawa",      sub: "Minamisanriku · 25.0 km²", length: "18.4 km" },
  { id: "oura",      name: "Oura",           sub: "Minamisanriku · 8.7 km²",  length: "6.2 km"  },
  { id: "karakuwa",  name: "Karakuwa",       sub: "Kesennuma · 12.4 km²",     length: "9.1 km"  },
  { id: "togura",    name: "Togura",         sub: "Minamisanriku · 10.3 km²", length: "7.8 km"  },
  { id: "urashiro",  name: "Urashiro",       sub: "Minamisanriku · 9.5 km²",  length: "5.9 km"  },
  { id: "iriya",     name: "Iriya",          sub: "Minamisanriku · 7.1 km²",  length: "4.3 km"  },
  { id: "okawa",     name: "Okawa",          sub: "Minamisanriku · 13.8 km²", length: "11.0 km" },
  { id: "niida",     name: "Niida",          sub: "Oshika District · 30.5 km²", length: "14.6 km" },
  { id: "karakuwa2", name: "Karakuwa East",  sub: "Kesennuma · 6.9 km²",      length: "5.4 km"  },
  { id: "tomaya",    name: "Tomaya",         sub: "Oshika District · 18.2 km²", length: "9.3 km" },
  { id: "shishiori", name: "Shishiori",      sub: "Kesennuma · 22.7 km²",     length: "13.1 km" },
  { id: "onagawa",   name: "Onagawa",        sub: "Oshika District · 15.6 km²", length: "8.7 km" },
  { id: "hachiman",  name: "Hachiman",       sub: "Minamisanriku · 24.1 km²", length: "9.7 km"  },
  { id: "motoyoshi", name: "Motoyoshi",      sub: "Motoyoshi · 21.3 km²",     length: "12.1 km" },
  { id: "mitobe",    name: "Mitobe",         sub: "Minamisanriku · 22.6 km²", length: "11.2 km" },
  { id: "sakura",    name: "Sakura",         sub: "Minamisanriku · 11.2 km²", length: "5.8 km"  },
  { id: "oritate",   name: "Oritate",        sub: "Minamisanriku · 14.2 km²", length: "7.3 km"  },
  { id: "kitakami",  name: "Kitakami",       sub: "Motoyoshi · 16.4 km²",     length: "10.5 km" },
  { id: "moriya",    name: "Moriya",         sub: "Minamisanriku · 8.1 km²",  length: "5.1 km"  },
  { id: "oya",       name: "Oya",            sub: "Minamisanriku · 17.9 km²", length: "10.2 km" },
  { id: "kamaishi",  name: "Kamaishi",       sub: "Kamaishi · 19.3 km²",      length: "11.7 km" },
];

// ── Depth geometry constants (non-uniform sigma-coordinate layers) ───────────

/** Scene-unit height of each depth layer (layer 0 = surface, thinnest) */
export const DEPTH_HEIGHTS = [0.40, 0.50, 0.65, 0.82, 1.05, 1.28, 1.55, 1.80];

/** Real meter depth at the TOP surface of each layer */
export const DEPTH_REAL_M = [0, 2, 5, 10, 18, 30, 47, 69];

/**
 * Cumulative scene-unit offset from the surface for the TOP of each layer.
 * DEPTH_TOPS[0] = 0 (layer 0 top is at the surface).
 * DEPTH_TOPS[d] = sum of DEPTH_HEIGHTS[0..d-1].
 */
export const DEPTH_TOPS: number[] = (() => {
  const tops: number[] = [];
  let acc = 0;
  for (let i = 0; i < DEPTH_HEIGHTS.length; i++) {
    tops.push(acc);
    acc += DEPTH_HEIGHTS[i];
  }
  return tops;
})();

/** Total scene-unit height of the full depth column */
export const DEPTH_TOTAL_H = DEPTH_HEIGHTS.reduce((a, b) => a + b, 0);

/**
 * Depth-weighted column mean across all 8 layers at (x, z).
 * Weight = DEPTH_HEIGHTS[d] (thicker layers count more).
 */
export function getColumnMean(data: number[][][], x: number, z: number): number {
  let sumW = 0;
  let sumWV = 0;
  for (let d = 0; d < DEPTH_HEIGHTS.length; d++) {
    const v = data[z]?.[x]?.[d] ?? 0;
    sumWV += v * DEPTH_HEIGHTS[d];
    sumW += DEPTH_HEIGHTS[d];
  }
  return sumW > 0 ? sumWV / sumW : 0;
}

/**
 * Per-river parameters: [phaseOffset, baseline, amplitude]
 *  - phaseOffset: shifts the seasonal peak independently for each river (0–2π)
 *  - baseline:    long-run mean concentration level (0–1), varying by catchment character
 *  - amplitude:   how much it swings above/below the baseline each year
 * Phases are spread ~evenly across 2π so at any single week, different rivers
 * sit at very different points in their cycle → full blue→red range visible at once.
 */
const RIVER_PARAMS: Record<string, [number, number, number]> = {
  shizugawa: [0.00, 0.55, 0.38],
  oura:      [0.60, 0.20, 0.18],
  karakuwa:  [1.20, 0.75, 0.22],
  togura:    [1.80, 0.38, 0.36],
  urashiro:  [2.40, 0.82, 0.17],
  iriya:     [3.00, 0.28, 0.26],
  okawa:     [3.60, 0.65, 0.32],
  niida:     [4.20, 0.15, 0.14],
  karakuwa2: [4.80, 0.70, 0.28],
  tomaya:    [5.40, 0.42, 0.40],
  shishiori: [0.30, 0.88, 0.12],
  onagawa:   [0.90, 0.32, 0.30],
  hachiman:  [1.50, 0.60, 0.35],
  motoyoshi: [2.10, 0.78, 0.20],
  mitobe:    [2.70, 0.22, 0.22],
  sakura:    [3.30, 0.50, 0.45],
  oritate:   [3.90, 0.85, 0.14],
  kitakami:  [4.50, 0.35, 0.33],
  moriya:    [5.10, 0.68, 0.30],
  oya:       [5.70, 0.12, 0.12],
  kamaishi:  [0.45, 0.92, 0.08],
};

/** Generate a RIVER_ROWS × RIVER_COLS 2D grid of values for a given week */
export function generateRiverData(week: number, riverId: string, year: number = 2023): number[][] {
  const yearShift = (year - 2023) * 0.31;
  const t = (week / TOTAL_WEEKS) * Math.PI * 2 + yearShift;

  const [phaseOffset, baseline, amplitude] = RIVER_PARAMS[riverId] ?? [0, 0.5, 0.3];
  // Each river has its own seasonal peak; result spans its own baseline ± amplitude
  const seasonalBase = Math.sin(t + phaseOffset) * amplitude + baseline;

  const data: number[][] = [];
  for (let row = 0; row < RIVER_ROWS; row++) {
    data[row] = [];
    for (let col = 0; col < RIVER_COLS; col++) {
      const upstreamInfluence = Math.max(0, 1 - col / RIVER_COLS) * 0.4;
      const centerBoost = 1 - Math.abs(row - RIVER_ROWS / 2 + 0.5) / (RIVER_ROWS / 2) * 0.25;
      const v = (
        Math.sin(col * 0.4 + t * 0.9 + phaseOffset) * 0.12 +
        Math.cos(row * 0.8 + t * 0.7) * 0.09 +
        Math.sin((col + row) * 0.3 + t * 1.2) * 0.07
      );
      const val = Math.min(1, Math.max(0,
        seasonalBase * 0.7 + v * 0.3 + upstreamInfluence * 0.2 + centerBoost * 0.04
      ));
      data[row][col] = val;
    }
  }
  return data;
}
