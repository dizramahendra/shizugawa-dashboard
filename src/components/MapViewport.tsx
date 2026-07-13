/**
 * Production Map Viewport — MapLibre GL over the Esri World Topo basemap with
 * the app's traced geography (sub-basins, rivers, bay outline) georeferenced
 * onto the real Shizugawa Bay coastline.
 *
 * Real-map successor of the pure-SVG diagram in MapLibreMap.tsx (kept in the
 * repo as a fallback and still used by the Sub-basin tab). Preserves the SVG
 * viewport's behaviour on the Map Viewport tab:
 *   · rivers coloured by the selected variable's value for the current week
 *     (same colour stops + quantisation, recolours during playback)
 *   · hover highlight, click-to-select-and-zoom for rivers and sub-basins
 *   · ocean click → 3D Ocean Playback (with hover tooltip)
 *   · corridor mode (highlighted segments + role tags + zoom to corridor)
 *   · selected-river Grid view overlay, legend, Escape-to-deselect
 *   · numbered + named sub-basin labels (previously baked into the SVG art)
 *
 * Georeference (solved in the /map-real spike, anchored on the bay's two real
 * islands — Arajima and Tsubakishima):
 *   lon = 141.36568 + (x / 465) * 0.16158
 *   lat = 38.59295  + (1 - y / 586) * 0.15515
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { OCEAN_BASIN_PATH, SUB_BASIN_PATHS, RIVER_PATHS } from "@/lib/svgPaths";
import {
  RIVERS,
  generateRiverData,
  RIVER_COLS,
  RIVER_ROWS,
  VARIABLE_OPTIONS,
} from "@/lib/simulatedData";
import { buildRiverGeom, cellFeatures } from "@/lib/riverRaster";
import { REAL_RIVER_COURSES } from "@/lib/realRiverCourses";
import {
  MODEL_RIVER,
  MAIN_STEMS,
  COLOR_STOPS,
  interpolateColor,
  CHANNEL_MASKS,
} from "@/components/MapLibreMap";
import NorthArrow from "@/components/NorthArrow";
import LegendOverlay from "@/components/LegendOverlay";

const SVG_W = 465;
const SVG_H = 586;
const SVG_NS = "http://www.w3.org/2000/svg";

// km per column (18 km total river length across the raster grid)
const KM_PER_COL = 18 / RIVER_COLS;

// ── Georeference (fitted against the real coastline in the /map-real spike) ──
const GEO = {
  lon0: 141.36568,
  lat0: 38.59295,
  lonSpan: 0.16158,
  latSpan: 0.15515,
};

// Reverse lookup: model river id ("shizugawa") → SVG path id (1)
const MODEL_TO_PATH: Record<string, number> = Object.fromEntries(
  Object.entries(MODEL_RIVER).map(([pid, mid]) => [mid, Number(pid)]),
);

// Sub-basin number → river metadata (name + model id) from the same source
// the right-hand feature list uses.
const BASIN_RIVER: Record<number, { id: string; name: string }> = (() => {
  const out: Record<number, { id: string; name: string }> = {};
  for (const r of RIVERS) out[r.basin] = { id: r.id, name: r.name };
  return out;
})();

// ── Basemap style — Esri World Topo raster tiles, no API key ─────────────────
// `glyphs` points at OpenFreeMap's public font server so symbol (label)
// layers can render text over the raster basemap.
//
// TWO basemaps, crossfaded on zoom (the same z12.8→13.8 band the rivers use to
// switch line→raster): Esri World Topo carries the overview, but its rural-
// Japan tiles run out of detail past ~z15 (near-blank white up close). The GSI
// 地理院タイル "pale" base map — Japan's national cartography — stays detailed to
// z18 everywhere, so zooming into "detail mode" swaps the world under the data
// too instead of stretching an empty tile.
const BASEMAP_XFADE_LO = 12.8;
const BASEMAP_XFADE_HI = 13.8;
const ESRI_TOPO_STYLE = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    basemap: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        "Tiles &copy; Esri &mdash; Esri, USGS, NOAA, and the GIS User Community",
    },
    "basemap-hi": {
      type: "raster",
      tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"],
      tileSize: 256,
      minzoom: 2,
      maxzoom: 18,
      attribution: "地理院タイル (GSI Japan)",
    },
  },
  layers: [
    {
      id: "basemap",
      type: "raster",
      source: "basemap",
      paint: {
        "raster-opacity": [
          "interpolate", ["linear"], ["zoom"], BASEMAP_XFADE_LO, 1, BASEMAP_XFADE_HI, 0,
        ],
      },
    },
    {
      id: "basemap-hi",
      type: "raster",
      source: "basemap-hi",
      minzoom: BASEMAP_XFADE_LO - 0.5,
      paint: {
        "raster-opacity": [
          "interpolate", ["linear"], ["zoom"], BASEMAP_XFADE_LO, 0, BASEMAP_XFADE_HI, 1,
        ],
      },
    },
  ],
};

const SRC = {
  bay: "vp-bay",
  basins: "vp-basins",
  rivers: "vp-rivers",
  labels: "vp-labels",
  raster: "vp-river-raster",
  rasterHi: "vp-river-raster-hi",
};
const LYR = {
  bayFill: "vp-bay-fill",
  bayLine: "vp-bay-line",
  basinFill: "vp-basins-fill",
  basinLine: "vp-basins-line",
  riverHalo: "vp-rivers-halo",
  riverCasing: "vp-rivers-casing",
  river: "vp-rivers",
  riverHit: "vp-rivers-hit",
  labels: "vp-basin-labels",
  raster: "vp-river-raster-fill",
  rasterHi: "vp-river-raster-hi-fill",
};

// ── Minimal local GeoJSON types (avoids un-hoisted @types/geojson) ──────────
type LonLat = [number, number];
type LLBounds = [LonLat, LonLat];
interface GeoFeature {
  type: "Feature";
  id?: number;
  properties: Record<string, unknown>;
  geometry:
    | { type: "Polygon"; coordinates: LonLat[][] }
    | { type: "MultiLineString"; coordinates: LonLat[][] }
    | { type: "Point"; coordinates: LonLat };
}
interface GeoFC {
  type: "FeatureCollection";
  features: GeoFeature[];
}

// ── SVG path sampling (browser DOM, no extra deps) ──────────────────────────
interface SampledSubpath {
  points: Array<[number, number]>; // SVG px space
  closed: boolean;
}

function samplePathSubpaths(
  d: string,
  host: SVGSVGElement,
  stepPx = 2.5,
): SampledSubpath[] {
  const out: SampledSubpath[] = [];
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
    for (let i = 0; i <= n; i++) {
      const p = el.getPointAtLength((i / n) * len);
      pts.push([p.x, p.y]);
    }
    host.removeChild(el);
    out.push({ points: pts, closed: /[Zz]\s*$/.test(sub) });
  }
  return out;
}

function toLonLat(x: number, y: number): LonLat {
  return [
    +(GEO.lon0 + (x / SVG_W) * GEO.lonSpan).toFixed(6),
    +(GEO.lat0 + (1 - y / SVG_H) * GEO.latSpan).toFixed(6),
  ];
}

function toRing(sub: SampledSubpath): LonLat[] {
  const ring = sub.points.map(([x, y]) => toLonLat(x, y));
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first] as LonLat);
  return ring;
}

/** Area-weighted centroid of a closed ring (fallback: first vertex). */
function ringCentroid(ring: LonLat[]): LonLat {
  let a = 0,
    cx = 0,
    cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-12) return ring[0];
  return [cx / (3 * a), cy / (3 * a)];
}

