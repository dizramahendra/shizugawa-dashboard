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

// ── Color scales (hex) ────────────────────────────────────────────────────────
const COLOR_SCALES: Record<string, string[]> = {
  nitrogen:   ["#2c5f8a","#3d6fa0","#6a9fc0","#90c4de","#c5dfe8","#f5f0d8","#f0d090","#e8a030","#d45820","#c8401c"],
  phosphorus: ["#1a6b4a","#2d8a5e","#4da876","#7ec89a","#b8e0c0","#f0ebb8","#f0d080","#e8a030","#d45820","#c8401c"],
  flow:       ["#0f0527","#1f0a4e","#3a0f7a","#5a1eb0","#7c3ad8","#9d61e8","#bb8ef2","#d4b6f7","#e9d7fb","#f7f0fe"],
  all:        ["#45007e","#2060a0","#168c8c","#35b870","#aadb30","#fce820"],
};

// Physical value ranges for tooltip display (normalized 0-1 → physical unit)
const PHYS: Record<string, { min: number; max: number; unit: string; dec: number }> = {
  nitrogen:   { min: 0.2,  max: 3.0,  unit: "mg/L", dec: 2 },
  phosphorus: { min: 10,   max: 130,  unit: "μg/L", dec: 1 },
  flow:       { min: 0,    max: 80,   unit: "cm/s",  dec: 1 },
};

function toPhysical(val: number, scale: string): string {
  const p = PHYS[scale] ?? PHYS.nitrogen;
  const phys = p.min + val * (p.max - p.min);
  return `${phys.toFixed(p.dec)} ${p.unit}`;
}

