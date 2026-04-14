import { useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html, Edges } from "@react-three/drei";
import * as THREE from "three";
import {
  BAY_MASK,
  RIVER_CELLS,
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
const STEP   = 1.0;    // scene units per grid cell
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
// Shizugawa Bay: bay mouth around (gx≈11, gz≈6); inner head is NW.
// Returns simulated seabed depth in real meters (3–42 m).
function getBathymetryDepthM(gx: number, gz: number): number {
  const dx   = (gx - 22) / GRID_W;   // mouth ≈ gx 22 in 28-cell grid
  const dz   = (gz - 12) / GRID_D;   // mouth ≈ gz 12 in 24-cell grid
  const dist = Math.sqrt(dx * dx + dz * dz);
  return Math.min(42, Math.max(3, 38 * Math.exp(-dist * 2.8) + 4));
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
  onCellClick: (x: number, z: number) => void;
  onCellHover?: (x: number, z: number) => void;
}

function VoxelGrid({
  week,
  colorScale,
  selectedPoint,
  sliceMode,
  sliceLevel,
  onCellClick,
  onCellHover,
}: VoxelGridProps) {
  const data  = useMemo(() => generateWeekData(week), [week]);
  const stops = COLOR_SCALES[colorScale] ?? COLOR_SCALES.nitrogen;

  const [hovered, setHovered] = useState<HoveredVoxel | null>(null);

  const visibleDepths = useMemo(() => {
    if (sliceMode === "slice-h") return [sliceLevel];
    return Array.from({ length: DEPTH_LAYERS }, (_, i) => i);
  }, [sliceMode, sliceLevel]);

  const meshes: React.ReactElement[] = [];
  const seabedBoxes: React.ReactElement[] = [];

  for (let gz = 0; gz < GRID_D; gz++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      if (!BAY_MASK[gz]?.[gx]) continue;

      const seabedM   = getBathymetryDepthM(gx, gz);
      const maxLayer  = deepestVisibleLayer(seabedM);
      if (maxLayer < 0) continue;

      // ── Seabed box ──────────────────────────────────────────────────────────
      const sbTop    = DEPTH_TOPS[maxLayer] + DEPTH_HEIGHTS[maxLayer];
      const sbHeight = 0.18;
      const sbY      = Y_SURFACE - sbTop - sbHeight / 2;
      const sbX      = offsetX + gx * STEP + CELL_W / 2;
      const sbZ      = offsetZ + gz * STEP + CELL_W / 2;

      seabedBoxes.push(
        <mesh key={`sb-${gz}-${gx}`} position={[sbX, sbY, sbZ]}>
          <boxGeometry args={[CELL_W * 1.15, sbHeight, CELL_W * 1.15]} />
          <meshStandardMaterial color="#9c7a52" roughness={0.95} metalness={0.0} />
        </mesh>
      );

      // ── Water voxels ────────────────────────────────────────────────────────
      for (const d of visibleDepths) {
        if (d > maxLayer) continue;                          // below seabed
        if (sliceMode === "slice-v" && gx !== sliceLevel) continue;

        const val = data[gz]?.[gx]?.[d] ?? 0;
        const [r, g, b] = lerpColor(stops, val);

        const isColumnSelected =
          selectedPoint !== null &&
          selectedPoint.x === gx &&
          selectedPoint.z === gz;

        const px = offsetX + gx * STEP + CELL_W / 2;
        const py = Y_SURFACE - DEPTH_TOPS[d] - DEPTH_HEIGHTS[d] / 2;
        const pz = offsetZ + gz * STEP + CELL_W / 2;

        const depthOpacity = 1 - d * 0.08;

        meshes.push(
          <mesh
            key={`${gz}-${gx}-${d}`}
            position={[px, py, pz]}
            onClick={
              d === 0
                ? (e) => { e.stopPropagation(); onCellClick(gx, gz); }
                : undefined
            }
            onPointerOver={(e) => {
              e.stopPropagation();
              setHovered({ px, py, pz, val, depth: d });
              if (d === 0) onCellHover?.(gx, gz);
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
              transparent
              opacity={isColumnSelected ? 1 : depthOpacity * 0.88}
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
      {seabedBoxes}

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

// ── River voxels (single-layer, gz ≥ 24, north of bay) ───────────────────────
function RiverGrid({ week, colorScale }: { week: number; colorScale: string }) {
  const data  = useMemo(() => generateWeekData(week), [week]);
  const stops = COLOR_SCALES[colorScale] ?? COLOR_SCALES.nitrogen;

  const RIVER_H = DEPTH_HEIGHTS[0];                  // same height as top bay layer
  const riverY  = Y_SURFACE - RIVER_H / 2;           // top face flush with bay surface

  return (
    <>
      {RIVER_CELLS.map(({ gx, gz, mouthGx }) => {
        // Sample top-layer value from bay mouth row (gz=23 ≡ GRID_D-1)
        const baseVal = data[GRID_D - 1]?.[mouthGx]?.[0] ?? 0.5;
        // Amplify: deeper upstream = higher nutrient concentration
        const amp  = 1 + (gz - GRID_D) * 0.1;
        const val  = Math.min(1, Math.max(0, baseVal * amp));
        const [r, g, b] = lerpColor(stops, val);

        const px = offsetX + gx * STEP + CELL_W / 2;
        const pz = offsetZ + gz * STEP + CELL_W / 2;

        return (
          <mesh key={`rv-${gz}-${gx}`} position={[px, riverY, pz]}>
            <boxGeometry args={[CELL_W, RIVER_H, CELL_W]} />
            <meshStandardMaterial
              color={new THREE.Color(r, g, b)}
              transparent
              opacity={0.88}
              roughness={0.65}
              metalness={0.05}
            />
          </mesh>
        );
      })}
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
  fontSize: "9px",
  color: "#333",
  whiteSpace: "nowrap",
  pointerEvents: "none",
  userSelect: "none",
};

const COMPASS_STYLE: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: "11px",
  fontWeight: "bold",
  color: "#222",
  pointerEvents: "none",
  userSelect: "none",
};

function AxisLabels() {
  const lonTicks: React.ReactElement[] = [];
  const latTicks: React.ReactElement[] = [];
  const depthTicks: React.ReactElement[] = [];

  // Longitude ticks — south bottom edge
  for (const gx of [0, 7, 14, 21, 27]) {
    const lon   = BAY_LON_W + (gx / (GRID_W - 1)) * (BAY_LON_E - BAY_LON_W);
    const scenX = offsetX + gx * STEP + CELL_W / 2;
    lonTicks.push(
      <Html key={`lon-${gx}`} position={[scenX, BOX_BOT - 0.7, BOX_SOUTH_Z]} center distanceFactor={12} zIndexRange={[0,0]}>
        <div style={LABEL_STYLE}>{lon.toFixed(3)}°E</div>
      </Html>
    );
  }

  // Latitude ticks — west bottom edge
  for (const gz of [0, 5, 10, 15, 20, 23]) {
    const lat   = BAY_LAT_S + (gz / (GRID_D - 1)) * (BAY_LAT_N - BAY_LAT_S);
    const scenZ = offsetZ + gz * STEP + CELL_W / 2;
    latTicks.push(
      <Html key={`lat-${gz}`} position={[BOX_WEST_X, BOX_BOT - 0.7, scenZ]} center distanceFactor={12} zIndexRange={[0,0]}>
        <div style={LABEL_STYLE}>{lat.toFixed(3)}°N</div>
      </Html>
    );
  }

  // Depth ticks — SW vertical edge
  for (let d = 0; d < DEPTH_LAYERS; d++) {
    const y = Y_SURFACE - DEPTH_TOPS[d];
    depthTicks.push(
      <Html key={`dep-${d}`} position={[DEPTH_LABEL_X, y, BOX_SOUTH_Z]} center distanceFactor={12} zIndexRange={[0,0]}>
        <div style={LABEL_STYLE}>{DEPTH_REAL_M[d]}m</div>
      </Html>
    );
  }

  return (
    <>
      <Html position={[0, BOX_TOP + 0.6, BOX_NORTH_Z]} center distanceFactor={12} zIndexRange={[0,0]}>
        <div style={COMPASS_STYLE}>N</div>
      </Html>
      <Html position={[0, BOX_TOP + 0.6, BOX_SOUTH_Z]} center distanceFactor={12} zIndexRange={[0,0]}>
        <div style={COMPASS_STYLE}>S</div>
      </Html>
      <Html position={[BOX_EAST_X, BOX_TOP + 0.6, 0]} center distanceFactor={12} zIndexRange={[0,0]}>
        <div style={COMPASS_STYLE}>E</div>
      </Html>
      <Html position={[BOX_WEST_X, BOX_TOP + 0.6, 0]} center distanceFactor={12} zIndexRange={[0,0]}>
        <div style={COMPASS_STYLE}>W</div>
      </Html>
      {lonTicks}
      {latTicks}
      {depthTicks}
    </>
  );
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
}

function SliceIndicator({ mode, level }: SliceIndicatorProps) {
  if (mode === "slice-h") {
    const y = Y_SURFACE - DEPTH_TOPS[level] - DEPTH_HEIGHTS[level] / 2;
    return (
      <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[GRID_W * STEP, GRID_D * STEP]} />
        <meshStandardMaterial color="#4a90d9" opacity={0.08} transparent side={THREE.DoubleSide} />
      </mesh>
    );
  }
  if (mode === "slice-v") {
    const x = offsetX + level * STEP + STEP / 2;
    return (
      <mesh position={[x, BOX_CY, 0]}>
        <planeGeometry args={[0.05, BOX_H, DEPTH_LAYERS, GRID_D]} />
        <meshStandardMaterial color="#4a90d9" opacity={0.12} transparent side={THREE.DoubleSide} />
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
  onCellClick: (x: number, z: number) => void;
  onCellHover?: (x: number, z: number) => void;
}

export default function OceanBasin3D({
  week,
  colorScale,
  dashboardState,
  selectedPoint,
  sliceLevel,
  onCellClick,
  onCellHover,
}: OceanBasin3DProps) {
  return (
    <Canvas
      camera={{ position: [38, 22, 46], fov: 38 }}
      style={{ background: "#f8f9fa" }}
      data-testid="canvas-3d"
    >
      <ambientLight intensity={0.8} />
      <directionalLight position={[10, 15, 10]} intensity={0.7} castShadow />
      <directionalLight position={[-5, 8, -5]} intensity={0.3} color="#b0c8e0" />

      <VoxelGrid
        week={week}
        colorScale={colorScale}
        selectedPoint={selectedPoint}
        sliceMode={dashboardState}
        sliceLevel={sliceLevel}
        onCellClick={onCellClick}
        onCellHover={onCellHover}
      />

      <RiverGrid week={week} colorScale={colorScale} />

      <BoundingBox />
      <AxisLabels />
      <GridFloor />
      <SliceIndicator mode={dashboardState} level={sliceLevel} />

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
