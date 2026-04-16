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

// Grid at 56×48 (2× from original 28×24) — STEP=0.5 in OceanBasin3D keeps the
// same physical bay dimensions while halving voxel size for a denser look.
export const GRID_W = 56;
export const GRID_D = 48;
export const DEPTH_LAYERS = 8;
export const TOTAL_WEEKS = 52;

// Original 28×24 mask — expanded to 56×48 via 2×2 block doubling below.
// gz 0 = south shore, gz 23 = north; gx 0 = west (inner bay head), gx 27 = east (bay mouth)
const T = true, F = false;
// BAY_MASK_SRC — derived from OCEAN_BASIN_PATH SVG polygon via ray-casting
// point-in-polygon + scanline fill + exterior flood-fill (no internal gaps).
// Coordinate mapping: svgX→gx (215–419 → 0–27), svgY→gz (196–419 → 23–0).
// gz=23 extended to gx=22–25 to provide a 4-cell channel for the two north rivers.
const BAY_MASK_SRC: boolean[][] = [
  [F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,T,F,F,F,F,F,F,F,F,F,F,F,F], // gz  0
  [F,F,F,F,F,T,T,T,T,T,T,T,T,T,T,T,F,F,F,F,F,F,F,F,F,F,F,F], // gz  1
  [F,F,F,F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F,F], // gz  2
  [F,F,F,F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F,F], // gz  3
  [F,F,F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F,F], // gz  4
  [F,F,F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F], // gz  5
  [F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F], // gz  6
  [F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F], // gz  7
  [F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F], // gz  8
  [F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F,F], // gz  9
  [F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F,F], // gz 10
  [F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F], // gz 11
  [F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T], // gz 12
  [F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T], // gz 13
  [F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F], // gz 14
  [F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T], // gz 15
  [F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F], // gz 16
  [F,F,F,F,F,F,F,F,F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F], // gz 17
  [F,F,F,F,F,F,F,F,F,F,F,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,F], // gz 18
  [F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,T,T,T,T,T,T,T,T,T,F], // gz 19
  [F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,T,T,T,T,T,T,T,T,T,T], // gz 20
  [F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,T,T,T,T,T,T,T,T,T,F], // gz 21
  [F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,T,T,T,T,T,T,T,T,F,F], // gz 22
  [F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,T,T,T,T,F,F], // gz 23
];

// 56×48 mask — each original cell becomes a 2×2 block of identical cells.
export const BAY_MASK: boolean[][] = Array.from({ length: GRID_D }, (_, gz) =>
  Array.from({ length: GRID_W }, (_, gx) =>
    BAY_MASK_SRC[Math.floor(gz / 2)]?.[Math.floor(gx / 2)] ?? false
  )
);

// ── River voxel cells ────────────────────────────────────────────────────────
// Spines authored in 28×24 space, densified ×2 to match the 56×48 grid.
// mouthGx / mouthGz are in 56×48 coords (original × 2).

export interface RiverCell {
  gx: number;
  gz: number;      // row index; ≥ GRID_D = north rivers, < 0 = south rivers
  mouthGx: number; // bay-boundary column for value / colour sampling
  mouthGz: number; // bay-boundary row  for value / colour sampling
}

