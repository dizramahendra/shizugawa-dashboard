/**
 * LAND / OPEN-SEA membership for the 3D scene, derived from the REAL coastline.
 *
 * Previously this module approximated the coast by sampling the SUB_BASIN_PATHS
 * watershed polygons + a per-column bay-shore heuristic + flood fills. That left
 * the SE Mt-Horowa / Cape-Kamiwarisaki peninsula and the bay mouth in the wrong
 * place. It now classifies from `realCoast.ts` — a land/water bitmap traced
 * pixel-by-pixel off the live Esri basemap over the EXACT study-box extent (see
 * realCoast.ts for provenance) — so the shoreline follows the actual coast.
 *
 * Pipeline (pure, no DOM):
 *   1. `isRealWater(gx,gz)` gives the true water/land of every extended-grid cell
 *      (voxel grid GRID_W×GRID_D plus a LAND_RING=16 border). The baked bitmap
 *      covers exactly this range.
 *   2. OPEN SEA = the Pacific frontier: real water, NOT the interactive bay,
 *      NOT an island, NOT a river channel, AND connected (4-neighbour flood
 *      seeded from the EAST edge column) out to the open Pacific. The bay,
 *      islands and land are barriers, so the ocean cannot leak inland, and
 *      real-water pockets with no path to the east (stray ponds / basemap noise)
 *      never become sea.
 *   3. LAND = every extended-grid cell that is NOT open sea, NOT bay, NOT island,
 *      NOT a river channel. This makes solid land come right up to the real
 *      shoreline on all sides (and up to the drawn bay along its shore), with the
 *      open Pacific carved out only where the map actually shows open water.
 *
 * The interactive bay stays exactly BAY_MASK (user-drawn) and rivers/islands are
 * untouched — only the surrounding land ↔ open-sea split is re-grounded on the
 * traced coast.
 */
import { GRID_W, GRID_D, GRID_SUBDIV, BAY_MASK, RIVER_CELLS } from "@/lib/simulatedData";
import { isIsland } from "@/lib/islands";
import { isRealWater } from "@/lib/realCoast";

/** Land border beyond the voxel grid, in cells. NORTH / EAST / SOUTH use
 *  LAND_RING; the WEST side uses a much larger LAND_RING_W so the study box grows
 *  INLAND to include the upstream river network — Shizugawa / Okawa / Mitobe reach
 *  the bay through the sub-basin rivers, ~40–60 cells west of the grid. Both scale
 *  with GRID_SUBDIV so their PHYSICAL width is constant across 1×/2×. West cells
 *  beyond realCoast's baked range read as land (no ocean inland) — correct. */
export const LAND_RING   = 16 * GRID_SUBDIV; // north / east / south
export const LAND_RING_W = 56 * GRID_SUBDIV; // west (inland watershed + rivers)

/** Extended-grid bounds (inclusive min, exclusive max) the mask + terrain cover. */
export const EXT_GX_MIN = -LAND_RING_W;
export const EXT_GX_MAX = GRID_W + LAND_RING;
export const EXT_GZ_MIN = -LAND_RING;
export const EXT_GZ_MAX = GRID_D + LAND_RING;

export interface LandMask {
  /** Border ring size in cells beyond [0, GRID) on N/E/S (west is LAND_RING_W). */
  ring: number;
  /** Extended-grid bounds this mask covers (asymmetric: west is wider). */
  gxMin: number; gxMax: number; gzMin: number; gzMax: number;
  /** True when grid cell (gx, gz) — possibly outside [0, GRID) — is land. */
  isLand(gx: number, gz: number): boolean;
  /** True when grid cell (gx, gz) is open sea (reached by the east flood). */
  isOpenSea(gx: number, gz: number): boolean;
}

let cached: LandMask | null = null;

/**
 * True when grid cell (gx, gz) is OPEN SEA — the Pacific frontier connected to
 * the EAST edge of the study box. Every cell that is inside the extended box and
 * is NOT open sea, bay, island or river is land.
 */
export function isOpenSea(gx: number, gz: number): boolean {
  return getLandMask().isOpenSea(gx, gz);
}

