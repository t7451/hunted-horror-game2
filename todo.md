# HUNTED BY THE OBSERVER — TODO

_Last updated: 2026-05-08_

---

## 🔴 BLOCKERS (must do before any TS code changes matter)

### 0. Wire React/TS app as Vite entry point
**Root cause of every batch failure.**  
`client/index.html` is a 2474-line monolithic HTML prototype that loads Three.js r128 from CDN and has all game logic inline. `client/src/` is a complete React/Three.js engine that is **never loaded** because `index.html` has no `<script type="module">` reference. Every TypeScript change is dead code.

```bash
cp client/index.html client/public/game-legacy.html
```

Replace `client/index.html` with:
```html
<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
    <title>HUNTED BY THE OBSERVER</title>
    <meta name="description" content="Escape The Observer — a horror game. Collect keys, hide, survive." />
    <link rel="icon" type="image/png" href="/icon-192.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/manifest.json" />
  </head>
  <body class="bg-black overflow-hidden">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Verify: `pnpm build` must show many modules, not "2 modules transformed".

---

### 1. Fix pnpm lockfile (howler missing)
`howler@2.2.4` is in `package.json` but **not** in `pnpm-lock.yaml`.  
Claude Code's `pnpm install` fails with frozen lockfile error on every run.

```bash
pnpm install --no-frozen-lockfile
git add pnpm-lock.yaml && git commit -m "fix: add howler to pnpm lockfile"
```

---

## 🟡 BATCH 2 TASKS (after blockers resolved)

### 2. Run texture download
```bash
node scripts/download-textures.js
```
Populates `client/public/assets/textures/` with Poly Haven CC0 PBR JPGs.  
MaterialFactory upgrades from procedural fallback to real textures automatically.  
Do NOT commit binary assets — add to `.gitignore` if missing.

---

### 3. Smoke test full TS engine in browser
After Task 0 wires the app, manual pass before writing new code:
- [ ] Title screen loads
- [ ] Easy mode → 3D scene renders (textured or procedural walls, not blank)
- [ ] WASD moves camera
- [ ] Observer spawns and pathfinds around walls (not through them)
- [ ] Key pickup → metallic click sound
- [ ] Observer catches player → flash overlay + sting → caught screen
- [ ] Mobile joystick works

Log every console error. Fix all before proceeding.

---

### 4. Fix expected runtime errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Cannot find module 'howler'` | Lockfile not updated | Task 1 |
| `Howl is not a constructor` | Howler globals | Add `optimizeDeps: { include: ['howler'] }` to `vite.config.ts` |
| `cachedGeo is not a function` | Module-level cache init order | Move `_geoCache`/`_matCache` inside TheObserver constructor |
| Observer frozen | Null path from A* | Verify null-path fallback fires in `updateLocalEnemy` |
| `AudioContext was not allowed to start` | Expected — requires user gesture | Already handled via `unlock()` on canvas click |

---

### 5. Map redesign (`shared/maps.ts`)

Add `patrolWaypoints: { x: number; z: number }[]` to `MapDef` type.

Redesign all three maps with:
- Named rooms (kitchen, bedroom, hallway, etc.)
- Mixed corridor widths: 1-tile hallways + 2-3 tile rooms
- No sightline longer than 6 tiles
- Observer spawn ≥12 tiles (Manhattan) from player spawn
- ≥1 dead-end per map

| Map | Difficulty | Keys | Time | Speed |
|-----|-----------|------|------|-------|
| The Farmhouse | Easy | 3 | 240s | 3.0 |
| The Mill | Normal | 5 | 180s | 4.2 |
| The Basement | Hard | 6 | 120s | 5.4 |

---

### 6. Observer patrol mode (`client/src/game/engine.ts`)

Replace random wander (when player hides) with waypoint patrol.

```typescript
// Add after `let enemyPath`:
let patrolIndex = 0;
const patrolWaypoints = (mapDef.patrolWaypoints ?? []).map(wp => ({
  x: wp.x * TILE_SIZE + TILE_SIZE / 2,
  z: wp.z * TILE_SIZE + TILE_SIZE / 2,
}));
```

In `isHiding` branch — replace random wander target with:
```typescript
if (patrolWaypoints.length > 0) {
  const wp = patrolWaypoints[patrolIndex % patrolWaypoints.length];
  const dist = Math.hypot(wp.x - enemyMesh.position.x, wp.z - enemyMesh.position.z);
  if (dist < 1.0) patrolIndex = (patrolIndex + 1) % patrolWaypoints.length;
  lastKnownPlayerX = wp.x;
  lastKnownPlayerZ = wp.z;
}
```

---

### 7. Rebrand "Claude" → "The Observer"

Files: `client/src/game/Game3D.tsx`, `engine.ts`, `aiDirector.ts`

```bash
grep -rn "Claude\|claude" client/src/ --include="*.tsx" --include="*.ts" \
  | grep -v "claudeSpeed\|import\|//\|node_modules"
```

