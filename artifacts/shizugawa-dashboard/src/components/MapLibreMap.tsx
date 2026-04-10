import { useEffect, useMemo, useState } from "react";
import { RIVER_PATHS, SUB_BASIN_PATHS } from "@/lib/svgPaths";
import { generateRiverData, generateWeekData, BAY_MASK, GRID_W, GRID_D, RIVER_COLS, RIVER_ROWS } from "@/lib/simulatedData";

const SVG_W = 465;
const SVG_H = 586;

const MODEL_RIVER: Record<number, string> = {
  1: "shizugawa", 2: "shizugawa", 3: "shizugawa", 4: "shizugawa", 5: "shizugawa",
  6: "shizugawa", 7: "shizugawa", 8: "kitakami", 9: "kitakami", 10: "kitakami",
  11: "kitakami", 12: "kitakami", 13: "hachiman", 14: "hachiman", 15: "hachiman",
  16: "hachiman", 17: "hachiman", 18: "hachiman", 19: "hachiman", 20: "hachiman",
  21: "hachiman", 22: "hachiman", 23: "hachiman", 24: "hachiman", 25: "hachiman",
};

const REACH_POSITION: Record<number, number> = (() => {
  const groups: Record<string, number[]> = {};
  for (const [idStr, river] of Object.entries(MODEL_RIVER)) {
    (groups[river] ??= []).push(Number(idStr));
  }
  const pos: Record<number, number> = {};
  for (const [, ids] of Object.entries(groups)) {
    ids.forEach((id, i) => { pos[id] = i / Math.max(1, ids.length - 1); });
  }
  return pos;
})();

function computeReachValue(week: number, reachId: number): number {
  const modelRiver = MODEL_RIVER[reachId] ?? "shizugawa";
  const positionFrac = REACH_POSITION[reachId] ?? 0.5;
  const grid = generateRiverData(week, modelRiver);
  const col = Math.min(RIVER_COLS - 1, Math.round(positionFrac * (RIVER_COLS - 1)));
  let sum = 0;
  for (let r = 0; r < RIVER_ROWS; r++) sum += grid[r][col];
  return sum / RIVER_ROWS;
}

const MAIN_STEMS = new Set([4, 7, 10, 13, 3]);

const COLOR_STOPS: Record<string, string[]> = {
  nitrogen:    ["#e0f2fe", "#7dd3fc", "#0ea5e9", "#0369a1", "#1e3a5f"],
  phosphorus:  ["#fce7f3", "#f9a8d4", "#ec4899", "#be185d", "#500724"],
  sediment:    ["#fef3c7", "#fcd34d", "#f59e0b", "#b45309", "#451a03"],
  do:          ["#ecfdf5", "#6ee7b7", "#10b981", "#047857", "#022c22"],
  chlorophyll: ["#f0fdf4", "#86efac", "#22c55e", "#15803d", "#14532d"],
  all:         ["#45007e", "#2060a0", "#168c8c", "#35b870", "#aadb30", "#fce820"],
};

function interpolateColor(stops: string[], t: number): string {
  const n = stops.length - 1;
  const i = Math.min(n - 1, Math.floor(t * n));
  const f = t * n - i;
  const c0 = stops[i], c1 = stops[i + 1];
  const hex = (s: string, o: number) => parseInt(s.slice(o, o + 2), 16);
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * f);
  const r = lerp(hex(c0, 1), hex(c1, 1));
  const g = lerp(hex(c0, 3), hex(c1, 3));
  const b = lerp(hex(c0, 5), hex(c1, 5));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function computeOceanMean(week: number): number {
  const data = generateWeekData(week);
  let sum = 0, count = 0;
  for (let d = 0; d < GRID_D; d++) {
    for (let z = 0; z < GRID_W; z++) {
      for (let x = 0; x < GRID_W; x++) {
        if (BAY_MASK[z]?.[x]) { sum += data[d]?.[z]?.[x] ?? 0; count++; }
      }
    }
  }
  return count > 0 ? sum / count : 0;
}

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

