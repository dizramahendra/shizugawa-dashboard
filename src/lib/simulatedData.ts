import { RIVER_PATHS } from "@/lib/svgPaths";
import { sampleSvgPath } from "@/lib/svgSample";

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
// gx 0 = west (inner bay head), gx GRID_W-1 = east (bay mouth)
// gz 0 = south shore, gz GRID_D-1 = north shore
//
// Horizontal grid resolution. GRID_SUBDIV (1 or 2) multiplies the base 112×96
// cell density for finer / smoother voxels; STEP (scene units per cell, in
// OceanBasin3D) divides by the same factor so the rendered bay keeps the SAME
// physical size — just 4× as many, smaller voxels at 2×. The factor is read
// ONCE at module load from localStorage so the /playback "Detail 1×/2×" toggle
// can switch it: every derived field below (BAY_MASK, rivers, nutrient field,
// realCoast, land/terrain) is computed from GRID_W/GRID_D at import time, so the
// toggle writes the value and reloads — the clean way to re-resolve them all.
// SSR/no-DOM safe (falls back to 1×).
function readGridSubdiv(): 1 | 2 {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem("gridSubdiv") === "2" ? 2 : 1;
  } catch {
    return 1;
  }
}
export const GRID_SUBDIV: 1 | 2 = readGridSubdiv();
const GRID_W_BASE = 112;
const GRID_D_BASE = 96;
export const GRID_W = GRID_W_BASE * GRID_SUBDIV;
export const GRID_D = GRID_D_BASE * GRID_SUBDIV;

// Depth discretization. The bay's 0–90 m water column is modelled as 8 physical
// bands with a thin-at-surface / thick-at-depth profile. DEPTH_SUBDIV evenly
// subdivides each band to trade blockiness for vertical resolution while
// keeping the exact same total column height and depth range:
//   1 → 8 layers (original), 2 → 16, 3 → 24.
// The nutrient field is a continuous function of depth (see generateWeekData),
// so finer sampling yields identical values at matching depths — not invented
// data. Cost scales linearly with layer count (voxels ≈ base × DEPTH_SUBDIV).
export const DEPTH_SUBDIV = 2;
// Vertical exaggeration for the SCENE only. Shizugawa Bay is ~5 km wide but
// <60 m deep (real relief <1% of width), so at true scale the bathymetry reads
// as a flat sheet. Scaling the scene-unit column height (not the real-metre
// depths or labels) amplifies the shallow→deep slope so the topography reads as
// a proper slant — the standard, honest technique in bathymetry visualisation.
export const VERT_EXAG = 1.6;
const BASE_HEIGHTS  = [0.40, 0.50, 0.65, 0.82, 1.05, 1.28, 1.55, 1.80]; // scene units per band
const BASE_REAL_TOP = [0, 2, 5, 10, 18, 30, 47, 69];                    // metres, band tops
const BASE_REAL_BOT = [2, 5, 10, 18, 30, 47, 69, 90];                   // metres, band bottoms
export const DEPTH_LAYERS = BASE_HEIGHTS.length * DEPTH_SUBDIV;
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
// RIVER_CELLS is derived PROGRAMMATICALLY from the true SVG river paths
// (RIVER_PATHS in svgPaths.ts) so the 3D rivers land on the same courses the
// Map Viewport renders and cover every river the map draws. Each path is:
//   1. sampled into a dense polyline (svgSample.ts, ~1px spacing),
//   2. transformed SVG→grid with the SAME affine the bay uses (below),
//   3. walked as a contiguous 8-connected chain of (gx,gz) cells,
//   4. dilated by one cell so each channel reads ~2 cells wide, and
//   5. clipped so cells strictly inside the bay polygon are dropped (the
//      outermost land-adjacent cell is kept, so the river meets the coast).
// The old hand-authored SPINE_RIVER* / buildRiver / densify* machinery is gone.

export interface RiverCell {
  gx: number;
  gz: number;      // row index; ≥ GRID_D = north rivers, < 0 = south rivers
  mouthGx: number; // bay-boundary column for value / colour sampling
  mouthGz: number; // bay-boundary row  for value / colour sampling
  riverId: string; // key into RIVER_META for hover labels
}

// SVG canvas dimensions (RIVER_PATHS are authored in this space).
const SVG_W_RIVERS = 465;
const SVG_H_RIVERS = 586;

