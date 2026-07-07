/**
 * Islands of Shizugawa Bay — Arajima and Tsubakishima.
 *
 * OCEAN_BASIN_PATH (svgPaths.ts) is THREE concatenated subpaths:
 *   subpath[0] = the bay outline,
 *   subpath[1] = one island, subpath[2] = the other island (holes in the ocean).
 * The bay voxel field previously ignored the holes, so those cells rendered as
 * water. This module derives the two island footprints in GRID space using the
 * SAME SVG→grid affine the bay polygon + rivers use, so an island lands exactly
 * where the hole is punched out of the ocean outline.
 *
 * Pipeline (pure JS, DOM-free — runs at module load, like RIVER_CELLS):
 *   1. Split OCEAN_BASIN_PATH into subpaths; take [1] and [2].
 *   2. Sample each with sampleSvgPath (M/L/H/V/C). Island subpaths close with
 *      `Z`, which sampleSvgPath throws on, so we strip the trailing Z first —
 *      point-in-polygon closes the ring implicitly.
 *   3. Transform each sampled point SVG→grid (same affine as svgToGrid in
 *      simulatedData.ts) to build a fractional-grid polygon.
 *   4. Rasterize: a cell (gx,gz) is island when its centre is inside the polygon.
 *
 * Exports pure, deterministic data + helpers so OceanBasin3D can (a) subtract
 * islands from bay water, (b) build a shallowing underwater apron, and (c)
 * render each island as a tapering mound (peak at centroid → waterline at edge).
 */
import { OCEAN_BASIN_PATH } from "@/lib/svgPaths";
import { sampleSvgPath } from "@/lib/svgSample";
import { GRID_W, GRID_D, GRID_SUBDIV } from "@/lib/simulatedData";

// SVG canvas + affine — identical to simulatedData.ts's svgToGrid / BAY_POLYGON.
const SVG_W = 465;
const SVG_H = 586;
function svgToGridF(sx: number, sy: number): { gx: number; gz: number } {
  const rawNx = sx / SVG_W;
  const rawNz = 1 - sy / SVG_H;
  const nx = (rawNx - 0.4631) * 2.1565 + 0.03;
  const nz = (rawNz - 0.2846) * 2.1565 + 0.0919;
  return { gx: nx * GRID_W, gz: nz * GRID_D };
}

