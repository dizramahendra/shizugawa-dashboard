import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RIVER_PATHS, SUB_BASIN_PATHS, OCEAN_BASIN_PATH } from "@/lib/svgPaths";
import { generateRiverData, RIVER_COLS, RIVER_ROWS, VARIABLE_OPTIONS } from "@/lib/simulatedData";
import NorthArrow from "@/components/NorthArrow";
import LegendOverlay from "@/components/LegendOverlay";

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

// Feature flag — hides the Soil layer UI + rendering. All soil code below is
// preserved intentionally so we can flip this back to `true` later without
// recovering the implementation. Toggle to `true` to restore the layer.
const SOIL_LAYER_ENABLED = false;

// ── Soil databases (watershed context layer) ─────────────────────────────────
// The soil layer is rendered as a randomized pixel scatter over the entire
// land area (clipped to the union of sub-basin polygons). Each pixel cell
// gets a soil color picked deterministically by a seeded PRNG, so the
// distribution is reproducible across renders but visually random — matching
// the Figma reference style. Colors are flat single hues, no hatch overlay.
type SoilZone = { id: string; name: string; color: string };
type SoilDB = {
  id: "usda" | "japan";
  label: string;
  source: string;
  zones: SoilZone[];
};

const SOIL_DATABASES: Record<"usda" | "japan", SoilDB> = {
  usda: {
    id: "usda",
    label: "USDA Soil Taxonomy",
    source: "USDA NRCS · STATSGO2",
    zones: [
      { id: "merrimac",    name: "Merrimac",    color: "#a855f7" },
      { id: "fluvaquents", name: "Fluvaquents", color: "#5eead4" },
      { id: "covington",   name: "Covington",   color: "#a3e635" },
    ],
  },
  japan: {
    id: "japan",
    label: "Japan FAO-WRB",
    source: "NIAES · Soil Map of Japan",
    zones: [
      { id: "lithosol", name: "Lithosol", color: "#84cc16" },
      { id: "andosol",  name: "Andosol",  color: "#d97706" },
      { id: "cambisol", name: "Cambisol", color: "#a16207" },
      { id: "gleysol",  name: "Gleysol",  color: "#475569" },
    ],
  },
};

// Soil-layer pixel grid ───────────────────────────────────────────────────────
const SOIL_PIXEL_SIZE = 6; // SVG units per pixel cell

