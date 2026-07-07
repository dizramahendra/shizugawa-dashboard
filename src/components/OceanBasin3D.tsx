import { useMemo, useState, useRef, useEffect, useLayoutEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html, Edges } from "@react-three/drei";
import * as THREE from "three";
import {
  BAY_MASK,
  RIVER_CELLS,
  RIVER_META,
  GRID_W,
  GRID_D,
  GRID_SUBDIV,
  DEPTH_LAYERS,
  DEPTH_HEIGHTS,
  DEPTH_TOPS,
  DEPTH_REAL_M,
  DEPTH_REAL_BOT,
  DEPTH_TOTAL_H,
  generateWeekData,
  generateRiverData,
  RIVER_COLS,
  RIVER_ROWS,
  DashboardState,
} from "@/lib/simulatedData";
import { depthLabel } from "@/lib/depthLabels";
import { getLandMask, isOpenSea, LAND_RING } from "@/lib/landMask";
import { ISLAND_CELLS, isIsland, islandApronFactor } from "@/lib/islands";
import { buildTerrainField, type TerrainField, LAND_MAX_H } from "@/lib/terrainField";

// ── Scene layout constants ────────────────────────────────────────────────────
const STEP   = 0.5 / GRID_SUBDIV; // scene units per grid cell — divides by the resolution factor so the 112×96 (×GRID_SUBDIV) grid keeps the SAME physical bay size (finer voxels at 2×)
const CELL_W = STEP;   // fill every cell completely — zero gap between voxels

const offsetX = -(GRID_W * STEP) / 2;  // centre the grid
const offsetZ = -(GRID_D * STEP) / 2;

// Aspect correction. The SVG trace normalises X by 465 and Z by 586, but the
// grid is 112×96 with a UNIFORM step, so the rendered bay comes out ~1.43× too
// wide E–W vs the real bay (which the Map Viewport draws correctly). Compress X
// so the 3D footprint matches the real bay's E–W:N–S ratio
// (14.06 km : 17.21 km ≈ 0.817) — the same proportions as the map. Applied as a
// scene-group X-scale: geometry corrects together; the drei <Html> labels keep
// their (compressed) anchor without squishing; picking is instanceId-based so
// click-to-inspect is unaffected.
const ASPECT_X = 0.70; // ≈ 0.8169 (real ratio) ÷ 1.1667 (112:96 grid ratio)

const Y_SURFACE = 1.2; // y-coord of the top surface face

// Bounding box
const BOX_PAD_X     = 0.8;
const BOX_PAD_Z     = 0.8;
const BOX_PAD_Y_TOP = 0.2;
const BOX_PAD_Y_BOT = 0.2;
const BOX_W   = GRID_W * STEP + BOX_PAD_X * 2;
const BOX_D   = GRID_D * STEP + BOX_PAD_Z * 2;
const BOX_TOP = Y_SURFACE + BOX_PAD_Y_TOP;
const BOX_BOT = Y_SURFACE - DEPTH_TOTAL_H - BOX_PAD_Y_BOT;
// Max thickness of visible soil beneath each cell's deepest water voxel.
// Keeps the seabed as a thin "floor skin" rather than a massive geological block,
// so the ocean water column is the dominant visual mass of the model.
const SOIL_VIS_DEPTH = 1.0;
const BOX_H   = BOX_TOP - BOX_BOT;
const BOX_CY  = (BOX_TOP + BOX_BOT) / 2;

// GIS bounds
const BAY_LON_W = 141.383;
const BAY_LON_E = 141.468;
const BAY_LAT_S = 38.582;
const BAY_LAT_N = 38.651;

// Derived box-edge positions
const BOX_HALF_W    = BOX_W / 2;
const BOX_HALF_D    = BOX_D / 2;
const BOX_SOUTH_Z   = -BOX_HALF_D;
const BOX_NORTH_Z   =  BOX_HALF_D;
const BOX_WEST_X    = -BOX_HALF_W;
const BOX_EAST_X    =  BOX_HALF_W;
const DEPTH_LABEL_X = BOX_WEST_X - 0.9;

// ── Vertical-slice direction helpers ─────────────────────────────────────────
type SliceDir = "north" | "south" | "east" | "west";

/** Returns true if the voxel at (gx, gz) should be visible for the given directional cut. */
function isInSliceV(gx: number, gz: number, dir: SliceDir, level: number): boolean {
  if (dir === "north") return gz <= level;   // keep south side (remove north of cut)
  if (dir === "south") return gz >= level;   // keep north side (remove south of cut)
  if (dir === "east")  return gx <= level;   // keep west side  (remove east  of cut)
  if (dir === "west")  return gx >= level;   // keep east side  (remove west  of cut)
  return true;
}

/** Returns the scene axis driven by this slice direction. */
function sliceDirAxis(dir: SliceDir): "x" | "z" {
  return (dir === "east" || dir === "west") ? "x" : "z";
}

type SliceCutType = "one-side" | "both-sides";

/**
 * Returns true if the voxel at (gx, gz) should survive the active vertical slice.
 * one-side  → half-volume  (keep everything on the viewer side of the cut plane)
 * both-sides → thin slab   (keep only the single row/column at the cut position)
 */
function isVoxelVisible(gx: number, gz: number, dir: SliceDir, level: number, cutType: SliceCutType): boolean {
  if (cutType === "both-sides") {
    return sliceDirAxis(dir) === "x" ? gx === level : gz === level;
  }
  return isInSliceV(gx, gz, dir, level);
}

// ── Color scales (hex) ────────────────────────────────────────────────────────
// Both nitrogen and phosphorus use the same blue → cream → red ramp so the
// nutrient concentration story reads identically across variables and matches
// the client's Delft3D reference (low = deep blue offshore, high = deep red
// at coast / river mouths). Flow keeps its own purple ramp.
const NUTRIENT_RAMP = [
  "#2c5f8a","#3d6fa0","#6a9fc0","#90c4de","#c5dfe8",
  "#f5f0d8","#f0d090","#e8a030","#d45820","#c8401c",
];
const COLOR_SCALES: Record<string, string[]> = {
  nitrogen:   NUTRIENT_RAMP,
  phosphorus: NUTRIENT_RAMP,
  flow:       ["#0f0527","#1f0a4e","#3a0f7a","#5a1eb0","#7c3ad8","#9d61e8","#bb8ef2","#d4b6f7","#e9d7fb","#f7f0fe"],
  all:        ["#45007e","#2060a0","#168c8c","#35b870","#aadb30","#fce820"],
};

// Physical value ranges for tooltip display (normalized 0-1 → physical unit)
const PHYS: Record<string, { min: number; max: number; unit: string; dec: number }> = {
  nitrogen:   { min: 20,   max: 300,  unit: "kg",   dec: 0 },
  phosphorus: { min: 1,    max: 13,   unit: "kg",   dec: 1 },
  flow:       { min: 0,    max: 100,  unit: "cm/s", dec: 1 },
};

function toPhysical(val: number, scale: string): string {
  const p = PHYS[scale] ?? PHYS.nitrogen;
  const phys = p.min + val * (p.max - p.min);
  return `${phys.toFixed(p.dec)} ${p.unit}`;
}

// Hex→RGB with a module-level cache: lerpColor runs in the per-voxel hot loop
// (~tens of thousands of calls per rebuild) and now reads two stops per call,
// so memoising the parse keeps it O(1) after warmup.
const _rgbCache = new Map<string, [number, number, number]>();
function hexToRgb(hex: string): [number, number, number] {
  let c = _rgbCache.get(hex);
  if (!c) {
    c = [
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255,
    ];
    _rgbCache.set(hex, c);
  }
  return c;
}

// Continuous interpolation across the ramp: map t∈[0,1] onto the stop array and
// blend between the two adjacent stops, so the concentration field reads as a
// smooth gradient instead of 10 hard-edged colour bands. (The legend can still
// show discrete classes — this only affects the rendered field.)
function lerpColor(stops: string[], t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const a = hexToRgb(stops[i]);
  const f = x - i;
  if (f === 0 || i >= stops.length - 1) return [a[0], a[1], a[2]];
  const b = hexToRgb(stops[i + 1]);
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ];
}

// ── Islands: water gate ───────────────────────────────────────────────────────
// A cell inside an island footprint is LAND, not bay water — it is excluded from
// every water path (voxels, seabed solid, cut-face plane, coastal-land freeboard)
// so the ocean hole becomes a mound (see IslandMesh).
function isBayWater(gx: number, gz: number): boolean {
  return !!BAY_MASK[gz]?.[gx] && !isIsland(gx, gz);
}

// ── Unified seabed — ONE distance-to-LAND field over bay + open sea ────────────
// Shizugawa is a ria bay: shallow at the enclosed head, deepening toward the
// mouth and CONTINUING to deepen into the open Pacific. So the seabed is a SINGLE
// continuous surface across the bay AND the open sea, and it meets the
// surrounding land at ~sea level on every side — one continuous solid ground.
//
// The old model measured distance-to-SHORE within the bay only, and counted the
// OPEN SEA itself as "shore" — so the bay MOUTH came out shallow while the sea
// beside it was deep, i.e. a cliff at the boundary. Now depth is driven by
// distance to the nearest LAND over bay + open-sea water TOGETHER (8-connected
// BFS seeded from every land/island cell of the extended grid, propagated
// through all water). Therefore:
//   • every coastline (bay shore, island, open Pacific coast) starts shallow →
//     the land meets the water as a beach, not a wall;
//   • the bay HEAD (ringed by land) is shallow, the MOUTH (far from land) deep;
//   • the open sea keeps deepening seaward (farther from land) with NO step at
//     the bay↔sea boundary — it is literally the same field, the same surface.
// The distance is mapped piecewise-continuously to metres: shallow → MAX_DEPTH_M
// (54 m) across the bay's distance range, then 54 → OPEN_SEA_MAX_DEPTH_M (80 m)
// across the farther-offshore range (both segments meet at 54 m, so the seabed
// never steps). The voxel column reaches 90 m, so SolidTerrain still fills a
// visible seabed from the floor to BOX_BOT. Built lazily (needs the land mask).
export const MAX_DEPTH_M = 54;             // Shizugawa Bay real max ≈ 54 m (bay floor)
const MIN_COAST_DEPTH_M = 1.5;             // seabed just below the waterline at every shore
const OPEN_SEA_MAX_DEPTH_M = 80;           // open Pacific floor offshore — deeper than the bay
const BAY_DEPTH_POW = 1.5;                 // gentle, wide shallows across the bay's range
const SEA_DEPTH_POW = 1.0;                 // steady deepening offshore

let _landDist: {
  arr: Float32Array; ring: number; w: number; h: number; bayMax: number; globMax: number;
} | null = null;
function getLandDistField() {
  if (_landDist) return _landDist;
  const ring = getLandMask().ring;
  const w = GRID_W + ring * 2;
  const h = GRID_D + ring * 2;
  const arr = new Float32Array(w * h).fill(Infinity);
  const at = (gx: number, gz: number) => (gz + ring) * w + (gx + ring);
  const isWater = (gx: number, gz: number) => isBayWater(gx, gz) || isOpenSea(gx, gz);
  const q: number[] = [];
  // Seed every NON-water cell (land / island) of the extended grid as shore = 0.
  for (let gz = -ring; gz < GRID_D + ring; gz++) {
    for (let gx = -ring; gx < GRID_W + ring; gx++) {
      if (!isWater(gx, gz)) { arr[at(gx, gz)] = 0; q.push(at(gx, gz)); }
    }
  }
  let head = 0;
  while (head < q.length) {
    const i = q[head++];
    const lx = i % w, lz = (i - lx) / w;
    const gx = lx - ring, gz = lz - ring;
    const base = arr[i];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = gx + dx, nz = gz + dz;
        if (nx < -ring || nx >= GRID_W + ring || nz < -ring || nz >= GRID_D + ring) continue;
        if (!isWater(nx, nz)) continue; // only propagate INTO water
        const step = dx !== 0 && dz !== 0 ? Math.SQRT2 : 1;
        const ni = at(nx, nz);
        if (base + step < arr[ni]) { arr[ni] = base + step; q.push(ni); }
      }
    }
  }
  // Distance ranges: the bay's max (end of the 0→54 m segment) and the global max
  // (deepest offshore → 80 m).
  let bayMax = 0, globMax = 0;
  for (let gz = -ring; gz < GRID_D + ring; gz++) {
    for (let gx = -ring; gx < GRID_W + ring; gx++) {
      const v = arr[at(gx, gz)];
      if (!Number.isFinite(v)) continue;
      if (v > globMax) globMax = v;
      if (isBayWater(gx, gz) && v > bayMax) bayMax = v;
    }
  }
  bayMax = bayMax || 1;
  _landDist = { arr, ring, w, h, bayMax, globMax: Math.max(globMax, bayMax + 1) };
  return _landDist;
}

