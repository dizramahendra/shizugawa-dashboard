/**
 * SPIKE — Approach A: unified real-terrain 3D map + voxel ocean model.
 *
 * Standalone prototype mounted on /terrain-3d. Renders:
 *   1. A real MapLibre map (Esri World Topo, no key) with REAL 3D terrain from
 *      the AWS/Mapzen Terrarium DEM (no key), pitched so the ria coast's
 *      mountains read in true relief.
 *   2. The app's voxel ocean model (BAY_MASK grid × depth layers, coloured by
 *      generateWeekData) as a three.js CUSTOM LAYER, georeferenced with the
 *      transform solved in RealMapViewport, so the nutrient column sits in the
 *      actual Shizugawa Bay at real lon/lat and real metre depths.
 *
 * Does NOT touch the existing views (/playback, /map-real, MapViewport,
 * OceanBasin3D) or any data. Rendering is RAW three.js (no r3f) following the
 * standard MapLibre "add a 3D model with three.js" custom-layer pattern,
 * adapted to the MapLibre GL v5 render signature (CustomRenderMethodInput).
 */
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as THREE from "three";
import {
  BAY_MASK,
  GRID_W,
  GRID_D,
  DEPTH_LAYERS,
  DEPTH_REAL_M,
  DEPTH_REAL_BOT,
  generateWeekData,
} from "@/lib/simulatedData";
import { OCEAN_BASIN_PATH } from "@/lib/svgPaths";

// ── Georeference (SOLVED in RealMapViewport — FITTED_TRANSFORM) ──────────────
// lon = LON0 + (svgX / SVG_W) * LON_SPAN
// lat = LAT0 + (1 − svgY / SVG_H) * LAT_SPAN
const SVG_W = 465;
const SVG_H = 586;
const LON0 = 141.36568;
const LAT0 = 38.59295;
const LON_SPAN = 0.16158;
const LAT_SPAN = 0.15515;

// ── Grid → SVG-normalised inverse ────────────────────────────────────────────
// BAY_POLYGON in simulatedData.ts was built from OCEAN_BASIN_PATH with
//   new_nx = (raw_nx − 0.4631) × 2.1565 + 0.03
//   new_nz = (raw_nz − 0.2846) × 2.1565 + 0.0919
// where raw_nx = svgX/465, raw_nz = 1 − svgY/586. BAY_MASK samples the grid in
// new_n space, so inverting this transform + applying the fitted georeference
// maps any grid cell to real lon/lat.
const POLY_SCALE = 2.1565;
const POLY_CX = 0.4631;
const POLY_CZ = 0.2846;
const POLY_OX = 0.03;
const POLY_OZ = 0.0919;

/** Fractional grid coords (gx+0.5, gz+0.5) → real [lon, lat]. */
function gridToLonLat(gxc: number, gzc: number): [number, number] {
  const rawNx = (gxc / GRID_W - POLY_OX) / POLY_SCALE + POLY_CX;
  const rawNz = (gzc / GRID_D - POLY_OZ) / POLY_SCALE + POLY_CZ;
  return [LON0 + rawNx * LON_SPAN, LAT0 + rawNz * LAT_SPAN];
}

// Local metric frame anchored at the bay centre (x = east m, y = north m,
// z = up m). Mercator is conformal, so metre offsets at the anchor latitude
// convert to mercator units with a single scale factor — the standard
// MercatorCoordinate.meterInMercatorCoordinateUnits() pattern.
const ORIGIN: [number, number] = gridToLonLat(GRID_W / 2, GRID_D / 2);
const EARTH_R = 6378137;
const M_PER_DEG_LAT = (Math.PI / 180) * EARTH_R;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((ORIGIN[1] * Math.PI) / 180);

function lonLatToLocalM(lon: number, lat: number): [number, number] {
  return [(lon - ORIGIN[0]) * M_PER_DEG_LON, (lat - ORIGIN[1]) * M_PER_DEG_LAT];
}

