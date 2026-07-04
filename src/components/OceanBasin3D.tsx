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
  DEPTH_LAYERS,
  DEPTH_HEIGHTS,
  DEPTH_TOPS,
  DEPTH_REAL_M,
  DEPTH_TOTAL_H,
  generateWeekData,
  generateRiverData,
  RIVER_COLS,
  RIVER_ROWS,
  DashboardState,
} from "@/lib/simulatedData";

// ── Scene layout constants ────────────────────────────────────────────────────
const STEP   = 0.5;    // scene units per grid cell (112×96 grid, same physical bay size)
const CELL_W = STEP;   // fill every cell completely — zero gap between voxels

const offsetX = -(GRID_W * STEP) / 2;  // centre the grid
const offsetZ = -(GRID_D * STEP) / 2;

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

// Depth label for a given layer index: "0–2 m", "2–5 m", etc.
const DEPTH_REAL_BOT = [2, 5, 10, 18, 30, 47, 69, 90]; // approx bottom of each layer
export function depthLabel(d: number): string {
  return `${DEPTH_REAL_M[d]}–${DEPTH_REAL_BOT[d]} m`;
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

// ── Bathymetry ────────────────────────────────────────────────────────────────
// Linear east-deep profile: depth increases from west (~8 m) to east (~55 m,
// open-ocean side).  No river enters from the east.  A gentle N-S taper makes
// the northern/southern edges slightly shallower than the centre channel.
function getBathymetryDepthM(gx: number, gz: number): number {
  const frac   = gx / (GRID_W - 1);          // 0 = west (shallow), 1 = east (deep)
  const nsFrac = gz / (GRID_D - 1);
  const nsBias = 1 - 0.18 * Math.abs(nsFrac - 0.5) * 2;
  return Math.min(55, Math.max(3, (8 + 47 * frac) * nsBias));
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
      if (!BAY_MASK[gz]?.[gx]) continue;
      let found = false;
      for (let r = 1; r <= DEPTH_LAYERS && !found; r++) {
        for (let dz = -r; dz <= r && !found; dz++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // ring only
            const nz = gz + dz, nx = gx + dx;
            if (nz < 0 || nz >= GRID_D || nx < 0 || nx >= GRID_W || !BAY_MASK[nz]?.[nx]) {
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
  opacity:   number;
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
  selectedPoint: { x: number; z: number; y?: number } | null,
  sliceMode: DashboardState,
  sliceLevel: number,
  sliceDir: SliceDir,
  sliceCutType: SliceCutType,
  markerPixels?: Map<string, [number, number, number]>,
): LayerBatch[] {
  const visibleDepths = sliceMode === "slice-h"
    ? Array.from({ length: DEPTH_LAYERS - sliceLevel }, (_, i) => sliceLevel + i)
    : Array.from({ length: DEPTH_LAYERS }, (_, i) => i);

  const batches: LayerBatch[] = Array.from({ length: DEPTH_LAYERS }, (_, d) => ({
    count: 0,
    positions: [],
    rgbs: [],
    opacity: 0.85 - d * 0.02,
    meta: [],
  }));

  for (let gz = 0; gz < GRID_D; gz++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      if (!BAY_MASK[gz]?.[gx]) continue;
      const seabedM  = getBathymetryDepthM(gx, gz);
      const maxLayer = deepestVisibleLayer(seabedM);
      if (maxLayer < 0) continue;

      for (const d of visibleDepths) {
        if (d > maxLayer) continue;
        if (sliceMode === "slice-v" && !isVoxelVisible(gx, gz, sliceDir, sliceLevel, sliceCutType)) continue;

        const val = data[gz]?.[gx]?.[d] ?? 0;
        // Voxel highlight (point-select): only the exact (gx,gz,d) glows.
        // Column highlight (depth-graph or no y): whole column glows.
        const colMatch = selectedPoint?.x === gx && selectedPoint?.z === gz;
        const isSelected = colMatch && (selectedPoint?.y === undefined || selectedPoint?.y === d);
        const markerColor = markerPixels?.get(`${gx}:${gz}`);
        const [r, g, b] = markerColor && d === 0
          ? markerColor
          : isSelected
            ? [1, 0.9, 0.2]
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
  depthIdx, toBatch, fromBatchesRef, toBatchesRef, progressRef, onCellClick, onCellHover, onHover,
}: {
  depthIdx: number;
  toBatch:  LayerBatch;
  fromBatchesRef: React.MutableRefObject<LayerBatch[]>;
  toBatchesRef:   React.MutableRefObject<LayerBatch[]>;
  progressRef:    React.MutableRefObject<number>;
  onCellClick:  (x: number, z: number, y: number) => void;
  onCellHover?: (x: number, z: number) => void;
  onHover: (h: HoveredVoxel | null) => void;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { positions, count, opacity } = toBatch;
  const lastToRef = useRef<LayerBatch | null>(null);
  const lastAppliedRef = useRef(1);
  const seededRef = useRef(false);

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
    if (settled && !toChanged && lastAppliedRef.current >= 1) return; // nothing changed — skip work

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
      col.setRGB(r, g, b);
      mesh.setColorAt(i, col);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    lastToRef.current = to;
    lastAppliedRef.current = settled ? 1 : progress;
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
      <meshStandardMaterial
        roughness={0.7}
        metalness={0.05}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </instancedMesh>
  );
}

function VoxelGridInstanced({
  week, colorScale, selectedPoint, sliceMode, sliceLevel, sliceDir, sliceCutType, onCellClick, onCellHover, markerPixels, transitionMs = 650,
}: VoxelGridProps & { markerPixels?: Map<string, [number, number, number]>; transitionMs?: number }) {
  const data  = useMemo(() => generateWeekData(week), [week]);
  const stops = COLOR_SCALES[colorScale] ?? COLOR_SCALES.nitrogen;

  const batches = useMemo(
    () => buildBatches(data, stops, selectedPoint, sliceMode, sliceLevel, sliceDir, sliceCutType, markerPixels),
    [data, stops, selectedPoint, sliceMode, sliceLevel, sliceDir, sliceCutType, markerPixels],
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
      // Structural change (slice, selection, colour scale, markers) — snap.
      toBatchesRef.current = batches;
      progressRef.current = 1;
    }
    invalidate(); // render this change under the demand frameloop
  }, [batches, week, invalidate]);

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

// ── Volumetric seabed solid ───────────────────────────────────────────────────
// A closed solid that fills from the bathymetric seabed contour down to the
// absolute bottom of the bounding cube (BOX_BOT), making the overall 3-D model
// read as a complete block — water voxels sit in the bowl carved into the top.
//
// Geometry per active cell:
//   • Top face   — 4 corners at true seabed depth (averaged for smooth contour)
//   • Bottom face — flat quad at BOX_BOT
//   • Side walls  — vertical quads on every edge where the neighbour is NOT an
//                   active (renderable) cell, i.e. the shoreline / slice cut face
//
// Vertex colour: sandy tan (shallow/top) → dark muddy brown (deep/bottom)
function SeabedMesh({
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
    // In slice-h mode, everything above this Y is hidden (top of the selected layer)
    const sliceClipY = sliceMode === "slice-h"
      ? Y_SURFACE - DEPTH_TOPS[sliceLevel]
      : Infinity;  // no clip

    // Is cell (gx, gz) part of the rendered solid?
    function shouldRender(gx: number, gz: number): boolean {
      if (!BAY_MASK[gz]?.[gx]) return false;
      if (sliceMode === "slice-v") {
        return isVoxelVisible(gx, gz, sliceDir, sliceLevel, sliceCutType);
      }
      return true;
    }

    // Scene-Y at the seabed for cell (gx, gz) — matches VoxelGrid's maxLayer exactly
    // so the seabed solid top always kisses the bottom of the deepest water voxel.
    function seabedSceneY(gx: number, gz: number): number {
      const seabedM  = getBathymetryDepthM(gx, gz);
      const maxLayer = deepestVisibleLayer(seabedM);
      if (maxLayer < 0) return Y_SURFACE;
      return Y_SURFACE - DEPTH_TOPS[maxLayer] - DEPTH_HEIGHTS[maxLayer];
    }

    // Smooth terrain-corner Y: average seabedSceneY of up to 4 adjacent active cells,
    // then clip at the horizontal slice plane so the solid doesn't poke above the cut.
    function cornerY(gx: number, gz: number): number {
      let sumY = 0, cnt = 0;
      for (let dz = -1; dz <= 0; dz++) {
        for (let dx = -1; dx <= 0; dx++) {
          const nx = gx + dx, nz = gz + dz;
          if (nx >= 0 && nx < GRID_W && nz >= 0 && nz < GRID_D && BAY_MASK[nz]?.[nx]) {
            const sy = seabedSceneY(nx, nz);
            if (isFinite(sy)) { sumY += sy; cnt++; }
          }
        }
      }
      const fallback = isFinite(Y_SURFACE - DEPTH_TOTAL_H) ? Y_SURFACE - DEPTH_TOTAL_H : -6.85;
      const rawY = cnt > 0 ? sumY / cnt : fallback;
      const clip = isFinite(sliceClipY) ? sliceClipY : Infinity;
      return Math.min(rawY, clip);  // clip top at the slice plane
    }

    const positions: number[] = [];
    const colors:    number[] = [];
    const indices:   number[] = [];

    // Vertex colour: depthT=0 → sandy tan top, depthT=1 → dark muddy brown base
    function dT(y: number): number {
      return Math.max(0, Math.min(1, (Y_SURFACE - y) / DEPTH_TOTAL_H));
    }
    function addVert(px: number, py: number, pz: number): number {
      const t = dT(py);
      positions.push(px, py, pz);
      colors.push(0.66 - t * 0.32, 0.52 - t * 0.26, 0.34 - t * 0.16);
      return (positions.length / 3) - 1;
    }

    for (let gz = 0; gz < GRID_D; gz++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        if (!shouldRender(gx, gz)) continue;

        const x0 = offsetX + gx       * STEP;
        const x1 = offsetX + (gx + 1) * STEP;
        const z0 = offsetZ + gz       * STEP;
        const z1 = offsetZ + (gz + 1) * STEP;

        // Terrain Y at each top corner (smooth)
        const y00 = cornerY(gx,     gz);
        const y10 = cornerY(gx + 1, gz);
        const y01 = cornerY(gx,     gz + 1);
        const y11 = cornerY(gx + 1, gz + 1);

        // ── Top face (terrain surface, faces upward) ──────────────────────────
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

        // ── Side walls — only on boundaries (neighbour not renderable) ────────

        // West face (-X): x=x0, z0→z1
        if (!shouldRender(gx - 1, gz)) {
          const a = addVert(x0, y00, z0); const b = addVert(x0, BOX_BOT, z0);
          const c = addVert(x0, BOX_BOT, z1); const d = addVert(x0, y01, z1);
          indices.push(a, b, c,  a, c, d);
        }
        // East face (+X): x=x1, z0→z1
        if (!shouldRender(gx + 1, gz)) {
          const a = addVert(x1, y10, z0); const b = addVert(x1, BOX_BOT, z0);
          const c = addVert(x1, BOX_BOT, z1); const d = addVert(x1, y11, z1);
          indices.push(a, c, b,  a, d, c);
        }
        // North face (-Z): z=z0, x0→x1
        if (!shouldRender(gx, gz - 1)) {
          const a = addVert(x0, y00, z0); const b = addVert(x0, BOX_BOT, z0);
          const c = addVert(x1, BOX_BOT, z0); const d = addVert(x1, y10, z0);
          indices.push(a, c, b,  a, d, c);
        }
        // South face (+Z): z=z1, x0→x1
        if (!shouldRender(gx, gz + 1)) {
          const a = addVert(x0, y01, z1); const b = addVert(x0, BOX_BOT, z1);
          const c = addVert(x1, BOX_BOT, z1); const d = addVert(x1, y11, z1);
          indices.push(a, b, c,  a, c, d);
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
  }, [sliceMode, sliceLevel, sliceDir, sliceCutType]);

  if (!geometry) return null;
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        vertexColors
        roughness={0.88}
        metalness={0.04}
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
    // River water only exists at layer 0; return empty geometry for deeper horizontal slices
    if (sliceMode === "slice-h" && sliceLevel > 0) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
      g.setAttribute("color",    new THREE.Float32BufferAttribute([], 3));
      return g;
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

    function dT(y: number): number {
      return Math.max(0, Math.min(1, (Y_SURFACE - y) / DEPTH_TOTAL_H));
    }
    function addVert(px: number, py: number, pz: number): number {
      const t = dT(py);
      positions.push(px, py, pz);
      colors.push(0.66 - t * 0.32, 0.52 - t * 0.26, 0.34 - t * 0.16);
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
          <meshStandardMaterial transparent opacity={0.85} roughness={0.7} metalness={0.05} />
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
  onCellClick: (x: number, z: number, y: number) => void;
  onCellHover?: (x: number, z: number) => void;
  showAnnotations?: boolean;
  cameraPreset?: string;
  cameraPresetTick?: number;
  markerPixels?: { x: number; z: number; color: string }[];
  speed?: number;
  isPlaying?: boolean;
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
  onCellClick,
  onCellHover,
  showAnnotations = true,
  cameraPreset = "top",
  cameraPresetTick = 0,
  markerPixels,
  speed = 1,
  isPlaying = false,
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

  return (
    <Canvas
      frameloop={frameloop}
      camera={{ position: [0, 92, 8], fov: 38 }}
      style={{ background: "#f8f9fa" }}
      data-testid="canvas-3d"
    >
      <CameraController preset={cameraPreset} tick={cameraPresetTick} orbitRef={orbitRef} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[10, 15, 10]} intensity={0.7} castShadow />
      <directionalLight position={[-5, 8, -5]} intensity={0.3} color="#b0c8e0" />

      {/* Z-flip group: negates all scene Z so gz=0(south)→+Z, gz=95(north)→−Z */}
      <group scale={[1, 1, -1]}>
        <VoxelGridInstanced {...voxelProps} markerPixels={markerMap} transitionMs={transitionMs} />

        <SeabedMesh
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

        {/* Coordinate ticks (X/Y/Z values): toggleable */}
        {showAnnotations && <CoordTickLabels />}

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