// Distance (cells) to the nearest land at a water cell; deep-end fallback elsewhere.
function landDistCells(gx: number, gz: number): number {
  const f = getLandDistField();
  const lx = gx + f.ring, lz = gz + f.ring;
  if (lx < 0 || lx >= f.w || lz < 0 || lz >= f.h) return f.globMax;
  const v = f.arr[lz * f.w + lx];
  return Number.isFinite(v) ? v : f.globMax;
}

// Continuous seabed depth (m) at ANY water cell — bay or open sea — from the one
// land-distance field. Piecewise but continuous at the bay/sea seam (both
// segments meet at MAX_DEPTH_M), so the seabed never steps.
function unifiedDepthM(gx: number, gz: number): number {
  const f = getLandDistField();
  const D = landDistCells(gx, gz);
  if (D <= f.bayMax) {
    const t = Math.pow(Math.max(0, Math.min(1, D / f.bayMax)), BAY_DEPTH_POW);
    return MIN_COAST_DEPTH_M + (MAX_DEPTH_M - MIN_COAST_DEPTH_M) * t;
  }
  const t = Math.pow(Math.max(0, Math.min(1, (D - f.bayMax) / (f.globMax - f.bayMax))), SEA_DEPTH_POW);
  return MAX_DEPTH_M + (OPEN_SEA_MAX_DEPTH_M - MAX_DEPTH_M) * t;
}

// Bay bathymetry (name kept for the voxel path) = the unified seabed depth.
function getBathymetryDepthM(gx: number, gz: number): number {
  return unifiedDepthM(gx, gz);
}

// Effective seabed depth for a WATER cell. Depth is already coast-relative
// (shallow at every shoreline, including beside islands, because island cells
// are shore sources in the BFS above), so the seafloor already slopes up to the
// waterline with no cliff. The island apron is retained as a gentle extra
// shallowing right against each island so the mound's underwater skirt reads
// cleanly; away from islands the factor is 1 (open-bay depth unchanged).
function effectiveSeabedM(gx: number, gz: number): number {
  return getBathymetryDepthM(gx, gz) * islandApronFactor(gx, gz);
}

// Returns the index of the deepest depth layer whose TOP is above the seabed.
// Returns -1 if even layer 0 is below the seabed (shouldn't happen for valid cells).
function deepestVisibleLayer(seabedM: number): number {
  let last = -1;
  for (let d = 0; d < DEPTH_LAYERS; d++) {
    if (DEPTH_REAL_M[d] < seabedM) last = d;
    else break;
  }
  return last;
}

// ── Shore-distance map ────────────────────────────────────────────────────────
// Chebyshev distance from each active cell to the nearest non-active neighbour
// (or grid boundary).  dist=1 → directly adjacent to land → render 1 layer.
// Computed once at module load (112×96 grid).
const SHORE_DIST: Map<string, number> = (() => {
  const map = new Map<string, number>();
  for (let gz = 0; gz < GRID_D; gz++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      if (!isBayWater(gx, gz)) continue;
      let found = false;
      for (let r = 1; r <= DEPTH_LAYERS && !found; r++) {
        for (let dz = -r; dz <= r && !found; dz++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // ring only
            const nz = gz + dz, nx = gx + dx;
            // Island cells are shore too, so water beside an island reads shallow.
            if (nz < 0 || nz >= GRID_D || nx < 0 || nx >= GRID_W || !isBayWater(nx, nz)) {
              map.set(`${gz}-${gx}`, r);
              found = true;
            }
          }
        }
      }
      if (!found) map.set(`${gz}-${gx}`, DEPTH_LAYERS); // deep interior
    }
  }
  return map;
})();

// ── Ground-elevation helpers (feed the unified SolidTerrain heightfield) ───────
// Scene-Y of the BOTTOM of the deepest visible water voxel at a bay cell — i.e.
// the seabed the nutrient voxels sit ON. This is exactly the value buildBatches
// uses for that column's deepest voxel bottom AND the value the old SeabedMesh
// used for its (unclipped) top, so the terrain top == voxel bottom with no gap.
function bayColumnBottomY(gx: number, gz: number): number | null {
  if (!isBayWater(gx, gz)) return null;
  const maxLayer = deepestVisibleLayer(effectiveSeabedM(gx, gz));
  if (maxLayer < 0) return null;
  return Y_SURFACE - DEPTH_TOPS[maxLayer] - DEPTH_HEIGHTS[maxLayer];
}

// Map a real bathymetric depth (metres) to a scene-Y BELOW the surface by
// linearly interpolating through the same layer table the voxels use, so the
// open-sea floor is continuous with the bay's quantised seabed at the boundary
// (a metre depth landing on a layer bottom yields that layer's scene bottom).
function bathyDepthToSceneY(depthM: number): number {
  const dmax = DEPTH_REAL_BOT[DEPTH_LAYERS - 1];
  const dm = Math.max(0, Math.min(dmax, depthM));
  // Find the layer whose [topM, botM] contains dm and lerp within its scene span.
  for (let d = 0; d < DEPTH_LAYERS; d++) {
    const topM = DEPTH_REAL_M[d];
    const botM = DEPTH_REAL_BOT[d];
    if (dm <= botM || d === DEPTH_LAYERS - 1) {
      const span = botM - topM || 1;
      const f = Math.max(0, Math.min(1, (dm - topM) / span));
      const topY = Y_SURFACE - DEPTH_TOPS[d];
      return topY - DEPTH_HEIGHTS[d] * f;
    }
  }
  return Y_SURFACE - DEPTH_TOTAL_H;
}

// ── Open Pacific floor = the SAME unified seabed (continuous with the bay) ─────
// Open-sea cells read the identical unified depth field (unifiedDepthM), so the
// Pacific floor and the bay seabed are ONE surface — no seam, no cliff — and it
// keeps deepening seaward (distance-to-land grows) to OPEN_SEA_MAX_DEPTH_M far
// offshore. SolidTerrain fills a visible seabed from this floor down to BOX_BOT,
// so the open sea sits on real ground.
const OPEN_SEA_DEEP_Y = bathyDepthToSceneY(OPEN_SEA_MAX_DEPTH_M); // deepest floor (colour ramp)
function openSeaSeabedY(gx: number, gz: number): number {
  return bathyDepthToSceneY(unifiedDepthM(gx, gz));
}

// Per-cell island peakT lookup (0 shore → 1 peak), or null if not an island cell.
const ISLAND_PEAK_BY_CELL: Map<string, number> = (() => {
  const m = new Map<string, number>();
  for (const c of ISLAND_CELLS) m.set(`${c.gz},${c.gx}`, c.peakT);
  return m;
})();
function islandPeakT(gx: number, gz: number): number | null {
  const v = ISLAND_PEAK_BY_CELL.get(`${gz},${gx}`);
  return v === undefined ? null : v;
}

// Unified ground-elevation field E(gx,gz), built once (needs the DOM land mask).
let _terrainField: TerrainField | null = null;
function getTerrainField(): TerrainField {
  if (_terrainField) return _terrainField;
  _terrainField = buildTerrainField({
    Y_SURFACE,
    isBayWater,
    isIsland,
    islandPeakT,
    bayColumnBottomY,
    openSeaSeabedY,
  });
  return _terrainField;
}

// ── Hover tooltip ─────────────────────────────────────────────────────────────
interface HoveredVoxel {
  px: number; py: number; pz: number;
  val: number;
  depth: number;
}

// ── Shared voxel-grid props ───────────────────────────────────────────────────
interface VoxelGridProps {
  week: number;
  colorScale: string;
  selectedPoint: { x: number; z: number; y?: number } | null;
  sliceMode: DashboardState;
  sliceLevel: number;
  sliceDir: SliceDir;
  sliceCutType: SliceCutType;
  onCellClick: (x: number, z: number, y: number) => void;
  onCellHover?: (x: number, z: number) => void;
}

// ── Instanced VoxelGrid (GPU-efficient) ──────────────────────────────────────
// Groups all voxels in the same depth layer into one THREE.InstancedMesh.
// Result: 8 GPU draw calls total instead of one per voxel — far smoother orbit.

interface LayerBatch {
  count:     number;
  positions: number[];   // [x,y,z, x,y,z, …]  count×3
  rgbs:      number[];   // [r,g,b, r,g,b, …]   count×3
  meta:      InstanceMeta[];
}

interface InstanceMeta {
  gx: number; gz: number;
  val: number;
  px: number; py: number; pz: number;
}