/** Builds (and caches) the land / open-sea masks from the real coastline. */
export function getLandMask(): LandMask {
  if (cached) return cached;

  const ring = LAND_RING;
  const w = EXT_GX_MAX - EXT_GX_MIN;
  const d = EXT_GZ_MAX - EXT_GZ_MIN;
  const riverSet = new Set(RIVER_CELLS.map((c) => `${c.gz},${c.gx}`));

  // Local (extended-grid) index space: lx∈[0,w), lz∈[0,d).
  // lx = gx − EXT_GX_MIN, lz = gz − EXT_GZ_MIN  ⇔  gx = lx + EXT_GX_MIN, gz = lz + EXT_GZ_MIN.
  const isBay = (gx: number, gz: number): boolean =>
    gx >= 0 && gx < GRID_W && gz >= 0 && gz < GRID_D && !!BAY_MASK[gz]?.[gx];
  const isRiver = (gx: number, gz: number): boolean =>
    riverSet.has(`${gz},${gx}`);

  // ── East flood: OPEN SEA = real water connected to the EAST (Pacific) edge ───
  // Passable ("open water"): real water that is NOT the interactive bay, NOT an
  // island, NOT a river channel. Barriers: land (not real water), bay, islands,
  // rivers. Seeded from the whole east-edge column so only water that reaches the
  // Pacific frontier is sea; enclosed real-water pockets stay out of the sea set.
  const sea = new Uint8Array(w * d);
  {
    const isOpenWater = (lx: number, lz: number): boolean => {
      const gx = lx + EXT_GX_MIN;
      const gz = lz + EXT_GZ_MIN;
      if (!isRealWater(gx, gz)) return false; // land on the real basemap
      if (isBay(gx, gz)) return false;        // interactive bay = its own volume
      if (isIsland(gx, gz)) return false;     // island footprint = land
      if (isRiver(gx, gz)) return false;      // river channel = not open sea
      return true;
    };

    const stack: number[] = [];
    const pushIfSea = (lx: number, lz: number) => {
      if (lx < 0 || lx >= w || lz < 0 || lz >= d) return;
      const i = lz * w + lx;
      if (sea[i]) return;
      if (!isOpenWater(lx, lz)) return;
      sea[i] = 1;
      stack.push(i);
    };

    // Seed the entire EAST-edge column (lx = w − 1).
    for (let lz = 0; lz < d; lz++) pushIfSea(w - 1, lz);

    while (stack.length > 0) {
      const i = stack.pop()!;
      const lx = i % w;
      const lz = (i - lx) / w;
      pushIfSea(lx - 1, lz);
      pushIfSea(lx + 1, lz);
      pushIfSea(lx, lz - 1);
      pushIfSea(lx, lz + 1);
    }
  }

  // ── Derive final LAND from the sea set ───────────────────────────────────────
  // A cell is land when it is inside the extended box and is NOT open sea, NOT
  // bay, NOT island, NOT a river channel. Real-water pockets not reached by the
  // east flood fall through to land here (filled), so no stray ponds render.
  const landMaskArr = new Uint8Array(w * d);
  for (let lz = 0; lz < d; lz++) {
    for (let lx = 0; lx < w; lx++) {
      const i = lz * w + lx;
      if (sea[i]) continue; // open sea
      const gx = lx + EXT_GX_MIN;
      const gz = lz + EXT_GZ_MIN;
      if (isBay(gx, gz)) continue;    // bay water
      if (isIsland(gx, gz)) continue; // island (carries its own mound)
      if (isRiver(gx, gz)) continue;  // river channel
      landMaskArr[i] = 1;             // everything else in the box → land
    }
  }

  cached = {
    ring,
    gxMin: EXT_GX_MIN, gxMax: EXT_GX_MAX, gzMin: EXT_GZ_MIN, gzMax: EXT_GZ_MAX,
    isLand(gx: number, gz: number): boolean {
      const x = gx - EXT_GX_MIN;
      const z = gz - EXT_GZ_MIN;
      if (x < 0 || x >= w || z < 0 || z >= d) return false;
      return landMaskArr[z * w + x] === 1;
    },
    isOpenSea(gx: number, gz: number): boolean {
      const x = gx - EXT_GX_MIN;
      const z = gz - EXT_GZ_MIN;
      if (x < 0 || x >= w || z < 0 || z >= d) return false;
      return sea[z * w + x] === 1;
    },
  };
  return cached;
}
