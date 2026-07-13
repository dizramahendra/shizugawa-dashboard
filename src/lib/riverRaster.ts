/**
 * River pixel-raster geometry — shared by RiverDetailMap (River Playback 2D)
 * and MapViewport (selected-river detail layer).
 *
 * Builds the "Sentinel-style" water-quality raster for a river: square cells
 * laid along the river's REAL SVG course (same RIVER_PATHS geometry as the
 * map lines and the 3D), as lon/lat polygon quads for MapLibre:
 *   • cells are rasterised in a local equirectangular METRE frame so they are
 *     physically square; cell size tracks the course length so every river
 *     gets ~SAMPLES data columns;
 *   • the channel tapers from the headwater to a wider mouth, with
 *     deterministic bank jitter for organic edges;
 *   • along-stream position maps to the data COLUMN (headwater 0 → mouth
 *     RIVER_COLS−1); the SIGNED cross-stream offset maps to the data ROW —
 *     the full cross-stream structure of the reach data, cell by cell;
 *   • composite corridors emit one reach per sub-basin segment (its own
 *     col/row band), so tributaries visibly converge at the confluence.
 *
 * Colours are QUANTIZED to the legend bands (bandColor) — the crunchy
 * model-output look — and baked into feature properties per week (cellsToFC),
 * cheap to refresh via GeoJSONSource.setData at ~1k features per river.
 */
import { sampleSvgPath, type Pt } from "@/lib/svgSample";
import { REAL_RIVER_COURSES } from "@/lib/realRiverCourses";
import { REAL_RIVER_BANKS } from "@/lib/realRiverBanks";
import {
  getCompositeRiver,
  RIVERS,
  RIVER_ROWS,
  RIVER_COLS,
  RIVER_SVG_BY_SLUG,
  RIVER_SVG_W,
  RIVER_SVG_H,
} from "@/lib/simulatedData";

/** Quantized colour — each cell snaps to a discrete legend band. */
export function bandColor(stops: string[], t: number): string {
  const n = stops.length;
  return stops[Math.min(n - 1, Math.floor(Math.min(1, Math.max(0, t)) * n))];
}

// ── Georeference (same transform the bay/rivers/3D use) ───────────────────────
export function svgLonLat(x: number, y: number): [number, number] {
  return [141.36568 + (x / RIVER_SVG_W) * 0.16158, 38.59295 + (1 - y / RIVER_SVG_H) * 0.15515];
}
const BAY_CENTER: [number, number] = [141.45, 38.63]; // approx, for mouth detection

// ── Along-stream segments (real SVG course, oriented upstream → mouth) ────────
const SAMPLES = 110;

interface Segment {
  slug: string;             // reach slug (bank-polygon + context lookups)
  ll: [number, number][];   // centreline in lon/lat, upstream → mouth
  colStart: number; colEnd: number;
  rowStart: number; rowEnd: number;
}

/** Point-in-ring (lon/lat ray cast) for the baked bank polygons. */
function inRing(p: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function resample(dense: Pt[], n: number): Pt[] {
  if (dense.length <= n) return dense;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) out.push(dense[Math.round((i / (n - 1)) * (dense.length - 1))]);
  return out;
}

/** A river's centreline in lon/lat: the REAL surveyed course (OSM/MLIT-snapped
 *  bake) when available, else the georeferenced hand-drawn SVG course. */
function courseLL(slug: string): [number, number][] | null {
  const real = REAL_RIVER_COURSES[slug];
  if (real && real.length >= 2) return real;
  const d = RIVER_SVG_BY_SLUG[slug];
  if (!d) return null;
  try {
    const pts = resample(sampleSvgPath(d, 1), SAMPLES);
    return pts.length >= 2 ? pts.map(p => svgLonLat(p.x, p.y)) : null;
  } catch {
    return null;
  }
}

function distToBay(p: [number, number]): number {
  return Math.hypot((p[0] - BAY_CENTER[0]) * Math.cos((p[1] * Math.PI) / 180), p[1] - BAY_CENTER[1]);
}