// SVG path id → canonical river slug. IDENTICAL to MapLibreMap's MODEL_RIVER
// (and to RIVERS[].basin below), so a river labelled "X" in 3D is the same
// river the Map view labels "X". Defined here as a literal to avoid a circular
// import from the map component (which imports from this module). Verified to
// match MODEL_RIVER for every RIVER_PATHS id.
const PATH_RIVER_ID: Record<number, string> = {
  1: "shizugawa", 2: "oura",      3: "karakuwa",  4: "togura",    5: "urashiro",
  6: "iriya",     7: "okawa",     8: "niida",     9: "karakuwa2", 10: "tomaya",
  11: "shishiori", 12: "onagawa", 13: "hachiman", 14: "motoyoshi", 15: "mitobe",
  16: "sakura",   17: "oritate",  18: "kitakami", 20: "moriya",   24: "oya",
  25: "kamaishi",
};

// SVG→grid affine — the SAME transform the bay polygon uses (see BAY_POLYGON
// comment above). Maps an SVG (x,y) to fractional grid coords (gx,gz).
function svgToGrid(sx: number, sy: number): { gx: number; gz: number } {
  const rawNx = sx / SVG_W_RIVERS;
  const rawNz = 1 - sy / SVG_H_RIVERS;
  const nx = (rawNx - 0.4631) * 2.1565 + 0.03;
  const nz = (rawNz - 0.2846) * 2.1565 + 0.0919;
  return { gx: Math.floor(nx * GRID_W), gz: Math.floor(nz * GRID_D) };
}

function inBay(gx: number, gz: number): boolean {
  return gx >= 0 && gx < GRID_W && gz >= 0 && gz < GRID_D && BAY_MASK[gz][gx];
}

// Rasterize one SVG path into a contiguous, ~2-cell-wide chain of grid cells.
// Sampling at ~1px keeps consecutive transformed points within one cell of
// each other; any residual gap between successive cells is bridged with an
// L-step so the spine is 8-connected with no holes. A +1 lateral dilation
// (perpendicular to the local direction) widens the 1-cell spine to ~2 cells,
// matching the previous visual weight.
function rasterizeRiverPath(d: string): Array<{ gx: number; gz: number }> {
  const pts = sampleSvgPath(d, 1);
  // 1) spine cells, contiguous
  const spine: Array<{ gx: number; gz: number }> = [];
  const spineSeen = new Set<string>();
  const pushCell = (gx: number, gz: number) => {
    const k = `${gx},${gz}`;
    if (spineSeen.has(k)) return;
    spineSeen.add(k);
    spine.push({ gx, gz });
  };
  let prev: { gx: number; gz: number } | null = null;
  for (const p of pts) {
    const { gx, gz } = svgToGrid(p.x, p.y);
    if (prev && (gx !== prev.gx || gz !== prev.gz)) {
      const dx = gx - prev.gx;
      const dz = gz - prev.gz;
      // Bridge multi-cell hops (rare) and diagonal hops with an L-step so the
      // chain is always 8-connected.
      if (Math.abs(dx) > 1 || Math.abs(dz) > 1) {
        const steps = Math.max(Math.abs(dx), Math.abs(dz));
        let px = prev.gx, pz = prev.gz;
        for (let s = 1; s <= steps; s++) {
          const nx = Math.round(prev.gx + (dx * s) / steps);
          const nz = Math.round(prev.gz + (dz * s) / steps);
          if (nx !== px && nz !== pz) pushCell(nx, pz); // L-step
          pushCell(nx, nz);
          px = nx; pz = nz;
        }
      } else if (dx !== 0 && dz !== 0) {
        pushCell(gx, prev.gz); // L-step to keep it 4-connected-ish (no diagonal-only)
        pushCell(gx, gz);
      } else {
        pushCell(gx, gz);
      }
    } else if (!prev) {
      pushCell(gx, gz);
    }
    prev = { gx, gz };
  }
  // 2) dilate ~2 wide: for each spine cell add one neighbour perpendicular to
  //    the local travel direction (falls back to +x when direction is unknown).
  const out: Array<{ gx: number; gz: number }> = [];
  const outSeen = new Set<string>();
  const add = (gx: number, gz: number) => {
    const k = `${gx},${gz}`;
    if (outSeen.has(k)) return;
    outSeen.add(k);
    out.push({ gx, gz });
  };
  for (let i = 0; i < spine.length; i++) {
    const c = spine[i];
    add(c.gx, c.gz);
    const nxt = spine[i + 1] ?? spine[i - 1] ?? c;
    const ddx = nxt.gx - c.gx;
    const ddz = nxt.gz - c.gz;
    // perpendicular of (ddx,ddz) is (-ddz,ddx); pick the dominant axis so the
    // widen is a single clean cell offset.
    // Widen by GRID_SUBDIV cells so the channel keeps a similar PHYSICAL width
    // at 2× (at 1× this adds a single cell, exactly as before).
    for (let k = 1; k <= GRID_SUBDIV; k++) {
      if (Math.abs(ddx) >= Math.abs(ddz)) {
        add(c.gx, c.gz + k); // travel ~horizontal → widen in z
      } else {
        add(c.gx + k, c.gz); // travel ~vertical → widen in x
      }
    }
  }
  return out;
}

