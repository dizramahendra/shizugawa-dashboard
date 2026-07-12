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
import {
  getCompositeRiver,
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
  ll: [number, number][];   // centreline in lon/lat, upstream → mouth
  colStart: number; colEnd: number;
  rowStart: number; rowEnd: number;
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
    let ll = courseLL(r.slug);
    if (!ll) continue;
    const distToBay = (p: [number, number]) =>
      Math.hypot((p[0] - BAY_CENTER[0]) * Math.cos((p[1] * Math.PI) / 180), p[1] - BAY_CENTER[1]);
    if (distToBay(ll[0]) < distToBay(ll[ll.length - 1])) ll = ll.slice().reverse();
    out.push({
      ll,
      colStart: r.colStart, colEnd: r.colEnd, rowStart: r.rowStart, rowEnd: r.rowEnd,
    });
  }
  return out;
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

const geomCache = new Map<string, RiverGeom>();

export function buildRiverGeom(riverId: string): RiverGeom {
  const cached = geomCache.get(riverId);
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
    let len = 0;
    for (let i = 0; i < mpts.length - 1; i++) len += Math.hypot(mpts[i + 1][0] - mpts[i][0], mpts[i + 1][1] - mpts[i][1]);
    courseLen = Math.max(courseLen, len);
    const nn = mpts.length;
    for (let i = 0; i < nn - 1; i++) {
      segLines.push({
        ax: mpts[i][0], ay: mpts[i][1], bx: mpts[i + 1][0], by: mpts[i + 1][1],
        t0: i / (nn - 1), t1: (i + 1) / (nn - 1), si,
      });
    }
  });

  // Cell size follows the course length so every river gets ~SAMPLES columns of
  // pixels; width tapers head → mouth (in cells, matching the canvas look).
  const cellM = Math.max(22, Math.min(80, courseLen / SAMPLES));
  const halfW = (t: number) => cellM * (1.35 + 2.0 * Math.pow(t, 0.85));
  const maxHW = halfW(1) + cellM;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const L of segLines) {
    minX = Math.min(minX, L.ax, L.bx); maxX = Math.max(maxX, L.ax, L.bx);
    minY = Math.min(minY, L.ay, L.by); maxY = Math.max(maxY, L.ay, L.by);
  }

  const cells: CellDef[] = [];
  if (!Number.isFinite(minX)) {
    const fallback: RiverGeom = { cells, bounds: [[141.4, 38.6], [141.5, 38.7]], mouth: BAY_CENTER };
    geomCache.set(riverId, fallback);
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
      const jitter = (Math.sin(ix * 0.68 + iy * 0.43) + Math.sin(ix * 0.25 - iy * 0.58)) * 0.06;
      const hw = halfW(bestT) * (1 + jitter);
      if (dist > hw) continue;

      const seg = segments[bestSi];
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
  geomCache.set(riverId, geom);
  return geom;
}

/** Cells → FeatureCollection with the week's colours baked per feature. */
export function cellsToFC(cells: CellDef[], data: number[][], stops: string[]) {
  return {
    type: "FeatureCollection" as const,
    features: cells.map((c, i) => ({
      type: "Feature" as const,
      id: i,
      properties: {
        row: c.row, col: c.col,
        val: data[c.row]?.[c.col] ?? 0,
        color: bandColor(stops, data[c.row]?.[c.col] ?? 0),
      },
      geometry: { type: "Polygon" as const, coordinates: [[...c.quad, c.quad[0]]] },
    })),
  };
}
