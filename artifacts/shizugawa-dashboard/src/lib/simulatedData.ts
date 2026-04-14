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

// Rasterized from the actual OCEAN_BASIN_PATH SVG polygon.
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
  gz: number;      // row index; ≥ GRID_D = north rivers, < 0 = south rivers
  mouthGx: number; // bay-boundary column for value / colour sampling
  mouthGz: number; // bay-boundary row  for value / colour sampling
}

// buildRiver: north/south rivers — sweeps along gz, spreads in gx.
// Tapers from halfWDelta (mouth, index 0) to halfWUpstream (source, last index).
function buildRiver(
  spine: Array<{ gz: number; cx: number }>,
  halfWDelta: number,
  halfWUpstream: number,
  mouthGx: number,
  mouthGz: number,
): RiverCell[] {
  const cells: RiverCell[] = [];
  const seen = new Set<string>();
  const n = spine.length;
  spine.forEach(({ gz, cx }, i) => {
    const t     = n > 1 ? i / (n - 1) : 0;
    const halfW = Math.round(halfWDelta + (halfWUpstream - halfWDelta) * t);
    for (let dx = -halfW; dx <= halfW; dx++) {
      const gx = cx + dx;
      if (gx < 0 || gx >= GRID_W) continue;
      const key = `${gz},${gx}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push({ gx, gz, mouthGx, mouthGz });
    }
  });
  return cells;
}

// buildRiverEast: east river — sweeps along gx (gx >= GRID_W), spreads in gz.
function buildRiverEast(
  spine: Array<{ gx: number; cz: number }>,
  halfWDelta: number,
  halfWUpstream: number,
  mouthGx: number,
  mouthGz: number,
): RiverCell[] {
  const cells: RiverCell[] = [];
  const seen = new Set<string>();
  const n = spine.length;
  spine.forEach(({ gx, cz }, i) => {
    const t     = n > 1 ? i / (n - 1) : 0;
    const halfW = Math.round(halfWDelta + (halfWUpstream - halfWDelta) * t);
    for (let dz = -halfW; dz <= halfW; dz++) {
      const gz = cz + dz;
      const key = `${gz},${gx}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push({ gx, gz, mouthGx, mouthGz });
    }
  });
  return cells;
}

// ── River spines — east/shallow side of bay ──────────────────────────────────
// Bay mouth mask row gz=23: active at gx=2-4, 8-10, 13, 15-17, 25
// Bay mouth mask row gz=0 : active at gx=15 only

// North river — exits gz=23 near gx=16 (mid-east cluster), body goes north
// Start 2 rows inside bay (gz=21,22,23) to fill boundary gap cells
const SPINE_NORTH = [
  { gz:21, cx:16 }, { gz:22, cx:16 }, { gz:23, cx:16 },
  { gz:24, cx:16 }, { gz:25, cx:16 }, { gz:26, cx:15 }, { gz:27, cx:14 },
  { gz:28, cx:15 }, { gz:29, cx:16 }, { gz:30, cx:17 }, { gz:31, cx:18 },
  { gz:32, cx:17 }, { gz:33, cx:16 }, { gz:34, cx:15 }, { gz:35, cx:14 },
  { gz:36, cx:15 }, { gz:37, cx:16 }, { gz:38, cx:17 }, { gz:39, cx:18 },
  { gz:40, cx:17 }, { gz:41, cx:16 }, { gz:42, cx:15 }, { gz:43, cx:16 },
  { gz:44, cx:17 },
];

// Northeast river — exits gz=23 at gx=25 (isolated NE cell), body goes northeast
// Start 2 rows inside bay (gz=21,22,23) to fill boundary gap cells
const SPINE_NE = [
  { gz:21, cx:25 }, { gz:22, cx:25 }, { gz:23, cx:25 },
  { gz:24, cx:25 }, { gz:25, cx:26 }, { gz:26, cx:26 }, { gz:27, cx:25 },
  { gz:28, cx:25 }, { gz:29, cx:26 }, { gz:30, cx:26 }, { gz:31, cx:27 },
  { gz:32, cx:27 }, { gz:33, cx:26 }, { gz:34, cx:25 }, { gz:35, cx:26 },
  { gz:36, cx:27 }, { gz:37, cx:27 }, { gz:38, cx:26 }, { gz:39, cx:25 },
  { gz:40, cx:26 }, { gz:41, cx:27 }, { gz:42, cx:27 }, { gz:43, cx:26 },
  { gz:44, cx:25 },
];

// Southeast river — exits gz=0 near gx=16, body goes south (negative gz)
// Start 2 rows inside bay (gz=2,1,0) to fill boundary gap cells
const SPINE_SE = [
  { gz:2,   cx:16 }, { gz:1,   cx:16 }, { gz:0,   cx:16 },
  { gz:-1,  cx:16 }, { gz:-2,  cx:17 }, { gz:-3,  cx:18 }, { gz:-4,  cx:19 },
  { gz:-5,  cx:20 }, { gz:-6,  cx:19 }, { gz:-7,  cx:18 }, { gz:-8,  cx:17 },
  { gz:-9,  cx:18 }, { gz:-10, cx:19 }, { gz:-11, cx:20 }, { gz:-12, cx:19 },
  { gz:-13, cx:18 }, { gz:-14, cx:17 }, { gz:-15, cx:18 }, { gz:-16, cx:19 },
  { gz:-17, cx:20 }, { gz:-18, cx:19 }, { gz:-19, cx:18 }, { gz:-20, cx:17 },
];

// East river — exits eastern bay wall near gz=13 (gx=27 active there),
// body flows eastward (gx=28→47), spreads in gz, gently curving north-south.
// Start 2 columns inside bay (gx=25,26,27) to fill east-boundary gap cells.
// mouthGx=27 (eastern bay column), mouthGz=13 (row where gx=27 is active).
const SPINE_EAST_RIVER = [
  { gx:25, cz:13 }, { gx:26, cz:13 }, { gx:27, cz:13 },
  { gx:28, cz:13 }, { gx:29, cz:13 }, { gx:30, cz:14 }, { gx:31, cz:15 },
  { gx:32, cz:15 }, { gx:33, cz:14 }, { gx:34, cz:13 }, { gx:35, cz:12 },
  { gx:36, cz:12 }, { gx:37, cz:13 }, { gx:38, cz:14 }, { gx:39, cz:15 },
  { gx:40, cz:16 }, { gx:41, cz:16 }, { gx:42, cz:15 }, { gx:43, cz:14 },
  { gx:44, cz:13 }, { gx:45, cz:12 }, { gx:46, cz:11 }, { gx:47, cz:11 },
];

export const RIVER_CELLS: RiverCell[] = [
  // args: spine, halfWDelta (mouth), halfWUpstream (source), mouthGx, mouthGz
  // Scaled to realistic proportions: ~500m delta, ~250m channel vs ~7km bay
  ...buildRiver(SPINE_NORTH,          2, 0, 16, GRID_D - 1),  // north — 5-cell delta → 1-cell channel
  ...buildRiver(SPINE_NE,             1, 0, 25, GRID_D - 1),  // northeast — 3-cell delta → 1-cell channel
  ...buildRiver(SPINE_SE,             2, 0, 15, 0),            // southeast — 5-cell delta → 1-cell channel
  ...buildRiverEast(SPINE_EAST_RIVER, 2, 0, 27, 13),          // east — 5-cell delta → 1-cell channel
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