interface GeoData {
  bay: GeoFC;
  basins: GeoFC;
  rivers: GeoFC;
  labels: GeoFC;
  overall: LLBounds;
  /** Per model-river-id bounds, for click-to-zoom */
  riverBounds: Record<string, LLBounds>;
  /** Per model-river-id midpoint, for corridor role tags */
  riverMidpoints: Record<string, LonLat>;
}

function expandBounds(b: { minLon: number; minLat: number; maxLon: number; maxLat: number }, [lon, lat]: LonLat) {
  if (lon < b.minLon) b.minLon = lon;
  if (lon > b.maxLon) b.maxLon = lon;
  if (lat < b.minLat) b.minLat = lat;
  if (lat > b.maxLat) b.maxLat = lat;
}

function freshBounds() {
  return { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
}

function toLL(b: { minLon: number; minLat: number; maxLon: number; maxLat: number }): LLBounds {
  return [
    [b.minLon, b.minLat],
    [b.maxLon, b.maxLat],
  ];
}

function unionBounds(list: LLBounds[]): LLBounds {
  const b = freshBounds();
  for (const [[minLon, minLat], [maxLon, maxLat]] of list) {
    expandBounds(b, [minLon, minLat]);
    expandBounds(b, [maxLon, maxLat]);
  }
  return toLL(b);
}

/** Sample every traced shape and convert to georeferenced GeoJSON. */
function buildGeoData(): GeoData {
  const host = document.createElementNS(SVG_NS, "svg");
  host.setAttribute("viewBox", `0 0 ${SVG_W} ${SVG_H}`);
  host.style.position = "absolute";
  host.style.width = "0";
  host.style.height = "0";
  host.style.overflow = "hidden";
  host.style.visibility = "hidden";
  document.body.appendChild(host);

  try {
    const overall = freshBounds();

    // Bay — first subpath is the outer ring, the rest are island holes.
    const baySubs = samplePathSubpaths(OCEAN_BASIN_PATH, host);
    const bayRings = baySubs.map(toRing);
    for (const ring of bayRings) for (const pt of ring) expandBounds(overall, pt);
    const bay: GeoFC = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: 0,
          properties: { id: 0, name: "Shizugawa Bay (Ocean)" },
          geometry: { type: "Polygon", coordinates: bayRings },
        },
      ],
    };

    // Sub-basins + centroid label points.
    const basinFeatures: GeoFeature[] = [];
    const labelFeatures: GeoFeature[] = [];
    for (const [idStr, d] of Object.entries(SUB_BASIN_PATHS)) {
      const id = Number(idStr);
      const rings = samplePathSubpaths(d, host).map(toRing);
      if (rings.length === 0) continue;
      for (const ring of rings) for (const pt of ring) expandBounds(overall, pt);
      const river = BASIN_RIVER[id];
      basinFeatures.push({
        type: "Feature",
        id,
        properties: { id, name: river?.name ?? "", riverId: river?.id ?? "" },
        geometry: { type: "Polygon", coordinates: rings },
      });
      labelFeatures.push({
        type: "Feature",
        id,
        properties: {
          id,
          label: river ? `${id}\n${river.name}` : `${id}`,
        },
        geometry: { type: "Point", coordinates: ringCentroid(rings[0]) },
      });
    }

    // Rivers — MultiLineString per SVG path id, tagged with the model river id.
    const riverFeatures: GeoFeature[] = [];
    const riverBounds: Record<string, LLBounds> = {};
    const riverMidpoints: Record<string, LonLat> = {};
    for (const [idStr, d] of Object.entries(RIVER_PATHS)) {
      const id = Number(idStr);
      const modelId = MODEL_RIVER[id] ?? "";
      // ONE geometry per river across representations: prefer the baked REAL
      // course (OSM/MLIT-snapped — the same centreline the pixel raster is
      // built on) so the line, the hit target, the selection zoom and the
      // raster all agree; fall back to the hand-drawn SVG course.
      const baked = modelId ? REAL_RIVER_COURSES[modelId] : undefined;
      let lines: LonLat[][];
      if (baked && baked.length >= 2) {
        lines = [baked.map((p) => [p[0], p[1]] as LonLat)];
      } else {
        const subs = samplePathSubpaths(d, host);
        if (subs.length === 0) continue;
        lines = subs.map((sub) => sub.points.map(([x, y]) => toLonLat(x, y)));
      }
      riverFeatures.push({
        type: "Feature",
        id,
        properties: { id, riverId: modelId, mainStem: MAIN_STEMS.has(id) },
        geometry: { type: "MultiLineString", coordinates: lines },
      });
      if (modelId) {
        const rb = freshBounds();
        for (const line of lines) for (const pt of line) expandBounds(rb, pt);
        riverBounds[modelId] = toLL(rb);
        const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), lines[0]);
        riverMidpoints[modelId] = longest[Math.floor(longest.length / 2)];
      }
    }

    return {
      bay,
      basins: { type: "FeatureCollection", features: basinFeatures },
      rivers: { type: "FeatureCollection", features: riverFeatures },
      labels: { type: "FeatureCollection", features: labelFeatures },
      overall: toLL(overall),
      riverBounds,
      riverMidpoints,
    };
  } finally {
    document.body.removeChild(host);
  }
}