function buildBatches(
  data: ReturnType<typeof generateWeekData>,
  stops: string[],
  sliceMode: DashboardState,
  sliceLevel: number,
  sliceDir: SliceDir,
  sliceCutType: SliceCutType,
  markerPixels?: Map<string, [number, number, number]>,
): LayerBatch[] {
  const visibleDepths = sliceMode === "slice-h"
    ? Array.from({ length: DEPTH_LAYERS - sliceLevel }, (_, i) => sliceLevel + i)
    : Array.from({ length: DEPTH_LAYERS }, (_, i) => i);

  const batches: LayerBatch[] = Array.from({ length: DEPTH_LAYERS }, () => ({
    count: 0,
    positions: [],
    rgbs: [],
    meta: [],
  }));

  for (let gz = 0; gz < GRID_D; gz++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      if (!isBayWater(gx, gz)) continue;         // islands are land, not water
      const seabedM  = effectiveSeabedM(gx, gz); // shallowed by island apron
      const maxLayer = deepestVisibleLayer(seabedM);
      if (maxLayer < 0) continue;

      for (const d of visibleDepths) {
        if (d > maxLayer) continue;
        if (sliceMode === "slice-v" && !isVoxelVisible(gx, gz, sliceDir, sliceLevel, sliceCutType)) continue;

        const val = data[gz]?.[gx]?.[d] ?? 0;
        // Selection highlight is applied imperatively per-frame in
        // InstancedDepthLayer, so clicking a voxel never rebuilds this
        // geometry — batches depend only on data / slice / markers.
        const markerColor = markerPixels?.get(`${gx}:${gz}`);
        const [r, g, b] = markerColor && d === 0
          ? markerColor
          : lerpColor(stops, val);

        const px = offsetX + gx * STEP + CELL_W / 2;
        const py = Y_SURFACE - DEPTH_TOPS[d] - DEPTH_HEIGHTS[d] / 2;
        const pz = offsetZ + gz * STEP + CELL_W / 2;

        batches[d].positions.push(px, py, pz);
        batches[d].rgbs.push(r, g, b);
        batches[d].meta.push({ gx, gz, val, px, py, pz });
        batches[d].count++;
      }
    }
  }
  return batches;
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// Smoothly cross-fades voxel colours between the previous and current week
// instead of snapping instantly, so weekly playback reads as continuous
// motion. Positions/geometry never animate — only the per-instance colour —
// so this stays cheap (a per-frame loop over this layer's instance count,
// skipped entirely once a transition settles).
function InstancedDepthLayer({
  depthIdx, toBatch, fromBatchesRef, toBatchesRef, progressRef, selectedPoint, onCellClick, onCellHover, onHover,
}: {
  depthIdx: number;
  toBatch:  LayerBatch;
  fromBatchesRef: React.MutableRefObject<LayerBatch[]>;
  toBatchesRef:   React.MutableRefObject<LayerBatch[]>;
  progressRef:    React.MutableRefObject<number>;
  selectedPoint:  { x: number; z: number; y?: number } | null;
  onCellClick:  (x: number, z: number, y: number) => void;
  onCellHover?: (x: number, z: number) => void;
  onHover: (h: HoveredVoxel | null) => void;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { positions, count } = toBatch;
  const lastToRef = useRef<LayerBatch | null>(null);
  const lastAppliedRef = useRef(1);
  const seededRef = useRef(false);
  const lastSelKeyRef = useRef<string | null>(null);

  // Stable key for the current selection so the per-frame loop can tell when it
  // changed (and re-apply) without diffing objects.
  const selKey = selectedPoint
    ? `${selectedPoint.x}:${selectedPoint.z}:${selectedPoint.y ?? "col"}`
    : "";

  // useLayoutEffect fires synchronously before the first Three.js frame.
  // This guarantees instance matrices are in their correct positions before
  // Three.js computes & caches the bounding sphere for raycasting — fixing a
  // bug where clicks on voxels were silently missed on initial mount because
  // the bounding sphere was cached from identity matrices (all at origin).
  // Colour is intentionally NOT set here — useFrame owns colour so the
  // cross-fade below has full control from the first animated frame.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || count === 0) return;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      m4.setPosition(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    // Recompute bounding sphere from actual instance positions so raycasting works.
    mesh.computeBoundingSphere();

    // Seed instance colours on first mount ONLY, so the first painted frame in
    // demand mode isn't blank white before useFrame runs. This must not repeat:
    // `positions` gets a fresh array ref every week, so re-seeding here each time
    // would snap colours to the new week and clobber the cross-fade useFrame owns.
    if (!seededRef.current) {
      const col = new THREE.Color();
      for (let i = 0; i < count; i++) {
        col.setRGB(toBatch.rgbs[i * 3], toBatch.rgbs[i * 3 + 1], toBatch.rgbs[i * 3 + 2]);
        mesh.setColorAt(i, col);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      seededRef.current = true;
    }
  }, [positions, count]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh || count === 0) return;
    const to = toBatchesRef.current[depthIdx];
    if (!to || to.count === 0) return;

    const progress = progressRef.current;
    const settled  = progress >= 1;
    const toChanged = lastToRef.current !== to;
    const selChanged = lastSelKeyRef.current !== selKey;
    if (settled && !toChanged && !selChanged && lastAppliedRef.current >= 1) return; // nothing changed — skip work

    const from = fromBatchesRef.current[depthIdx];
    const useFrom = !settled && !!from && from.count === to.count;
    const t = settled ? 1 : easeInOutQuad(progress);
    const col = new THREE.Color();
    for (let i = 0; i < to.count; i++) {
      let r = to.rgbs[i * 3], g = to.rgbs[i * 3 + 1], b = to.rgbs[i * 3 + 2];
      if (useFrom) {
        r = from!.rgbs[i * 3]     + (r - from!.rgbs[i * 3])     * t;
        g = from!.rgbs[i * 3 + 1] + (g - from!.rgbs[i * 3 + 1]) * t;
        b = from!.rgbs[i * 3 + 2] + (b - from!.rgbs[i * 3 + 2]) * t;
      }
      // Imperative selection highlight, overlaid on the data colour: a single
      // voxel (y given) or the whole column (y undefined) glows yellow. Applied
      // here instead of baked into the batch, so selecting rebuilds no geometry.
      if (selectedPoint) {
        const m = to.meta[i];
        if (m.gx === selectedPoint.x && m.gz === selectedPoint.z &&
            (selectedPoint.y === undefined || selectedPoint.y === depthIdx)) {
          r = 1; g = 0.9; b = 0.2;
        }
      }
      col.setRGB(r, g, b);
      mesh.setColorAt(i, col);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    lastToRef.current = to;
    lastAppliedRef.current = settled ? 1 : progress;
    lastSelKeyRef.current = selKey;
  });

  if (count === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, count]}
      frustumCulled={false}
      onClick={(e) => {
        e.stopPropagation();
        const iid = e.instanceId;
        if (iid == null) return;
        const { gx, gz } = toBatch.meta[iid];
        onCellClick(gx, gz, depthIdx);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        const iid = e.instanceId;
        if (iid == null) return;
        const { gx, gz, val, px, py, pz } = toBatch.meta[iid];
        onCellHover?.(gx, gz);
        onHover({ px, py, pz, val, depth: depthIdx });
      }}
      onPointerOut={() => onHover(null)}
    >
      <boxGeometry args={[CELL_W, DEPTH_HEIGHTS[depthIdx], CELL_W]} />
      {/* Opaque: renders through the depth buffer, so instances within a layer
          no longer blend in the wrong order (fixes the orbit flicker), and each
          voxel shows its true concentration colour without false blending. */}
      <meshStandardMaterial roughness={0.7} metalness={0.05} />
    </instancedMesh>
  );
}

function VoxelGridInstanced({
  week, colorScale, selectedPoint, sliceMode, sliceLevel, sliceDir, sliceCutType, onCellClick, onCellHover, markerPixels, transitionMs = 650,
}: VoxelGridProps & { markerPixels?: Map<string, [number, number, number]>; transitionMs?: number }) {
  const data  = useMemo(() => generateWeekData(week), [week]);
  const stops = COLOR_SCALES[colorScale] ?? COLOR_SCALES.nitrogen;

  const batches = useMemo(
    () => buildBatches(data, stops, sliceMode, sliceLevel, sliceDir, sliceCutType, markerPixels),
    [data, stops, sliceMode, sliceLevel, sliceDir, sliceCutType, markerPixels],
  );

  // Colour cross-fade state, shared with every depth layer via refs so the
  // per-frame blend runs imperatively (no React re-renders during playback).
  const fromBatchesRef = useRef<LayerBatch[]>(batches);
  const toBatchesRef   = useRef<LayerBatch[]>(batches);
  const progressRef    = useRef(1);
  const prevWeekRef     = useRef(week);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    if (prevWeekRef.current !== week) {
      // The week advanced (or rewound) — cross-fade colours from whatever was
      // last shown into the new week's data.
      fromBatchesRef.current = toBatchesRef.current;
      toBatchesRef.current = batches;
      progressRef.current = 0;
      prevWeekRef.current = week;
    } else {
      // Structural change (slice, colour scale, markers) — snap.
      toBatchesRef.current = batches;
      progressRef.current = 1;
    }
    invalidate(); // render this change under the demand frameloop
  }, [batches, week, invalidate]);

  // Selection changed: batches no longer depend on it, so request a repaint here
  // and the per-frame loop re-applies the imperative highlight (matters when paused).
  useEffect(() => {
    invalidate();
  }, [selectedPoint, invalidate]);

  useFrame((_, delta) => {
    if (progressRef.current < 1) {
      progressRef.current = Math.min(1, progressRef.current + (delta * 1000) / transitionMs);
      invalidate(); // keep requesting frames until the cross-fade settles
    }
  });

  const [hovered, setHovered] = useState<HoveredVoxel | null>(null);

  return (
    <>
      {batches.map((batch, d) => (
        <InstancedDepthLayer
          key={`${d}-${batch.count}`}
          depthIdx={d}
          toBatch={batch}
          fromBatchesRef={fromBatchesRef}
          toBatchesRef={toBatchesRef}
          progressRef={progressRef}
          selectedPoint={selectedPoint}
          onCellClick={onCellClick}
          onCellHover={onCellHover}
          onHover={setHovered}
        />
      ))}

      {hovered && (
        <Html
          position={[hovered.px, hovered.py + 0.15, hovered.pz]}
          zIndexRange={[100, 100]}
          style={{ pointerEvents: "none", transform: "translate(10px, calc(-100% - 6px))" }}
        >
          <div style={{
            background: "rgba(255,255,255,0.93)",
            border: "1px solid #ccc",
            borderRadius: 4,
            padding: "3px 7px",
            fontFamily: "monospace",
            fontSize: 10,
            color: "#222",
            whiteSpace: "nowrap",
            boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
            lineHeight: 1.55,
          }}>
            <div style={{ fontWeight: 600 }}>{toPhysical(hovered.val, colorScale)}</div>
            <div style={{ color: "#666" }}>{depthLabel(hovered.depth)}</div>
          </div>
        </Html>
      )}
    </>
  );
}

// ── Unified solid terrain (one continuous ground heightfield) ─────────────────
// ONE solid ground surface — land → coast → seabed — replacing the old three
// hollow shells (CoastalLandMesh, SeabedMesh, IslandMesh) and the box FLOOR.
// Every ground cell of the extended (LAND_RING) grid is a SOLID column from its
// ground-top elevation E(gx,gz) (see src/lib/terrainField.ts) down to BOX_BOT,
// so a horizontal slice reveals continuous soil (no hollow columns) and a
// vertical slice shows the land→coast→seabed profile as one continuous slope.
//
// Top elevation per cell:
//   • water / open sea (BELOW sea level) — a FLAT top at the seabed the nutrient
//     voxels sit on (water = deepest-voxel bottom, open sea = bathymetry floor),
//     so voxels rest exactly on the ground with no gap/overlap.
//   • land / island (ABOVE sea level) — SMOOTHED corner heights (field.cornerElev)
//     so adjacent columns share vertex heights and the coast slopes gradually.
//
// Walls: on each of the 4 lateral edges, a quad drops from THIS cell's edge-top
// down to the neighbour's edge-top (or BOX_BOT when the neighbour has no solid —
// shoreline into a shorter column, outer ring, or a slice cut face). Adjacent
// above-water cells share corner heights, so their common edge needs no wall
// (continuous surface); a land↔water edge gets a wall = the coastal slope face.
//
// Colour: one soil ramp for the whole ground. ABOVE sea level uses a land grey-
// brown (lighter, greener near the peaks); BELOW sea level uses the seabed sandy-
// tan→muddy-brown gradient. Both darken with depth so the block reads as soil.
//
// Slicing:
//   • slice-h — clip every top at the slice plane Y and render ONLY below-water
//     cells (land/island sit above the surface, so a horizontal cut removes them,
//     matching the old behaviour); the exposed soil cross-section shows below.
//   • slice-v — hide cells on the far side of the cut (isVoxelVisible); the cut
//     face becomes a full wall to BOX_BOT, so the section is solid soil.

// ── Unified soil colour ramp (ONE continuous ground colouring) ────────────────
// A single ramp keyed to ABSOLUTE elevation (world-Y), continuous across sea
// level, so land and seabed read as the SAME continuous ground — no grey↔brown
// seam at the coast. Muted green/khaki on the high land → tan/sand right at the
// shoreline (sea level) → mid sandy-brown → darker muddy brown at depth. The
// stops are placed relative to Y_SURFACE (the waterline) so the transition eases
// smoothly THROUGH the surface, not at a hard boundary.
//
// Stops (elevation offset from Y_SURFACE → colour):
//   +LAND_MAX_H  high land   muted khaki-green
//   +0.35        low hills   khaki
//    0.00        shoreline   warm tan / sand   ← waterline, no seam
//   −0.9         shallows    sandy brown
//   −4.0         mid seabed  mid brown
//   deep floor   deep seabed dark muddy brown
const GROUND_STOPS: Array<{ y: number; c: [number, number, number] }> = [
  { y: Y_SURFACE + LAND_MAX_H, c: [0.60, 0.63, 0.44] }, // muted khaki-green upland
  { y: Y_SURFACE + 0.35,       c: [0.72, 0.69, 0.50] }, // khaki lowland
  { y: Y_SURFACE + 0.02,       c: [0.82, 0.73, 0.55] }, // tan just above the shore
  { y: Y_SURFACE,              c: [0.80, 0.70, 0.52] }, // sand AT the waterline (continuous)
  { y: Y_SURFACE - 0.9,        c: [0.66, 0.54, 0.38] }, // sandy brown shallows
  { y: Y_SURFACE - 4.0,        c: [0.52, 0.42, 0.29] }, // mid brown
  { y: BOX_BOT,                c: [0.34, 0.26, 0.18] }, // dark muddy brown at depth
];