function soilHash(x: number, y: number, seed: number): number {
  // Tiny deterministic hash → [0, 1)
  let h = (x * 374761393 + y * 668265263 + seed * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const COLOR_STOPS: Record<string, string[]> = {
  nitrogen:   ["#2c5f8a","#3d6fa0","#6a9fc0","#90c4de","#c5dfe8","#f5f0d8","#f0d090","#e8a030","#d45820","#c8401c"],
  phosphorus: ["#2c5f8a","#3d6fa0","#6a9fc0","#90c4de","#c5dfe8","#f5f0d8","#f0d090","#e8a030","#d45820","#c8401c"],
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
  // ── Sub-basin multi-select mode (used by the Sub-basin tab) ────────────
  // When `subBasinMode` is true the rivers + ocean become non-interactive
  // and the sub-basin polygons accept clicks; the parent owns the
  // selection set and supplies a stable color per id.
  subBasinMode?:    boolean;
  selectedSubBasins?: number[];
  subBasinColors?:    Record<number, string>;
  onToggleSubBasin?:  (id: number) => void;
}

export default function MapLibreMap({
  week,
  variableId,
  selectedRiver,
  onSelectRiver,
  onSelectOcean,
  corridorSegments,
  subBasinMode = false,
  selectedSubBasins,
  subBasinColors,
  onToggleSubBasin,
}: MapLibreMapProps) {
  const navigate = useNavigate();
  const [hoveredRiver, setHoveredRiver] = useState<number | null>(null);
  const [hoveredOcean, setHoveredOcean] = useState(false);
  const [hoveredSubBasin, setHoveredSubBasin] = useState<number | null>(null);
  const selectedSubBasinSet = useMemo(
    () => new Set(selectedSubBasins ?? []),
    [selectedSubBasins],
  );
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
        {/* Top-level defs — filter that flattens the background SVG's rivers
            (originally drawn in different blue/teal hues) to a single uniform
            grey, while keeping near-white background pixels white. Without
            this, `saturate(0)` alone preserves each river's original luminance,
            so dark and light grey outlines bleed out from under the colored
            data strokes inconsistently. */}
        <defs>
          <filter id="uniform-grey-rivers" x="0%" y="0%" width="100%" height="100%">
            {/* Step 1: collapse RGB to luminance grey. */}
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0.299 0.587 0.114 0 0
                      0.299 0.587 0.114 0 0
                      0.299 0.587 0.114 0 0
                      0     0     0     1 0"
              result="grey"
            />
            {/* Step 2: posterize — anything below ~90% luminance (rivers, labels,
                outlines) is mapped to a single mid-grey ≈ #a8a8a8; the brightest
                bin (background paper) stays white. */}
            <feComponentTransfer in="grey">
              <feFuncR type="discrete" tableValues="0.66 0.66 0.66 0.66 0.66 0.66 0.66 0.66 0.66 1" />
              <feFuncG type="discrete" tableValues="0.66 0.66 0.66 0.66 0.66 0.66 0.66 0.66 0.66 1" />
              <feFuncB type="discrete" tableValues="0.66 0.66 0.66 0.66 0.66 0.66 0.66 0.66 0.66 1" />
            </feComponentTransfer>
          </filter>
        </defs>

        {/* Background layer — grayscale + dimmed when a river is selected
            (kept full-opacity in sub-basin mode so polygon fills read clearly) */}
        <g style={(selectedRiver && !subBasinMode) ? { filter: "grayscale(100%)", opacity: 0.18, transition: "opacity 0.3s, filter 0.3s" } : { transition: "opacity 0.3s, filter 0.3s" }}>
          {/* Geographic background from Figma (labels + rivers) */}
          <image
            href="/Sub-basin area.svg"
            x={0} y={0}
            width={SVG_W} height={SVG_H}
            preserveAspectRatio="xMidYMid meet"
            opacity={0.9}
            style={{ filter: "url(#uniform-grey-rivers)" }}
          />

          {/* Soil layer — random pixel scatter, clipped to land */}
          {SOIL_LAYER_ENABLED && showSoilLayer && (() => {
            const cols = Math.ceil(SVG_W / SOIL_PIXEL_SIZE);
            const rows = Math.ceil(SVG_H / SOIL_PIXEL_SIZE);
            const zones = activeSoilDB.zones;
            const seed = soilDatabase === "usda" ? 1 : 2;
            const cells: Array<{ x: number; y: number; fill: string }> = [];
            for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols; c++) {
                const idx = Math.floor(soilHash(c, r, seed) * zones.length);
                cells.push({
                  x: c * SOIL_PIXEL_SIZE,
                  y: r * SOIL_PIXEL_SIZE,
                  fill: zones[idx].color,
                });
              }
            }
            return (
              <>
                <defs>
                  <clipPath id="soil-land-clip" clipPathUnits="userSpaceOnUse">
                    {Object.entries(SUB_BASIN_PATHS).map(([idStr, d]) => (
                      <path key={`soilclip-${idStr}`} d={d} />
                    ))}
                  </clipPath>
                </defs>
                <g clipPath="url(#soil-land-clip)" style={{ pointerEvents: "none" }} opacity={0.75}>
                  {cells.map((p, i) => (
                    <rect
                      key={i}
                      x={p.x}
                      y={p.y}
                      width={SOIL_PIXEL_SIZE}
                      height={SOIL_PIXEL_SIZE}
                      fill={p.fill}
                      shapeRendering="crispEdges"
                    />
                  ))}
                </g>
              </>
            );
          })()}

          {/* Sub-basin polygons — boundary-only normally; clickable + colored in subBasinMode */}
          {Object.entries(SUB_BASIN_PATHS).map(([idStr, d]) => {
            const id = Number(idStr);
            if (subBasinMode) {
              const isSel = selectedSubBasinSet.has(id);
              const isHov = hoveredSubBasin === id;
              const fillColor = isSel ? (subBasinColors?.[id] ?? "#3b82f6") : "#94a3b8";
              const fillOpacity = isSel ? 0.55 : (isHov ? 0.18 : 0);
              return (
                <path
                  key={id}
                  d={d}
                  fill={fillColor}
                  fillOpacity={fillOpacity}
                  stroke={isSel ? fillColor : "#64748b"}
                  strokeWidth={isSel ? 1.4 : (isHov ? 1.0 : 0.6)}
                  strokeOpacity={isSel ? 0.95 : 0.7}
                  style={{ pointerEvents: "all", cursor: "pointer", transition: "fill-opacity 0.15s, stroke-width 0.15s" }}
                  onMouseEnter={() => setHoveredSubBasin(id)}
                  onMouseLeave={() => setHoveredSubBasin(prev => prev === id ? null : prev)}
                  onClick={(e) => { e.stopPropagation(); onToggleSubBasin?.(id); }}
                >
                  <title>{`Sub-basin ${id}`}</title>
                </path>
              );
            }
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
            style={{
              pointerEvents: (selectedRiver || subBasinMode) ? "none" : "all",
              cursor: "pointer",
            }}
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
                style={{
                  pointerEvents: (corridorActive || subBasinMode) ? "none" : "all",
                  cursor: "pointer",
                }}
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
        const dec    = varOpt?.decimals ?? 1;
        return (
          <div className="absolute bottom-3 left-3 pointer-events-none">
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

      {/* Layers panel — top-right overlay (currently hidden via SOIL_LAYER_ENABLED) */}
      {SOIL_LAYER_ENABLED && !corridorSegments && !selectedRiver && (
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

              {/* Legend swatches — flat color squares */}
              <div className="flex flex-col gap-0.5">
                {activeSoilDB.zones.map((z) => (
                  <div key={z.id} className="flex items-center gap-1.5">
                    <span
                      className="w-3 h-3 rounded-sm flex-shrink-0 border border-black/10"
                      style={{ background: z.color }}
                    />
                    <span className="text-[9px] text-slate-600 leading-tight truncate" title={z.name}>
                      {z.name}
                    </span>
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
