import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RIVER_PATHS, SUB_BASIN_PATHS, OCEAN_BASIN_PATH } from "@/lib/svgPaths";
import { generateRiverData, RIVER_COLS, RIVER_ROWS, VARIABLE_OPTIONS } from "@/lib/simulatedData";
import NorthArrow from "@/components/NorthArrow";

const SVG_W = 465;
const SVG_H = 586;

const MODEL_RIVER: Record<number, string> = {
  1: "shizugawa", 2: "oura",      3: "karakuwa", 4: "togura",   5: "urashiro",
  6: "iriya",     7: "okawa",     8: "niida",    9: "karakuwa2", 10: "tomaya",
  11: "shishiori", 12: "onagawa", 13: "hachiman", 14: "motoyoshi", 15: "mitobe",
  16: "sakura",   17: "oritate",  18: "kitakami", 20: "moriya",  24: "oya",
  25: "kamaishi",
};


const MAIN_STEMS = new Set([4, 7, 10, 13, 3]);

// ── Soil databases (watershed context layer) ─────────────────────────────────
// Soil distribution is rendered by assigning each sub-basin a dominant soil
// (basinAssignments) and then drawing the basin polygon filled with the soil
// pattern. River corridors get an extra alluvial/wetland buffer overlay
// (floodplainSoilId). Colors follow the standard USDA / FAO-WRB cartographic
// palettes; hatch patterns follow standard USDA cartographic conventions
// (dots = sandy, diagonal = clay, wavy = alluvial, dense-dots = volcanic,
// horizontal = wetland, cross-hatch = thin/skeletal).
type SoilPattern = "dots" | "diagonal" | "horizontal" | "wavy" | "dense-dots" | "cross-hatch";
type SoilZone = {
  id: string;
  name: string;
  color: string;       // base fill (FAO-WRB / USDA-derived)
  hatch: string;       // overlay hatch / stipple color
  pattern: SoilPattern;
};
type SoilDB = {
  id: "usda" | "japan";
  label: string;
  source: string;
  zones: SoilZone[];
  basinAssignments: Record<number, string>; // basin id → soil zone id
  floodplainSoilId: string;                  // soil drawn as river-corridor buffer
};

const SOIL_DATABASES: Record<"usda" | "japan", SoilDB> = {
  usda: {
    id: "usda",
    label: "USDA Soil Taxonomy",
    source: "USDA NRCS · STATSGO2",
    zones: [
      { id: "merrimac",    name: "Merrimac (sandy outwash · Spodosol)", color: "#d4b483", hatch: "#7a4f1c", pattern: "dots"     },
      { id: "covington",   name: "Covington (silty clay · Inceptisol)", color: "#a08254", hatch: "#5a3d1f", pattern: "diagonal" },
      { id: "fluvaquents", name: "Fluvaquents (alluvial · Entisol)",    color: "#7e9b8f", hatch: "#3a5648", pattern: "wavy"     },
    ],
    basinAssignments: {
      // Northern uplands — sandy outwash on glacial / weathered granite
      25: "merrimac", 3: "merrimac", 20: "merrimac", 24: "merrimac", 23: "merrimac",
      21: "merrimac", 19: "merrimac", 18: "merrimac", 22: "merrimac", 15: "merrimac",
      // Mid-elevation interior valleys — silty clay
      17: "covington", 5: "covington", 1: "covington", 16: "covington",
      14: "covington", 13: "covington",
      // Bay-adjacent / lower watershed — alluvial floodplain
      2: "fluvaquents", 4: "fluvaquents", 6: "fluvaquents", 8: "fluvaquents",
      9: "fluvaquents", 10: "fluvaquents", 12: "fluvaquents",
    },
    floodplainSoilId: "fluvaquents",
  },
  japan: {
    id: "japan",
    label: "Japan FAO-WRB",
    source: "NIAES · Soil Map of Japan",
    zones: [
      { id: "lithosol", name: "Lithosol (thin mountain soil)",     color: "#d6c8b0", hatch: "#7d6f4e", pattern: "cross-hatch" },
      { id: "andosol",  name: "Andosol (volcanic upland)",         color: "#8a5a3b", hatch: "#2a1408", pattern: "dense-dots"  },
      { id: "cambisol", name: "Cambisol (forest brown earth)",     color: "#e0b572", hatch: "#7a4d1c", pattern: "diagonal"    },
      { id: "gleysol",  name: "Gleysol (waterlogged paddy)",       color: "#7fa6b8", hatch: "#2d4a5c", pattern: "horizontal"  },
    ],
    basinAssignments: {
      // High mountain ridges — thin / skeletal
      25: "lithosol", 3: "lithosol", 20: "lithosol", 24: "lithosol", 23: "lithosol",
      // Mid-north volcanic uplands
      21: "andosol", 19: "andosol", 18: "andosol", 17: "andosol", 22: "andosol",
      // Central / south interior forest
      5: "cambisol", 1: "cambisol", 16: "cambisol", 15: "cambisol",
      14: "cambisol", 13: "cambisol",
      // Bay-adjacent / lowland (paddy / waterlogged)
      2: "gleysol", 4: "gleysol", 6: "gleysol", 8: "gleysol",
      9: "gleysol", 10: "gleysol", 12: "gleysol",
    },
    floodplainSoilId: "gleysol",
  },
};