// Real-metre size of one grid cell (grid is a uniform lon/lat lattice).
const CELL_E_M = ((LON_SPAN / POLY_SCALE) / GRID_W) * M_PER_DEG_LON; // ≈58 m
const CELL_N_M = ((LAT_SPAN / POLY_SCALE) / GRID_D) * M_PER_DEG_LAT; // ≈83 m

// ── Colour ramp + bathymetry (copied from OceanBasin3D — module-private
//    there; duplicated rather than exporting to keep the spike additive) ─────
const NUTRIENT_RAMP = [
  "#2c5f8a","#3d6fa0","#6a9fc0","#90c4de","#c5dfe8",
  "#f5f0d8","#f0d090","#e8a030","#d45820","#c8401c",
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

function lerpColor(stops: string[], t: number): [number, number, number] {
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
function getBathymetryDepthM(gx: number, gz: number): number {
  const frac = gx / (GRID_W - 1);
  const nsFrac = gz / (GRID_D - 1);
  const nsBias = 1 - 0.18 * Math.abs(nsFrac - 0.5) * 2;
  return Math.min(55, Math.max(3, (8 + 47 * frac) * nsBias));
}

function deepestVisibleLayer(seabedM: number): number {
  let last = -1;
  for (let d = 0; d < DEPTH_LAYERS; d++) {
    if (DEPTH_REAL_M[d] < seabedM) last = d;
    else break;
  }
  return last;
}

// ── Voxel scene (raw three.js, z-up local metric frame) ─────────────────────
const WEEK = 24; // single representative week — no playback in the spike

function buildVoxelScene(): { scene: THREE.Scene; instances: number } {
  const scene = new THREE.Scene();

  // z-up frame: hemisphere sky along +z, sun from the east-south-east.
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.15);
  hemi.position.set(0, 0, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(4000, -2500, 6000);
  scene.add(sun);

  const data = generateWeekData(WEEK);

  // Gather per-depth-layer instance positions + colours.
  const perLayer: Array<{ pos: number[]; rgb: number[] }> = Array.from(
    { length: DEPTH_LAYERS },
    () => ({ pos: [], rgb: [] }),
  );

  for (let gz = 0; gz < GRID_D; gz++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      if (!BAY_MASK[gz]?.[gx]) continue;
      const maxLayer = deepestVisibleLayer(getBathymetryDepthM(gx, gz));
      if (maxLayer < 0) continue;
      const [lon, lat] = gridToLonLat(gx + 0.5, gz + 0.5);
      const [east, north] = lonLatToLocalM(lon, lat);
      for (let d = 0; d <= maxLayer; d++) {
        const val = data[gz]?.[gx]?.[d] ?? 0;
        const [r, g, b] = lerpColor(NUTRIENT_RAMP, val);
        // z = REAL altitude (m below sea level) at the layer's mid-depth.
        const zMid = -(DEPTH_REAL_M[d] + DEPTH_REAL_BOT[d]) / 2;
        perLayer[d].pos.push(east, north, zMid);
        perLayer[d].rgb.push(r, g, b);
      }
    }
  }

  let instances = 0;
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  for (let d = 0; d < DEPTH_LAYERS; d++) {
    const { pos, rgb } = perLayer[d];
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
    instances += count;
  }
  return { scene, instances };
}

// ── Bay outline (traced SVG → GeoJSON) — draped alignment reference ─────────
const SVG_NS = "http://www.w3.org/2000/svg";

// Minimal local GeoJSON shape (project has no hoisted @types/geojson).
interface OutlineFC {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, unknown>;
    geometry: { type: "MultiLineString"; coordinates: number[][][] };
  }>;
}