// Find the mouth (downstream/bay end) of a rasterized river: the cell whose
// 4-neighbourhood touches bay water, clamped into the grid for sampling. If a
// river doesn't reach the bay (fully inland after clipping), fall back to its
// end cell nearest the grid interior. Returns valid in-grid coords.
function computeMouth(
  cells: Array<{ gx: number; gz: number }>,
): { mouthGx: number; mouthGz: number } {
  const clamp = (gx: number, gz: number) => ({
    mouthGx: Math.max(0, Math.min(GRID_W - 1, gx)),
    mouthGz: Math.max(0, Math.min(GRID_D - 1, gz)),
  });
  // Prefer a cell adjacent to bay water — that's the true outlet.
  for (const c of cells) {
    if (inBay(c.gx + 1, c.gz) || inBay(c.gx - 1, c.gz) ||
        inBay(c.gx, c.gz + 1) || inBay(c.gx, c.gz - 1)) {
      return clamp(c.gx, c.gz);
    }
  }
  // Otherwise: cell nearest the grid centre (approx. bay direction).
  const cx = GRID_W / 2, cz = GRID_D / 2;
  let best = cells[0] ?? { gx: 0, gz: 0 };
  let bestD = Infinity;
  for (const c of cells) {
    const dd = (c.gx - cx) ** 2 + (c.gz - cz) ** 2;
    if (dd < bestD) { bestD = dd; best = c; }
  }
  return clamp(best.gx, best.gz);
}

// Rivers are only shown within the study-box footprint (the LAND_RING-extended
// grid that the SolidTerrain renders). Cells beyond it — chiefly the
// Kesennuma-area rivers (paths 3 & 25), whose true SVG course lies north of the
// Shizugawa bay grid — would otherwise render as channels floating past the
// terrain edge. Margin mirrors landMask.ts's LAND_RING (= 16 * GRID_SUBDIV);
// kept as a local literal to avoid a circular import (landMask imports
// RIVER_CELLS from this module). It MUST scale with GRID_SUBDIV: otherwise at 2×
// the terrain extends to 32 cells but rivers are clipped at 16, so the west
// channels get cut short and covered by the extra land strip.
const RIVER_BOX_MARGIN = 16 * GRID_SUBDIV; // = LAND_RING in landMask.ts
function inStudyBox(gx: number, gz: number): boolean {
  return (
    gx >= -RIVER_BOX_MARGIN && gx < GRID_W + RIVER_BOX_MARGIN &&
    gz >= -RIVER_BOX_MARGIN && gz < GRID_D + RIVER_BOX_MARGIN
  );
}

export const RIVER_CELLS: RiverCell[] = (() => {
  const cells: RiverCell[] = [];
  const seen = new Set<string>(); // `${gz},${gx}` — one river owns each cell
  const ids = Object.keys(RIVER_PATHS).map(Number).sort((a, b) => a - b);
  for (const id of ids) {
    const riverId = PATH_RIVER_ID[id];
    if (!riverId) continue; // unmapped path (none in current data)
    const raster = rasterizeRiverPath(RIVER_PATHS[id]);
    // Clip cells strictly inside the bay so rivers meet the coast without
    // floating over water; keep everything on land / outside the grid.
    const kept = raster.filter(
      (c) => !inBay(c.gx, c.gz) && inStudyBox(c.gx, c.gz),
    );
    if (kept.length === 0) continue;
    const { mouthGx, mouthGz } = computeMouth(kept);
    for (const c of kept) {
      const key = `${c.gz},${c.gx}`;
      if (seen.has(key)) continue; // first river to claim a shared cell keeps it
      seen.add(key);
      cells.push({ gx: c.gx, gz: c.gz, mouthGx, mouthGz, riverId });
    }
  }
  return cells;
})();

