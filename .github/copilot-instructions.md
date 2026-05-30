# Copilot Instructions

## Project

**HUNTED BY CLAUDE** — a browser-first first-person horror escape game. React 19 + Three.js client, Express + `ws` WebSocket server, Anthropic SDK for in-game villain taunts.

## Commands

Package manager is **pnpm 10** (enforced via `packageManager` field). Use `pnpm`, not `npm`.

| Command | Purpose |
|---|---|
| `pnpm dev` | Vite dev server (`--host` for LAN access) |
| `pnpm dev:server` | Express + WebSocket server via `tsx` |
| `pnpm build` | Full production build (client → `dist/public`, server → `dist/index.js`) |
| `pnpm check` | TypeScript validation — this is the lint gate (no ESLint) |
| `pnpm format` | Prettier write across the repo |
| `pnpm start` | Run bundled production server |

There are no automated tests. Validation loop is `pnpm check` + manual play-through.

The CI workflow (`.github/workflows/perf.yml`) runs `pnpm run build:client` and enforces a 4MB JS bundle budget on PRs touching `client/`, `shared/`, `package.json`, `pnpm-lock.yaml`, or `vite.config.ts`.

## Architecture

Three source roots with tsconfig path aliases:

- **`client/src/`** (alias `@/*`) — Vite + React 19 SPA. Wouter routing (only `/` and `/404`). Tailwind 4 + shadcn/ui. `pages/Home.tsx` mounts the Three.js canvas via `game/Game3D.tsx`.
- **`server/index.ts`** — Single-file Express + `ws` gateway. Manages session state, leaderboard (`/tmp/leaderboard.json`), and Claude AI taunts via `@anthropic-ai/sdk`. Requires `ANTHROPIC_API_KEY` in environment.
- **`shared/`** (alias `@shared/*`) — Shared between client and server. `shared/maps.ts` is the **source of truth** for level layouts.

### Game engine (`client/src/`)

Hand-written Three.js setup — **not** react-three-fiber; don't refactor toward R3F unless asked.

- `game/engine.ts` — Top-level bootstrap. Wires renderer, post-FX, lighting, audio, props, AI director. **Read this before changing rendering or simulation** — it's the largest file in the codebase.
- `game/aiDirector.ts` — Local deterministic heuristic director (no API calls). Drives enemy speed and HUD tension scoring from gameplay triggers. This is the offline fallback when no WebSocket server is reachable.
- `render/` — `Renderer.ts`, `PostFX.ts`, `uniforms.ts`
- `lighting/` — Atmosphere, practicals, flicker, shadow budget
- `player/` — `CameraRig`, `Flashlight`, `Heartbeat`
- `world/` — `PropSpawner`, `Cobwebs`, `DustParticles`
- `materials/` — `MaterialFactory` (with caching) + `Decals`
- `audio/` — `AudioWorld`

### Two distinct AI systems

1. **Local AI Director** (`client/src/game/aiDirector.ts`) — heuristic-only, browser-only, no network.
2. **Server-side Claude taunts** (`server/index.ts`) — calls Anthropic API at 15–20s intervals (`TAUNT_MIN_MS`/`TAUNT_MAX_MS`). Needs `ANTHROPIC_API_KEY` in env; `new Anthropic()` reads it implicitly.

Keep these straight — they are independent systems.

## Key Conventions

### Map editing

`shared/maps.ts` defines maps as ASCII grids. Tile legend:

```
W=wall  D=door  S=spawn  X=exit  K=key  H=hide  E=enemy
.=floor(wood)  ,=carpet  :=stone  ;=creaky  B=battery  N=note
```

Constants: `TILE_SIZE = 4`, `WALL_HEIGHT = 4`.

**Critical:** `server/index.ts` contains a duplicated `MAPS` block at the top. When editing maps or adding tiles, update **both** `shared/maps.ts` and `server/index.ts`.

### TypeScript

Strict mode. `allowImportingTsExtensions: true` with `moduleResolution: "bundler"` — imports use `.ts` extensions. `noEmit: true` (bundler handles compilation).

### Legacy files

`server.js`, `server-old.js`, `server-enhanced.js`, `server-enhanced-v2.js`, `server-v3.js`, `server.js.backup`, `package-game.json` are historical artifacts. **The live server is `server/index.ts`.** Do not edit the legacy `.js` files.

### Patched dependency

`wouter@3.7.1` is patched via `patches/wouter@3.7.1.patch`. Re-running `pnpm install` reapplies it. Bumping wouter requires regenerating or removing the patch.

### Deploy topology

- **Netlify** — static client only (`dist/public`). Build: `pnpm run build:client`.
- **Render** — Express + WebSocket server. Build: `pnpm run build:server`, start: `pnpm start`. Health check: `/status`.

pnpm v10 forces `--frozen-lockfile` when `CI=true`. Both deploy configs use `CI=false` (Netlify) and `NPM_CONFIG_FROZEN_LOCKFILE=false` (both) to work around this. Don't remove these env vars when editing deploy configs.

### Dev-only Vite plugins

`vite-plugin-manus-runtime`, `@builder.io/vite-plugin-jsx-loc`, and an inline log-collector write browser logs to `.manus-logs/` during dev. Safe to leave alone.
