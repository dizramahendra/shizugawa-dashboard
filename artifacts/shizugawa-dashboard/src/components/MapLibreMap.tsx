import { useEffect, useRef, useCallback, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { RIVER_PATHS } from "@/lib/svgPaths";
import { generateRiverData, generateWeekData, BAY_MASK, GRID_W, GRID_D, VARIABLE_OPTIONS } from "@/lib/simulatedData";

const SVG_W = 465;
const SVG_H = 586;

const BAY_WEST = 141.383;
const BAY_EAST = 141.468;
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

const MAIN_STEMS = new Set([4, 7, 10, 13, 3]);

type RiverBounds = [[number, number], [number, number]];

const RIVER_BOUNDS: Record<number, RiverBounds> = {
  1:  [[svgToLon(175), svgToLat(212)], [svgToLon(245), svgToLat(155)]],
  2:  [[svgToLon(188), svgToLat(283)], [svgToLon(226), svgToLat(265)]],
  3:  [[svgToLon(373), svgToLat(122)], [svgToLon(454), svgToLat(73)]],
  4:  [[svgToLon(179), svgToLat(283)], [svgToLon(237), svgToLat(204)]],
  5:  [[svgToLon(200), svgToLat(265)], [svgToLon(258), svgToLat(215)]],
  6:  [[svgToLon(185), svgToLat(385)], [svgToLon(217), svgToLat(377)]],
  7:  [[svgToLon(165), svgToLat(228)], [svgToLon(222), svgToLat(173)]],
  8:  [[svgToLon(312), svgToLat(218)], [svgToLon(362), svgToLat(175)]],
  9:  [[svgToLon(246), svgToLat(278)], [svgToLon(257), svgToLat(233)]],
  10: [[svgToLon(169), svgToLat(541)], [svgToLon(257), svgToLat(418)]],
  11: [[svgToLon(367), svgToLat(77)],  [svgToLon(376), svgToLat(62)]],
  12: [[svgToLon(253), svgToLat(443)], [svgToLon(260), svgToLat(418)]],
  13: [[svgToLon(137), svgToLat(443)], [svgToLon(189), svgToLat(378)]],
  14: [[svgToLon(136), svgToLat(394)], [svgToLon(189), svgToLat(376)]],
  15: [[svgToLon(69), svgToLat(343)],  [svgToLon(133), svgToLat(262)]],
  16: [[svgToLon(186), svgToLat(360)], [svgToLon(258), svgToLat(300)]],
  17: [[svgToLon(228), svgToLat(204)], [svgToLon(283), svgToLat(162)]],
  18: [[svgToLon(241), svgToLat(238)], [svgToLon(257), svgToLat(220)]],
  20: [[svgToLon(387), svgToLat(200)], [svgToLon(393), svgToLat(186)]],
  24: [[svgToLon(177), svgToLat(210)], [svgToLon(246), svgToLat(153)]],
  25: [[svgToLon(244), svgToLat(76)],  [svgToLon(376), svgToLat(57)]],
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

function computeRiverMean(week: number, riverId: string): number {
  const data = generateRiverData(week, riverId);
  let sum = 0, count = 0;
  for (let row = 0; row < data.length; row++) {
    for (let col = 0; col < (data[row]?.length ?? 0); col++) {
      sum += data[row][col] ?? 0;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
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

interface MapLibreMapProps {
  week: number;
  variableId: string;
  selectedRiver: string | null;
  onSelectRiver: (id: string | null) => void;
  onSelectOcean: () => void;
  selectedWatershed: string | null;
}

type SvgTransform = { translateX: number; translateY: number; scaleX: number; scaleY: number };

const OCEAN_POLYGON = "M387 197 L392 215 L400 218 L408 215 L413 223 L413 241 L415 264 L414 271 L408 283 L418 299 L404 308 L394 313 L400 336 L410 343 L404 364 L392 400 L379 403 L380 397 L382 389 L378 390 L376 391 L372 394 L371 397 L366 401 L360 399 L360 394 L356 390 L351 396 L347 402 L337 401 L335 393 L330 384 L324 383 L314 385 L316 390 L309 400 L297 407 L287 405 L282 398 L277 401 L270 398 L265 399 L255 419 L257 440 L255 440 L188 380 L187 380 L138 391 L131 263 L130 263 L60 312 L50 340 L68 395 L65 440 L70 470 L80 500 L100 540 L140 570 L180 580 L230 586 L280 580 L330 565 L370 545 L400 520 L425 490 L440 460 L450 430 L455 400 L460 370 L463 340 L465 300 L460 265 L450 240 L440 220 L430 205 L415 195 L400 192 Z";

export default function MapLibreMap({
  week,
  variableId,
  selectedRiver,
  onSelectRiver,
  onSelectOcean,
  selectedWatershed,
}: MapLibreMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const svgOverlayRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<SvgTransform>({
    translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
  });
  const [mapReady, setMapReady] = useState(false);
  const [webglError, setWebglError] = useState(false);
  const [hoveredRiver, setHoveredRiver] = useState<number | null>(null);
  const [hoveredOcean, setHoveredOcean] = useState(false);

  const updateTransform = useCallback((map: maplibregl.Map) => {
    const nw = map.project([BAY_WEST, BAY_NORTH]);
    const se = map.project([BAY_EAST, BAY_SOUTH]);
    setTransform({
      translateX: nw.x,
      translateY: nw.y,
      scaleX: (se.x - nw.x) / SVG_W,
      scaleY: (se.y - nw.y) / SVG_H,
    });
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: "https://tiles.openfreemap.org/styles/liberty",
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
      if ((e as { error?: { type?: string } }).error?.type === "webglcontextlost" ||
          String(e).toLowerCase().includes("webgl")) {
        setWebglError(true);
      }
    });

    map.on("load", () => {
      updateTransform(map);
      setMapReady(true);
    });

    map.on("move", () => updateTransform(map));
    map.on("zoom", () => updateTransform(map));

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-left");

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [updateTransform]);

  const handleRiverClick = useCallback((svgRiverId: number) => {
    const modelId = MODEL_RIVER[svgRiverId] ?? "shizugawa";
    onSelectRiver(modelId);
    const bounds = RIVER_BOUNDS[svgRiverId];
    if (bounds && mapRef.current) {
      const paddedBounds: [number, number, number, number] = [
        bounds[0][0] - 0.004,
        bounds[0][1] - 0.004,
        bounds[1][0] + 0.004,
        bounds[1][1] + 0.004,
      ];
      mapRef.current.fitBounds(paddedBounds, { padding: 60, duration: 700 });
    }
  }, [onSelectRiver]);

  const handleMapClick = useCallback(() => {
    onSelectRiver(null);
  }, [onSelectRiver]);

  const stops = COLOR_STOPS[variableId] ?? COLOR_STOPS.nitrogen;

  const riverColors = Object.fromEntries(
    Object.keys(RIVER_PATHS).map((idStr) => {
      const id = Number(idStr);
      const modelId = MODEL_RIVER[id] ?? "shizugawa";
      const mean = computeRiverMean(week, modelId);
      return [id, interpolateColor(stops, Math.max(0, Math.min(1, mean)))];
    })
  );

  const oceanMean = computeOceanMean(week);
  const oceanColor = interpolateColor(stops, Math.max(0, Math.min(1, oceanMean)));

  const svgStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    width: SVG_W,
    height: SVG_H,
    transformOrigin: "0 0",
    transform: `translate(${transform.translateX}px, ${transform.translateY}px) scale(${transform.scaleX}, ${transform.scaleY})`,
    pointerEvents: "none",
  };

  const svgOverlayContent = (
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
          d={OCEAN_POLYGON}
          fill={`${oceanColor}55`}
          stroke={oceanColor}
          strokeWidth={hoveredOcean ? 2.5 : 1.5}
          strokeOpacity={0.7}
          style={{ pointerEvents: "all", cursor: "pointer" }}
          onMouseEnter={() => setHoveredOcean(true)}
          onMouseLeave={() => setHoveredOcean(false)}
          onClick={(e) => { e.stopPropagation(); onSelectOcean(); }}
        />

        {Object.entries(RIVER_PATHS).map(([idStr, d]) => {
          const id = Number(idStr);
          const color = riverColors[id] ?? "#60a5fa";
          const isSelected = selectedRiver === MODEL_RIVER[id];
          const isHovered = hoveredRiver === id;
          const isMainStem = MAIN_STEMS.has(id);
          const strokeWidth = isMainStem ? (isSelected || isHovered ? 8 : 6) : (isSelected || isHovered ? 5 : 3.5);
          return (
            <g key={id}>
              {(isSelected || isHovered) && (
                <path
                  d={d}
                  stroke={color}
                  strokeWidth={strokeWidth + 8}
                  fill="none"
                  strokeLinecap="round"
                  opacity={0.25}
                  style={{ pointerEvents: "none" }}
                />
              )}
              <path
                d={d}
                stroke={color}
                strokeWidth={strokeWidth}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ pointerEvents: "none" }}
              />
              <path
                d={d}
                stroke="transparent"
                strokeWidth={16}
                fill="none"
                style={{ pointerEvents: "all", cursor: "pointer" }}
                onMouseEnter={() => setHoveredRiver(id)}
                onMouseLeave={() => setHoveredRiver(null)}
                onClick={(e) => { e.stopPropagation(); handleRiverClick(id); }}
              />
            </g>
          );
        })}
      </svg>

      {hoveredOcean && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "60%",
            transform: "translate(-50%,-50%)",
            pointerEvents: "none",
          }}
        >
          <div className="bg-white border border-primary/30 rounded-md px-3 py-2 shadow-md text-center whitespace-nowrap"
            style={{ fontSize: "11px", lineHeight: 1.4 }}>
            <div className="font-semibold text-primary">Shizugawa Bay (Ocean)</div>
            <div className="text-muted-foreground mt-0.5" style={{ fontSize: "9px" }}>Click → 3D Ocean Playback</div>
          </div>
        </div>
      )}

      {hoveredRiver !== null && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "20%",
            transform: "translate(-50%,-50%)",
            pointerEvents: "none",
          }}
        >
          <div className="bg-white border border-blue-200 rounded-md px-3 py-2 shadow-md text-center whitespace-nowrap"
            style={{ fontSize: "11px", lineHeight: 1.4 }}>
            <div className="font-semibold text-blue-600">
              River Reach {hoveredRiver}
            </div>
            <div className="text-muted-foreground mt-0.5" style={{ fontSize: "9px" }}>
              {MODEL_RIVER[hoveredRiver] === "shizugawa" ? "Shizugawa R." :
               MODEL_RIVER[hoveredRiver] === "kitakami"  ? "Kitakami Trib." :
                                                           "Hachiman R."} · Click to zoom in
            </div>
          </div>
        </div>
      )}
    </>
  );

  if (webglError) {
    return (
      <div className="relative w-full h-full flex items-center justify-center bg-slate-100 overflow-hidden"
        onClick={handleMapClick}>
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: SVG_W,
            height: SVG_H,
          }}
        >
          {svgOverlayContent}
        </div>
        <div className="absolute top-2 right-2 bg-white/80 text-[10px] text-muted-foreground rounded px-2 py-1 pointer-events-none">
          SVG mode · WebGL unavailable
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      <div
        ref={containerRef}
        className="absolute inset-0 cursor-pointer"
        onClick={handleMapClick}
      />

      {mapReady && (
        <div style={svgStyle}>
          {svgOverlayContent}
        </div>
      )}
    </div>
  );
}
