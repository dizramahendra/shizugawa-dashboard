import { useEffect, useMemo, useState } from "react";
import { RIVER_PATHS, SUB_BASIN_PATHS, OCEAN_BASIN_PATH } from "@/lib/svgPaths";
import { generateRiverData, generateWeekData, BAY_MASK, GRID_W, GRID_D, RIVER_COLS, RIVER_ROWS, VARIABLE_OPTIONS } from "@/lib/simulatedData";

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
  const [showGrid, setShowGrid] = useState(false);
  const [vb, setVb] = useState({ x: 0, y: 0, w: SVG_W, h: SVG_H });

  useEffect(() => {
    if (!selectedRiver) { setVb({ x: 0, y: 0, w: SVG_W, h: SVG_H }); setShowGrid(false); }
    else setVb(computeRiverSvgBounds(selectedRiver));
  }, [selectedRiver]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onSelectRiver(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onSelectRiver]);

  const stops = COLOR_STOPS[variableId] ?? COLOR_STOPS.nitrogen;
  const oceanColor = interpolateColor(stops, Math.max(0, Math.min(1, computeOceanMean(week))));
  const variableLabel = VARIABLE_OPTIONS.find(v => v.id === variableId)?.label ?? variableId;

  // Single solid color per reach — averaged across all rows at that reach's column position
  const reachColors = useMemo(() => {
    const out: Record<number, string> = {};
    for (const idStr of Object.keys(RIVER_PATHS)) {
      const id = Number(idStr);
      const modelRiver = MODEL_RIVER[id] ?? "shizugawa";
      const grid = generateRiverData(week, modelRiver);
      const positionFrac = REACH_POSITION[id] ?? 0.5;
      const col = Math.min(RIVER_COLS - 1, Math.round(positionFrac * (RIVER_COLS - 1)));
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

        {/* Ocean polygon — exact Shizugawa Bay (Ocean Basin) shape from SVG */}
        <path
          d={OCEAN_BASIN_PATH}
          fill={`${oceanColor}55`}
          stroke={oceanColor}
          strokeWidth={hoveredOcean ? 2.5 : 1.5}
          strokeOpacity={0.8}
          style={{ pointerEvents: "all", cursor: "pointer" }}
          onMouseEnter={() => setHoveredOcean(true)}
          onMouseLeave={() => setHoveredOcean(false)}
          onClick={onSelectOcean}
        />

        {/* Rivers: single solid color per reach */}
        {Object.entries(RIVER_PATHS).map(([idStr, d]) => {
          const id = Number(idStr);
          const isSelected = selectedRiver === MODEL_RIVER[id];
          const isHovered = hoveredRiver === id;
          const isMainStem = MAIN_STEMS.has(id);
          const sw = isMainStem
            ? (isSelected || isHovered ? 6 : 4)
            : (isSelected || isHovered ? 4 : 2.5);
          const samples = REACH_SAMPLES[id];
          const color = reachColors[id] ?? "#60a5fa";

          return (
            <g key={id}>
              {/* Glow halo when hovered/selected */}
              {(isSelected || isHovered) && (
                <polyline
                  points={samples.map(p => `${p[0]},${p[1]}`).join(" ")}
                  fill="none"
                  stroke={color}
                  strokeWidth={sw + 10}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.22}
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
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white/90 backdrop-blur-sm border border-border rounded-md px-3 py-1.5 shadow-sm pointer-events-none whitespace-nowrap">
            <span className="text-[9px] text-muted-foreground font-medium">{variableLabel}</span>
            <span className="text-[9px] text-slate-500 font-mono">{minVal}</span>
            <div
              className="w-24 h-2.5 rounded-sm border border-border/20"
              style={{ background: `linear-gradient(to right, ${stops.join(", ")})` }}
            />
            <span className="text-[9px] text-slate-500 font-mono">{maxVal} {unit}</span>
          </div>
        );
      })()}

      {/* Controls when zoomed into a river */}
      {selectedRiver && (
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
    </div>
  );
}
