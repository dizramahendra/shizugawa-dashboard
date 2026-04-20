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

// Grid at 112×96 — STEP=0.5 in OceanBasin3D.
// gx 0 = west (inner bay head), gx 111 = east (bay mouth)
// gz 0 = south shore, gz 95 = north shore
export const GRID_W = 112;
export const GRID_D = 96;
export const DEPTH_LAYERS = 8;
export const TOTAL_WEEKS = 52;

// ── Bay outline polygon ───────────────────────────────────────────────────────
// Shizugawa Bay coastline in normalised [0,1]×[0,1] space.
// x: west(0)→east(1), z: south(0)→north(1).
// Vertices derived from the original 28×24 cell-edge boundaries.
// Rivers connect to the bay by extending their spines to reach this boundary —
// the ocean shape is NOT modified to chase the rivers.
function pointInPolygon(px: number, pz: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (((zi > pz) !== (zj > pz)) && (px < (xj - xi) * (pz - zi) / (zj - zi) + xi))
      inside = !inside;
  }
  return inside;
}

// Polygon derived by tracing OCEAN_BASIN_PATH from svgPaths.ts.
// SVG canvas = 465×586 (SVG_W × SVG_H, matching MapLibreMap constants).
// Normalisation: nx = svgX / 465,  nz = 1 − svgY / 586  (nz=0 south, nz=1 north).
// The outer polygon was simplified with Douglas-Peucker ε=3 px (311→73 vertices).
// Bay occupies gx 52–99, gz 27–62 of the 112×96 grid.
const BAY_POLYGON: [number, number][] = [
  [0.8341, 0.6631], [0.8395, 0.6268], [0.8782, 0.6324], [0.8939, 0.6132],
  [0.8750, 0.5878], [0.8750, 0.5493], [0.8925, 0.5364], [0.8794, 0.5062],
  [0.8990, 0.4897], [0.8925, 0.4738], [0.8473, 0.4656], [0.8473, 0.4491],
  [0.8609, 0.4263], [0.8821, 0.4133], [0.8821, 0.3978], [0.8451, 0.3515],
  [0.8435, 0.3170], [0.8185, 0.3124], [0.8201, 0.3367], [0.7873, 0.3158],
  [0.7744, 0.3175], [0.7663, 0.3342], [0.7497, 0.3141], [0.7330, 0.3128],
  [0.6911, 0.3376], [0.6540, 0.3325], [0.6104, 0.3542], [0.5981, 0.3457],
  [0.5905, 0.3150], [0.5792, 0.3171], [0.5602, 0.2846], [0.5516, 0.2863],
  [0.5599, 0.3197], [0.5325, 0.3299], [0.5093, 0.3214], [0.4722, 0.3261],
  [0.4631, 0.3461], [0.4765, 0.3730], [0.5190, 0.4182], [0.4948, 0.4498],
  [0.4997, 0.4856], [0.4788, 0.5213], [0.5077, 0.5247], [0.5115, 0.5112],
  [0.5131, 0.5239], [0.5357, 0.5273], [0.5685, 0.4980], [0.5916, 0.4984],
  [0.6174, 0.5270], [0.6308, 0.5215], [0.6271, 0.5129], [0.6604, 0.5419],
  [0.6690, 0.5385], [0.6653, 0.5556], [0.6782, 0.5620], [0.7115, 0.5492],
  [0.7206, 0.5261], [0.7636, 0.5479], [0.7760, 0.5368], [0.7921, 0.5389],
  [0.7932, 0.5219], [0.8007, 0.5236], [0.8024, 0.5483], [0.8169, 0.5654],
  [0.8002, 0.5812], [0.8024, 0.5918], [0.7825, 0.5995], [0.7733, 0.6251],
  [0.7852, 0.6332], [0.8029, 0.6217], [0.8158, 0.6273], [0.8212, 0.6580],
  [0.8341, 0.6631],
];

// BAY_MASK at full 56×48 resolution — every cell individually point-tested.
export const BAY_MASK: boolean[][] = Array.from({ length: GRID_D }, (_, gz) =>
  Array.from({ length: GRID_W }, (_, gx) =>
    pointInPolygon((gx + 0.5) / GRID_W, (gz + 0.5) / GRID_D, BAY_POLYGON)
  )
);