/** A reach's centreline oriented upstream → mouth (mouth = end nearer the bay). */
function orientedCourseLL(slug: string): [number, number][] | null {
  let ll = courseLL(slug);
  if (!ll) return null;
  if (distToBay(ll[0]) < distToBay(ll[ll.length - 1])) ll = ll.slice().reverse();
  return ll;
}

function buildSegments(riverId: string): Segment[] {
  const composite = getCompositeRiver(riverId);
  const raw = composite
    ? composite.segments.map(s => ({
        slug: s.riverId, colStart: s.colStart, colEnd: s.colEnd,
        rowStart: s.rowStart ?? 0, rowEnd: s.rowEnd ?? RIVER_ROWS - 1,
      }))
    : [{ slug: riverId, colStart: 0, colEnd: RIVER_COLS - 1, rowStart: 0, rowEnd: RIVER_ROWS - 1 }];

  const out: Segment[] = [];
  for (const r of raw) {
    const ll = orientedCourseLL(r.slug);
    if (!ll) continue;
    out.push({
      slug: r.slug,
      ll,
      colStart: r.colStart, colEnd: r.colEnd, rowStart: r.rowStart, rowEnd: r.rowEnd,
    });
  }
  return out;
}

// ── Drainage network → hydraulic channel width ────────────────────────────────
// Channel width follows DOWNSTREAM HYDRAULIC GEOMETRY: width ∝ √(accumulated
// drainage area). Width is a property of the WATERCOURSE, not the reach — the
// old per-reach taper (narrow head → wide mouth, resetting at every sub-basin
// boundary) produced pointy "tentacle" tips and fat blob-mouths butting into
// the next reach's thin head. Here:
//   • the network topology is derived from the baked geometry — a reach whose
//     mouth lands within JOIN_R of another reach's course JOINS it there;
//   • accumulated area at fraction t of a reach = its own sub-basin area
//     accrued linearly along the course + the FULL upstream area of every
//     tributary that has joined at or before t;
//   • width steps UP at confluences (like a real river) and never resets.
const JOIN_R_M = 300;

/** Sub-basin area (km²) per slug, parsed from the RIVERS catalogue. */
const AREA_KM2: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (const r of RIVERS) {
    const m = /([\d.]+)\s*km²/.exec(r.sub ?? "");
    out[r.id] = m ? parseFloat(m[1]) : 5;
  }
  return out;
})();

interface ReachNet {
  ll: [number, number][];        // oriented upstream → mouth
  cum: number[];                 // cumulative metres per vertex
  totalLen: number;
  ownArea: number;               // km²
  tribs: { slug: string; t: number }[]; // tributaries joining, by arc fraction
  totalArea: number;             // own + all upstream (filled in pass 2)
}

