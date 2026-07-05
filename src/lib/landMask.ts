/**
 * LAND membership mask for the 3D scene — which grid cells (including a
 * border ring beyond the voxel grid) are REAL surrounding land, derived from
 * the same SUB_BASIN_PATHS watershed polygons the map views draw.
 *
 * Pipeline (all in-browser, zero new deps — same approach as RealMapViewport):
 *   1. Sample every sub-basin SVG path into polygon points using an off-DOM
 *      <path> + getTotalLength()/getPointAtLength().
 *   2. For each cell of the extended grid, invert the documented SVG→grid
 *      affine transform (see simulatedData.ts ~line 70):
 *        nx = (svgX/465 − 0.4631) × 2.1565 + 0.03
 *        nz = (1 − svgY/586 − 0.2846) × 2.1565 + 0.0919
 *      to place the cell centre in SVG px space, then point-in-polygon test
 *      it against every sub-basin outline.
 *   3. A cell is LAND when it falls inside a sub-basin AND is not bay water
 *      (BAY_MASK) AND is not a river channel cell (RIVER_CELLS). Because the
 *      sub-basins and BAY_POLYGON share the same SVG source + transform, the
 *      land rings the bay along the real coastline.
 *
 * The mask is computed lazily on first use (needs the DOM) and cached for the
 * lifetime of the module. Purely additive — nothing here mutates the grid,
 * bay mask, or river data.
 */
import { GRID_W, GRID_D, BAY_MASK, RIVER_CELLS } from "@/lib/simulatedData";
import { SUB_BASIN_PATHS } from "@/lib/svgPaths";

const SVG_W = 465;
const SVG_H = 586;
const SVG_NS = "http://www.w3.org/2000/svg";

/** Land ring rendered beyond each side of the voxel grid (in grid cells). */
export const LAND_RING = 16;

// Inverse of the grid transform documented in simulatedData.ts.
function normToSvg(nx: number, nz: number): [number, number] {
  const svgX = ((nx - 0.03) / 2.1565 + 0.4631) * SVG_W;
  const svgY = (1 - ((nz - 0.0919) / 2.1565 + 0.2846)) * SVG_H;
  return [svgX, svgY];
}

interface SampledPoly {
  pts: Array<[number, number]>; // SVG px space
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Split a `d` string into subpaths and sample each with getPointAtLength. */
function samplePathPolys(d: string, host: SVGSVGElement, stepPx = 2.5): SampledPoly[] {
  const out: SampledPoly[] = [];
  const subs = d
    .split(/(?=[Mm])/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sub of subs) {
    const el = document.createElementNS(SVG_NS, "path");
    el.setAttribute("d", sub);
    host.appendChild(el);
    let len = 0;
    try {
      len = el.getTotalLength();
    } catch {
      len = 0;
    }
    if (!Number.isFinite(len) || len <= 0) {
      host.removeChild(el);
      continue;
    }
    const n = Math.max(12, Math.min(2000, Math.ceil(len / stepPx)));
    const pts: Array<[number, number]> = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i <= n; i++) {
      const p = el.getPointAtLength((i / n) * len);
      pts.push([p.x, p.y]);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    host.removeChild(el);
    out.push({ pts, minX, maxX, minY, maxY });
  }
  return out;
}

function sampleAllBasinPolys(): SampledPoly[] {
  const host = document.createElementNS(SVG_NS, "svg");
  host.setAttribute("viewBox", `0 0 ${SVG_W} ${SVG_H}`);
  host.style.position = "absolute";
  host.style.width = "0";
  host.style.height = "0";
  host.style.overflow = "hidden";
  host.style.visibility = "hidden";
  document.body.appendChild(host);
  try {
    const polys: SampledPoly[] = [];
    for (const d of Object.values(SUB_BASIN_PATHS)) {
      polys.push(...samplePathPolys(d, host));
    }
    return polys;
  } finally {
    document.body.removeChild(host);
  }
}

function pointInPoly(px: number, py: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

export interface LandMask {
  /** Border ring size in cells beyond [0, GRID) on every side. */
  ring: number;
  /** True when grid cell (gx, gz) — possibly outside [0, GRID) — is land. */
  isLand(gx: number, gz: number): boolean;
}

let cached: LandMask | null = null;

/** Lazily builds (and caches) the land mask. Browser-only: needs the DOM. */
export function getLandMask(): LandMask {
  if (cached) return cached;

  const polys = sampleAllBasinPolys();
  const ring = LAND_RING;
  const w = GRID_W + ring * 2;
  const d = GRID_D + ring * 2;
  const mask = new Uint8Array(w * d);
  const riverSet = new Set(RIVER_CELLS.map((c) => `${c.gz},${c.gx}`));

  for (let gz = -ring; gz < GRID_D + ring; gz++) {
    for (let gx = -ring; gx < GRID_W + ring; gx++) {
      // Water exclusions: bay cells (only exist inside the grid) and river
      // channel cells (which DO extend beyond the grid) are never land.
      if (gx >= 0 && gx < GRID_W && gz >= 0 && gz < GRID_D && BAY_MASK[gz]?.[gx]) continue;
      if (riverSet.has(`${gz},${gx}`)) continue;

      // Multi-point membership: centre + 4 sub-quadrant samples. The traced
      // sub-basin polygons tile the watershed only approximately — adjacent
      // traces leave sub-cell sliver gaps along shared borders (and along the
      // coastline against BAY_POLYGON). Accepting a cell when ANY sample hits
      // a basin closes those slivers; it cannot encroach on water because bay
      // and river cells are excluded above before this test runs.
      const nx = (gx + 0.5) / GRID_W;
      const nz = (gz + 0.5) / GRID_D;
      const OFF = 0.3;
      const samples: Array<[number, number]> = [
        [nx, nz],
        [nx - OFF / GRID_W, nz - OFF / GRID_D],
        [nx + OFF / GRID_W, nz - OFF / GRID_D],
        [nx - OFF / GRID_W, nz + OFF / GRID_D],
        [nx + OFF / GRID_W, nz + OFF / GRID_D],
      ];
      outer:
      for (const [snx, snz] of samples) {
        const [sx, sy] = normToSvg(snx, snz);
        for (const p of polys) {
          if (sx < p.minX || sx > p.maxX || sy < p.minY || sy > p.maxY) continue;
          if (pointInPoly(sx, sy, p.pts)) {
            mask[(gz + ring) * w + (gx + ring)] = 1;
            break outer;
          }
        }
      }
    }
  }

  cached = {
    ring,
    isLand(gx: number, gz: number): boolean {
      const x = gx + ring;
      const z = gz + ring;
      if (x < 0 || x >= w || z < 0 || z >= d) return false;
      return mask[z * w + x] === 1;
    },
  };
  return cached;
}
