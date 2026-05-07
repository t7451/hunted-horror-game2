# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**HUNTED BY CLAUDE** — a browser-first first-person horror escape game (Granny-meets-Dead-by-Daylight). React 19 + Three.js client, Express + `ws` WebSocket server, Anthropic SDK for in-game villain taunts.

## Commands

Package manager is **pnpm 10** (enforced via `packageManager` field). Use `pnpm`, not `npm`.

- `pnpm dev` — Vite dev server for the client (`--host` so LAN devices can join).
- `pnpm dev:server` — run the Express + WebSocket server with `tsx` (entry: `server/index.ts`).
- `pnpm build` — full production build: `vite build` for client → `dist/public`, then `esbuild` bundles `server/index.ts` → `dist/index.js` (ESM, externals preserved).
- `pnpm start` — run the bundled production server (`NODE_ENV=production node dist/index.js`).
- `pnpm check` — TypeScript validation (`tsc --noEmit`). This is the canonical "lint" — there is no ESLint config.
- `pnpm format` — Prettier write across the repo.

There are no automated tests or test runner wired up despite `vitest` being a dev dep — `pnpm check` + a manual play-through is the validation loop.

## Architecture

Three top-level source roots, configured via tsconfig path aliases:

- `client/` (alias `@/*` → `client/src/*`) — Vite + React 19 SPA. Wouter for routing (only `/` and `/404`). Tailwind 4 + shadcn/ui (Radix primitives in `components/ui`). Single gameplay route renders `pages/Home.tsx` which mounts the Three.js canvas via `game/Game3D.tsx`.
- `server/index.ts` — single-file Express + `ws` gateway. Holds session state, runs Claude (the in-game enemy) AI, persists leaderboard to `/tmp/leaderboard.json`, and calls Anthropic SDK for taunts (`@anthropic-ai/sdk`).
- `shared/` (alias `@shared/*`) — code reachable from both client and server. **`shared/maps.ts` is the source of truth for level layouts** (ASCII grids: `W` wall, `D` door, `S` spawn, `X` exit, `K` key, `H` hide, `E` enemy spawn). The server currently has a duplicated `MAPS` block at the top of `server/index.ts` — keep the two in sync when editing.

### Game engine layout (`client/src/`)

The 3D engine is a hand-written Three.js setup, not react-three-fiber. Don't refactor toward R3F unless asked.

- `game/engine.ts` — top-level engine bootstrap. Wires renderer, post-FX, lighting, audio, props, AI director. **Largest file in the codebase; read it before changing rendering or simulation.**
- `game/aiDirector.ts` — local, deterministic heuristic director (no API calls). Drives enemy speed and HUD tension scoring from triggers (start, key pickup, hiding, danger, timer pressure). README explicitly notes this is the offline fallback when no WS server is reachable.
- `render/` — `Renderer.ts`, `PostFX.ts`, shared `uniforms.ts`.
- `lighting/` — atmosphere, practicals, flicker controllers, shadow budget.
- `player/` — `CameraRig`, `Flashlight`, `Heartbeat` (audio cue tied to proximity).
- `world/` — `PropSpawner`, `Cobwebs`, `DustParticles`.
- `materials/` — `MaterialFactory` with caching + `Decals`.
- `audio/` — `AudioWorld`.

### AI duality

There are two distinct AI systems — keep them straight:

1. **Local AI Director** (`client/src/game/aiDirector.ts`) — heuristic-only, runs in the browser, no network. Drives gameplay tuning.
2. **Server-side Claude taunts** (`server/index.ts`, `@anthropic-ai/sdk`) — calls Anthropic to generate villain dialogue at 15–20s intervals (`TAUNT_MIN_MS`/`TAUNT_MAX_MS`). Requires `ANTHROPIC_API_KEY` in env; the server constructs `new Anthropic()` with no explicit key, so it must be in environment.

## Deployment topology

The client and server deploy to **different platforms** by design:

- **Netlify** (`netlify.toml`) — static client only. Publish dir is `dist/public`. Build runs `pnpm run build:client`. SPA redirect to `/index.html` is configured for wouter routes.
- **Render** (`render.yaml`) — the Express + `ws` gateway. Free plan, Oregon, Node 20, health check `/status`, build `pnpm run build:server`, start `pnpm start`.

**Why split:** Netlify Functions don't support long-lived WebSocket connections. The client gracefully falls back to single-player rendering when no WS gateway is reachable, so the static-only Netlify deploy is still playable.

### Lockfile gotcha (both platforms)

pnpm v10 force-enables `--frozen-lockfile` when `CI=true` regardless of the install flag, which breaks deploys whenever `package.json` changes ahead of `pnpm-lock.yaml`. Both deploy configs work around this with **two** knobs: `CI=false` (Netlify) and `NPM_CONFIG_FROZEN_LOCKFILE=false` (both). Don't remove either when editing the deploy configs.

## Conventions and gotchas

- **Legacy server files** (`server.js`, `server-old.js`, `server-enhanced.js`, `server-enhanced-v2.js`, `server-v3.js`, `server.js.backup`, `package-game.json`) are historical artifacts from earlier rewrites. The live server is `server/index.ts`. Don't edit the legacy `.js` files — they aren't bundled or run.
- **Patched dep:** `wouter@3.7.1` is patched via `patches/wouter@3.7.1.patch` (registered under `pnpm.patchedDependencies`). Re-running `pnpm install` reapplies it; bumping wouter requires regenerating or removing the patch.
- **Vite "Manus" plugins** (`vite-plugin-manus-runtime`, `@builder.io/vite-plugin-jsx-loc`, the inline log-collector at the top of `vite.config.ts`) write browser logs to `.manus-logs/` during dev. They're dev-only; safe to leave alone.
- **TypeScript is strict.** `noEmit: true`, `allowImportingTsExtensions: true`, `moduleResolution: "bundler"`. Imports use `.ts` extensions where the bundler resolves them.
- **No ESLint.** Use `pnpm check` + `pnpm format` as the lint gate.
- **Map editing:** when adding tiles or maps, update `shared/maps.ts` AND the duplicated `MAPS` constant in `server/index.ts`. Tile constants `TILE_SIZE = 4`, `WALL_HEIGHT = 4` are referenced from both sides.
