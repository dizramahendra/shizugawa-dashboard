/**
 * SPIKE — Real MapLibre terrain/topographic basemap for Shizugawa Bay.
 *
 * Standalone prototype mounted on /map-real. Renders a real (no-API-key)
 * topographic basemap and overlays the app's traced SVG shapes
 * (bay outline, sub-basin polygons, river centerlines) as GeoJSON,
 * georeferenced with an adjustable linear transform so the traced
 * coastline can be fitted onto the real one.
 *
 * Does NOT touch the existing MapLibreMap.tsx / SVG map viewport.
 */
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { OCEAN_BASIN_PATH, SUB_BASIN_PATHS, RIVER_PATHS } from "@/lib/svgPaths";

const SVG_W = 465;
const SVG_H = 586;
const SVG_NS = "http://www.w3.org/2000/svg";

// ── Georeference transform ───────────────────────────────────────────────────
// lon = lon0 + (x / SVG_W) * lonSpan
// lat = lat0 + (1 - y / SVG_H) * latSpan          (SVG y grows downward)
//
// Starting values = the app's existing loose mapping in simulatedData.ts
// (lon 141.40–141.60, lat 38.55–38.75). Tuned interactively against the
// real coastline; see FITTED defaults below.
export interface GeoTransform {
  lon0: number;
  lat0: number;
  lonSpan: number;
  latSpan: number;
}

/** Original loose mapping from src/lib/simulatedData.ts (~line 905). */
export const ORIGINAL_TRANSFORM: GeoTransform = {
  lon0: 141.4,
  lat0: 38.55,
  lonSpan: 0.2,
  latSpan: 0.2,
};

/**
 * Best-fit values found by iterating against the real basemap coastline.
 * Anchored on the bay's two real islands — Arajima (141.4623, 38.6677, off
 * Sodehama) and Tsubakishima (141.4894, 38.6517) — which correspond to the
 * two island subpaths in OCEAN_BASIN_PATH, then verified visually against
 * the north/south shores, Cape Aratozaki and the bay head. The implied
 * scale is ~30 m/SVG-px and near-isotropic (lon 30.3 vs lat 29.4 m/px),
 * consistent with the trace having been made over a web-mercator map.
 */
export const FITTED_TRANSFORM: GeoTransform = {
  lon0: 141.36568,
  lat0: 38.59295,
  lonSpan: 0.16158,
  latSpan: 0.15515,
};

type BasemapKey = "esriTopo" | "openTopo" | "liberty";

const BASEMAPS: Record<BasemapKey, { label: string; style: unknown }> = {
  esriTopo: {
    label: "Esri World Topo",
    style: {
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
            "Tiles &copy; Esri &mdash; Esri, USGS, NOAA, and the GIS User Community",
        },
      },
      layers: [{ id: "basemap", type: "raster", source: "basemap" }],
    },
  },
  openTopo: {
    label: "OpenTopoMap",
    style: {
      version: 8,
      sources: {
        basemap: {
          type: "raster",
          tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          maxzoom: 17,
          attribution:
            "&copy; OpenStreetMap contributors, SRTM | style &copy; OpenTopoMap (CC-BY-SA)",
        },
      },
      layers: [{ id: "basemap", type: "raster", source: "basemap" }],
    },
  },
  liberty: {
    label: "OpenFreeMap Liberty",
    style: "https://tiles.openfreemap.org/styles/liberty",
  },
};

const DEFAULT_BASEMAP: BasemapKey = "esriTopo";

// ── Minimal local GeoJSON types (avoids un-hoisted @types/geojson) ──────────
type LonLat = [number, number];
interface GeoFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry:
    | { type: "Polygon"; coordinates: LonLat[][] }
    | { type: "MultiLineString"; coordinates: LonLat[][] };
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

/** Split a `d` string into subpaths and sample each with getPointAtLength. */
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

interface SampledShapes {
  bay: SampledSubpath[]; // first = outer ring, rest = island holes
  basins: Array<{ id: number; subpaths: SampledSubpath[] }>;
  rivers: Array<{ id: number; subpaths: SampledSubpath[] }>;
}