// Interpolate the ground ramp at a world-Y. Stops are ordered high→low; find the
// bracketing pair and lerp. Above the top / below the bottom clamps to the end
// colour, so the whole solid — land peak to box floor — is one smooth gradient.
function groundColor(y: number): [number, number, number] {
  if (y >= GROUND_STOPS[0].y) return GROUND_STOPS[0].c;
  const last = GROUND_STOPS[GROUND_STOPS.length - 1];
  if (y <= last.y) return last.c;
  for (let i = 0; i < GROUND_STOPS.length - 1; i++) {
    const hi = GROUND_STOPS[i], lo = GROUND_STOPS[i + 1];
    if (y <= hi.y && y >= lo.y) {
      const f = (hi.y - y) / (hi.y - lo.y || 1); // 0 at hi → 1 at lo
      return [
        hi.c[0] + (lo.c[0] - hi.c[0]) * f,
        hi.c[1] + (lo.c[1] - hi.c[1]) * f,
        hi.c[2] + (lo.c[2] - hi.c[2]) * f,
      ];
    }
  }
  return last.c;
}

function SolidTerrain({
  sliceMode,
  sliceLevel,
  sliceDir,
  sliceCutType,
}: {
  sliceMode: DashboardState;
  sliceLevel: number;
  sliceDir: SliceDir;
  sliceCutType: SliceCutType;
}) {
  const geometry = useMemo(() => {
    const field = getTerrainField();

    // slice-h clip plane: everything above this Y is hidden (top of the layer).
    const sliceClipY = sliceMode === "slice-h"
      ? Y_SURFACE - DEPTH_TOPS[sliceLevel]
      : Infinity;

    const passesSliceV = (gx: number, gz: number): boolean =>
      sliceMode !== "slice-v" || isVoxelVisible(gx, gz, sliceDir, sliceLevel, sliceCutType);

    // River/gap ("none") cells still get a SOLID plug beneath them, so the ground
    // has no hollow under a river channel (the box floor is gone). Their top sits
    // at the river-bed level (layer-0 bottom), matching RiverSeabedMesh, so the
    // channel stays carved while soil fills from that bed down to BOX_BOT.
    const NONE_TOP_Y = Y_SURFACE - DEPTH_TOPS[0] - DEPTH_HEIGHTS[0];

    const inExt = (gx: number, gz: number): boolean =>
      gx >= field.gxMin && gx < field.gxMax && gz >= field.gzMin && gz < field.gzMax;

    // Is this cell part of the rendered solid under the current slice? Under a
    // HORIZONTAL slice every cell keeps its SOLID column — land, island, seabed
    // and open sea alike — just clipped at the slice plane (cellFlatTop /
    // cornerTopFor). So the cut reveals continuous soil with NO hollow where the
    // surrounding land or the islands were (they used to be dropped entirely,
    // leaving empty columns). A land/island column above the cut is clipped flat
    // to the plane and filled solid from there down to BOX_BOT.
    const isGround = (gx: number, gz: number): boolean => {
      if (!inExt(gx, gz)) return false;               // outside the box → no solid
      return passesSliceV(gx, gz);
    };
    const isAboveWater = (gx: number, gz: number): boolean => {
      const k = field.kind(gx, gz);
      return k === "land" || k === "island";
    };

    // Ground top at a grid CORNER for a given cell: above-water cells use the
    // smoothed shared corner height (continuous slope); below-water cells use
    // their flat cell top so voxels sit flat on them. Clipped at the slice plane.
    const cellFlatTop = (gx: number, gz: number): number => {
      const y = field.kind(gx, gz) === "none" ? NONE_TOP_Y : field.elev(gx, gz);
      return Math.min(y, sliceClipY);
    };
    const cornerTopFor = (
      gx: number, gz: number, cgx: number, cgz: number,
    ): number => {
      if (isAboveWater(gx, gz)) {
        const c = field.cornerElev(cgx, cgz);
        const y = Number.isNaN(c) ? field.elev(gx, gz) : c;
        return Math.min(y, sliceClipY);
      }
      return cellFlatTop(gx, gz);
    };

    // Level the neighbour presents along a shared edge (for wall bottoms). When
    // the neighbour is not ground → BOX_BOT (full wall down to the floor).
    const neighbourEdgeTop = (
      nx: number, nz: number, cgx0: number, cgz0: number, cgx1: number, cgz1: number,
    ): { a: number; b: number } | null => {
      if (!isGround(nx, nz)) return null;
      return {
        a: cornerTopFor(nx, nz, cgx0, cgz0),
        b: cornerTopFor(nx, nz, cgx1, cgz1),
      };
    };

    const positions: number[] = [];
    const colors:    number[] = [];
    const indices:   number[] = [];

    // ONE continuous soil ramp keyed to absolute elevation — land, coast and
    // seabed share the same gradient, so there is no grey↔brown seam at the
    // shore (see groundColor above).
    const addVert = (px: number, py: number, pz: number): number => {
      const [r, g, b] = groundColor(py);
      positions.push(px, py, pz);
      colors.push(r, g, b);
      return (positions.length / 3) - 1;
    };

    for (let gz = field.gzMin; gz < field.gzMax; gz++) {
      for (let gx = field.gxMin; gx < field.gxMax; gx++) {
        if (!isGround(gx, gz)) continue;

        const x0 = offsetX + gx       * STEP;
        const x1 = offsetX + (gx + 1) * STEP;
        const z0 = offsetZ + gz       * STEP;
        const z1 = offsetZ + (gz + 1) * STEP;

        // Corner heights (shared with neighbours for above-water → continuous).
        const y00 = cornerTopFor(gx, gz, gx,     gz);
        const y10 = cornerTopFor(gx, gz, gx + 1, gz);
        const y01 = cornerTopFor(gx, gz, gx,     gz + 1);
        const y11 = cornerTopFor(gx, gz, gx + 1, gz + 1);

        // ── Top face (faces upward) ───────────────────────────────────────────
        const t00 = addVert(x0, y00, z0);
        const t10 = addVert(x1, y10, z0);
        const t01 = addVert(x0, y01, z1);
        const t11 = addVert(x1, y11, z1);
        indices.push(t00, t11, t10,  t00, t01, t11);

        // ── Bottom face (flat at BOX_BOT, faces downward) ─────────────────────
        const b00 = addVert(x0, BOX_BOT, z0);
        const b10 = addVert(x1, BOX_BOT, z0);
        const b01 = addVert(x0, BOX_BOT, z1);
        const b11 = addVert(x1, BOX_BOT, z1);
        indices.push(b00, b10, b11,  b00, b11, b01);

        // ── Side walls: drop from this cell's edge to the neighbour's edge ────
        // (or BOX_BOT when the neighbour is not ground). A wall is emitted only
        // where this cell stands ABOVE the neighbour's level, so two continuous
        // above-water cells (shared corner heights) produce no wall.
        const emitWall = (
          ax: number, az: number, bx: number, bz: number,   // shared edge endpoints (world XZ)
          topA: number, topB: number,                       // this cell's tops at those endpoints
          nEdge: { a: number; b: number } | null,           // neighbour level, or null → BOX_BOT
          flip: boolean,
        ) => {
          const botA = nEdge ? nEdge.a : BOX_BOT;
          const botB = nEdge ? nEdge.b : BOX_BOT;
          // Nothing to fill if the neighbour is level or higher on both ends.
          if (botA >= topA && botB >= topB) return;
          const lowA = Math.min(botA, topA);
          const lowB = Math.min(botB, topB);
          const a = addVert(ax, topA, az);
          const b = addVert(ax, lowA, az);
          const c = addVert(bx, lowB, bz);
          const d = addVert(bx, topB, bz);
          if (flip) indices.push(a, c, b,  a, d, c);
          else      indices.push(a, b, c,  a, c, d);
        };

        // West (-X): edge z0→z1 at x0; neighbour (gx-1,gz)
        emitWall(x0, z0, x0, z1, y00, y01,
          neighbourEdgeTop(gx - 1, gz, gx, gz, gx, gz + 1), false);
        // East (+X): edge z0→z1 at x1; neighbour (gx+1,gz)
        emitWall(x1, z0, x1, z1, y10, y11,
          neighbourEdgeTop(gx + 1, gz, gx + 1, gz, gx + 1, gz + 1), true);
        // North (-Z): edge x0→x1 at z0; neighbour (gx,gz-1)
        emitWall(x0, z0, x1, z0, y00, y10,
          neighbourEdgeTop(gx, gz - 1, gx, gz, gx + 1, gz), true);
        // South (+Z): edge x0→x1 at z1; neighbour (gx,gz+1)
        emitWall(x0, z1, x1, z1, y01, y11,
          neighbourEdgeTop(gx, gz + 1, gx, gz + 1, gx + 1, gz + 1), false);
      }
    }

    if (indices.length === 0) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute("color",    new THREE.BufferAttribute(new Float32Array(colors),    3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [sliceMode, sliceLevel, sliceDir, sliceCutType]);

  if (!geometry) return null;
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        vertexColors
        roughness={0.9}
        metalness={0.03}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
      />
    </mesh>
  );
}

// (CoastalLandMesh + IslandMesh removed — folded into SolidTerrain above.)
// (StudyBoxShell removed — the SolidTerrain's outer-ring land columns already
//  form the model's own solid walls down to BOX_BOT, so the model stands on its
//  own as a box; a separate container shell would not slice with the model.)

// ── Open Pacific (Sanriku) — a static CONTEXT ocean VOLUME ─────────────────────
// East (and the open south) of the bay is open sea, modelled as a WATER VOLUME:
// each open-sea cell is a column from the deep open-sea floor (openSeaSeabedY) up
// to the surface, filling every OPEN cell of the extended (LAND_RING) grid. So a
// slice reveals a tall blue water section (not a shallow brown shelf), and the
// deep floor makes the seaward edge read as real open ocean. This is CONTEXT
// only, deliberately distinct from the interactive Shizugawa Bay data volume:
//   • NOT nutrient-coloured, NOT recoloured by week, NOT animated.
//   • NOT clickable/hoverable (raycast disabled) and NOT in the legend.
//   • A single steel-blue that darkens gently with depth (openSeaColor) so the
//     column reads as water, never the nutrient ramp.
// Walls are emitted only on EXPOSED edges — the grid/coast boundary or a
// neighbour removed by the active slice — so the outer sea faces and any cut face
// are solid water while interior cell borders stay open (few faces, no z-fight).
const OPEN_SEA_SURF_RGB: [number, number, number] = [0.30, 0.47, 0.60]; // surface steel-blue
const OPEN_SEA_DEEP_RGB: [number, number, number] = [0.10, 0.20, 0.30]; // darker at depth
function openSeaColor(y: number): [number, number, number] {
  const span = Y_SURFACE - OPEN_SEA_DEEP_Y || 1;
  const t = Math.max(0, Math.min(1, (Y_SURFACE - y) / span));
  return [
    OPEN_SEA_SURF_RGB[0] + (OPEN_SEA_DEEP_RGB[0] - OPEN_SEA_SURF_RGB[0]) * t,
    OPEN_SEA_SURF_RGB[1] + (OPEN_SEA_DEEP_RGB[1] - OPEN_SEA_SURF_RGB[1]) * t,
    OPEN_SEA_SURF_RGB[2] + (OPEN_SEA_DEEP_RGB[2] - OPEN_SEA_SURF_RGB[2]) * t,
  ];
}

function OpenSeaMesh({
  sliceMode,
  sliceLevel,
  sliceDir,
  sliceCutType,
}: {
  sliceMode: DashboardState;
  sliceLevel: number;
  sliceDir: SliceDir;
  sliceCutType: SliceCutType;
}) {
  const geometry = useMemo(() => {
    const ring = getLandMask().ring;

    // Horizontal slice clips the water top at the layer plane; the column below
    // stays so the sea shows its deep cross-section (matching the bay voxels).
    const sliceClipY = sliceMode === "slice-h"
      ? Y_SURFACE - DEPTH_TOPS[sliceLevel]
      : Y_SURFACE;

    const passesSlice = (gx: number, gz: number): boolean =>
      sliceMode !== "slice-v" || isVoxelVisible(gx, gz, sliceDir, sliceLevel, sliceCutType);
    // Open sea = the cells the east flood reaches (isOpenSea from landMask).
    const rendered = (gx: number, gz: number): boolean =>
      isOpenSea(gx, gz) && passesSlice(gx, gz);

    const positions: number[] = [];
    const colors:    number[] = [];
    const indices:   number[] = [];
    const addVert = (px: number, py: number, pz: number): number => {
      const [r, g, b] = openSeaColor(py);
      positions.push(px, py, pz);
      colors.push(r, g, b);
      return positions.length / 3 - 1;
    };

    for (let gz = -ring; gz < GRID_D + ring; gz++) {
      for (let gx = -ring; gx < GRID_W + ring; gx++) {
        if (!rendered(gx, gz)) continue;
        const topY   = Math.min(Y_SURFACE, sliceClipY);
        const floorY = openSeaSeabedY(gx, gz);
        if (topY <= floorY) continue; // slice plane at/below the floor → no water

        const x0 = offsetX + gx * STEP, x1 = offsetX + (gx + 1) * STEP;
        const z0 = offsetZ + gz * STEP, z1 = offsetZ + (gz + 1) * STEP;

        // Top (surface / slice plane).
        const t00 = addVert(x0, topY, z0);
        const t10 = addVert(x1, topY, z0);
        const t01 = addVert(x0, topY, z1);
        const t11 = addVert(x1, topY, z1);
        indices.push(t00, t11, t10, t00, t01, t11);

        // Exposed side walls: drop to this cell's floor where the neighbour is
        // not rendered open sea (boundary / coast / sliced-away).
        const wall = (ax: number, az: number, bx: number, bz: number, flip: boolean) => {
          const a = addVert(ax, topY,   az);
          const b = addVert(ax, floorY, az);
          const c = addVert(bx, floorY, bz);
          const d = addVert(bx, topY,   bz);
          if (flip) indices.push(a, c, b, a, d, c);
          else      indices.push(a, b, c, a, c, d);
        };
        if (!rendered(gx - 1, gz)) wall(x0, z0, x0, z1, false); // west
        if (!rendered(gx + 1, gz)) wall(x1, z0, x1, z1, true);  // east
        if (!rendered(gx, gz - 1)) wall(x0, z0, x1, z0, true);  // north
        if (!rendered(gx, gz + 1)) wall(x0, z1, x1, z1, false); // south
      }
    }

    if (indices.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute("color",    new THREE.BufferAttribute(new Float32Array(colors),    3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [sliceMode, sliceLevel, sliceDir, sliceCutType]);

  if (!geometry) return null;
  return (
    // raycast disabled → never clickable/hoverable. Opaque, depth-darkened water.
    <mesh geometry={geometry} raycast={() => null}>
      <meshStandardMaterial
        vertexColors
        roughness={0.5}
        metalness={0.08}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// ── River seabed solid ────────────────────────────────────────────────────────
// Volumetric soil/rock beneath every river cell:
//   • Delta cells (numLayers > 1, at or near the bay mouth): solid goes all the
//     way to BOX_BOT, joining seamlessly with the ocean seabed at the transition.
//   • Upstream single-layer cells: solid is one depth-layer thick, giving the
//     narrow channel a visible floor without plunging to the ocean floor.
// Side walls are drawn only on boundary edges (no adjacent river cell, or the
// neighbour is excluded by the active slice).
function RiverSeabedMesh({
  sliceMode,
  sliceLevel,
  sliceDir,
  sliceCutType,
}: {
  sliceMode: DashboardState;
  sliceLevel: number;
  sliceDir: SliceDir;
  sliceCutType: SliceCutType;
}) {
  const geometry = useMemo(() => {
    // River water only exists at layer 0; nothing to draw for deeper horizontal
    // slices. Return null (mesh not rendered) rather than an EMPTY geometry —
    // an empty position buffer makes three's auto bounding-sphere NaN, which
    // logs "computeBoundingSphere: radius is NaN" errors on every such frame.
    if (sliceMode === "slice-h" && sliceLevel > 0) {
      return null;
    }

    // In slice-h mode, clip seabed tops above this Y (top boundary of the selected layer)
    const sliceClipY = sliceMode === "slice-h"
      ? Y_SURFACE - DEPTH_TOPS[sliceLevel]
      : Infinity;

    // Fast lookup for river cell membership
    const riverSet = new Set<string>(RIVER_CELLS.map(c => `${c.gz},${c.gx}`));

    // Is (gx, gz) rendered in the current slice state?
    function shouldRender(gx: number, gz: number): boolean {
      if (!riverSet.has(`${gz},${gx}`)) return false;
      if (sliceMode === "slice-v") {
        return isVoxelVisible(gx, gz, sliceDir, sliceLevel, sliceCutType);
      }
      return true;
    }

    const positions: number[] = [];
    const colors:    number[] = [];
    const indices:   number[] = [];

    // River bed uses the SAME unified soil ramp as SolidTerrain (groundColor),
    // so the carved channel bed matches the bay seabed where they meet — one
    // continuous ground colour, no brown seam at the river mouths.
    function addVert(px: number, py: number, pz: number): number {
      const [r, g, b] = groundColor(py);
      positions.push(px, py, pz);
      colors.push(r, g, b);
      return (positions.length / 3) - 1;
    }

    for (const { gx, gz } of RIVER_CELLS) {
      if (!shouldRender(gx, gz)) continue;

      // All river water is layer 0 only; clip the seabed top at the slice plane
      const rawTopY = Y_SURFACE - DEPTH_TOPS[0] - DEPTH_HEIGHTS[0];
      const topY    = Math.min(rawTopY, sliceClipY);
      // River is a surface feature — floor is always one layer deep, never BOX_BOT
      const bottomY = topY - DEPTH_HEIGHTS[0];

      const x0 = offsetX + gx       * STEP;
      const x1 = offsetX + (gx + 1) * STEP;
      const z0 = offsetZ + gz       * STEP;
      const z1 = offsetZ + (gz + 1) * STEP;

      // Top face (faces upward)
      const t00 = addVert(x0, topY, z0);
      const t10 = addVert(x1, topY, z0);
      const t01 = addVert(x0, topY, z1);
      const t11 = addVert(x1, topY, z1);
      indices.push(t00, t11, t10,  t00, t01, t11);

      // Bottom face (faces downward)
      const b00 = addVert(x0, bottomY, z0);
      const b10 = addVert(x1, bottomY, z0);
      const b01 = addVert(x0, bottomY, z1);
      const b11 = addVert(x1, bottomY, z1);
      indices.push(b00, b10, b11,  b00, b11, b01);

      // West wall
      if (!shouldRender(gx - 1, gz)) {
        const a = addVert(x0, topY,    z0); const b = addVert(x0, bottomY, z0);
        const c = addVert(x0, bottomY, z1); const d = addVert(x0, topY,    z1);
        indices.push(a, b, c,  a, c, d);
      }
      // East wall
      if (!shouldRender(gx + 1, gz)) {
        const a = addVert(x1, topY,    z0); const b = addVert(x1, bottomY, z0);
        const c = addVert(x1, bottomY, z1); const d = addVert(x1, topY,    z1);
        indices.push(a, c, b,  a, d, c);
      }
      // North wall (-Z)
      if (!shouldRender(gx, gz - 1)) {
        const a = addVert(x0, topY,    z0); const b = addVert(x0, bottomY, z0);
        const c = addVert(x1, bottomY, z0); const d = addVert(x1, topY,    z0);
        indices.push(a, c, b,  a, d, c);
      }
      // South wall (+Z)
      if (!shouldRender(gx, gz + 1)) {
        const a = addVert(x0, topY,    z1); const b = addVert(x0, bottomY, z1);
        const c = addVert(x1, bottomY, z1); const d = addVert(x1, topY,    z1);
        indices.push(a, b, c,  a, c, d);
      }
    }

    if (indices.length === 0) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute("color",    new THREE.BufferAttribute(new Float32Array(colors),    3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [sliceMode, sliceLevel, sliceDir, sliceCutType]);

  if (!geometry) return null;
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        vertexColors
        roughness={0.88}
        metalness={0.04}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
      />
    </mesh>
  );
}

// ── River voxels ─────────────────────────────────────────────────────────────
// Delta cells (close to the bay mouth) are rendered like shallow ocean — multiple
// depth layers + a seabed box — so they blend naturally with the bay edge.
// Further upstream the river tapers to a single surface tile (like a narrow channel).
function RiverGrid({
  week,
  colorScale,
  sliceMode,
  sliceLevel,
  sliceDir,
  sliceCutType,
}: {
  week: number;
  colorScale: string;
  sliceMode: DashboardState;
  sliceLevel: number;
  sliceDir: SliceDir;
  sliceCutType: SliceCutType;
}) {
  const stops = COLOR_SCALES[colorScale] ?? COLOR_SCALES.nitrogen;

  const invalidate = useThree((s) => s.invalidate);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Hover state — which river group is under the pointer
  const [hoveredId, setHoveredId]  = useState<string | null>(null);
  const [hoverPos,  setHoverPos]   = useState<[number, number, number]>([0, 0, 0]);

  // Per-river colour cache: each unique riverId gets its own RGB derived from
  // the same data the map viewport uses (`generateRiverData`), averaged across
  // the river's midpoint cross-section. This mirrors MapLibreMap's `reachColors`
  // logic exactly, so a given river shows the same shade in 2D and in 3D, and
  // animates with `week` and `colorScale`. Previously every river shared one
  // bay-mean tint and never differentiated.
  const riverColors = useMemo(() => {
    const out: Record<string, [number, number, number]> = {};
    const uniqueIds = Array.from(new Set(RIVER_CELLS.map(c => c.riverId)));
    const midCol = Math.min(RIVER_COLS - 1, Math.round(0.5 * (RIVER_COLS - 1)));
    for (const rid of uniqueIds) {
      const grid = generateRiverData(week, rid);
      let sum = 0;
      for (let row = 0; row < RIVER_ROWS; row++) sum += grid[row]?.[midCol] ?? 0;
      const t = Math.max(0, Math.min(1, sum / RIVER_ROWS));
      out[rid] = lerpColor(stops, t);
    }
    return out;
  }, [week, stops]);

  // Instance layout: one surface-layer voxel per visible river cell. Recomputed
  // only when the slice state changes (positions never depend on week/colour),
  // so playback re-tints instances in place rather than rebuilding geometry.
  const layout = useMemo(() => {
    const positions: [number, number, number][] = [];
    const riverIds: string[] = [];
    const py = Y_SURFACE - DEPTH_TOPS[0] - DEPTH_HEIGHTS[0] / 2;
    for (const { gx, gz, riverId } of RIVER_CELLS) {
      // Horizontal slice: river water is layer 0 — hide it below that.
      if (sliceMode === "slice-h" && sliceLevel !== 0) continue;
      // Vertical slice: keep only cells on the kept side of the cut.
      if (sliceMode === "slice-v" && !isVoxelVisible(gx, gz, sliceDir, sliceLevel, sliceCutType)) continue;
      positions.push([offsetX + gx * STEP + CELL_W / 2, py, offsetZ + gz * STEP + CELL_W / 2]);
      riverIds.push(riverId);
    }
    return { positions, riverIds, count: positions.length };
  }, [sliceMode, sliceLevel, sliceDir, sliceCutType]);

  // Position the instances once per layout change (raycast needs a real bounding sphere).
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || layout.count === 0) return;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < layout.count; i++) {
      const [px, py, pz] = layout.positions[i];
      m4.setPosition(px, py, pz);
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [layout]);

  // Re-tint instances whenever colours or the hovered river change. The hovered
  // river's cells are brightened; everything else uses its base concentration
  // colour. One code path, always consistent — no per-cell React elements.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || layout.count === 0) return;
    const col = new THREE.Color();
    for (let i = 0; i < layout.count; i++) {
      const rid = layout.riverIds[i];
      const base = riverColors[rid] ?? lerpColor(stops, 0.5);
      const hov = hoveredId === rid;
      col.setRGB(
        hov ? Math.min(1, base[0] + 0.25) : base[0],
        hov ? Math.min(1, base[1] + 0.25) : base[1],
        hov ? Math.min(1, base[2] + 0.25) : base[2],
      );
      mesh.setColorAt(i, col);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    invalidate();
  }, [layout, riverColors, hoveredId, stops, invalidate]);

  // Hover tooltip — rendered once at the position of the last hovered cell
  const meta = hoveredId ? RIVER_META[hoveredId] : null;

  return (
    <>
      {layout.count > 0 && (
        <instancedMesh
          key={`river-${layout.count}`}
          ref={meshRef}
          args={[undefined, undefined, layout.count]}
          frustumCulled={false}
          onPointerOver={(e) => {
            e.stopPropagation();
            const iid = e.instanceId;
            if (iid == null) return;
            setHoveredId(layout.riverIds[iid]);
            const [px, py, pz] = layout.positions[iid];
            setHoverPos([px, py + DEPTH_HEIGHTS[0] * 0.5 + 0.3, pz]);
          }}
          onPointerOut={() => setHoveredId(null)}
        >
          <boxGeometry args={[CELL_W, DEPTH_HEIGHTS[0], CELL_W]} />
          <meshStandardMaterial roughness={0.7} metalness={0.05} />
        </instancedMesh>
      )}
      {meta && (
        <Html
          position={hoverPos}
          zIndexRange={[200, 0]}
          style={{ transform: "translate(10px, calc(-100% - 6px))" }}
        >
          <div style={{
            background: "rgba(15,23,42,0.88)",
            border: "1px solid rgba(148,163,184,0.35)",
            borderRadius: 6,
            padding: "6px 10px",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            fontFamily: "system-ui, sans-serif",
          }}>
            <div style={{ color: "#f8fafc", fontSize: 13, fontWeight: 600 }}>
              {meta.name}
            </div>
            <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 2 }}>
              {meta.subBasin}
            </div>
          </div>
        </Html>
      )}
    </>
  );
}

// ── GIS wireframe bounding box ────────────────────────────────────────────────
function BoundingBox() {
  return (
    <mesh position={[0, BOX_CY, 0]}>
      <boxGeometry args={[BOX_W, BOX_H, BOX_D]} />
      <meshStandardMaterial transparent opacity={0} depthWrite={false} />
      <Edges color="#555555" threshold={15} />
    </mesh>
  );
}

// ── In-scene axis labels ──────────────────────────────────────────────────────
const LABEL_STYLE: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: "11px",
  color: "#333",
  whiteSpace: "nowrap",
  pointerEvents: "none",
  userSelect: "none",
};

const COMPASS_STYLE: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: "14px",
  fontWeight: "bold",
  color: "#222",
  pointerEvents: "none",
  userSelect: "none",
};

// Renders a label that scales with camera distance, clamped to [minScale, maxScale].
// Uses imperative DOM mutation inside useFrame — no React re-render per frame.
// scaleMode "inverse": bigger when close (default, for data labels)
// scaleMode "direct":  bigger when far / zoomed out (for compass letters)
function ScaledLabel({
  position,
  children,
  center,
  zIndexRange,
  baseDistance = 18,
  minScale = 0.55,
  maxScale = 2.2,
  scaleMode = "inverse",
}: {
  position: [number, number, number];
  children: React.ReactNode;
  center?: boolean;
  zIndexRange?: [number, number];
  baseDistance?: number;
  minScale?: number;
  maxScale?: number;
  scaleMode?: "inverse" | "direct";
}) {
  const { camera } = useThree();
  const wrapRef  = useRef<HTMLDivElement>(null);
  const posVec   = useRef(new THREE.Vector3(...position));

  useFrame(() => {
    if (!wrapRef.current) return;
    const dist = camera.position.distanceTo(posVec.current);
    const raw  = scaleMode === "direct"
      ? dist / Math.max(baseDistance, 0.01)          // grows with distance
      : baseDistance / Math.max(dist, 0.01);          // shrinks with distance
    const s    = Math.max(minScale, Math.min(maxScale, raw));
    wrapRef.current.style.transform = `scale(${s.toFixed(3)})`;
  });

  return (
    <Html position={position} center={center} zIndexRange={zIndexRange}>
      <div ref={wrapRef} style={{ transformOrigin: "center center" }}>
        {children}
      </div>
    </Html>
  );
}

// Always-visible N/W/S/E compass labels — scale UP as camera pulls back
function CompassLabels() {
  // Midway between the original (small) and the previous (over-large) sizing.
  // minScale 0.6 ≈ midpoint of 0.55 → 0.7; maxScale 2.7 ≈ midpoint of 2.2 → 3.2.
  const props = { scaleMode: "direct" as const, baseDistance: 38, minScale: 0.6, maxScale: 2.7 };
  return (
    <>
      <ScaledLabel position={[0, BOX_TOP + 0.6, BOX_NORTH_Z]} center zIndexRange={[0,0]} {...props}>
        <div style={COMPASS_STYLE}>N</div>
      </ScaledLabel>
      <ScaledLabel position={[0, BOX_TOP + 0.6, BOX_SOUTH_Z]} center zIndexRange={[0,0]} {...props}>
        <div style={COMPASS_STYLE}>S</div>
      </ScaledLabel>
      <ScaledLabel position={[BOX_EAST_X, BOX_TOP + 0.6, 0]} center zIndexRange={[0,0]} {...props}>
        <div style={COMPASS_STYLE}>E</div>
      </ScaledLabel>
      <ScaledLabel position={[BOX_WEST_X, BOX_TOP + 0.6, 0]} center zIndexRange={[0,0]} {...props}>
        <div style={COMPASS_STYLE}>W</div>
      </ScaledLabel>
    </>
  );
}

// Static context label floating over the open Pacific, east of the bay mouth.
// Purely a caption — no interactivity, no data binding.
function OpenSeaLabel() {
  // East side, north-of-centre, just above the sea surface, inside the open water.
  const px = offsetX + (GRID_W + LAND_RING * 0.5) * STEP;
  const pz = offsetZ + GRID_D * 0.62 * STEP;
  return (
    <ScaledLabel position={[px, Y_SURFACE + 0.25, pz]} center zIndexRange={[0, 0]}>
      <div
        style={{
          fontFamily: "system-ui, sans-serif",
          fontSize: "10px",
          fontStyle: "italic",
          letterSpacing: "0.04em",
          color: "#3f5c72",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          userSelect: "none",
          textShadow: "0 1px 2px rgba(255,255,255,0.6)",
        }}
      >
        Pacific — open sea
      </div>
    </ScaledLabel>
  );
}

// Toggleable coordinate tick labels (lon / lat / depth)
function CoordTickLabels() {
  const lonTicks: React.ReactElement[] = [];
  const latTicks: React.ReactElement[] = [];
  const depthTicks: React.ReactElement[] = [];

  for (const gx of [0, 14, 28, 42, 54]) {
    const lon   = BAY_LON_W + (gx / (GRID_W - 1)) * (BAY_LON_E - BAY_LON_W);
    const scenX = offsetX + gx * STEP + CELL_W / 2;
    lonTicks.push(
      <ScaledLabel key={`lon-${gx}`} position={[scenX, BOX_BOT - 0.7, BOX_SOUTH_Z]} center zIndexRange={[0,0]}>
        <div style={LABEL_STYLE}>{lon.toFixed(3)}°E</div>
      </ScaledLabel>
    );
  }

  for (const gz of [0, 10, 20, 30, 40, 46]) {
    const lat   = BAY_LAT_S + (gz / (GRID_D - 1)) * (BAY_LAT_N - BAY_LAT_S);
    const scenZ = offsetZ + gz * STEP + CELL_W / 2;
    latTicks.push(
      <ScaledLabel key={`lat-${gz}`} position={[BOX_WEST_X, BOX_BOT - 0.7, scenZ]} center zIndexRange={[0,0]}>
        <div style={LABEL_STYLE}>{lat.toFixed(3)}°N</div>
      </ScaledLabel>
    );
  }

  for (let d = 0; d < DEPTH_LAYERS; d++) {
    const y = Y_SURFACE - DEPTH_TOPS[d];
    depthTicks.push(
      <ScaledLabel key={`dep-${d}`} position={[DEPTH_LABEL_X, y, BOX_SOUTH_Z]} center zIndexRange={[0,0]}>
        <div style={LABEL_STYLE}>{DEPTH_REAL_M[d]}m</div>
      </ScaledLabel>
    );
  }

  return <>{lonTicks}{latTicks}{depthTicks}</>;
}

// ── Grid floor ────────────────────────────────────────────────────────────────
function GridFloor() {
  const floorY = Y_SURFACE - DEPTH_TOTAL_H;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, floorY, 0]}>
      <planeGeometry args={[GRID_W * STEP, GRID_D * STEP, GRID_W, GRID_D]} />
      <meshStandardMaterial color="#b8c8d8" wireframe opacity={0.25} transparent />
    </mesh>
  );
}