// River metadata for hover labels in the 3D view. Rebuilt to cover EVERY id in
// RIVER_PATHS (via PATH_RIVER_ID), so previously-missing rivers — karakuwa
// (path 3), shishiori (11), kamaishi (25) — now label correctly. Keys match the
// riverId slugs assigned above and the canonical RIVERS registry so the 3D view
// labels each river the same way the Map view does.
export const RIVER_META: Record<string, { name: string; subBasin: string }> = {
  shizugawa: { name: "Shizugawa",     subBasin: "Sub-basin 1"  },
  oura:      { name: "Oura",          subBasin: "Sub-basin 2"  },
  karakuwa:  { name: "Karakuwa",      subBasin: "Sub-basin 3"  },
  togura:    { name: "Togura",        subBasin: "Sub-basin 4"  },
  urashiro:  { name: "Urashiro",      subBasin: "Sub-basin 5"  },
  iriya:     { name: "Iriya",         subBasin: "Sub-basin 6"  },
  okawa:     { name: "Okawa",         subBasin: "Sub-basin 7"  },
  niida:     { name: "Niida",         subBasin: "Sub-basin 8"  },
  karakuwa2: { name: "Karakuwa East", subBasin: "Sub-basin 9"  },
  tomaya:    { name: "Tomaya",        subBasin: "Sub-basin 10" },
  shishiori: { name: "Shishiori",     subBasin: "Sub-basin 11" },
  onagawa:   { name: "Onagawa",       subBasin: "Sub-basin 12" },
  hachiman:  { name: "Hachiman",      subBasin: "Sub-basin 13" },
  motoyoshi: { name: "Motoyoshi",     subBasin: "Sub-basin 14" },
  mitobe:    { name: "Mitobe",        subBasin: "Sub-basin 15" },
  sakura:    { name: "Sakura",        subBasin: "Sub-basin 16" },
  oritate:   { name: "Oritate",       subBasin: "Sub-basin 17" },
  kitakami:  { name: "Kitakami",      subBasin: "Sub-basin 18" },
  moriya:    { name: "Moriya",        subBasin: "Sub-basin 20" },
  oya:       { name: "Oya",           subBasin: "Sub-basin 24" },
  kamaishi:  { name: "Kamaishi",      subBasin: "Sub-basin 25" },
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
  if (isPixelId(id)) return PIXEL_REGISTRY.get(id);
  return SUB_BASIN_META.find(b => b.id === id);
}

// ─── Hidden Pixel-mode prototype (Sub-basin tab, ?pixel=1) ───────────────────
// A "pixel" is a virtual 1-ha selection unit that piggy-backs on the
// SubBasinMeta shape so SubBasinComparisonPanel + aggregateSubBasins work
// unchanged.  Pixel ids live in 1001..1026 (letters A..Z) so they never
// collide with real sub-basin ids 1..25.  Registry is in-memory only —
// pixels are ephemeral and not URL-persisted.
export interface PixelMeta extends SubBasinMeta {
  letter: string;          // 'A'..'Z'
  lat:    number;          // simulated, derived from svg coords
  lon:    number;
  svgX:   number;
  svgY:   number;
}

const PIXEL_REGISTRY = new Map<number, PixelMeta>();

export function isPixelId(id: number): boolean {
  return id >= 1001 && id <= 1026;
}

export function pixelLetterToId(letter: string): number {
  return 1000 + (letter.toUpperCase().charCodeAt(0) - 64);
}

export function pixelIdToLetter(id: number): string {
  return String.fromCharCode(64 + (id - 1000));
}

