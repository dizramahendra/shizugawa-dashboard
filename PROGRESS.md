# Shizugawa Bay 3D Time-Series — Progress Log

A 3D time-series dashboard for **Shizugawa Bay** (Minamisanriku, Miyagi, Japan) —
a voxel ocean model, a map viewport, and river playback, driven by *simulated*
nutrient data modeled on Delft3D output.

**Intent:** a **portfolio / showcase piece**. So the priority is cinematic
impact and a convincing, geographically-real presentation — *not* real
measurement data. Guiding principle: **the geography is real, the values are
simulated.** The coastline, sub-basin watersheds, and terrain are the actual
Shizugawa Bay; the nutrient numbers are a plausible seasonal model.

---

## The arc (July 2026)

The project started as a Replit monorepo prototype where the 3D bay floated as a
blocky shape and the "map" was a flat SVG diagram of borders. It was migrated to
a standalone Vite app and then rebuilt in phases into a geographically-grounded
analytic dashboard.

### Phase 1 — Migration + 3D polish
Flattened off Replit into a standalone Vite app, then a pass over the voxel 3D
ocean view for correctness and looks.

| Commit | Change |
|--------|--------|
| `fa935ab` | Migrate to standalone Vite app + Tier-1 3D (smooth color ramp, demand frameloop, instanced rivers) |
| `20126cd` | Fix React Fast Refresh (moved `depthLabel` out of `OceanBasin3D`) |
| `3bb1ad5` | Apply voxel selection highlight imperatively (no geometry rebuild per click) |
| `ef41f87` | Lighting rig tuned for depth reading |
| `8bd3666` | Depth-shading on/off toggle |
| `6eb5e8a` | Opaque voxels — fix transparent z-sorting flicker |
| `9fb67cd` | Fix seabed↔voxel z-fighting (polygonOffset) |
| `f1b39a7` | Blocky seabed (Option B) — matches the voxel language, no gaps |
| `e0ae600` | Fix slice NaN (empty river-seabed geometry) |
| `57c7778` | 16 depth layers (`DEPTH_SUBDIV`) + 1.6× vertical exaggeration (`VERT_EXAG`) for a readable slope |

### Phase 2 — Real geography (the big shift)
Moved from stylized SVG to the *real* Shizugawa Bay geography. The traced SVG
shapes were found to align with the real coast — georeferenced by anchoring the
two island sub-paths onto the real islands **Arajima + Tsubakishima**.

**Key reusable asset — the georeference transform** (SVG px → real lon/lat):
```
lon = 141.36568 + (svgX / 465) * 0.16158
lat = 38.59295 + (1 - svgY / 586) * 0.15515
```

| Commit | Change |
|--------|--------|
| `9ca9ab9` | Real MapLibre terrain-basemap spike at `/map-real` (proved the georeference) |
| `43ce42b` | **Map Viewport → real MapLibre terrain map** — numbered/named sub-basins, rivers colored by value with playback, selection/zoom, all on the real coast (old SVG map kept as fallback) |
| `f343b99` | Dark casing under map rivers so they read on the busy terrain basemap |
| `e017ecd` | **Real sub-basin land + coastline in the 3D scene** (Approach B) — grey watershed terrain rings the bay along the real coast |

---

## Current state
- **Map Viewport:** real Esri World Topo terrain basemap of Shizugawa Bay with the
  sub-basins (number + name), rivers (data-colored, animate on playback), and bay
  overlaid on the real coastline. Selection/zoom, hover, corridor mode preserved.
- **Ocean Playback (3D):** blocky voxel ocean (16 depth layers, exaggerated slope,
  opaque, blocky seabed, shading toggle) now ringed by the **real sub-basin land**.
- **River Playback (2D):** unchanged.
- Reference the geography was traced from: `attached_assets/map_1775806990581.jpg`.

## Experiments / branches
- **Plume isosurface (smooth "Surface" mode toggle):** a Fable-built spike that
  renders a marching-cubes plume instead of voxels. Shelved (to be preserved on
  branch `spike/plume-surface`).
- **Voxels on a real 3D terrain map (Approach A):** in progress — the voxel ocean
  as a georeferenced three.js custom layer on a real DEM-terrain MapLibre map, at
  route `/terrain-3d`.

## Known issues / follow-ups
- **NaN `computeBoundingSphere` console errors in the 3D view** — pre-existing
  (confirmed: present without the recent land work), console-only (no visual/UX
  impact), not yet fully root-caused. One lead: switching Vertical→Horizontal
  slice carries a stale row index into the depth index (`DEPTH_TOPS[48]` undefined).
- **Missing sub-basin polygons** (ids 7/11/17/23/24 absent in `SUB_BASIN_PATHS`) —
  a few coast stretches show seabed instead of land; matches the 2D map's coverage.
- Map colors ignore the Year selector (pre-existing; `generateRiverData` called
  without year).

## Notable technical bits
- `src/lib/landMask.ts` — land membership from the sub-basin polygons + the grid transform.
- The georeference transform above drives both the 2D real map and the 3D land.
- MapLibre-in-a-tab needs a `ResizeObserver` calling `map.resize()` so it paints on load.
