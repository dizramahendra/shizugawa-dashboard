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
/** Days per playback year. The dashboard now operates at daily granularity to
 *  mirror the SWAT outputRch dataset (2021–2023, all 365-day years). All
 *  seasonal modulators below use `day / TOTAL_DAYS` so a full revolution
 *  spans one calendar year. */
export const TOTAL_DAYS = 365;

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
// SVG canvas = 465×586 (SVG_W × SVG_H).  Raw normalisation: nx=svgX/465, nz=1−svgY/586.
// The outer polygon was simplified with Douglas-Peucker ε=3 px (311→73 vertices),
// then uniformly scaled 2.1565× and centred so the bay fills the grid:
//   new_nx = (raw_nx − 0.4631) × 2.1565 + 0.03
//   new_nz = (raw_nz − 0.2846) × 2.1565 + 0.0919
// Bay occupies gx 3–107, gz 9–86 of the 112×96 grid.
const BAY_POLYGON: [number, number][] = [
  [0.8300, 0.9081], [0.8417, 0.8298], [0.9251, 0.8419], [0.9590, 0.8005],
  [0.9182, 0.7457], [0.9182, 0.6627], [0.9560, 0.6349], [0.9277, 0.5698],
  [0.9700, 0.5342], [0.9560, 0.4999], [0.8585, 0.4822], [0.8585, 0.4466],
  [0.8878, 0.3975], [0.9336, 0.3694], [0.9336, 0.3360], [0.8538, 0.2362],
  [0.8503, 0.1618], [0.7964, 0.1518], [0.7999, 0.2042], [0.7291, 0.1592],
  [0.7013, 0.1628], [0.6838, 0.1989], [0.6480, 0.1555], [0.6120, 0.1527],
  [0.5217, 0.2062], [0.4417, 0.1952], [0.3476, 0.2420], [0.3211, 0.2236],
  [0.3047, 0.1574], [0.2804, 0.1620], [0.2394, 0.0919], [0.2208, 0.0956],
  [0.2387, 0.1676], [0.1797, 0.1896], [0.1296, 0.1712], [0.0496, 0.1814],
  [0.0300, 0.2245], [0.0589, 0.2825], [0.1505, 0.3800], [0.0984, 0.4481],
  [0.1089, 0.5253], [0.0639, 0.6023], [0.1262, 0.6097], [0.1344, 0.5805],
  [0.1378, 0.6079], [0.1866, 0.6153], [0.2573, 0.5521], [0.3071, 0.5529],
  [0.3627, 0.6146], [0.3916, 0.6028], [0.3837, 0.5842], [0.4555, 0.6467],
  [0.4740, 0.6394], [0.4660, 0.6763], [0.4939, 0.6901], [0.5657, 0.6625],
  [0.5853, 0.6127], [0.6780, 0.6597], [0.7048, 0.6357], [0.7395, 0.6403],
  [0.7418, 0.6036], [0.7580, 0.6073], [0.7617, 0.6605], [0.7930, 0.6974],
  [0.7569, 0.7315], [0.7617, 0.7544], [0.7188, 0.7710], [0.6989, 0.8262],
  [0.7246, 0.8436], [0.7628, 0.8188], [0.7906, 0.8309], [0.8022, 0.8971],
  [0.8300, 0.9081],
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
  extraSide: number = 0, // asymmetric extension on the +x side. halfW=0,
                         // extraSide=1 → 2-cell wide (dx ∈ {0,1}). Used to
                         // get even widths the symmetric band can't produce.
): RiverCell[] {
  const cells: RiverCell[] = [];
  const seen = new Set<string>();
  const n = spine.length;
  spine.forEach(({ gz, cx, w }, i) => {
    const t     = n > 1 ? i / (n - 1) : 0;
    const halfW = w !== undefined
      ? w
      : Math.round(halfWDelta + (halfWUpstream - halfWDelta) * t);
    for (let dx = -halfW; dx <= halfW + extraSide; dx++) {
      const gx = cx + dx;
      // Allow negative gx — the renderer places those cells west of the grid
      // origin, which is exactly where rivers like Oya (basin 24) live. The
      // upper-bound check still guards against runaway eastern spread.
      if (gx >= GRID_W) continue;
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
  extraSide: number = 0, // asymmetric extension on the +z side. halfW=0,
                         // extraSide=1 → 2-cell wide (dz ∈ {0,1}).
): RiverCell[] {
  const cells: RiverCell[] = [];
  const seen = new Set<string>();
  const n = spine.length;
  spine.forEach(({ gx, cz, w }, i) => {
    const t     = n > 1 ? i / (n - 1) : 0;
    const halfW = w !== undefined
      ? w
      : Math.round(halfWDelta + (halfWUpstream - halfWDelta) * t);
    for (let dz = -halfW; dz <= halfW + extraSide; dz++) {
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

// Walk a 4-connected line between two integer cells (a,b)→(c,d) along the
// longer axis, stepping the shorter axis proportionally and inserting an
// L-shaped intermediate whenever the next cell would otherwise be diagonal.
// Width is interpolated linearly. The starting cell is OMITTED (caller pushes
// it first); the ending cell IS included. Guarantees no diagonal-only jumps,
// so a halfW=0 spine renders as a continuous 1-cell line with no gaps.
function rasterLine(
  ax: number, az: number, aw: number | undefined,
  bx: number, bz: number, bw: number | undefined,
  hasW: boolean,
): Array<{ gx: number; gz: number; w?: number }> {
  const out: Array<{ gx: number; gz: number; w?: number }> = [];
  const dx = bx - ax, dz = bz - az;
  const steps = Math.max(Math.abs(dx), Math.abs(dz));
  if (steps === 0) return out;
  let prevX = ax, prevZ = az;
  for (let s = 1; s <= steps; s++) {
    const t  = s / steps;
    const nx = Math.round(ax + dx * t);
    const nz = Math.round(az + dz * t);
    const nw = hasW
      ? Math.round((aw as number) + ((bw as number) - (aw as number)) * t)
      : undefined;
    // Insert an L-step if this move would be diagonal (both axes change).
    if (nx !== prevX && nz !== prevZ) {
      out.push({ gx: nx, gz: prevZ, ...(nw !== undefined ? { w: nw } : {}) });
    }
    out.push({ gx: nx, gz: nz, ...(nw !== undefined ? { w: nw } : {}) });
    prevX = nx; prevZ = nz;
  }
  return out;
}

function densifyNS(
  sparse: Array<{ gz: number; cx: number; w?: number }>,
): Array<{ gz: number; cx: number; w?: number }> {
  const SCALE = 4;
  const out: Array<{ gz: number; cx: number; w?: number }> = [];
  if (sparse.length === 0) return out;
  // Push the first point.
  const first = sparse[0];
  out.push({
    gz: first.gz * SCALE, cx: first.cx * SCALE,
    ...(first.w !== undefined ? { w: first.w * SCALE } : {}),
  });
  for (let i = 0; i < sparse.length - 1; i++) {
    const a = sparse[i], b = sparse[i + 1];
    const hasW = a.w !== undefined && b.w !== undefined;
    const seg = rasterLine(
      a.cx * SCALE, a.gz * SCALE, hasW ? (a.w as number) * SCALE : undefined,
      b.cx * SCALE, b.gz * SCALE, hasW ? (b.w as number) * SCALE : undefined,
      hasW,
    );
    for (const p of seg) out.push({ gz: p.gz, cx: p.gx, ...(p.w !== undefined ? { w: p.w } : {}) });
  }
  return out;
}

function densifyEW(
  sparse: Array<{ gx: number; cz: number; w?: number }>,
): Array<{ gx: number; cz: number; w?: number }> {
  const SCALE = 4;
  const out: Array<{ gx: number; cz: number; w?: number }> = [];
  if (sparse.length === 0) return out;
  const first = sparse[0];
  out.push({
    gx: first.gx * SCALE, cz: first.cz * SCALE,
    ...(first.w !== undefined ? { w: first.w * SCALE } : {}),
  });
  for (let i = 0; i < sparse.length - 1; i++) {
    const a = sparse[i], b = sparse[i + 1];
    const hasW = a.w !== undefined && b.w !== undefined;
    const seg = rasterLine(
      a.gx * SCALE, a.cz * SCALE, hasW ? (a.w as number) * SCALE : undefined,
      b.gx * SCALE, b.cz * SCALE, hasW ? (b.w as number) * SCALE : undefined,
      hasW,
    );
    for (const p of seg) out.push({ gx: p.gx, cz: p.gz, ...(p.w !== undefined ? { w: p.w } : {}) });
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
// River assignment summary (scaled bay: gx_112=3–107, gz_96=9–86):
// Sub-basin 2/4/9  → WEST:  cz_28=13 (gz=52), gx gap-fill at 5 (gx=20)
// Sub-basin 6      → WEST:  cz_28=6  (gz=24), gx gap-fill at 5 (gx=20)
// Sub-basin 8      → NORTH: gz_28=20 (gz=80), cx_28=20 (gx=80), extends NW
// Sub-basin 10     → SOUTH: gz_28=3  (gz=12), cx_28=6  (gx=24), runs SW

// ── River spines — positions derived from SVG path start coords ──────────────
// Bay polygon scaled 2.1565× uniformly from SVG-traced shape.
// West wall at gz=52 is gx≈9 (gx_28=2.3); gap-fills start at gx_28=5 (gx=20).
// North arm NW corner at gz=80 ≈ gx=79–80; sub8 enters there (cx_28=20, gx=80).

// Shizugawa watershed — the SVG draws this as THREE separate river paths
// chained head-to-tail. We expose each as its own labeled segment in 3D so
// hovering reveals the actual sub-basin the cell belongs to.
//
// SVG river 2 (Shizugawa, basin 2) — mouth segment from bay edge inland.
//   (224.314, 280.386) → (190.4, 267.478) ≈ (cx=2, gz=14) → (cx=-2, gz=16)
const SPINE_RIVER2_MOUTH = densifyEW([
  { gx:  5, cz: 13 }, // gap-fill inside bay (gx=20, gz=52)
  { gx:  3, cz: 13 },
  { gx:  1, cz: 14 },
  { gx: -1, cz: 15 },
  { gx: -3, cz: 16 }, // SVG endpoint — junction with river 5 (and fork river 16)
]);

// SVG river 5 (Urashiro, basin 5) — middle segment.
//   (190.4, 267.478) → (131.936, 264.188) ≈ (cx=-2, gz=16) → (cx=-10, gz=16)
const SPINE_RIVER5_URASHIRO = densifyEW([
  { gx: -3, cz: 16 }, // junction with river 2 (and fork river 16)
  { gx: -5, cz: 16 },
  { gx: -7, cz: 16 },
  { gx: -9, cz: 16 },
  { gx:-11, cz: 16 }, // SVG endpoint — junction with river 1 (and fork river 15)
]);

// SVG river 1 (basin 1, "Shizugawa Upper") — headwater segment.
//   (131.936, 264.188) → (89.6702, 254.57) ≈ (cx=-10, gz=16) → (cx=-17, gz=17)
const SPINE_RIVER1_HEAD = densifyEW([
  { gx:-11, cz: 16 }, // junction with river 5 (and fork river 15)
  { gx:-13, cz: 16 },
  { gx:-15, cz: 17 },
  { gx:-17, cz: 17 }, // SVG endpoint (89.6702, 254.57)
]);

// Sub-basin 4 (Togura): mainstem traced from SVG river 4 path key waypoints:
//   (234.184, 279.625) ≈ (cx=3,  gz=15) — mouth area
//   (235.703, 269.501) ≈ (cx=4,  gz=15)
//   (232.665, 261.909) ≈ (cx=3,  gz=16)
//   (228.11,  250.52)  ≈ (cx=3,  gz=17)
//   (223.048, 245.458) ≈ (cx=2,  gz=18)
//   (219.505, 238.624) ≈ (cx=1,  gz=18)
//   (212.925, 226.729) ≈ (cx=1,  gz=19)
//   (204.066, 223.439) ≈ (cx=-1, gz=20)
//   (187.109, 215.34)  ≈ (cx=-3, gz=20)
//   (180.023, 206.229) ≈ (cx=-4, gz=21) ← endpoint, junction with rivers 7 & 24
const SPINE_RIVER4_WEST = densifyEW([
  { gx:  6, cz: 13 }, // gap-fill inside bay (gx=24, gz=52)
  { gx:  4, cz: 14 },
  { gx:  3, cz: 15 }, // SVG mouth (234.184, 279.625)
  { gx:  3, cz: 16 },
  { gx:  3, cz: 17 },
  { gx:  2, cz: 18 },
  { gx:  1, cz: 18 },
  { gx:  1, cz: 19 },
  { gx: -1, cz: 20 },
  { gx: -3, cz: 20 },
  { gx: -4, cz: 21 }, // SVG endpoint — junction with rivers 7 (Okawa) & 24 (Oya)
]);

// Sub-basin 24 (Oya): north tributary, traced from SVG river 24 waypoints.
// Diverges off the Togura SVG endpoint (180.023, 206.229) ≈ (cx=-4, gz=21),
// runs mostly straight north along cx=-4 to about (cx=-4, gz=24), then jogs
// slightly NW through (cx=-5, gz=26) → (cx=-5, gz=28) and ends at the SVG
// terminus (157.751, 108.561) ≈ (cx=-7, gz=30).
//   (180.023, 197.266) ≈ (cx=-4, gz=22)
//   (180.023, 176.933) ≈ (cx=-4, gz=24)
//   (174.961, 158.749) ≈ (cx=-4, gz=25)
//   (170.152, 152.473) ≈ (cx=-5, gz=26)
//   (171.671, 137.563) ≈ (cx=-5, gz=28)
//   (166.609, 128.636) ≈ (cx=-5, gz=28)
//   (161.099, 111.052) ≈ (cx=-6, gz=29)
//   (157.751, 108.561) ≈ (cx=-7, gz=30) ← endpoint
const SPINE_RIVER24_NORTH = densifyNS([
  { gz: 21, cx: -4 }, // junction with Togura (SVG 180.023, 206.229)
  { gz: 22, cx: -4 },
  { gz: 23, cx: -4 },
  { gz: 24, cx: -4 },
  { gz: 25, cx: -4 },
  { gz: 26, cx: -5 },
  { gz: 27, cx: -5 },
  { gz: 28, cx: -5 },
  { gz: 29, cx: -6 },
  { gz: 30, cx: -7 }, // SVG endpoint (157.751, 108.561)
]);

// Sub-basin 13 (Hachiman/Mizujiri): SW fork off the river-6 (Iriya) terminus.
// SVG path id="river 13" branches from the junction (187.616, 380.355)
// ≈ (cx=-2, gz=6) and runs SW through key SVG waypoints down to the
// endpoint (139.023, 440.085) ≈ (cx=-9, gz=0):
//   (181.644, 386.825) ≈ (cx=-3, gz=5)
//   (175.214, 394.348) ≈ (cx=-4, gz=5)
//   (170.2,   408.693) ≈ (cx=-5, gz=3)
//   (159.811, 417.057) ≈ (cx=-6, gz=2)
//   (151.394, 423.917) ≈ (cx=-7, gz=2)
//   (145.94,  429.334) ≈ (cx=-8, gz=1)
//   (139.023, 440.085) ≈ (cx=-9, gz=0)  ← endpoint
// NOTE: spine is authored in {gx, cz} (EW form) and rendered with
// buildRiverWest because every cell sits west of the bay (gx ≤ 0). The
// alternative buildRiver helper would clip negative-gx cells and the river
// would not render in 3D at all.
const SPINE_RIVER13_SW = densifyEW([
  { gx: -2, cz:  6 }, // junction with river 6 (Iriya)
  { gx: -3, cz:  5 },
  { gx: -4, cz:  5 },
  { gx: -5, cz:  4 },
  { gx: -5, cz:  3 },
  { gx: -6, cz:  2 },
  { gx: -7, cz:  2 },
  { gx: -8, cz:  1 },
  { gx: -9, cz:  0 }, // SVG endpoint
]);

// (Sub-basin 3 spine removed — not connected to the ocean basin in the
//  surveyed river network.)

// ── Upstream tributary FORKS — each traced from a real SVG river path ───────
// Every fork carries its own canonical mapview river ID (matches the slug in
// the RIVERS registry below) so it labels independently on hover and can be
// deep-linked from the Map view.
//
// The control points below are the start/key/end points of the corresponding
// "river N" SVG path in svgPaths.ts, projected through the affine transform:
//   cx_28 = ((svgX/465 - 0.4631) × 2.1565 + 0.03) × 28
//   gz_28 = ((1 - svgY/586 - 0.2846) × 2.1565 + 0.0919) × 24
// Mouth (mouthGx/mouthGz) for each fork is set to the parent mainstem's
// bay-edge cell so values are sampled from the river system's true outlet.

// SVG river 7 (Okawa, basin 7) — diverges off the Togura SVG endpoint at
// (180.023, 206.229) ≈ (cx=-4, gz=21) and runs WNW along key SVG waypoints:
//   (138.102, 192.818) ≈ (cx=-9, gz=22)
//   (97.516,  167)     ≈ (cx=-14, gz=25)
//   (67.904,  165.988) ≈ (cx=-18, gz=25)  ← endpoint
const SPINE_RIVER7_OKAWA = densifyEW([
  { gx: -4, cz: 21 }, // Togura junction (matches SVG 180.023, 206.229)
  { gx: -6, cz: 21 },
  { gx: -9, cz: 22 },
  { gx:-12, cz: 23 },
  { gx:-14, cz: 25 },
  { gx:-16, cz: 25 },
  { gx:-18, cz: 25 }, // SVG endpoint (67.904, 165.988)
]);

// SVG river 14 (Motoyoshi, basin 14) — west fork off the river-6 (Iriya)
// terminus at SVG (187.616, 380.355) ≈ (cx=-2, gz=6). Path runs WNW through:
//   (172.058, 382.122) ≈ (cx=-5, gz=6)
//   (165.344, 379.596) ≈ (cx=-6, gz=6)
//   (157.325, 381.541) ≈ (cx=-7, gz=6)
//   (144.902, 389.989) ≈ (cx=-8, gz=5)
//   (138.516, 392.251) ≈ (cx=-9, gz=5)  ← endpoint
const SPINE_RIVER14_MOTOYOSHI = densifyEW([
  { gx: -2, cz:  6 }, // junction with river 6 (Iriya)
  { gx: -4, cz:  6 },
  { gx: -5, cz:  6 },
  { gx: -6, cz:  6 },
  { gx: -7, cz:  6 },
  { gx: -8, cz:  5 },
  { gx: -9, cz:  5 }, // SVG endpoint
]);

// SVG river 17 (Sakura, basin 17) — short tributary off the Oura headwater at
// SVG (255.443, 235.083) ≈ (cx=6, gz=18) → (260.505, 231.792) ≈ (cx=7, gz=19).
const SPINE_RIVER17_SAKURA = densifyEW([
  { gx:  6, cz: 18 }, // junction
  { gx:  7, cz: 19 }, // SVG endpoint
]);

// SVG river 18 (Oritate, basin 18) — short NW tributary off the same Oura
// headwater (255.444, 235.083) → (243.548, 223.188) ≈ (cx=5, gz=20).
const SPINE_RIVER18_ORITATE = densifyEW([
  { gx:  6, cz: 18 }, // junction
  { gx:  5, cz: 19 },
  { gx:  5, cz: 20 }, // SVG endpoint
]);

// SVG river 20 (Moriya, basin 20) — short tributary near Niida at
// SVG (389.075, 196.613) ≈ (cx=23, gz=22) → (390.34, 188.261) ≈ (cx=24, gz=23).
const SPINE_RIVER20_MORIYA = densifyNS([
  { gz: 22, cx: 23 }, // junction near Niida (sub8) headwater
  { gz: 23, cx: 24 }, // SVG endpoint
]);

// SVG river 15 (Onagawa, basin 15) — long SW fork off the Shizugawa mainstem
// at the river-1/river-5 junction SVG (131.936, 264.188) ≈ (cx=-10, gz=16),
// running SW down to (70.6885, 340.874) ≈ (cx=-18, gz=9).
const SPINE_RIVER15_ONAGAWA = densifyEW([
  { gx:-11, cz: 16 }, // junction with Shizugawa mainstem
  { gx:-13, cz: 14 },
  { gx:-15, cz: 12 },
  { gx:-17, cz: 10 },
  { gx:-18, cz:  9 }, // SVG endpoint (70.6885, 340.874)
]);

// SVG river 16 (Mitobe, basin 16) — short SSW fork off the Shizugawa mainstem
// at the river-2/river-5 junction SVG (190.4, 267.478) ≈ (cx=-2, gz=16),
// running SSW down to (164.585, 288.991) ≈ (cx=-6, gz=14).
const SPINE_RIVER16_MITOBE = densifyEW([
  { gx: -3, cz: 16 }, // junction with Shizugawa mainstem
  { gx: -5, cz: 15 },
  { gx: -6, cz: 14 }, // SVG endpoint (164.585, 288.991)
]);

// SVG river 12 (Shishiori, basin 12) — short southward stub forking off the
// Karakuwa (River 10) mainstem. The SVG path zigzags between x≈256–259 and
// y≈420–441, but every x value rounds to cx=6, so the trace is a vertical
// 3-cell line. The northern end (cx=6, gz=2) is the SVG start point
// (255.697, 419.584) — which is *also* River 10's SVG starting waypoint, so
// the two rivers share this cell as their fork junction. Endpoint at
// (258.734, 440.59) ≈ (cx=6, gz=0). The previous trace incorrectly extended
// one cell north to gz=3, which is River 10's bay gap-fill cell, not part of
// this river's SVG path.
const SPINE_RIVER12_SHISHIORI = densifyNS([
  { gz:  2, cx:  6 }, // SVG start (255.697, 419.584) — fork junction with River 10
  { gz:  1, cx:  6 }, // SVG zigzag waypoints (256.962, 428.948)..(256.962, 437.047)
  { gz:  0, cx:  6 }, // SVG endpoint (258.734, 440.59)
]);

// Sub-basin 6 (Iriya): SVG path id="river 6" runs east → west from
//   (215.962, 381.874) ≈ (cx=1, gz=6)  ← bay-edge mouth
// to
//   (187.616, 380.355) ≈ (cx=-2, gz=6) ← junction with rivers 13 & 14
// All waypoints sit on row gz=6, with the mouth one column inside the bay
// west wall (cx=5 at gz=6) — i.e. the line is the inland river segment.
const SPINE_RIVER6_WEST = densifyEW([
  { gx:  5, cz: 6 }, // gap-fill at bay west wall (cx=5, gz=6)
  { gx:  3, cz: 6 },
  { gx:  1, cz: 6 }, // SVG mouth (215.962, 381.874)
  { gx:  0, cz: 6 },
  { gx: -2, cz: 6 }, // junction with rivers 13 & 14 (SVG 187.616, 380.355)
]);

// Sub-basin 8 (Karakuwa): north river — spine traced from SVG RIVER_PATHS[8].
// Affine transform (SVG 465×586, scale 2.1565×):
//   nx=(svgX/465−0.4631)×2.1565+0.03, nz=(1−svgY/586−0.2846)×2.1565+0.0919
//   gx=nx×112, gz=nz×96; to 28-space: cx_28=gx÷4, gz_28=gz÷4.
// Mouth (359.463, 216.606) → gx=80, gz=80 → gz_28=20, cx_28=20.
// Path goes NW: (350,209)→gx=73,gz=83; (332,201)→gx=64,gz=86; (324,176)→gx=60,gz=94.
const SPINE_RIVER8_NORTH = densifyNS([
  { gz: 20, cx: 20 }, // gap-fill (gz=80, gx=80) — NW corner of north arm
  { gz: 21, cx: 18 }, // (gz=84, gx=72)
  { gz: 22, cx: 16 }, // (gz=88, gx=64)
  { gz: 23, cx: 15 }, // source (gz=92, gx=60)
]);

// Sub-basin 9 (Oura): short west river traced from SVG river 9 path:
//   (250.382, 276.083) → (252.913, 267.644) → (250.382, 260.067)
//   → (249.309, 254.41) → (248.61, 244.893) → (255.444, 235.083)
// In 28-coords: (cx=5, gz=15) → (cx=6, gz=16) → (cx=5, gz=16)
//   → (cx=5, gz=17) → (cx=5, gz=18) → (cx=6, gz=18) [endpoint = junction
// where SVG rivers 17 (Sakura) and 18 (Oritate) BOTH branch off].
const SPINE_RIVER9_WEST = densifyEW([
  { gx:  6, cz: 13 }, // gap-fill (gx=24, gz=52) inside bay
  { gx:  5, cz: 14 },
  { gx:  5, cz: 15 }, // SVG mouth (250.382, 276.083)
  { gx:  5, cz: 16 },
  { gx:  5, cz: 17 },
  { gx:  6, cz: 18 }, // SVG endpoint — junction with rivers 17 & 18
]);

// Sub-basin 10 (Hachiman): south river — spine traced from SVG RIVER_PATHS[10].
// Affine transform (SVG 465×586, scale 2.1565×) applied to key waypoints:
//   Mouth (255.697, 419.584) → gx=24, gz=9 (south bay edge).
//   Gap-fill at gz_28=3 (gz=12, gx=24) — first cell safely inside bay.
//   Path runs SW: (251,426)→gx=22,gz=6; (237,441)→gx=15,gz=1;
//   (228,446)→gx=10,gz=-1; (212,461)→gx=2,gz=-6; (203,474)→gx=-3,gz=-11;
//   source (170,539)→gx=-20,gz=-34. Cells with gx<0 are clipped by buildRiver.
const SPINE_RIVER10_SOUTH = densifyNS([
  { gz:  3, cx:  6 }, // gap-fill (gz=12, gx=24) — inside bay south
  { gz:  2, cx:  6 }, // (gz=8, gx=24) — south bay boundary
  { gz:  1, cx:  5 }, // (gz=4, gx=19)
  { gz:  0, cx:  3 }, // (gz=0, gx=12)
  { gz: -1, cx:  1 }, // (gz=-4, gx=5)
  { gz: -2, cx:  0 }, // (gz=-8, gx=1)
  { gz: -3, cx: -1 }, // (gz=-12, gx=-4)
  { gz: -4, cx: -1 }, // (gz=-16, gx=-4) — eastern jog matches SVG
  { gz: -5, cx: -2 }, // (gz=-20, gx=-8)
  { gz: -6, cx: -3 }, // (gz=-24, gx=-12)
  { gz: -7, cx: -4 }, // (gz=-28, gx=-16)
  { gz: -8, cx: -4 }, // (gz=-32, gx=-16) — source area
]);

export const RIVER_CELLS: RiverCell[] = [
  // ── Mainstems ────────────────────────────────────────────────────────────
  // Each riverId is a canonical slug from the mapview RIVERS registry below.
  // Mouth coords (mouthGx, mouthGz) are valid bay cells used for value sampling.
  // Shizugawa watershed — three SVG-distinct segments chained head-to-tail
  // Width = 2 cells (halfWDelta=0 + extraSide=1 → dx/dz ∈ {0,1}).
  // Symmetric `halfWDelta` only produces odd widths (1,3,5,…); the
  // `extraSide` arg adds an asymmetric +1 offset to make even widths possible.
  // For 1-cell hairline (option 1), drop extraSide back to 0.
  // For 3-cell chunky (option 2), set halfWDelta=1, extraSide=0.
  // Slug on each spine matches the map's MODEL_RIVER lookup so that the river
  // labelled "X" in 3D is drawn at the same geographic position as basin X on
  // the SVG mapview. Only the slug arg is touched — every spine's geometry,
  // mouth coords and width parameters are unchanged.
  ...buildRiverWest(SPINE_RIVER2_MOUTH,    0, 0, 32, 48, "oura", 1),          // basin 2  (river 2 SVG)
  ...buildRiverWest(SPINE_RIVER5_URASHIRO, 0, 0, 32, 48, "urashiro", 1),      // basin 5  (river 5 SVG)
  ...buildRiverWest(SPINE_RIVER1_HEAD,     0, 0, 32, 48, "shizugawa", 1),     // basin 1  (river 1 SVG)
  ...buildRiverWest(SPINE_RIVER4_WEST, 0, 0, 32, 48,  "togura", 1),    // basin 4
  ...buildRiverWest(SPINE_RIVER9_WEST, 0, 0, 32, 50,  "karakuwa2", 1), // basin 9
  ...buildRiverWest(SPINE_RIVER6_WEST, 0, 0, 32, 22,  "iriya", 1),     // basin 6
  ...buildRiver(SPINE_RIVER8_NORTH,    0, 0, 80, 80,  "niida", 1),     // basin 8
  ...buildRiver(SPINE_RIVER10_SOUTH,   0, 0, 24, 12,  "tomaya", 1),    // basin 10
  ...buildRiver(SPINE_RIVER24_NORTH,   0, 0, 32, 48,  "oya", 1),       // basin 24 (all-negative cx — buildRiver no longer clips them)
  ...buildRiverWest(SPINE_RIVER13_SW,  0, 0, 24, 12,  "hachiman", 1),  // basin 13

  // ── SVG-traced tributary forks ───────────────────────────────────────────
  // Each fork has its own mapview riverId; its mouth is the parent
  // mainstem's bay-edge cell so values are sampled from the true outlet.
  ...buildRiverWest(SPINE_RIVER7_OKAWA,        0, 0, 32, 48, "okawa", 1),     // basin 7,  off togura
  ...buildRiverWest(SPINE_RIVER14_MOTOYOSHI,   0, 0, 24, 12, "motoyoshi", 1), // basin 14, off hachiman
  ...buildRiverWest(SPINE_RIVER17_SAKURA,      0, 0, 32, 50, "oritate", 1),   // basin 17, off oura
  ...buildRiverWest(SPINE_RIVER18_ORITATE,     0, 0, 32, 50, "kitakami", 1),  // basin 18, off oura
  ...buildRiver(SPINE_RIVER20_MORIYA,          0, 0, 80, 80, "moriya", 1),    // basin 20, off niida
  ...buildRiver(SPINE_RIVER12_SHISHIORI,       0, 0, 24, 12, "onagawa", 1),   // basin 12, off karakuwa2
  ...buildRiverWest(SPINE_RIVER15_ONAGAWA,     0, 0, 32, 48, "mitobe", 1),    // basin 15, off shizugawa
  ...buildRiverWest(SPINE_RIVER16_MITOBE,      0, 0, 32, 48, "sakura", 1),    // basin 16, off shizugawa
]
  // Drop any river cell that falls inside the bay polygon. Without this,
  // mouth gap-fill points + lateral half-widths spill several cells past the
  // coastline (e.g. iriya, shizugawa, togura, oura), producing river voxels
  // floating on top of ocean voxels. After clipping, each river's outermost
  // remaining cell sits on the land tile directly adjacent to the bay edge,
  // so the visual "river meets bay" continuity is preserved.
  .filter(c => !(c.gz >= 0 && c.gz < GRID_D && c.gx >= 0 && c.gx < GRID_W && BAY_MASK[c.gz][c.gx]));

// River metadata for hover labels in the 3D view.
// Keys MUST match the riverId slugs assigned in RIVER_CELLS above and the
// canonical RIVERS registry so the 3D view labels each river the same way the
// Map view does.
export const RIVER_META: Record<string, { name: string; subBasin: string }> = {
  // Mainstems
  shizugawa: { name: "Shizugawa",       subBasin: "Sub-basin 1"  },
  oura:      { name: "Oura",            subBasin: "Sub-basin 2"  },
  togura:    { name: "Togura",          subBasin: "Sub-basin 4"  },
  urashiro:  { name: "Urashiro",        subBasin: "Sub-basin 5"  },
  iriya:     { name: "Iriya",           subBasin: "Sub-basin 6"  },
  niida:     { name: "Niida",           subBasin: "Sub-basin 8"  },
  karakuwa2: { name: "Karakuwa East",   subBasin: "Sub-basin 9"  },
  tomaya:    { name: "Tomaya",          subBasin: "Sub-basin 10" },
  hachiman:  { name: "Hachiman",        subBasin: "Sub-basin 13" },
  oya:       { name: "Oya",             subBasin: "Sub-basin 24" },
  // SVG-traced tributary forks
  okawa:     { name: "Okawa",           subBasin: "Sub-basin 7"  },
  onagawa:   { name: "Onagawa",         subBasin: "Sub-basin 12" },
  motoyoshi: { name: "Motoyoshi",       subBasin: "Sub-basin 14" },
  mitobe:    { name: "Mitobe",          subBasin: "Sub-basin 15" },
  sakura:    { name: "Sakura",          subBasin: "Sub-basin 16" },
  oritate:   { name: "Oritate",         subBasin: "Sub-basin 17" },
  kitakami:  { name: "Kitakami",        subBasin: "Sub-basin 18" },
  moriya:    { name: "Moriya",          subBasin: "Sub-basin 20" },
};

// ── Sub-basin metadata + steady-state indicator values ──────────────────────
//
// The Sub-basin tab compares 1–25 sub-basins on five primary indicators:
//   forestC   — Forest carbon stock           (t C/ha)
//   soilC     — Soil organic carbon stock     (t C/ha)
//   nitrogen  — Total nitrogen export rate    (kg/ha/yr)
//   phosphorus— Total phosphorus export rate  (kg/ha/yr)
//   waterFlow — Mean discharge at outlet      (m³/s)
//
// All four land indicators are now expressed per hectare so the same y-axis
// envelope means the same thing across basins of different sizes.  The
// comparison reference is *not* a fixed scientific health threshold; it is
// the **regional baseline average** computed across all 25 sub-basins (see
// `SUB_BASIN_BASELINE_AVG` below).  This shifts the view from "are we
// healthy?" to "are we above or below the regional norm?", which is what
// the Sub-basin tab is for.
//
// Values are simulated steady-state annual means (no time dimension) and
// deterministic.  Sanity rules: urban basins ⇒ 0 forestC; agricultural
// basins ⇒ highest soilC and the highest N + P export rates.
export type SubBasinLandUse =
  | "forest"
  | "agricultural"
  | "mixed"
  | "urban"
  | "coastal";

export interface SubBasinIndicators {
  forestC:    number; // t C/ha    (stock)
  soilC:      number; // t C/ha    (stock)
  nitrogen:   number; // kg/ha/yr  (export rate)
  phosphorus: number; // kg/ha/yr  (export rate)
  waterFlow:  number; // m³/s      (mean discharge)
}

export interface SubBasinMeta {
  id:         number;
  name:       string;
  area_ha:    number;
  elevation:  number;       // mean elevation, m above sea level
  landUse:    SubBasinLandUse;
  indicators: SubBasinIndicators;
}

export type SubBasinIndicatorId = keyof SubBasinIndicators;

export interface SubBasinIndicatorDef {
  id:        SubBasinIndicatorId;
  label:     string;
  shortLabel:string;
  unit:      string;        // per-basin unit (per-area density / rate)
  totalUnit: string;        // unit shown in the Aggregate view
  /**
   * additive=true means values can be summed across basins directly
   * (currently: water flow m³/s).
   * additive=false means the value is a per-area density and must be
   * area-weighted to produce an aggregate (forest C t/ha → total t,
   * N kg/ha/yr → total kg/yr, etc).
   */
  additive:  boolean;
  decimals:  number;        // decimals shown in per-basin display
}

export const SUB_BASIN_INDICATORS: SubBasinIndicatorDef[] = [
  { id: "forestC",    label: "Forest Carbon Stock", shortLabel: "Forest C",   unit: "t/ha",     totalUnit: "t",     additive: false, decimals: 1 },
  { id: "soilC",      label: "Soil Organic C",      shortLabel: "Soil C",     unit: "t/ha",     totalUnit: "t",     additive: false, decimals: 1 },
  { id: "nitrogen",   label: "Nitrogen Export",     shortLabel: "Nitrogen",   unit: "kg/ha/yr", totalUnit: "kg/yr", additive: false, decimals: 1 },
  { id: "phosphorus", label: "Phosphorus Export",   shortLabel: "Phosphorus", unit: "kg/ha/yr", totalUnit: "kg/yr", additive: false, decimals: 2 },
  { id: "waterFlow",  label: "Water Flow",          shortLabel: "Water Flow", unit: "m³/s",     totalUnit: "m³/s",  additive: true,  decimals: 1 },
];

// 25-color categorical palette used to colour each selected sub-basin
// consistently across the map polygon, the chip strip, and every chart bar.
export const SUB_BASIN_COLORS: string[] = [
  "#3b82f6","#ef4444","#10b981","#f59e0b","#8b5cf6",
  "#ec4899","#14b8a6","#f97316","#6366f1","#84cc16",
  "#06b6d4","#d946ef","#22c55e","#eab308","#a855f7",
  "#0ea5e9","#f43f5e","#65a30d","#fb923c","#7c3aed",
  "#0891b2","#be123c","#15803d","#b45309","#581c87",
];

// ─── Sub-basin records (1..25) ───────────────────────────────────────────────
// Names follow RIVER_META where present; numbered "Sub-basin N" elsewhere.
// Land-use rotation is hand-tuned so the radar / bar charts reveal a varied
// envelope (forested upland → high forestC, agricultural → high soilC + N/P,
// urban / coastal → 0 forestC + elevated N/P).
type SubBasinSeed = {
  id:        number;
  name:      string;
  area_ha:   number;
  elevation: number;
  landUse:   SubBasinLandUse;
};

const SUB_BASIN_SEEDS: SubBasinSeed[] = [
  { id:  1, name: "Shizugawa",      area_ha: 1840, elevation: 145, landUse: "forest"       },
  { id:  2, name: "Oura",           area_ha:  920, elevation:  98, landUse: "mixed"        },
  { id:  3, name: "Kamaishi Inlet", area_ha:  410, elevation:  18, landUse: "coastal"      },
  { id:  4, name: "Togura",         area_ha: 2240, elevation: 220, landUse: "forest"       },
  { id:  5, name: "Urashiro",       area_ha: 1560, elevation: 175, landUse: "forest"       },
  { id:  6, name: "Iriya",          area_ha:  680, elevation: 112, landUse: "mixed"        },
  { id:  7, name: "Okawa",          area_ha: 1320, elevation:  88, landUse: "agricultural" },
  { id:  8, name: "Niida",          area_ha: 1480, elevation: 134, landUse: "mixed"        },
  { id:  9, name: "Karakuwa East",  area_ha:  790, elevation:  62, landUse: "coastal"      },
  { id: 10, name: "Tomaya",         area_ha: 1110, elevation: 156, landUse: "forest"       },
  { id: 11, name: "Shishiori",      area_ha:  540, elevation:  44, landUse: "urban"        },
  { id: 12, name: "Onagawa",        area_ha:  860, elevation:  76, landUse: "mixed"        },
  { id: 13, name: "Hachiman",       area_ha: 1690, elevation: 168, landUse: "forest"       },
  { id: 14, name: "Motoyoshi",      area_ha: 1240, elevation:  92, landUse: "agricultural" },
  { id: 15, name: "Mitobe",         area_ha:  720, elevation: 124, landUse: "forest"       },
  { id: 16, name: "Sakura",         area_ha: 1080, elevation: 108, landUse: "mixed"        },
  { id: 17, name: "Oritate",        area_ha:  640, elevation:  84, landUse: "agricultural" },
  { id: 18, name: "Kitakami",       area_ha: 2480, elevation: 196, landUse: "forest"       },
  { id: 19, name: "Sub-basin 19",   area_ha:  380, elevation:  56, landUse: "urban"        },
  { id: 20, name: "Moriya",         area_ha: 1410, elevation: 142, landUse: "forest"       },
  { id: 21, name: "Sub-basin 21",   area_ha:  590, elevation:  68, landUse: "agricultural" },
  { id: 22, name: "Sub-basin 22",   area_ha:  830, elevation:  94, landUse: "mixed"        },
  { id: 23, name: "Sub-basin 23",   area_ha:  470, elevation:  38, landUse: "coastal"      },
  { id: 24, name: "Oya",            area_ha:  990, elevation: 118, landUse: "mixed"        },
  { id: 25, name: "Kamaishi Upper", area_ha: 1350, elevation: 158, landUse: "forest"       },
];

// Tiny seeded PRNG so per-basin jitter is deterministic
function _sbHash(id: number, salt: number): number {
  let h = (id * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function _indicatorsFor(seed: SubBasinSeed): SubBasinIndicators {
  const j = (salt: number, lo: number, hi: number) =>
    lo + _sbHash(seed.id, salt) * (hi - lo);

  // Per-land-use ranges in the new units, tuned to realistic per-area values
  // for a temperate Japanese coastal watershed.  Sanity rules: urban ⇒ 0
  // forest C; agricultural ⇒ highest soil C + highest N/P export rates.
  //
  //   forestC     t C/ha      (carbon stock in standing biomass)
  //   soilC       t C/ha      (organic carbon stock in topsoil)
  //   nitrogen    kg/ha/yr    (annual export rate)
  //   phosphorus  kg/ha/yr    (annual export rate)
  let forestC = 0, soilC = 0, nitrogen = 0, phosphorus = 0;
  switch (seed.landUse) {
    case "forest":
      forestC    = j(1, 80,  160);
      soilC      = j(2, 60,  110);
      nitrogen   = j(3,  1.5,  5);
      phosphorus = j(4,  0.10, 0.30);
      break;
    case "agricultural":
      forestC    = j(1, 10,   30);
      soilC      = j(2, 90,  170);
      nitrogen   = j(3, 14,   28);
      phosphorus = j(4,  0.80, 1.80);
      break;
    case "mixed":
      forestC    = j(1, 35,   75);
      soilC      = j(2, 55,   95);
      nitrogen   = j(3,  6,   12);
      phosphorus = j(4,  0.30, 0.80);
      break;
    case "urban":
      forestC    = 0;                       // sanity: no forest pixels → 0
      soilC      = j(2, 25,   55);
      nitrogen   = j(3, 10,   20);
      phosphorus = j(4,  0.60, 1.40);
      break;
    case "coastal":
      forestC    = j(1,  8,   25);
      soilC      = j(2, 35,   70);
      nitrogen   = j(3,  3,    9);
      phosphorus = j(4,  0.25, 0.75);
      break;
  }

  // Water flow scales with catchment area + a small jitter
  const flowBase  = (seed.area_ha / 25);  // ≈ 16–100 m³/s for 400–2500 ha
  const waterFlow = flowBase + j(5, -8, 14);

  return {
    forestC:    +forestC.toFixed(1),
    soilC:      +soilC.toFixed(1),
    nitrogen:   +nitrogen.toFixed(1),
    phosphorus: +phosphorus.toFixed(2),
    waterFlow:  +waterFlow.toFixed(1),
  };
}

export const SUB_BASIN_META: SubBasinMeta[] = SUB_BASIN_SEEDS.map(s => ({
  ...s,
  indicators: _indicatorsFor(s),
}));

export function getSubBasin(id: number): SubBasinMeta | undefined {
  return SUB_BASIN_META.find(b => b.id === id);
}

/**
 * Regional baseline = simple arithmetic mean of each indicator across all 25
 * sub-basins.  Used as the dashed reference line on every comparison chart
 * so users can read each basin as "above / below the regional norm".
 *
 * Note: simple mean (not area-weighted) so the line represents "the typical
 * sub-basin" — a planning benchmark, not a regional total proxy.
 */
export const SUB_BASIN_BASELINE_AVG: Record<SubBasinIndicatorId, number> = (() => {
  const sums = { forestC: 0, soilC: 0, nitrogen: 0, phosphorus: 0, waterFlow: 0 };
  for (const b of SUB_BASIN_META) {
    sums.forestC    += b.indicators.forestC;
    sums.soilC      += b.indicators.soilC;
    sums.nitrogen   += b.indicators.nitrogen;
    sums.phosphorus += b.indicators.phosphorus;
    sums.waterFlow  += b.indicators.waterFlow;
  }
  const n = SUB_BASIN_META.length;
  return {
    forestC:    sums.forestC    / n,
    soilC:      sums.soilC      / n,
    nitrogen:   sums.nitrogen   / n,
    phosphorus: sums.phosphorus / n,
    waterFlow:  sums.waterFlow  / n,
  };
})();

// ─── Decarbonization measures (land-side) ────────────────────────────────────
//
// Aggregate-only: applied uniformly to every selected sub-basin to answer
// "if we apply this measure across the selection, what's the regional
// impact?"  Coefficients are *simulated* multiplicative effects (1.0 = no
// change) tuned from the watershed-management literature; swap with
// calibrated values when the user delivers them.
export type SubBasinMeasureId =
  | "none"
  | "afforestation"
  | "riparian_buffer"
  | "agri_bmp"
  | "wetland"
  | "no_till"
  | "reduce_np";

export interface SubBasinMeasure {
  id:          SubBasinMeasureId;
  label:       string;
  shortLabel:  string;
  description: string;
  /** Multiplier per indicator; missing keys default to 1.0 (no change). */
  effect: Partial<Record<SubBasinIndicatorId, number>>;
}

export const SUB_BASIN_MEASURES: SubBasinMeasure[] = [
  {
    id: "none",
    label: "No measure (baseline)",
    shortLabel: "Baseline",
    description: "Current conditions, no intervention applied.",
    effect: {},
  },
  {
    id: "afforestation",
    label: "Afforestation",
    shortLabel: "Afforestation",
    description: "Plant native broadleaf forest on bare or marginal land. Increases carbon stock and reduces nutrient runoff.",
    effect: { forestC: 1.40, soilC: 1.10, nitrogen: 0.75, phosphorus: 0.80, waterFlow: 0.92 },
  },
  {
    id: "riparian_buffer",
    label: "Riparian buffer strips",
    shortLabel: "Riparian buffer",
    description: "Vegetated buffer strips along streams. Strips dissolved N and particulate P before runoff reaches the channel.",
    effect: { forestC: 1.05, nitrogen: 0.65, phosphorus: 0.55, waterFlow: 0.96 },
  },
  {
    id: "agri_bmp",
    label: "Agricultural BMPs / cover crop",
    shortLabel: "Agri BMP",
    description: "Cover cropping + reduced fertilizer + precision application. Builds soil C and curbs nutrient export.",
    effect: { soilC: 1.20, nitrogen: 0.70, phosphorus: 0.65 },
  },
  {
    id: "wetland",
    label: "Wetland restoration",
    shortLabel: "Wetland",
    description: "Restore in-basin wetlands. High N/P stripping efficiency and modest soil-C uplift.",
    effect: { soilC: 1.10, nitrogen: 0.60, phosphorus: 0.50, waterFlow: 0.95 },
  },
  {
    id: "no_till",
    label: "No-till / reduced tillage",
    shortLabel: "No-till",
    description: "Eliminate soil disturbance. Strong soil-C accumulation and modest nutrient-export reduction.",
    effect: { soilC: 1.30, nitrogen: 0.85, phosphorus: 0.85 },
  },
  {
    id: "reduce_np",
    label: "Reduce upstream N/P load",
    shortLabel: "Reduce N/P",
    description: "Direct upstream load reduction (sewage upgrades, fertilizer caps). Targets nutrients only.",
    effect: { nitrogen: 0.50, phosphorus: 0.50 },
  },
];

export function getSubBasinMeasure(id: string): SubBasinMeasure {
  return SUB_BASIN_MEASURES.find(m => m.id === id) ?? SUB_BASIN_MEASURES[0];
}

/** Apply a measure's effect multipliers to a basin's indicators. */
export function applyMeasure(
  ind: SubBasinIndicators,
  measureId: SubBasinMeasureId | string,
): SubBasinIndicators {
  const m = getSubBasinMeasure(measureId);
  return {
    forestC:    ind.forestC    * (m.effect.forestC    ?? 1),
    soilC:      ind.soilC      * (m.effect.soilC      ?? 1),
    nitrogen:   ind.nitrogen   * (m.effect.nitrogen   ?? 1),
    phosphorus: ind.phosphorus * (m.effect.phosphorus ?? 1),
    waterFlow:  ind.waterFlow  * (m.effect.waterFlow  ?? 1),
  };
}

/**
 * Aggregate the 5 indicators across a set of selected sub-basins.
 *
 * Per-area indicators (forestC t/ha, soilC t/ha, N kg/ha/yr, P kg/ha/yr) are
 * area-weighted ⇒ returned in absolute units (t, t, kg/yr, kg/yr).  Water
 * flow is summed directly (m³/s).
 *
 * When `measureId` is provided (and ≠ "none") the function returns BOTH the
 * baseline aggregate (`baseValues`) and the post-measure aggregate
 * (`values`) in a single pass, so the panel can render Before vs After
 * without a second call.  When no measure is set, `values` and `baseValues`
 * are identical.
 */
export function aggregateSubBasins(
  ids: number[],
  measureId: SubBasinMeasureId | string = "none",
): {
  values:     Record<SubBasinIndicatorId, number>;
  baseValues: Record<SubBasinIndicatorId, number>;
  totalArea:  number;
} {
  const basins = ids.map(getSubBasin).filter((b): b is SubBasinMeta => !!b);
  const totalArea = basins.reduce((s, b) => s + b.area_ha, 0);

  const values:     Record<SubBasinIndicatorId, number> = { forestC: 0, soilC: 0, nitrogen: 0, phosphorus: 0, waterFlow: 0 };
  const baseValues: Record<SubBasinIndicatorId, number> = { forestC: 0, soilC: 0, nitrogen: 0, phosphorus: 0, waterFlow: 0 };

  for (const b of basins) {
    const measured = applyMeasure(b.indicators, measureId);
    for (const ind of SUB_BASIN_INDICATORS) {
      const baseV = b.indicators[ind.id];
      const newV  = measured[ind.id];
      if (ind.additive) {
        baseValues[ind.id] += baseV;
        values[ind.id]     += newV;
      } else {
        // per-area density / rate ⇒ multiply by area to get absolute totals
        baseValues[ind.id] += baseV * b.area_ha;
        values[ind.id]     += newV * b.area_ha;
      }
    }
  }
  return { values, baseValues, totalArea };
}

// ── Nutrient field generator (Delft3D-reference-shaped) ───────────────────────
// The reference Delft3D animation shows nutrient hotspots emerging from the
// river-mouth pixels along the western shoreline (and a smaller NE-corner
// inflow), expanding into a yellow→cyan transition plume in spring/early
// summer, then collapsing through summer and fall, with a small autumn rebound
// around late November before going quiet for winter.
//
// We model this as: ambient + (per-mouth Gaussian source field) × (seasonal
// pulse) × (surface-layer weighting), with a small wobble term so the plume
// has the discrete-cell variability of the real model output.

/** Projects a river mouth onto the actual coastline. We scan a small band of
 *  rows around the mouth (±2) for the WESTMOST in-bay cell — i.e. the left
 *  shore on that row — then pick the closest such cell. This biases the
 *  snap toward the western coast (where most Shizugawa rivers discharge),
 *  rather than the geometrically-nearest shore point which can be a southern
 *  or northern stretch jutting closer to the declared mouth. Falls back to
 *  the mouth itself if no row in the band has a bay cell. */
function nearestCoastCell(mx: number, mz: number): { gx: number; gz: number } {
  // If the mouth is on the eastern half of the bay (e.g. the NE niida/moriya
  // outlet at gx=80), project to the eastmost cell instead.
  const isEast = mx >= GRID_W * 0.55;
  let bestX = mx, bestZ = mz, bestD = Infinity;
  const rowSpan = 3;
  for (let z = Math.max(0, mz - rowSpan); z <= Math.min(GRID_D - 1, mz + rowSpan); z++) {
    let edgeX = -1;
    if (isEast) {
      for (let x = GRID_W - 1; x >= 0; x--) if (BAY_MASK[z]?.[x]) { edgeX = x; break; }
    } else {
      for (let x = 0; x < GRID_W; x++) if (BAY_MASK[z]?.[x]) { edgeX = x; break; }
    }
    if (edgeX < 0) continue;
    const d = Math.hypot(edgeX - mx, z - mz);
    if (d < bestD) { bestD = d; bestX = edgeX; bestZ = z; }
  }
  return { gx: bestX, gz: bestZ };
}

/** Unique river mouth cells with a `weight` equal to the number of distinct
 *  riverIds discharging there, snapped to the nearest actual coastline cell.
 *  Mouths shared by many rivers (e.g. the Shizugawa/Togura/Oura cluster on
 *  the central western coast) carry proportionally more freshwater + nutrient
 *  load and bloom brighter. Snapping ensures bloom centres sit on the shore
 *  rather than in the middle of open water (some mouth coords in RIVER_CELLS
 *  were chosen for value-sampling and sit a few cells offshore). */
const RIVER_MOUTHS: Array<{ gx: number; gz: number; weight: number }> = (() => {
  // Group rivers by their declared mouth, then snap each unique mouth to its
  // nearest coastline cell.
  const ridsByMouth = new Map<string, Set<string>>();
  const rawByKey    = new Map<string, { gx: number; gz: number }>();
  for (const c of RIVER_CELLS) {
    const key = `${c.mouthGx}:${c.mouthGz}`;
    let set = ridsByMouth.get(key);
    if (!set) { set = new Set(); ridsByMouth.set(key, set); }
    set.add(c.riverId);
    if (!rawByKey.has(key)) rawByKey.set(key, { gx: c.mouthGx, gz: c.mouthGz });
  }
  const out: Array<{ gx: number; gz: number; weight: number }> = [];
  for (const [key, raw] of rawByKey) {
    const snap = nearestCoastCell(raw.gx, raw.gz);
    out.push({ gx: snap.gx, gz: snap.gz, weight: ridsByMouth.get(key)?.size ?? 1 });
  }
  return out;
})();

/** Per-cell source-strength field — sum over all river mouths of
 *  (mouth_weight × exp(-d/decayLen)). Multi-river mouths produce stronger
 *  blooms; nearby mouths overlap and compound, matching the Delft3D
 *  reference where the Shizugawa/Togura/Oura cluster lights up brightest.
 *  Computed once at module load. */
const NUTRIENT_SOURCE_FIELD: number[][] = (() => {
  const decayLen     = 9;   // grid units — larger = wider plumes
  const weightDamp   = 0.5; // softens the linear weight effect
  const fieldNormDiv = 1.6; // normalizes peak field so values stay in [0, ~1]
  const out: number[][] = [];
  for (let z = 0; z < GRID_D; z++) {
    out[z] = [];
    for (let x = 0; x < GRID_W; x++) {
      if (!BAY_MASK[z]?.[x]) { out[z][x] = 0; continue; }
      let sum = 0;
      for (const m of RIVER_MOUTHS) {
        const d  = Math.hypot(x - m.gx, z - m.gz);
        const w  = Math.pow(m.weight, weightDamp); // sqrt-style damping
        sum     += w * Math.exp(-d / decayLen);
      }
      out[z][x] = sum / fieldNormDiv;
    }
  }
  return out;
})();

/** Annual nutrient-pulse intensity (0–1) for a given day of the year.
 *  Big spring/early-summer peak around mid-June (day ≈ 168, formerly week 24)
 *  plus a small autumn rebound around mid-November (day ≈ 322, formerly
 *  week 46), matching the Delft3D reference frames. */
function nutrientPulse(day: number, year: number = 2023): number {
  const yearShift  = (year - 2023) * 10;             // small inter-annual jitter (~1.5 weeks)
  const d          = day + yearShift;
  // Spring pulse amplitude > 1 so cells a few grid units off the mouth still
  // clamp to deep red at the June peak, giving a visibly large bloom.
  const spring     = 1.4 * Math.exp(-Math.pow((d - 168) / 49, 2));   // σ ≈ 7 weeks (49 days)
  const autumn     = 0.35 * Math.exp(-Math.pow((d - 322) / 28, 2));  // σ ≈ 4 weeks (28 days)
  return Math.max(0.05, spring + autumn);
}

export function generateDayData(day: number, year: number = 2023): number[][][] {
  const t       = (day / TOTAL_DAYS) * Math.PI * 2 + (year - 2023) * 0.29;
  const pulse   = nutrientPulse(day, year);
  const ambient = 0.05; // baseline blue everywhere — open ocean far from mouths

  const data: number[][][] = [];
  for (let z = 0; z < GRID_D; z++) {
    data[z] = [];
    for (let x = 0; x < GRID_W; x++) {
      data[z][x] = [];
      const sourceField = NUTRIENT_SOURCE_FIELD[z]?.[x] ?? 0;
      // Small wobble so plumes have discrete-cell variability like the
      // real Delft3D output (not perfectly smooth contours).
      const wobble =
        Math.sin(x * 0.7 + t) * 0.5 +
        Math.cos(z * 0.5 + t * 1.1) * 0.5;

      for (let d = 0; d < DEPTH_LAYERS; d++) {
        // Surface layer (d=0) carries the strongest nutrient signal — deeper
        // layers attenuate toward the open-water background. The reference
        // frames are all "layer 1" (surface).
        const surfaceWeight = Math.pow(1 - d / DEPTH_LAYERS, 1.5);
        const val =
          ambient +
          sourceField * pulse * surfaceWeight +
          wobble * 0.07 * sourceField * surfaceWeight;
        data[z][x][d] = Math.min(1, Math.max(0, val));
      }
    }
  }
  return data;
}

/** Day-of-year label, e.g. "Jun 16" (legacy `getWeekLabel` removed — consumers
 *  should import from `@/lib/dayUtils` directly for richer date formatting). */
export interface DayLabel {
  day: number;
  label: string;       // "Jun 16"
  monthLabel: string;  // "Jun"
}

export function getDayLabel(day: number, year: number = 2023): DayLabel {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const date = new Date(year, 0, 1 + day);
  const m = months[date.getMonth()];
  return {
    day,
    label: `${m} ${date.getDate()}`,
    monthLabel: m,
  };
}

export interface VariableOption {
  id:         string;
  label:      string;
  unit:       string;
  colorScale: string;
  min:        number;
  max:        number;
  decimals:   number;
}

export const VARIABLE_OPTIONS: VariableOption[] = [
  { id: "nitrogen",   label: "Total Nitrogen",   unit: "mg/L", colorScale: "nitrogen",   min: 0.2,  max: 3.0, decimals: 2 },
  { id: "phosphorus", label: "Total Phosphorus", unit: "μg/L", colorScale: "phosphorus", min: 10,   max: 130, decimals: 0 },
  { id: "flow",       label: "Water Flow",       unit: "cm/s", colorScale: "flow",       min: 0,    max: 100, decimals: 1 },
];

/**
 * Compute bay-ocean exchange intensity (0–1) for a given day.
 * Based on the average value of the rightmost active cells in each row.
 */
export function getBayOceanExchangeIntensity(day: number, year: number = 2023): number {
  const data = generateDayData(day, year);
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
 * Compute sediment elution intensity (0–1) for a given day.
 * Based on the average bottom-two-layer values across all active cells.
 */
export function getSedimentElutionIntensity(day: number, year: number = 2023): number {
  const data = generateDayData(day, year);
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
    case "nitrogen":   return +(value * 2.80 + 0.20).toFixed(2);   // 0.20–3.00 mg/L
    case "phosphorus": return +(value * 120  + 10).toFixed(0);     // 10–130 µg/L
    case "flow":       return +(value * 100).toFixed(1);            // 0–100 cm/s
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
  { id: "shizugawa", name: "Shizugawa",      basin: 1,  sub: "Sub-basin 1 · Minamisanriku · 31.4 km²",   length: "22.6 km" },
  { id: "oura",      name: "Oura",           basin: 2,  sub: "Sub-basin 2 · Minamisanriku · 8.7 km²",    length: "6.2 km"  },
  { id: "karakuwa",  name: "Karakuwa",       basin: 3,  sub: "Sub-basin 3 · Kesennuma · 12.4 km²",       length: "9.1 km"  },
  { id: "togura",    name: "Togura",         basin: 4,  sub: "Sub-basin 4 · Minamisanriku · 10.3 km²",   length: "7.8 km"  },
  { id: "urashiro",  name: "Urashiro",       basin: 5,  sub: "Sub-basin 5 · Minamisanriku · 9.5 km²",    length: "5.9 km"  },
  { id: "iriya",     name: "Iriya",          basin: 6,  sub: "Sub-basin 6 · Minamisanriku · 7.1 km²",    length: "4.3 km"  },
  { id: "okawa",     name: "Okawa",          basin: 7,  sub: "Sub-basin 7 · Minamisanriku · 13.8 km²",   length: "11.0 km" },
  { id: "niida",     name: "Niida",          basin: 8,  sub: "Sub-basin 8 · Oshika District · 30.5 km²", length: "14.6 km" },
  { id: "karakuwa2", name: "Karakuwa East",  basin: 9,  sub: "Sub-basin 9 · Kesennuma · 6.9 km²",        length: "5.4 km"  },
  { id: "tomaya",    name: "Tomaya",         basin: 10, sub: "Sub-basin 10 · Oshika District · 18.2 km²",length: "9.3 km"  },
  { id: "shishiori", name: "Shishiori",      basin: 11, sub: "Sub-basin 11 · Kesennuma · 22.7 km²",      length: "13.1 km" },
  { id: "onagawa",   name: "Onagawa",        basin: 12, sub: "Sub-basin 12 · Oshika District · 15.6 km²",length: "8.7 km"  },
  { id: "hachiman",  name: "Hachiman",       basin: 13, sub: "Sub-basin 13 · Minamisanriku · 24.1 km²",  length: "9.7 km"  },
  { id: "motoyoshi", name: "Motoyoshi",      basin: 14, sub: "Sub-basin 14 · Motoyoshi · 21.3 km²",      length: "12.1 km" },
  { id: "mitobe",    name: "Mitobe",         basin: 15, sub: "Sub-basin 15 · Minamisanriku · 22.6 km²",  length: "11.2 km" },
  { id: "sakura",    name: "Sakura",         basin: 16, sub: "Sub-basin 16 · Minamisanriku · 11.2 km²",  length: "5.8 km"  },
  { id: "oritate",   name: "Oritate",        basin: 17, sub: "Sub-basin 17 · Minamisanriku · 14.2 km²",  length: "7.3 km"  },
  { id: "kitakami",  name: "Kitakami",       basin: 18, sub: "Sub-basin 18 · Motoyoshi · 16.4 km²",      length: "10.5 km" },
  { id: "moriya",    name: "Moriya",         basin: 20, sub: "Sub-basin 20 · Minamisanriku · 8.1 km²",   length: "5.1 km"  },
  { id: "oya",       name: "Oya",            basin: 24, sub: "Sub-basin 24 · Minamisanriku · 17.9 km²",  length: "10.2 km" },
  { id: "kamaishi",  name: "Kamaishi",       basin: 25, sub: "Sub-basin 25 · Kamaishi · 19.3 km²",       length: "11.7 km" },
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
  shizugawa1:[5.85, 0.48, 0.32],
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

/** Returns the spatial mean per segment at a given day (one value per segment). */
export function getCompositeSegmentMeans(
  day: number,
  compositeId: string,
  variableId: string,
  year: number = 2023
): number[] {
  const comp = getCompositeRiver(compositeId);
  if (!comp) return [];
  const data = generateDayCompositeRiverData(day, compositeId, year);
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
export function generateDayCompositeRiverData(
  day: number,
  compositeId: string,
  year: number = 2023
): number[][] {
  const comp = getCompositeRiver(compositeId);
  if (!comp) return generateDayRiverData(day, "shizugawa", year);

  const BLEND_COLS = 8;
  const yearShift = (year - 2023) * 0.31;
  const t = (day / TOTAL_DAYS) * Math.PI * 2 + yearShift;

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

/**
 * Generate a RIVER_ROWS × RIVER_COLS 2D grid of values for a given day.
 *
 * The simulated baseline gives a plausible spatial texture along the river
 * corridor. When `realScalar` is provided (a normalized 0–1 fraction derived
 * from the SWAT outputRch dataset for that reach + day), the entire grid is
 * scaled toward that real value so storm days light the whole river up
 * proportionally — this preserves the spatial detail while making the
 * intensity faithful to the dataset.
 */
export function generateDayRiverData(
  day: number,
  riverId: string,
  year: number = 2023,
  realScalar: number | null = null,
): number[][] {
  const yearShift = (year - 2023) * 0.31;
  const t = (day / TOTAL_DAYS) * Math.PI * 2 + yearShift;

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

  // If we have a real-data scalar for this reach × day, gently bias the grid
  // toward that intensity (keeps spatial texture, makes mean track the dataset).
  if (realScalar !== null) {
    const target = Math.max(0, Math.min(1, realScalar));
    let sum = 0;
    for (let row = 0; row < RIVER_ROWS; row++) {
      for (let col = 0; col < RIVER_COLS; col++) sum += data[row][col];
    }
    const meanCurrent = sum / (RIVER_ROWS * RIVER_COLS);
    if (meanCurrent > 0.001) {
      const scale = target / meanCurrent;
      for (let row = 0; row < RIVER_ROWS; row++) {
        for (let col = 0; col < RIVER_COLS; col++) {
          data[row][col] = Math.max(0, Math.min(1, data[row][col] * scale));
        }
      }
    } else {
      // Edge case: simulated baseline is essentially zero. Fall back to a flat field.
      for (let row = 0; row < RIVER_ROWS; row++) {
        for (let col = 0; col < RIVER_COLS; col++) data[row][col] = target;
      }
    }
  }

  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// DECARBONIZATION SIMULATOR
// HSI (Habitat Suitability Index, 0–1) and Seagrass Carbon flux
// (tCO₂e/ha/yr) per ocean cell, with optional decarbonization-measure
// scenarios. All values are deterministic synthetic — clearly modeled, not
// observed. Designed for the Figma handoff demo.
// ─────────────────────────────────────────────────────────────────────────────

export type MeasureId =
  | "none"
  | "plant-eelgrass"
  | "restore-reef"
  | "reduce-runoff"
  | "tidal-flat-restoration";

export type CarbonChannel = "seagrass" | "macroalgae" | "oyster";

export interface ChannelBoosts {
  seagrass:   number;
  macroalgae: number;
  oyster:     number;
}

export interface DecarbMeasure {
  id: MeasureId;
  label: string;
  short: string;
  desc: string;
  /** Seagrass-channel multiplier (legacy /playback inspector reads this). */
  carbonBoost: number;
  /** Per-channel multipliers for the new blue-carbon model. */
  channels: ChannelBoosts;
  /** Additive HSI offset at steady state (0–1) */
  hsiBoost: number;
  /** Days for the measure to ramp from 0 → full effect */
  rampDays: number;
}

export const DECARB_MEASURES: DecarbMeasure[] = [
  { id: "none",                    label: "No measure (baseline)",      short: "Baseline",       desc: "Current trajectory — no decarbonization measure applied.",                                                                  carbonBoost: 0,   channels: { seagrass: 0,   macroalgae: 0, oyster: 0 }, hsiBoost: 0,    rampDays: 7   },
  { id: "plant-eelgrass",          label: "Plant eelgrass meadow",      short: "Eelgrass",       desc: "Replant Zostera marina across the project area — direct seagrass-carbon sequestration.",                                   carbonBoost: 2.4, channels: { seagrass: 2.4, macroalgae: 0, oyster: 0 }, hsiBoost: 0.20, rampDays: 126 },
  { id: "restore-reef",            label: "Restore oyster reef",        short: "Oyster reef",    desc: "Rebuild oyster reef structure — filter-feeders clarify the water column so eelgrass beds expand and trap more carbon.",   carbonBoost: 0.8, channels: { seagrass: 0.8, macroalgae: 0, oyster: 0 }, hsiBoost: 0.18, rampDays: 70  },
  { id: "reduce-runoff",           label: "Reduce upstream N/P load",   short: "Reduce runoff",  desc: "Cut nitrogen + phosphorus runoff from the watershed — improves light penetration and lets seagrass meadows thrive.",     carbonBoost: 1.0, channels: { seagrass: 1.0, macroalgae: 0, oyster: 0 }, hsiBoost: 0.16, rampDays: 168 },
  { id: "tidal-flat-restoration",  label: "Restore tidal flats",        short: "Tidal flat",     desc: "Restore intertidal sediment flats — adjacent habitat lifts seagrass HSI and modestly boosts sequestration.",             carbonBoost: 0.5, channels: { seagrass: 0.5, macroalgae: 0, oyster: 0 }, hsiBoost: 0.12, rampDays: 112 },
];

export function getMeasure(id: MeasureId): DecarbMeasure {
  return DECARB_MEASURES.find((m) => m.id === id) ?? DECARB_MEASURES[0];
}

/**
 * Distance from the central seagrass-suitable belt (mid-bay, mid-depth).
 * Used to make seagrass carbon spatially heterogeneous so different pixels
 * tell different stories. Returns 0 (perfect) → 1 (poor).
 */
function seagrassSiteFitness(x: number, z: number): number {
  // Mid-bay shallow belt. 0 = perfect, 1 = unsuitable.
  const cx = (GRID_W - 1) * 0.45;
  const cz = (GRID_D - 1) * 0.50;
  const rx = (GRID_W - 1) * 0.5;
  const rz = (GRID_D - 1) * 0.45;
  const dx = (x - cx) / rx;
  const dz = (z - cz) / rz;
  const radial = Math.sqrt(dx * dx + dz * dz);
  return Math.max(0, Math.min(1, radial));
}

/** Macroalgae thrives where there's good water exchange — outer bay, eastern edge. */
function macroalgaeSiteFitness(x: number, z: number): number {
  // 0 = perfect, 1 = unsuitable
  const eastness = x / (GRID_W - 1);     // 0 west → 1 east
  const edgeProx = Math.min(z, GRID_D - 1 - z) / ((GRID_D - 1) / 2); // 0 edge → 1 mid
  return 1 - Math.max(0, Math.min(1, eastness * 0.7 + (1 - edgeProx) * 0.3));
}

/** Oyster reefs sit near sheltered river mouths — inner bay, western edge. */
function oysterSiteFitness(x: number, z: number): number {
  // 0 = perfect, 1 = unsuitable
  const westness = 1 - x / (GRID_W - 1);
  const cz = (GRID_D - 1) * 0.5;
  const verticalCenter = 1 - Math.abs(z - cz) / cz;
  return 1 - Math.max(0, Math.min(1, westness * 0.7 + verticalCenter * 0.3));
}

const CHANNEL_FITNESS: Record<CarbonChannel, (x: number, z: number) => number> = {
  seagrass:   (x, z) => 1 - seagrassSiteFitness(x, z),
  macroalgae: (x, z) => 1 - macroalgaeSiteFitness(x, z),
  oyster:     (x, z) => 1 - oysterSiteFitness(x, z),
};

/** Per-channel max baseline annual flux at perfect fitness × HSI=1 (tCO₂e/ha/yr).
 *  Seagrass tuned to land in the literature-defensible Zostera marina range
 *  (Tokoro 2014, J-Blue Credit, Mcleod 2011) — top-end healthy meadows
 *  ~5 tCO₂e/ha/yr, typical Sanriku baselines ~1–2 tCO₂e/ha/yr. */
const CHANNEL_MAX_FLUX: Record<CarbonChannel, number> = {
  seagrass:   5.0,
  macroalgae: 3.6,  // kombu/wakame can be even higher in cultivated lines
  oyster:     0.8,
};

/** Per-channel seasonal modulation phase (radians offset). */
const CHANNEL_SEASON_PHASE: Record<CarbonChannel, number> = {
  seagrass:   -0.5,        // peaks late spring/early summer
  macroalgae:  0.6,        // peaks winter (cold-water kombu)
  oyster:      0.0,
};

/**
 * Baseline HSI for an ocean cell at a given week — derived deterministically
 * from the existing N/P/flow simulation. High HSI = N + P in the safe band
 * AND moderate flow. Returns 0–1.
 */
/** Internal: HSI given a precomputed daily field. */
function hsiFromField(data: number[][][], day: number, x: number, z: number): number {
  const col = getColumnMean(data, x, z);
  const optimum = 0.45;
  const proximity = 1 - Math.min(1, Math.abs(col - optimum) / 0.5);
  const fitness  = 1 - seagrassSiteFitness(x, z) * 0.6;
  const seasonal = 0.92 + 0.08 * Math.sin((day / TOTAL_DAYS) * Math.PI * 2);
  return Math.max(0, Math.min(1, proximity * fitness * seasonal));
}

export function getBaselineHsi(day: number, year: number, x: number, z: number): number {
  return hsiFromField(generateDayData(day, year), day, x, z);
}

/**
 * Baseline seagrass carbon flux (tCO₂e/ha/yr) at an ocean cell for a given
 * day. Cells outside the seagrass-suitable belt get near-zero flux.
 */
/** Internal: carbon flux given a precomputed daily field. */
function carbonFromField(data: number[][][], day: number, x: number, z: number): number {
  const fit = 1 - seagrassSiteFitness(x, z);
  if (fit < 0.15) return 0;
  const hsi = hsiFromField(data, day, x, z);
  const seasonal = 0.6 + 0.4 * Math.sin((day / TOTAL_DAYS) * Math.PI * 2 - 0.5);
  return fit * hsi * 3.2 * seasonal;
}

export function getBaselineCarbonFlux(day: number, year: number, x: number, z: number): number {
  return carbonFromField(generateDayData(day, year), day, x, z);
}

/** Ramp factor 0→1 representing measure effectiveness over time. */
function measureRamp(daysApplied: number, rampDays: number): number {
  if (daysApplied <= 0) return 0;
  return Math.min(1, daysApplied / Math.max(1, rampDays));
}

/**
 * HSI under a decarbonization-measure scenario. `appliedAtDay` is the
 * playback day at which the measure was switched on (0 = start of period).
 */
export function getScenarioHsi(
  day: number, year: number, x: number, z: number,
  measureId: MeasureId, appliedAtDay: number = 0,
): number {
  const baseline = getBaselineHsi(day, year, x, z);
  if (measureId === "none") return baseline;
  const m = getMeasure(measureId);
  const ramp = measureRamp(day - appliedAtDay, m.rampDays);
  return Math.max(0, Math.min(1, baseline + m.hsiBoost * ramp));
}

/**
 * Seagrass carbon flux under a measure scenario.
 */
export function getScenarioCarbonFlux(
  day: number, year: number, x: number, z: number,
  measureId: MeasureId, appliedAtDay: number = 0,
): number {
  const baseline = getBaselineCarbonFlux(day, year, x, z);
  if (measureId === "none") return baseline;
  const m = getMeasure(measureId);
  const ramp = measureRamp(day - appliedAtDay, m.rampDays);
  // "Plant eelgrass" can introduce flux on cells with low fitness too —
  // assume planting succeeds where HSI scenario is decent.
  const introduced = (measureId === "plant-eelgrass" && baseline === 0)
    ? ramp * 1.6
    : 0;
  return baseline * (1 + m.carbonBoost * ramp) + introduced;
}

/**
 * Convenience: daily time series of (baseline, scenario) values across the
 * playback range. Returns array length (toDay - fromDay + 1).
 */
export function buildHsiSeries(
  fromDay: number, toDay: number, year: number,
  x: number, z: number, measureId: MeasureId, appliedAtDay: number = 0,
): { day: number; baseline: number; scenario: number }[] {
  const m = getMeasure(measureId);
  const out: { day: number; baseline: number; scenario: number }[] = [];
  for (let d = fromDay; d <= toDay; d++) {
    const data = generateDayData(d, year);
    const baseline = hsiFromField(data, d, x, z);
    const scenario = measureId === "none"
      ? baseline
      : Math.max(0, Math.min(1, baseline + m.hsiBoost * measureRamp(d - appliedAtDay, m.rampDays)));
    out.push({ day: d, baseline, scenario });
  }
  return out;
}

export function buildCarbonSeries(
  fromDay: number, toDay: number, year: number,
  x: number, z: number, measureId: MeasureId, appliedAtDay: number = 0,
): { day: number; baselineRate: number; scenarioRate: number; baselineCum: number; scenarioCum: number }[] {
  const m = getMeasure(measureId);
  const dayFrac = 1 / TOTAL_DAYS;
  let bCum = 0, sCum = 0;
  const out: { day: number; baselineRate: number; scenarioRate: number; baselineCum: number; scenarioCum: number }[] = [];
  for (let d = fromDay; d <= toDay; d++) {
    const data = generateDayData(d, year);
    const bRate = carbonFromField(data, d, x, z);
    let sRate = bRate;
    if (measureId !== "none") {
      const ramp = measureRamp(d - appliedAtDay, m.rampDays);
      const introduced = (measureId === "plant-eelgrass" && bRate === 0) ? ramp * 1.6 : 0;
      sRate = bRate * (1 + m.carbonBoost * ramp) + introduced;
    }
    bCum += bRate * dayFrac;
    sCum += sRate * dayFrac;
    out.push({ day: d, baselineRate: bRate, scenarioRate: sRate, baselineCum: bCum, scenarioCum: sCum });
  }
  return out;
}

/** Bay coordinate bounds (shared with PlaybackPage HUD). */
export const BAY_COORDS = {
  lonW: 141.383, lonE: 141.468,
  latS: 38.582,  latN: 38.651,
};

export function gridToLonLat(x: number, z: number): { lon: number; lat: number } {
  const lon = BAY_COORDS.lonW + (x / (GRID_W - 1)) * (BAY_COORDS.lonE - BAY_COORDS.lonW);
  const lat = BAY_COORDS.latS + (z / (GRID_D - 1)) * (BAY_COORDS.latN - BAY_COORDS.latS);
  return { lon, lat };
}

/** Per-channel baseline carbon flux (tCO₂e/ha/yr) at a cell, given a precomputed daily field. */
function channelBaselineRate(
  channel: CarbonChannel,
  data: number[][][], day: number, x: number, z: number,
): number {
  const fit = CHANNEL_FITNESS[channel](x, z);
  if (fit < 0.15) return 0;
  const hsi = hsiFromField(data, day, x, z);
  const phase = CHANNEL_SEASON_PHASE[channel];
  const seasonal = 0.6 + 0.4 * Math.sin((day / TOTAL_DAYS) * Math.PI * 2 + phase);
  return fit * hsi * CHANNEL_MAX_FLUX[channel] * seasonal;
}

export interface BlueCarbonPoint {
  day: number;
  baselineRate: number;
  scenarioRate: number;
  baselineCum: number;
  scenarioCum: number;
  /** Per-channel scenario rate breakdown (tCO₂e/ha/yr). */
  channelsRate: ChannelBoosts;
  /** Per-channel cumulative scenario contribution (tCO₂e/ha). */
  channelsCum:  ChannelBoosts;
}

/**
 * Daily time series of blue-carbon flux + per-channel breakdown for one
 * cell under a measure scenario. Channels: seagrass, macroalgae, oyster.
 */
export function buildBlueCarbonSeries(
  fromDay: number, toDay: number, year: number,
  x: number, z: number, measureId: MeasureId, appliedAtDay: number = 0,
): BlueCarbonPoint[] {
  const m = getMeasure(measureId);
  const dayFrac = 1 / TOTAL_DAYS;
  // Seagrass is now the only blue-carbon channel modeled. The macroalgae and
  // oyster fields on ChannelBoosts are kept (typed as 0) for backward
  // compatibility with any persisted data shape.
  const channels: CarbonChannel[] = ["seagrass"];
  const cumBase  = { seagrass: 0, macroalgae: 0, oyster: 0 };
  const cumScen  = { seagrass: 0, macroalgae: 0, oyster: 0 };
  let bCumTotal = 0, sCumTotal = 0;
  const out: BlueCarbonPoint[] = [];
  for (let d = fromDay; d <= toDay; d++) {
    const data = generateDayData(d, year);
    const ramp = measureRamp(d - appliedAtDay, m.rampDays);
    let bRateTotal = 0, sRateTotal = 0;
    const channelsRate: ChannelBoosts = { seagrass: 0, macroalgae: 0, oyster: 0 };
    for (const ch of channels) {
      const bRate = channelBaselineRate(ch, data, d, x, z);
      const boost = m.channels[ch];
      // "introduced" capacity: a measure can produce flux on previously zero-fitness
      // cells (e.g. cultivating macroalgae where there is none today).
      const introduced = (bRate === 0 && boost > 0) ? ramp * 0.6 * boost : 0;
      const sRate = bRate * (1 + boost * ramp) + introduced;
      channelsRate[ch] = sRate;
      cumBase[ch] += bRate * dayFrac;
      cumScen[ch] += sRate * dayFrac;
      bRateTotal += bRate;
      sRateTotal += sRate;
    }
    bCumTotal += bRateTotal * dayFrac;
    sCumTotal += sRateTotal * dayFrac;
    out.push({
      day: d,
      baselineRate: bRateTotal, scenarioRate: sRateTotal,
      baselineCum:  bCumTotal,  scenarioCum:  sCumTotal,
      channelsRate, channelsCum: { ...cumScen },
    });
  }
  return out;
}

export const CHANNEL_LABELS: Record<CarbonChannel, string> = {
  seagrass:   "Seagrass meadow",
  macroalgae: "Macroalgae cultivation",
  oyster:     "Oyster reef",
};

export const CHANNEL_COLORS: Record<CarbonChannel, string> = {
  seagrass:   "#16a34a", // green-600
  macroalgae: "#0891b2", // cyan-600
  oyster:     "#a16207", // amber-700
};

/** HSI suitability bands used for chart background shading + pill labels. */
export const HSI_BANDS = [
  { from: 0.00, to: 0.30, label: "Poor",      color: "#fecaca", text: "#991b1b" },
  { from: 0.30, to: 0.60, label: "Fair",      color: "#fde68a", text: "#92400e" },
  { from: 0.60, to: 0.85, label: "Good",      color: "#bbf7d0", text: "#166534" },
  { from: 0.85, to: 1.01, label: "Excellent", color: "#86efac", text: "#14532d" },
] as const;

export function hsiBand(value: number): typeof HSI_BANDS[number] {
  return HSI_BANDS.find((b) => value >= b.from && value < b.to) ?? HSI_BANDS[0];
}

/** Stable color palette for selected pixels (max 4). */
export const PIXEL_PALETTE = ["#6366f1", "#f59e0b", "#14b8a6", "#ec4899"] as const;