const OCEAN_POLYGON_SVG = "M387 197 L392 215 L400 218 L408 215 L413 223 L413 241 L415 264 L414 271 L408 283 L418 299 L404 308 L394 313 L400 336 L410 343 L404 364 L392 400 L379 403 L380 397 L382 389 L378 390 L376 391 L372 394 L371 397 L366 401 L360 399 L360 394 L356 390 L351 396 L347 402 L337 401 L335 393 L330 384 L324 383 L314 385 L316 390 L309 400 L297 407 L287 405 L282 398 L277 401 L270 398 L265 399 L255 419 L257 440 L188 380 L138 391 L131 263 L60 312 L50 340 L68 395 L65 440 L70 470 L80 500 L100 540 L140 570 L180 580 L230 586 L280 580 L330 565 L370 545 L400 520 L425 490 L440 460 L450 430 L455 400 L460 370 L463 340 L465 300 L460 265 L450 240 L440 220 L430 205 L415 195 L400 192 Z";

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
  const PAD = 50;
  const rx = Math.max(0, minX - PAD);
  const ry = Math.max(0, minY - PAD);
  const rw = Math.min(SVG_W, maxX + PAD) - rx;
  const rh = Math.min(SVG_H, maxY + PAD) - ry;
  return { x: rx, y: ry, w: Math.max(60, rw), h: Math.max(60, rh) };
}

// ── Component ────────────────────────────────────────────────────────────────

interface MapLibreMapProps {
  week: number;
  variableId: string;
  selectedRiver: string | null;
  onSelectRiver: (id: string | null) => void;
  onSelectOcean: () => void;
}

