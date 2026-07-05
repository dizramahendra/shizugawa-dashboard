/**
 * Shared georeference + voxel helpers for the real-terrain 3D ocean view.
 *
 * These are the SOLVED constants and transforms from the Terrain3DViewport
 * spike (/terrain-3d), lifted into src/lib so the production component
 * (OceanTerrain3D) can consume them without duplicating the math and without
 * mixing named + default exports in a React component file (Fast Refresh).
 *
 * The spike file itself is intentionally left untouched as a reference — it
 * keeps its own private copies. Do NOT re-derive any of the values here; they
 * are correct.
 */
import * as THREE from "three";
import {
  GRID_W,
  GRID_D,
  DEPTH_LAYERS,
  DEPTH_REAL_M,
  DEPTH_REAL_BOT,
} from "@/lib/simulatedData";

// ── Georeference (SOLVED in RealMapViewport — FITTED_TRANSFORM) ──────────────
export const SVG_W = 465;
export const SVG_H = 586;
export const LON0 = 141.36568;
export const LAT0 = 38.59295;
export const LON_SPAN = 0.16158;
export const LAT_SPAN = 0.15515;

// ── Grid → SVG-normalised inverse ────────────────────────────────────────────
const POLY_SCALE = 2.1565;
const POLY_CX = 0.4631;
const POLY_CZ = 0.2846;
const POLY_OX = 0.03;
const POLY_OZ = 0.0919;

/** Fractional grid coords (gx+0.5, gz+0.5) → real [lon, lat]. */
export function gridToLonLat(gxc: number, gzc: number): [number, number] {
  const rawNx = (gxc / GRID_W - POLY_OX) / POLY_SCALE + POLY_CX;
  const rawNz = (gzc / GRID_D - POLY_OZ) / POLY_SCALE + POLY_CZ;
  return [LON0 + rawNx * LON_SPAN, LAT0 + rawNz * LAT_SPAN];
}

// Local metric frame anchored at the bay centre.
export const ORIGIN: [number, number] = gridToLonLat(GRID_W / 2, GRID_D / 2);
const EARTH_R = 6378137;
const M_PER_DEG_LAT = (Math.PI / 180) * EARTH_R;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((ORIGIN[1] * Math.PI) / 180);

export function lonLatToLocalM(lon: number, lat: number): [number, number] {
  return [(lon - ORIGIN[0]) * M_PER_DEG_LON, (lat - ORIGIN[1]) * M_PER_DEG_LAT];
}

// Real-metre size of one grid cell (grid is a uniform lon/lat lattice).
export const CELL_E_M = ((LON_SPAN / POLY_SCALE) / GRID_W) * M_PER_DEG_LON; // ≈58 m
export const CELL_N_M = ((LAT_SPAN / POLY_SCALE) / GRID_D) * M_PER_DEG_LAT; // ≈83 m

// ── Colour ramp (matches OceanBasin3D / PlaybackPage nitrogen scale) ─────────
export const NUTRIENT_RAMP = [
  "#2c5f8a", "#3d6fa0", "#6a9fc0", "#90c4de", "#c5dfe8",
  "#f5f0d8", "#f0d090", "#e8a030", "#d45820", "#c8401c",
];

const _rgbCache = new Map<string, [number, number, number]>();
function hexToRgb(hex: string): [number, number, number] {
  let c = _rgbCache.get(hex);
  if (!c) {
    c = [
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255,
    ];
    _rgbCache.set(hex, c);
  }
  return c;
}

export function lerpColor(stops: string[], t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const a = hexToRgb(stops[i]);
  const f = x - i;
  if (f === 0 || i >= stops.length - 1) return [a[0], a[1], a[2]];
  const b = hexToRgb(stops[i + 1]);
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ];
}

/** Same synthetic bathymetry as OceanBasin3D: west ~8 m → east ~55 m. */
export function getBathymetryDepthM(gx: number, gz: number): number {
  const frac = gx / (GRID_W - 1);
  const nsFrac = gz / (GRID_D - 1);
  const nsBias = 1 - 0.18 * Math.abs(nsFrac - 0.5) * 2;
  return Math.min(55, Math.max(3, (8 + 47 * frac) * nsBias));
}

export function deepestVisibleLayer(seabedM: number): number {
  let last = -1;
  for (let d = 0; d < DEPTH_LAYERS; d++) {
    if (DEPTH_REAL_M[d] < seabedM) last = d;
    else break;
  }
  return last;
}

/** z = REAL altitude (m below sea level) at a layer's mid-depth. */
export function layerMidAltitudeM(d: number): number {
  return -(DEPTH_REAL_M[d] + DEPTH_REAL_BOT[d]) / 2;
}

// ── Bay outline (traced SVG → GeoJSON) — draped alignment reference ─────────
const SVG_NS = "http://www.w3.org/2000/svg";

// Minimal local GeoJSON shape (project has no hoisted @types/geojson).
export interface OutlineFC {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, unknown>;
    geometry: { type: "MultiLineString"; coordinates: number[][][] };
  }>;
}

export function sampleBayOutline(oceanBasinPath: string): OutlineFC {
  const host = document.createElementNS(SVG_NS, "svg");
  host.setAttribute("viewBox", `0 0 ${SVG_W} ${SVG_H}`);
  host.style.cssText =
    "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden";
  document.body.appendChild(host);
  const lines: number[][][] = [];
  try {
    const subs = oceanBasinPath
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
      const n = Math.max(12, Math.min(2000, Math.ceil(len / 2.5)));
      const pts: number[][] = [];
      for (let i = 0; i <= n; i++) {
        const p = el.getPointAtLength((i / n) * len);
        pts.push([
          LON0 + (p.x / SVG_W) * LON_SPAN,
          LAT0 + (1 - p.y / SVG_H) * LAT_SPAN,
        ]);
      }
      host.removeChild(el);
      lines.push(pts);
    }
  } finally {
    document.body.removeChild(host);
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "MultiLineString", coordinates: lines },
      },
    ],
  };
}