// SVG <pattern> body for one soil — color baked in for direct Figma copy-paste.
function SoilPatternDef({ zone }: { zone: SoilZone }) {
  return (
    <pattern
      id={`soilpat-${zone.id}`}
      patternUnits="userSpaceOnUse"
      width={6}
      height={6}
    >
      <rect width={6} height={6} fill={zone.color} />
      {zone.pattern === "dots" && (
        <circle cx={3} cy={3} r={0.7} fill={zone.hatch} />
      )}
      {zone.pattern === "diagonal" && (
        <path d="M-1 7 L 7 -1 M 2 8 L 8 2" stroke={zone.hatch} strokeWidth={0.5} />
      )}
      {zone.pattern === "horizontal" && (
        <>
          <line x1={0} y1={2}   x2={6} y2={2}   stroke={zone.hatch} strokeWidth={0.5} />
          <line x1={0} y1={4.5} x2={6} y2={4.5} stroke={zone.hatch} strokeWidth={0.5} strokeDasharray="1.2 1.2" />
        </>
      )}
      {zone.pattern === "wavy" && (
        <path d="M0 3 Q1.5 1.5 3 3 T6 3" stroke={zone.hatch} strokeWidth={0.5} fill="none" />
      )}
      {zone.pattern === "dense-dots" && (
        <>
          <circle cx={1.5} cy={1.5} r={0.5} fill={zone.hatch} />
          <circle cx={4.5} cy={1.5} r={0.5} fill={zone.hatch} />
          <circle cx={3}   cy={4}   r={0.5} fill={zone.hatch} />
          <circle cx={0}   cy={4}   r={0.5} fill={zone.hatch} />
          <circle cx={6}   cy={4}   r={0.5} fill={zone.hatch} />
        </>
      )}
      {zone.pattern === "cross-hatch" && (
        <>
          <line x1={0} y1={0} x2={6} y2={6} stroke={zone.hatch} strokeWidth={0.4} />
          <line x1={6} y1={0} x2={0} y2={6} stroke={zone.hatch} strokeWidth={0.4} />
        </>
      )}
    </pattern>
  );
}

const COLOR_STOPS: Record<string, string[]> = {
  nitrogen:   ["#2c5f8a","#3d6fa0","#6a9fc0","#90c4de","#c5dfe8","#f5f0d8","#f0d090","#e8a030","#d45820","#c8401c"],
  phosphorus: ["#1a6b4a","#2d8a5e","#4da876","#7ec89a","#b8e0c0","#f0ebb8","#f0d080","#e8a030","#d45820","#c8401c"],
  flow:       ["#0f0527","#1f0a4e","#3a0f7a","#5a1eb0","#7c3ad8","#9d61e8","#bb8ef2","#d4b6f7","#e9d7fb","#f7f0fe"],
  all:        ["#45007e", "#2060a0", "#168c8c", "#35b870", "#aadb30", "#fce820"],
};