// ── River voxel cells ────────────────────────────────────────────────────────
// Spines authored in 28×24 space, densified ×4 to match the 112×96 grid.
// mouthGx / mouthGz are in 112×96 coords (original × 4).

export interface RiverCell {
  gx: number;
  gz: number;      // row index; ≥ GRID_D = north rivers, < 0 = south rivers
  mouthGx: number; // bay-boundary column for value / colour sampling
  mouthGz: number; // bay-boundary row  for value / colour sampling
  riverId: string; // key into RIVER_META for hover labels
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
  riverId: string,
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
      cells.push({ gx, gz, mouthGx, mouthGz, riverId });
    }
  });
  return cells;
}

// buildRiverWest: west river — sweeps along gx (gx ≤ 0), spreads in gz.
// gx values can be 0 or negative (west of the bay boundary).
function buildRiverWest(
  spine: Array<{ gx: number; cz: number; w?: number }>,
  halfWDelta: number,
  halfWUpstream: number,
  mouthGx: number,
  mouthGz: number,
  riverId: string,
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
      cells.push({ gx, gz, mouthGx, mouthGz, riverId });
    }
  });
  return cells;
}

// ── Spine densifiers ─────────────────────────────────────────────────────────
// Authored in 28×24 space; multiply coords ×4 and fill ALL intermediate steps
// for the 112×96 grid.  Optional `w` (half-width override in 28×24 space) is
// also ×4 so the physical width is preserved at STEP=0.5.

function densifyNS(
  sparse: Array<{ gz: number; cx: number; w?: number }>,
): Array<{ gz: number; cx: number; w?: number }> {
  const SCALE = 4;
  const out: Array<{ gz: number; cx: number; w?: number }> = [];
  for (let i = 0; i < sparse.length; i++) {
    const { gz, cx, w } = sparse[i];
    out.push({ gz: gz * SCALE, cx: cx * SCALE, ...(w !== undefined ? { w: w * SCALE } : {}) });
    if (i < sparse.length - 1) {
      const next = sparse[i + 1];
      const dgz = next.gz - gz;
      const totalSteps = Math.abs(dgz) * SCALE;
      const dir = Math.sign(dgz);
      for (let s = 1; s < totalSteps; s++) {
        const t = s / totalSteps;
        const midCx = Math.round((cx + (next.cx - cx) * t) * SCALE);
        const midW = (w !== undefined && next.w !== undefined)
          ? Math.round((w + (next.w - w) * t) * SCALE) : undefined;
        out.push({
          gz: gz * SCALE + dir * s,
          cx: midCx,
          ...(midW !== undefined ? { w: midW } : {}),
        });
      }
    }
  }
  return out;
}

function densifyEW(
  sparse: Array<{ gx: number; cz: number; w?: number }>,
): Array<{ gx: number; cz: number; w?: number }> {
  const SCALE = 4;
  const out: Array<{ gx: number; cz: number; w?: number }> = [];
  for (let i = 0; i < sparse.length; i++) {
    const { gx, cz, w } = sparse[i];
    out.push({ gx: gx * SCALE, cz: cz * SCALE, ...(w !== undefined ? { w: w * SCALE } : {}) });
    if (i < sparse.length - 1) {
      const next = sparse[i + 1];
      const dgx = next.gx - gx;
      const totalSteps = Math.abs(dgx) * SCALE;
      const dir = Math.sign(dgx);
      for (let s = 1; s < totalSteps; s++) {
        const t = s / totalSteps;
        const midCz = Math.round((cz + (next.cz - cz) * t) * SCALE);
        const midW = (w !== undefined && next.w !== undefined)
          ? Math.round((w + (next.w - w) * t) * SCALE) : undefined;
        out.push({
          gx: gx * SCALE + dir * s,
          cz: midCz,
          ...(midW !== undefined ? { w: midW } : {}),
        });
      }
    }
  }
  return out;
}