export default function MapLibreMap({
  week,
  variableId,
  selectedRiver,
  onSelectRiver,
  onSelectOcean,
}: MapLibreMapProps) {
  const [hoveredRiver, setHoveredRiver] = useState<number | null>(null);
  const [hoveredOcean, setHoveredOcean] = useState(false);
  const [vb, setVb] = useState({ x: 0, y: 0, w: SVG_W, h: SVG_H });

  useEffect(() => {
    if (!selectedRiver) setVb({ x: 0, y: 0, w: SVG_W, h: SVG_H });
    else setVb(computeRiverSvgBounds(selectedRiver));
  }, [selectedRiver]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onSelectRiver(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onSelectRiver]);

  const stops = COLOR_STOPS[variableId] ?? COLOR_STOPS.nitrogen;
  const oceanColor = interpolateColor(stops, Math.max(0, Math.min(1, computeOceanMean(week))));

  // Per-reach: RIVER_COLS column colors from the model grid
  const reachSegmentColors = useMemo(() => {
    const out: Record<number, string[]> = {};
    for (const idStr of Object.keys(RIVER_PATHS)) {
      const id = Number(idStr);
      const modelRiver = MODEL_RIVER[id] ?? "shizugawa";
      const grid = generateRiverData(week, modelRiver);
      out[id] = Array.from({ length: RIVER_COLS }, (_, col) => {
        let sum = 0;
        for (let row = 0; row < RIVER_ROWS; row++) sum += grid[row]?.[col] ?? 0;
        return interpolateColor(stops, Math.max(0, Math.min(1, sum / RIVER_ROWS)));
      });
    }
    return out;
  }, [week, stops]);

  // Sub-basin fill color (single value per basin)
  const subBasinColors = useMemo(() => {
    const out: Record<number, string> = {};
    for (const idStr of Object.keys(SUB_BASIN_PATHS)) {
      const id = Number(idStr);
      out[id] = interpolateColor(stops, Math.max(0, Math.min(1, computeReachValue(week, id))));
    }
    return out;
  }, [week, stops]);

  return (
    <div className="relative w-full h-full bg-[#f0f4f8] overflow-hidden">
      <svg
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", transition: "viewBox 0.6s ease" }}
      >
        {/* Geographic background */}
        <image
          href="/Sub-basin area.svg"
          x={0} y={0}
          width={SVG_W} height={SVG_H}
          preserveAspectRatio="xMidYMid meet"
          opacity={0.9}
        />

        {/* Sub-basin fills */}
        {Object.entries(SUB_BASIN_PATHS).map(([idStr, d]) => {
          const id = Number(idStr);
          return (
            <path key={id} d={d} fill={subBasinColors[id] ?? "#7dd3fc"} fillOpacity={0.28}
              stroke="#6b7280" strokeWidth={0.5} strokeOpacity={0.5}
              style={{ pointerEvents: "none" }} />
          );
        })}

        {/* Ocean polygon */}
        <path
          d={OCEAN_POLYGON_SVG}
          fill={`${oceanColor}55`}
          stroke={oceanColor}
          strokeWidth={hoveredOcean ? 2.5 : 1.5}
          strokeOpacity={0.8}
          style={{ pointerEvents: "all", cursor: "pointer" }}
          onMouseEnter={() => setHoveredOcean(true)}
          onMouseLeave={() => setHoveredOcean(false)}
          onClick={onSelectOcean}
        />

        {/* Rivers: grid-segmented heatmap strips */}
        {Object.entries(RIVER_PATHS).map(([idStr, d]) => {
          const id = Number(idStr);
          const isSelected = selectedRiver === MODEL_RIVER[id];
          const isHovered = hoveredRiver === id;
          const isMainStem = MAIN_STEMS.has(id);
          const sw = isMainStem
            ? (isSelected || isHovered ? 6 : 4)
            : (isSelected || isHovered ? 4 : 2.5);
          const samples = REACH_SAMPLES[id];
          const segColors = reachSegmentColors[id] ?? [];

          return (
            <g key={id}>
              {/* Glow halo when hovered/selected */}
              {(isSelected || isHovered) && (
                <polyline
                  points={samples.map(p => `${p[0]},${p[1]}`).join(" ")}
                  fill="none"
                  stroke={segColors[Math.floor(RIVER_COLS / 2)] ?? "#60a5fa"}
                  strokeWidth={sw + 10}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.18}
                  style={{ pointerEvents: "none" }}
                />
              )}

              {/* Grid segments: one colored line per RIVER_COLS column, butt caps = no gap */}
              {Array.from({ length: RIVER_COLS }, (_, col) => {
                const [x1, y1] = samples[col];
                const [x2, y2] = samples[col + 1];
                return (
                  <line
                    key={col}
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={segColors[col] ?? "#60a5fa"}
                    strokeWidth={sw}
                    strokeLinecap="butt"
                    style={{ pointerEvents: "none" }}
                  />
                );
              })}

              {/* Transparent wide hit zone */}
              <path d={d} stroke="transparent" strokeWidth={18} fill="none"
                style={{ pointerEvents: "all", cursor: "pointer" }}
                onMouseEnter={() => setHoveredRiver(id)}
                onMouseLeave={() => setHoveredRiver(null)}
                onClick={() => onSelectRiver(MODEL_RIVER[id] ?? null)}
              />
            </g>
          );
        })}
      </svg>

      {/* Ocean tooltip */}
      {hoveredOcean && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white border border-primary/30 rounded-md px-3 py-2 shadow-md text-center whitespace-nowrap pointer-events-none"
          style={{ fontSize: "11px" }}>
          <div className="font-semibold text-primary">Shizugawa Bay (Ocean)</div>
          <div className="text-muted-foreground mt-0.5" style={{ fontSize: "9px" }}>Click → 3D Ocean Playback</div>
        </div>
      )}

      {/* Back button when zoomed into a river */}
      {selectedRiver && (
        <button
          onClick={() => onSelectRiver(null)}
          className="absolute top-2 left-2 bg-white/90 border border-border rounded px-2 py-1 text-[10px] text-muted-foreground shadow-sm hover:bg-white"
        >
          ← Back to full map
        </button>
      )}
    </div>
  );
}