function quantizeColor(stops: string[], t: number): string {
  const n = stops.length;
  const idx = Math.min(n - 1, Math.floor(Math.min(1, Math.max(0, t)) * n));
  return stops[idx];
}
// keep alias so existing calls work without rename
const interpolateColor = quantizeColor;

// ── River channel mask (sinusoidal meander shape per river) ──────────────────

function buildChannelMask(riverId: string): boolean[][] {
  const RIVER_SEEDS: Record<string, number> = {
    shizugawa: 0, kitakami: 1, hachiman: 2, oritate: 3, sakura: 4, niida: 5, mitobe: 6,
  };
  const seed = RIVER_SEEDS[riverId] ?? 0;
  const phase = seed * (Math.PI * 2 / 3);
  const mask: boolean[][] = Array.from({ length: RIVER_ROWS }, () =>
    new Array(RIVER_COLS).fill(false));
  for (let col = 0; col < RIVER_COLS; col++) {
    const t = col / (RIVER_COLS - 1);
    const center = (RIVER_ROWS - 1) / 2 + (RIVER_ROWS * 0.28) * Math.sin(t * Math.PI * 1.5 + phase);
    const halfW = 1.6 + 1.1 * Math.sin(t * Math.PI);
    for (let row = 0; row < RIVER_ROWS; row++) {
      if (Math.abs(row - center) <= halfW) mask[row][col] = true;
    }
  }
  return mask;
}

const CHANNEL_MASKS: Record<string, boolean[][]> = {
  shizugawa: buildChannelMask("shizugawa"),
  kitakami:  buildChannelMask("kitakami"),
  hachiman:  buildChannelMask("hachiman"),
  oritate:   buildChannelMask("oritate"),
  sakura:    buildChannelMask("sakura"),
  niida:     buildChannelMask("niida"),
  mitobe:    buildChannelMask("mitobe"),
};

// km per column (18 km total for 36 columns)
const KM_PER_COL = 18 / RIVER_COLS;


// ── Path flattener & arc-length sampler ─────────────────────────────────────

function flattenPath(d: string): [number, number][] {
  const pts: [number, number][] = [];
  const re = /([MLCQTSAZHVmlcqtsazhv])|(-?\d*\.?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let cmd = "M", cx = 0, cy = 0;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) tokens.push(m[0]);

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[MLCQTSAZHVmlcqtsazhv]/.test(t)) { cmd = t; i++; continue; }
    const nums: number[] = [];
    while (i < tokens.length && !/[MLCQTSAZHVmlcqtsazhv]/.test(tokens[i])) {
      nums.push(parseFloat(tokens[i++]));
    }
    if (cmd === "M") { cx = nums[0]; cy = nums[1]; if (pts.length === 0) pts.push([cx, cy]); }
    else if (cmd === "L") { cx = nums[0]; cy = nums[1]; pts.push([cx, cy]); }
    else if (cmd === "l") { cx += nums[0]; cy += nums[1]; pts.push([cx, cy]); }
    else if (cmd === "H") { cx = nums[0]; pts.push([cx, cy]); }
    else if (cmd === "h") { cx += nums[0]; pts.push([cx, cy]); }
    else if (cmd === "V") { cy = nums[0]; pts.push([cx, cy]); }
    else if (cmd === "v") { cy += nums[0]; pts.push([cx, cy]); }
    else if (cmd === "C" || cmd === "c") {
      const abs = cmd === "C";
      const x0 = cx, y0 = cy;
      const x1 = abs ? nums[0] : cx + nums[0], y1 = abs ? nums[1] : cy + nums[1];
      const x2 = abs ? nums[2] : cx + nums[2], y2 = abs ? nums[3] : cy + nums[3];
      const x3 = abs ? nums[4] : cx + nums[4], y3 = abs ? nums[5] : cy + nums[5];
      const STEPS = 10;
      for (let s = 1; s <= STEPS; s++) {
        const f = s / STEPS, g = 1 - f;
        pts.push([
          g*g*g*x0 + 3*g*g*f*x1 + 3*g*f*f*x2 + f*f*f*x3,
          g*g*g*y0 + 3*g*g*f*y1 + 3*g*f*f*y2 + f*f*f*y3,
        ]);
      }
      cx = x3; cy = y3;
    }
  }
  return pts;
}