// ── River spines (authored in 28×24 coords, densified to 112×96) ─────────────
// Shapes traced from SVG river paths in svgPaths.ts using the affine mapping:
//   cx  (28×24) ≈ 0.0535 × svgX + 5
//   Δgz (28×24) ≈ −ΔsvgY / 13.3   (each 13.3 SVG pixels north = +1 gz step)
//
// River 24 (oya)      → NORTH:  mild left drift,  mostly straight
// River  3 (karakuwa) → NE:     hugs right edge, slight sinusoid near boundary
// River 13 (hachiman) → SE:     consistent left drift going south
// River  7 (okawa)    → EAST:   gentle northward drift going east
// River assignment summary (bay occupies gx_112=52–99, gz_96=27–62):
// Sub-basin 2/4/9  → WEST:  cz_28=12 (gz=48), gx gap-fill at 14 (gx=56)
// Sub-basin 6      → WEST:  cz_28=8  (gz=32), gx gap-fill at 14 (gx=56)
// Sub-basin 8      → NORTH: gz_28=14 (gz=56), cx_28=23 (gx=92), extends north
// Sub-basin 10     → SOUTH: gz_28=8  (gz=32), cx_28=16 (gx=64), extends south

// ── River spines — positions derived from SVG path start coords ──────────────
// SVG canvas 465×586.  Mouth formula: gx_28 = svgX/465*28, gz_28 = (1-svgY/586)*24.
// Bay west wall sits at gx_28≈13–14 across gz_28=8–13.
// Bay top is at gz_28≈15.5, bay bottom at gz_28≈6.8.
//
// River mouths (gx_28 / gz_28 → gx_112 / gz_96):
//   sub2  R2 svgXY=224,280 → gx=13.5 gz=12.5 (112: 54, 50)
//   sub4  R4 svgXY=234,280 → gx=14.1 gz=12.5 (112: 56, 50)
//   sub6  R6 svgXY=216,382 → gx=13.0 gz= 8.4 (112: 52, 33)
//   sub8  R8 svgXY=359,217 → gx=21.6 gz=15.1 (112: 87, 61)
//   sub9  R9 svgXY=250,276 → gx=15.1 gz=12.7 (112: 60, 51)
//   sub10 R10 svgXY=256,420 → gx=15.4 gz= 6.8 (112: 62, 27)

// Sub-basin 2 (Shizugawa): west river, cz_28=12 (gz=48), gx gap-fill at 14 (gx=56).
// At gz=48 the bay west wall is gx=55 so gx=56 is the first inside cell.
// Extends west-southwest upstream.
const SPINE_RIVER2_WEST = densifyEW([
  { gx: 14, cz: 12 }, // gap-fill just inside bay (gx=56, gz=48)
  { gx: 12, cz: 12 }, { gx: 10, cz: 12 },
  { gx:  8, cz: 11 }, { gx:  6, cz: 11 },
  { gx:  4, cz: 10 }, { gx:  2, cz: 10 },
  { gx:  0, cz:  9 }, { gx: -2, cz:  9 },
  { gx: -4, cz:  8 }, { gx: -6, cz:  8 },
  { gx: -8, cz:  7 },
]);

// Sub-basin 4 (Togura): west river, cz_28=12 (gz=48), same bay entry as sub2.
// Diverges northwest upstream — mirror of sub2 but curves toward north.
const SPINE_RIVER4_WEST = densifyEW([
  { gx: 14, cz: 12 }, // gap-fill (gx=56, gz=48)
  { gx: 12, cz: 13 }, { gx: 10, cz: 14 },
  { gx:  8, cz: 15 }, { gx:  6, cz: 16 },
  { gx:  4, cz: 16 }, { gx:  2, cz: 16 },
  { gx:  0, cz: 16 }, { gx: -2, cz: 16 },
  { gx: -4, cz: 15 }, { gx: -6, cz: 14 },
]);

// Sub-basin 6 (Iriya): west river, cz_28=8 (gz=32), gx gap-fill at 14 (gx=56).
// At gz=32 the bay west wall is gx=52, so gx=56 is inside. Extends southwest.
const SPINE_RIVER6_WEST = densifyEW([
  { gx: 14, cz: 8 }, // gap-fill (gx=56, gz=32)
  { gx: 12, cz: 8 }, { gx: 10, cz: 7 },
  { gx:  8, cz: 7 }, { gx:  6, cz: 7 },
  { gx:  4, cz: 6 }, { gx:  2, cz: 6 },
  { gx:  0, cz: 5 }, { gx: -2, cz: 5 },
  { gx: -4, cz: 4 }, { gx: -6, cz: 4 },
]);