let _net: Map<string, ReachNet> | null = null;
function getNetwork(): Map<string, ReachNet> {
  if (_net) return _net;
  const net = new Map<string, ReachNet>();
  const KXY = (lat: number) => [111320 * Math.cos((lat * Math.PI) / 180), 110540] as const;

  for (const slug of Object.keys(RIVER_SVG_BY_SLUG)) {
    const ll = orientedCourseLL(slug);
    if (!ll) continue;
    const [kx, ky] = KXY(ll[0][1]);
    const cum = [0];
    for (let i = 0; i < ll.length - 1; i++) {
      cum.push(cum[i] + Math.hypot((ll[i + 1][0] - ll[i][0]) * kx, (ll[i + 1][1] - ll[i][1]) * ky));
    }
    net.set(slug, {
      ll, cum, totalLen: cum[cum.length - 1] || 1,
      ownArea: AREA_KM2[slug] ?? 5, tribs: [], totalArea: 0,
    });
  }

  // Junctions: each reach's MOUTH joins the nearest other reach's course
  // (within JOIN_R), at that course's arc fraction; otherwise it ends in the bay.
  for (const [slug, r] of net) {
    const mouth = r.ll[r.ll.length - 1];
    const [kx, ky] = KXY(mouth[1]);
    let best: { slug: string; t: number; d: number } | null = null;
    for (const [other, o] of net) {
      if (other === slug) continue;
      for (let i = 0; i < o.ll.length - 1; i++) {
        const ax = (o.ll[i][0] - mouth[0]) * kx, ay = (o.ll[i][1] - mouth[1]) * ky;
        const bx = (o.ll[i + 1][0] - mouth[0]) * kx, by = (o.ll[i + 1][1] - mouth[1]) * ky;
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy || 1;
        let u = -(ax * dx + ay * dy) / len2;
        u = Math.max(0, Math.min(1, u));
        const d = Math.hypot(ax + dx * u, ay + dy * u);
        if (d <= JOIN_R_M && (!best || d < best.d)) {
          const t = (o.cum[i] + (o.cum[i + 1] - o.cum[i]) * u) / o.totalLen;
          best = { slug: other, t, d };
        }
      }
    }
    if (best) net.get(best.slug)!.tribs.push({ slug, t: best.t });
  }

  // Accumulated totals (cycle-guarded — bad geometry cannot infinite-loop).
  const totalArea = (slug: string, seen: Set<string>): number => {
    const r = net.get(slug);
    if (!r || seen.has(slug)) return 0;
    seen.add(slug);
    let a = r.ownArea;
    for (const trib of r.tribs) a += totalArea(trib.slug, seen);
    return a;
  };
  for (const [slug, r] of net) r.totalArea = totalArea(slug, new Set());

  _net = net;
  return net;
}

/** Accumulated drainage area (km²) at arc fraction t of a reach. */
function drainageAreaAt(slug: string, t: number): number {
  const net = getNetwork();
  const r = net.get(slug);
  if (!r) return 5;
  let a = r.ownArea * Math.max(0.06, Math.min(1, t)); // headwaters keep a floor
  for (const trib of r.tribs) {
    if (trib.t <= t) a += (net.get(trib.slug)?.totalArea ?? 0);
  }
  return a;
}

/** Hydraulic channel width (m) at arc fraction t — width ∝ √(drainage area). */
function channelWidthM(slug: string, t: number, tier: RasterTier): number {
  const a = drainageAreaAt(slug, t);
  return tier === "narrow"
    ? Math.max(8, Math.min(55, 6.5 * Math.sqrt(a)))
    : Math.max(35, Math.min(150, 20 * Math.sqrt(a)));
}

/** All rivers as faint context lines (static; real courses where baked).
 *  Features carry their slug so the focused river's own line can be hidden
 *  while its raster representation is shown (one entity, one representation). */
export const CONTEXT_RIVERS_FC = {
  type: "FeatureCollection" as const,
  features: Object.keys(RIVER_SVG_BY_SLUG).flatMap(slug => {
    const ll = courseLL(slug);
    if (!ll) return [];
    return [{ type: "Feature" as const, properties: { slug }, geometry: { type: "LineString" as const, coordinates: ll } }];
  }),
};

/** Slugs of the reaches a river id renders (composite → all segment slugs). */
export function riverSlugs(riverId: string): string[] {
  const composite = getCompositeRiver(riverId);
  return composite ? composite.segments.map(s => s.riverId) : [riverId];
}

// ── Pixel-cell rasterisation in local metre space → lon/lat quads ─────────────
export interface CellDef {
  quad: [number, number][];   // 4 lon/lat corners
  row: number; col: number;
}
export interface RiverGeom {
  cells: CellDef[];
  bounds: [[number, number], [number, number]];
  mouth: [number, number];
}

/** Raster level-of-detail tier.
 *  "wide"   — the schematic channel (readable at overview/mid zoom; the width
 *             is exaggerated so cells are visible when the river is small on
 *             screen).
 *  "narrow" — the TRUE-WIDTH tier for deep zoom: half-size cells hugging the
 *             real course at near-real channel width, so next to the detailed
 *             GSI basemap the raster sits IN the river instead of blanketing
 *             the town around it. */
export type RasterTier = "wide" | "narrow";

const geomCache = new Map<string, RiverGeom>();