function samplePathPoints(d: string, n: number): [number, number][] {
  const pts = flattenPath(d);
  if (pts.length < 2) {
    const p = pts[0] ?? [0, 0] as [number, number];
    return Array(n + 1).fill(p) as [number, number][];
  }
  const arcLen: number[] = [0];
  for (let k = 1; k < pts.length; k++) {
    const dx = pts[k][0] - pts[k-1][0];
    const dy = pts[k][1] - pts[k-1][1];
    arcLen.push(arcLen[k-1] + Math.sqrt(dx*dx + dy*dy));
  }
  const total = arcLen[arcLen.length - 1];
  if (total === 0) return Array(n + 1).fill(pts[0]) as [number, number][];

  const sampled: [number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const target = (k / n) * total;
    let lo = 0, hi = arcLen.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arcLen[mid] <= target) lo = mid; else hi = mid - 1;
    }
    const segLen = arcLen[lo + 1] - arcLen[lo];
    const f = segLen > 0 ? (target - arcLen[lo]) / segLen : 0;
    sampled.push([
      pts[lo][0] + (pts[lo+1][0] - pts[lo][0]) * f,
      pts[lo][1] + (pts[lo+1][1] - pts[lo][1]) * f,
    ]);
  }
  return sampled;
}

// Pre-compute sampled points once at module load (geometry never changes)
const REACH_SAMPLES: Record<number, [number, number][]> = (() => {
  const out: Record<number, [number, number][]> = {};
  for (const [idStr, d] of Object.entries(RIVER_PATHS)) {
    out[Number(idStr)] = samplePathPoints(d, RIVER_COLS);
  }
  return out;
})();

// ── SVG path bounds ──────────────────────────────────────────────────────────

function parseSvgPath(d: string): [number, number][] {
  const pts: [number, number][] = [];
  const re = /([MLCQTSAZmlcqtsaz])|(-?\d*\.?\d+)/g;
  let cmd = "M", cx = 0, cy = 0;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) tokens.push(m[0]);
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[MLCQTSAZmlcqtsaz]/.test(t)) { cmd = t; i++; continue; }
    const nums: number[] = [];
    while (i < tokens.length && !/[MLCQTSAZmlcqtsaz]/.test(tokens[i])) {
      nums.push(parseFloat(tokens[i++]));
    }
    if (cmd === "M" || cmd === "L") { cx = nums[0]; cy = nums[1]; pts.push([cx, cy]); }
    else if (cmd === "m" || cmd === "l") { cx += nums[0]; cy += nums[1]; pts.push([cx, cy]); }
    else if (cmd === "C") { cx = nums[4]; cy = nums[5]; pts.push([cx, cy]); }
    else if (cmd === "c") { cx += nums[4]; cy += nums[5]; pts.push([cx, cy]); }
    else if (cmd === "H") { cx = nums[0]; pts.push([cx, cy]); }
    else if (cmd === "h") { cx += nums[0]; pts.push([cx, cy]); }
    else if (cmd === "V") { cy = nums[0]; pts.push([cx, cy]); }
    else if (cmd === "v") { cy += nums[0]; pts.push([cx, cy]); }
  }
  return pts;
}


function computeRiverSvgBounds(modelRiver: string): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [idStr, d] of Object.entries(RIVER_PATHS)) {
    if (MODEL_RIVER[Number(idStr)] !== modelRiver) continue;
    for (const [x, y] of parseSvgPath(d)) {
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: SVG_W, h: SVG_H };
  const PAD = 80;
  const rx = Math.max(0, minX - PAD);
  const ry = Math.max(0, minY - PAD);
  const rw = Math.min(SVG_W, maxX + PAD) - rx;
  const rh = Math.min(SVG_H, maxY + PAD) - ry;
  return { x: rx, y: ry, w: Math.max(120, rw), h: Math.max(120, rh) };
}