// ── Cut-face gradient plane ───────────────────────────────────────────────────
// When the volume is sliced, the exposed cross-section otherwise shows the blocky
// side faces of the surviving voxels. This paints a single smooth, interpolated
// plane exactly on the cut, sampling the nutrient field at the cut line and using
// per-vertex colours (finely subdivided) so it reads as a continuous scientific
// section — the ArcGIS Voxel-Explorer "temperature section plane" look.
//
// Coordinate math is derived directly from the existing meshes so the plane lands
// precisely on the cut:
//   • Horizontal cell edges reuse buildBatches / SeabedMesh:  offsetX + gx*STEP,
//     offsetZ + gz*STEP  (a cell spans [g*STEP, (g+1)*STEP]).
//   • Depth→Y reuses the voxel mapping:  top of layer d = Y_SURFACE - DEPTH_TOPS[d];
//     bottom = Y_SURFACE - DEPTH_TOPS[d] - DEPTH_HEIGHTS[d].
//   • The vertical cut position reuses SliceIndicator's formula
//     (offsetX/offsetZ + level*STEP + STEP/2) for both-sides, and the exposed
//     cell face for one-side.
//   • Colour reuses lerpColor(stops, val) with the field sample data[gz][gx][d]
//     — identical to the voxels — so the plane matches them exactly and recolours
//     on the same `data` dependency when the week changes.
//
// SUBDIV subdivides each grid cell / depth layer so vertex-colour interpolation
// blends smoothly across cell boundaries instead of showing hard voxel bands.
const FACE_SUBDIV = 2;

