/**
 * OceanTerrain3D — the finished "hero" 3D view.
 *
 * Productionised from the /terrain-3d spike (Terrain3DViewport). Renders the
 * app's voxel nutrient column, georeferenced onto real Shizugawa Bay 3D terrain
 * (Esri World Topo basemap + AWS/Mapzen Terrarium DEM), and ANIMATES the
 * nutrient plume through the year.
 *
 * Playback model: geometry is built ONCE (buildVoxelScene). On every week tick
 * we call generateWeekData(week) and recolour each instance in place
 * (recolorVoxels → setColorAt → instanceColor.needsUpdate) then
 * map.triggerRepaint(). No geometry is rebuilt per frame.
 *
 * The georeference math, modelMatrix, MapLibre v5 defaultProjectionData.
 * mainMatrix usage and the depth-clear visibility trick are unchanged from the
 * spike (see src/lib/oceanTerrainGeo.ts).
 *
 * Clean by default; `?dev=1` restores the spike's tuning panel + bay outline.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import type { CSSProperties } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as THREE from "three";
import { Play, Pause } from "lucide-react";
import {
  TOTAL_WEEKS,
  BAY_MASK,
  generateWeekData,
} from "@/lib/simulatedData";
import { OCEAN_BASIN_PATH } from "@/lib/svgPaths";
import { weekToDate, DEFAULT_YEAR } from "@/lib/weekUtils";
import {
  ORIGIN,
  CELL_E_M,
  CELL_N_M,
  NUTRIENT_RAMP,
  buildStyle,
  buildVoxelScene,
  recolorVoxels,
  buildModelMatrix,
  sampleBayOutline,
  type VoxelLayerMesh,
} from "@/lib/oceanTerrainGeo";
import LegendOverlay from "@/components/LegendOverlay";

// ── Hero camera (tuned values) ───────────────────────────────────────────────
const HERO_PITCH = 62;
const HERO_BEARING = -48;
const HERO_ZOOM = 12.35;

// Nitrogen legend range (matches OCEAN_VARIABLE_OPTIONS "nitrogen", kg/voxel).
const N_MIN = 20;
const N_MAX = 300;

// Playback speed presets. Base cadence ≈ 2.5 weeks/sec at 1×.
const SPEED_OPTIONS = [0.5, 1, 2] as const;
const BASE_TICK_MS = 400; // 1× → 2.5 weeks/sec

const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ── Small per-week memo cache so scrubbing/replay stays smooth ───────────────
const _weekCache = new Map<number, number[][][]>();
function weekData(week: number): number[][][] {
  let d = _weekCache.get(week);
  if (!d) {
    d = generateWeekData(week);
    _weekCache.set(week, d);
  }
  return d;
}

// Dev-only vertical exaggeration options (mirrors the spike).
const VOXEL_EXAG_OPTIONS = [1, 5, 10, 20];
const TERRAIN_EXAG_OPTIONS = [1, 1.5, 2];
const DEFAULT_VOXEL_EXAG = 10;

function devBtn(active: boolean): CSSProperties {
  return {
    font: "inherit",
    padding: "2px 7px",
    borderRadius: 4,
    border: "1px solid #999",
    background: active ? "#1d6fd1" : "#fff",
    color: active ? "#fff" : "#222",
    cursor: "pointer",
  };
}

export default function OceanTerrain3D() {
  const dev =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("dev") === "1";

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const layersRef = useRef<VoxelLayerMesh[] | null>(null);
  const sceneScaleZRef = useRef(DEFAULT_VOXEL_EXAG);

  // Playback state.
  const [week, setWeek] = useState(0);
  const weekRef = useRef(week);
  weekRef.current = week;
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [instances, setInstances] = useState(0);

  // Dev-only tuning state.
  const [voxelExag, setVoxelExag] = useState(DEFAULT_VOXEL_EXAG);
  const [terrainExag, setTerrainExag] = useState(1);
  const [showOutline, setShowOutline] = useState(dev);
  const [lastError, setLastError] = useState<string | null>(null);

  // ── Map + custom layer bootstrap (runs once) ───────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let createdMap: maplibregl.Map | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    let resizeObs: ResizeObserver | null = null;
    let sizeWaitObs: ResizeObserver | null = null;
    let terrainHealthCheck: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const init = () => {
      if (disposed || createdMap) return;

      // Load FLAT first (no terrain in the initial style): the real basemap +
      // voxels then render everywhere, including GL contexts that can't do 3D
      // terrain (headless / software renderers), where terrain-in-the-initial-
      // style wedges the whole style load and leaves the ground blank. Terrain
      // is added below as progressive enhancement once the base map is up.
      const initialStyle = buildStyle();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (initialStyle as any).terrain;

      const map = new maplibregl.Map({
        container,
        style: initialStyle,
        center: ORIGIN,
        zoom: HERO_ZOOM,
        pitch: HERO_PITCH,
        bearing: HERO_BEARING,
        maxPitch: 80,
        attributionControl: { compact: true },
      });
      createdMap = map;

      // NavigationControl hidden by default; expose it only in dev.
      if (dev) {
        map.addControl(
          new maplibregl.NavigationControl({ visualizePitch: true }),
          "top-right",
        );
        map.addControl(new maplibregl.ScaleControl({}), "bottom-left");
      }
      map.on("error", (e) => {
        const msg = e?.error?.message ?? "unknown map error";
        setLastError(msg);
        console.error("[ocean-3d]", msg);
      });

      // three.js custom layer (MapLibre GL v5 signature).
      const modelMatrix = buildModelMatrix(maplibregl.MercatorCoordinate);
      const camera = new THREE.Camera();

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
          const built = buildVoxelScene(BAY_MASK, weekData(weekRef.current));
          built.scene.scale.set(1, 1, sceneScaleZRef.current);
          sceneRef.current = built.scene;
          layersRef.current = built.layers;
          setInstances(built.instances);
        },
        render: (gl, options) => {
          const scene = sceneRef.current;
          if (!renderer || !scene) return;
          const proj = new THREE.Matrix4()
            .fromArray(
              options.defaultProjectionData.mainMatrix as unknown as number[],
            )
            .multiply(modelMatrix);
          camera.projectionMatrix = proj;
          // Guarantee visibility of the submerged column (depth-clear trick).
          gl.disable(gl.SCISSOR_TEST);
          gl.depthMask(true);
          gl.clear(gl.DEPTH_BUFFER_BIT);
          renderer.resetState();
          renderer.render(scene, camera);
        },
        onRemove: () => {
          renderer?.dispose();
          renderer = null;
          sceneRef.current = null;
          layersRef.current = null;
        },
      };

      map.on("style.load", () => {
        if (dev && !map.getSource("bay-outline")) {
          map.addSource("bay-outline", {
            type: "geojson",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: sampleBayOutline(OCEAN_BASIN_PATH) as any,
          });
          map.addLayer({
            id: "bay-outline-line",
            type: "line",
            source: "bay-outline",
            paint: { "line-color": "#d32f2f", "line-width": 2 },
          });
        }
        if (!map.getLayer("voxel-ocean-3d")) map.addLayer(voxelLayer);
      });

      resizeObs = new ResizeObserver(() => map.resize());
      resizeObs.observe(container);

      // Progressive enhancement: once the flat base map is up, try enabling
      // real 3D terrain. On capable clients the relief appears; on contexts
      // that can't do terrain, a health check reverts to flat so the view
      // degrades to a pitched flat real map + voxels instead of going blank.
      map.on("load", () => {
        try {
          map.setTerrain({ source: "dem", exaggeration: 1 });
        } catch {
          return;
        }
        terrainHealthCheck = setTimeout(() => {
          if (createdMap && !map.loaded()) {
            try {
              map.setTerrain(null);
              map.triggerRepaint();
              console.warn(
                "[ocean-3d] 3D terrain unsupported in this GL context — using flat basemap",
              );
            } catch {
              /* noop */
            }
          }
        }, 4000);
      });

      mapRef.current = map;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (dev) (window as any).__ocean3d = map;
    };

    // Defer creation until the container actually has a size. In production the
    // stylesheet that gives this fixed/inset-0 element its dimensions can apply
    // AFTER React runs this effect; a MapLibre map created into a 0×0 container
    // never finishes loading its style/sources. So wait for a non-zero size.
    if (container.clientWidth > 0 && container.clientHeight > 0) {
      init();
    } else {
      sizeWaitObs = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (rect && rect.width > 0 && rect.height > 0) {
          sizeWaitObs?.disconnect();
          sizeWaitObs = null;
          init();
        }
      });
      sizeWaitObs.observe(container);
    }

    return () => {
      disposed = true;
      if (terrainHealthCheck) clearTimeout(terrainHealthCheck);
      sizeWaitObs?.disconnect();
      resizeObs?.disconnect();
      createdMap?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Recolour on every week change (geometry stays put) ─────────────────────
  useEffect(() => {
    const layers = layersRef.current;
    const map = mapRef.current;
    if (!layers || !map) return;
    recolorVoxels(layers, weekData(week));
    map.triggerRepaint();
  }, [week]);

  // ── Auto-play timer (loops through all weeks) ──────────────────────────────
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      setWeek((w) => (w + 1) % TOTAL_WEEKS);
    }, BASE_TICK_MS / speed);
    return () => clearInterval(id);
  }, [isPlaying, speed]);

  // ── Dev: voxel vertical exaggeration (z-scale on scene root) ───────────────
  useEffect(() => {
    sceneScaleZRef.current = voxelExag;
    const scene = sceneRef.current;
    if (scene) {
      scene.scale.set(1, 1, voxelExag);
      mapRef.current?.triggerRepaint();
    }
  }, [voxelExag]);

  // ── Dev: terrain exaggeration ──────────────────────────────────────────────
  useEffect(() => {
    if (!dev) return;
    const map = mapRef.current;
    if (!map) return;
    const apply = () => map.setTerrain({ source: "dem", exaggeration: terrainExag });
    if (map.isStyleLoaded()) apply();
    else map.once("style.load", apply);
  }, [terrainExag, dev]);

  // ── Dev: outline visibility ────────────────────────────────────────────────
  useEffect(() => {
    if (!dev) return;
    const map = mapRef.current;
    if (!map || !map.getLayer("bay-outline-line")) return;
    map.setLayoutProperty(
      "bay-outline-line",
      "visibility",
      showOutline ? "visible" : "none",
    );
  }, [showOutline, dev]);

  const togglePlay = useCallback(() => setIsPlaying((p) => !p), []);
  const handleSeek = useCallback((w: number) => {
    setWeek(w);
    setIsPlaying(false);
  }, []);

  const date = weekToDate(week, DEFAULT_YEAR);
  const weekNum = String(week + 1).padStart(2, "0");
  const dateLabel = `Week ${weekNum} · ${MONTHS_FULL[date.getMonth()]}`;
  const progressPct = (week / (TOTAL_WEEKS - 1)) * 100;

  return (
    <div className="fixed inset-0 bg-slate-900">
      {/* Inline position beats maplibre-gl.css's `.maplibregl-map{position:relative}`,
          which MapLibre adds to this same node; without it the container collapses
          to height 0 (relative box with only absolutely-positioned children). */}
      <div
        ref={containerRef}
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
      />

      {/* ── Title / context label (top-left) ─────────────────────────────── */}
      <div className="absolute top-4 left-4 z-10 pointer-events-none select-none">
        <div className="bg-white/92 backdrop-blur-sm border border-border rounded-lg shadow-sm px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-primary/70 inline-block" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Shizugawa Bay
            </span>
          </div>
          <div className="text-sm font-semibold text-foreground tracking-tight mt-0.5">
            Total Nitrogen
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            Nutrient column on real bay terrain · simulated
          </div>
        </div>
      </div>

      {/* ── Week / date indicator (top-center) ───────────────────────────── */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none select-none">
        <div className="bg-slate-900/55 backdrop-blur-sm rounded-full px-4 py-1.5 flex items-center gap-2.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isPlaying ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
            }`}
          />
          <span className="text-xs font-mono font-medium text-white leading-none tabular-nums">
            {dateLabel}
          </span>
          <span className="text-white/40 text-xs">·</span>
          <span className="text-[11px] font-mono text-white/60 leading-none tabular-nums">
            {DEFAULT_YEAR}
          </span>
        </div>
      </div>

      {/* ── Legend (bottom-left) ─────────────────────────────────────────── */}
      <div className="absolute bottom-4 left-4 z-10 pointer-events-none">
        <LegendOverlay
          stops={NUTRIENT_RAMP}
          min={N_MIN}
          max={N_MAX}
          unit="kg"
          decimals={0}
          label="Total Nitrogen"
        />
      </div>

      {/* ── Playback controls (bottom-center) ────────────────────────────── */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-[min(560px,calc(100vw-2rem))]">
        <div className="bg-white/94 backdrop-blur-sm border border-border rounded-xl shadow-md px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlay}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="w-9 h-9 flex-shrink-0 rounded-full bg-primary hover:bg-primary/90 flex items-center justify-center text-white shadow-sm transition"
            >
              {isPlaying ? (
                <Pause size={15} />
              ) : (
                <Play size={15} className="ml-0.5" fill="currentColor" />
              )}
            </button>

            {/* Scrubber */}
            <div className="relative flex-1 h-6 flex items-center">
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <input
                type="range"
                min={0}
                max={TOTAL_WEEKS - 1}
                value={week}
                onChange={(e) => handleSeek(Number(e.target.value))}
                className="absolute inset-0 opacity-0 cursor-pointer w-full"
                aria-label="Playback position"
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-primary border-2 border-white shadow pointer-events-none"
                style={{ left: `calc(${progressPct}% - 7px)` }}
              />
            </div>

            {/* Speed */}
            <div className="flex items-center gap-1 flex-shrink-0">
              {SPEED_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`speed-btn ${speed === s ? "speed-btn-active" : ""}`}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Dev tuning panel (?dev=1 only) ───────────────────────────────── */}
      {dev && (
        <div
          className="absolute top-4 right-4 z-30 max-w-[260px]"
          style={{
            background: "rgba(255,255,255,0.92)",
            border: "1px solid #ccc",
            borderRadius: 6,
            padding: "8px 10px",
            font: "11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace",
            color: "#222",
            display: "flex",
            flexDirection: "column",
            gap: 5,
          }}
        >
          <strong>DEV · Ocean Terrain 3D</strong>
          <div style={{ color: "#666" }}>
            {instances.toLocaleString()} voxels · cell ≈ {CELL_E_M.toFixed(0)}×
            {CELL_N_M.toFixed(0)} m · week {week + 1}/{TOTAL_WEEKS}
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ width: 84 }}>depth exag</span>
            {VOXEL_EXAG_OPTIONS.map((v) => (
              <button key={v} onClick={() => setVoxelExag(v)} style={devBtn(voxelExag === v)}>
                ×{v}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ width: 84 }}>terrain exag</span>
            {TERRAIN_EXAG_OPTIONS.map((v) => (
              <button key={v} onClick={() => setTerrainExag(v)} style={devBtn(terrainExag === v)}>
                ×{v}
              </button>
            ))}
          </div>
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
      )}
    </div>
  );
}