/** Union viewBox that frames all rivers in a corridor */
function computeCorridorSvgBounds(
  modelIds: string[]
): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [idStr, d] of Object.entries(RIVER_PATHS)) {
    const m = MODEL_RIVER[Number(idStr)];
    if (!modelIds.includes(m)) continue;
    for (const [x, y] of parseSvgPath(d)) {
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: SVG_W, h: SVG_H };
  const PAD = 70;
  const rx = Math.max(0, minX - PAD);
  const ry = Math.max(0, minY - PAD);
  const rw = Math.min(SVG_W, maxX + PAD) - rx;
  const rh = Math.min(SVG_H, maxY + PAD) - ry;
  return { x: rx, y: ry, w: Math.max(150, rw), h: Math.max(150, rh) };
}

// ── Component ────────────────────────────────────────────────────────────────

interface CorridorRiverEntry { id: string; role: "upper" | "lower" }

interface MapLibreMapProps {
  week: number;
  variableId: string;
  selectedRiver: string | null;
  onSelectRiver: (id: string | null) => void;
  onSelectOcean: () => void;
  corridorSegments?: { rivers: CorridorRiverEntry[]; corridorId: string } | null;
}

export default function MapLibreMap({
  week,
  variableId,
  selectedRiver,
  onSelectRiver,
  onSelectOcean,
  corridorSegments,
}: MapLibreMapProps) {
  const navigate = useNavigate();
  const [hoveredRiver, setHoveredRiver] = useState<number | null>(null);
  const [hoveredOcean, setHoveredOcean] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [vb, setVb] = useState({ x: 0, y: 0, w: SVG_W, h: SVG_H });
  const [showSoilLayer, setShowSoilLayer] = useState(false);
  const [soilDatabase, setSoilDatabase] = useState<"usda" | "japan">("usda");
  const activeSoilDB = SOIL_DATABASES[soilDatabase];

  useEffect(() => {
    if (corridorSegments) {
      setShowGrid(false);
      setVb(computeCorridorSvgBounds(corridorSegments.rivers.map(r => r.id)));
    } else if (!selectedRiver) {
      setVb({ x: 0, y: 0, w: SVG_W, h: SVG_H });
      setShowGrid(false);
    } else {
      setVb(computeRiverSvgBounds(selectedRiver));
    }
  }, [selectedRiver, corridorSegments]);

  // Color + label lookup for each corridor river (upper1=blue, upper2=violet, lower=teal)
  const corridorRiverMap = useMemo(() => {
    if (!corridorSegments) return {} as Record<string, { color: string; label: string }>;
    const UPPER_COLORS = ["#3b82f6", "#8b5cf6"];
    const UPPER_LABELS = ["Upper 1", "Upper 2"];
    let ui = 0;
    const map: Record<string, { color: string; label: string }> = {};
    corridorSegments.rivers.forEach(r => {
      if (r.role === "lower") {
        map[r.id] = { color: "#14b8a6", label: "Lower → Bay" };
      } else {
        map[r.id] = { color: UPPER_COLORS[ui % 2], label: UPPER_LABELS[ui % 2] };
        ui++;
      }
    });
    return map;
  }, [corridorSegments]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onSelectRiver(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onSelectRiver]);

  const stops = COLOR_STOPS[variableId] ?? COLOR_STOPS.nitrogen;
  const variableLabel = VARIABLE_OPTIONS.find(v => v.id === variableId)?.label ?? variableId;

  // Data-driven color per reach
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

  // Grid data for the selected river (used in grid view)
  const gridData = useMemo(() => {
    if (!selectedRiver) return null;
    return generateRiverData(week, selectedRiver);
  }, [selectedRiver, week]);


  return (
    <div className="relative w-full h-full bg-[#f0f4f8] overflow-hidden">
      <svg
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", transition: "viewBox 0.6s ease" }}
      >
        {/* Background layer — grayscale + dimmed when a river is selected */}
        <g style={selectedRiver ? { filter: "grayscale(100%)", opacity: 0.18, transition: "opacity 0.3s, filter 0.3s" } : { transition: "opacity 0.3s, filter 0.3s" }}>
          {/* Geographic background from Figma (labels + rivers) */}
          <image
            href="/Sub-basin area.svg"
            x={0} y={0}
            width={SVG_W} height={SVG_H}
            preserveAspectRatio="xMidYMid meet"
            opacity={0.9}
            style={{ filter: "saturate(0)" }}
          />

          {/* Soil layer — sub-basin-snapped polygons + river-corridor buffer */}
          {showSoilLayer && (() => {
            const floodplain = activeSoilDB.zones.find(z => z.id === activeSoilDB.floodplainSoilId)!;
            return (
              <>
                <defs>
                  <clipPath id="soil-land-clip" clipPathUnits="userSpaceOnUse">
                    {Object.entries(SUB_BASIN_PATHS).map(([idStr, d]) => (
                      <path key={`soilclip-${idStr}`} d={d} />
                    ))}
                  </clipPath>
                  {activeSoilDB.zones.map((z) => (
                    <SoilPatternDef key={`pat-${z.id}`} zone={z} />
                  ))}
                </defs>

                <g style={{ pointerEvents: "none" }}>
                  {/* Sub-basin fills with hatched soil pattern */}
                  {Object.entries(SUB_BASIN_PATHS).map(([idStr, d]) => {
                    const id = Number(idStr);
                    const soilId = activeSoilDB.basinAssignments[id];
                    if (!soilId) return null;
                    return (
                      <path
                        key={`soil-${id}`}
                        d={d}
                        fill={`url(#soilpat-${soilId})`}
                        fillOpacity={0.78}
                        stroke={activeSoilDB.zones.find(z => z.id === soilId)?.hatch}
                        strokeWidth={0.4}
                        strokeOpacity={0.5}
                      />
                    );
                  })}

                  {/* River-corridor buffer — alluvial / waterlogged strip along streams.
                      Clipped to land so it never bleeds into the bay. */}
                  <g clipPath="url(#soil-land-clip)">
                    {Object.entries(RIVER_PATHS).map(([idStr, d]) => {
                      const id = Number(idStr);
                      const isMain = MAIN_STEMS.has(id);
                      return (
                        <path
                          key={`flood-${id}`}
                          d={d}
                          fill="none"
                          stroke={floodplain.color}
                          strokeWidth={isMain ? 7 : 4}
                          strokeOpacity={0.7}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      );
                    })}
                    {/* Hatch overlay along rivers, same pattern as floodplain soil */}
                    {Object.entries(RIVER_PATHS).map(([idStr, d]) => {
                      const id = Number(idStr);
                      const isMain = MAIN_STEMS.has(id);
                      return (
                        <path
                          key={`floodhatch-${id}`}
                          d={d}
                          fill="none"
                          stroke={`url(#soilpat-${floodplain.id})`}
                          strokeWidth={isMain ? 7 : 4}
                          strokeOpacity={0.95}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      );
                    })}
                  </g>
                </g>
              </>
            );
          })()}

          {/* Sub-basin fills — boundary lines only */}
          {Object.entries(SUB_BASIN_PATHS).map(([idStr, d]) => {
            const id = Number(idStr);
            return (
              <path key={id} d={d} fill="none"
                stroke="#94a3b8" strokeWidth={0.6} strokeOpacity={0.6}
                style={{ pointerEvents: "none" }} />
            );
          })}

          {/* Ocean polygon — static neutral colour; data is shown in the Ocean 3D tab */}
          <path
            d={OCEAN_BASIN_PATH}
            fill="#93c5d955"
            stroke="#60a5c8"
            strokeWidth={hoveredOcean ? 2.5 : 1.5}
            strokeOpacity={0.9}
            style={{ pointerEvents: selectedRiver ? "none" : "all", cursor: "pointer" }}
            onMouseEnter={() => setHoveredOcean(true)}
            onMouseLeave={() => setHoveredOcean(false)}
            onClick={onSelectOcean}
          />
        </g>

        {/* Rivers: single solid color per reach */}
        {Object.entries(RIVER_PATHS).map(([idStr, d]) => {
          const id = Number(idStr);
          const modelId = MODEL_RIVER[id];

          // ── Corridor mode ──
          const corridorInfo = corridorRiverMap[modelId];
          const inCorridor = !!corridorInfo;
          const corridorActive = !!corridorSegments;

          const isSelected = selectedRiver === modelId;
          const isHovered = hoveredRiver === id;
          const isOther = corridorActive
            ? !inCorridor
            : (!!selectedRiver && !isSelected);

          const isMainStem = MAIN_STEMS.has(id);
          const sw = isMainStem
            ? (isSelected || isHovered || inCorridor ? 6 : 4)
            : (isSelected || isHovered || inCorridor ? 4 : 2.5);

          const samples = REACH_SAMPLES[id];

          // Color: always use data-value color so playback animation is visible
          const baseColor = reachColors[id] ?? "#60a5fa";
          const color = baseColor;

          const otherStyle = isOther
            ? { filter: "grayscale(100%)", opacity: 0.15, transition: "opacity 0.3s, filter 0.3s" }
            : { transition: "opacity 0.3s, filter 0.3s" };

          return (
            <g key={id} style={otherStyle}>
              {/* Glow halo — corridor segments or hovered/selected */}
              {(isSelected || isHovered || inCorridor) && (
                <polyline
                  points={samples.map(p => `${p[0]},${p[1]}`).join(" ")}
                  fill="none"
                  stroke={color}
                  strokeWidth={sw + (inCorridor ? 12 : 10)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={inCorridor ? 0.28 : 0.22}
                  style={{ pointerEvents: "none" }}
                />
              )}

              {/* Single solid-color stroke */}
              <polyline
                points={samples.map(p => `${p[0]},${p[1]}`).join(" ")}
                fill="none"
                stroke={color}
                strokeWidth={sw}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ pointerEvents: "none" }}
              />

              {/* Corridor river label tag in the middle of each river */}
              {inCorridor && (() => {
                const mid = samples[Math.floor(samples.length / 2)];
                if (!mid) return null;
                const label = corridorInfo.label;
                const tagW = label.length * 4.8 + 8;
                return (
                  <g style={{ pointerEvents: "none" }}>
                    <rect x={mid[0] - tagW / 2} y={mid[1] - 9} width={tagW} height={13} rx={3}
                      fill={corridorInfo.color} opacity={0.92} />
                    <text x={mid[0]} y={mid[1] + 1.5} textAnchor="middle"
                      fontSize={7} fill="white" fontWeight="bold" fontFamily="monospace">
                      {label}
                    </text>
                  </g>
                );
              })()}

              {/* Transparent wide hit zone */}
              <path d={d} stroke="transparent" strokeWidth={18} fill="none"
                style={{ pointerEvents: corridorActive ? "none" : "all", cursor: "pointer" }}
                onMouseEnter={() => setHoveredRiver(id)}
                onMouseLeave={() => setHoveredRiver(null)}
                onClick={() => onSelectRiver(modelId ?? null)}
              />
            </g>
          );
        })}
      </svg>

      {/* Pixel grid view overlay — CSS-grid based, fills any container shape */}
      {showGrid && selectedRiver && gridData && (() => {
        const mask = CHANNEL_MASKS[selectedRiver] ?? CHANNEL_MASKS.shizugawa;
        const riverLabel = selectedRiver.charAt(0).toUpperCase() + selectedRiver.slice(1);
        const Y_AXIS_W = "3.2rem";
        return (
          <div className="absolute inset-0 bg-[#f8fafc] flex flex-col overflow-hidden">

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
      {hoveredOcean && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white border border-primary/30 rounded-md px-3 py-2 shadow-md text-center whitespace-nowrap pointer-events-none"
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
        return (
          <div className="absolute bottom-3 left-3 flex flex-col gap-0.5 bg-white/90 backdrop-blur-sm border border-border rounded-md px-2.5 py-1.5 shadow-sm pointer-events-none">
            <span className="text-[9px] text-muted-foreground font-medium">{variableLabel}</span>
            <div className="flex rounded-sm overflow-hidden border border-border/20">
              {stops.map((color, i) => {
                const lo = (minVal + (i / stops.length) * (maxVal - minVal)).toFixed(1);
                const hi = (minVal + ((i + 1) / stops.length) * (maxVal - minVal)).toFixed(1);
                return <div key={i} style={{ backgroundColor: color, width: 26, height: 12 }} title={`${lo}–${hi} ${unit}`} />;
              })}
            </div>
            <div className="flex">
              {stops.map((_, i) => {
                const lo = (minVal + (i / stops.length) * (maxVal - minVal)).toFixed(1);
                return (
                  <div key={i} className="text-[7px] font-mono text-slate-500 text-center" style={{ width: 26 }}>
                    {lo}
                  </div>
                );
              })}
            </div>
            <div className="text-[7px] font-mono text-slate-400 text-right">{unit}</div>
          </div>
        );
      })()}

      {/* Controls when a corridor is active */}
      {corridorSegments && (
        <div className="absolute top-2 left-2 flex items-center gap-2 flex-wrap">
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
        <div className="absolute top-2 left-2 flex items-center gap-2">
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

      {/* Layers panel — top-right overlay */}
      {!corridorSegments && !selectedRiver && (
        <div className="absolute top-2 right-2 bg-white/95 backdrop-blur-sm border border-border rounded-md shadow-sm overflow-hidden z-10" style={{ width: 188 }}>
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Layers</span>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <span className="text-[10px] text-slate-600">Soil</span>
              <input
                type="checkbox"
                checked={showSoilLayer}
                onChange={(e) => setShowSoilLayer(e.target.checked)}
                className="w-3 h-3 accent-violet-600 cursor-pointer"
              />
            </label>
          </div>

          {showSoilLayer && (
            <div className="px-2.5 py-1.5">
              {/* Database switcher */}
              <div className="flex rounded overflow-hidden border border-border mb-1.5">
                {(["usda", "japan"] as const).map((dbId) => (
                  <button
                    key={dbId}
                    onClick={() => setSoilDatabase(dbId)}
                    className={`flex-1 px-2 py-1 text-[9px] font-semibold transition-colors ${
                      soilDatabase === dbId
                        ? "bg-violet-600 text-white"
                        : "bg-white text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {dbId === "usda" ? "USDA" : "Japan"}
                  </button>
                ))}
              </div>

              {/* Database label + source */}
              <div className="text-[9px] font-semibold text-slate-700 leading-tight">
                {activeSoilDB.label}
              </div>
              <div className="text-[8px] text-slate-400 leading-tight mb-1.5">
                {activeSoilDB.source}
              </div>

              {/* Legend swatches — each shows the actual hatch pattern */}
              <div className="flex flex-col gap-0.5">
                {activeSoilDB.zones.map((z) => (
                  <div key={z.id} className="flex items-center gap-1.5">
                    <svg width={14} height={14} className="flex-shrink-0 rounded-sm border border-black/15">
                      <defs>
                        <SoilPatternDef zone={z} />
                      </defs>
                      <rect width={14} height={14} fill={`url(#soilpat-${z.id})`} />
                    </svg>
                    <span className="text-[9px] text-slate-600 leading-tight truncate" title={z.name}>
                      {z.name}
                    </span>
                    {z.id === activeSoilDB.floodplainSoilId && (
                      <span
                        className="text-[7px] text-slate-400 ml-auto flex-shrink-0"
                        title="Also overlaid as a buffer along river corridors"
                      >
                        +rivers
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* North arrow — bottom-right corner */}
      <NorthArrow className="absolute bottom-4 right-4 z-10" />
    </div>
  );
}
