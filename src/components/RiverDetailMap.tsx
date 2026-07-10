/**
 * River Detail Map — the River Playback (2D) viewport as a REAL MapLibre map.
 *
 * Replaces the hand-rolled canvas (dotted void → fake basemap) with the same
 * Esri World Topo basemap the Map Viewport uses, so the selected river's pixel
 * raster sits on real terrain, real coastline and the real bay — the context
 * that makes it read as a river (Sentinel-style water-quality rasters).
 *
 * The raster itself is the model-output look kept from the pixel view:
 *   • the channel is a ribbon of square cells laid along the river's REAL SVG
 *     course (same RIVER_PATHS geometry as the map/3D), tapering from the
 *     headwater to a wider mouth with organic bank jitter;
 *   • along-stream position maps to the data COLUMN (headwater 0 → mouth 119),
 *     the SIGNED cross-stream offset maps to the data ROW, so the full
 *     cross-stream structure of the reach data shows cell by cell;
 *   • colours are QUANTIZED to the legend bands (crunchy per-pixel snapping,
 *     deliberately not smooth) and update every week via setData;
 *   • per-cell hover tooltip + click-to-select, mouth marker "→ to bay".
 */
import { useMemo, useRef, useEffect, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import LegendOverlay from "@/components/LegendOverlay";
import { sampleSvgPath, type Pt } from "@/lib/svgSample";
import {
  generateRiverData,
  generateCompositeRiverData,
  getCompositeRiver,
  valueToConcentration,
  VARIABLE_OPTIONS,
  RIVER_ROWS,
  RIVER_COLS,
  RIVER_SVG_BY_SLUG,
  RIVER_SVG_W,
  RIVER_SVG_H,
} from "@/lib/simulatedData";

// ── Basemap (identical to MapViewport) ────────────────────────────────────────
const ESRI_TOPO_STYLE = {
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
};

// ── Colour ramp — QUANTIZED to legend bands (the crunchy model-raster look) ───
const COLOR_STOPS: Record<string, string[]> = {
  nitrogen:   ["#2c5f8a","#3d6fa0","#6a9fc0","#90c4de","#c5dfe8","#f5f0d8","#f0d090","#e8a030","#d45820","#c8401c"],
  phosphorus: ["#2c5f8a","#3d6fa0","#6a9fc0","#90c4de","#c5dfe8","#f5f0d8","#f0d090","#e8a030","#d45820","#c8401c"],
  flow:       ["#0f0527","#1f0a4e","#3a0f7a","#5a1eb0","#7c3ad8","#9d61e8","#bb8ef2","#d4b6f7","#e9d7fb","#f7f0fe"],
  all:        ["#45007e","#2060a0","#168c8c","#35b870","#aadb30","#fce820"],
};
function bandColor(stops: string[], t: number): string {
  const n = stops.length;
  return stops[Math.min(n - 1, Math.floor(Math.min(1, Math.max(0, t)) * n))];
}

// ── Georeference (same transform the bay/rivers/3D use) ───────────────────────
function svgLonLat(x: number, y: number): [number, number] {
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
    const d = RIVER_SVG_BY_SLUG[r.slug];
    if (!d) continue;
    let pts = resample(sampleSvgPath(d, 1), SAMPLES);
    if (pts.length < 2) continue;
    const distToBay = (p: Pt) => {
      const [lon, lat] = svgLonLat(p.x, p.y);
      return Math.hypot((lon - BAY_CENTER[0]) * Math.cos((lat * Math.PI) / 180), lat - BAY_CENTER[1]);
    };
    if (distToBay(pts[0]) < distToBay(pts[pts.length - 1])) pts = pts.slice().reverse();
    out.push({
      ll: pts.map(p => svgLonLat(p.x, p.y)),
      colStart: r.colStart, colEnd: r.colEnd, rowStart: r.rowStart, rowEnd: r.rowEnd,
    });
  }
  return out;
}

// All rivers as faint context lines (module-level, static).
const CONTEXT_RIVERS_FC = {
  type: "FeatureCollection" as const,
  features: Object.values(RIVER_SVG_BY_SLUG).flatMap(d => {
    try {
      const pts = resample(sampleSvgPath(d, 2), 70).map(p => svgLonLat(p.x, p.y));
      return [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: pts } }];
    } catch { return []; }
  }),
};

// ── Pixel-cell rasterisation in local metre space → lon/lat quads ─────────────
interface CellDef {
  quad: [number, number][];   // 4 lon/lat corners
  row: number; col: number;
}
interface RiverGeom {
  cells: CellDef[];
  bounds: [[number, number], [number, number]];
  mouth: [number, number];
}

function buildRiverGeom(riverId: string): RiverGeom {
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

  // Cell size follows the course length so every river gets ~110 columns of
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
    return { cells, bounds: [[141.4, 38.6], [141.5, 38.7]], mouth: BAY_CENTER };
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
  return { cells, bounds: [swLL, neLL], mouth };
}