// ── Paint-expression builders ────────────────────────────────────────────────

function inIdsExpr(ids: number[]): any {
  if (ids.length === 0) return false;
  return ["in", ["get", "id"], ["literal", ids]];
}

/** Data-driven river colour: SVG path id → current data colour. */
function riverColorExpr(colors: Record<number, string>): any {
  const expr: any[] = ["match", ["get", "id"]];
  for (const [idStr, c] of Object.entries(colors)) expr.push(Number(idStr), c);
  expr.push("#60a5fa"); // fallback — same as the SVG viewport's default
  return expr;
}

/** Mirrors the SVG stroke widths: main stems 4 (6 active), others 2.5 (4 active). */
function riverWidthExpr(activeIds: number[]): any {
  const active = inIdsExpr(activeIds);
  return [
    "case",
    ["all", ["get", "mainStem"], active], 6,
    ["get", "mainStem"], 4,
    active, 4,
    2.5,
  ];
}

// ── Component ────────────────────────────────────────────────────────────────

interface CorridorRiverEntry {
  id: string;
  role: "upper" | "lower";
}

interface MapViewportProps {
  week: number;
  variableId: string;
  selectedRiver: string | null;
  onSelectRiver: (id: string | null) => void;
  onSelectOcean: () => void;
  corridorSegments?: { rivers: CorridorRiverEntry[]; corridorId: string } | null;
}