// Deepest layer index that holds a water voxel at (gx,gz), or -1 if none. Mirrors
// the voxel visibility test in buildBatches (BAY_MASK + bathymetry).
function waterMaxLayer(gx: number, gz: number): number {
  if (gz < 0 || gz >= GRID_D || gx < 0 || gx >= GRID_W) return -1;
  if (!isBayWater(gx, gz)) return -1;
  return deepestVisibleLayer(effectiveSeabedM(gx, gz));
}

interface SliceFacePlaneProps {
  data: ReturnType<typeof generateWeekData>;
  stops: string[];
  sliceMode: DashboardState;
  sliceLevel: number;
  sliceDir: SliceDir;
  sliceCutType: SliceCutType;
}

function SliceFacePlane({ data, stops, sliceMode, sliceLevel, sliceDir, sliceCutType }: SliceFacePlaneProps) {
  const geometry = useMemo(() => {
    if (sliceMode !== "slice-v" && sliceMode !== "slice-h") return null;

    const positions: number[] = [];
    const colors:    number[] = [];
    const indices:   number[] = [];

    // Continuous world-Y for a fractional depth-layer coordinate dRow∈[0,DEPTH_LAYERS]
    // (0 = surface top, DEPTH_LAYERS = column bottom). Interpolates within a layer's
    // scene-unit height so the depth axis subdivides smoothly.
    const depthRowY = (dRow: number): number => {
      const clamped = Math.max(0, Math.min(DEPTH_LAYERS, dRow));
      const li = Math.min(DEPTH_LAYERS - 1, Math.floor(clamped));
      const frac = clamped - li;
      const top = Y_SURFACE - DEPTH_TOPS[li];
      return top - DEPTH_HEIGHTS[li] * frac;
    };
    // Nutrient value at the integer layer nearest a fractional depth row.
    const sampleDepthVal = (col: (d: number) => number, dRow: number): number => {
      const d = Math.max(0, Math.min(DEPTH_LAYERS - 1, Math.round(dRow - 0.5)));
      return col(d);
    };

    if (sliceMode === "slice-v") {
      const axis = sliceDirAxis(sliceDir);
      const both = sliceCutType === "both-sides";

      // The perpendicular horizontal grid axis we sweep across, and the fixed
      // grid index of the cut line (the last kept row/column).
      const perpMax = axis === "x" ? GRID_D : GRID_W; // sweep gz (x-cut) or gx (z-cut)
      const fixed   = sliceLevel;

      // World position of the cut plane along the sliced axis. For both-sides we
      // show the single kept slab at its cell centre (matches SliceIndicator). For
      // one-side we sit on the exposed face of the last kept cell so the plane caps
      // the blocky voxel sides:
      //   east  keeps gx≤level → exposed east  face at (level+1)*STEP
      //   west  keeps gx≥level → exposed west  face at  level   *STEP
      //   north keeps gz≤level → exposed north face at (level+1)*STEP
      //   south keeps gz≥level → exposed south face at  level   *STEP
      const baseOff = axis === "x" ? offsetX : offsetZ;
      let cutPos: number;
      if (both) {
        cutPos = baseOff + fixed * STEP + STEP / 2;
      } else if (sliceDir === "east" || sliceDir === "north") {
        cutPos = baseOff + (fixed + 1) * STEP;
      } else {
        cutPos = baseOff + fixed * STEP;
      }

      // Field accessor for the cut column/row at a given perpendicular index p and
      // depth layer d. (x-cut → column gx=fixed, varying gz=p; z-cut → row gz=fixed,
      // varying gx=p.)
      const gxOf = (p: number) => (axis === "x" ? fixed : p);
      const gzOf = (p: number) => (axis === "x" ? p : fixed);
      const fieldAt = (p: number, d: number): number =>
        data[gzOf(p)]?.[gxOf(p)]?.[d] ?? 0;

      // Sweep the perpendicular axis one water cell at a time. For each cell that
      // has water at the cut line, emit a finely subdivided quad-strip spanning its
      // horizontal extent × its water-column depth. Cells with no water (land / dry
      // column) are skipped, so the plane only covers the wet cross-section and
      // reads with a clean coastline edge.
      for (let p = 0; p < perpMax; p++) {
        const maxLayer = waterMaxLayer(gxOf(p), gzOf(p));
        if (maxLayer < 0) continue;

        const depthRows = (maxLayer + 1) * FACE_SUBDIV; // sub-rows down the column
        const horizStart = baseOff + p * STEP;

        for (let hs = 0; hs < FACE_SUBDIV; hs++) {
          const h0 = horizStart + (hs / FACE_SUBDIV) * STEP;
          const h1 = horizStart + ((hs + 1) / FACE_SUBDIV) * STEP;
          // Fractional perpendicular grid position at each sub-edge, so colours can
          // interpolate toward the neighbouring water cell instead of banding.
          const hp0 = p + hs / FACE_SUBDIV;
          const hp1 = p + (hs + 1) / FACE_SUBDIV;

          const colorAt = (hp: number, dRow: number): [number, number, number] => {
            // Sample the two horizontally-adjacent cells and blend; if a neighbour
            // is dry, fall back to this cell's own value (no bleed into land).
            const pc = Math.floor(hp - 0.5 + 1e-6);
            const f  = hp - 0.5 - pc;
            const vHere = sampleDepthVal((d) => fieldAt(p, d), dRow);
            const pA = pc, pB = pc + 1;
            const aOk = pA >= 0 && pA < perpMax && waterMaxLayer(gxOf(pA), gzOf(pA)) >= 0;
            const bOk = pB >= 0 && pB < perpMax && waterMaxLayer(gxOf(pB), gzOf(pB)) >= 0;
            let val = vHere;
            if (aOk && bOk) {
              const vA = sampleDepthVal((d) => fieldAt(pA, d), dRow);
              const vB = sampleDepthVal((d) => fieldAt(pB, d), dRow);
              val = vA + (vB - vA) * f;
            }
            return lerpColor(stops, val);
          };

          // Build the vertical strip of vertices for both horizontal sub-edges.
          const base = positions.length / 3;
          for (let dr = 0; dr <= depthRows; dr++) {
            const dRow = (dr / FACE_SUBDIV);
            const y = depthRowY(dRow);
            const [r0, g0, b0] = colorAt(hp0, dRow);
            const [r1, g1, b1] = colorAt(hp1, dRow);
            if (axis === "x") {
              positions.push(cutPos, y, h0);
              positions.push(cutPos, y, h1);
            } else {
              positions.push(h0, y, cutPos);
              positions.push(h1, y, cutPos);
            }
            colors.push(r0, g0, b0, r1, g1, b1);
          }
          // Two triangles per depth sub-cell of the strip (double-sided material
          // makes winding irrelevant).
          for (let dr = 0; dr < depthRows; dr++) {
            const a = base + dr * 2;
            const b = a + 1;
            const c = a + 2;
            const d = a + 3;
            indices.push(a, b, d, a, d, c);
          }
        }
      }
    } else {
      // ── Horizontal slice: a flat plane at the selected depth's top ────────────
      // y = Y_SURFACE - DEPTH_TOPS[sliceLevel] (the SeabedMesh clip plane). Domain
      // = gx × gz over the bay water cells whose column reaches this depth. Colours
      // sample data[gz][gx][sliceLevel].
      const y = Y_SURFACE - DEPTH_TOPS[sliceLevel];
      const cellOk = (gx: number, gz: number): boolean =>
        waterMaxLayer(gx, gz) >= sliceLevel;
      const valAt = (gx: number, gz: number): number => data[gz]?.[gx]?.[sliceLevel] ?? 0;

      for (let gz = 0; gz < GRID_D; gz++) {
        for (let gx = 0; gx < GRID_W; gx++) {
          if (!cellOk(gx, gz)) continue;
          const x0 = offsetX + gx * STEP;
          const z0 = offsetZ + gz * STEP;

          const colorAtXZ = (fx: number, fz: number): [number, number, number] => {
            // Bilinear blend toward neighbouring wet cells (cell-centre sampling).
            const gxc = Math.floor(fx - 0.5 + 1e-6);
            const gzc = Math.floor(fz - 0.5 + 1e-6);
            const tx = fx - 0.5 - gxc;
            const tz = fz - 0.5 - gzc;
            const sample = (cx: number, cz: number): number =>
              cellOk(cx, cz) ? valAt(cx, cz) : valAt(gx, gz);
            const v00 = sample(gxc, gzc);
            const v10 = sample(gxc + 1, gzc);
            const v01 = sample(gxc, gzc + 1);
            const v11 = sample(gxc + 1, gzc + 1);
            const vx0 = v00 + (v10 - v00) * tx;
            const vx1 = v01 + (v11 - v01) * tx;
            return lerpColor(stops, vx0 + (vx1 - vx0) * tz);
          };

          for (let sz = 0; sz < FACE_SUBDIV; sz++) {
            for (let sx = 0; sx < FACE_SUBDIV; sx++) {
              const cx0 = x0 + (sx / FACE_SUBDIV) * STEP;
              const cx1 = x0 + ((sx + 1) / FACE_SUBDIV) * STEP;
              const cz0 = z0 + (sz / FACE_SUBDIV) * STEP;
              const cz1 = z0 + ((sz + 1) / FACE_SUBDIV) * STEP;
              const fx0 = gx + sx / FACE_SUBDIV;
              const fx1 = gx + (sx + 1) / FACE_SUBDIV;
              const fz0 = gz + sz / FACE_SUBDIV;
              const fz1 = gz + (sz + 1) / FACE_SUBDIV;
              const base = positions.length / 3;
              const push = (px: number, pz: number, fpx: number, fpz: number) => {
                positions.push(px, y, pz);
                const [r, g, b] = colorAtXZ(fpx, fpz);
                colors.push(r, g, b);
              };
              push(cx0, cz0, fx0, fz0);
              push(cx1, cz0, fx1, fz0);
              push(cx0, cz1, fx0, fz1);
              push(cx1, cz1, fx1, fz1);
              indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
            }
          }
        }
      }
    }

    if (indices.length === 0) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute("color",    new THREE.BufferAttribute(new Float32Array(colors),    3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [data, stops, sliceMode, sliceLevel, sliceDir, sliceCutType]);

  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    // Repaint under the demand frameloop when the plane rebuilds (week / slice change).
    invalidate();
  }, [geometry, invalidate]);

  if (!geometry) return null;
  return (
    <mesh geometry={geometry} raycast={() => null}>
      {/* Unlit vertex-colour material so the gradient reads true (no shading tint),
          double-sided so it shows from either orbit side, with polygonOffset pulling
          it slightly in front of the coplanar blocky voxel faces to avoid z-fighting. */}
      <meshBasicMaterial
        vertexColors
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
      />
    </mesh>
  );
}

// ── Slice indicator ───────────────────────────────────────────────────────────
interface SliceIndicatorProps {
  mode: DashboardState;
  level: number;
  sliceDir: SliceDir;
  showCutPlane: boolean;
}

function SliceIndicator({ mode, level, sliceDir, showCutPlane }: SliceIndicatorProps) {
  if (mode === "slice-h") {
    return (
      <mesh position={[0, Y_SURFACE - DEPTH_TOPS[level] - DEPTH_HEIGHTS[level] / 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[GRID_W * STEP, GRID_D * STEP]} />
        <meshStandardMaterial color="#4a90d9" opacity={0.08} transparent depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    );
  }

  if (!showCutPlane) return null;

  if (mode === "slice-v" && sliceDirAxis(sliceDir) === "x") {
    const x = offsetX + level * STEP + STEP / 2;
    return (
      <mesh position={[x, BOX_CY, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[GRID_D * STEP, BOX_H]} />
        <meshStandardMaterial color="#f59e0b" transparent opacity={0.14} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    );
  }

  if (mode === "slice-v" && sliceDirAxis(sliceDir) === "z") {
    const z = offsetZ + level * STEP + STEP / 2;
    return (
      <mesh position={[0, BOX_CY, z]}>
        <planeGeometry args={[GRID_W * STEP, BOX_H]} />
        <meshStandardMaterial color="#f59e0b" transparent opacity={0.14} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    );
  }

  return null;
}

// ── Camera presets ────────────────────────────────────────────────────────────
// All side views sit ~50 units high and 75 units back from origin, giving a
// clear ~33° elevation angle that's visibly different from the top-down view
// while still framing the entire bay. Note: the scene Z axis is flipped via
// `<group scale={[1,1,-1]}>`, so a NEGATIVE world-Z position is on the NORTH
// side of the rendered bay (gz=95), and POSITIVE world-Z is the SOUTH side.
//
// `iso` is the default first-paint view: positioned south-west of the bay
// (negative X = west, positive Z = south) and elevated ~50° so the depth
// structure of the basin reads as 3D immediately, without being a flat
// top-down map or a flat side elevation.
//
// Both the short ("n"/"s"/"e"/"w") and long ("north"/...) forms are accepted
// because PlaybackPage stores the URL-friendly short code in state while
// older code paths may pass the long form.
const CAMERA_PRESETS: Record<string, [number, number, number]> = {
  iso:   [-42,  70,  58],
  top:   [  0,  92,   8],
  n:     [  0,  50, -75],
  s:     [  0,  50,  75],
  e:     [ 75,  50,   0],
  w:     [-75,  50,   0],
  north: [  0,  50, -75],
  south: [  0,  50,  75],
  east:  [ 75,  50,   0],
  west:  [-75,  50,   0],
};

/** Guarantees the scene paints on first mount. The demand frameloop can
 *  otherwise leave the canvas blank until a manual camera/play interaction:
 *  the first frames may fire before the container has a non-zero size (CSS /
 *  layout not settled) or before the ~44k-instance voxel geometry finishes
 *  building, and under "demand" nothing re-requests a frame afterwards. This
 *  runs a short rAF burst on mount (each tick requests a frame) and re-requests
 *  on window resize, so the first real paint always lands. Must be inside
 *  <Canvas>. */
function InitialPaintKick() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    const tick = () => {
      invalidate();
      if (frames++ < 90) raf = requestAnimationFrame(tick); // ~1.5s @ 60fps
    };
    raf = requestAnimationFrame(tick);
    const onResize = () => invalidate();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [invalidate]);
  return null;
}

/** Moves camera + OrbitControls target whenever `preset` changes OR when the
 *  caller bumps `tick` (so re-clicking the same preset button after manually
 *  orbiting still snaps the camera back). Must be inside <Canvas>.
 *
 *  Implementation notes:
 *   - Uses useEffect on (preset, tick) so React schedules the apply exactly
 *     once per request — no per-frame polling, no stale-closure issues.
 *   - If OrbitControls' ref hasn't been populated yet on first paint, retries
 *     via requestAnimationFrame until it is (cancellable on unmount/re-run).
 *   - Calls camera.lookAt(0,0,0) explicitly in addition to controls.target so
 *     the camera matrix is updated even if OrbitControls hasn't yet wired up
 *     its internal state. */
function CameraController({
  preset,
  tick,
  orbitRef,
}: {
  preset: string;
  tick: number;
  orbitRef: { current: any };
}) {
  const { camera, invalidate } = useThree();

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    const apply = () => {
      if (cancelled) return;
      const pos = CAMERA_PRESETS[preset];
      if (!pos) return;
      const controls = orbitRef.current;
      if (!controls) {
        // OrbitControls hasn't mounted yet on first paint — retry next frame.
        raf = requestAnimationFrame(apply);
        return;
      }
      // Disable OrbitControls during the move so it can't fight the new
      // position via internal sphericalDelta / dampening / scale state that
      // may have been left over from prior user interaction.
      const wasEnabled = controls.enabled;
      controls.enabled = false;

      // Reset OrbitControls' internal accumulators by re-creating the home
      // state and calling reset(). This is the documented way to teleport
      // the camera. position0 / target0 are Vector3 instances on the
      // controls object — mutate them in place.
      controls.target0?.set?.(0, 0, 0);
      controls.position0?.set?.(pos[0], pos[1], pos[2]);
      if (typeof controls.reset === "function") controls.reset();

      // Belt-and-suspenders: write directly to the live camera + target,
      // then call update() so OrbitControls re-derives its spherical state
      // from the new (clean) camera position.
      controls.target.set(0, 0, 0);
      camera.position.set(pos[0], pos[1], pos[2]);
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      controls.update();

      controls.enabled = wasEnabled;
      invalidate?.();
    };
    apply();
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, tick]);

  return null;
}