function cellsToFC(cells: CellDef[], data: number[][], stops: string[]) {
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

const SRC_CELLS  = "rdm-cells";
const SRC_CTX    = "rdm-ctx-rivers";
const LYR_CELLS  = "rdm-cells-fill";
const LYR_SEL    = "rdm-cells-selected";
const LYR_CTX    = "rdm-ctx-rivers";

interface RiverDetailMapProps {
  week: number;
  variableId: string;
  riverId: string;
  selectedCell: { row: number; col: number } | null;
  onCellClick: (row: number, col: number) => void;
}

export default function RiverDetailMap({
  week, variableId, riverId, selectedCell, onCellClick,
}: RiverDetailMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; row: number; col: number } | null>(null);

  const composite = useMemo(() => getCompositeRiver(riverId), [riverId]);
  const geom = useMemo(() => buildRiverGeom(riverId), [riverId]);
  const data = useMemo(
    () => composite ? generateCompositeRiverData(week, riverId) : generateRiverData(week, riverId),
    [week, riverId, composite],
  );
  const stops    = COLOR_STOPS[variableId] ?? COLOR_STOPS.nitrogen;
  const variable = VARIABLE_OPTIONS.find(v => v.id === variableId) ?? VARIABLE_OPTIONS[0];

  // Keep latest handler/data in refs so map listeners never go stale.
  const onCellClickRef = useRef(onCellClick); onCellClickRef.current = onCellClick;

  // ── Map creation (once) ─────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: ESRI_TOPO_STYLE as any,
      bounds: geom.bounds as any,
      fitBoundsOptions: { padding: 60 },
      attributionControl: { compact: true } as any,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    // Container is often laid out AFTER map construction (flex tab) — resize on
    // first real size so the map paints without a manual nudge (MapViewport fix).
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container);

    map.on("style.load", () => {
      // Context: every river of the watershed as a faint line under the raster.
      map.addSource(SRC_CTX, { type: "geojson", data: CONTEXT_RIVERS_FC as any });
      map.addLayer({
        id: LYR_CTX, type: "line", source: SRC_CTX,
        paint: { "line-color": "#4a7ba6", "line-width": 1.4, "line-opacity": 0.55 },
        layout: { "line-cap": "round", "line-join": "round" },
      });

      // The selected river's pixel raster (colours baked per feature).
      map.addSource(SRC_CELLS, { type: "geojson", data: { type: "FeatureCollection", features: [] } as any });
      map.addLayer({
        id: LYR_CELLS, type: "fill", source: SRC_CELLS,
        paint: {
          "fill-color": ["get", "color"] as any,
          "fill-opacity": 0.92,
          "fill-outline-color": "rgba(255,255,255,0.25)",
        },
      });
      map.addLayer({
        id: LYR_SEL, type: "line", source: SRC_CELLS,
        filter: ["==", ["get", "row"], -1],
        paint: { "line-color": "#6d5ce8", "line-width": 2 },
      });

      map.on("mousemove", LYR_CELLS, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        map.getCanvas().style.cursor = "crosshair";
        setHover({ x: e.point.x, y: e.point.y, row: f.properties?.row, col: f.properties?.col });
      });
      map.on("mouseleave", LYR_CELLS, () => {
        map.getCanvas().style.cursor = "";
        setHover(null);
      });
      map.on("click", LYR_CELLS, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        onCellClickRef.current(f.properties?.row, f.properties?.col);
      });

      setStyleReady(true);
    });

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      setStyleReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── River change: refit the camera ──────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(geom.bounds as any, { padding: 60, duration: 700 });
  }, [geom]);

  // ── Week / variable / river change: recolour (setData is cheap at ~1k cells) ─
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    const src = map.getSource(SRC_CELLS) as maplibregl.GeoJSONSource | undefined;
    src?.setData(cellsToFC(geom.cells, data, stops) as any);
  }, [geom, data, stops, styleReady]);

  // ── Selection outline ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    map.setFilter(
      LYR_SEL,
      selectedCell
        ? ["all", ["==", ["get", "row"], selectedCell.row], ["==", ["get", "col"], selectedCell.col]] as any
        : ["==", ["get", "row"], -1] as any,
    );
  }, [selectedCell, styleReady]);

  // ── Mouth marker ("→ to bay") ────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const el = document.createElement("div");
    el.className = "flex items-center gap-1.5 pointer-events-none";
    el.innerHTML =
      `<span style="width:12px;height:12px;border-radius:9999px;background:#0f766e;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)"></span>` +
      `<span style="font-family:ui-monospace,monospace;font-size:10px;font-weight:600;color:#0f766e;background:rgba(255,255,255,.9);padding:1px 6px;border-radius:4px;box-shadow:0 1px 2px rgba(0,0,0,.15);white-space:nowrap">→ to bay</span>`;
    const marker = new maplibregl.Marker({ element: el, anchor: "left", offset: [-6, 0] })
      .setLngLat(geom.mouth)
      .addTo(map);
    return () => { marker.remove(); };
  }, [geom]);

  const hoverVal = hover ? (data[hover.row]?.[hover.col] ?? 0) : 0;

  return (
    <div className="w-full h-full relative">
      {/* Inline position: maplibre's stylesheet sets `.maplibregl-map { position:
          relative }`, which beats a Tailwind `absolute` class and collapses the
          container to 0 height — inline style wins over both. */}
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {/* Per-cell hover tooltip */}
      {hover && (
        <div
          className="absolute z-20 pointer-events-none px-1.5 py-0.5 bg-foreground/85 text-white text-[9px] font-mono rounded whitespace-nowrap"
          style={{ left: hover.x + 12, top: hover.y - 24 }}
        >
          {valueToConcentration(hoverVal, variableId)} {variable.unit} · reach {hover.col}
        </div>
      )}

      {/* Legend */}
      <div className="absolute z-10 pointer-events-none" style={{ bottom: 12, left: 12 }}>
        <LegendOverlay stops={stops} min={variable.min} max={variable.max} unit={variable.unit} decimals={variable.decimals ?? 1} />
      </div>

      {/* Hint */}
      <div className="absolute top-3 right-12 z-10 text-[9px] font-mono text-slate-500 pointer-events-none bg-white/85 px-2 py-1 rounded shadow-sm">
        real map · real river course · click a cell
      </div>
    </div>
  );
}
