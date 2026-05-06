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
  - **Sub-basin tab (`/sub-basin`)**: multi-select 1–25 sub-basins on the map
    and compare 5 primary indicators (Forest C **t/ha**, Soil C **t/ha**,
    Nitrogen **kg/ha/yr**, Phosphorus **kg/ha/yr**, Water Flow **m³/s**) —
    all four land indicators normalised per hectare so envelope means the
    same thing across basins of different sizes.  Reference line on every
    chart is the **regional baseline average across all 25 sub-basins**
    (`SUB_BASIN_BASELINE_AVG`, simple arithmetic mean), not a fixed health
    threshold.  Single selection ⇒ radar chart fingerprint + value-vs-avg
    table; the dashed ring marks "1.0 × regional avg".  2+ selections ⇒
    chart-type toggle (**Bars** or **Radar**).  Bars = five stacked
    vertical-bar cards (one per indicator) with the avg reference line
    and per-bar hover tooltips showing basin name, value, and Δ vs avg.
    Radar = single shared 5-axis radar with **one polygon per selected
    basin**, each axis normalised to its baseline avg (1.0× ring) and the
    outer ring auto-scaled to fit the most extreme basin/indicator combo;
    fill opacity scales down with N so 10+ overlapping polygons stay
    readable.  **Aggregate** toggle collapses bars into "Total Regional
    Sum"; per-area indicators are area-weighted (unit shifts to absolute t
    or kg/yr) while waterFlow is summed directly.  Aggregate exposes two
    extra controls: a **chart-type toggle** (Bars / Combined / Radar) and a
    **decarbonization measure dropdown** (afforestation, riparian buffer,
    agri BMPs, wetland, no-till, reduce N/P — all marked *(simulated)*).
    The **Combined** view normalises every indicator to "× regional avg"
    so all five fit in a single bar chart with a shared y-axis (raw values
    + units stay visible in the per-bar tooltip).
    With a measure picked, every aggregate chart switches to **Before vs
    After** (paired bars + Δ% badge in the bars view; two overlaid
    polygons in the radar view).  Sanity rules baked into `SUB_BASIN_META`:
    urban basins ⇒ 0 forestC, agricultural basins ⇒ high soilC + N/P
    export rates.  Full URL state: `?ids=1,5,20&agg=1&m=afforestation&view=radar`.
    Visible in `TopNav` as the "Sub-basin" tab (amber dot).
  - **Shared `<LegendOverlay>`** (`src/components/LegendOverlay.tsx`):
    single component used by `PlaybackPage`, `MapLibreMap`, and
    `RiverGrid2D` to render the bottom-left color-bar legend (Legend
    header + unit, continuous color bar, evenly-spaced numeric ticks).
    One source of truth for legend look-and-feel across all 3 views.
  - **Carbon Sequestration tab (`/carbon`)**: dedicated route with project-area
    decarbonization simulator focused on **seagrass (eelgrass / Zostera marina)
    carbon** — Shizugawa Bay's signature blue-carbon habitat. Single
    project-area measure dropdown applied to up to 4 sample pixels;
    per-pixel Mobadas-style semicircular HSI gauges with per-pixel/average
    toggle; rainbow HSI legend strip; baseline-vs-scenario annual
    sequestration bar chart; annual seagrass-carbon-gain KPI.
    No playback/time axis — annual steady-state outlook only.
  - Measures (all valued by seagrass-carbon impact): no measure,
    plant eelgrass meadow, restore oyster reef (clarifies water → eelgrass
    expands), reduce upstream N/P load, restore tidal flats.

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
