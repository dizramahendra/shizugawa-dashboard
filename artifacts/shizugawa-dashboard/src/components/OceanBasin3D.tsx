import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import {
  BAY_MASK,
  GRID_W,
  GRID_D,
  DEPTH_LAYERS,
  generateWeekData,
  DashboardState,
} from "@/lib/simulatedData";

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
  chlorophyll: [
    [0.10, 0.29, 0.18],
    [0.18, 0.48, 0.29],
    [0.35, 0.67, 0.43],
    [0.66, 0.85, 0.60],
    [0.91, 0.96, 0.69],
    [0.96, 0.96, 0.86],
  ],
  oxygen: [
    [0.78, 0.25, 0.11],
    [0.91, 0.63, 0.19],
    [0.94, 0.90, 0.55],
    [0.72, 0.86, 0.91],
    [0.42, 0.63, 0.78],
    [0.23, 0.44, 0.63],
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

interface VoxelGridProps {
  week: number;
  colorScale: string;
  selectedPoint: { x: number; z: number; depth: number } | null;
  sliceMode: DashboardState;
  sliceLevel: number;
  onCellClick: (x: number, z: number, depth: number) => void;
}

function VoxelGrid({ week, colorScale, selectedPoint, sliceMode, sliceLevel, onCellClick }: VoxelGridProps) {
  const data = useMemo(() => generateWeekData(week), [week]);
  const stops = COLOR_SCALES[colorScale] ?? COLOR_SCALES.nitrogen;

  const CELL_W = 0.95;
  const CELL_H = 0.4;
  const GAP = 0.05;
  const STEP = CELL_W + GAP;

  const offsetX = -(GRID_W * STEP) / 2;
  const offsetZ = -(GRID_D * STEP) / 2;

  const visibleDepths = useMemo(() => {
    if (sliceMode === "slice-h") {
      return [sliceLevel];
    }
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

        const isSelected =
          selectedPoint && selectedPoint.x === gx && selectedPoint.z === gz && selectedPoint.depth === d;

        const px = offsetX + gx * STEP + CELL_W / 2;
        const py = -(d * (CELL_H + 0.05)) + DEPTH_LAYERS * 0.15;
        const pz = offsetZ + gz * STEP + CELL_W / 2;

        const depthOpacity = 1 - d * 0.09;

        meshes.push(
          <mesh
            key={`${gz}-${gx}-${d}`}
            position={[px, py, pz]}
            onClick={(e) => {
              e.stopPropagation();
              onCellClick(gx, gz, d);
            }}
          >
            <boxGeometry args={[CELL_W, CELL_H, CELL_W]} />
            <meshStandardMaterial
              color={isSelected ? new THREE.Color(1, 0.9, 0.2) : new THREE.Color(r, g, b)}
              transparent
              opacity={isSelected ? 1 : depthOpacity * 0.88}
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

function DepthAxis() {
  const lines: React.ReactElement[] = [];
  const STEP = 0.45;
  const depths = ["0m", "5m", "15m", "30m", "50m", "75m", "100m", "150m"];
  for (let i = 0; i < DEPTH_LAYERS; i++) {
    const y = -(i * STEP) + DEPTH_LAYERS * 0.15;
    lines.push(
      <mesh key={i} position={[-8.5, y, 0]}>
        <boxGeometry args={[0.03, 0.03, 0.03]} />
        <meshStandardMaterial color="#8a9ab0" />
      </mesh>
    );
  }
  return <>{lines}</>;
}

function GridFloor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -(DEPTH_LAYERS * 0.45 + 0.2), 0]}>
      <planeGeometry args={[GRID_W * 1.0, GRID_D * 1.0, GRID_W, GRID_D]} />
      <meshStandardMaterial color="#b8c8d8" wireframe opacity={0.3} transparent />
    </mesh>
  );
}

interface SliceIndicatorProps {
  mode: DashboardState;
  level: number;
}

function SliceIndicator({ mode, level }: SliceIndicatorProps) {
  const STEP = 1.0;
  const offsetX = -(GRID_W * STEP) / 2;
  const offsetZ = -(GRID_D * STEP) / 2;

  if (mode === "slice-h") {
    const y = -(level * 0.45) + DEPTH_LAYERS * 0.15;
    return (
      <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[GRID_W * 1.0, GRID_D * 1.0]} />
        <meshStandardMaterial color="#4a90d9" opacity={0.08} transparent side={THREE.DoubleSide} />
      </mesh>
    );
  }
  if (mode === "slice-v") {
    const x = offsetX + level * STEP + STEP / 2;
    return (
      <mesh position={[x, 0, 0]}>
        <planeGeometry args={[0.05, DEPTH_LAYERS * 0.45 + 1, DEPTH_LAYERS, GRID_D]} />
        <meshStandardMaterial color="#4a90d9" opacity={0.12} transparent side={THREE.DoubleSide} />
      </mesh>
    );
  }
  return null;
}

interface OceanBasin3DProps {
  week: number;
  colorScale: string;
  dashboardState: DashboardState;
  selectedPoint: { x: number; z: number; depth: number } | null;
  sliceLevel: number;
  onCellClick: (x: number, z: number, depth: number) => void;
}

export default function OceanBasin3D({
  week,
  colorScale,
  dashboardState,
  selectedPoint,
  sliceLevel,
  onCellClick,
}: OceanBasin3DProps) {
  return (
    <Canvas
      camera={{ position: [12, 9, 14], fov: 38 }}
      style={{ background: "#edf0f3" }}
      data-testid="canvas-3d"
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[10, 15, 10]} intensity={0.8} castShadow />
      <directionalLight position={[-5, 8, -5]} intensity={0.3} color="#b0c8e0" />
      <fog attach="fog" args={["#edf0f3", 25, 50]} />

      <VoxelGrid
        week={week}
        colorScale={colorScale}
        selectedPoint={selectedPoint}
        sliceMode={dashboardState}
        sliceLevel={sliceLevel}
        onCellClick={onCellClick}
      />
      <DepthAxis />
      <GridFloor />
      <SliceIndicator mode={dashboardState} level={sliceLevel} />

      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={8}
        maxDistance={35}
        maxPolarAngle={Math.PI / 2.1}
      />
    </Canvas>
  );
}
