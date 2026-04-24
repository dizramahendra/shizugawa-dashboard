# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Artifacts

### `artifacts/shizugawa-dashboard` — 3D Time-Series Dashboard

Scientific environmental analytics dashboard for Shizugawa Bay, Japan.

- **Type**: React + Vite (frontend-only, no backend)
- **Preview**: `http://localhost:80/`
- **Key dependencies**: `three`, `@react-three/fiber`, `@react-three/drei`
- **Features**:
  - State 1: 2D overview — bay map with clickable ocean basin
  - State 2: 3D playback — voxel grid ocean basin model with animated nutrient data
  - State 3: Paused/scrubbed playback
  - State 4: Point selection — click any voxel to inspect values
  - State 5: Horizontal/vertical slice modes
  - State 6: Depth graph — concentration vs. depth profile
  - 3 variables: Total Nitrogen, Total Phosphorus, Water Flow
  - 11 rivers: 4 cardinal-direction rivers + 7 sub-basin inlets (west, north, south)
  - 112×96 voxel grid (densified ×4 from 28×24 authored coords)
  - 8 depth layers (0–69 m) with smooth bathymetry-driven seabed mesh
  - Z-flip group scale for geographic orientation (gz=0 south, gz=95 north)
  - 52 weekly timesteps (simulated 1-year dataset)
  - Scientific color scales per variable
  - Playback speed control (0.5×, 1×, 2×, 4×)
  - Horizontal / vertical slice modes + depth graph
  - **Carbon Sequestration tab (`/carbon`)**: dedicated route with project-area
    decarbonization simulator. Single project-area measure dropdown applied to
    up to 4 sample pixels; per-pixel Mobadas-style semicircular HSI gauges;
    rainbow HSI legend strip; stacked-area blue-carbon breakdown
    (seagrass / macroalgae / oyster channels); avoided-emissions KPI.
  - Measures: do nothing, oyster aquaculture, seagrass restoration,
    cultivate macroalgae, tidal flat restoration, sediment dredging,
    aerator deployment.

### `artifacts/api-server` — Express API Server

- **Type**: Express 5 API
- **Preview path**: `/api`

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── shizugawa-dashboard/    # 3D Time-Series Dashboard (React + Vite + Three.js)
│   └── api-server/             # Express API server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck`
- **`emitDeclarationOnly`** — only `.d.ts` files during typecheck; actual bundling by esbuild/vite
- **Project references** — when package A depends on B, A's `tsconfig.json` must list B in `references`

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references