function _pxHash(idx: number, salt: number): number {
  let h = (idx * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/**
 * Build a 1-ha "pixel" indicator profile anchored on the regional baseline,
 * with deterministic per-letter jitter so each pixel reads differently in
 * the radar / bar charts.  Water Flow is treated like every other indicator
 * for prototype simplicity (per the design call: "use the indicators from
 * the sub basin, no need to be realistic").
 */
export function makePixelMeta(letter: string, svgX: number, svgY: number): PixelMeta {
  const li = letter.toUpperCase().charCodeAt(0) - 64;   // 1..26
  const id = 1000 + li;
  const j = (salt: number, lo: number, hi: number) =>
    lo + _pxHash(li, salt) * (hi - lo);

  const indicators: SubBasinIndicators = {
    forestC:    +(SUB_BASIN_BASELINE_AVG.forestC    * j(1, 0.40, 1.60)).toFixed(1),
    soilC:      +(SUB_BASIN_BASELINE_AVG.soilC      * j(2, 0.50, 1.50)).toFixed(1),
    nitrogen:   +(SUB_BASIN_BASELINE_AVG.nitrogen   * j(3, 0.30, 1.70)).toFixed(1),
    phosphorus: +(SUB_BASIN_BASELINE_AVG.phosphorus * j(4, 0.30, 1.70)).toFixed(2),
    waterFlow:  +(SUB_BASIN_BASELINE_AVG.waterFlow  * j(5, 0.40, 1.60)).toFixed(1),
  };

  // Simulated lat/lon mapping over the bay frame (SVG_W=465, SVG_H=586)
  // anchored on Shizugawa Bay (~38.65°N 141.50°E). North is up.
  const lat = +(38.55 + (1 - svgY / 586) * 0.20).toFixed(4);
  const lon = +(141.40 + (svgX / 465) * 0.20).toFixed(4);

  return {
    id,
    name: `Pixel ${letter} · ${lat.toFixed(3)}°N ${lon.toFixed(3)}°E`,
    area_ha:   1,
    elevation: 0,
    landUse:   "mixed",
    indicators,
    letter,
    lat,
    lon,
    svgX,
    svgY,
  };
}

export function registerPixel(p: PixelMeta): void {
  PIXEL_REGISTRY.set(p.id, p);
}

export function unregisterPixel(id: number): void {
  PIXEL_REGISTRY.delete(id);
}

export function getPixel(id: number): PixelMeta | undefined {
  return PIXEL_REGISTRY.get(id);
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
  const decayLen     = 9 * GRID_SUBDIV; // grid units — scales with resolution so the plume's PHYSICAL width is constant across 1×/2×
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

/** Annual nutrient-pulse intensity (0–1) for a given week of the year.
 *  Big spring/early-summer peak around late June (W24) plus a small autumn
 *  rebound near late November (W46), matching the Delft3D reference frames. */
function nutrientPulse(week: number, year: number = 2023): number {
  const yearShift  = (year - 2023) * 1.5;            // small inter-annual jitter
  const w          = week + yearShift;
  // Spring pulse amplitude > 1 so cells a few grid units off the mouth still
  // clamp to deep red at the June peak, giving a visibly large bloom.
  const spring     = 1.4 * Math.exp(-Math.pow((w - 24) / 7, 2));   // σ ≈ 7 weeks
  const autumn     = 0.35 * Math.exp(-Math.pow((w - 46) / 4, 2));  // σ ≈ 4 weeks
  return Math.max(0.05, spring + autumn);
}

export function generateWeekData(week: number, year: number = 2023): number[][][] {
  const t       = (week / TOTAL_WEEKS) * Math.PI * 2 + (year - 2023) * 0.29;
  const pulse   = nutrientPulse(week, year);
  const ambient = 0.05; // baseline blue everywhere — open ocean far from mouths

  const data: number[][][] = [];
  for (let z = 0; z < GRID_D; z++) {
    data[z] = [];
    for (let x = 0; x < GRID_W; x++) {
      data[z][x] = [];
      const sourceField = NUTRIENT_SOURCE_FIELD[z]?.[x] ?? 0;
      // Small wobble so plumes have discrete-cell variability like the
      // real Delft3D output (not perfectly smooth contours).
      // Frequencies divided by GRID_SUBDIV so the speckle keeps the same PHYSICAL
      // scale at 2× (finer cells, not finer noise).
      const wobble =
        Math.sin((x * 0.7) / GRID_SUBDIV + t) * 0.5 +
        Math.cos((z * 0.5) / GRID_SUBDIV + t * 1.1) * 0.5;

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
 * Ocean Playback (3D) variant: same variables expressed as kg-per-voxel
 * (using a single avg voxel volume of ~1e8 L). Used only by `/playback`
 * so River/Basin pages keep their concentration units (mg/L, μg/L).
 */
export const OCEAN_VARIABLE_OPTIONS: VariableOption[] = [
  { id: "nitrogen",   label: "Total Nitrogen",   unit: "kg",   colorScale: "nitrogen",   min: 20,   max: 300, decimals: 0 },
  { id: "phosphorus", label: "Total Phosphorus", unit: "kg",   colorScale: "phosphorus", min: 1,    max: 13,  decimals: 1 },
  { id: "flow",       label: "Water Flow",       unit: "cm/s", colorScale: "flow",       min: 0,    max: 100, decimals: 1 },
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
    case "nitrogen":   return +(value * 2.80 + 0.20).toFixed(2);   // 0.20–3.00 mg/L
    case "phosphorus": return +(value * 120  + 10).toFixed(0);     // 10–130 µg/L
    case "flow":       return +(value * 100).toFixed(1);            // 0–100 cm/s
    default:           return +value.toFixed(3);
  }
}

/**
 * Ocean Playback (3D) variant: returns kg-per-voxel for nitrogen and
 * phosphorus (concentration × avg voxel volume of ~1e8 L). Flow is
 * untouched. Used only by `/playback`; River/Basin pages keep
 * `valueToConcentration` (mg/L, μg/L).
 */
export function valueToVoxelMassKg(value: number, variableId: string): number {
  switch (variableId) {
    case "nitrogen":   return +((value * 2.80 + 0.20) * 100).toFixed(0);  // 20–300 kg
    case "phosphorus": return +((value * 120  + 10)   * 0.1).toFixed(1);  // 1–13 kg
    case "flow":       return +(value * 100).toFixed(1);                   // 0–100 cm/s
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
// Generated by evenly subdividing the 8 base bands by DEPTH_SUBDIV (see top of
// file). At DEPTH_SUBDIV=1 these equal the original hand-authored 8-layer arrays.

/** Scene-unit height of each depth layer (layer 0 = surface, thinnest) */
export const DEPTH_HEIGHTS: number[] = BASE_HEIGHTS.flatMap((h) =>
  Array.from({ length: DEPTH_SUBDIV }, () => (h / DEPTH_SUBDIV) * VERT_EXAG),
);

/** Real meter depth at the TOP surface of each layer */
export const DEPTH_REAL_M: number[] = BASE_REAL_TOP.flatMap((top, i) => {
  const span = BASE_REAL_BOT[i] - top;
  return Array.from({ length: DEPTH_SUBDIV }, (_, k) => top + (span * k) / DEPTH_SUBDIV);
});

/** Real meter depth at the BOTTOM of each layer (pairs with DEPTH_REAL_M) */
export const DEPTH_REAL_BOT: number[] = BASE_REAL_TOP.flatMap((top, i) => {
  const span = BASE_REAL_BOT[i] - top;
  return Array.from({ length: DEPTH_SUBDIV }, (_, k) => top + (span * (k + 1)) / DEPTH_SUBDIV);
});

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
  /** Weeks for the measure to ramp from 0 → full effect */
  rampWeeks: number;
}

export const DECARB_MEASURES: DecarbMeasure[] = [
  { id: "none",                    label: "No measure (baseline)",      short: "Baseline",       desc: "Current trajectory — no decarbonization measure applied.",                                                                  carbonBoost: 0,   channels: { seagrass: 0,   macroalgae: 0, oyster: 0 }, hsiBoost: 0,    rampWeeks: 1  },
  { id: "plant-eelgrass",          label: "Plant eelgrass meadow",      short: "Eelgrass",       desc: "Replant Zostera marina across the project area — direct seagrass-carbon sequestration.",                                   carbonBoost: 2.4, channels: { seagrass: 2.4, macroalgae: 0, oyster: 0 }, hsiBoost: 0.20, rampWeeks: 18 },
  { id: "restore-reef",            label: "Restore oyster reef",        short: "Oyster reef",    desc: "Rebuild oyster reef structure — filter-feeders clarify the water column so eelgrass beds expand and trap more carbon.",   carbonBoost: 0.8, channels: { seagrass: 0.8, macroalgae: 0, oyster: 0 }, hsiBoost: 0.18, rampWeeks: 10 },
  { id: "reduce-runoff",           label: "Reduce upstream N/P load",   short: "Reduce runoff",  desc: "Cut nitrogen + phosphorus runoff from the watershed — improves light penetration and lets seagrass meadows thrive.",     carbonBoost: 1.0, channels: { seagrass: 1.0, macroalgae: 0, oyster: 0 }, hsiBoost: 0.16, rampWeeks: 24 },
  { id: "tidal-flat-restoration",  label: "Restore tidal flats",        short: "Tidal flat",     desc: "Restore intertidal sediment flats — adjacent habitat lifts seagrass HSI and modestly boosts sequestration.",             carbonBoost: 0.5, channels: { seagrass: 0.5, macroalgae: 0, oyster: 0 }, hsiBoost: 0.12, rampWeeks: 16 },
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
/** Internal: HSI given a precomputed weekly field. */
function hsiFromField(data: number[][][], week: number, x: number, z: number): number {
  const col = getColumnMean(data, x, z);
  const optimum = 0.45;
  const proximity = 1 - Math.min(1, Math.abs(col - optimum) / 0.5);
  const fitness  = 1 - seagrassSiteFitness(x, z) * 0.6;
  const seasonal = 0.92 + 0.08 * Math.sin((week / TOTAL_WEEKS) * Math.PI * 2);
  return Math.max(0, Math.min(1, proximity * fitness * seasonal));
}

export function getBaselineHsi(week: number, year: number, x: number, z: number): number {
  return hsiFromField(generateWeekData(week, year), week, x, z);
}

/**
 * Baseline seagrass carbon flux (tCO₂e/ha/yr) at an ocean cell for a given
 * week. Cells outside the seagrass-suitable belt get near-zero flux.
 */
/** Internal: carbon flux given a precomputed weekly field. */
function carbonFromField(data: number[][][], week: number, x: number, z: number): number {
  const fit = 1 - seagrassSiteFitness(x, z);
  if (fit < 0.15) return 0;
  const hsi = hsiFromField(data, week, x, z);
  const seasonal = 0.6 + 0.4 * Math.sin((week / TOTAL_WEEKS) * Math.PI * 2 - 0.5);
  return fit * hsi * 3.2 * seasonal;
}

export function getBaselineCarbonFlux(week: number, year: number, x: number, z: number): number {
  return carbonFromField(generateWeekData(week, year), week, x, z);
}

/** Ramp factor 0→1 representing measure effectiveness over time. */
function measureRamp(weeksApplied: number, rampWeeks: number): number {
  if (weeksApplied <= 0) return 0;
  return Math.min(1, weeksApplied / Math.max(1, rampWeeks));
}

/**
 * HSI under a decarbonization-measure scenario. `appliedAtWeek` is the
 * playback week at which the measure was switched on (0 = start of period).
 */
export function getScenarioHsi(
  week: number, year: number, x: number, z: number,
  measureId: MeasureId, appliedAtWeek: number = 0,
): number {
  const baseline = getBaselineHsi(week, year, x, z);
  if (measureId === "none") return baseline;
  const m = getMeasure(measureId);
  const ramp = measureRamp(week - appliedAtWeek, m.rampWeeks);
  return Math.max(0, Math.min(1, baseline + m.hsiBoost * ramp));
}

/**
 * Seagrass carbon flux under a measure scenario.
 */
export function getScenarioCarbonFlux(
  week: number, year: number, x: number, z: number,
  measureId: MeasureId, appliedAtWeek: number = 0,
): number {
  const baseline = getBaselineCarbonFlux(week, year, x, z);
  if (measureId === "none") return baseline;
  const m = getMeasure(measureId);
  const ramp = measureRamp(week - appliedAtWeek, m.rampWeeks);
  // "Plant eelgrass" can introduce flux on cells with low fitness too —
  // assume planting succeeds where HSI scenario is decent.
  const introduced = (measureId === "plant-eelgrass" && baseline === 0)
    ? ramp * 1.6
    : 0;
  return baseline * (1 + m.carbonBoost * ramp) + introduced;
}

/**
 * Convenience: weekly time series of (baseline, scenario) values across the
 * playback range. Returns array length (toWeek - fromWeek + 1).
 */
export function buildHsiSeries(
  fromWeek: number, toWeek: number, year: number,
  x: number, z: number, measureId: MeasureId, appliedAtWeek: number = 0,
): { week: number; baseline: number; scenario: number }[] {
  const m = getMeasure(measureId);
  const out: { week: number; baseline: number; scenario: number }[] = [];
  for (let w = fromWeek; w <= toWeek; w++) {
    const data = generateWeekData(w, year);
    const baseline = hsiFromField(data, w, x, z);
    const scenario = measureId === "none"
      ? baseline
      : Math.max(0, Math.min(1, baseline + m.hsiBoost * measureRamp(w - appliedAtWeek, m.rampWeeks)));
    out.push({ week: w, baseline, scenario });
  }
  return out;
}

export function buildCarbonSeries(
  fromWeek: number, toWeek: number, year: number,
  x: number, z: number, measureId: MeasureId, appliedAtWeek: number = 0,
): { week: number; baselineRate: number; scenarioRate: number; baselineCum: number; scenarioCum: number }[] {
  const m = getMeasure(measureId);
  const weekFrac = 1 / TOTAL_WEEKS;
  let bCum = 0, sCum = 0;
  const out: { week: number; baselineRate: number; scenarioRate: number; baselineCum: number; scenarioCum: number }[] = [];
  for (let w = fromWeek; w <= toWeek; w++) {
    const data = generateWeekData(w, year);
    const bRate = carbonFromField(data, w, x, z);
    let sRate = bRate;
    if (measureId !== "none") {
      const ramp = measureRamp(w - appliedAtWeek, m.rampWeeks);
      const introduced = (measureId === "plant-eelgrass" && bRate === 0) ? ramp * 1.6 : 0;
      sRate = bRate * (1 + m.carbonBoost * ramp) + introduced;
    }
    bCum += bRate * weekFrac;
    sCum += sRate * weekFrac;
    out.push({ week: w, baselineRate: bRate, scenarioRate: sRate, baselineCum: bCum, scenarioCum: sCum });
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

/** Per-channel baseline carbon flux (tCO₂e/ha/yr) at a cell, given a precomputed weekly field. */
function channelBaselineRate(
  channel: CarbonChannel,
  data: number[][][], week: number, x: number, z: number,
): number {
  const fit = CHANNEL_FITNESS[channel](x, z);
  if (fit < 0.15) return 0;
  const hsi = hsiFromField(data, week, x, z);
  const phase = CHANNEL_SEASON_PHASE[channel];
  const seasonal = 0.6 + 0.4 * Math.sin((week / TOTAL_WEEKS) * Math.PI * 2 + phase);
  return fit * hsi * CHANNEL_MAX_FLUX[channel] * seasonal;
}

export interface BlueCarbonPoint {
  week: number;
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
 * Weekly time series of blue-carbon flux + per-channel breakdown for one
 * cell under a measure scenario. Channels: seagrass, macroalgae, oyster.
 */
export function buildBlueCarbonSeries(
  fromWeek: number, toWeek: number, year: number,
  x: number, z: number, measureId: MeasureId, appliedAtWeek: number = 0,
): BlueCarbonPoint[] {
  const m = getMeasure(measureId);
  const weekFrac = 1 / TOTAL_WEEKS;
  // Seagrass is now the only blue-carbon channel modeled. The macroalgae and
  // oyster fields on ChannelBoosts are kept (typed as 0) for backward
  // compatibility with any persisted data shape.
  const channels: CarbonChannel[] = ["seagrass"];
  const cumBase  = { seagrass: 0, macroalgae: 0, oyster: 0 };
  const cumScen  = { seagrass: 0, macroalgae: 0, oyster: 0 };
  let bCumTotal = 0, sCumTotal = 0;
  const out: BlueCarbonPoint[] = [];
  for (let w = fromWeek; w <= toWeek; w++) {
    const data = generateWeekData(w, year);
    const ramp = measureRamp(w - appliedAtWeek, m.rampWeeks);
    let bRateTotal = 0, sRateTotal = 0;
    const channelsRate: ChannelBoosts = { seagrass: 0, macroalgae: 0, oyster: 0 };
    for (const ch of channels) {
      const bRate = channelBaselineRate(ch, data, w, x, z);
      const boost = m.channels[ch];
      // "introduced" capacity: a measure can produce flux on previously zero-fitness
      // cells (e.g. cultivating macroalgae where there is none today).
      const introduced = (bRate === 0 && boost > 0) ? ramp * 0.6 * boost : 0;
      const sRate = bRate * (1 + boost * ramp) + introduced;
      channelsRate[ch] = sRate;
      cumBase[ch] += bRate * weekFrac;
      cumScen[ch] += sRate * weekFrac;
      bRateTotal += bRate;
      sRateTotal += sRate;
    }
    bCumTotal += bRateTotal * weekFrac;
    sCumTotal += sRateTotal * weekFrac;
    out.push({
      week: w,
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