function sampleAllShapes(): SampledShapes {
  const host = document.createElementNS(SVG_NS, "svg");
  host.setAttribute("viewBox", `0 0 ${SVG_W} ${SVG_H}`);
  host.style.position = "absolute";
  host.style.width = "0";
  host.style.height = "0";
  host.style.overflow = "hidden";
  host.style.visibility = "hidden";
  document.body.appendChild(host);
  try {
    return {
      bay: samplePathSubpaths(OCEAN_BASIN_PATH, host),
      basins: Object.entries(SUB_BASIN_PATHS).map(([id, d]) => ({
        id: Number(id),
        subpaths: samplePathSubpaths(d, host),
      })),
      rivers: Object.entries(RIVER_PATHS).map(([id, d]) => ({
        id: Number(id),
        subpaths: samplePathSubpaths(d, host),
      })),
    };
  } finally {
    document.body.removeChild(host);
  }
}

// ── SVG px → lon/lat ─────────────────────────────────────────────────────────
function toLonLat(x: number, y: number, t: GeoTransform): LonLat {
  return [
    +(t.lon0 + (x / SVG_W) * t.lonSpan).toFixed(6),
    +(t.lat0 + (1 - y / SVG_H) * t.latSpan).toFixed(6),
  ];
}

function toRing(sub: SampledSubpath, t: GeoTransform): LonLat[] {
  const ring = sub.points.map(([x, y]) => toLonLat(x, y, t));
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  return ring;
}

interface OverlayData {
  bay: GeoFC;
  basins: GeoFC;
  rivers: GeoFC;
}

function buildOverlayData(shapes: SampledShapes, t: GeoTransform): OverlayData {
  const bayFeature: GeoFeature = {
    type: "Feature",
    properties: { name: "Shizugawa Bay (traced)" },
    geometry: {
      type: "Polygon",
      coordinates: shapes.bay.map((sub) => toRing(sub, t)),
    },
  };
  const basinFeatures: GeoFeature[] = shapes.basins.map(({ id, subpaths }) => ({
    type: "Feature",
    properties: { id },
    geometry: {
      type: "Polygon",
      coordinates: subpaths.map((sub) => toRing(sub, t)),
    },
  }));
  const riverFeatures: GeoFeature[] = shapes.rivers.map(({ id, subpaths }) => ({
    type: "Feature",
    properties: { id },
    geometry: {
      type: "MultiLineString",
      coordinates: subpaths.map((sub) =>
        sub.points.map(([x, y]) => toLonLat(x, y, t)),
      ),
    },
  }));
  return {
    bay: { type: "FeatureCollection", features: [bayFeature] },
    basins: { type: "FeatureCollection", features: basinFeatures },
    rivers: { type: "FeatureCollection", features: riverFeatures },
  };
}