// ── Main component ────────────────────────────────────────────────────────────
interface OceanBasin3DProps {
  week: number;
  colorScale: string;
  dashboardState: DashboardState;
  selectedPoint: { x: number; z: number; y?: number } | null;
  sliceLevel: number;
  sliceDir: SliceDir;
  sliceCutType?: SliceCutType;
  showCutPlane?: boolean;
  /** How the exposed cut face reads: the smooth interpolated gradient plane
   *  ("heatmap", default) or the raw blocky voxel cross-section ("voxels",
   *  which hides the SliceFacePlane so the voxel ends carry the section). */
  sliceFaceMode?: "voxels" | "heatmap";
  onCellClick: (x: number, z: number, y: number) => void;
  onCellHover?: (x: number, z: number) => void;
  showAnnotations?: boolean;
  cameraPreset?: string;
  cameraPresetTick?: number;
  markerPixels?: { x: number; z: number; color: string }[];
  speed?: number;
  isPlaying?: boolean;
  depthShading?: boolean;
}

function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return [r, g, b];
}

export default function OceanBasin3D({
  week,
  colorScale,
  dashboardState,
  selectedPoint,
  sliceLevel,
  sliceDir,
  sliceCutType = "one-side",
  showCutPlane = true,
  sliceFaceMode = "heatmap",
  onCellClick,
  onCellHover,
  showAnnotations = true,
  cameraPreset = "top",
  cameraPresetTick = 0,
  markerPixels,
  speed = 1,
  isPlaying = false,
  depthShading = true,
}: OceanBasin3DProps) {
  // Frameloop: render continuously while playing (the cross-fade animates every
  // frame; mounting defaults to playing, so the first paint always lands). When
  // paused, drop to "demand" so an idle basin stops burning GPU — invalidate()
  // (wired into the week / batch / hover paths) still repaints on every real
  // change, and OrbitControls repaints on camera interaction.
  const frameloop: "always" | "demand" = isPlaying ? "always" : "demand";
  const markerMap = useMemo(() => {
    if (!markerPixels || markerPixels.length === 0) return undefined;
    const m = new Map<string, [number, number, number]>();
    markerPixels.forEach((p) => m.set(`${p.x}:${p.z}`, hexToRgb01(p.color)));
    return m;
  }, [markerPixels]);
  const orbitRef = useRef<any>(null);

  // Colour cross-fade duration tracks the playback interval (800ms / speed)
  // so the transition always finishes just before the next week lands —
  // clamped so it never gets uncomfortably slow (paused/rewind) or too fast
  // to read (4x speed).
  const transitionMs = Math.max(150, Math.min(700, (800 / speed) * 0.85));

  const voxelProps: VoxelGridProps = {
    week,
    colorScale,
    selectedPoint,
    sliceMode: dashboardState,
    sliceLevel,
    sliceDir,
    sliceCutType,
    onCellClick,
    onCellHover,
  };

  // Field + colour ramp for the cut-face gradient plane. Reuses the SAME data the
  // voxels read (generateWeekData(week)) and the active colour stops, so the plane
  // recolours on the same week/scale change and matches the voxel colours exactly.
  const faceData  = useMemo(() => generateWeekData(week), [week]);
  const faceStops = COLOR_SCALES[colorScale] ?? COLOR_SCALES.nitrogen;

  return (
    <Canvas
      frameloop={frameloop}
      camera={{ position: [0, 92, 8], fov: 38 }}
      style={{ background: "#f8f9fa" }}
      data-testid="canvas-3d"
    >
      <CameraController preset={cameraPreset} tick={cameraPresetTick} orbitRef={orbitRef} />
      <InitialPaintKick />
      {/* Lighting rig, toggleable via depthShading:
          ON  — a hemisphere light (cool sky above, dim ground below) plus a
                stronger key directional, so a voxel's upward faces read
                brighter than its sides and the blocky column + seabed structure
                gains clear form. Near-Lambert material (roughness 0.7) means
                this scales per-face luminance without shifting the nutrient
                hue. No shadow maps — self-shadowing voxels would darken cells
                unpredictably and misread as lower values.
          OFF — the original flat, evenly-lit look (high ambient, gentle
                directionals) for users who prefer uniform surface colour. */}
      {depthShading ? (
        <>
          <hemisphereLight color="#eef4fb" groundColor="#5f6b78" intensity={0.5} />
          <directionalLight position={[9, 13, 11]} intensity={1.0} />
          <directionalLight position={[-7, 7, -6]} intensity={0.28} color="#b0c8e0" />
        </>
      ) : (
        <>
          <ambientLight intensity={0.8} />
          <directionalLight position={[10, 15, 10]} intensity={0.7} />
          <directionalLight position={[-5, 8, -5]} intensity={0.3} color="#b0c8e0" />
        </>
      )}

      {/* Z-flip group: negates all scene Z so gz=0(south)→+Z, gz=95(north)→−Z.
          ASPECT_X compresses X so the bay renders at the real E–W:N–S proportions
          (matching the Map Viewport) instead of ~1.43× too wide. */}
      <group scale={[ASPECT_X, 1, -1]}>
        <VoxelGridInstanced {...voxelProps} markerPixels={markerMap} transitionMs={transitionMs} />

        {/* Unified solid terrain: ONE continuous ground surface — land slopes
            down the coast into the seabed (bay + open-sea floor) and up into the
            island mounds — replacing the old separate seabed / coastal-land /
            island shells and the study-box floor. Each cell is a solid column to
            BOX_BOT, so slicing reveals continuous soil (no hollows). */}
        <SolidTerrain
          sliceMode={dashboardState}
          sliceLevel={sliceLevel}
          sliceDir={sliceDir}
          sliceCutType={sliceCutType}
        />

        {/* Open Pacific (Sanriku): a static, non-interactive context sea filling
            the seaward open-water cells out to the box edge — distinct from the
            interactive bay volume. Not clickable, not week-coloured, not legended. */}
        <OpenSeaMesh
          sliceMode={dashboardState}
          sliceLevel={sliceLevel}
          sliceDir={sliceDir}
          sliceCutType={sliceCutType}
        />

        <RiverGrid
          week={week}
          colorScale={colorScale}
          sliceMode={dashboardState}
          sliceLevel={sliceLevel}
          sliceDir={sliceDir}
          sliceCutType={sliceCutType}
        />

        <RiverSeabedMesh
          sliceMode={dashboardState}
          sliceLevel={sliceLevel}
          sliceDir={sliceDir}
          sliceCutType={sliceCutType}
        />

        {/* Bounding box + grid: toggleable */}
        {showAnnotations && <BoundingBox />}
        {showAnnotations && <GridFloor />}

        {/* Compass: always visible */}
        <CompassLabels />

        {/* Static context label over the open Pacific (toggles with annotations,
            never interactive). Sits east of the bay at the sea surface. */}
        {showAnnotations && <OpenSeaLabel />}

        {/* Coordinate ticks (X/Y/Z values): toggleable */}
        {showAnnotations && <CoordTickLabels />}

        {/* Smooth interpolated gradient painted on the exposed cut face, so the
            section reads as a clean scientific cross-section instead of blocky
            voxel sides. Renders only when a slice is active AND the cut-face
            mode is "heatmap"; in "voxels" mode it's hidden so the raw blocky
            voxel ends carry the section (the voxels stay either way). */}
        {(dashboardState === "slice-h" || dashboardState === "slice-v") && sliceFaceMode === "heatmap" && (
          <SliceFacePlane
            data={faceData}
            stops={faceStops}
            sliceMode={dashboardState}
            sliceLevel={sliceLevel}
            sliceDir={sliceDir}
            sliceCutType={sliceCutType}
          />
        )}

        <SliceIndicator mode={dashboardState} level={sliceLevel} sliceDir={sliceDir} showCutPlane={showCutPlane} />
      </group>

      <OrbitControls
        ref={orbitRef}
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={15}
        maxDistance={220}
        maxPolarAngle={Math.PI / 2.1}
      />
    </Canvas>
  );
}
