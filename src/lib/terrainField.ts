/**
 * Unified solid-ground elevation field E(gx, gz) for the 3D ocean basin.
 *
 * This replaces the old "three hollow shells" model (separate land / seabed /
 * island meshes) with ONE continuous ground-surface elevation — the world-Y of
 * the SOLID EARTH top at every cell of the extended (LAND_RING) grid. Rendering
 * a solid column from E(gx,gz) down to the box bottom then reads as real earth:
 * land slopes down the coast into the seabed with no cliff and no hollows.
 *
 * The field is DERIVED from the existing classification + bathymetry — it does
 * NOT change land/sea membership, islands, rivers or the nutrient data. It only
 * decides the SHAPE of the ground:
 *
 *   • Water (bay)  → E = the seabed BELOW sea level. Uses exactly the voxel
 *                    column bottom (deepestVisibleLayer of the island-apron
 *                    bathymetry) so the nutrient voxels sit ON the ground with
 *                    no gap/overlap. Shallow near shore → deeper offshore.
 *   • Open sea     → E = seabed below sea level too (the open Pacific floor),
 *                    carrying the bathymetry outward so the sea has a floor.
 *   • Land         → E = ABOVE sea level, rising gradually from ~0 at the coast
 *                    to LAND_MAX_H inland (distance-to-nearest-water × per-cell
 *                    rise). This makes the shore meet sea level and climb inland
 *                    = a real coastal slope.
 *   • Island       → E = ABOVE sea level with a local peak (reuses islands.ts
 *                    peakT, smoothed), tapering to ~0 at the island shore.
 *
 * Continuity: at the shoreline the land side is ≈ sea level and the water side
 * is the shallowest voxel column, so E is continuous across the coast (only the
 * unavoidable quantised-voxel step of the topmost layer, which reads as a beach
 * rather than a cliff). A light neighbour-average smoothing pass on LAND/ISLAND
 * cells makes the inland slopes read gradually.
 *
 * Pure module: depends on landMask/islands classification + bathymetry helpers
 * passed in, so OceanBasin3D keeps its single default export (Fast Refresh).
 */
import { GRID_W, GRID_D } from "@/lib/simulatedData";
import { getLandMask, isOpenSea, LAND_RING } from "@/lib/landMask";

// ── Tunables ──────────────────────────────────────────────────────────────────
/** Max scene-units the land rises ABOVE sea level, far inland. Comparable to
 *  the old LAND_TOP rise (0.7) but a touch taller so hills read; still well
 *  under the water column so the ocean stays the dominant mass. */
export const LAND_MAX_H = 1.1;
/** Scene-units the land climbs per grid cell of distance from the coast. At
 *  ~0.09/cell the land reaches LAND_MAX_H ~12 cells inland — a gentle coastal
 *  slope, not a wall. */
export const PER_CELL_RISE = 0.09;
/** Scene-units the island centroid rises above sea level (peak). Matches the
 *  old ISLAND_PEAK_H so the islands read the same. */
export const ISLAND_PEAK_H = 1.0;

export type CellKind = "water" | "opensea" | "land" | "island" | "none";

export interface TerrainField {
  ring: number;
  /** Grid X range (inclusive-exclusive) covered: [gxMin, gxMax). */
  gxMin: number; gxMax: number;
  gzMin: number; gzMax: number;
  /** Classification of a cell (extended-grid coords). "none" = river/outside. */
  kind(gx: number, gz: number): CellKind;
  /** Ground-top world-Y at a cell CENTRE (the value used for a flat column top). */
  elev(gx: number, gz: number): number;
  /** Ground-top world-Y at a grid CORNER (gx,gz), averaged over the ≤4 sharing
   *  cells so adjacent columns share vertex heights → smooth continuous slopes.
   *  Corners touching only non-ground cells return NaN (caller uses the flat
   *  cell elevation there instead). */
  cornerElev(gx: number, gz: number): number;
}