// buildRiver: north/south rivers — sweeps along gz, spreads in gx.
// Each entry may carry an optional `w` (half-width override in 56×48 cells);
// if absent the width tapers linearly from halfWDelta→halfWUpstream.
function buildRiver(
  spine: Array<{ gz: number; cx: number; w?: number }>,
  halfWDelta: number,
  halfWUpstream: number,
  mouthGx: number,
  mouthGz: number,
): RiverCell[] {
  const cells: RiverCell[] = [];
  const seen = new Set<string>();
  const n = spine.length;
  spine.forEach(({ gz, cx, w }, i) => {
    const t     = n > 1 ? i / (n - 1) : 0;
    const halfW = w !== undefined
      ? w
      : Math.round(halfWDelta + (halfWUpstream - halfWDelta) * t);
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
  spine: Array<{ gx: number; cz: number; w?: number }>,
  halfWDelta: number,
  halfWUpstream: number,
  mouthGx: number,
  mouthGz: number,
): RiverCell[] {
  const cells: RiverCell[] = [];
  const seen = new Set<string>();
  const n = spine.length;
  spine.forEach(({ gx, cz, w }, i) => {
    const t     = n > 1 ? i / (n - 1) : 0;
    const halfW = w !== undefined
      ? w
      : Math.round(halfWDelta + (halfWUpstream - halfWDelta) * t);
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

// ── Spine densifiers ─────────────────────────────────────────────────────────
// Authored in 28×24 space; multiply coords ×2 and fill gaps for the 56×48 grid.
// Optional `w` (half-width override in 28×24 space) is also doubled so the
// physical width is preserved at STEP=0.5.

function densifyNS(
  sparse: Array<{ gz: number; cx: number; w?: number }>,
): Array<{ gz: number; cx: number; w?: number }> {
  const out: Array<{ gz: number; cx: number; w?: number }> = [];
  for (let i = 0; i < sparse.length; i++) {
    const { gz, cx, w } = sparse[i];
    out.push({ gz: gz * 2, cx: cx * 2, ...(w !== undefined ? { w: w * 2 } : {}) });
    if (i < sparse.length - 1) {
      const { gz: gz2, cx: cx2, w: w2 } = sparse[i + 1];
      const midW = (w !== undefined && w2 !== undefined)
        ? Math.round((w * 2 + w2 * 2) / 2) : undefined;
      out.push({
        gz: gz * 2 + Math.sign(gz2 - gz),
        cx: Math.round((cx * 2 + cx2 * 2) / 2),
        ...(midW !== undefined ? { w: midW } : {}),
      });
    }
  }
  return out;
}

function densifyEW(
  sparse: Array<{ gx: number; cz: number; w?: number }>,
): Array<{ gx: number; cz: number; w?: number }> {
  const out: Array<{ gx: number; cz: number; w?: number }> = [];
  for (let i = 0; i < sparse.length; i++) {
    const { gx, cz, w } = sparse[i];
    out.push({ gx: gx * 2, cz: cz * 2, ...(w !== undefined ? { w: w * 2 } : {}) });
    if (i < sparse.length - 1) {
      const { gx: gx2, cz: cz2, w: w2 } = sparse[i + 1];
      const midW = (w !== undefined && w2 !== undefined)
        ? Math.round((w * 2 + w2 * 2) / 2) : undefined;
      out.push({
        gx: gx * 2 + Math.sign(gx2 - gx),
        cz: Math.round((cz * 2 + cz2 * 2) / 2),
        ...(midW !== undefined ? { w: midW } : {}),
      });
    }
  }
  return out;
}

// ── River spines (authored in 28×24 coords, densified to 56×48) ──────────────
// Shapes traced from SVG river paths in svgPaths.ts using the affine mapping:
//   cx  (28×24) ≈ 0.0535 × svgX + 5
//   Δgz (28×24) ≈ −ΔsvgY / 13.3   (each 13.3 SVG pixels north = +1 gz step)
//
// River 24 (oya)      → NORTH:  mild left drift,  mostly straight
// River  3 (karakuwa) → NE:     hugs right edge, slight sinusoid near boundary
// River 13 (hachiman) → SE:     consistent left drift going south
// River  7 (okawa)    → EAST:   gentle northward drift going east

// North river — traced from river 24 (oya): straight with a very mild left drift.
// Gap-fill cx=22 aligns with the north-passage water cells at gz=21–23 in the new mask.
const SPINE_NORTH = densifyNS([
  { gz:21, cx:22 }, { gz:22, cx:22 }, { gz:23, cx:22 }, // bay gap-fill
  { gz:24, cx:22 },                                       // exit
  { gz:25, cx:21 }, { gz:26, cx:21 },
  { gz:27, cx:21 }, { gz:28, cx:20 },
  { gz:29, cx:20 }, { gz:30, cx:21 },                    // small right undulation
  { gz:31, cx:21 }, { gz:32, cx:20 },
  { gz:33, cx:20 }, { gz:34, cx:20 },
  { gz:35, cx:19 }, { gz:36, cx:19 },
  { gz:37, cx:20 }, { gz:38, cx:20 },                    // slight right return
  { gz:39, cx:19 }, { gz:40, cx:19 },
  { gz:41, cx:19 }, { gz:42, cx:19 },
  { gz:43, cx:18 }, { gz:44, cx:18 },                    // final gentle drift left
]);

// NE river — traced from river 3 (karakuwa): exits from the right side,
// hugs gx=25-27 with a slow sinusoid
const SPINE_NE = densifyNS([
  { gz:21, cx:25 }, { gz:22, cx:25 }, { gz:23, cx:25 }, // bay gap-fill
  { gz:24, cx:25 },                                       // exit
  { gz:25, cx:25 }, { gz:26, cx:26 },
  { gz:27, cx:27 }, { gz:28, cx:27 },                    // swing right to boundary
  { gz:29, cx:26 }, { gz:30, cx:26 },
  { gz:31, cx:25 }, { gz:32, cx:26 },
  { gz:33, cx:27 }, { gz:34, cx:27 },                    // right again
  { gz:35, cx:26 }, { gz:36, cx:25 },
  { gz:37, cx:25 }, { gz:38, cx:26 },
  { gz:39, cx:27 }, { gz:40, cx:27 },                    // third oscillation
  { gz:41, cx:26 }, { gz:42, cx:25 },
  { gz:43, cx:25 }, { gz:44, cx:26 },
]);

// SE river — traced from river 13 (hachiman): consistent left drift going south
const SPINE_SE = densifyNS([
  { gz:2,   cx:15 }, { gz:1,   cx:15 }, { gz:0,   cx:15 }, // bay gap-fill
  { gz:-1,  cx:15 },                                          // exit
  { gz:-2,  cx:15 }, { gz:-3,  cx:14 },
  { gz:-4,  cx:14 }, { gz:-5,  cx:14 },
  { gz:-6,  cx:13 }, { gz:-7,  cx:13 },
  { gz:-8,  cx:13 }, { gz:-9,  cx:12 },
  { gz:-10, cx:12 }, { gz:-11, cx:12 },
  { gz:-12, cx:11 }, { gz:-13, cx:11 },
  { gz:-14, cx:12 }, { gz:-15, cx:12 },                     // slight right undulation
  { gz:-16, cx:11 }, { gz:-17, cx:11 },
  { gz:-18, cx:10 }, { gz:-19, cx:10 }, { gz:-20, cx:10 },
]);

// East river — traced from river 7 (okawa, reversed): gentle northward drift
const SPINE_EAST_RIVER = densifyEW([
  { gx:25, cz:13 }, { gx:26, cz:13 }, { gx:27, cz:13 }, // bay gap-fill
  { gx:28, cz:13 },                                        // exit
  { gx:29, cz:13 }, { gx:30, cz:14 },
  { gx:31, cz:14 }, { gx:32, cz:14 },
  { gx:33, cz:15 }, { gx:34, cz:15 },
  { gx:35, cz:14 }, { gx:36, cz:15 },                     // slight south dip
  { gx:37, cz:15 }, { gx:38, cz:16 },
  { gx:39, cz:16 }, { gx:40, cz:16 },
  { gx:41, cz:15 }, { gx:42, cz:16 },                     // slight south dip
  { gx:43, cz:17 }, { gx:44, cz:17 },
  { gx:45, cz:16 }, { gx:46, cz:17 }, { gx:47, cz:17 },
]);

export const RIVER_CELLS: RiverCell[] = [
  // halfW values in 56×48 coords (original 28×24 halfW ×2).
  // `w` overrides per-entry widths where pools/rapids are marked on the spines.
  ...buildRiver(SPINE_NORTH,          4, 0, 44, GRID_D - 1),
  ...buildRiver(SPINE_NE,             2, 0, 50, GRID_D - 1),
  ...buildRiver(SPINE_SE,             4, 0, 30, 0),
  ...buildRiverEast(SPINE_EAST_RIVER, 4, 0, 55, 26),
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

// ── Composite (multi-basin) river definitions ────────────────────────────────

export type CorridorTopology = "linear" | "convergent";

export interface CompositeSegment {
  riverId: string;
  name: string;       // display name
  sub: string;        // sub-basin label
  role: "upper" | "lower";
  colStart: number;   // first column (0-based, inclusive)
  colEnd: number;     // last column (inclusive)
  rowStart?: number;  // first row (inclusive, defaults to 0)
  rowEnd?: number;    // last row  (inclusive, defaults to RIVER_ROWS - 1)
}

export interface CompositeRiver {
  id: string;
  name: string;
  description: string;
  totalLength: string;
  topology: CorridorTopology;
  segments: CompositeSegment[];
}

const SPLIT_COL = 60;       // column index where upper half ends / lower half begins
const UPPER_ROW_SPLIT = 11; // first row of the second upper band (≈ RIVER_ROWS / 2)

/**
 * Multi-basin corridors — defined by actual hydrological network topology.
 *
 * Linear (sub-basin 25 → sub-basin 3):
 *   Kamaishi river flows continuously from sub-basin 25 into sub-basin 3
 *   (karakuwa), which empties closest to the ocean.
 *
 * Convergent Y-shape:
 *   Two upper tributaries merge into one lower mainstem.
 *   · Sub-basins 7 (okawa) + 24 (oya)   → sub-basin 4 (togura)
 *   · Sub-basins 14 (motoyoshi) + 13 (hachiman) → sub-basin 6 (iriya)
 *
 * In the 2D River view, convergent corridors show two parallel row-bands in
 * the left (upper) half that merge into a single channel in the right (lower) half.
 */
export const COMPOSITE_RIVERS: CompositeRiver[] = [
  {
    id: "comp-kamaishi-karakuwa",
    name: "Kamaishi → Karakuwa",
    description: "Sub-basin 25 upper reach flows into sub-basin 3 (ocean-proximate)",
    totalLength: "20.8 km",
    topology: "linear",
    segments: [
      { riverId: "kamaishi", name: "Kamaishi", sub: "Sub-basin 25 (Kamaishi)", role: "upper", colStart: 0,  colEnd: 59  },
      { riverId: "karakuwa", name: "Karakuwa", sub: "Sub-basin 3 (Kesennuma)", role: "lower", colStart: 60, colEnd: 119 },
    ],
  },
  {
    id: "comp-okawa-oya-togura",
    name: "Okawa + Oya → Togura",
    description: "Sub-basins 7 & 24 converge into sub-basin 4 (ocean-proximate)",
    totalLength: "28.5 km",
    topology: "convergent",
    segments: [
      { riverId: "okawa",  name: "Okawa",  sub: "Sub-basin 7",  role: "upper", colStart: 0,  colEnd: 59,  rowStart: 0,              rowEnd: UPPER_ROW_SPLIT - 1 },
      { riverId: "oya",    name: "Oya",    sub: "Sub-basin 24", role: "upper", colStart: 0,  colEnd: 59,  rowStart: UPPER_ROW_SPLIT, rowEnd: RIVER_ROWS - 1      },
      { riverId: "togura", name: "Togura", sub: "Sub-basin 4",  role: "lower", colStart: 60, colEnd: 119 },
    ],
  },
  {
    id: "comp-motoyoshi-hachiman-iriya",
    name: "Motoyoshi + Hachiman → Iriya",
    description: "Sub-basins 14 & 13 converge into sub-basin 6 (ocean-proximate)",
    totalLength: "25.1 km",
    topology: "convergent",
    segments: [
      { riverId: "motoyoshi", name: "Motoyoshi", sub: "Sub-basin 14", role: "upper", colStart: 0,  colEnd: 59,  rowStart: 0,              rowEnd: UPPER_ROW_SPLIT - 1 },
      { riverId: "hachiman",  name: "Hachiman",  sub: "Sub-basin 13", role: "upper", colStart: 0,  colEnd: 59,  rowStart: UPPER_ROW_SPLIT, rowEnd: RIVER_ROWS - 1      },
      { riverId: "iriya",     name: "Iriya",     sub: "Sub-basin 6",  role: "lower", colStart: 60, colEnd: 119 },
    ],
  },
];

export function getCompositeRiver(id: string): CompositeRiver | undefined {
  return COMPOSITE_RIVERS.find(c => c.id === id);
}

/** Returns the spatial mean per segment at a given week (one value per segment). */
export function getCompositeSegmentMeans(
  week: number,
  compositeId: string,
  variableId: string,
  year: number = 2023
): number[] {
  const comp = getCompositeRiver(compositeId);
  if (!comp) return [];
  const data = generateCompositeRiverData(week, compositeId, year);
  return comp.segments.map(seg => {
    const rowS = seg.rowStart ?? 0;
    const rowE = seg.rowEnd ?? RIVER_ROWS - 1;
    let sum = 0, count = 0;
    for (let row = rowS; row <= rowE; row++) {
      for (let col = seg.colStart; col <= seg.colEnd; col++) {
        sum += data[row]?.[col] ?? 0;
        count++;
      }
    }
    return count > 0 ? valueToConcentration(sum / count, variableId) : 0;
  });
}

/**
 * Generate a RIVER_ROWS × RIVER_COLS data grid for a composite corridor.
 *
 * Linear: left half = upper params, right half = lower params, cosine blend at the boundary.
 *
 * Convergent: left half has two horizontal row bands (upper1 top, upper2 bottom),
 *   right half is a single merged lower channel. Cosine blend bridges the transition.
 */
export function generateCompositeRiverData(
  week: number,
  compositeId: string,
  year: number = 2023
): number[][] {
  const comp = getCompositeRiver(compositeId);
  if (!comp) return generateRiverData(week, "shizugawa", year);

  const BLEND_COLS = 8;
  const yearShift = (year - 2023) * 0.31;
  const t = (week / TOTAL_WEEKS) * Math.PI * 2 + yearShift;

  const makeVal = (riverId: string, col: number, row: number): number => {
    const [phaseOffset, baseline, amplitude] = RIVER_PARAMS[riverId] ?? [0, 0.5, 0.3];
    const seasonalBase = Math.sin(t + phaseOffset) * amplitude + baseline;
    const upstreamInfluence = Math.max(0, 1 - col / RIVER_COLS) * 0.4;
    const centerBoost = 1 - Math.abs(row - RIVER_ROWS / 2 + 0.5) / (RIVER_ROWS / 2) * 0.25;
    const v =
      Math.sin(col * 0.4 + t * 0.9 + phaseOffset) * 0.12 +
      Math.cos(row * 0.8 + t * 0.7) * 0.09 +
      Math.sin((col + row) * 0.3 + t * 1.2) * 0.07;
    return Math.min(1, Math.max(0, seasonalBase * 0.7 + v * 0.3 + upstreamInfluence * 0.2 + centerBoost * 0.04));
  };

  const blend = (col: number) => {
    const raw = (col - (SPLIT_COL - BLEND_COLS)) / (BLEND_COLS * 2);
    const clamp = Math.min(1, Math.max(0, raw));
    return (1 - Math.cos(clamp * Math.PI)) / 2; // 0 = all upper, 1 = all lower
  };

  const data: number[][] = [];

  if (comp.topology === "linear") {
    const upper = comp.segments.find(s => s.role === "upper") ?? comp.segments[0];
    const lower = comp.segments.find(s => s.role === "lower") ?? comp.segments[1];
    for (let row = 0; row < RIVER_ROWS; row++) {
      data[row] = [];
      for (let col = 0; col < RIVER_COLS; col++) {
        const mix = blend(col);
        data[row][col] = makeVal(upper.riverId, col, row) * (1 - mix)
                       + makeVal(lower.riverId, col, row) * mix;
      }
    }
  } else {
    // Convergent: two upper row-bands → one lower channel
    const uppers = comp.segments.filter(s => s.role === "upper");
    const lower  = comp.segments.find(s => s.role === "lower") ?? comp.segments[2];
    for (let row = 0; row < RIVER_ROWS; row++) {
      data[row] = [];
      const upperSeg = uppers.find(u => row >= (u.rowStart ?? 0) && row <= (u.rowEnd ?? RIVER_ROWS - 1))
        ?? uppers[0];
      for (let col = 0; col < RIVER_COLS; col++) {
        const mix = blend(col);
        data[row][col] = makeVal(upperSeg.riverId, col, row) * (1 - mix)
                       + makeVal(lower.riverId, col, row) * mix;
      }
    }
  }

  return data;
}

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
