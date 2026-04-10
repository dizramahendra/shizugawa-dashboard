import { useEffect, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { RIVER_PATHS, SUB_BASIN_PATHS } from "@/lib/svgPaths";
import { generateRiverData, generateWeekData, BAY_MASK, GRID_W, GRID_D, RIVER_COLS, RIVER_ROWS } from "@/lib/simulatedData";

type LonLat = [number, number];
type Ring = LonLat[];
type PolygonGeom = { type: "Polygon"; coordinates: Ring[] };
type LineStringGeom = { type: "LineString"; coordinates: LonLat[] };
type OceanCellProps = { color: string };
type SubBasinProps = { basinId: number; color: string; fillOpacity: number };
type RiverReachProps = { reachId: number; modelRiver: string; isMainStem: boolean; color: string; lineWidth: number };

interface OceanCellFeature {
  type: "Feature";
  properties: OceanCellProps;
  geometry: PolygonGeom;
}

interface OceanCellCollection {
  type: "FeatureCollection";
  features: OceanCellFeature[];
}

interface SubBasinFeature {
  type: "Feature";
  properties: SubBasinProps;
  geometry: PolygonGeom;
}

interface SubBasinCollection {
  type: "FeatureCollection";
  features: SubBasinFeature[];
}

interface RiverReachFeature {
  type: "Feature";
  id: number;
  properties: RiverReachProps;
  geometry: LineStringGeom;
}

interface RiverReachCollection {
  type: "FeatureCollection";
  features: RiverReachFeature[];
}

const SVG_W = 465;
const SVG_H = 586;

const BAY_WEST  = 141.383;
const BAY_EAST  = 141.468;
const BAY_NORTH = 38.651;
const BAY_SOUTH = 38.582;

function svgToLon(x: number): number {
  return BAY_WEST + (x / SVG_W) * (BAY_EAST - BAY_WEST);
}
function svgToLat(y: number): number {
  return BAY_NORTH - (y / SVG_H) * (BAY_NORTH - BAY_SOUTH);
}

const MODEL_RIVER: Record<number, string> = {
  1: "shizugawa", 2: "shizugawa", 3: "kitakami", 4: "shizugawa",
  5: "hachiman",  6: "shizugawa", 7: "shizugawa", 8: "hachiman",
  9: "shizugawa", 10: "kitakami", 11: "kitakami", 12: "shizugawa",
  13: "shizugawa", 14: "shizugawa", 15: "kitakami", 16: "hachiman",
  17: "hachiman",  18: "shizugawa", 20: "hachiman", 24: "shizugawa",
  25: "kitakami",
};

const REACH_POSITION: Record<number, number> = (() => {
  const groups: Record<string, number[]> = {};
  for (const [idStr, river] of Object.entries(MODEL_RIVER)) {
    if (!groups[river]) groups[river] = [];
    groups[river].push(Number(idStr));
  }
  const result: Record<number, number> = {};
  for (const ids of Object.values(groups)) {
    ids.sort((a, b) => a - b);
    ids.forEach((id, i) => { result[id] = i / Math.max(1, ids.length - 1); });
  }
  return result;
})();

function computeReachValue(week: number, reachId: number): number {
  const modelRiver = MODEL_RIVER[reachId] ?? "shizugawa";
  const positionFrac = REACH_POSITION[reachId] ?? 0.5;
  const data = generateRiverData(week, modelRiver);
  const col = Math.min(RIVER_COLS - 1, Math.floor(positionFrac * RIVER_COLS));
  let sum = 0;
  for (let row = 0; row < RIVER_ROWS; row++) {
    sum += data[row]?.[col] ?? 0;
  }
  return sum / RIVER_ROWS;
}

const MAIN_STEMS = new Set([4, 7, 10, 13, 3]);

const MODEL_RIVER_BOUNDS: Record<string, [number, number, number, number]> = {
  shizugawa: [svgToLon(137), svgToLat(443), svgToLon(260), svgToLat(150)],
  kitakami:  [svgToLon(60),  svgToLat(550), svgToLon(455), svgToLat(55)],
  hachiman:  [svgToLon(180), svgToLat(370), svgToLon(400), svgToLat(155)],
};

const COLOR_STOPS: Record<string, string[]> = {
  nitrogen:    ["#3b6fa0", "#6ca0c8", "#b8dce8", "#f0e68c", "#e8a030", "#c8401c"],
  phosphorus:  ["#3b6fa0", "#6ca0c8", "#b8dce8", "#f0e68c", "#e8a030", "#c8401c"],
  chlorophyll: ["#1a4a2e", "#2d7a4a", "#5aab6e", "#a8d898", "#e8f4b0", "#f5f5dc"],
  do:          ["#c8401c", "#e8a030", "#f0e68c", "#b8dce8", "#6ca0c8", "#3b6fa0"],
};

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function interpolateColor(stops: string[], t: number): string {
  const n = stops.length - 1;
  const idx = Math.min(n - 1, Math.floor(t * n));
  const frac = t * n - idx;
  const [r1, g1, b1] = hexToRgb(stops[idx]);
  const [r2, g2, b2] = hexToRgb(stops[idx + 1]);
  const r = Math.round(r1 + (r2 - r1) * frac);
  const g = Math.round(g1 + (g2 - g1) * frac);
  const b = Math.round(b1 + (b2 - b1) * frac);
  return `rgb(${r},${g},${b})`;
}


function computeOceanMean(week: number): number {
  const data = generateWeekData(week);
  let sum = 0, count = 0;
  for (let z = 0; z < GRID_D; z++) {
    for (let x = 0; x < GRID_W; x++) {
      if (!BAY_MASK[z]?.[x]) continue;
      sum += data[z]?.[x]?.[0] ?? 0;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

function buildOceanGridGeoJSON(week: number, variableId: string): OceanCellCollection {
  const data = generateWeekData(week);
  const stops = COLOR_STOPS[variableId] ?? COLOR_STOPS.nitrogen;
  const cellLon = (BAY_EAST - BAY_WEST) / GRID_W;
  const cellLat = (BAY_NORTH - BAY_SOUTH) / GRID_D;

  const features: OceanCellFeature[] = [];
  for (let z = 0; z < GRID_D; z++) {
    for (let x = 0; x < GRID_W; x++) {
      if (!BAY_MASK[z]?.[x]) continue;
      const value = data[z]?.[x]?.[0] ?? 0;
      const color = interpolateColor(stops, Math.max(0, Math.min(1, value)));
      const west  = BAY_WEST  + x * cellLon;
      const east  = BAY_WEST  + (x + 1) * cellLon;
      const north = BAY_NORTH - z * cellLat;
      const south = BAY_NORTH - (z + 1) * cellLat;
      features.push({
        type: "Feature",
        properties: { color },
        geometry: {
          type: "Polygon",
          coordinates: [[[west,south],[east,south],[east,north],[west,north],[west,south]]],
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

function buildSubBasinGeoJSON(week: number, variableId: string): SubBasinCollection {
  const stops = COLOR_STOPS[variableId] ?? COLOR_STOPS.nitrogen;
  const features: SubBasinFeature[] = Object.entries(SUB_BASIN_PATHS).map(([idStr, d]) => {
    const basinId = Number(idStr);
    const value = computeReachValue(week, basinId);
    const color = interpolateColor(stops, Math.max(0, Math.min(1, value)));
    const svgPts = parseSvgPathClosed(d);
    const ring: LonLat[] = svgPts.map(([x, y]) => [svgToLon(x), svgToLat(y)]);
    return {
      type: "Feature",
      properties: { basinId, color, fillOpacity: 0.55 },
      geometry: { type: "Polygon", coordinates: [ring] },
    };
  });
  return { type: "FeatureCollection", features };
}

function parseSvgPath(d: string): [number, number][] {
  const points: [number, number][] = [];
  const segments = d.match(/[MmLlCcQqHhVvZz][^MmLlCcQqHhVvZz]*/g) ?? [];
  let cx = 0, cy = 0;

  for (const seg of segments) {
    const cmd = seg[0];
    const nums = (seg.slice(1).match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
    let ni = 0;

    if (cmd === "M" || cmd === "L") {
      while (ni + 1 < nums.length) {
        cx = nums[ni++]; cy = nums[ni++];
        points.push([cx, cy]);
      }
    } else if (cmd === "H") {
      while (ni < nums.length) { cx = nums[ni++]; points.push([cx, cy]); }
    } else if (cmd === "V") {
      while (ni < nums.length) { cy = nums[ni++]; points.push([cx, cy]); }
    } else if (cmd === "C") {
      while (ni + 5 < nums.length) {
        const cp1x = nums[ni++], cp1y = nums[ni++];
        const cp2x = nums[ni++], cp2y = nums[ni++];
        const ex = nums[ni++], ey = nums[ni++];
        for (let t = 0.25; t <= 1.01; t += 0.25) {
          const mt = 1 - t;
          const x = mt*mt*mt*cx + 3*mt*mt*t*cp1x + 3*mt*t*t*cp2x + t*t*t*ex;
          const y = mt*mt*mt*cy + 3*mt*mt*t*cp1y + 3*mt*t*t*cp2y + t*t*t*ey;
          points.push([x, y]);
        }
        cx = ex; cy = ey;
      }
    } else if (cmd === "Q") {
      while (ni + 3 < nums.length) {
        const cpx = nums[ni++], cpy = nums[ni++];
        const ex = nums[ni++], ey = nums[ni++];
        for (let t = 0.5; t <= 1.01; t += 0.5) {
          const mt = 1 - t;
          const x = mt*mt*cx + 2*mt*t*cpx + t*t*ex;
          const y = mt*mt*cy + 2*mt*t*cpy + t*t*ey;
          points.push([x, y]);
        }
        cx = ex; cy = ey;
      }
    }
  }
  return points;
}

function parseSvgPathClosed(d: string): [number, number][] {
  const pts = parseSvgPath(d);
  if (pts.length < 3) return pts;
  const [fx, fy] = pts[0];
  const [lx, ly] = pts[pts.length - 1];
  if (lx !== fx || ly !== fy) pts.push([fx, fy]);
  return pts;
}

const OCEAN_SVG_POINTS: [number, number][] = [
  [387,197],[392,215],[400,218],[408,215],[413,223],[413,241],[415,264],
  [414,271],[408,283],[418,299],[404,308],[394,313],[400,336],[410,343],
  [404,364],[392,400],[379,403],[380,397],[382,389],[378,390],[376,391],
  [372,394],[371,397],[366,401],[360,399],[360,394],[356,390],[351,396],
  [347,402],[337,401],[335,393],[330,384],[324,383],[314,385],[316,390],
  [309,400],[297,407],[287,405],[282,398],[277,401],[270,398],[265,399],
  [255,419],[257,440],[188,380],[138,391],[131,263],[60,312],[50,340],
  [68,395],[65,440],[70,470],[80,500],[100,540],[140,570],[180,580],
  [230,586],[280,580],[330,565],[370,545],[400,520],[425,490],[440,460],
  [450,430],[455,400],[460,370],[463,340],[465,300],[460,265],[450,240],
  [440,220],[430,205],[415,195],[400,192],[387,197],
];

const OCEAN_COORDS: [number, number][] = OCEAN_SVG_POINTS.map(([x, y]) => [svgToLon(x), svgToLat(y)]);

function buildRiverFeatures(week: number, variableId: string, selectedRiver: string | null): RiverReachCollection {
  const stops = COLOR_STOPS[variableId] ?? COLOR_STOPS.nitrogen;
  const features: RiverReachFeature[] = Object.entries(RIVER_PATHS).map(([idStr, d]) => {
    const id = Number(idStr);
    const modelRiver = MODEL_RIVER[id] ?? "shizugawa";
    const isMainStem = MAIN_STEMS.has(id);
    const value = computeReachValue(week, id);
    const color = interpolateColor(stops, Math.max(0, Math.min(1, value)));
    const isSelected = selectedRiver === modelRiver;
    const lineWidth = isMainStem ? (isSelected ? 8 : 5) : (isSelected ? 5 : 3);
    const svgPts = parseSvgPath(d);
    const coords: LonLat[] = svgPts.map(([x, y]) => [svgToLon(x), svgToLat(y)]);
    return {
      type: "Feature",
      id,
      properties: { reachId: id, modelRiver, isMainStem, color, lineWidth },
      geometry: { type: "LineString", coordinates: coords },
    };
  });
  return { type: "FeatureCollection", features };
}

interface MapLibreMapProps {
  week: number;
  variableId: string;
  selectedRiver: string | null;
  onSelectRiver: (id: string | null) => void;
  onSelectOcean: () => void;
}

const OCEAN_POLYGON_SVG = "M387 197 L392 215 L400 218 L408 215 L413 223 L413 241 L415 264 L414 271 L408 283 L418 299 L404 308 L394 313 L400 336 L410 343 L404 364 L392 400 L379 403 L380 397 L382 389 L378 390 L376 391 L372 394 L371 397 L366 401 L360 399 L360 394 L356 390 L351 396 L347 402 L337 401 L335 393 L330 384 L324 383 L314 385 L316 390 L309 400 L297 407 L287 405 L282 398 L277 401 L270 398 L265 399 L255 419 L257 440 L188 380 L138 391 L131 263 L60 312 L50 340 L68 395 L65 440 L70 470 L80 500 L100 540 L140 570 L180 580 L230 586 L280 580 L330 565 L370 545 L400 520 L425 490 L440 460 L450 430 L455 400 L460 370 L463 340 L465 300 L460 265 L450 240 L440 220 L430 205 L415 195 L400 192 Z";

export default function MapLibreMap({
  week,
  variableId,
  selectedRiver,
  onSelectRiver,
  onSelectOcean,
}: MapLibreMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [webglError, setWebglError] = useState(false);
  const [hoveredRiver, setHoveredRiver] = useState<number | null>(null);
  const [hoveredOcean, setHoveredOcean] = useState(false);
  const svgDataRef = useRef({ week, variableId, selectedRiver });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const BLANK_STYLE: maplibregl.StyleSpecification = {
      version: 8,
      sources: {},
      layers: [
        {
          id: "background",
          type: "background",
          paint: { "background-color": "#f0f4f8" },
        },
      ],
    };

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: BLANK_STYLE,
        center: [(BAY_WEST + BAY_EAST) / 2, (BAY_SOUTH + BAY_NORTH) / 2],
        zoom: 12.5,
        minZoom: 10,
        maxZoom: 17,
        attributionControl: {},
      });
    } catch {
      setWebglError(true);
      return;
    }

    map.on("error", (e) => {
      const msg = String((e as { error?: unknown }).error).toLowerCase();
      if (msg.includes("webgl")) {
        setWebglError(true);
      }
    });

    map.on("load", () => {
      const initialSubBasins = buildSubBasinGeoJSON(
        svgDataRef.current.week,
        svgDataRef.current.variableId
      );
      map.addSource("sub-basins", {
        type: "geojson",
        data: initialSubBasins,
      });

      map.addLayer({
        id: "sub-basins-fill",
        type: "fill",
        source: "sub-basins",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": ["get", "fillOpacity"],
        },
      });

      map.addLayer({
        id: "sub-basins-outline",
        type: "line",
        source: "sub-basins",
        paint: {
          "line-color": "#98A2B3",
          "line-width": 0.6,
          "line-opacity": 0.7,
        },
      });

      const initialFeatures = buildRiverFeatures(
        svgDataRef.current.week,
        svgDataRef.current.variableId,
        svgDataRef.current.selectedRiver
      );

      map.addSource("rivers", {
        type: "geojson",
        data: initialFeatures,
        generateId: false,
      });

      map.addLayer({
        id: "rivers-glow",
        type: "line",
        source: "rivers",
        filter: ["==", ["get", "isMainStem"], true],
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["get", "lineWidth"],
          "line-opacity": 0.18,
          "line-blur": 8,
        },
      });

      map.addLayer({
        id: "rivers-line",
        type: "line",
        source: "rivers",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["get", "lineWidth"],
          "line-opacity": 0.88,
        },
      });

      const initialOceanGrid = buildOceanGridGeoJSON(
        svgDataRef.current.week,
        svgDataRef.current.variableId
      );
      map.addSource("ocean-grid", {
        type: "geojson",
        data: initialOceanGrid,
      });

      map.addLayer({
        id: "ocean-grid-fill",
        type: "fill",
        source: "ocean-grid",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": 0.55,
        },
      });

      map.addSource("ocean-boundary", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: [OCEAN_COORDS] },
        },
      });

      map.addLayer({
        id: "ocean-fill",
        type: "fill",
        source: "ocean-boundary",
        paint: {
          "fill-color": "#60a5fa",
          "fill-opacity": 0.01,
        },
      });

      map.addLayer({
        id: "ocean-outline",
        type: "line",
        source: "ocean-boundary",
        paint: {
          "line-color": "#60a5fa",
          "line-width": 1.8,
          "line-opacity": 0.6,
        },
      });

      map.on("click", "rivers-line", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const modelRiver = f.properties.modelRiver;
        onSelectRiver(modelRiver);
        const bounds = MODEL_RIVER_BOUNDS[modelRiver];
        if (bounds) {
          map.fitBounds(
            [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
            { padding: 60, duration: 700 }
          );
        }
      });

      map.on("mouseenter", "rivers-line", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const id = e.features?.[0]?.id as number | undefined;
        setHoveredRiver(id ?? null);
      });

      map.on("mouseleave", "rivers-line", () => {
        map.getCanvas().style.cursor = "";
        setHoveredRiver(null);
      });

      map.on("click", "ocean-fill", (e) => {
        e.originalEvent.stopPropagation();
        onSelectOcean();
      });

      map.on("mouseenter", "ocean-fill", () => {
        map.getCanvas().style.cursor = "pointer";
        setHoveredOcean(true);
      });

      map.on("mouseleave", "ocean-fill", () => {
        map.getCanvas().style.cursor = "";
        setHoveredOcean(false);
      });

      map.on("click", (e) => {
        const features = map.queryRenderedFeatures(e.point, {
          layers: ["rivers-line", "ocean-fill", "ocean-grid-fill"],
        });
        if (features.length === 0) {
          onSelectRiver(null);
          map.fitBounds(
            [[BAY_WEST, BAY_SOUTH], [BAY_EAST, BAY_NORTH]],
            { padding: 40, duration: 700 }
          );
        }
      });

      setMapReady(true);
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-left");

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [onSelectRiver, onSelectOcean]);

  useEffect(() => {
    svgDataRef.current = { week, variableId, selectedRiver };
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const subBasinSource = map.getSource("sub-basins") as GeoJSONSource | undefined;
    if (subBasinSource) {
      subBasinSource.setData(buildSubBasinGeoJSON(week, variableId));
    }

    const riverSource = map.getSource("rivers") as GeoJSONSource | undefined;
    if (riverSource) {
      riverSource.setData(buildRiverFeatures(week, variableId, selectedRiver));
    }

    const oceanGridSource = map.getSource("ocean-grid") as GeoJSONSource | undefined;
    if (oceanGridSource) {
      oceanGridSource.setData(buildOceanGridGeoJSON(week, variableId));
    }

    const stops = COLOR_STOPS[variableId] ?? COLOR_STOPS.nitrogen;
    const oceanMeanColor = interpolateColor(stops, Math.max(0, Math.min(1, computeOceanMean(week))));
    if (map.getLayer("ocean-fill")) {
      map.setPaintProperty("ocean-fill", "fill-color", oceanMeanColor);
      map.setPaintProperty("ocean-fill", "fill-opacity", 0.15);
    }
  }, [week, variableId, selectedRiver, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !selectedRiver) return;
    const bounds = MODEL_RIVER_BOUNDS[selectedRiver];
    if (bounds) {
      map.fitBounds(
        [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
        { padding: 60, duration: 700 }
      );
    }
  }, [selectedRiver, mapReady]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onSelectRiver(null);
        const map = mapRef.current;
        if (map) {
          map.fitBounds(
            [[BAY_WEST, BAY_SOUTH], [BAY_EAST, BAY_NORTH]],
            { padding: 40, duration: 700 }
          );
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onSelectRiver]);

  const stops = COLOR_STOPS[variableId] ?? COLOR_STOPS.nitrogen;
  const oceanMean = computeOceanMean(week);
  const oceanColor = interpolateColor(stops, Math.max(0, Math.min(1, oceanMean)));

  const riverColors = Object.fromEntries(
    Object.keys(RIVER_PATHS).map((idStr) => {
      const id = Number(idStr);
      const value = computeReachValue(week, id);
      return [id, interpolateColor(stops, Math.max(0, Math.min(1, value)))];
    })
  );

  const svgFallbackContent = (
    <>
      <img
        src="/Sub-basin area.svg"
        width={SVG_W}
        height={SVG_H}
        style={{ position: "absolute", top: 0, left: 0, opacity: 0.85, pointerEvents: "none" }}
        draggable={false}
        alt="basin"
      />
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width={SVG_W}
        height={SVG_H}
        style={{ position: "absolute", top: 0, left: 0, overflow: "visible" }}
      >
        <path
          d={OCEAN_POLYGON_SVG}
          fill={`${oceanColor}55`}
          stroke={oceanColor}
          strokeWidth={hoveredOcean ? 2.5 : 1.5}
          strokeOpacity={0.7}
          style={{ pointerEvents: "all", cursor: "pointer" }}
          onMouseEnter={() => setHoveredOcean(true)}
          onMouseLeave={() => setHoveredOcean(false)}
          onClick={onSelectOcean}
        />
        {Object.entries(RIVER_PATHS).map(([idStr, d]) => {
          const id = Number(idStr);
          const color = riverColors[id] ?? "#60a5fa";
          const isSelected = selectedRiver === MODEL_RIVER[id];
          const isHovered = hoveredRiver === id;
          const isMainStem = MAIN_STEMS.has(id);
          const strokeWidth = isMainStem
            ? (isSelected || isHovered ? 8 : 5)
            : (isSelected || isHovered ? 5 : 3);
          return (
            <g key={id}>
              {(isSelected || isHovered) && (
                <path d={d} stroke={color} strokeWidth={strokeWidth + 8} fill="none"
                  strokeLinecap="round" opacity={0.25} style={{ pointerEvents: "none" }} />
              )}
              <path d={d} stroke={color} strokeWidth={strokeWidth} fill="none"
                strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: "none" }} />
              <path d={d} stroke="transparent" strokeWidth={16} fill="none"
                style={{ pointerEvents: "all", cursor: "pointer" }}
                onMouseEnter={() => setHoveredRiver(id)}
                onMouseLeave={() => setHoveredRiver(null)}
                onClick={() => onSelectRiver(MODEL_RIVER[id] ?? null)}
              />
            </g>
          );
        })}
      </svg>
    </>
  );

  return (
    <div className="relative w-full h-full bg-slate-50 overflow-hidden">
      {/* MapLibre container — always hidden behind SVG, kept in DOM for future pan/zoom */}
      <div ref={containerRef} className="absolute inset-0" style={{ opacity: 0, pointerEvents: "none" }} />

      {/* SVG visualization — always visible, handles all interaction */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          style={{
            position: "absolute",
            top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            width: SVG_W, height: SVG_H,
          }}
        >
          {svgFallbackContent}
        </div>
      </div>

      {hoveredOcean && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-white border border-primary/30 rounded-md px-3 py-2 shadow-md text-center whitespace-nowrap pointer-events-none"
          style={{ fontSize: "11px" }}>
          <div className="font-semibold text-primary">Shizugawa Bay (Ocean)</div>
          <div className="text-muted-foreground mt-0.5" style={{ fontSize: "9px" }}>Click → 3D Ocean Playback</div>
        </div>
      )}
    </div>
  );
}