function sampleBayOutline(): OutlineFC {
  const host = document.createElementNS(SVG_NS, "svg");
  host.setAttribute("viewBox", `0 0 ${SVG_W} ${SVG_H}`);
  host.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden";
  document.body.appendChild(host);
  const lines: number[][][] = [];
  try {
    const subs = OCEAN_BASIN_PATH.split(/(?=[Mm])/).map((s) => s.trim()).filter(Boolean);
    for (const sub of subs) {
      const el = document.createElementNS(SVG_NS, "path");
      el.setAttribute("d", sub);
      host.appendChild(el);
      let len = 0;
      try { len = el.getTotalLength(); } catch { len = 0; }
      if (!Number.isFinite(len) || len <= 0) { host.removeChild(el); continue; }
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
    features: [{
      type: "Feature",
      properties: {},
      geometry: { type: "MultiLineString", coordinates: lines },
    }],
  };
}

// ── Map style: Esri World Topo basemap + Terrarium DEM (both no-key) ────────
const DEM_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

function buildStyle(): maplibregl.StyleSpecification {
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

// ── Component ────────────────────────────────────────────────────────────────
const VOXEL_EXAG_OPTIONS = [1, 5, 10, 20];
const TERRAIN_EXAG_OPTIONS = [1, 1.5, 2];

export default function Terrain3DViewport() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const occludeRef = useRef(false); // false → clear depth so voxels always show
  const [instances, setInstances] = useState(0);
  const [voxelExag, setVoxelExag] = useState(10);
  const voxelExagRef = useRef(voxelExag);
  const [terrainExag, setTerrainExag] = useState(1);
  const [occlude, setOcclude] = useState(false);
  const [showOutline, setShowOutline] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);

  occludeRef.current = occlude;
  voxelExagRef.current = voxelExag;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: buildStyle(),
      center: ORIGIN,
      zoom: 12.1,
      pitch: 57,
      bearing: -55, // look NW from over the ocean → mountains rise behind the bay
      maxPitch: 80,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({}), "bottom-left");
    map.on("error", (e) => {
      const msg = e?.error?.message ?? "unknown map error";
      // Surface tile/style failures in the panel (DEM is the risky one).
      setLastError(msg);
      console.error("[terrain-3d]", msg);
    });

    // three.js custom layer (MapLibre GL v5 signature).
    const mc = maplibregl.MercatorCoordinate.fromLngLat(ORIGIN, 0);
    const s = mc.meterInMercatorCoordinateUnits();
    // Local frame → mercator: translate to the anchor, scale metres→mercator
    // units. The -s on Y both flips mercator's south-positive Y to our
    // north-positive local Y and keeps the frame right-handed (x=east,
    // y=north, z=up), so default front-face winding survives.
    const modelMatrix = new THREE.Matrix4()
      .makeTranslation(mc.x, mc.y, mc.z ?? 0)
      .scale(new THREE.Vector3(s, -s, s));
    const camera = new THREE.Camera();
    let renderer: THREE.WebGLRenderer | null = null;

    const voxelLayer: maplibregl.CustomLayerInterface = {
      id: "voxel-ocean-3d",
      type: "custom",
      renderingMode: "3d",
      onAdd: (m, gl) => {
        renderer = new THREE.WebGLRenderer({
          canvas: m.getCanvas(),
          context: gl,
          antialias: true,
        });
        renderer.autoClear = false;
        const built = buildVoxelScene();
        built.scene.scale.set(1, 1, voxelExagRef.current);
        sceneRef.current = built.scene;
        setInstances(built.instances);
      },
      render: (gl, options) => {
        const scene = sceneRef.current;
        if (!renderer || !scene) return;
        // v5: defaultProjectionData.mainMatrix is the 0..1-mercator → clip
        // matrix (options.modelViewProjectionMatrix is in internal world-pixel
        // units and does NOT work with MercatorCoordinate-scaled geometry).
        const proj = new THREE.Matrix4()
          .fromArray(options.defaultProjectionData.mainMatrix as unknown as number[])
          .multiply(modelMatrix);
        camera.projectionMatrix = proj;
        if (!occludeRef.current) {
          // Guarantee visibility of the submerged column: without this the
          // terrain surface (drawn at/near sea level over the bay) wins the
          // depth test and hides everything below it.
          gl.disable(gl.SCISSOR_TEST);
          gl.depthMask(true);
          gl.clear(gl.DEPTH_BUFFER_BIT);
        }
        renderer.resetState();
        renderer.render(scene, camera);
      },
      onRemove: () => {
        renderer?.dispose();
        renderer = null;
        sceneRef.current = null;
      },
    };

    map.on("style.load", () => {
      if (!map.getSource("bay-outline")) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.addSource("bay-outline", { type: "geojson", data: sampleBayOutline() as any });
        map.addLayer({
          id: "bay-outline-line",
          type: "line",
          source: "bay-outline",
          paint: { "line-color": "#d32f2f", "line-width": 2 },
        });
      }
      if (!map.getLayer("voxel-ocean-3d")) map.addLayer(voxelLayer);
    });

    // MapLibre-in-a-freshly-routed-SPA can size itself against a 0×0 container
    // and stay blank until an interaction — keep it painted on real layout.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);

    mapRef.current = map;
    // Dev handle for tuning from the console / preview_eval.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__terrain3d = map;
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__terrain3d;
    };
  }, []);

  // Voxel vertical exaggeration: pure z-scale on the scene root (positions and
  // layer thicknesses are all proportional to real metres, so this is exact).
  useEffect(() => {
    const scene = sceneRef.current;
    if (scene) {
      scene.scale.set(1, 1, voxelExag);
      mapRef.current?.triggerRepaint();
    }
  }, [voxelExag]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => map.setTerrain({ source: "dem", exaggeration: terrainExag });
    if (map.isStyleLoaded()) apply();
    else map.once("style.load", apply);
  }, [terrainExag]);

  useEffect(() => {
    mapRef.current?.triggerRepaint();
  }, [occlude]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("bay-outline-line")) return;
    map.setLayoutProperty("bay-outline-line", "visibility", showOutline ? "visible" : "none");
  }, [showOutline]);

  const btn = (active: boolean): React.CSSProperties => ({
    font: "inherit",
    padding: "2px 7px",
    borderRadius: 4,
    border: "1px solid #999",
    background: active ? "#1d6fd1" : "#fff",
    color: active ? "#fff" : "#222",
    cursor: "pointer",
  });

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          zIndex: 10,
          background: "rgba(255,255,255,0.92)",
          border: "1px solid #ccc",
          borderRadius: 6,
          padding: "8px 10px",
          font: "11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace",
          color: "#222",
          display: "flex",
          flexDirection: "column",
          gap: 5,
          maxWidth: 260,
        }}
      >
        <strong>SPIKE · Terrain 3D (/terrain-3d)</strong>
        <div style={{ color: "#666" }}>
          Voxel ocean (week {WEEK}, nitrogen) on real DEM terrain.
          <br />
          {instances.toLocaleString()} voxels · cell ≈ {CELL_E_M.toFixed(0)}×
          {CELL_N_M.toFixed(0)} m
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ width: 84 }}>depth exag</span>
          {VOXEL_EXAG_OPTIONS.map((v) => (
            <button key={v} onClick={() => setVoxelExag(v)} style={btn(voxelExag === v)}>
              ×{v}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ width: 84 }}>terrain exag</span>
          {TERRAIN_EXAG_OPTIONS.map((v) => (
            <button key={v} onClick={() => setTerrainExag(v)} style={btn(terrainExag === v)}>
              ×{v}
            </button>
          ))}
        </div>
        <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={occlude}
            onChange={(e) => setOcclude(e.target.checked)}
          />
          terrain occludes voxels (true depth test)
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showOutline}
            onChange={(e) => setShowOutline(e.target.checked)}
          />
          traced bay outline (alignment ref)
        </label>
        {lastError && (
          <div style={{ color: "#b00020", maxWidth: 240, overflowWrap: "break-word" }}>
            map error: {lastError}
          </div>
        )}
      </div>
    </div>
  );
}
