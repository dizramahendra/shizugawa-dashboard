# Migrating to Claude Code (or any local environment)

This doc is a checklist for taking this project out of Replit and continuing
development in Claude Code (or any local machine), with the same visual and
functional result.

## What you're actually moving

The real product is **one artifact**: `artifacts/shizugawa-dashboard` — a
plain React + Vite frontend, no backend, no database, no auth. It renders
entirely from simulated/hardcoded data in `src/lib/`.

The other two folders in `artifacts/` (`api-server`, `mockup-sandbox`) are
Replit scaffolding, unused by the dashboard:

- `api-server` — an Express server the dashboard never calls (no `fetch`,
  no `axios`, no `/api` references in its source).
- `mockup-sandbox` — Replit's Canvas/design preview tool, not part of the
  shipped product.
- `lib/db` — a Drizzle/Postgres setup, also unused by the dashboard.

**Recommendation:** for a clean Claude Code project, copy only
`artifacts/shizugawa-dashboard` plus the shared root config (below). You can
skip `api-server`, `mockup-sandbox`, and `lib/db` entirely unless you have
plans to build a real backend later.

## 1. What to copy

```
artifacts/shizugawa-dashboard/   (entire folder)
attached_assets/                 (images referenced via the @assets alias)
tsconfig.base.json
.gitignore
```

Do not copy `.replit`, `.replit-artifact/` folders, `replit.md` (Replit-only
metadata), or `node_modules` — Claude Code will reinstall dependencies.

## 2. One-time environment setup

- Node.js **24.x** (matches `.replit` / `pnpm-workspace.yaml`)
- pnpm **10.x** (`corepack enable && corepack prepare pnpm@10 --activate`, or
  `npm i -g pnpm`)

## 3. Restructure for standalone use

Since you're dropping the monorepo wrapper, flatten the dashboard to the
project root in the new repo:

1. Move everything inside `artifacts/shizugawa-dashboard/` up to the repo root.
2. In `vite.config.ts`, the `@assets` alias currently points two levels up
   (`../../attached_assets`) — update it to wherever you place
   `attached_assets` relative to the new root (e.g. `./attached_assets`).
3. Remove the three Replit-only vite plugins — they only activate when
   `REPL_ID` is set, so they're inert locally, but you can delete them to
   drop the dependency:
   - `@replit/vite-plugin-runtime-error-modal`
   - `@replit/vite-plugin-cartographer`
   - `@replit/vite-plugin-dev-banner`
4. `PORT` and `BASE_PATH` env vars are required by `vite.config.ts` (it
   throws if missing). Use the included `.env.example` — copy it to `.env`
   and load it with your normal tooling, or just export them in your shell:
   ```bash
   export PORT=5173
   export BASE_PATH=/
   ```
5. Since there's no shared-proxy routing outside Replit, `BASE_PATH` should
   just be `/` for a standalone app.

## 4. Install and run

```bash
pnpm install
pnpm run dev      # http://localhost:5173
```

Production build:

```bash
pnpm run build     # outputs to dist/public
pnpm run serve     # preview the production build locally
```

## 5. Verify parity

After moving, confirm these match the Replit version exactly:

- All 3 tabs render: Map Viewport, River Playback (2D), Ocean Playback (3D)
- 3D playback animates and voxel color cross-fade transitions still work
- The "About this dashboard" info drawer opens from the header icon
- Sub-basin and Carbon tabs (if un-hidden) still work
- Google Fonts (`Inter`) still loads — `index.html` pulls it from
  `fonts.googleapis.com`, requires internet access at runtime

## 6. Things that do NOT carry over automatically (already covered, for reference)

- Replit secrets (`SESSION_SECRET` — currently unused by any code, safe to drop)
- Replit-managed Postgres database (unused by the dashboard — nothing to migrate)
- Replit workflows — replaced by plain `pnpm run dev`
- Replit's shared reverse proxy / path-based routing — not needed for a
  single standalone app
- One-click deploy — you'll need your own hosting (Vercel, Netlify, etc.)
  for a static Vite build
