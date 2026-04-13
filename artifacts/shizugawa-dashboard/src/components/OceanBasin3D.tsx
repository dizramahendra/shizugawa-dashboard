import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html, Edges } from "@react-three/drei";
import * as THREE from "three";
import {
  BAY_MASK,
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
const CELL_W = 0.95;
const STEP = 1.0;
const Y_SURFACE = 1.2; // y-coord of the top surface face

const offsetX = -(GRID_W * STEP) / 2; // -7.0
const offsetZ = -(GRID_D * STEP) / 2; // -6.0

// Bounding box dimensions (with padding)
const BOX_PAD_X = 0.5;
const BOX_PAD_Z = 0.5;
const BOX_PAD_Y_TOP = 0.2;
const BOX_PAD_Y_BOT = 0.2;
const BOX_W = GRID_W * STEP + BOX_PAD_X * 2; // 15
const BOX_D = GRID_D * STEP + BOX_PAD_Z * 2; // 13
const BOX_TOP = Y_SURFACE + BOX_PAD_Y_TOP;
const BOX_BOT = Y_SURFACE - DEPTH_TOTAL_H - BOX_PAD_Y_BOT;
const BOX_H = BOX_TOP - BOX_BOT;
const BOX_CY = (BOX_TOP + BOX_BOT) / 2;

// Real coordinate bounds (matching PlaybackPage gridToCoords)
const BAY_LON_W = 141.383;
const BAY_LON_E = 141.468;
const BAY_LAT_S = 38.582;
const BAY_LAT_N = 38.651;

// ── Color scales ──────────────────────────────────────────────────────────────
const COLOR_SCALES: Record<string, [number, number, number][]> = {
  nitrogen: [
    [0.23, 0.44, 0.63],
    [0.42, 0.63, 0.78],
    [0.72, 0.86, 0.91],
    [0.94, 0.90, 0.55],
    [0.91, 0.63, 0.19],
    [0.78, 0.25, 0.11],
  ],
  phosphorus: [
    [0.23, 0.44, 0.63],
    [0.42, 0.63, 0.78],
    [0.72, 0.86, 0.91],
    [0.94, 0.90, 0.55],
    [0.91, 0.63, 0.19],
    [0.78, 0.25, 0.11],
  ],
  flow: [
    [0.88, 0.96, 0.99],
    [0.51, 0.83, 0.98],
    [0.15, 0.78, 0.85],
    [0.40, 0.73, 0.41],
    [1.00, 0.65, 0.15],
    [0.94, 0.42, 0.00],
  ],
  all: [
    [0.27, 0.00, 0.33],
    [0.13, 0.37, 0.60],
    [0.09, 0.59, 0.55],
    [0.21, 0.72, 0.43],
    [0.68, 0.85, 0.19],
    [0.99, 0.91, 0.15],
  ],
};

function lerpColor(stops: [number, number, number][], t: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, t));
  const idx = clamped * (stops.length - 1);
  const i = Math.floor(idx);
  const f = idx - i;
  if (i >= stops.length - 1) return stops[stops.length - 1];
  return [
    stops[i][0] + (stops[i + 1][0] - stops[i][0]) * f,
    stops[i][1] + (stops[i + 1][1] - stops[i][1]) * f,
    stops[i][2] + (stops[i + 1][2] - stops[i][2]) * f,
  ];
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
  const data = useMemo(() => generateWeekData(week), [week]);
  const stops = COLOR_SCALES[colorScale] ?? COLOR_SCALES.nitrogen;

  const visibleDepths = useMemo(() => {
    if (sliceMode === "slice-h") return [sliceLevel];
    return Array.from({ length: DEPTH_LAYERS }, (_, i) => i);
  }, [sliceMode, sliceLevel]);

  const meshes: React.ReactElement[] = [];

  for (let gz = 0; gz < GRID_D; gz++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      if (!BAY_MASK[gz]?.[gx]) continue;

      for (const d of visibleDepths) {
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

        const depthOpacity = 1 - d * 0.09;

        const isInteractive = d === 0;

        meshes.push(
          <mesh
            key={`${gz}-${gx}-${d}`}
            position={[px, py, pz]}
            onClick={
              isInteractive
                ? (e) => {
                    e.stopPropagation();
                    onCellClick(gx, gz);
                  }
                : undefined
            }
            onPointerOver={
              isInteractive
                ? (e) => {
                    e.stopPropagation();
                    onCellHover?.(gx, gz);
                  }
                : undefined
            }
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

  return <>{meshes}</>;
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

// Derived box-edge positions (all from BOX_* constants, no magic numbers)
const BOX_HALF_W = BOX_W / 2; // east/west x boundary
const BOX_HALF_D = BOX_D / 2; // north/south z boundary
const BOX_SOUTH_Z = -BOX_HALF_D; // south face z (low lat)
const BOX_NORTH_Z = BOX_HALF_D; // north face z (high lat)
const BOX_WEST_X = -BOX_HALF_W; // west face x (low lon)
const BOX_EAST_X = BOX_HALF_W; // east face x (high lon)
const DEPTH_LABEL_X = BOX_WEST_X - 0.7; // just outside west face for depth ticks

function AxisLabels() {
  const lonTicks: React.ReactElement[] = [];
  const latTicks: React.ReactElement[] = [];
  const depthTicks: React.ReactElement[] = [];

  // Longitude ticks — south bottom edge (every 3 columns: gx=0,3,6,9,12)
  for (const gx of [0, 3, 6, 9, 12]) {
    const lon = BAY_LON_W + (gx / 13) * (BAY_LON_E - BAY_LON_W);
    const scenX = offsetX + gx * STEP + CELL_W / 2;
    lonTicks.push(
      <Html
        key={`lon-${gx}`}
        position={[scenX, BOX_BOT - 0.6, BOX_SOUTH_Z]}
        center
        distanceFactor={10}
        zIndexRange={[0, 0]}
      >
        <div style={LABEL_STYLE}>{lon.toFixed(3)}°E</div>
      </Html>
    );
  }

  // Latitude ticks — west bottom edge (every 2 rows: gz=0,2,4,6,8,10)
  for (const gz of [0, 2, 4, 6, 8, 10]) {
    const lat = BAY_LAT_S + (gz / 11) * (BAY_LAT_N - BAY_LAT_S);
    const scenZ = offsetZ + gz * STEP + CELL_W / 2;
    latTicks.push(
      <Html
        key={`lat-${gz}`}
        position={[BOX_WEST_X, BOX_BOT - 0.6, scenZ]}
        center
        distanceFactor={10}
        zIndexRange={[0, 0]}
      >
        <div style={LABEL_STYLE}>{lat.toFixed(3)}°N</div>
      </Html>
    );
  }

  // Depth ticks — SW vertical edge (just outside the west-south corner)
  for (let d = 0; d < DEPTH_LAYERS; d++) {
    const y = Y_SURFACE - DEPTH_TOPS[d];
    depthTicks.push(
      <Html
        key={`dep-${d}`}
        position={[DEPTH_LABEL_X, y, BOX_SOUTH_Z]}
        center
        distanceFactor={10}
        zIndexRange={[0, 0]}
      >
        <div style={LABEL_STYLE}>{DEPTH_REAL_M[d]}m</div>
      </Html>
    );
  }

  return (
    <>
      {/*
       * Compass labels at the midpoint of each top-face edge.
       * N/S = centre of north/south edges; E/W = centre of east/west edges.
       * All coordinates derived from BOX_* constants.
       */}
      <Html position={[0, BOX_TOP + 0.5, BOX_NORTH_Z]} center distanceFactor={10} zIndexRange={[0, 0]}>
        <div style={COMPASS_STYLE}>N</div>
      </Html>
      <Html position={[0, BOX_TOP + 0.5, BOX_SOUTH_Z]} center distanceFactor={10} zIndexRange={[0, 0]}>
        <div style={COMPASS_STYLE}>S</div>
      </Html>
      <Html position={[BOX_EAST_X, BOX_TOP + 0.5, 0]} center distanceFactor={10} zIndexRange={[0, 0]}>
        <div style={COMPASS_STYLE}>E</div>
      </Html>
      <Html position={[BOX_WEST_X, BOX_TOP + 0.5, 0]} center distanceFactor={10} zIndexRange={[0, 0]}>
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
      <planeGeometry args={[GRID_W * 1.0, GRID_D * 1.0, GRID_W, GRID_D]} />
      <meshStandardMaterial color="#b8c8d8" wireframe opacity={0.3} transparent />
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
        <planeGeometry args={[GRID_W * 1.0, GRID_D * 1.0]} />
        <meshStandardMaterial
          color="#4a90d9"
          opacity={0.08}
          transparent
          side={THREE.DoubleSide}
        />
      </mesh>
    );
  }
  if (mode === "slice-v") {
    const x = offsetX + level * STEP + STEP / 2;
    return (
      <mesh position={[x, BOX_CY, 0]}>
        <planeGeometry args={[0.05, BOX_H, DEPTH_LAYERS, GRID_D]} />
        <meshStandardMaterial
          color="#4a90d9"
          opacity={0.12}
          transparent
          side={THREE.DoubleSide}
        />
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
      camera={{ position: [16, 12, 18], fov: 38 }}
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

      <BoundingBox />
      <AxisLabels />
      <GridFloor />
      <SliceIndicator mode={dashboardState} level={sliceLevel} />

      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={8}
        maxDistance={40}
        maxPolarAngle={Math.PI / 2.1}
      />
    </Canvas>
  );
}