- Replace all user-visible strings
- `claudeSpeed` field name in `MapDef` can stay (internal only)
- Caught screen copy:
```tsx
<p className="text-4xl font-mono text-white/20 tracking-widest">PROCESS TERMINATED</p>
<p className="text-sm font-mono text-white/30">
  {`0x${Math.floor(Math.random()*0xFFFF).toString(16).toUpperCase().padStart(4,'0')}`}
</p>
```

---

### 8. Remove dead code (`client/src/game/engine.ts`)

Remove `calculateEnemySpeed` function (~lines 128–137).  
Unreachable since pathfinding rewrite in PR #39.

---

## ✅ COMPLETED

### PR #39 — Merged to main (commit `a7a7462`)
**Branch:** `feat/horror-overhaul-audio-observer` — 24 files, +1475/-358 lines

**New files added:**
- `client/src/world/TheObserver.ts` — Procedural Three.js enemy. Tall humanoid, angular octahedron head, too-long arms, cold blue wireframe overlay, canvas "error data" face texture, PointLight eyes, glitch arm twitch. No GLTF required.
- `client/src/game/pathfinding.ts` — A* on tile grid, 8-directional movement, corner-cut prevention, 1200-iteration safety cap
- `client/src/audio/audio-manifest.ts` — 15 CC0 audio source declarations
- `client/public/audio/` — 15 audio files (OGG/MP3): `ambient_loop`, `heartbeat_loop`, `breath_panic`, `door_creak`, `footstep_wood_1-4`, `key_pickup`, `observer_moan_1/2`, `observer_breathing`, `observer_stalk`, `jump_scare_sting`, `static_burst`
- `scripts/download-textures.js` — Poly Haven CC0 PBR texture downloader
- `scripts/download-audio.js` — OGA CC0 audio downloader

**Modified files:**
- `client/src/audio/AudioWorld.ts` — Full Howler 2.x rewrite. Same public API + `triggerJumpScare()`, `triggerKeyPickup()`, `setEntityProximity()`. Procedural WebAudio fallback per channel.
- `client/src/game/engine.ts` — Observer wired via proxy; A* path-following + last-known-position investigate mode; catch sequence (DOM flash + PostFX spike + `onCaught` callback); key pickup audio
- `client/src/materials/MaterialFactory.ts` — Added `door_wood` + `baseboard_trim` PBR slots (8 total); async JPG loading via TextureLoader; procedural fallback intact; KTX2 path preserved
- `package.json` — `howler@2.2.4` + `@types/howler` added

**Audio sources (all CC0):**
| File | Source |
|------|--------|
| ambient_loop, observer_stalk | OGA dark_ambiences.zip (Ogrebane) |
| heartbeat_loop | OGA heartbeat_slow_0.wav (yd) |
| observer_moan_1/2/breathing | OGA qubodup-GhostMoans.zip (qubodup) |
| jump_scare_sting, static_burst | OGA horror_sfx.zip (TinyWorlds) |
| footstep_wood_1-4, key_pickup | OGA footsteps.zip (nicubunu) |
| breath_panic, door_creak | ffmpeg synthesized |

**KTX2 textures** (on `claude/visuals-and-joystick` branch — not yet on main):  
18 KTX2 files, walls/floors/ceilings/doors/trim, ~57MB, built with basisu v2.10.0

---

## Architecture Notes

### Why the TS app was disconnected
The repo has two parallel game implementations that were never bridged:
1. `client/index.html` — 2474-line HTML prototype, Three.js r128 from CDN, all logic inline
2. `client/src/` — Complete React/Three.js engine (503-line Game3D, full engine, audio, lighting, props, Observer AI)

Vite's `root: client` causes it to build `client/index.html` as the entry. Since that file has no `<script type="module">` the entire `src/` tree is never bundled. Fix: Task 0 above.

### File map
| Path | Purpose |
|------|---------|
| `client/src/game/engine.ts` | Core 3D game loop, Observer logic, pathfinding integration |
| `client/src/world/TheObserver.ts` | Observer enemy mesh + behavior |
| `client/src/game/pathfinding.ts` | A* tile pathfinder |
| `client/src/audio/AudioWorld.ts` | Howler audio manager |
| `client/src/audio/audio-manifest.ts` | CC0 audio source declarations |
| `client/src/game/Game3D.tsx` | Main game React component (503 lines) |
| `client/src/game/aiDirector.ts` | Difficulty/speed scaling |
| `client/src/materials/MaterialFactory.ts` | PBR material loader with fallback |
| `client/src/lighting/` | Atmosphere, Flicker, Practical, ShadowBudget |
| `client/src/world/` | CobWebs, DustParticles, PropSpawner, TheObserver |
| `shared/maps.ts` | Map definitions (to be redesigned in Task 5) |
| `scripts/download-textures.js` | Poly Haven PBR downloader |
| `scripts/download-audio.js` | OGA CC0 audio downloader |
| `client/public/audio/` | 15 CC0 audio files |
| `client/public/game-legacy.html` | Archived HTML prototype (after Task 0) |

### Commit messages for Batch 2
```
fix: wire client/src React app as Vite entry — replaces inline HTML game
feat: map redesign, observer patrol, UI rebrand
```