// Depth label for a given layer index: "0–2 m", "2–5 m", etc.
const DEPTH_REAL_BOT = [2, 5, 10, 18, 30, 47, 69, 90]; // approx bottom of each layer
function depthLabel(d: number): string {
  return `${DEPTH_REAL_M[d]}–${DEPTH_REAL_BOT[d]} m`;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

function lerpColor(stops: string[], t: number): [number, number, number] {
  const n   = stops.length;
  const idx = Math.min(n - 1, Math.floor(Math.min(1, Math.max(0, t)) * n));
  return hexToRgb(stops[idx]);
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

// ── VoxelGrid ─────────────────────────────────────────────────────────────────
interface VoxelGridProps {
  week: number;
  colorScale: string;
  selectedPoint: { x: number; z: number } | null;
  sliceMode: DashboardState;
  sliceLevel: number;
  sliceAxis: "x" | "z";
  onCellClick: (x: number, z: number) => void;
  onCellHover?: (x: number, z: number) => void;
}

function VoxelGrid({
  week,
  colorScale,
  selectedPoint,
  sliceMode,
  sliceLevel,
  sliceAxis,
  onCellClick,
  onCellHover,
}: VoxelGridProps) {
  const data  = useMemo(() => generateWeekData(week), [week]);
  const stops = COLOR_SCALES[colorScale] ?? COLOR_SCALES.nitrogen;

  const [hovered, setHovered] = useState<HoveredVoxel | null>(null);

  const visibleDepths = useMemo(() => {
    if (sliceMode === "slice-h")
      // Show sliceLevel and everything deeper (below the cut)
      return Array.from({ length: DEPTH_LAYERS - sliceLevel }, (_, i) => sliceLevel + i);
    return Array.from({ length: DEPTH_LAYERS }, (_, i) => i);
  }, [sliceMode, sliceLevel]);

  const meshes: React.ReactElement[] = [];

  for (let gz = 0; gz < GRID_D; gz++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      if (!BAY_MASK[gz]?.[gx]) continue;

      const seabedM   = getBathymetryDepthM(gx, gz);
      const maxLayer  = deepestVisibleLayer(seabedM);
      if (maxLayer < 0) continue;

      // ── Water voxels ────────────────────────────────────────────────────────
      for (const d of visibleDepths) {
        if (d > maxLayer) continue;                          // below bathymetric seabed
        if (sliceMode === "slice-v" && sliceAxis === "x" && gx !== sliceLevel) continue;
        if (sliceMode === "slice-v" && sliceAxis === "z" && gz !== sliceLevel) continue;

        const val = data[gz]?.[gx]?.[d] ?? 0;
        const [r, g, b] = lerpColor(stops, val);

        const isColumnSelected =
          selectedPoint !== null &&
          selectedPoint.x === gx &&
          selectedPoint.z === gz;

        const px = offsetX + gx * STEP + CELL_W / 2;
        const py = Y_SURFACE - DEPTH_TOPS[d] - DEPTH_HEIGHTS[d] / 2;
        const pz = offsetZ + gz * STEP + CELL_W / 2;

        // slice-v shows one voxel deep — solid fills like a cut surface
        const depthOpacity = sliceMode === "slice-v" ? 1.0 : 0.85 - d * 0.02;

        meshes.push(
          <mesh
            key={`${gz}-${gx}-${d}`}
            position={[px, py, pz]}
            onClick={(e) => { e.stopPropagation(); onCellClick(gx, gz); }}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHovered({ px, py, pz, val, depth: d });
              onCellHover?.(gx, gz);
            }}
            onPointerOut={() => setHovered(null)}
          >
            <boxGeometry args={[CELL_W, DEPTH_HEIGHTS[d], CELL_W]} />
            <meshStandardMaterial
              color={
                isColumnSelected
                  ? new THREE.Color(1, 0.9, 0.2)
                  : new THREE.Color(r, g, b)
              }
              transparent={depthOpacity < 1}
              opacity={isColumnSelected ? 1 : depthOpacity}
              roughness={0.7}
              metalness={0.05}
            />
          </mesh>
        );
      }
    }
  }

  return (
    <>
      {meshes}

      {/* Hover tooltip */}
      {hovered && (
        <Html
          position={[hovered.px, hovered.py + 0.15, hovered.pz]}
          center
          distanceFactor={12}
          zIndexRange={[100, 100]}
          style={{ pointerEvents: "none" }}
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
  selectedPoint: { x: number; z: number } | null,
  sliceMode: DashboardState,
  sliceLevel: number,
  sliceAxis: "x" | "z",
): LayerBatch[] {
  const visibleDepths = sliceMode === "slice-h"
    ? Array.from({ length: DEPTH_LAYERS - sliceLevel }, (_, i) => sliceLevel + i)
    : Array.from({ length: DEPTH_LAYERS }, (_, i) => i);

  const batches: LayerBatch[] = Array.from({ length: DEPTH_LAYERS }, (_, d) => ({
    count: 0,
    positions: [],
    rgbs: [],
    opacity: sliceMode === "slice-v" ? 1.0 : 0.85 - d * 0.02,
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
        if (sliceMode === "slice-v" && sliceAxis === "x" && gx !== sliceLevel) continue;
        if (sliceMode === "slice-v" && sliceAxis === "z" && gz !== sliceLevel) continue;

        const val = data[gz]?.[gx]?.[d] ?? 0;
        const isSelected = selectedPoint?.x === gx && selectedPoint?.z === gz;
        const [r, g, b] = isSelected ? [1, 0.9, 0.2] : lerpColor(stops, val);

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

function InstancedDepthLayer({
  depthIdx, batch, onCellClick, onCellHover, onHover,
}: {
  depthIdx: number;
  batch:    LayerBatch;
  onCellClick:  (x: number, z: number) => void;
  onCellHover?: (x: number, z: number) => void;
  onHover: (h: HoveredVoxel | null) => void;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { positions, rgbs, count, opacity } = batch;

  // useLayoutEffect fires synchronously before the first Three.js frame.
  // This guarantees instance matrices are in their correct positions before
  // Three.js computes & caches the bounding sphere for raycasting — fixing a
  // bug where clicks on voxels were silently missed on initial mount because
  // the bounding sphere was cached from identity matrices (all at origin).
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || count === 0) return;
    const m4  = new THREE.Matrix4();
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      m4.setPosition(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      mesh.setMatrixAt(i, m4);
      col.setRGB(rgbs[i * 3], rgbs[i * 3 + 1], rgbs[i * 3 + 2]);
      mesh.setColorAt(i, col);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // Recompute bounding sphere from actual instance positions so raycasting works.
    mesh.computeBoundingSphere();
  }, [positions, rgbs, count]);

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
        const { gx, gz } = batch.meta[iid];
        onCellClick(gx, gz);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        const iid = e.instanceId;
        if (iid == null) return;
        const { gx, gz, val, px, py, pz } = batch.meta[iid];
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
  week, colorScale, selectedPoint, sliceMode, sliceLevel, sliceAxis, onCellClick, onCellHover,
}: VoxelGridProps) {
  const data  = useMemo(() => generateWeekData(week), [week]);
  const stops = COLOR_SCALES[colorScale] ?? COLOR_SCALES.nitrogen;

  const batches = useMemo(
    () => buildBatches(data, stops, selectedPoint, sliceMode, sliceLevel, sliceAxis),
    [data, stops, selectedPoint, sliceMode, sliceLevel, sliceAxis],
  );

  const [hovered, setHovered] = useState<HoveredVoxel | null>(null);

  return (
    <>
      {batches.map((batch, d) => (
        <InstancedDepthLayer
          key={`${d}-${batch.count}`}
          depthIdx={d}
          batch={batch}
          onCellClick={onCellClick}
          onCellHover={onCellHover}
          onHover={setHovered}
        />
      ))}

      {hovered && (
        <Html
          position={[hovered.px, hovered.py + 0.15, hovered.pz]}
          center
          distanceFactor={12}
          zIndexRange={[100, 100]}
          style={{ pointerEvents: "none" }}
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
  sliceAxis,
}: {
  sliceMode: DashboardState;
  sliceLevel: number;
  sliceAxis: "x" | "z";
}) {
  const geometry = useMemo(() => {
    const Y_BOT = BOX_BOT;

    // In slice-h mode, everything above this Y is hidden (top of the selected layer)
    const sliceClipY = sliceMode === "slice-h"
      ? Y_SURFACE - DEPTH_TOPS[sliceLevel]
      : Infinity;  // no clip

    // Is cell (gx, gz) part of the rendered solid?
    function shouldRender(gx: number, gz: number): boolean {
      if (!BAY_MASK[gz]?.[gx]) return false;
      if (sliceMode === "slice-v") {
        return sliceAxis === "x" ? gx === sliceLevel : gz === sliceLevel;
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

        // ── Bottom face (flat at Y_BOT, faces downward) ───────────────────────
        const b00 = addVert(x0, Y_BOT, z0);
        const b10 = addVert(x1, Y_BOT, z0);
        const b01 = addVert(x0, Y_BOT, z1);
        const b11 = addVert(x1, Y_BOT, z1);
        indices.push(b00, b10, b11,  b00, b11, b01);

        // ── Side walls — only on boundaries (neighbour not renderable) ────────

        // West face (-X): x=x0, z0→z1
        if (!shouldRender(gx - 1, gz)) {
          const a = addVert(x0, y00, z0); const b = addVert(x0, Y_BOT, z0);
          const c = addVert(x0, Y_BOT, z1); const d = addVert(x0, y01, z1);
          indices.push(a, b, c,  a, c, d);
        }
        // East face (+X): x=x1, z0→z1
        if (!shouldRender(gx + 1, gz)) {
          const a = addVert(x1, y10, z0); const b = addVert(x1, Y_BOT, z0);
          const c = addVert(x1, Y_BOT, z1); const d = addVert(x1, y11, z1);
          indices.push(a, c, b,  a, d, c);
        }
        // North face (-Z): z=z0, x0→x1
        if (!shouldRender(gx, gz - 1)) {
          const a = addVert(x0, y00, z0); const b = addVert(x0, Y_BOT, z0);
          const c = addVert(x1, Y_BOT, z0); const d = addVert(x1, y10, z0);
          indices.push(a, c, b,  a, d, c);
        }
        // South face (+Z): z=z1, x0→x1
        if (!shouldRender(gx, gz + 1)) {
          const a = addVert(x0, y01, z1); const b = addVert(x0, Y_BOT, z1);
          const c = addVert(x1, Y_BOT, z1); const d = addVert(x1, y11, z1);
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
  }, [sliceMode, sliceLevel, sliceAxis]);

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
  sliceAxis,
}: {
  sliceMode: DashboardState;
  sliceLevel: number;
  sliceAxis: "x" | "z";
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
        return sliceAxis === "x" ? gx === sliceLevel : gz === sliceLevel;
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
  }, [sliceMode, sliceLevel, sliceAxis]);

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
  sliceAxis,
}: {
  week: number;
  colorScale: string;
  sliceMode: DashboardState;
  sliceLevel: number;
  sliceAxis: "x" | "z";
}) {
  const data  = useMemo(() => generateWeekData(week), [week]);
  const stops = COLOR_SCALES[colorScale] ?? COLOR_SCALES.nitrogen;

  // Hover state — which river group is under the pointer
  const [hoveredId, setHoveredId]  = useState<string | null>(null);
  const [hoverPos,  setHoverPos]   = useState<[number, number, number]>([0, 0, 0]);

  // Uniform colour: mean surface value across all active bay cells so every
  // river tile gets the same flat colour regardless of upstream position.
  const uniformVal = useMemo(() => {
    let sum = 0, cnt = 0;
    for (let gz = 0; gz < GRID_D; gz++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        if (BAY_MASK[gz]?.[gx]) { sum += data[gz]?.[gx]?.[0] ?? 0.5; cnt++; }
      }
    }
    return cnt > 0 ? sum / cnt : 0.5;
  }, [data]);

  const [ur, ug, ub] = lerpColor(stops, uniformVal);

  const elements: React.ReactNode[] = [];

  for (let ri = 0; ri < RIVER_CELLS.length; ri++) {
    const { gx, gz, riverId } = RIVER_CELLS[ri];
    // Slice filtering
    // Horizontal: river water lives at layer 0 — hide it when the slice is below that
    if (sliceMode === "slice-h" && sliceLevel !== 0) continue;
    // Vertical: keep only the cell column/row at the slice position
    if (sliceMode === "slice-v") {
      if (sliceAxis === "x" && gx !== sliceLevel) continue;
      if (sliceAxis === "z" && gz !== sliceLevel) continue;
    }

    const isHov = hoveredId === riverId;
    // Slightly brighten hovered river cells
    const [r, g, b] = isHov
      ? [Math.min(1, ur + 0.25), Math.min(1, ug + 0.25), Math.min(1, ub + 0.25)]
      : [ur, ug, ub];

    const px = offsetX + gx * STEP + CELL_W / 2;
    const pz = offsetZ + gz * STEP + CELL_W / 2;
    const py = Y_SURFACE - DEPTH_TOPS[0] - DEPTH_HEIGHTS[0] / 2;

    // River cells render exactly one surface water layer
    const depthOpacity = sliceMode === "slice-v" ? 1.0 : 0.85;
    elements.push(
      <mesh
        key={`rv-${ri}`}
        position={[px, py, pz]}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHoveredId(riverId);
          setHoverPos([px, py + DEPTH_HEIGHTS[0] * 0.5 + 0.3, pz]);
        }}
        onPointerOut={() => setHoveredId(null)}
      >
        <boxGeometry args={[CELL_W, DEPTH_HEIGHTS[0], CELL_W]} />
        <meshStandardMaterial
          color={new THREE.Color(r, g, b)}
          transparent={depthOpacity < 1}
          opacity={depthOpacity}
          roughness={0.7}
          metalness={0.05}
        />
      </mesh>
    );
  }

  // Hover tooltip — rendered once at the position of the last hovered cell
  const meta = hoveredId ? RIVER_META[hoveredId] : null;

  return (
    <>
      {elements}
      {meta && (
        <Html position={hoverPos} center zIndexRange={[200, 0]}>
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
function ScaledLabel({
  position,
  children,
  center,
  zIndexRange,
  baseDistance = 18,
  minScale = 0.55,
  maxScale = 2.2,
}: {
  position: [number, number, number];
  children: React.ReactNode;
  center?: boolean;
  zIndexRange?: [number, number];
  baseDistance?: number;
  minScale?: number;
  maxScale?: number;
}) {
  const { camera } = useThree();
  const wrapRef  = useRef<HTMLDivElement>(null);
  const posVec   = useRef(new THREE.Vector3(...position));

  useFrame(() => {
    if (!wrapRef.current) return;
    const dist = camera.position.distanceTo(posVec.current);
    const raw  = baseDistance / Math.max(dist, 0.01);
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

// Always-visible N/W/S/E compass labels
function CompassLabels() {
  return (
    <>
      <ScaledLabel position={[0, BOX_TOP + 0.6, BOX_NORTH_Z]} center zIndexRange={[0,0]}>
        <div style={COMPASS_STYLE}>N</div>
      </ScaledLabel>
      <ScaledLabel position={[0, BOX_TOP + 0.6, BOX_SOUTH_Z]} center zIndexRange={[0,0]}>
        <div style={COMPASS_STYLE}>S</div>
      </ScaledLabel>
      <ScaledLabel position={[BOX_EAST_X, BOX_TOP + 0.6, 0]} center zIndexRange={[0,0]}>
        <div style={COMPASS_STYLE}>E</div>
      </ScaledLabel>
      <ScaledLabel position={[BOX_WEST_X, BOX_TOP + 0.6, 0]} center zIndexRange={[0,0]}>
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
  sliceAxis: "x" | "z";
}

function SliceIndicator({ mode, level, sliceAxis }: SliceIndicatorProps) {
  if (mode === "slice-h") {
    const y = Y_SURFACE - DEPTH_TOPS[level] - DEPTH_HEIGHTS[level] / 2;
    return (
      <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[GRID_W * STEP, GRID_D * STEP]} />
        <meshStandardMaterial color="#4a90d9" opacity={0.08} transparent side={THREE.DoubleSide} />
      </mesh>
    );
  }
  if (mode === "slice-v" && sliceAxis === "x") {
    const x = offsetX + level * STEP + STEP / 2;
    // Outline only — invisible fill so voxel colours show through unobstructed
    return (
      <mesh position={[x, BOX_CY, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[GRID_D * STEP, BOX_H]} />
        <meshStandardMaterial transparent opacity={0} depthWrite={false} depthTest={false} side={THREE.DoubleSide} />
        <Edges color="#f59e0b" threshold={1} />
      </mesh>
    );
  }
  if (mode === "slice-v" && sliceAxis === "z") {
    const z = offsetZ + level * STEP + STEP / 2;
    return (
      <mesh position={[0, BOX_CY, z]}>
        <planeGeometry args={[GRID_W * STEP, BOX_H]} />
        <meshStandardMaterial transparent opacity={0} depthWrite={false} depthTest={false} side={THREE.DoubleSide} />
        <Edges color="#f59e0b" threshold={1} />
      </mesh>
    );
  }
  return null;
}

// ── Main component ────────────────────────────────────────────────────────────
interface OceanBasin3DProps {
  week: number;
  colorScale: string;
  dashboardState: DashboardState;
  selectedPoint: { x: number; z: number } | null;
  sliceLevel: number;
  sliceAxis: "x" | "z";
  onCellClick: (x: number, z: number) => void;
  onCellHover?: (x: number, z: number) => void;
  showAnnotations?: boolean;
}

export default function OceanBasin3D({
  week,
  colorScale,
  dashboardState,
  selectedPoint,
  sliceLevel,
  sliceAxis,
  onCellClick,
  onCellHover,
  showAnnotations = true,
}: OceanBasin3DProps) {
  const voxelProps: VoxelGridProps = {
    week,
    colorScale,
    selectedPoint,
    sliceMode: dashboardState,
    sliceLevel,
    sliceAxis,
    onCellClick,
    onCellHover,
  };

  return (
    <Canvas
      camera={{ position: [38, 22, 46], fov: 38 }}
      style={{ background: "#f8f9fa" }}
      data-testid="canvas-3d"
    >
      <ambientLight intensity={0.8} />
      <directionalLight position={[10, 15, 10]} intensity={0.7} castShadow />
      <directionalLight position={[-5, 8, -5]} intensity={0.3} color="#b0c8e0" />

      {/* Z-flip group: negates all scene Z so gz=0(south)→+Z, gz=95(north)→−Z */}
      <group scale={[1, 1, -1]}>
        <VoxelGridInstanced {...voxelProps} />

        <SeabedMesh
          sliceMode={dashboardState}
          sliceLevel={sliceLevel}
          sliceAxis={sliceAxis}
        />

        <RiverGrid
          week={week}
          colorScale={colorScale}
          sliceMode={dashboardState}
          sliceLevel={sliceLevel}
          sliceAxis={sliceAxis}
        />

        <RiverSeabedMesh
          sliceMode={dashboardState}
          sliceLevel={sliceLevel}
          sliceAxis={sliceAxis}
        />

        {/* Bounding box + grid: toggleable */}
        {showAnnotations && <BoundingBox />}
        {showAnnotations && <GridFloor />}

        {/* Compass: always visible */}
        <CompassLabels />

        {/* Coordinate ticks (X/Y/Z values): toggleable */}
        {showAnnotations && <CoordTickLabels />}

        <SliceIndicator mode={dashboardState} level={sliceLevel} sliceAxis={sliceAxis} />
      </group>

      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={15}
        maxDistance={95}
        maxPolarAngle={Math.PI / 2.1}
      />
    </Canvas>
  );
}