export interface TerrainFieldDeps {
  /** Y of the water surface (Y_SURFACE in the scene). */
  Y_SURFACE: number;
  /** true when (gx,gz) is bay water (BAY_MASK && !isIsland). */
  isBayWater(gx: number, gz: number): boolean;
  /** true when (gx,gz) is an island footprint cell. */
  isIsland(gx: number, gz: number): boolean;
  /** peakT (0 shore → 1 peak) for an island cell, or null if not island. */
  islandPeakT(gx: number, gz: number): number | null;
  /** Scene-Y of the BOTTOM of the deepest water voxel at a bay cell — i.e. the
   *  seabed the voxels sit on. Must equal the voxel clip so there is no gap.
   *  Returns null when the cell has no visible water column. */
  bayColumnBottomY(gx: number, gz: number): number | null;
  /** World-Y of the seabed for an open-sea cell (continuous bathymetry floor). */
  openSeaSeabedY(gx: number, gz: number): number;
}

/**
 * Builds the terrain field once (cached). Browser-only because it reads the
 * land mask (which needs the DOM).
 */
export function buildTerrainField(deps: TerrainFieldDeps): TerrainField {
  const { Y_SURFACE, isBayWater, isIsland, islandPeakT, bayColumnBottomY, openSeaSeabedY } = deps;
  const mask = getLandMask();
  const ring = mask.ring;

  // Asymmetric extended-grid bounds (west is wider — the inland river network).
  const gxMin = mask.gxMin, gxMax = mask.gxMax;
  const gzMin = mask.gzMin, gzMax = mask.gzMax;
  const w = gxMax - gxMin;
  const d = gzMax - gzMin;
  const idx = (gx: number, gz: number) => (gz - gzMin) * w + (gx - gxMin);
  const inExt = (gx: number, gz: number) =>
    gx >= gxMin && gx < gxMax && gz >= gzMin && gz < gzMax;

  // ── Classification pass ──────────────────────────────────────────────────────
  const kindArr = new Uint8Array(w * d); // 0 none,1 water,2 opensea,3 land,4 island
  const K = { none: 0, water: 1, opensea: 2, land: 3, island: 4 } as const;
  const classify = (gx: number, gz: number): number => {
    if (isBayWater(gx, gz)) return K.water;       // bay water column (inside grid)
    if (isIsland(gx, gz)) return K.island;        // island footprint = land mound
    if (mask.isLand(gx, gz)) return K.land;       // surrounding solid land
    if (isOpenSea(gx, gz)) return K.opensea;      // Pacific floor
    return K.none;                                // river channel / gap
  };
  for (let gz = gzMin; gz < gzMax; gz++) {
    for (let gx = gxMin; gx < gxMax; gx++) {
      kindArr[idx(gx, gz)] = classify(gx, gz);
    }
  }
  const kindOf = (gx: number, gz: number): number =>
    inExt(gx, gz) ? kindArr[idx(gx, gz)] : K.none;
  const isWaterKind = (k: number) => k === K.water || k === K.opensea;

  // ── Distance-to-coast (multi-source BFS from every water cell) ───────────────
  // distToWater[cell] = Chebyshev-ish grid-cell distance from the cell to the
  // nearest bay/open-sea cell. Drives the land/island rise so the shore meets
  // sea level and the ground climbs gradually inland. 8-connectivity gives a
  // rounder (less axis-biased) distance ramp.
  const dist = new Float32Array(w * d).fill(Infinity);
  {
    const q: number[] = [];
    for (let gz = gzMin; gz < gzMax; gz++) {
      for (let gx = gxMin; gx < gxMax; gx++) {
        if (isWaterKind(kindArr[idx(gx, gz)])) {
          dist[idx(gx, gz)] = 0;
          q.push(idx(gx, gz));
        }
      }
    }
    let head = 0;
    while (head < q.length) {
      const i = q[head++];
      const lx = i % w, lz = (i - lx) / w;
      const gx = lx + gxMin, gz = lz + gzMin;
      const base = dist[i];
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = gx + dx, nz = gz + dz;
          if (!inExt(nx, nz)) continue;
          const ni = idx(nx, nz);
          // Diagonal step ≈ 1.41, orthogonal = 1 → rounder ramp.
          const step = dx !== 0 && dz !== 0 ? Math.SQRT2 : 1;
          if (base + step < dist[ni]) {
            dist[ni] = base + step;
            q.push(ni);
          }
        }
      }
    }
  }
  const distToWater = (gx: number, gz: number): number =>
    inExt(gx, gz) ? dist[idx(gx, gz)] : Infinity;

  // ── Raw elevation per cell ───────────────────────────────────────────────────
  // Land: rise with distance from the coast, capped at LAND_MAX_H.
  const landHeight = (gx: number, gz: number): number => {
    const dc = distToWater(gx, gz);
    if (!Number.isFinite(dc)) return LAND_MAX_H;
    return Math.min(LAND_MAX_H, dc * PER_CELL_RISE);
  };
  // Island: peak height from peakT (peak at centroid → 0 at shore). Guaranteed
  // to sit at/above the surrounding land height so the mound reads as a hill.
  const islandHeight = (gx: number, gz: number): number => {
    const t = islandPeakT(gx, gz);
    const peak = t === null ? 0 : Math.max(0, Math.min(1, t)) * ISLAND_PEAK_H;
    // Blend with the coastal land rise so an island cell never dips BELOW the
    // land it's part of (matters for the dilated island ring near the shore).
    return Math.max(peak, Math.min(LAND_MAX_H, distToWater(gx, gz) * PER_CELL_RISE));
  };

  const rawElev = (gx: number, gz: number): number => {
    const k = kindOf(gx, gz);
    switch (k) {
      case K.water: {
        const y = bayColumnBottomY(gx, gz);
        // A water cell with no visible column (shouldn't happen for valid bay
        // cells) falls back to sea level so it never floats above the surface.
        return y === null ? Y_SURFACE : y;
      }
      case K.opensea:
        return openSeaSeabedY(gx, gz);
      case K.land:
        return Y_SURFACE + landHeight(gx, gz);
      case K.island:
        return Y_SURFACE + islandHeight(gx, gz);
      default:
        return Y_SURFACE; // "none" (river/gap): treat top at sea level
    }
  };

  // ── Light smoothing of the ABOVE-WATER surface (land + island) ───────────────
  // A single neighbour-average pass over land/island cells softens the stair-
  // stepping of the discrete distance ramp so inland slopes read gradually.
  // Water/open-sea elevations are LEFT UNTOUCHED so the seabed still equals the
  // voxel column bottom exactly (no gap under the voxels).
  const smooth = new Float32Array(w * d);
  for (let gz = gzMin; gz < gzMax; gz++) {
    for (let gx = gxMin; gx < gxMax; gx++) {
      const i = idx(gx, gz);
      const k = kindArr[i];
      const base = rawElev(gx, gz);
      if (k !== K.land && k !== K.island) { smooth[i] = base; continue; }
      let sum = base, n = 1;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = gx + dx, nz = gz + dz;
          const nk = kindOf(nx, nz);
          if (nk === K.land || nk === K.island) { sum += rawElev(nx, nz); n++; }
        }
      }
      smooth[i] = sum / n;
    }
  }
  const elevAt = (gx: number, gz: number): number =>
    inExt(gx, gz) ? smooth[idx(gx, gz)] : Y_SURFACE;

  // ── Corner elevation (shared vertex height → continuous surface) ─────────────
  // Average the elevation of the ≤4 GROUND cells sharing corner (gx,gz). Corners
  // touching only "none" cells return NaN so the caller uses flat cell tops there.
  const cornerElev = (cornerGx: number, cornerGz: number): number => {
    let sum = 0, n = 0;
    for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
      const gx = cornerGx + dx, gz = cornerGz + dz;
      if (!inExt(gx, gz)) continue;
      if (kindArr[idx(gx, gz)] === K.none) continue;
      sum += elevAt(gx, gz);
      n++;
    }
    return n > 0 ? sum / n : NaN;
  };

  const kindName = (k: number): CellKind =>
    k === K.water ? "water" : k === K.opensea ? "opensea"
      : k === K.land ? "land" : k === K.island ? "island" : "none";

  return {
    ring,
    gxMin, gxMax, gzMin, gzMax,
    kind: (gx, gz) => kindName(kindOf(gx, gz)),
    elev: elevAt,
    cornerElev,
  };
}

/** Convenience: the extended-grid ring size (re-exported for callers). */
export { LAND_RING };