function pointInPolyGrid(px: number, pz: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (((zi > pz) !== (zj > pz)) && (px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

export interface IslandCell {
  gx: number;
  gz: number;
  /** 0 at the island edge → 1 at the peak cell (drives mound height). */
  peakT: number;
}

export interface Island {
  /** Cells (grid coords) whose centre is inside the island polygon. */
  cells: IslandCell[];
  /** Cell-set centroid, in grid coords (mound peak location). */
  centroidGx: number;
  centroidGz: number;
  /** Max cell distance from centroid — used to normalise the mound taper. */
  maxRadius: number;
}

// Split the concatenated path on each moveto; subpaths [1..] are the islands.
function splitSubpaths(d: string): string[] {
  return d
    .split(/(?=M)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildIsland(subpath: string): Island {
  // Strip trailing Z (sampleSvgPath supports only M/L/H/V/C); the ring is
  // implicitly closed by the point-in-polygon test.
  const cleaned = subpath.replace(/[Zz]\s*$/, "").trim();
  const pts = sampleSvgPath(cleaned, 0.5);
  const poly: Array<[number, number]> = pts.map((p) => {
    const g = svgToGridF(p.x, p.y);
    return [g.gx, g.gz];
  });

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const raw: Array<{ gx: number; gz: number }> = [];
  for (let gz = Math.floor(minZ) - 1; gz <= Math.ceil(maxZ) + 1; gz++) {
    for (let gx = Math.floor(minX) - 1; gx <= Math.ceil(maxX) + 1; gx++) {
      if (gx < 0 || gx >= GRID_W || gz < 0 || gz >= GRID_D) continue;
      if (pointInPolyGrid(gx + 0.5, gz + 0.5, poly)) raw.push({ gx, gz });
    }
  }

  // Showcase exaggeration: real Arajima/Tsubakishima are tiny (13 & 8 cells), so
  // dilate each footprint by a 1-cell ring so they read as landmark islands
  // rather than specks (paired with a taller peak + wider apron below).
  const ISLAND_DILATE = GRID_SUBDIV; // 1 base cell, scaled so islands keep a constant physical footprint at 2×
  if (raw.length) {
    const have = new Set(raw.map((c) => `${c.gz},${c.gx}`));
    const ringCells: Array<{ gx: number; gz: number }> = [];
    for (const c of raw) {
      for (let dz = -ISLAND_DILATE; dz <= ISLAND_DILATE; dz++) {
        for (let dx = -ISLAND_DILATE; dx <= ISLAND_DILATE; dx++) {
          const gx = c.gx + dx, gz = c.gz + dz;
          if (gx < 0 || gx >= GRID_W || gz < 0 || gz >= GRID_D) continue;
          const k = `${gz},${gx}`;
          if (have.has(k)) continue;
          have.add(k);
          ringCells.push({ gx, gz });
        }
      }
    }
    raw.push(...ringCells);
  }

  let cgx = 0, cgz = 0;
  for (const c of raw) { cgx += c.gx; cgz += c.gz; }
  const centroidGx = raw.length ? cgx / raw.length : (minX + maxX) / 2;
  const centroidGz = raw.length ? cgz / raw.length : (minZ + maxZ) / 2;

  // Peak taper: 1 at the centroid cell, → 0 at the outermost cell. Uses the
  // island's own max cell-radius so a big island and a small island both taper
  // smoothly from a single central peak down to their waterline.
  let maxRadius = 0;
  for (const c of raw) {
    const r = Math.hypot(c.gx + 0.5 - (centroidGx + 0.5), c.gz + 0.5 - (centroidGz + 0.5));
    if (r > maxRadius) maxRadius = r;
  }
  const denom = maxRadius > 0 ? maxRadius : 1;

  const cells: IslandCell[] = raw.map((c) => {
    const r = Math.hypot(c.gx + 0.5 - (centroidGx + 0.5), c.gz + 0.5 - (centroidGz + 0.5));
    const peakT = Math.max(0, Math.min(1, 1 - r / denom));
    return { gx: c.gx, gz: c.gz, peakT };
  });

  return { cells, centroidGx, centroidGz, maxRadius };
}

/** Arajima + Tsubakishima, derived from OCEAN_BASIN_PATH subpaths [1] and [2]. */
export const ISLANDS: Island[] = (() => {
  const subs = splitSubpaths(OCEAN_BASIN_PATH);
  const out: Island[] = [];
  for (let i = 1; i < subs.length; i++) {
    const isl = buildIsland(subs[i]);
    if (isl.cells.length > 0) out.push(isl);
  }
  return out;
})();

/** Flat lookup set: "gz,gx" for every island cell. */
const ISLAND_SET: Set<string> = (() => {
  const s = new Set<string>();
  for (const isl of ISLANDS) for (const c of isl.cells) s.add(`${c.gz},${c.gx}`);
  return s;
})();

/** All island cells (both islands), with peakT for mound rendering. */
export const ISLAND_CELLS: IslandCell[] = ISLANDS.flatMap((i) => i.cells);

/** True when grid cell (gx,gz) is inside either island → NOT bay water, it's land. */
export function isIsland(gx: number, gz: number): boolean {
  return ISLAND_SET.has(`${gz},${gx}`);
}

// ── Underwater apron ──────────────────────────────────────────────────────────
// Distance (in grid cells) over which the seabed shallows toward an island, so
// the seafloor slopes UP to meet the shore instead of dropping off a cliff.
export const ISLAND_APRON_CELLS = 6 * GRID_SUBDIV; // scales with resolution → constant physical apron width

/**
 * Depth-scaling factor in [0,1] for a WATER cell, based on nearness to the
 * closest island cell:
 *   • ≥ ISLAND_APRON_CELLS away  → 1   (full open-bay depth, unchanged)
 *   • right at the island edge   → ~0  (seabed rises to the waterline)
 * Uses distance to the nearest island CELL CENTRE minus ~0.5 so a cell one step
 * off the island is already strongly shallowed. Smoothstep gives a natural
 * concave apron rather than a straight ramp. Returns 1 quickly when far from
 * every island (cheap early-out via per-island bounding radius).
 */
export function islandApronFactor(gx: number, gz: number): number {
  let nearest = Infinity;
  for (const isl of ISLANDS) {
    // Cheap reject: distance to centroid beyond island radius + apron ⇒ skip.
    const dc = Math.hypot(
      gx + 0.5 - (isl.centroidGx + 0.5),
      gz + 0.5 - (isl.centroidGz + 0.5),
    );
    if (dc > isl.maxRadius + ISLAND_APRON_CELLS + 2) continue;
    for (const c of isl.cells) {
      const d = Math.hypot(gx + 0.5 - (c.gx + 0.5), gz + 0.5 - (c.gz + 0.5));
      if (d < nearest) nearest = d;
    }
  }
  if (!Number.isFinite(nearest)) return 1;
  // Edge distance: subtract a half-cell so a cell adjacent to island is ~0.5.
  const edge = Math.max(0, nearest - 0.5);
  const t = Math.min(1, edge / ISLAND_APRON_CELLS); // 0 at shore → 1 at apron rim
  // Smoothstep for a concave shelf that eases into the open-bay depth.
  return t * t * (3 - 2 * t);
}