// Sub-basin 8 (Karakuwa): north river, gap-fill at gz_28=14 (gz=56) inside north arm,
// cx_28=23 (gx=92). Bay north arm gz=56–62 has gx=87–99; gx=92 is well inside.
// Extends north above the bay.
const SPINE_RIVER8_NORTH = densifyNS([
  { gz: 14, cx: 23 }, // gap-fill (gz=56, gx=92) — inside north arm
  { gz: 15, cx: 23 }, { gz: 16, cx: 23 },
  { gz: 17, cx: 22 }, { gz: 18, cx: 22 },
  { gz: 19, cx: 22 }, { gz: 20, cx: 21 },
  { gz: 21, cx: 21 }, { gz: 22, cx: 20 },
]);

// Sub-basin 9 (Oura): west river, cz_28=12 (gz=48), gx gap-fill at 14 (gx=56).
// Same bay entry as sub2/4. Diverges more northward upstream.
const SPINE_RIVER9_WEST = densifyEW([
  { gx: 14, cz: 12 }, // gap-fill (gx=56, gz=48)
  { gx: 12, cz: 13 }, { gx: 10, cz: 14 },
  { gx:  8, cz: 16 }, { gx:  6, cz: 18 },
  { gx:  4, cz: 19 }, { gx:  2, cz: 20 },
  { gx:  0, cz: 20 }, { gx: -2, cz: 20 },
  { gx: -4, cz: 20 }, { gx: -6, cz: 19 },
]);

// Sub-basin 10 (Hachiman): south river, gap-fill at gz_28=8 (gz=32), cx_28=16 (gx=64).
// At gz=32 the bay spans gx=52–94, so gx=64 is well inside. Extends south below bay.
const SPINE_RIVER10_SOUTH = densifyNS([
  { gz:  8, cx: 16 }, // gap-fill (gz=32, gx=64) — inside bay south
  { gz:  7, cx: 16 }, { gz:  6, cx: 16 },
  { gz:  5, cx: 16 }, { gz:  4, cx: 16 },
  { gz:  3, cx: 16 }, { gz:  2, cx: 16 },
  { gz:  1, cx: 16 }, { gz:  0, cx: 16 },
  { gz: -1, cx: 16 }, { gz: -2, cx: 16 },
]);

export const RIVER_CELLS: RiverCell[] = [
  // 6 active sub-basin rivers; spines authored in 28×24 space, densified ×4.
  // Mouth coords (mouthGx, mouthGz) are valid bay cells used for value sampling.
  // Sub-basin 2 (Shizugawa): west river; mouth sampling at gx=65 gz=45 (inside bay)
  ...buildRiverWest(SPINE_RIVER2_WEST, 3, 1, 65, 45,  "sub2"),
  // Sub-basin 4 (Togura):  west river; mouth at gx=65 gz=45
  ...buildRiverWest(SPINE_RIVER4_WEST, 2, 1, 65, 45,  "sub4"),
  // Sub-basin 9 (Oura):  west river; mouth at gx=65 gz=47
  ...buildRiverWest(SPINE_RIVER9_WEST, 3, 1, 65, 47,  "sub9"),
  // Sub-basin 6 (Iriya): west river; mouth at gx=65 gz=33
  ...buildRiverWest(SPINE_RIVER6_WEST, 2, 1, 65, 33,  "sub6"),
  // Sub-basin 8 (Karakuwa): north river; mouth at gx=92 gz=58 (inside north arm)
  ...buildRiver(SPINE_RIVER8_NORTH,    3, 1, 92, 58,  "sub8"),
  // Sub-basin 10 (Hachiman): south river; mouth at gx=64 gz=35 (inside bay)
  ...buildRiver(SPINE_RIVER10_SOUTH,   4, 1, 64, 35,  "sub10"),
];

// River metadata for hover labels in the 3D view.
// These mirror the river names shown in the Map viewport sidebar.
export const RIVER_META: Record<string, { name: string; subBasin: string }> = {
  sub2:  { name: "Shizugawa River", subBasin: "Sub-basin 2" },
  sub4:  { name: "Togura River",    subBasin: "Sub-basin 4" },
  sub6:  { name: "Iriya River",     subBasin: "Sub-basin 6" },
  sub8:  { name: "Karakuwa River",  subBasin: "Sub-basin 8" },
  sub9:  { name: "Oura River",      subBasin: "Sub-basin 9" },
  sub10: { name: "Hachiman River",  subBasin: "Sub-basin 10" },
};

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