export function buildRiverGeom(riverId: string, tier: RasterTier = "wide"): RiverGeom {
  const cacheKey = `${riverId}:${tier}`;
  const cached = geomCache.get(cacheKey);
  if (cached) return cached;

  const segments = buildSegments(riverId);
  // Local equirectangular metre frame around the river.
  let lon0 = 0, lat0 = 0, n0 = 0;
  for (const s of segments) for (const p of s.ll) { lon0 += p[0]; lat0 += p[1]; n0++; }
  lon0 /= Math.max(1, n0); lat0 /= Math.max(1, n0);
  const KX = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const KY = 110540;
  const toM  = (p: [number, number]): [number, number] => [(p[0] - lon0) * KX, (p[1] - lat0) * KY];
  const toLL = (m: [number, number]): [number, number] => [lon0 + m[0] / KX, lat0 + m[1] / KY];

  // Flatten centrelines into metre-space line segments with along-fraction.
  interface SegLine { ax: number; ay: number; bx: number; by: number; t0: number; t1: number; si: number }
  const segLines: SegLine[] = [];
  let courseLen = 0;
  segments.forEach((seg, si) => {
    const mpts = seg.ll.map(toM);
    // ARC-LENGTH parameterisation: the map-matched centrelines carry the survey
    // ways' own vertices at irregular spacing, so the along-stream fraction (→
    // data COLUMN) must come from cumulative length, not vertex index — else
    // densely-digitised bends would hog data columns.
    const cum: number[] = [0];
    for (let i = 0; i < mpts.length - 1; i++) {
      cum.push(cum[i] + Math.hypot(mpts[i + 1][0] - mpts[i][0], mpts[i + 1][1] - mpts[i][1]));
    }
    const total = cum[cum.length - 1] || 1;
    courseLen = Math.max(courseLen, total);
    for (let i = 0; i < mpts.length - 1; i++) {
      segLines.push({
        ax: mpts[i][0], ay: mpts[i][1], bx: mpts[i + 1][0], by: mpts[i + 1][1],
        t0: cum[i] / total, t1: cum[i + 1] / total, si,
      });
    }
  });

  // Cell size follows the course length so every river gets ~SAMPLES columns of
  // pixels; the narrow tier halves the cell size for finer detail up close.
  const cellM = tier === "narrow"
    ? Math.max(12, Math.min(30, courseLen / (SAMPLES * 2)))
    : Math.max(22, Math.min(80, courseLen / SAMPLES));
  // Channel width comes from the DRAINAGE NETWORK (width ∝ √accumulated area,
  // continuous across sub-basin boundaries — see channelWidthM), floored at
  // ¾ cell so the ribbon can never break into disconnected cells.
  const halfWFor = (slug: string, t: number) =>
    Math.max(0.75 * cellM, channelWidthM(slug, t, tier) / 2);
  // No bank jitter on the narrow tier — it is decorative wobble, and at 2–3
  // cells wide it just misplaces cells relative to the surveyed course.
  const jitterAmp = tier === "narrow" ? 0 : 0.06;
  let maxHW = cellM;
  for (const seg of segments) maxHW = Math.max(maxHW, halfWFor(seg.slug, 1) + cellM);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const L of segLines) {
    minX = Math.min(minX, L.ax, L.bx); maxX = Math.max(maxX, L.ax, L.bx);
    minY = Math.min(minY, L.ay, L.by); maxY = Math.max(maxY, L.ay, L.by);
  }

  const cells: CellDef[] = [];
  if (!Number.isFinite(minX)) {
    const fallback: RiverGeom = { cells, bounds: [[141.4, 38.6], [141.5, 38.7]], mouth: BAY_CENTER };
    geomCache.set(cacheKey, fallback);
    return fallback;
  }
  const x0 = Math.floor((minX - maxHW) / cellM), x1 = Math.ceil((maxX + maxHW) / cellM);
  const y0 = Math.floor((minY - maxHW) / cellM), y1 = Math.ceil((maxY + maxHW) / cellM);

  for (let iy = y0; iy <= y1; iy++) {
    for (let ix = x0; ix <= x1; ix++) {
      const px = (ix + 0.5) * cellM, py = (iy + 0.5) * cellM;
      let bestD2 = Infinity, bestT = 0, bestSi = 0, bestSign = 1;
      for (const L of segLines) {
        const dx = L.bx - L.ax, dy = L.by - L.ay;
        const len2 = dx * dx + dy * dy || 1;
        let u = ((px - L.ax) * dx + (py - L.ay) * dy) / len2;
        u = Math.max(0, Math.min(1, u));
        const qx = L.ax + dx * u, qy = L.ay + dy * u;
        const d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy);
        if (d2 < bestD2) {
          bestD2 = d2;
          bestT = L.t0 + (L.t1 - L.t0) * u;
          bestSi = L.si;
          bestSign = (dx * (py - L.ay) - dy * (px - L.ax)) >= 0 ? 1 : -1;
        }
      }
      const dist = Math.sqrt(bestD2);
      const jitter = (Math.sin(ix * 0.68 + iy * 0.43) + Math.sin(ix * 0.25 - iy * 0.58)) * jitterAmp;
      const seg = segments[bestSi];
      const hw = halfWFor(seg.slug, bestT) * (1 + jitter);
      let keep = dist <= hw;
      // TRUE bank shapes (narrow tier): where the channel is mapped as a water
      // polygon (sparse — a few lower reaches), also keep cells whose centre
      // lies INSIDE the real bank ring, so the raster fills the actual channel
      // outline instead of just a fixed-width ribbon around the centreline.
      if (!keep && tier === "narrow") {
        const rings = REAL_RIVER_BANKS[seg.slug];
        if (rings) {
          const c = toLL([px, py]);
          keep = rings.some(r => inRing(c, r));
        }
      }
      if (!keep) continue;
      const col = Math.round(seg.colStart + bestT * (seg.colEnd - seg.colStart));
      const frac = (bestSign * dist / hw) * 0.5 + 0.5;
      const row = Math.max(seg.rowStart, Math.min(seg.rowEnd,
        seg.rowStart + Math.round(frac * (seg.rowEnd - seg.rowStart))));

      const gx = ix * cellM, gy = iy * cellM;
      cells.push({
        row, col,
        quad: [
          toLL([gx, gy]), toLL([gx + cellM, gy]),
          toLL([gx + cellM, gy + cellM]), toLL([gx, gy + cellM]),
        ],
      });
    }
  }

  // Mouth = downstream end of the reach nearest the bay.
  let mouth: [number, number] = BAY_CENTER, bestDist = Infinity;
  for (const seg of segments) {
    const p = seg.ll[seg.ll.length - 1];
    const dist = Math.hypot((p[0] - BAY_CENTER[0]) * Math.cos((p[1] * Math.PI) / 180), p[1] - BAY_CENTER[1]);
    if (dist < bestDist) { bestDist = dist; mouth = p; }
  }

  const swLL = toLL([minX - maxHW, minY - maxHW]);
  const neLL = toLL([maxX + maxHW, maxY + maxHW]);
  const geom: RiverGeom = { cells, bounds: [swLL, neLL], mouth };
  geomCache.set(cacheKey, geom);
  return geom;
}

/** Cells → features with the week's colours baked per feature. `slug` tags each
 *  feature's river and `idOffset` keeps ids unique when several rivers share
 *  one source (the all-rivers zoom raster). */
export function cellFeatures(
  cells: CellDef[], data: number[][], stops: string[], slug = "", idOffset = 0,
) {
  return cells.map((c, i) => ({
    type: "Feature" as const,
    id: idOffset + i,
    properties: {
      slug,
      row: c.row, col: c.col,
      val: data[c.row]?.[c.col] ?? 0,
      color: bandColor(stops, data[c.row]?.[c.col] ?? 0),
    },
    geometry: { type: "Polygon" as const, coordinates: [[...c.quad, c.quad[0]]] },
  }));
}

/** Cells → FeatureCollection with the week's colours baked per feature. */
export function cellsToFC(cells: CellDef[], data: number[][], stops: string[]) {
  return { type: "FeatureCollection" as const, features: cellFeatures(cells, data, stops) };
}