export default function MapViewport({
  week,
  variableId,
  selectedRiver,
  onSelectRiver,
  onSelectOcean,
  corridorSegments,
}: MapViewportProps) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const geoRef = useRef<GeoData | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const hoveredBasinRef = useRef<number | null>(null);
  const viewKeyRef = useRef<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const [hoveredRiver, setHoveredRiver] = useState<number | null>(null);
  const [hoveredOcean, setHoveredOcean] = useState(false);
  const [showGrid, setShowGrid] = useState(false);

  // Latest interaction state for the (once-registered) map event handlers.
  const stateRef = useRef({
    selectedRiver,
    corridorActive: !!corridorSegments,
    onSelectRiver,
    onSelectOcean,
  });
  stateRef.current = { selectedRiver, corridorActive: !!corridorSegments, onSelectRiver, onSelectOcean };

  const stops = COLOR_STOPS[variableId] ?? COLOR_STOPS.nitrogen;
  const variableLabel = VARIABLE_OPTIONS.find((v) => v.id === variableId)?.label ?? variableId;

  // Data-driven colour per reach — identical logic to the SVG viewport.
  const reachColors = useMemo(() => {
    const out: Record<number, string> = {};
    for (const idStr of Object.keys(RIVER_PATHS)) {
      const id = Number(idStr);
      const modelRiver = MODEL_RIVER[id] ?? "shizugawa";
      const grid = generateRiverData(week, modelRiver);
      const col = Math.min(RIVER_COLS - 1, Math.round(0.5 * (RIVER_COLS - 1)));
      let sum = 0;
      for (let row = 0; row < RIVER_ROWS; row++) sum += grid[row]?.[col] ?? 0;
      out[id] = interpolateColor(stops, Math.max(0, Math.min(1, sum / RIVER_ROWS)));
    }
    return out;
  }, [week, stops]);

  // Grid data for the selected river (used by the Grid view overlay)
  const gridData = useMemo(() => {
    if (!selectedRiver) return null;
    return generateRiverData(week, selectedRiver);
  }, [selectedRiver, week]);

  // ── Map creation (once) ────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const geo = geoRef.current ?? buildGeoData();
    geoRef.current = geo;

    const map = new maplibregl.Map({
      container,
      style: ESRI_TOPO_STYLE as any,
      bounds: geo.overall as any,
      fitBoundsOptions: { padding: 40 },
      // GSI detail ends at z18 — stop there rather than stretching blur.
      maxZoom: 17.9,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    // Dev-only handle for debugging/driving the camera from the console.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (import.meta.env.DEV) (window as any).__mapviewport = map;

    // The container is often laid out (given its real size) only AFTER the map
    // is constructed, inside this tab's flex layout — so MapLibre's first frame
    // renders against a 0-size container and stays blank until an interaction.
    // A ResizeObserver calls resize() the moment the container gets/changes size,
    // so the map paints correctly on load without needing a manual nudge.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container);

    map.on("style.load", () => {
      map.addSource(SRC.bay, { type: "geojson", data: geo.bay as any, promoteId: "id" });
      map.addSource(SRC.basins, { type: "geojson", data: geo.basins as any, promoteId: "id" });
      map.addSource(SRC.rivers, { type: "geojson", data: geo.rivers as any, promoteId: "id" });
      map.addSource(SRC.labels, { type: "geojson", data: geo.labels as any });

      // Ocean basin — subtle tint + outline (the basemap already shows water)
      map.addLayer({
        id: LYR.bayFill,
        type: "fill",
        source: SRC.bay,
        paint: { "fill-color": "#38bdf8", "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: LYR.bayLine,
        type: "line",
        source: SRC.bay,
        paint: { "line-color": "#0284c7", "line-width": 1.5, "line-opacity": 0.85 },
      });

      // Sub-basins — semi-transparent fill (hover-highlighted) + outline
      map.addLayer({
        id: LYR.basinFill,
        type: "fill",
        source: SRC.basins,
        paint: {
          "fill-color": "#64748b",
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false], 0.22,
            0.08,
          ] as any,
        },
      });
      map.addLayer({
        id: LYR.basinLine,
        type: "line",
        source: SRC.basins,
        paint: { "line-color": "#334155", "line-width": 1.1, "line-opacity": 0.65 },
      });

      // River glow halo — only for selected / hovered / corridor rivers
      map.addLayer({
        id: LYR.riverHalo,
        type: "line",
        source: SRC.rivers,
        filter: ["==", ["get", "id"], -999] as any,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": riverColorExpr(reachColors),
          "line-width": ["+", riverWidthExpr([]), 10] as any,
          "line-opacity": 0.22,
        },
      });

      // River casing — a dark outline drawn UNDER the coloured line so every
      // river reads against the busy terrain basemap, even at pale mid-ramp
      // values that would otherwise wash out against the beige/green land.
      map.addLayer({
        id: LYR.riverCasing,
        type: "line",
        source: SRC.rivers,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#0f172a",
          "line-width": ["+", riverWidthExpr([]), 2.6] as any,
          "line-opacity": 0.8,
        },
      });

      // Rivers — data-coloured lines
      map.addLayer({
        id: LYR.river,
        type: "line",
        source: SRC.rivers,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": riverColorExpr(reachColors),
          "line-width": riverWidthExpr([]),
          "line-opacity": 1,
        },
      });

      // Transparent wide hit zone (mirrors the SVG's 18px hit path)
      map.addLayer({
        id: LYR.riverHit,
        type: "line",
        source: SRC.rivers,
        paint: { "line-color": "#000000", "line-opacity": 0, "line-width": 18 },
      });

      // Selected-river pixel raster — the geo-anchored "model output" detail
      // layer (same cell geometry as the River Playback 2D map). Empty until a
      // river is selected; recoloured per week in the effect below.
      map.addSource(SRC.raster, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] } as any,
      });
      map.addLayer({
        id: LYR.raster,
        type: "fill",
        source: SRC.raster,
        paint: {
          "fill-color": ["get", "color"] as any,
          "fill-opacity": 0.92,
          // Soft dark cell outline: low-value cells are pale blue, and on the
          // dimmed near-white basemap a white outline made them invisible.
          "fill-outline-color": "rgba(51,65,85,0.35)",
        },
      });
      // Narrow TRUE-WIDTH raster tier for deep zoom — same data, half-size
      // cells at near-real channel width, crossfaded in as the wide schematic
      // tier fades out (see the zoom ramps in the selection effect).
      map.addSource(SRC.rasterHi, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] } as any,
      });
      map.addLayer({
        id: LYR.rasterHi,
        type: "fill",
        source: SRC.rasterHi,
        paint: {
          "fill-color": ["get", "color"] as any,
          "fill-opacity": 0,
          "fill-outline-color": "rgba(51,65,85,0.35)",
        },
      });

      // Sub-basin number + name labels at polygon centroids
      map.addLayer({
        id: LYR.labels,
        type: "symbol",
        source: SRC.labels,
        layout: {
          "text-field": ["get", "label"] as any,
          "text-font": ["Noto Sans Bold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 9.5, 9, 12, 13] as any,
          "text-line-height": 1.15,
          "text-max-width": 20,
        },
        paint: {
          "text-color": "#0f172a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.6,
        },
      });

      setMapReady(true);
    });

    const HIT_LAYERS = [LYR.riverHit, LYR.basinFill, LYR.bayFill];

    const pick = (point: maplibregl.PointLike) => {
      let river: maplibregl.MapGeoJSONFeature | undefined;
      let basin: maplibregl.MapGeoJSONFeature | undefined;
      let bay: maplibregl.MapGeoJSONFeature | undefined;
      try {
        for (const f of map.queryRenderedFeatures(point as any, { layers: HIT_LAYERS })) {
          if (f.layer.id === LYR.riverHit && !river) river = f;
          else if (f.layer.id === LYR.basinFill && !basin) basin = f;
          else if (f.layer.id === LYR.bayFill && !bay) bay = f;
        }
      } catch {
        /* style not ready yet */
      }
      return { river, basin, bay };
    };

    const setBasinHover = (id: number | null) => {
      if (hoveredBasinRef.current === id) return;
      if (hoveredBasinRef.current != null) {
        map.setFeatureState({ source: SRC.basins, id: hoveredBasinRef.current }, { hover: false });
      }
      if (id != null) {
        map.setFeatureState({ source: SRC.basins, id }, { hover: true });
      }
      hoveredBasinRef.current = id;
    };

    map.on("mousemove", (e) => {
      if (!mapRef.current) return;
      const st = stateRef.current;
      const { river, basin, bay } = pick(e.point);
      const riversInteractive = !st.corridorActive;
      const basinsInteractive = !st.corridorActive;
      const oceanInteractive = !st.selectedRiver;

      let cursor = "";
      let nextRiver: number | null = null;
      let nextBasin: number | null = null;
      let nextOcean = false;

      if (river && riversInteractive) {
        nextRiver = Number(river.properties?.id);
        cursor = "pointer";
      } else if (basin && basinsInteractive && basin.properties?.riverId) {
        nextBasin = Number(basin.properties.id);
        cursor = "pointer";
      } else if (bay && oceanInteractive) {
        nextOcean = true;
        cursor = "pointer";
      }

      map.getCanvas().style.cursor = cursor;
      setHoveredRiver(nextRiver);
      setHoveredOcean(nextOcean);
      setBasinHover(nextBasin);
    });

    map.on("mouseout", () => {
      map.getCanvas().style.cursor = "";
      setHoveredRiver(null);
      setHoveredOcean(false);
      setBasinHover(null);
    });

    map.on("click", (e) => {
      const st = stateRef.current;
      const { river, basin, bay } = pick(e.point);

      if (river && !st.corridorActive) {
        const modelId = MODEL_RIVER[Number(river.properties?.id)] ?? null;
        st.onSelectRiver(modelId);
        return;
      }
      if (basin && !st.corridorActive && basin.properties?.riverId) {
        st.onSelectRiver(String(basin.properties.riverId));
        return;
      }
      if (bay && !st.selectedRiver) {
        st.onSelectOcean();
        return;
      }
      // Click on empty map while zoomed into a river → deselect
      if (st.selectedRiver) st.onSelectRiver(null);
    });

    return () => {
      resizeObserver.disconnect();
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
      hoveredBasinRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Data colouring — recolours during playback / variable change ──────────
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const colorExpr = riverColorExpr(reachColors);
    map.setPaintProperty(LYR.river, "line-color", colorExpr);
    map.setPaintProperty(LYR.riverHalo, "line-color", colorExpr);
  }, [reachColors, mapReady]);

  // ── River pixel raster (ALL rivers) — the zoomed-in representation ─────────
  // NHD-style scale switching: every river carries cells in ONE source, tagged
  // by slug; the paint effect below crossfades lines → raster on zoom (and the
  // selected river always shows its raster). Recoloured every week — ~8k small
  // features, cheap for setData at the weekly cadence.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const src = map.getSource(SRC.raster) as maplibregl.GeoJSONSource | undefined;
    const srcHi = map.getSource(SRC.rasterHi) as maplibregl.GeoJSONSource | undefined;
    if (!src || !srcHi) return;
    const wide: any[] = [];
    const narrow: any[] = [];
    let idW = 0, idN = 0;
    for (const r of RIVERS) {
      const data = generateRiverData(week, r.id);
      const geomW = buildRiverGeom(r.id, "wide");
      if (geomW.cells.length) {
        wide.push(...cellFeatures(geomW.cells, data, stops, r.id, idW));
        idW += geomW.cells.length;
      }
      const geomN = buildRiverGeom(r.id, "narrow");
      if (geomN.cells.length) {
        narrow.push(...cellFeatures(geomN.cells, data, stops, r.id, idN));
        idN += geomN.cells.length;
      }
    }
    src.setData({ type: "FeatureCollection", features: wide } as any);
    srcHi.setData({ type: "FeatureCollection", features: narrow } as any);
  }, [week, stops, mapReady]);

  // ── Selection / hover / corridor visuals ───────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    const selPathId = selectedRiver != null ? MODEL_TO_PATH[selectedRiver] : undefined;
    const corridorPathIds = corridorSegments
      ? corridorSegments.rivers
          .map((r) => MODEL_TO_PATH[r.id])
          .filter((n): n is number => n != null)
      : [];
    const focusIds = [...corridorPathIds];
    if (selPathId != null) focusIds.push(selPathId);
    const activeIds = [...focusIds];
    if (hoveredRiver != null && !activeIds.includes(hoveredRiver)) activeIds.push(hoveredRiver);
    const anyFocus = focusIds.length > 0;
    const dimmed = !!selectedRiver; // SVG dims the background only on river selection

    // Representation switch (scale-based symbology, Esri/NHD style): while a
    // river is SELECTED its detailed representation — the pixel raster — IS the
    // river, so its line/casing/halo hide entirely (one entity, never two
    // geometries at once). Everything else keeps its line representation.
    const hiddenExpr: any = selPathId != null ? ["==", ["get", "id"], selPathId] : false;

    // Zoom crossfade lines ⇄ raster (NHD-style scale-dependent representation):
    // between z12.8 and z13.8 the line network fades OUT while the pixel
    // rasters fade IN, so a river is always exactly ONE visible representation.
    // The selected river's raster is always fully visible (its line is hidden
    // regardless), and non-selected rasters inherit the 0.15 focus dimming.
    // NOTE: maplibre only allows ["zoom"] as the input of a TOP-LEVEL
    // interpolate/step, so the zoom ramp is the outer expression and the
    // data-driven cases live in its stop outputs (composite expressions).
    const zoomRamp = (low: any, high: any): any =>
      ["interpolate", ["linear"], ["zoom"], 12.8, low, 13.8, high];
    // Raster opacities per tier: the wide schematic tier carries z13.8→15.4,
    // then hands over to the narrow TRUE-WIDTH tier (half-size cells at
    // near-real channel width) by z16.4 — so against the detailed GSI basemap
    // the raster sits IN the channel instead of blanketing the town.
    const rasterLow: any = selectedRiver
      ? ["case", ["==", ["get", "slug"], selectedRiver], 0.92, 0]
      : 0;
    const rasterHigh: any = selectedRiver
      ? ["case", ["==", ["get", "slug"], selectedRiver], 0.92, 0.15]
      : 0.92;
    map.setPaintProperty(
      LYR.raster,
      "fill-opacity",
      ["interpolate", ["linear"], ["zoom"],
        12.8, rasterLow, 13.8, rasterHigh, 15.4, rasterHigh, 16.4, 0] as any,
    );
    map.setPaintProperty(
      LYR.rasterHi,
      "fill-opacity",
      ["interpolate", ["linear"], ["zoom"], 15.4, 0, 16.4, rasterHigh] as any,
    );

    // Rivers: widths grow for active reaches; non-focused reaches dim to 0.15.
    map.setPaintProperty(LYR.river, "line-width", riverWidthExpr(activeIds));
    map.setPaintProperty(
      LYR.river,
      "line-opacity",
      zoomRamp(anyFocus ? ["case", hiddenExpr, 0, inIdsExpr(focusIds), 1, 0.15] : 1, 0),
    );
    // Casing tracks the river width and its focus dimming so it stays a tight outline.
    map.setPaintProperty(LYR.riverCasing, "line-width", ["+", riverWidthExpr(activeIds), 2.6] as any);
    map.setPaintProperty(
      LYR.riverCasing,
      "line-opacity",
      zoomRamp(anyFocus ? ["case", hiddenExpr, 0, inIdsExpr(focusIds), 0.8, 0.12] : 0.8, 0),
    );

    // Halo: hovered / corridor reaches only — the selected river's raster
    // carries its own selection affordance, so it gets no line halo.
    const haloIds = activeIds.filter((i) => i !== selPathId);
    map.setFilter(
      LYR.riverHalo,
      haloIds.length > 0
        ? (["in", ["get", "id"], ["literal", haloIds]] as any)
        : (["==", ["get", "id"], -999] as any),
    );
    map.setPaintProperty(LYR.riverHalo, "line-width", ["+", riverWidthExpr(activeIds), 10] as any);
    map.setPaintProperty(
      LYR.riverHalo,
      "line-opacity",
      corridorPathIds.length > 0 ? (["case", inIdsExpr(corridorPathIds), 0.28, 0.22] as any) : 0.22,
    );

    // Background dim — the real-map equivalent of the SVG's grayscale+fade.
    // Applied to BOTH basemaps; opacity keeps the zoom crossfade (top-level
    // interpolate, dim baked into the stop values).
    //
    // Figure-ground at data zoom: the GSI map is intentionally information-
    // dense (contours, field symbols, its own blue streams), and past ~z14 it
    // competes with the pixel raster. So even UNSELECTED, the detail basemap
    // fades to ~55% and desaturates as the rasters take over — the data reads
    // as figure, the map as ground.
    const dimTop = dimmed ? 0.35 : 1;
    const hiDeep = dimmed ? 0.35 : 0.55;
    map.setPaintProperty("basemap", "raster-saturation", dimmed ? -1 : 0);
    map.setPaintProperty(
      "basemap-hi",
      "raster-saturation",
      dimmed
        ? -1
        : (["interpolate", ["linear"], ["zoom"], BASEMAP_XFADE_HI, 0, 15.2, -0.5] as any),
    );
    map.setPaintProperty(
      "basemap",
      "raster-opacity",
      ["interpolate", ["linear"], ["zoom"], BASEMAP_XFADE_LO, dimTop, BASEMAP_XFADE_HI, 0] as any,
    );
    map.setPaintProperty(
      "basemap-hi",
      "raster-opacity",
      ["interpolate", ["linear"], ["zoom"],
        BASEMAP_XFADE_LO, 0, BASEMAP_XFADE_HI, dimTop, 15.2, hiDeep] as any,
    );
    map.setPaintProperty(
      LYR.basinFill,
      "fill-opacity",
      dimmed
        ? 0.03
        : (["case", ["boolean", ["feature-state", "hover"], false], 0.22, 0.08] as any),
    );
    map.setPaintProperty(LYR.basinLine, "line-opacity", dimmed ? 0.15 : 0.65);
    map.setPaintProperty(LYR.labels, "text-opacity", dimmed ? 0.15 : 1);
    map.setPaintProperty(LYR.bayFill, "fill-opacity", dimmed ? 0.04 : 0.12);
    map.setPaintProperty(LYR.bayLine, "line-opacity", dimmed ? 0.2 : 0.85);
  }, [selectedRiver, corridorSegments, hoveredRiver, mapReady]);

  // Ocean outline hover emphasis (SVG: strokeWidth 1.5 → 2.5)
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    map.setPaintProperty(LYR.bayLine, "line-width", hoveredOcean ? 2.5 : 1.5);
  }, [hoveredOcean, mapReady]);

  // ── Camera: zoom to selection / corridor, back out on deselect ────────────
  useEffect(() => {
    const map = mapRef.current;
    const geo = geoRef.current;
    if (!mapReady || !map || !geo) return;

    let key = "all";
    let bounds = geo.overall;
    if (corridorSegments) {
      const parts = corridorSegments.rivers
        .map((r) => geo.riverBounds[r.id])
        .filter((b): b is LLBounds => !!b);
      if (parts.length > 0) {
        key = `corridor:${corridorSegments.corridorId}`;
        bounds = unionBounds(parts);
      }
    } else if (selectedRiver && geo.riverBounds[selectedRiver]) {
      key = `river:${selectedRiver}`;
      bounds = geo.riverBounds[selectedRiver];
    }

    if (viewKeyRef.current === key) return;
    const first = viewKeyRef.current === null;
    viewKeyRef.current = key;
    if (first && key === "all") return; // map was constructed with these bounds

    map.fitBounds(bounds as any, {
      padding: key === "all" ? 40 : 70,
      maxZoom: key === "all" ? 15 : 13.5,
      animate: !first,
      duration: 700,
    });
  }, [selectedRiver, corridorSegments, mapReady]);

  // ── Corridor role tags (Upper 1 / Upper 2 / Lower → Bay) ──────────────────
  useEffect(() => {
    const map = mapRef.current;
    const geo = geoRef.current;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    if (!mapReady || !map || !geo || !corridorSegments) return;

    const UPPER_COLORS = ["#3b82f6", "#8b5cf6"];
    const UPPER_LABELS = ["Upper 1", "Upper 2"];
    let ui = 0;
    for (const r of corridorSegments.rivers) {
      const info =
        r.role === "lower"
          ? { color: "#14b8a6", label: "Lower → Bay" }
          : { color: UPPER_COLORS[ui % 2], label: UPPER_LABELS[ui % 2] };
      if (r.role !== "lower") ui++;
      const mid = geo.riverMidpoints[r.id];
      if (!mid) continue;
      const el = document.createElement("div");
      el.textContent = info.label;
      el.style.cssText = `background:${info.color};color:#fff;font:700 10px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;padding:2px 7px;border-radius:4px;opacity:0.92;pointer-events:none;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,0.25);`;
      const marker = new maplibregl.Marker({ element: el }).setLngLat(mid).addTo(map);
      markersRef.current.push(marker);
    }
  }, [corridorSegments, mapReady]);

  // Escape deselects the river (same as the SVG viewport)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSelectRiver(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onSelectRiver]);

  // Grid view only makes sense while zoomed into a single river
  useEffect(() => {
    if (!selectedRiver || corridorSegments) setShowGrid(false);
  }, [selectedRiver, corridorSegments]);

  return (
    <div className="relative w-full h-full bg-[#e8edf2] overflow-hidden">
      {/* Inline style (not Tailwind classes): maplibre-gl.css sets
          `.maplibregl-map { position: relative }`, which would override an
          `absolute` utility class and collapse the container to 0 height. */}
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {/* Pixel grid view overlay — CSS-grid based, fills any container shape */}
      {showGrid && selectedRiver && gridData && (() => {
        const mask = CHANNEL_MASKS[selectedRiver] ?? CHANNEL_MASKS.shizugawa;
        const riverLabel = selectedRiver.charAt(0).toUpperCase() + selectedRiver.slice(1);
        const Y_AXIS_W = "3.2rem";
        return (
          <div className="absolute inset-0 z-10 bg-[#f8fafc] flex flex-col overflow-hidden">

            {/* Title bar */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 pt-2.5 pb-1.5 border-b border-slate-100">
              <div>
                <span className="text-xs font-semibold text-gray-700">{riverLabel} River</span>
                <span className="ml-2 text-[9px] text-gray-400">Raster channel · upstream → downstream</span>
              </div>
              <span className="text-[9px] text-gray-400 font-mono">{RIVER_ROWS}×{RIVER_COLS}</span>
            </div>

            {/* Grid + Y-axis */}
            <div className="flex flex-1 min-h-0 items-stretch px-3 pt-2 pb-0 gap-0">

              {/* Y-axis labels */}
              <div className="flex flex-col justify-between flex-shrink-0 text-right pr-1.5"
                   style={{ width: Y_AXIS_W }}>
                <span className="text-[9px] text-slate-400 font-mono leading-none">N bank</span>
                <span className="text-[9px] text-slate-400 font-mono leading-none">thalweg</span>
                <span className="text-[9px] text-slate-400 font-mono leading-none">S bank</span>
              </div>

              {/* Pixel grid */}
              <div
                className="flex-1 min-w-0 rounded-sm border border-slate-200 bg-white overflow-hidden"
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${RIVER_COLS}, 1fr)`,
                  gridTemplateRows:    `repeat(${RIVER_ROWS}, 1fr)`,
                  gap: "1px",
                  padding: "1px",
                  backgroundColor: "#e2e8f0",
                }}
              >
                {Array.from({ length: RIVER_ROWS }, (_, row) =>
                  Array.from({ length: RIVER_COLS }, (_, col) => {
                    const inCh = mask[row]?.[col] ?? false;
                    const val  = inCh ? (gridData[row]?.[col] ?? 0) : 0;
                    return (
                      <div
                        key={`${row}-${col}`}
                        title={inCh ? `r${row} c${col}: ${val.toFixed(3)}` : undefined}
                        style={{
                          backgroundColor: inCh
                            ? interpolateColor(stops, Math.max(0, Math.min(1, val)))
                            : "white",
                          borderRadius: 1,
                        }}
                      />
                    );
                  })
                )}
              </div>
            </div>

            {/* X-axis km labels */}
            <div className="flex-shrink-0 flex pt-0.5 pb-0" style={{ paddingLeft: `calc(${Y_AXIS_W} + 0.75rem)`, paddingRight: "0.75rem" }}>
              <div className="flex-1 relative" style={{ height: "1.1rem" }}>
                {Array.from({ length: 7 }, (_, i) => {
                  const col = i * 6;
                  const pct = (col / RIVER_COLS) * 100;
                  return (
                    <span key={i}
                      className="absolute text-[8px] text-slate-400 font-mono"
                      style={{ left: `${pct}%`, transform: "translateX(-50%)", top: 0, whiteSpace: "nowrap" }}>
                      {(col * KM_PER_COL).toFixed(0)} km
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Direction label + color scale */}
            {(() => {
              const vo = VARIABLE_OPTIONS.find(v => v.id === variableId);
              return (
                <div className="flex-shrink-0 px-4 pb-3 pt-1">
                  <div className="text-[8px] text-center text-slate-300 mb-1">← upstream · downstream →</div>
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] text-slate-400 font-mono">{vo?.min ?? 0} {vo?.unit}</span>
                    <div className="flex-1 h-2 rounded"
                         style={{ background: `linear-gradient(to right, ${stops.join(", ")})` }} />
                    <span className="text-[8px] text-slate-400 font-mono">{vo?.max ?? 1} {vo?.unit}</span>
                  </div>
                  <div className="text-[8px] text-center text-slate-400 mt-0.5">{variableLabel}</div>
                </div>
              );
            })()}

          </div>
        );
      })()}

      {/* Ocean tooltip */}
      {hoveredOcean && !showGrid && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white border border-primary/30 rounded-md px-3 py-2 shadow-md text-center whitespace-nowrap pointer-events-none z-10"
          style={{ fontSize: "11px" }}>
          <div className="font-semibold text-primary">Shizugawa Bay (Ocean)</div>
          <div className="text-muted-foreground mt-0.5" style={{ fontSize: "9px" }}>Click → 3D Ocean Playback</div>
        </div>
      )}

      {/* Color bar legend — hidden when grid overlay is active */}
      {!showGrid && (() => {
        const varOpt = VARIABLE_OPTIONS.find(v => v.id === variableId);
        const minVal = varOpt?.min ?? 0;
        const maxVal = varOpt?.max ?? 1;
        const unit   = varOpt?.unit ?? "";
        const dec    = varOpt?.decimals ?? 1;
        return (
          <div className="absolute bottom-3 left-3 pointer-events-none z-10">
            <LegendOverlay
              stops={stops}
              min={minVal}
              max={maxVal}
              unit={unit}
              decimals={dec}
            />
          </div>
        );
      })()}

      {/* Controls when a corridor is active */}
      {corridorSegments && (
        <div className="absolute top-2 left-2 flex items-center gap-2 flex-wrap z-10">
          <div className="flex items-center gap-1.5 bg-white/95 border border-violet-200 rounded px-2.5 py-1 shadow-sm text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
            <span className="text-violet-700 font-semibold">Corridor View</span>
          </div>
          <button
            onClick={() => navigate(`/river?river=${corridorSegments.corridorId}`)}
            className="bg-violet-600 text-white border border-violet-700 rounded px-2.5 py-1 text-[10px] font-semibold shadow-sm hover:bg-violet-700 transition-colors"
          >
            View in 2D River →
          </button>
        </div>
      )}

      {/* Controls when zoomed into a river */}
      {selectedRiver && !corridorSegments && (
        <div className="absolute top-2 left-2 flex items-center gap-2 z-10">
          <button
            onClick={() => onSelectRiver(null)}
            className="bg-white/90 border border-border rounded px-2 py-1 text-[10px] text-muted-foreground shadow-sm hover:bg-white"
          >
            ← Back
          </button>
          {/* Map / Grid toggle */}
          <div className="flex rounded overflow-hidden border border-border shadow-sm">
            <button
              className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${!showGrid ? "bg-primary text-white" : "bg-white text-muted-foreground hover:bg-muted"}`}
              onClick={() => setShowGrid(false)}
            >
              Map
            </button>
            <button
              className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${showGrid ? "bg-primary text-white" : "bg-white text-muted-foreground hover:bg-muted"}`}
              onClick={() => setShowGrid(true)}
            >
              Grid
            </button>
          </div>
        </div>
      )}

      {/* North arrow — kept above the basemap attribution strip */}
      {!showGrid && <NorthArrow className="absolute bottom-10 right-3 z-10" />}
    </div>
  );
}
