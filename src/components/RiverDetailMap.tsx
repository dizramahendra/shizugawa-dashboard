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
import { buildRiverGeom, cellsToFC, CONTEXT_RIVERS_FC } from "@/lib/riverRaster";
import {
  generateRiverData,
  generateCompositeRiverData,
  getCompositeRiver,
  valueToConcentration,
  VARIABLE_OPTIONS,
} from "@/lib/simulatedData";

// ── Basemap (identical to MapViewport) ────────────────────────────────────────
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
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    // Surface style/tile failures — maplibre reports them via its own "error"
    // event, NOT the console, so silent failures are otherwise invisible.
    map.on("error", (e) => console.error("[RiverDetailMap] map error:", e?.error ?? e));

    // Container is often laid out AFTER map construction (flex tab) — resize on
    // first real size so the map paints without a manual nudge (MapViewport fix).
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container);

    // Add our sources/layers once the style is ready. Guarded and attached to
    // BOTH "style.load" and "load", AND invoked directly when the style is
    // already loaded — depending on timing the style can finish before the
    // listener attaches (observed in some webviews), and waiting on the event
    // alone then leaves the map permanently without our layers.
    const initLayers = () => {
      if (map.getSource(SRC_CTX)) return; // already initialised
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
    };
    map.on("style.load", initLayers);
    map.on("load", initLayers);
    if (map.isStyleLoaded()) initLayers();

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
