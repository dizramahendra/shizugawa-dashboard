import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import {
  generateWeekData,
  generateRiverData,
  DEPTH_LAYERS,
  BAY_MASK,
  GRID_W,
  GRID_D,
} from "@/lib/simulatedData";

const COLOR_STOPS: Record<string, [number, number, number][]> = {
  nitrogen:    [[0.23,0.44,0.63],[0.42,0.63,0.78],[0.72,0.86,0.91],[0.94,0.90,0.55],[0.91,0.63,0.19],[0.78,0.25,0.11]],
  phosphorus:  [[0.23,0.44,0.63],[0.42,0.63,0.78],[0.72,0.86,0.91],[0.94,0.90,0.55],[0.91,0.63,0.19],[0.78,0.25,0.11]],
  chlorophyll: [[0.10,0.29,0.18],[0.18,0.48,0.29],[0.35,0.67,0.43],[0.66,0.85,0.60],[0.91,0.96,0.69],[0.96,0.96,0.86]],
  do:          [[0.78,0.25,0.11],[0.91,0.63,0.19],[0.94,0.90,0.55],[0.72,0.86,0.91],[0.42,0.63,0.78],[0.23,0.44,0.63]],
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

const BASE_Y = -7;
const BAND_DEPTH = 5;

const BANDS = [
  { id: "forest", x1: -20, x2: -13, yTop: 5.2, hex: "#1e4a24", topHex: "#28612e" },
  { id: "paddy",  x1: -13, x2: -7,  yTop: 3.6, hex: "#3a6318", topHex: "#52882a" },
  { id: "farm",   x1: -7,  x2: -3,  yTop: 2.8, hex: "#7a5a1e", topHex: "#a07a2a" },
  { id: "urban",  x1: -3,  x2: +1,  yTop: 2.0, hex: "#424f5e", topHex: "#5c6e80" },
  { id: "river",  x1: +1,  x2: +4,  yTop: 0.6, hex: "#0d3d6e", topHex: "#1a5a9e" },
  { id: "bay",    x1: +4,  x2: +11, yTop: 0.0, hex: "#082e52", topHex: "#0f4070" },
  { id: "ocean",  x1: +11, x2: +22, yTop: -0.4, hex: "#041828", topHex: "#061e38" },
] as const;

function TerrainBands() {
  const geoms = useMemo(() => {
    return BANDS.map((b) => {
      const w = b.x2 - b.x1;
      const h = b.yTop - BASE_Y;
      return { ...b, w, h, cx: (b.x1 + b.x2) / 2, cy: (b.yTop + BASE_Y) / 2 };
    });
  }, []);

  return (
    <>
      {geoms.map((b) => (
        <group key={b.id}>
          {/* Main body */}
          <mesh position={[b.cx, b.cy, 0]}>
            <boxGeometry args={[b.w, b.h, BAND_DEPTH]} />
            <meshStandardMaterial color={b.hex} roughness={0.85} metalness={0.04} />
          </mesh>
          {/* Top surface cap (slightly lighter / different tone) */}
          <mesh position={[b.cx, b.yTop, 0]}>
            <boxGeometry args={[b.w, 0.14, BAND_DEPTH]} />
            <meshStandardMaterial color={b.topHex} roughness={0.7} metalness={0.06} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function SeaLevelPlane() {
  return (
    <mesh position={[5, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[44, BAND_DEPTH + 0.5]} />
      <meshStandardMaterial
        color="#3a9fd4"
        transparent
        opacity={0.12}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function SeaLevelEdge() {
  return (
    <mesh position={[5, 0.0, BAND_DEPTH / 2 + 0.01]}>
      <boxGeometry args={[44, 0.04, 0.04]} />
      <meshStandardMaterial color="#4ab0e8" opacity={0.6} transparent />
    </mesh>
  );
}

const RV_COLS = 7;
const RV_ROWS = 3;
const RV_CELL_W = 0.82;
const RV_CELL_D = 1.3;
const RV_CELL_H = 0.12;

function RiverCells({ week, colorScale }: { week: number; colorScale: string }) {
  const data = useMemo(() => generateRiverData(week, "shizugawa"), [week]);
  const stops = COLOR_STOPS[colorScale] ?? COLOR_STOPS.nitrogen;

  const cells = useMemo(() => {
    const items: { key: string; x: number; y: number; z: number; color: [number, number, number] }[] = [];
    for (let col = 0; col < RV_COLS; col++) {
      for (let row = 0; row < RV_ROWS; row++) {
        const tx = col / (RV_COLS - 1);
        const x = -3 + tx * 7;
        const z = -1.3 + row * 1.3;

        let yTop: number;
        if (x <= 1) {
          const tUrban = (x + 3) / 4;
          yTop = 2.0 - tUrban * 0.2;
        } else {
          yTop = 2.0 - ((x - 1) / 3) * 1.5;
        }

        const dataCol = Math.min(Math.round(col * 5), (data[0]?.length ?? 1) - 1);
        const dataRow = Math.min(row + 4, data.length - 1);
        const val = data[dataRow]?.[dataCol] ?? 0;
        const color = lerpColor(stops, val);

        items.push({ key: `${col}-${row}`, x, y: yTop + RV_CELL_H / 2 + 0.08, z, color });
      }
    }
    return items;
  }, [week, colorScale, data, stops]);

  return (
    <>
      {cells.map((c) => (
        <mesh key={c.key} position={[c.x, c.y, c.z]}>
          <boxGeometry args={[RV_CELL_W, RV_CELL_H, RV_CELL_D]} />
          <meshStandardMaterial
            color={new THREE.Color(c.color[0], c.color[1], c.color[2])}
            transparent
            opacity={0.88}
            roughness={0.5}
          />
        </mesh>
      ))}
    </>
  );
}

const OCN_X_CELLS = 5;
const OCN_Z_CELLS = 4;
const OCN_D_CELLS = 4;
const OCN_CELL_SZ = 0.88;
const OCN_GAP = 0.12;
const OCN_STEP = OCN_CELL_SZ + OCN_GAP;

function OceanVoxels({ week, colorScale }: { week: number; colorScale: string }) {
  const data = useMemo(() => generateWeekData(week), [week]);
  const stops = COLOR_STOPS[colorScale] ?? COLOR_STOPS.nitrogen;

  const voxels = useMemo(() => {
    const items: {
      key: string;
      x: number;
      y: number;
      z: number;
      color: [number, number, number];
      opacity: number;
    }[] = [];

    for (let gx = 0; gx < OCN_X_CELLS; gx++) {
      for (let gz = 0; gz < OCN_Z_CELLS; gz++) {
        for (let gd = 0; gd < OCN_D_CELLS; gd++) {
          const x = 4.8 + gx * OCN_STEP;
          const z = -1.6 + gz * OCN_STEP;
          const y = -0.6 - gd * OCN_STEP;

          const dataX = Math.min(Math.round(gx * GRID_W / OCN_X_CELLS), GRID_W - 1);
          const dataZ = Math.min(Math.round(gz * GRID_D / OCN_Z_CELLS), GRID_D - 1);
          const dataD = Math.min(gd, DEPTH_LAYERS - 1);

          if (!BAY_MASK[dataZ]?.[dataX]) continue;

          const val = data[dataZ]?.[dataX]?.[dataD] ?? 0;
          const color = lerpColor(stops, val);
          const opacity = 0.82 - gd * 0.14;

          items.push({ key: `${gx}-${gz}-${gd}`, x, y, z, color, opacity });
        }
      }
    }
    return items;
  }, [week, colorScale, data, stops]);

  return (
    <>
      {voxels.map((v) => (
        <mesh key={v.key} position={[v.x, v.y, v.z]}>
          <boxGeometry args={[OCN_CELL_SZ, OCN_CELL_SZ, OCN_CELL_SZ]} />
          <meshStandardMaterial
            color={new THREE.Color(v.color[0], v.color[1], v.color[2])}
            transparent
            opacity={v.opacity}
            roughness={0.55}
          />
        </mesh>
      ))}
    </>
  );
}

function GroundGrid() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, BASE_Y, 0]}>
      <planeGeometry args={[44, BAND_DEPTH, 20, 4]} />
      <meshStandardMaterial color="#0a1220" wireframe opacity={0.3} transparent />
    </mesh>
  );
}

function DepthLines() {
  const depths = [0, -2, -4, -6];
  return (
    <>
      {depths.map((y, i) => (
        <mesh key={i} position={[10, y, BAND_DEPTH / 2 + 0.01]}>
          <boxGeometry args={[18, 0.025, 0.025]} />
          <meshStandardMaterial color="#2a4a6a" opacity={0.5} transparent />
        </mesh>
      ))}
    </>
  );
}

interface TerrainCrossSection3DProps {
  week: number;
  colorScale: string;
}

export default function TerrainCrossSection3D({ week, colorScale }: TerrainCrossSection3DProps) {
  return (
    <Canvas
      camera={{ position: [1, 10, 24], fov: 43 }}
      style={{ background: "#0a0f1a" }}
      data-testid="canvas-cross-section"
    >
      <ambientLight intensity={0.55} />
      <directionalLight position={[8, 18, 12]} intensity={0.85} castShadow />
      <directionalLight position={[-12, 6, -6]} intensity={0.28} color="#90b8d8" />
      <directionalLight position={[0, -8, 6]} intensity={0.12} color="#203040" />
      <fog attach="fog" args={["#0a0f1a", 45, 90]} />

      <TerrainBands />
      <SeaLevelPlane />
      <SeaLevelEdge />
      <DepthLines />
      <GroundGrid />
      <RiverCells week={week} colorScale={colorScale} />
      <OceanVoxels week={week} colorScale={colorScale} />

      <OrbitControls
        enablePan={false}
        enableZoom={true}
        enableRotate={true}
        minDistance={14}
        maxDistance={45}
        minPolarAngle={Math.PI / 7}
        maxPolarAngle={Math.PI / 2.3}
        minAzimuthAngle={-Math.PI / 4.5}
        maxAzimuthAngle={Math.PI / 4.5}
      />
    </Canvas>
  );
}