// ── Map style: Esri World Topo basemap + Terrarium DEM (both no-key) ────────
const DEM_TILES =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

// Import type only — the actual maplibregl value is passed in by the caller so
// this lib stays framework-agnostic and avoids duplicate module instances.
import type { StyleSpecification } from "maplibre-gl";

export function buildStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution:
          "Tiles &copy; Esri &mdash; Esri, USGS, NOAA | Terrain: Mapzen/AWS Terrain Tiles",
      },
      dem: {
        type: "raster-dem",
        tiles: [DEM_TILES],
        encoding: "terrarium",
        tileSize: 256,
        maxzoom: 15,
      },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
    terrain: { source: "dem", exaggeration: 1 },
    sky: {
      "sky-color": "#a8c8e8",
      "horizon-color": "#eaf0f6",
      "fog-color": "#eaf0f6",
    },
  };
}

// ── Voxel geometry, built ONCE ───────────────────────────────────────────────
// Per depth-layer InstancedMesh + a parallel index → (gz, gx, d) map so the
// production component can recolour every instance per week without rebuilding
// geometry.

export interface VoxelInstanceRef {
  gz: number;
  gx: number;
  d: number;
}

export interface VoxelLayerMesh {
  d: number;
  mesh: THREE.InstancedMesh;
  /** instance index → grid coords; index i ↔ refs[i]. */
  refs: VoxelInstanceRef[];
}

export interface VoxelSceneBuild {
  scene: THREE.Scene;
  layers: VoxelLayerMesh[];
  instances: number;
}

/**
 * Build the voxel scene ONCE. Colours are seeded from `initialData` (a
 * generateWeekData(week) result); call `recolorVoxels` on every week tick to
 * repaint in place. `bayMask` gates which columns are water.
 */
export function buildVoxelScene(
  bayMask: boolean[][],
  initialData: number[][][],
): VoxelSceneBuild {
  const scene = new THREE.Scene();

  // z-up frame: hemisphere sky along +z, sun from the east-south-east.
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.15);
  hemi.position.set(0, 0, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(4000, -2500, 6000);
  scene.add(sun);

  // Gather per-depth-layer instance positions, colours and grid refs.
  const perLayer: Array<{
    pos: number[];
    rgb: number[];
    refs: VoxelInstanceRef[];
  }> = Array.from({ length: DEPTH_LAYERS }, () => ({
    pos: [],
    rgb: [],
    refs: [],
  }));

  for (let gz = 0; gz < GRID_D; gz++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      if (!bayMask[gz]?.[gx]) continue;
      const maxLayer = deepestVisibleLayer(getBathymetryDepthM(gx, gz));
      if (maxLayer < 0) continue;
      const [lon, lat] = gridToLonLat(gx + 0.5, gz + 0.5);
      const [east, north] = lonLatToLocalM(lon, lat);
      for (let d = 0; d <= maxLayer; d++) {
        const val = initialData[gz]?.[gx]?.[d] ?? 0;
        const [r, g, b] = lerpColor(NUTRIENT_RAMP, val);
        perLayer[d].pos.push(east, north, layerMidAltitudeM(d));
        perLayer[d].rgb.push(r, g, b);
        perLayer[d].refs.push({ gz, gx, d });
      }
    }
  }

  const layers: VoxelLayerMesh[] = [];
  let instances = 0;
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  for (let d = 0; d < DEPTH_LAYERS; d++) {
    const { pos, rgb, refs } = perLayer[d];
    const count = pos.length / 3;
    if (count === 0) continue;
    const thick = DEPTH_REAL_BOT[d] - DEPTH_REAL_M[d]; // real metres
    const geo = new THREE.BoxGeometry(CELL_E_M, CELL_N_M, thick);
    const mat = new THREE.MeshLambertMaterial();
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      m4.identity().setPosition(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      mesh.setMatrixAt(i, m4);
      col.setRGB(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
      mesh.setColorAt(i, col);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
    layers.push({ d, mesh, refs });
    instances += count;
  }
  return { scene, layers, instances };
}

/**
 * Recolour every instance in place from a week's data (no geometry rebuild).
 * Reuses the index→(gz,gx,d) map captured at build time.
 */
export function recolorVoxels(
  layers: VoxelLayerMesh[],
  data: number[][][],
): void {
  const col = new THREE.Color();
  for (const { mesh, refs } of layers) {
    for (let i = 0; i < refs.length; i++) {
      const { gz, gx, d } = refs[i];
      const val = data[gz]?.[gx]?.[d] ?? 0;
      const [r, g, b] = lerpColor(NUTRIENT_RAMP, val);
      col.setRGB(r, g, b);
      mesh.setColorAt(i, col);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

/** Value → three.js Matrix4 for the local-frame → mercator model transform. */
export function buildModelMatrix(
  MercatorCoordinate: {
    fromLngLat: (
      l: [number, number],
      alt: number,
    ) => { x: number; y: number; z?: number; meterInMercatorCoordinateUnits: () => number };
  },
): THREE.Matrix4 {
  const mc = MercatorCoordinate.fromLngLat(ORIGIN, 0);
  const s = mc.meterInMercatorCoordinateUnits();
  return new THREE.Matrix4()
    .makeTranslation(mc.x, mc.y, mc.z ?? 0)
    .scale(new THREE.Vector3(s, -s, s));
}