function overlayBounds(data: OverlayData): [LonLat, LonLat] {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const fc of [data.bay, data.basins]) {
    for (const f of fc.features) {
      if (f.geometry.type !== "Polygon") continue;
      for (const ring of f.geometry.coordinates) {
        for (const [lon, lat] of ring) {
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      }
    }
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

// ── Component ────────────────────────────────────────────────────────────────
const SOURCE_IDS = { bay: "spike-bay", basins: "spike-basins", rivers: "spike-rivers" };

export default function RealMapViewport() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const shapesRef = useRef<SampledShapes | null>(null);
  const [transform, setTransform] = useState<GeoTransform>(FITTED_TRANSFORM);
  const transformRef = useRef(transform);
  const [basemap, setBasemap] = useState<BasemapKey>(DEFAULT_BASEMAP);
  const appliedBasemapRef = useRef<BasemapKey>(DEFAULT_BASEMAP);
  const didFitRef = useRef(false);

  transformRef.current = transform;

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!shapesRef.current) shapesRef.current = sampleAllShapes();

    const map = new maplibregl.Map({
      container,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      style: BASEMAPS[DEFAULT_BASEMAP].style as any,
      center: [141.5, 38.65],
      zoom: 11,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.ScaleControl({}), "bottom-left");

    const addOverlays = () => {
      const shapes = shapesRef.current;
      if (!shapes || map.getSource(SOURCE_IDS.bay)) return;
      const data = buildOverlayData(shapes, transformRef.current);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.addSource(SOURCE_IDS.bay, { type: "geojson", data: data.bay as any });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.addSource(SOURCE_IDS.basins, { type: "geojson", data: data.basins as any });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.addSource(SOURCE_IDS.rivers, { type: "geojson", data: data.rivers as any });

      map.addLayer({
        id: "spike-basins-fill",
        type: "fill",
        source: SOURCE_IDS.basins,
        paint: { "fill-color": "#2e7d32", "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: "spike-basins-line",
        type: "line",
        source: SOURCE_IDS.basins,
        paint: { "line-color": "#1b5e20", "line-width": 1.4, "line-opacity": 0.85 },
      });
      map.addLayer({
        id: "spike-bay-fill",
        type: "fill",
        source: SOURCE_IDS.bay,
        paint: { "fill-color": "#1d6fd1", "fill-opacity": 0.1 },
      });
      map.addLayer({
        id: "spike-bay-line",
        type: "line",
        source: SOURCE_IDS.bay,
        paint: { "line-color": "#d32f2f", "line-width": 2.2 },
      });
      map.addLayer({
        id: "spike-rivers-line",
        type: "line",
        source: SOURCE_IDS.rivers,
        paint: { "line-color": "#0d47a1", "line-width": 1.6, "line-opacity": 0.9 },
      });

      if (!didFitRef.current) {
        didFitRef.current = true;
        map.fitBounds(overlayBounds(data), { padding: 30, animate: false });
      }
    };

    // Fires on initial style load AND after every setStyle().
    map.on("style.load", addOverlays);
    mapRef.current = map;
    // Dev-only handle for tuning the georeference from the console.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__spikeMap = map;
    return () => {
      map.remove();
      mapRef.current = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__spikeMap;
    };
  }, []);

  // Re-project overlays whenever the georeference transform changes.
  useEffect(() => {
    const map = mapRef.current;
    const shapes = shapesRef.current;
    if (!map || !shapes) return;
    const data = buildOverlayData(shapes, transform);
    for (const key of ["bay", "basins", "rivers"] as const) {
      const src = map.getSource(SOURCE_IDS[key]) as maplibregl.GeoJSONSource | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      src?.setData(data[key] as any);
    }
  }, [transform]);

  // Swap basemap style (overlays re-added by the style.load handler).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedBasemapRef.current === basemap) return;
    appliedBasemapRef.current = basemap;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.setStyle(BASEMAPS[basemap].style as any);
  }, [basemap]);

  // Dev hook for tuning from the console / preview_eval.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__geo = {
      get: () => transformRef.current,
      set: (p: Partial<GeoTransform>) => setTransform((t) => ({ ...t, ...p })),
      reset: (which: "original" | "fitted" = "fitted") =>
        setTransform(which === "original" ? ORIGINAL_TRANSFORM : FITTED_TRANSFORM),
      basemap: (k: BasemapKey) => setBasemap(k),
    };
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__geo;
    };
  }, []);

  const num = (v: number) => v.toFixed(4);
  const field = (
    label: string,
    key: keyof GeoTransform,
    step: number,
  ) => (
    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ width: 58 }}>{label}</span>
      <input
        type="number"
        step={step}
        value={transform[key]}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) setTransform((t) => ({ ...t, [key]: v }));
        }}
        style={{ width: 90, font: "inherit", padding: "1px 3px" }}
      />
    </label>
  );

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
          font: "11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
          color: "#222",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          maxWidth: 240,
        }}
      >
        <strong>SPIKE · Real basemap (/map-real)</strong>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {(Object.keys(BASEMAPS) as BasemapKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setBasemap(k)}
              style={{
                font: "inherit",
                padding: "2px 6px",
                borderRadius: 4,
                border: "1px solid #999",
                background: basemap === k ? "#1d6fd1" : "#fff",
                color: basemap === k ? "#fff" : "#222",
                cursor: "pointer",
              }}
            >
              {BASEMAPS[k].label}
            </button>
          ))}
        </div>
        {field("lon0", "lon0", 0.005)}
        {field("lat0", "lat0", 0.005)}
        {field("lonSpan", "lonSpan", 0.005)}
        {field("latSpan", "latSpan", 0.005)}
        <div style={{ color: "#666" }}>
          lon {num(transform.lon0)}–{num(transform.lon0 + transform.lonSpan)}
          <br />
          lat {num(transform.lat0)}–{num(transform.lat0 + transform.latSpan)}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => setTransform(ORIGINAL_TRANSFORM)}
            style={{ font: "inherit", padding: "2px 6px", cursor: "pointer" }}
          >
            original
          </button>
          <button
            onClick={() => setTransform(FITTED_TRANSFORM)}
            style={{ font: "inherit", padding: "2px 6px", cursor: "pointer" }}
          >
            fitted
          </button>
        </div>
      </div>
    </div>
  );
}
