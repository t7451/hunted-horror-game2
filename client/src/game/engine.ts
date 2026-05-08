import * as THREE from "three";
import {
  MAPS,
  parseMap,
  TILE_SIZE,
  WALL_HEIGHT,
  isBlocked,
  validateParsedMap,
  type MapKey,
  type MapDef,
  type ParsedMap,
} from "@shared/maps";
import {
  isMobile,
  perfFlag,
  resolveGraphicsQuality,
  type GraphicsQuality,
} from "../util/device";
import {
  isBatterySaverEnabled,
  subscribeBatterySaver,
} from "../util/batterySaver";
import { createPerfMonitor } from "../util/perfMonitor";
import { createRenderer } from "../render/Renderer";
import { createPostFX, type PostFX } from "../render/PostFX";
import { AdaptiveQuality } from "../render/AdaptiveQuality";
import { LightCuller } from "../lighting/LightCuller";
import { createSharedUniforms } from "../render/uniforms";
import { setupAtmosphere } from "../lighting/Atmosphere";
import { createPractical } from "../lighting/Practical";
import { FlickerGroup, LightFlicker } from "../lighting/Flicker";
import { ShadowBudget } from "../lighting/ShadowBudget";
import { createFlashlight } from "../player/Flashlight";
import { CameraRig } from "../player/CameraRig";
import { Heartbeat } from "../player/Heartbeat";
import { AudioWorld } from "../audio/AudioWorld";
import { FootstepSystem } from "../audio/FootstepSystem";
import { PickupBurst } from "../effects/PickupBurst";
import { FootstepDust } from "../effects/FootstepDust";
import {
  getMaterial,
  resetMaterialCache,
  configureMaterials,
  type MaterialFactoryDeps,
} from "../materials/MaterialFactory";
import { AssetManager } from "../loaders/AssetManager";
import { DecalSpawner } from "../materials/Decals";
import { PropSpawner, type PropKind } from "../world/PropSpawner";
import { CobwebSet } from "../world/Cobwebs";
import { DustParticles } from "../world/DustParticles";
import { buildWalls } from "../world/WallBuilder";
import { WallDecals } from "../world/WallDecals";
import { buildDoorFrames } from "../world/DoorFrames";
import { WallFixtures } from "../world/WallFixtures";
import { buildCeilingFixtures } from "../world/CeilingFixtures.ts";
import { createAIDirector, type DirectorUpdate } from "./aiDirector";
import { findPath } from "./pathfinding";
import { TheObserver, disposeObserverCache } from "../world/TheObserver";
import { Haptics } from "../util/haptics";
import { dumpLightingState } from "../util/lightingDebug";

// Debug / safety URL flags — read once at module load. ?lightdebug=1 turns
// on the per-2s lighting state dump (see lightingDebug.ts). ?nosave=1 force-
// disables the battery-saver auto-detect path while we're verifying the
// black-screen hotfix.
const LIGHT_DEBUG =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("lightdebug");

// ─────────────────────────────────────────────────────────────────────────────
// Rendering backend for HUNTED BY CLAUDE.
// Uses Three.js (a comprehensive 3D JavaScript framework) to deliver a
// first-person horror experience reminiscent of browser titles like Granny:
// dim warm interior lighting, a flashlight cone, fog, doors, keys to collect,
// and hiding closets. Player movement uses pointer-lock + WASD with simple
// AABB-vs-tile collisions against the parsed grid map.
// ─────────────────────────────────────────────────────────────────────────────

export type RemotePlayer = {
  id: string;
  x: number;
  z: number;
  rotY: number;
  name?: string;
};

export type VirtualInput = {
  moveX: number;
  moveZ: number;
  sprinting: boolean;
};

export type EngineEvents = {
  onReady?: (info: {
    keys: number;
    timer: number;
    mapName: string;
    notesTotal: number;
    batteriesTotal: number;
  }) => void;
  onKeyPickup?: (remaining: number) => void;
  onCaught?: () => void;
  onTimeUp?: () => void;
  onEscape?: () => void;
  onError?: (err: Error) => void;
  onHint?: (hint: string) => void;
  onTimer?: (remaining: number) => void;
  onDangerChange?: (danger: "safe" | "near" | "critical") => void;
  onHideChange?: (hidden: boolean) => void;
  onAIDirector?: (update: DirectorUpdate) => void;
  onThrowableCount?: (remaining: number) => void;
  /** Flashlight charge 0..1 (engine drains over time, batteries refill). */
  onBatteryChange?: (charge: number) => void;
  /** Notes collected / total — refreshed when picked up. */
  onNotesChange?: (collected: number, total: number) => void;
  /**
   * Catch-sequence fade-to-black driver, 0..1. Drives a black overlay in
   * the React layer (engine fires this every frame the catch sequence is
   * active; it stays at 0 outside of it).
   */
  onCatchFade?: (v: number) => void;
};

export type EngineHandle = {
  dispose: () => void;
  setRemotePlayers: (players: RemotePlayer[]) => void;
  setEnemy: (pos: { x: number; z: number } | null) => void;
  setVirtualInput: (input: Partial<VirtualInput>) => void;
  toggleHide: () => void;
  throwObject: () => void;
  getPlayerState: () => { x: number; z: number; rotY: number };
  /**
   * Resume the audio context. Must be called from a user gesture (button
   * click) on iOS Safari or autoplay-blocked Chrome. No-op if already
   * unlocked.
   */
  unlockAudio: () => boolean;
  setSensitivity: (s: number) => void;
  getMinimapState: () => MinimapState;
  getObserverIndicatorState: () => ObserverIndicatorState;
};

export type ObserverIndicatorState = {
  /** Yaw to the Observer relative to camera forward (0 = ahead, ±π = behind). */
  angleRelative: number;
  /** 0..1 visibility: 1 = full threat, 0 = invisible. Edge-of-screen UI only
   *  shows when |angleRelative| > 0.9 rad (off-screen) and intensity > 0.05. */
  intensity: number;
};

export type MinimapState = {
  playerX: number;
  playerZ: number;
  enemyX: number | null;
  enemyZ: number | null;
  enemyVisible: boolean;
  keys: { x: number; z: number }[];
  exitX: number;
  exitZ: number;
  exitOpen: boolean;
  mapWidth: number;
  mapHeight: number;
  tileSize: number;
  tiles: string[][];
};

// Scale the (0..1) UVs of a PlaneGeometry by (sx, sy). Used so a single big
// floor/ceiling plane gets the texture repeated per-tile rather than once
// across the whole world. Combined with material.tex.repeat = (tiling, tiling)
// each TILE_SIZE-wide cell ends up with `tiling` repeats — the same density
// walls receive on their TILE_SIZE-wide faces.
function scalePlaneUVs(geo: THREE.PlaneGeometry, sx: number, sy: number): void {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  }
  uv.needsUpdate = true;
}

// Deterministic per-tile hash. Seeded so two callers can pull two
// uncorrelated variation streams from the same (x, z).
function tileHash(x: number, z: number, seed: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233 + seed * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

// Add a per-instance UV offset attribute to `geo` and patch `mat`'s vertex
// shader to add the offset to every map UV. Effect: even though every
// instance shares one texture, each tile samples a different region of it,
// breaking the visual repeat (e.g. wallpaper bands that would otherwise
// line up across rows of wall tiles).
//
// The patch survives async JPG/KTX2 swap-in: when MaterialFactory marks
// `mat.needsUpdate = true` after a texture loads, Three recompiles the
// shader and onBeforeCompile fires again with our same callback installed.
//
// Guarded by USE_INSTANCING in case the same material is later reused on a
// non-instanced mesh — that path skips the offset cleanly.
function applyInstanceUvOffset(
  geo: THREE.BufferGeometry,
  mat: THREE.MeshStandardMaterial,
  positions: ArrayLike<{ x: number; z: number }>,
): void {
  const offsets = new Float32Array(positions.length * 2);
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    offsets[i * 2 + 0] = tileHash(p.x, p.z, 23);
    offsets[i * 2 + 1] = tileHash(p.x, p.z, 31);
  }
  geo.setAttribute(
    "instanceUvOffset",
    new THREE.InstancedBufferAttribute(offsets, 2),
  );
  // Idempotent: re-installing the same callback is a no-op.
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <uv_pars_vertex>",
        `#include <uv_pars_vertex>
#ifdef USE_INSTANCING
attribute vec2 instanceUvOffset;
#endif`,
      )
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>
#ifdef USE_INSTANCING
#ifdef USE_MAP
vMapUv += instanceUvOffset;
#endif
#ifdef USE_NORMALMAP
vNormalMapUv += instanceUvOffset;
#endif
#ifdef USE_AOMAP
vAoMapUv += instanceUvOffset;
#endif
#ifdef USE_ROUGHNESSMAP
vRoughnessMapUv += instanceUvOffset;
#endif
#ifdef USE_METALNESSMAP
vMetalnessMapUv += instanceUvOffset;
#endif
#endif`,
      );
  };
  mat.needsUpdate = true;
}

// Fill an InstancedMesh's per-instance color with subtle warm/cool brightness
// variation tied to (x, z) so the same map looks identical between mounts.
// The tint is multiplied into the material color, so values stay near 1.0 to
// avoid washing out or darkening the underlying texture.
function applyInstanceTint(
  mesh: THREE.InstancedMesh,
  positions: ArrayLike<{ x: number; z: number }>,
  range: number = 0.16,
  warmth: number = 0.06,
): void {
  const tint = new THREE.Color();
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const v = tileHash(p.x, p.z, 1) - 0.5; // -0.5..0.5
    const w = (tileHash(p.x, p.z, 7) - 0.5) * warmth; // ±warmth/2
    const k = 1 + v * range; // centered on 1.0, span = `range`
    tint.setRGB(k + w, k, k - w);
    mesh.setColorAt(i, tint);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

// Tiny seedable PRNG so prop / cobweb placement is stable across mounts
// of the same map (no popping when the user re-enters the house).
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLAYER_RADIUS = 0.6;
const ENEMY_RADIUS = 0.45;
// Catch sequence: player input freezes, PostFX spikes, caught fires after delay
const CATCH_DIST = 1.5;
const CATCH_SEQUENCE_DURATION = 1.6;
// Pathfinding: recompute path every N seconds (not every frame)
const PATH_RECOMPUTE_INTERVAL = 0.45;
const PLAYER_HEIGHT = 1.7;
const MOVE_SPEED = 4.5;
const SPRINT_MULT = 1.6;
const MOVE_ACCELERATION = 30;
const MOVE_DECELERATION = 24;
const HIDE_INTERACTION_DISTANCE = 2.2;
const REMOTE_ENEMY_TIMEOUT_MS = 1200;
const INVESTIGATING_SPEED_FACTOR = 0.25;
const MOUSE_LOOK_SCALE = 0.0022; // pointer-lock — typical FPS feel
const MOBILE_LOOK_SCALE = 0.0055; // touch drag — slightly faster for thumbs

function calculateMoveSpeed(
  isHidden: boolean,
  isSprinting: boolean,
  inputMagnitude: number
) {
  if (isHidden) return 0;
  return (isSprinting ? MOVE_SPEED * SPRINT_MULT : MOVE_SPEED) * inputMagnitude;
}

export function startGame(
  container: HTMLElement,
  options: {
    mapKey?: MapKey;
    quality?: GraphicsQuality;
    sensitivity?: number;
    events?: EngineEvents;
    /** Deterministic seed for prop/cobweb placement. Used by daily challenge. */
    seed?: number;
  } = {}
): EngineHandle {
  const mapDef: MapDef = MAPS[options.mapKey ?? "easy"];
  const parsed = parseMap(mapDef);
  const mapIssues = validateParsedMap(parsed);
  if (mapIssues.length > 0) {
    console.warn(`[map] ${mapDef.name} integrity issues`, mapIssues);
  }
  const events = options.events ?? {};
  const quality = resolveGraphicsQuality(options.quality);
  const shadowsEnabled = quality !== "low";

  // ── Renderer ───────────────────────────────────────────────────────────────
  // Tier-aware construction lives in render/Renderer.ts so PostFX can branch
  // identically (mobile drops native MSAA in favor of SMAA, etc.).
  const {
    renderer,
    contextLost: isContextLost,
    detachContextHandlers,
  } = createRenderer({
    quality: options.quality,
  });
  container.appendChild(renderer.domElement);

  // Adaptive renderer DPR — drops on sustained <30fps, rises on >55fps.
  const adaptiveQuality = new AdaptiveQuality(renderer, isMobile ? 1.5 : 2.0);
  // Distance-based light culler — practicals dim/disable beyond ~18 tiles.
  const lightCuller = new LightCuller(isMobile ? 14 : 20);
  let lastPropCullAt = 0;

  // KTX2 texture pipeline: getMaterial() returns procedural fallbacks
  // synchronously; configureMaterials() lets the factory upgrade them in-place
  // once the loader resolves. Failure (older browsers, no three-stdlib) leaves
  // the procedural noise in place — no crash.
  const assetManager = new AssetManager();
  void assetManager
    .getKtx2Loader(renderer)
    .then(loader => {
      if (loader)
        configureMaterials({
          ktx2Loader: loader as MaterialFactoryDeps["ktx2Loader"],
        });
    })
    .catch(() => {
      /* procedural fallbacks remain active */
    });

  const sharedUniforms = createSharedUniforms();
  const basePostFx = {
    vignetteOffset: sharedUniforms.vignetteOffset.value,
    noiseOpacity: sharedUniforms.noiseOpacity.value,
    bloomIntensity: sharedUniforms.bloomIntensity.value,
  };
  let postfx: PostFX | null = null;

  // Battery saver — caps to ~30fps and disables PostFX + shadows
  let batterySaver = isBatterySaverEnabled();
  let frameSkip = 0;
  const FRAME_SKIP_TARGET = 1; // render every 2nd frame at 60fps display = ~30fps
  const unsubBatterySaver = subscribeBatterySaver(v => {
    batterySaver = v;
    if (postfx) postfx.setEnabled(!v && quality !== "low");
    renderer.shadowMap.enabled = !v && quality !== "low";
  });

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    postfx?.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  // ── Scene & Camera ─────────────────────────────────────────────────────────
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(78, 1, 0.05, 200);
  camera.position.set(
    parsed.spawn.x * TILE_SIZE + TILE_SIZE / 2,
    PLAYER_HEIGHT,
    parsed.spawn.z * TILE_SIZE + TILE_SIZE / 2
  );

  // ── Lighting ───────────────────────────────────────────────────────────────
  // Atmosphere sets near-zero ambient + hemisphere + fog so practicals
  // dominate. Flashlight is mobile-gated: PointLight on Android (avoids the
  // SpotLight+shadow WebGL crash class), SpotLight on desktop.
  setupAtmosphere(scene, mapDef.colorProfile);
  scene.add(camera);
  const flashlight = createFlashlight(camera);
  const flickers = new FlickerGroup();
  const shadowBudget = new ShadowBudget();
  shadowBudget.register(flashlight.light);
  const cameraRig = new CameraRig(camera, {
    baseFov: camera.fov,
    baseHeight: PLAYER_HEIGHT,
    crouchHeight: PLAYER_HEIGHT * 0.72,
  });
  const heartbeat = new Heartbeat(sharedUniforms);
  const audio = new AudioWorld();
  // Audio occlusion needs to know wall layout to raymarch source→listener.
  audio.bindMap(parsed, TILE_SIZE);
  // Player footsteps: 2D (listener is the player). Enemy footsteps: spatial,
  // emitted from enemyMesh.position so the player can locate the Observer
  // by ear. Surface variant chosen from the tile char under each foot.
  // Dust kick spawns under the player on wood/creaky steps; battery-saver
  // skips dust entirely.
  const footstepDust = new FootstepDust(scene);
  const footstepSystem = new FootstepSystem(
    audio,
    parsed,
    TILE_SIZE,
    false,
    (x, z, surface) => {
      if (batterySaver) return;
      if (surface === "wood" || surface === "creaky") {
        footstepDust.spawn(x, z);
      }
    },
  );
  const enemyFootstepSystem = new FootstepSystem(audio, parsed, TILE_SIZE, true);
  // Active key-pickup particle bursts. Each entry self-reports completion
  // via update() returning true; the engine then disposes its meshes.
  const activeBursts: PickupBurst[] = [];
  // (Footstep cadence now lives in FootstepSystem above, which keys off
  // actual horizontal movement distance and picks surface variants.)

  // ── Materials ──────────────────────────────────────────────────────────────
  // Walls/floor/ceiling go through MaterialFactory so the eventual KTX2
  // texture set drops in without touching the engine. Until those assets
  // land the factory returns procedural-noise PBR fallbacks tinted to
  // match the previous solid-color look.
  const wallMat = getMaterial("wallpaper_dirty");
  const floorMat = getMaterial("wood_floor_worn");
  const ceilingMat = getMaterial("ceiling_plaster");
  // Props remain hand-tuned MeshStandardMaterials: keys/exits are emissive
  // gameplay markers, doors/closets are one-off shapes that don't justify
  // a full texture set.
  const doorMat = getMaterial("door_wood");
  const keyMat = new THREE.MeshStandardMaterial({
    color: 0xffd24a,
    emissive: 0x2a1d00,
    emissiveIntensity: 0.6,
    metalness: 0.85,
    roughness: 0.3,
  });
  // Wardrobe/closet uses the PBR wood_panel_dark material for a richer look.
  const wardrobeMat = getMaterial("wood_panel_dark");
  const exitMat = new THREE.MeshStandardMaterial({
    color: 0x1a4a1a,
    emissive: 0x0a4a0a,
    emissiveIntensity: 0.8,
    roughness: 0.6,
  });

  // ── World geometry ─────────────────────────────────────────────────────────
  const worldW = parsed.width * TILE_SIZE;
  const worldD = parsed.height * TILE_SIZE;

  // Floor / ceiling: single planes spanning the whole world. Without UV
  // scaling the material's tex.repeat=(tiling, tiling) would stretch the
  // texture across ~150m of floor; scale UVs so one tile of texture density
  // matches a TILE_SIZE-wide cell, the same way walls (4m boxes) get it.
  const floorGeo = new THREE.PlaneGeometry(worldW, worldD);
  scalePlaneUVs(floorGeo, parsed.width, parsed.height);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(worldW / 2, 0, worldD / 2);
  floor.receiveShadow = shadowsEnabled;
  scene.add(floor);

  const ceilingGeo = new THREE.PlaneGeometry(worldW, worldD);
  scalePlaneUVs(ceilingGeo, parsed.width, parsed.height);
  const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(worldW / 2, WALL_HEIGHT, worldD / 2);
  scene.add(ceiling);

  // Water-stained ceiling — irregular sepia blotches over interior tiles.
  // Plane meshes facing down, slightly below the ceiling plane with
  // polygonOffset to avoid z-fighting. Density target: ~one stain per
  // ~12 floor tiles, randomised but reproducible per map.
  {
    const stainSeed = (options.seed ?? 0x484e54) ^ 0x57415354;
    const stainRng = mulberry32(stainSeed >>> 0);
    const stainMat = new THREE.MeshStandardMaterial({
      color: 0x3a2418,
      transparent: true,
      opacity: 0.55,
      roughness: 0.95,
      metalness: 0,
      side: THREE.FrontSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const stainGroup = new THREE.Group();
    stainGroup.name = "ceiling_stains";
    const floorTiles: { x: number; z: number }[] = [];
    for (let z = 0; z < parsed.height; z++) {
      for (let x = 0; x < parsed.width; x++) {
        if (parsed.tiles[z][x] === ".") floorTiles.push({ x, z });
      }
    }
    const stainCount = Math.max(4, Math.floor(floorTiles.length / 12));
    for (let i = 0; i < stainCount; i++) {
      const t = floorTiles[Math.floor(stainRng() * floorTiles.length)];
      // Two layered blotches per stain — outer faint halo + inner darker
      // core — read as concentric water-damage rings.
      const cx = (t.x + stainRng()) * TILE_SIZE;
      const cz = (t.z + stainRng()) * TILE_SIZE;
      const outerSize = 1.2 + stainRng() * 1.6;
      const outer = new THREE.Mesh(
        new THREE.PlaneGeometry(outerSize, outerSize * (0.7 + stainRng() * 0.6)),
        stainMat
      );
      outer.rotation.x = Math.PI / 2;
      outer.rotation.z = stainRng() * Math.PI * 2;
      outer.position.set(cx, WALL_HEIGHT - 0.005, cz);
      stainGroup.add(outer);
      const inner = new THREE.Mesh(
        new THREE.PlaneGeometry(outerSize * 0.55, outerSize * 0.55 * (0.7 + stainRng() * 0.6)),
        stainMat
      );
      inner.rotation.x = Math.PI / 2;
      inner.rotation.z = stainRng() * Math.PI * 2;
      inner.position.set(
        cx + (stainRng() - 0.5) * outerSize * 0.2,
        WALL_HEIGHT - 0.01,
        cz + (stainRng() - 0.5) * outerSize * 0.2
      );
      stainGroup.add(inner);
    }
    scene.add(stainGroup);
  }

  // Walls — coalesced into per-run boxes by WallBuilder. Replaces the old
  // per-tile InstancedMesh, which produced visible seams/z-fighting at tile
  // edges and identical-tile striping along long runs. Collision still reads
  // parsed.tiles[][] directly, so this is a render-only swap.
  const wallBuild = buildWalls(parsed, TILE_SIZE, wallMat, {
    castShadow: shadowsEnabled,
    receiveShadow: shadowsEnabled,
  });
  scene.add(wallBuild.group);

  // Door frames — wood header + jambs around every D tile so doorways have
  // a finished edge instead of geometry that just stops.
  const doorFrameMat = new THREE.MeshStandardMaterial({
    color: 0x3a2a1c,
    roughness: 0.85,
    metalness: 0,
  });
  const doorFrameBuild = buildDoorFrames(parsed, TILE_SIZE, doorFrameMat);
  scene.add(doorFrameBuild.group);

  // Wall decoration — sparse decals + fixtures keyed off the map seed so
  // placement is deterministic per map and independent from prop placement.
  // The per-tile InstancedMesh + applyInstanceTint/UvOffset variation that
  // main added are intentionally not used here: WallBuilder produces merged
  // run meshes, so per-tile attributes don't apply. Variation now comes
  // from per-run 90° UV rotation inside WallBuilder.
  //
  // Each constructor gets its own independent RNG stream so tweaking decal
  // density doesn't shift every fixture's placement.
  const baseSeed = options.seed ?? 0x484e54;
  const decalRng = mulberry32((baseSeed ^ 0x57414c4c) >>> 0);
  const fixtureRng = mulberry32((baseSeed ^ 0x46585452) >>> 0);
  const wallDecals = new WallDecals(parsed, TILE_SIZE, decalRng);
  scene.add(wallDecals.object);
  const wallFixtures = new WallFixtures(parsed, TILE_SIZE, fixtureRng);
  scene.add(wallFixtures.object);

  // Architectural trim — thin instanced strip at every wall→floor seam.
  // Mid+ quality only; on low we keep the silhouette flat to spare draws.
  if (quality !== "low") {
    const trimSegments: { x: number; z: number; rotY: number }[] = [];
    const trimDirs: { dx: number; dz: number; rotY: number }[] = [
      { dx: 0, dz: -1, rotY: 0 },
      { dx: 0, dz: 1, rotY: Math.PI },
      { dx: -1, dz: 0, rotY: Math.PI / 2 },
      { dx: 1, dz: 0, rotY: -Math.PI / 2 },
    ];
    for (let z = 0; z < parsed.height; z++) {
      for (let x = 0; x < parsed.width; x++) {
        if (parsed.tiles[z][x] !== "W") continue;
        for (const d of trimDirs) {
          const nx = x + d.dx;
          const nz = z + d.dz;
          if (nz < 0 || nz >= parsed.height || nx < 0 || nx >= parsed.width)
            continue;
          if (parsed.tiles[nz][nx] !== ".") continue;
          const wx =
            x * TILE_SIZE + TILE_SIZE / 2 + d.dx * (TILE_SIZE / 2 - 0.04);
          const wz =
            z * TILE_SIZE + TILE_SIZE / 2 + d.dz * (TILE_SIZE / 2 - 0.04);
          trimSegments.push({ x: wx, z: wz, rotY: d.rotY });
        }
      }
    }

    if (trimSegments.length > 0) {
      const trimMat = getMaterial("baseboard_trim");
      const trimTmp = new THREE.Object3D();

      const baseboardGeo = new THREE.BoxGeometry(TILE_SIZE, 0.12, 0.04);
      const baseboardMesh = new THREE.InstancedMesh(
        baseboardGeo,
        trimMat,
        trimSegments.length
      );
      baseboardMesh.castShadow = false;
      baseboardMesh.receiveShadow = shadowsEnabled;
      for (let i = 0; i < trimSegments.length; i++) {
        const s = trimSegments[i];
        trimTmp.position.set(s.x, 0.06, s.z);
        trimTmp.rotation.set(0, s.rotY, 0);
        trimTmp.updateMatrix();
        baseboardMesh.setMatrixAt(i, trimTmp.matrix);
      }
      baseboardMesh.instanceMatrix.needsUpdate = true;
      // Smaller variation than walls — trim should still read as one
      // continuous board strip, just not perfectly uniform.
      applyInstanceTint(
        baseboardMesh,
        trimSegments.map(s => ({ x: s.x, z: s.z })),
        0.10,
        0.03,
      );
      scene.add(baseboardMesh);

      // Crown molding — high quality only.
      if (quality === "high") {
        const crownGeo = new THREE.BoxGeometry(TILE_SIZE, 0.08, 0.06);
        const crownMesh = new THREE.InstancedMesh(
          crownGeo,
          trimMat,
          trimSegments.length
        );
        crownMesh.castShadow = false;
        crownMesh.receiveShadow = shadowsEnabled;
        for (let i = 0; i < trimSegments.length; i++) {
          const s = trimSegments[i];
          trimTmp.position.set(s.x, WALL_HEIGHT - 0.04, s.z);
          trimTmp.rotation.set(0, s.rotY, 0);
          trimTmp.updateMatrix();
          crownMesh.setMatrixAt(i, trimTmp.matrix);
        }
        crownMesh.instanceMatrix.needsUpdate = true;
        applyInstanceTint(
          crownMesh,
          trimSegments.map(s => ({ x: s.x, z: s.z })),
          0.10,
          0.03,
        );
        scene.add(crownMesh);
      }

      // Wainscoting dado rail — kitchen and house themes only.
      // A dado cap strip at ~1 m height + a flat wood panel below it give
      // period-appropriate depth and break up the long wall expanses.
      if (mapDef.theme === "kitchen" || mapDef.theme === "house") {
        const dadoMat = getMaterial("wood_panel_dark");
        // Cap molding: projects proud of the wall face
        const dadoCapGeo = new THREE.BoxGeometry(TILE_SIZE, 0.065, 0.055);
        const dadoCapMesh = new THREE.InstancedMesh(
          dadoCapGeo,
          dadoMat,
          trimSegments.length
        );
        dadoCapMesh.castShadow = false;
        dadoCapMesh.receiveShadow = shadowsEnabled;
        // Flat panel from baseboard top (≈0.12) to dado cap bottom (≈0.97)
        const panelH = 0.85;
        const dadoPanelGeo = new THREE.BoxGeometry(TILE_SIZE, panelH, 0.022);
        const dadoPanelMesh = new THREE.InstancedMesh(
          dadoPanelGeo,
          dadoMat,
          trimSegments.length
        );
        dadoPanelMesh.castShadow = false;
        dadoPanelMesh.receiveShadow = shadowsEnabled;
        for (let i = 0; i < trimSegments.length; i++) {
          const s = trimSegments[i];
          trimTmp.position.set(s.x, 1.0, s.z);
          trimTmp.rotation.set(0, s.rotY, 0);
          trimTmp.updateMatrix();
          dadoCapMesh.setMatrixAt(i, trimTmp.matrix);
          trimTmp.position.set(s.x, 0.12 + panelH * 0.5, s.z);
          trimTmp.rotation.set(0, s.rotY, 0);
          trimTmp.updateMatrix();
          dadoPanelMesh.setMatrixAt(i, trimTmp.matrix);
        }
        dadoCapMesh.instanceMatrix.needsUpdate = true;
        dadoPanelMesh.instanceMatrix.needsUpdate = true;
        applyInstanceTint(
          dadoCapMesh,
          trimSegments.map(s => ({ x: s.x, z: s.z })),
          0.08,
          0.02,
        );
        applyInstanceTint(
          dadoPanelMesh,
          trimSegments.map(s => ({ x: s.x, z: s.z })),
          0.08,
          0.02,
        );
        scene.add(dadoCapMesh);
        scene.add(dadoPanelMesh);
      }
    }
  }

  // ── Paneled door geometry ───────────────────────────────────────────────────
  // A classic 6-piece door: thinner body + proud left/right stiles +
  // top/bottom/mid rails. The depth difference casts shadow lines under
  // point-light illumination and reads as a real door leaf.
  function buildPaneledDoorGeo(w: number, h: number): THREE.BufferGeometry {
    const bodyD = 0.12;
    const frameD = 0.20;
    const sw = Math.min(0.20, w * 0.055); // stile width
    const rh = Math.min(0.22, h * 0.065); // top/bottom rail height
    const mh = 0.16; // mid rail height
    const pieces: Array<{ sx: number; sy: number; sz: number; px: number; py: number; pz: number }> = [
      { sx: w, sy: h, sz: bodyD, px: 0, py: h * 0.5, pz: 0 },                       // body
      { sx: sw, sy: h, sz: frameD, px: -(w * 0.5 - sw * 0.5), py: h * 0.5, pz: 0 }, // left stile
      { sx: sw, sy: h, sz: frameD, px: (w * 0.5 - sw * 0.5), py: h * 0.5, pz: 0 },  // right stile
      { sx: w - sw * 2, sy: rh, sz: frameD, px: 0, py: h - rh * 0.5, pz: 0 },       // top rail
      { sx: w - sw * 2, sy: rh, sz: frameD, px: 0, py: rh * 0.5, pz: 0 },           // bottom rail
      { sx: w - sw * 2, sy: mh, sz: frameD, px: 0, py: h * 0.5, pz: 0 },            // mid rail
    ];
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
    for (const p of pieces) {
      const g = new THREE.BoxGeometry(p.sx, p.sy, p.sz);
      g.applyMatrix4(new THREE.Matrix4().makeTranslation(p.px, p.py, p.pz));
      const ni = g.toNonIndexed();
      const pa = ni.attributes.position.array as Float32Array;
      const na = ni.attributes.normal.array as Float32Array;
      const ua = ni.attributes.uv.array as Float32Array;
      for (let i = 0; i < pa.length; i++) positions.push(pa[i]);
      for (let i = 0; i < na.length; i++) normals.push(na[i]);
      for (let i = 0; i < ua.length; i++) uvs.push(ua[i]);
      g.dispose(); ni.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }

  const doorGeo = buildPaneledDoorGeo(TILE_SIZE * 0.95, WALL_HEIGHT * 0.92);
  const keyGeo = new THREE.TorusGeometry(
    0.25,
    0.08,
    8,
    quality === "low" ? 16 : 24
  );

  // Seed grime/blood/water decals on random wall faces and floor patches
  // so surfaces don't read as procedurally-clean. Density target from spec
  // is 12–20 per room; we approximate by ratio to wall count until Phase 6
  // brings room volumes online.
  const decals = new DecalSpawner(scene);
  const decalCount =
    quality === "low"
      ? Math.min(50, Math.max(12, Math.floor(parsed.walls.length * 0.22)))
      : Math.min(140, Math.max(36, Math.floor(parsed.walls.length * 0.6)));
  for (let i = 0; i < decalCount; i++) {
    const w = parsed.walls[Math.floor(Math.random() * parsed.walls.length)];
    const wx = w.x * TILE_SIZE + TILE_SIZE / 2;
    const wz = w.z * TILE_SIZE + TILE_SIZE / 2;
    // Pick one of four cardinal faces; nudge the decal just outside the
    // wall cube so it doesn't z-fight with the wall geometry.
    const face = Math.floor(Math.random() * 4);
    const offset = TILE_SIZE / 2 + 0.01;
    const normal = new THREE.Vector3();
    const pos = new THREE.Vector3(
      wx,
      0.4 + Math.random() * (WALL_HEIGHT - 0.8),
      wz
    );
    if (face === 0) {
      pos.x += offset;
      normal.set(1, 0, 0);
    } else if (face === 1) {
      pos.x -= offset;
      normal.set(-1, 0, 0);
    } else if (face === 2) {
      pos.z += offset;
      normal.set(0, 0, 1);
    } else {
      pos.z -= offset;
      normal.set(0, 0, -1);
    }
    const r = Math.random();
    const kind =
      r < 0.18 ? "blood" : r < 0.34 ? "scratch" : r < 0.48 ? "water" : "grime";
    decals.spawn({
      kind,
      position: pos,
      normal,
      size: 0.4 + Math.random() * 0.7,
    });
  }

  // Doors — each door is a hinge group rotated around its open-edge so the
  // door panel pivots realistically. Per-frame the engine sweeps each door's
  // currentRot toward targetRot, where target is set by tickDoorSwings()
  // based on player proximity. When the door starts opening or closing it
  // fires a spatial door_creak from its world position.
  type DoorState = {
    group: THREE.Group;
    tileX: number;
    tileZ: number;
    centerX: number;
    centerZ: number;
    opensNorthSouth: boolean;
    currentRot: number; // 0 = closed (across opening), π/2 = open
    targetRot: number;
    creakUntil: number; // perf.now() < creakUntil suppresses re-creak
    closedUntil: number; // 0 means free to auto-open
  };
  const doorStates: DoorState[] = [];
  const doorGroup = new THREE.Group();
  parsed.doors.forEach(d => {
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.castShadow = shadowsEnabled;
    door.receiveShadow = shadowsEnabled;
    const wallWest = isBlocked(parsed, d.x - 1, d.z);
    const wallEast = isBlocked(parsed, d.x + 1, d.z);
    const opensNorthSouth = wallWest && wallEast;
    const centerX = d.x * TILE_SIZE + TILE_SIZE / 2;
    const centerZ = d.z * TILE_SIZE + TILE_SIZE / 2;

    // Hinge group sits at the doorframe edge; the door panel is offset
    // half its width in the open direction so rotation around Y pivots the
    // door around the hinge rather than the panel center.
    const hinge = new THREE.Group();
    if (opensNorthSouth) {
      // Door panel runs along Z; hinge on the +X side of the opening.
      hinge.position.set(centerX + TILE_SIZE / 2, 0, centerZ);
      door.position.set(-TILE_SIZE / 2, (WALL_HEIGHT * 0.92) / 2, 0);
      door.rotation.y = Math.PI / 2;
    } else {
      // Door panel runs along X; hinge on the +Z side of the opening.
      hinge.position.set(centerX, 0, centerZ + TILE_SIZE / 2);
      door.position.set(0, (WALL_HEIGHT * 0.92) / 2, -TILE_SIZE / 2);
    }
    hinge.add(door);
    doorGroup.add(hinge);

    doorStates.push({
      group: hinge,
      tileX: d.x,
      tileZ: d.z,
      centerX,
      centerZ,
      opensNorthSouth,
      currentRot: 0,
      targetRot: 0,
      creakUntil: 0,
      closedUntil: 0,
    });
  });
  scene.add(doorGroup);

  // Auto-open doors near the player. Slow swing speeds give a horror-house
  // feel; OPEN_SPEED < CLOSE_SPEED so doors close just a touch faster than
  // they open (creates a subtle "behind-you" pressure).
  const DOOR_OPEN_RANGE = 3.4;
  const DOOR_OPEN_SPEED = 2.4; // rad/s
  const DOOR_CLOSE_SPEED = 1.6; // rad/s
  const DOOR_PASSABLE_ROT = Math.PI * 0.35;
  function tickDoorSwings(dt: number): void {
    const now = performance.now();
    for (const door of doorStates) {
      const dx = camera.position.x - door.centerX;
      const dz = camera.position.z - door.centerZ;
      const dist = Math.hypot(dx, dz);
      const desired =
        door.closedUntil > now
          ? 0
          : dist < DOOR_OPEN_RANGE
            ? Math.PI / 2
            : 0;
      if (desired !== door.targetRot) {
        door.targetRot = desired;
        // Fire one creak when the target flips. Cooldown prevents the door
        // from re-creaking if the player paces back and forth on the edge.
        if (now > door.creakUntil) {
          audio.playAt("door_creak", door.centerX, 1.2, door.centerZ);
          door.creakUntil = now + 1500;
        }
      }
      const delta = door.targetRot - door.currentRot;
      if (Math.abs(delta) < 0.001) continue;
      const speed = delta > 0 ? DOOR_OPEN_SPEED : DOOR_CLOSE_SPEED;
      const step = Math.sign(delta) * Math.min(Math.abs(delta), speed * dt);
      door.currentRot += step;
      // North/south doors hinge on the +X side; rotating +Y opens "into"
      // the room behind the hinge (negative direction works visually).
      door.group.rotation.y = door.opensNorthSouth
        ? door.currentRot
        : -door.currentRot;
    }
  }

  // Keys (with little point lights). Each uncollected key emits a faint
  // looping spatial sparkle once audio is unlocked; the handle is tracked
  // per-key so we can stop it on collect.
  const keyGroup = new THREE.Group();
  const keyMeshes: THREE.Mesh[] = [];
  const keyLights = new Map<THREE.Mesh, THREE.PointLight>();
  const keyAudioHandles = new Map<THREE.Mesh, number>();
  parsed.keys.forEach(k => {
    const key = new THREE.Mesh(keyGeo, keyMat);
    key.castShadow = shadowsEnabled;
    key.position.set(
      k.x * TILE_SIZE + TILE_SIZE / 2,
      0.9,
      k.z * TILE_SIZE + TILE_SIZE / 2
    );
    keyGroup.add(key);
    if (quality !== "low") {
      // Each key beacon is a warm-tungsten practical. ~30% of them flicker so
      // the world doesn't read as static.
      const light = createPractical({
        position: key.position.clone(),
        color: 0xffd24a,
        intensity: 0.6,
        distance: 4,
      });
      keyGroup.add(light);
      keyLights.set(key, light);
      lightCuller.register(light);
      if (Math.random() < 0.3) {
        flickers.add(new LightFlicker(light, 0.6, 0.12, 7));
      }
    }
    keyMeshes.push(key);
  });
  scene.add(keyGroup);

  // Hiding closets — rendered as standing wardrobes with crown rail,
  // base plinth, and horizontal door-divider strips.
  {
    const bodyW = TILE_SIZE * 0.82;
    const bodyH = WALL_HEIGHT * 0.72;
    const bodyD = TILE_SIZE * 0.82;
    // Shared geometry pieces (created once, reused per hide instance)
    const wBodyGeo = new THREE.BoxGeometry(bodyW, bodyH, bodyD);
    const wCrownGeo = new THREE.BoxGeometry(bodyW + 0.12, 0.12, bodyD + 0.12);
    const wPlinthGeo = new THREE.BoxGeometry(bodyW + 0.12, 0.16, bodyD + 0.12);
    const wDivGeo = new THREE.BoxGeometry(bodyW + 0.04, 0.07, bodyD + 0.04);
    parsed.hides.forEach(h => {
      const cx = h.x * TILE_SIZE + TILE_SIZE / 2;
      const cz = h.z * TILE_SIZE + TILE_SIZE / 2;
      const ward = new THREE.Group();
      const body = new THREE.Mesh(wBodyGeo, wardrobeMat);
      body.position.y = 0.16 + bodyH * 0.5;
      body.castShadow = shadowsEnabled;
      body.receiveShadow = shadowsEnabled;
      ward.add(body);
      const crown = new THREE.Mesh(wCrownGeo, wardrobeMat);
      crown.position.y = 0.16 + bodyH + 0.06;
      crown.castShadow = false;
      crown.receiveShadow = shadowsEnabled;
      ward.add(crown);
      const plinth = new THREE.Mesh(wPlinthGeo, wardrobeMat);
      plinth.position.y = 0.08;
      plinth.castShadow = false;
      plinth.receiveShadow = shadowsEnabled;
      ward.add(plinth);
      // Two horizontal divider strips suggesting three-panel doors
      for (const divY of [0.16 + bodyH * 0.35, 0.16 + bodyH * 0.70]) {
        const div = new THREE.Mesh(wDivGeo, wardrobeMat);
        div.position.y = divY;
        div.castShadow = false;
        div.receiveShadow = shadowsEnabled;
        ward.add(div);
      }
      ward.position.set(cx, 0, cz);
      scene.add(ward);
    });
  }

  // ── Pickups: batteries (refill flashlight) and notes (lore pages) ─────────
  const batteryGroup = new THREE.Group();
  const batteryMeshes: THREE.Mesh[] = [];
  const batteryMat = new THREE.MeshStandardMaterial({
    color: 0x66ff88,
    emissive: 0x114422,
    emissiveIntensity: 0.7,
    metalness: 0.6,
    roughness: 0.35,
  });
  const batteryGeo = new THREE.CylinderGeometry(
    0.13,
    0.13,
    0.32,
    quality === "low" ? 8 : 16
  );
  parsed.batteries.forEach(b => {
    const m = new THREE.Mesh(batteryGeo, batteryMat);
    m.castShadow = shadowsEnabled;
    m.position.set(
      b.x * TILE_SIZE + TILE_SIZE / 2,
      0.7,
      b.z * TILE_SIZE + TILE_SIZE / 2
    );
    batteryGroup.add(m);
    batteryMeshes.push(m);
  });
  scene.add(batteryGroup);

  const noteGroup = new THREE.Group();
  const noteMeshes: THREE.Mesh[] = [];
  const noteMat = new THREE.MeshStandardMaterial({
    color: 0xf2e0b0,
    emissive: 0x4a3a18,
    emissiveIntensity: 0.5,
    roughness: 0.8,
    metalness: 0.0,
  });
  const noteGeo = new THREE.BoxGeometry(0.3, 0.02, 0.22);
  parsed.notes.forEach(n => {
    const m = new THREE.Mesh(noteGeo, noteMat);
    m.castShadow = shadowsEnabled;
    m.position.set(
      n.x * TILE_SIZE + TILE_SIZE / 2,
      0.85,
      n.z * TILE_SIZE + TILE_SIZE / 2
    );
    noteGroup.add(m);
    noteMeshes.push(m);
  });
  scene.add(noteGroup);

  const totalNotes = noteMeshes.length;
  let notesCollected = 0;

  // Prop dressing — theme-weighted prop selection over the full kind set.
  // One InstancedMesh per kind so total draw-call cost is O(kinds), not
  // O(props). Seed is deterministic per map for a stable look.
  const props = new PropSpawner(scene);
  const blocked = new Set<string>();
  for (const w of parsed.walls) blocked.add(`${w.x},${w.z}`);
  for (const d of parsed.doors) blocked.add(`${d.x},${d.z}`);
  for (const k of parsed.keys) blocked.add(`${k.x},${k.z}`);
  for (const h of parsed.hides) blocked.add(`${h.x},${h.z}`);
  for (const b of parsed.batteries) blocked.add(`${b.x},${b.z}`);
  for (const n of parsed.notes) blocked.add(`${n.x},${n.z}`);
  if (parsed.exit) blocked.add(`${parsed.exit.x},${parsed.exit.z}`);
  blocked.add(`${parsed.spawn.x},${parsed.spawn.z}`);

  const propRng = mulberry32((options.seed ?? 0x484e54) ^ 0x484e54);
  // Theme-weighted prop tables. Order matches kinds[] for cumulative draw.
  const PROP_KIND_ORDER: PropKind[] = [
    "chair",
    "table",
    "lamp",
    "shelf",
    "crate",
    "barrel",
    "bookstack",
    "painting",
    "rug",
    "bed",
    "sofa",
    "counter",
    "bathtub",
    "clutter",
  ];
  const PROP_WEIGHTS_BY_THEME: Record<string, number[]> = {
    // chair, table, lamp, shelf, crate, barrel, bookstack, painting, rug, bed, sofa, counter, bathtub, clutter
    kitchen: [
      0.16, 0.12, 0.08, 0.08, 0.03, 0.02, 0.07, 0.07, 0.06, 0.04, 0.05,
      0.12, 0.02, 0.08,
    ],
    house: [
      0.09, 0.08, 0.09, 0.08, 0.13, 0.12, 0.04, 0.06, 0.04, 0.04, 0.04,
      0.03, 0.02, 0.14,
    ],
    nightmare: [
      0.05, 0.04, 0.05, 0.04, 0.16, 0.18, 0.03, 0.03, 0.02, 0.02, 0.02,
      0.02, 0.01, 0.33,
    ],
  };
  const propWeights =
    PROP_WEIGHTS_BY_THEME[mapDef.theme] ?? PROP_WEIGHTS_BY_THEME.kitchen;
  // Floor-only kinds skip wall-adjacent rules; "painting" needs a wall.
  const wallAdjacent = (
    gx: number,
    gz: number
  ): { dx: number; dz: number } | null => {
    const dirs = [
      { dx: 1, dz: 0 },
      { dx: -1, dz: 0 },
      { dx: 0, dz: 1 },
      { dx: 0, dz: -1 },
    ];
    for (const d of dirs) {
      if (isBlocked(parsed, gx + d.dx, gz + d.dz)) return d;
    }
    return null;
  };
  // Per-room budget: we don't have proper room volumes yet, so cap globally.
  const PROP_DENSITY = 0.3; // bumped up to fill the larger Phase-2 maps
  const MAX_LAMP_LIGHTS = 12;
  let lampLightCount = 0;
  const placeSignatureProp = (
    kind: PropKind,
    gx: number,
    gz: number,
    rotY = 0,
    scale = 1
  ): void => {
    const key = `${gx},${gz}`;
    if (blocked.has(key) || isBlocked(parsed, gx, gz)) return;
    blocked.add(key);
    props.place(
      kind,
      new THREE.Vector3(
        gx * TILE_SIZE + TILE_SIZE / 2,
        0,
        gz * TILE_SIZE + TILE_SIZE / 2
      ),
      rotY,
      scale
    );
  };
  // The "easy" map key is the level-one Farmhouse in shared/maps.ts.
  if ((options.mapKey ?? "easy") === "easy") {
    const N = 0;
    const E = -Math.PI / 2;
    const S = Math.PI;
    const W = Math.PI / 2;

    // Hand-authored anchor pieces give each room a readable purpose; random
    // scatter still fills gaps after these reserved cells are placed.
    placeSignatureProp("bed", 4, 2, W, 1.15);
    placeSignatureProp("bathtub", 9, 2, N, 1.15);
    placeSignatureProp("shelf", 16, 2, S, 1.25);
    placeSignatureProp("bed", 22, 2, E, 1.05);

    placeSignatureProp("counter", 28, 2, S, 1.35);
    placeSignatureProp("counter", 31, 2, S, 1.35);
    placeSignatureProp("counter", 34, 2, S, 1.35);
    placeSignatureProp("table", 32, 7, 0, 1.3);
    placeSignatureProp("chair", 31, 7, E, 1.15);
    placeSignatureProp("chair", 33, 7, W, 1.15);

    placeSignatureProp("rug", 17, 12, 0, 1.45);
    placeSignatureProp("sofa", 16, 13, N, 1.25);
    placeSignatureProp("table", 18, 12, Math.PI / 2, 1.15);
    placeSignatureProp("lamp", 21, 14, 0, 1.1);

    placeSignatureProp("shelf", 8, 13, S, 1.2);
    placeSignatureProp("bed", 3, 17, E, 1.05);
    placeSignatureProp("counter", 32, 17, S, 1.2);
    placeSignatureProp("counter", 36, 17, S, 1.2);
    placeSignatureProp("sofa", 10, 21, S, 1.2);
  }
  for (let gz = 0; gz < parsed.height; gz++) {
    for (let gx = 0; gx < parsed.width; gx++) {
      if (blocked.has(`${gx},${gz}`)) continue;
      if (propRng() > PROP_DENSITY) continue;
      const r = propRng();
      let acc = 0;
      let picked: PropKind = "clutter";
      for (let i = 0; i < PROP_KIND_ORDER.length; i++) {
        acc += propWeights[i];
        if (r <= acc) {
          picked = PROP_KIND_ORDER[i];
          break;
        }
      }
      const adj = wallAdjacent(gx, gz);
      // Painting requires a wall to mount against; if none, fall back to clutter.
      if (picked === "painting" && !adj) picked = "clutter";
      const cx = gx * TILE_SIZE + TILE_SIZE / 2;
      const cz = gz * TILE_SIZE + TILE_SIZE / 2;
      const jitter = TILE_SIZE * 0.2;
      let px = cx + (propRng() - 0.5) * jitter;
      let pz = cz + (propRng() - 0.5) * jitter;
      let rotY = propRng() * Math.PI * 2;
      if (picked === "painting" && adj) {
        // Push painting flush against the wall and orient it inward.
        px = cx + adj.dx * (TILE_SIZE / 2 - 0.05);
        pz = cz + adj.dz * (TILE_SIZE / 2 - 0.05);
        rotY = Math.atan2(-adj.dx, -adj.dz);
      } else if (picked === "shelf" || picked === "bookstack") {
        // Push storage against a wall when one is adjacent.
        if (adj) {
          px = cx + adj.dx * (TILE_SIZE / 2 - 0.25);
          pz = cz + adj.dz * (TILE_SIZE / 2 - 0.25);
          rotY = Math.atan2(-adj.dx, -adj.dz);
        }
      }
      props.place(picked, new THREE.Vector3(px, 0, pz), rotY);
      // Cheap practical light on a small subset of lamps.
      if (
        picked === "lamp" &&
        quality !== "low" &&
        lampLightCount < MAX_LAMP_LIGHTS
      ) {
        const light = createPractical({
          position: new THREE.Vector3(px, 1.55, pz),
          color: 0xffb066,
          intensity: 0.55,
          distance: 5,
        });
        scene.add(light);
        lightCuller.register(light);
        if (propRng() < 0.35) {
          flickers.add(new LightFlicker(light, 0.55, 0.15, 6));
        }
        lampLightCount++;
      }
    }
  }
  props.commit();

  // Ceiling pendant fixtures — warm overhead lights that define room volumes
  // and create the lit-pools-vs-dark-corners contrast of a horror interior.
  const ceilRng = mulberry32((baseSeed ^ 0x43454c4c) >>> 0);
  const ceilingFixtures = buildCeilingFixtures(parsed, TILE_SIZE, quality, ceilRng);
  scene.add(ceilingFixtures.group);
  for (const l of ceilingFixtures.lights) {
    lightCuller.register(l);
  }
  for (const l of ceilingFixtures.flickerLights) {
    flickers.add(new LightFlicker(l, l.intensity, 0.10, 4 + ceilRng() * 4));
  }

  // Cobwebs in the upper corners of every wall tile that has a free
  // neighbor — gives an "in the corner of the room" feel without needing
  // proper room volumes (those land in Phase 6).
  const cobwebs = new CobwebSet(scene);
  // Drifting dust motes — single Points draw call, wraps around the camera
  // so the 200-particle population always reads as ambient air.
  // Tier-gated population: 200 desktop, 80 mid, 0 on low (full skip — the
  // CPU drift loop is cheap but the Points draw still blits transparency
  // and that's measurable on a phone iGPU).
  const dustCount =
    quality === "low"
      ? 0
      : quality === "mid"
        ? 80
        : quality === "high"
          ? 320
          : 200;
  const dust =
    dustCount > 0
      ? new DustParticles(scene, {
          count: dustCount,
          size: quality === "high" ? 0.05 : 0.04,
        })
      : null;
  const cobwebRng = mulberry32((options.seed ?? 0xc0bea73) ^ 0xc0bea73);
  // Cobweb planes are individual transparent meshes — each is a draw call
  // and they get sorted every frame. Gate density by tier.
  const cobwebRatio = quality === "low" ? 0 : quality === "mid" ? 0.06 : 0.15;
  for (const w of parsed.walls) {
    if (cobwebRng() > cobwebRatio) continue;
    const dirs: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    const [dx, dz] = dirs[Math.floor(cobwebRng() * dirs.length)];
    const nx = w.x + dx;
    const nz = w.z + dz;
    if (blocked.has(`${nx},${nz}`)) continue;
    const cx = w.x * TILE_SIZE + TILE_SIZE / 2 + dx * (TILE_SIZE / 2 + 0.02);
    const cz = w.z * TILE_SIZE + TILE_SIZE / 2 + dz * (TILE_SIZE / 2 + 0.02);
    cobwebs.add({
      position: new THREE.Vector3(cx, WALL_HEIGHT - 0.25, cz),
      outward: new THREE.Vector3(dx, 0, dz),
    });
  }

  // Exit
  if (parsed.exit) {
    const exitX = parsed.exit.x * TILE_SIZE + TILE_SIZE / 2;
    const exitZ = parsed.exit.z * TILE_SIZE + TILE_SIZE / 2;

    const exitMesh = new THREE.Mesh(doorGeo, exitMat);
    exitMesh.position.set(exitX, (WALL_HEIGHT * 0.92) / 2, exitZ);
    exitMesh.castShadow = false;
    exitMesh.receiveShadow = false;
    scene.add(exitMesh);

    const exitOuterRing = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.07, 12, 32), exitMat);
    exitOuterRing.position.set(exitX, 0.07, exitZ);
    exitOuterRing.rotation.x = -Math.PI / 2;
    exitOuterRing.castShadow = false;
    exitOuterRing.receiveShadow = false;
    scene.add(exitOuterRing);

    const exitInnerRing = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.045, 10, 24), exitMat);
    exitInnerRing.position.set(exitX, 0.05, exitZ);
    exitInnerRing.rotation.x = -Math.PI / 2;
    exitInnerRing.castShadow = false;
    exitInnerRing.receiveShadow = false;
    scene.add(exitInnerRing);

    const exitLeftPillar = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, WALL_HEIGHT, 0.12),
      exitMat
    );
    exitLeftPillar.position.set(exitX - TILE_SIZE * 0.51, WALL_HEIGHT / 2, exitZ);
    exitLeftPillar.castShadow = false;
    exitLeftPillar.receiveShadow = false;
    scene.add(exitLeftPillar);

    const exitRightPillar = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, WALL_HEIGHT, 0.12),
      exitMat
    );
    exitRightPillar.position.set(exitX + TILE_SIZE * 0.51, WALL_HEIGHT / 2, exitZ);
    exitRightPillar.castShadow = false;
    exitRightPillar.receiveShadow = false;
    scene.add(exitRightPillar);

    const exitLintel = new THREE.Mesh(
      new THREE.BoxGeometry(TILE_SIZE * 1.06, 0.14, 0.14),
      exitMat
    );
    exitLintel.position.set(exitX, WALL_HEIGHT - 0.07, exitZ);
    exitLintel.castShadow = false;
    exitLintel.receiveShadow = false;
    scene.add(exitLintel);

    if (quality !== "low") {
      const exitLight = new THREE.PointLight(0x44ff66, 2.0, 12, 2);
      exitLight.position.copy(exitMesh.position);
      scene.add(exitLight);
      lightCuller.register(exitLight);
    }
  }

  // ── Remote players & enemy ────────────────────────────────────────────────
  const remoteGroup = new THREE.Group();
  scene.add(remoteGroup);
  const remoteMeshes = new Map<string, THREE.Mesh>();

  function setRemotePlayers(players: RemotePlayer[]) {
    const seen = new Set<string>();
    for (const p of players) {
      seen.add(p.id);
      let mesh = remoteMeshes.get(p.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.4, 1.0, 6, 12),
          new THREE.MeshStandardMaterial({ color: 0x88aaee, roughness: 0.6 })
        );
        mesh.castShadow = shadowsEnabled;
        remoteGroup.add(mesh);
        remoteMeshes.set(p.id, mesh);
      }
      mesh.position.set(p.x, PLAYER_HEIGHT / 2 + 0.2, p.z);
      mesh.rotation.y = p.rotY;
    }
    remoteMeshes.forEach((mesh, id) => {
      if (!seen.has(id)) {
        remoteGroup.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        remoteMeshes.delete(id);
      }
    });
  }

  // ── Observer (AI enemy) ───────────────────────────────────────────────────
  // Replaces the old capsule + 2-eye construction. TheObserver owns its own
  // geometry, materials, and eye lights. Engine only calls .update() each
  // frame and .syncLights() after position changes.
  const observer = new TheObserver(shadowsEnabled);
  observer.visible = false;
  scene.add(observer.group);
  // Eye lights are parented inside the group; the scene also needs them for
  // shadow casting (they're added inside TheObserver's constructor via group).

  // Compatibility alias — remaining engine code that referenced enemyMesh now
  // uses observerProxy which proxies the same position/visible interface.
  const enemyMesh = {
    get position() {
      return observer.group.position;
    },
    get visible() {
      return observer.visible;
    },
    set visible(v: boolean) {
      observer.visible = v;
    },
    lookAt(x: number, y: number, z: number) {
      observer.lookAt(x, y, z);
    },
    castShadow: shadowsEnabled,
  };

  const enemyLight = new THREE.PointLight(
    0x1a2a3a,
    quality === "low" ? 0 : 0.5,
    8,
    2
  );
  enemyLight.visible = false;
  scene.add(enemyLight);

  // Catch sequence state
  let catchSequenceActive = false;
  let catchSequenceTimer = 0;

  // Catch flash overlay — pure DOM, no React state needed
  const catchOverlay = document.createElement("div");
  catchOverlay.style.cssText =
    "position:absolute;inset:0;background:#e8f4ff;opacity:0;pointer-events:none;z-index:50;";
  container.appendChild(catchOverlay);

  // Pathfinding state
  let enemyPath: Array<{ x: number; z: number }> | null = null;
  let pathRecomputeTimer = 0;
  let patrolIndex = 0;
  const patrolWaypoints = (mapDef.patrolWaypoints ?? []).map(wp => ({
    x: wp.x * TILE_SIZE + TILE_SIZE / 2,
    z: wp.z * TILE_SIZE + TILE_SIZE / 2,
  }));

  // last-known-position for investigate mode
  let lastKnownPlayerX = 0;
  let lastKnownPlayerZ = 0;
  let isInvestigating = false;
  // Tracks the prior "is the Observer in chase?" frame so we can fire the
  // lunge-telegraph exactly once on the investigating→chase transition.
  let wasChasingLastFrame = false;
  // Distraction state — set by throwable impact or door slam.
  let observerDistractedUntil = 0;
  let distractionX = 0;
  let distractionZ = 0;
  // Throwables: physics state for in-flight cans.
  const THROWABLE_INITIAL = 3;
  const THROWABLE_SPEED = 12;
  const THROWABLE_GRAVITY = 14;
  const THROWABLE_INVESTIGATE_MS = 6000;
  let throwablesRemaining = THROWABLE_INITIAL;
  type ThrowState = {
    mesh: THREE.Mesh;
    vx: number;
    vy: number;
    vz: number;
    bounced: boolean;
    expireAt: number;
  };
  const activeThrows: ThrowState[] = [];
  const throwGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.12, 8);
  const throwMat = new THREE.MeshStandardMaterial({
    color: 0xa0a0a0,
    metalness: 0.7,
    roughness: 0.3,
  });
  let lastRemoteEnemyAt = 0;
  let dangerState: "safe" | "near" | "critical" = "safe";
  let isHiding = false;
  let timeLeft = mapDef.timer;
  // Flashlight battery — drains while flashlight is on. Pickup batteries
  // (parsed.batteries) refill it. Drains slow enough that a full map needs
  // ~3 batteries to keep the cone bright; running out doesn't kill, just
  // dims the world toward unplayable.
  let batteryCharge = 1;
  // 100% → 0% over ~5 minutes of continuous "on" time.
  const BATTERY_FULL_DRAIN_SECONDS = 300;
  const BATTERY_DRAIN_PER_SEC = 1 / BATTERY_FULL_DRAIN_SECONDS;
  // Each picked-up battery restores 60% of full charge.
  const BATTERY_PICKUP_RESTORE = 0.6;
  // Trigger radius for non-key pickups (batteries, notes). Key pickups
  // keep their own inline radius for backward compatibility.
  const PICKUP_TRIGGER_RADIUS_SQ = 1.4 * 1.4;
  let lastBatteryReportPct = 100;
  let lastTimerSecond = Math.ceil(timeLeft);
  let isSprinting = false;
  let isMoving = false;
  let enemySpeedMultiplier = 1;
  let lastDirectorTickSecond = lastTimerSecond;
  const aiDirector = createAIDirector();
  let lastExitHintAt = 0;

  function setEnemy(pos: { x: number; z: number } | null) {
    if (!pos) {
      enemyMesh.visible = false;
      enemyLight.visible = false;
      return;
    }
    lastRemoteEnemyAt = performance.now();
    enemyMesh.visible = true;
    enemyLight.visible = quality !== "low";
    // TheObserver builds with its origin at the floor (legs 0..1m, torso
    // 1.4m, head 2.1m), so the group y MUST be 0 — anything higher floats
    // the entire model off the ground.
    enemyMesh.position.set(pos.x, 0, pos.z);
    enemyLight.position.set(pos.x, 1.6, pos.z);
  }

  // Smoothly tracked hide-vignette amount, lerped toward 0.20 when hiding so
  // the closet darken doesn't snap. Read by updateAnxietyEffects every frame.
  let hideVignetteCurrent = 0;

  function updateAnxietyEffects(
    intensity: number,
    elapsed: number,
    dt: number
  ) {
    const panic = THREE.MathUtils.clamp(intensity, 0, 1);
    const jitter = (Math.sin(elapsed * 41.3) + Math.sin(elapsed * 67.9)) * 0.5;
    // Lerp the hide-vignette toward its target so toggling E feels smooth.
    const targetHide = isHiding ? 0.2 : 0;
    hideVignetteCurrent +=
      (targetHide - hideVignetteCurrent) * Math.min(1, dt * 4);
    // Heartbeat-synced pulse: vignette breathes in/out at panic-scaled amplitude.
    const heartbeatPulse = Math.sin(elapsed * 4) * panic * 0.04;
    sharedUniforms.vignetteOffset.value =
      basePostFx.vignetteOffset -
      panic * 0.09 -
      heartbeatPulse +
      hideVignetteCurrent;
    sharedUniforms.noiseOpacity.value =
      basePostFx.noiseOpacity +
      panic * 0.12 +
      Math.max(0, jitter) * panic * 0.025;
    sharedUniforms.bloomIntensity.value =
      basePostFx.bloomIntensity +
      panic * 0.35 +
      Math.max(0, jitter) * panic * 0.1;
    flashlight.setAnxiety(panic, elapsed);
    enemyLight.intensity =
      quality === "low" ? 0 : 0.65 + panic * 1.45 + Math.max(0, jitter) * 0.25;
  }
  if (parsed.enemy) {
    setEnemy({
      x: parsed.enemy.x * TILE_SIZE + TILE_SIZE / 2,
      z: parsed.enemy.z * TILE_SIZE + TILE_SIZE / 2,
    });
  }
  if (!enemyMesh.visible) {
    setEnemy({
      x: Math.floor(parsed.width / 2) * TILE_SIZE + TILE_SIZE / 2,
      z: Math.floor(parsed.height / 2) * TILE_SIZE + TILE_SIZE / 2,
    });
    lastRemoteEnemyAt = 0;
  }
  const totalKeys = keyMeshes.length;
  events.onReady?.({
    keys: totalKeys,
    timer: mapDef.timer,
    mapName: mapDef.name,
    notesTotal: totalNotes,
    batteriesTotal: batteryMeshes.length,
  });
  events.onTimer?.(lastTimerSecond);
  events.onNotesChange?.(notesCollected, totalNotes);
  events.onBatteryChange?.(1);

  function emitDirector(event: Parameters<typeof aiDirector.trigger>[0]) {
    const enemyDistance = enemyMesh.visible
      ? Math.hypot(
          enemyMesh.position.x - camera.position.x,
          enemyMesh.position.z - camera.position.z
        )
      : null;
    const update = aiDirector.trigger(event, {
      mapName: mapDef.name,
      difficulty: mapDef.difficulty,
      keysRemaining: keyMeshes.length,
      totalKeys,
      timeLeft,
      maxTime: mapDef.timer,
      danger: dangerState,
      hidden: isHiding,
      sprinting: isSprinting,
      moving: isMoving,
      enemyDistance,
    });
    enemySpeedMultiplier = update.enemySpeedMultiplier;
    events.onAIDirector?.(update);
    if (update.hint) events.onHint?.(update.hint);
  }

  emitDirector("ready");

  // ── Input: pointer-lock first-person look + WASD ──────────────────────────
  let yaw = 0;
  let pitch = 0;
  // Look-smoothing targets — input handlers write to these, the per-frame
  // tick lerps actual yaw/pitch toward them. Eliminates judder on rate-
  // limited pointer event streams while keeping pointer-lock mouse instant
  // enough to feel responsive.
  let targetYaw = 0;
  let targetPitch = 0;
  const LOOK_LERP_RATE = 22;
  const PITCH_LIMIT = Math.PI / 2 - 0.05;
  function applyLookDelta(dx: number, dy: number, scale: number): void {
    targetYaw -= dx * scale;
    targetPitch -= dy * scale;
    targetPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, targetPitch));
  }
  let velocityX = 0;
  let velocityZ = 0;
  // Live-tunable so the pause menu can update it without restarting the engine.
  let sensitivity = options.sensitivity ?? 1;
  const virtualInput: VirtualInput = { moveX: 0, moveZ: 0, sprinting: false };
  const keys = new Set<string>();
  const onKeyDown = (e: KeyboardEvent) => {
    keys.add(e.code);
    if (e.code === "KeyE") {
      // While hiding, E must always exit the closet — never try a door slam,
      // since closets and doors are often within Manhattan-1 of each other
      // and a slam would lock the player in.
      if (isHiding || !tryDoorSlam()) toggleHide();
    } else if (e.code === "KeyF") {
      throwObject();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  const onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    // Pointer-lock mouse is a sub-millisecond per-pixel stream — applying
    // the 22 Hz lerp would convert that into ~45 ms of feel-lag and break
    // experienced FPS aim. Write the target *and* the live yaw/pitch so the
    // tick lerp is a no-op for the mouse path.
    targetYaw -= e.movementX * MOUSE_LOOK_SCALE * sensitivity;
    targetPitch -= e.movementY * MOUSE_LOOK_SCALE * sensitivity;
    targetPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, targetPitch));
    yaw = targetYaw;
    pitch = targetPitch;
  };
  document.addEventListener("mousemove", onMouseMove);

  let activeLookPointer: number | null = null;
  let lastLookX = 0;
  let lastLookY = 0;
  const captureCanvasPointer = renderer.domElement.setPointerCapture?.bind(
    renderer.domElement
  );
  const releaseCanvasPointer = renderer.domElement.releasePointerCapture?.bind(
    renderer.domElement
  );

  function bindKeySparkleAfterUnlock(): void {
    const keyHowl = audio.getHowl("key_sparkle");
    if (!keyHowl) return;
    for (const k of keyMeshes) {
      if (keyAudioHandles.has(k)) continue;
      const handle = audio.spatial.play(
        "key_sparkle",
        keyHowl,
        k.position.x,
        k.position.y,
        k.position.z,
      );
      keyAudioHandles.set(k, handle);
    }
  }

  const onCanvasPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
    // Don't claim the touch if it landed on a UI element overlaid on the
    // canvas — pause button, joystick, action buttons, etc. The DOM elements
    // opt in by setting data-ui-element (or being a button/anchor/input).
    const target = e.target as HTMLElement | null;
    if (
      target &&
      typeof target.closest === "function" &&
      target.closest("[data-ui-element], button, a, input")
    ) {
      return;
    }
    if (activeLookPointer !== null) return;
    audio.unlock();
    bindKeySparkleAfterUnlock();
    activeLookPointer = e.pointerId;
    lastLookX = e.clientX;
    lastLookY = e.clientY;
    captureCanvasPointer?.(e.pointerId);
    e.preventDefault();
  };

  const onCanvasPointerMove = (e: PointerEvent) => {
    if (activeLookPointer !== e.pointerId) return;
    applyLookDelta(
      e.clientX - lastLookX,
      e.clientY - lastLookY,
      MOBILE_LOOK_SCALE * sensitivity
    );
    lastLookX = e.clientX;
    lastLookY = e.clientY;
    e.preventDefault();
  };

  const onCanvasPointerEnd = (e: PointerEvent) => {
    if (activeLookPointer !== e.pointerId) return;
    activeLookPointer = null;
    releaseCanvasPointer?.(e.pointerId);
    e.preventDefault();
  };

  const onCanvasClick = () => {
    // Doubles as the iOS / autoplay-policy gesture for unlocking the
    // audio context. Idempotent.
    audio.unlock();
    bindKeySparkleAfterUnlock();
    if (document.pointerLockElement !== renderer.domElement) {
      renderer.domElement.requestPointerLock?.();
    }
  };
  renderer.domElement.style.touchAction = "none";
  renderer.domElement.style.userSelect = "none";
  renderer.domElement.addEventListener("pointerdown", onCanvasPointerDown);
  renderer.domElement.addEventListener("pointermove", onCanvasPointerMove);
  renderer.domElement.addEventListener("pointerup", onCanvasPointerEnd);
  renderer.domElement.addEventListener("pointercancel", onCanvasPointerEnd);
  renderer.domElement.addEventListener("click", onCanvasClick);

  function nearestHideDistanceSq() {
    let best = Infinity;
    for (const h of parsed.hides) {
      const hx = h.x * TILE_SIZE + TILE_SIZE / 2;
      const hz = h.z * TILE_SIZE + TILE_SIZE / 2;
      const dx = hx - camera.position.x;
      const dz = hz - camera.position.z;
      best = Math.min(best, dx * dx + dz * dz);
    }
    return best;
  }

  function toggleHide() {
    if (
      nearestHideDistanceSq() >
      HIDE_INTERACTION_DISTANCE * HIDE_INTERACTION_DISTANCE
    ) {
      events.onHint?.("Find a closet, then press E to hide.");
      return;
    }
    isHiding = !isHiding;
    if (isHiding) {
      velocityX = 0;
      velocityZ = 0;
    }
    // Vignette darkens edges when hiding so the player feels concealed.
    // Smooth lerp lives in the main loop — see hideVignetteCurrent.
    // Camera height is owned by CameraRig.update() each frame — it smooths
    // the crouch lerp so we don't snap.
    events.onHideChange?.(isHiding);
    events.onHint?.(
      isHiding
        ? "Hidden · press E to leave the closet"
        : "Out of hiding · keep moving"
    );
    emitDirector("hideChange");
  }

  function throwObject(): void {
    if (throwablesRemaining <= 0) return;
    throwablesRemaining--;
    events.onThrowableCount?.(throwablesRemaining);

    const mesh = new THREE.Mesh(throwGeo, throwMat);
    mesh.position.copy(camera.position);
    mesh.castShadow = shadowsEnabled;
    scene.add(mesh);

    // Camera-forward in the engine's coord convention (negative-Z forward).
    const cosP = Math.cos(pitch);
    const fx = -Math.sin(yaw) * cosP;
    const fy = Math.sin(pitch);
    const fz = -Math.cos(yaw) * cosP;

    activeThrows.push({
      mesh,
      vx: fx * THROWABLE_SPEED,
      vy: fy * THROWABLE_SPEED + 2.5,
      vz: fz * THROWABLE_SPEED,
      bounced: false,
      expireAt: 0,
    });
    audio.unlock();
  }

  function tryDoorSlam(): boolean {
    const px = Math.floor(camera.position.x / TILE_SIZE);
    const pz = Math.floor(camera.position.z / TILE_SIZE);
    const now = performance.now();
    for (const door of doorStates) {
      if (door.closedUntil > now) continue;
      const md = Math.abs(door.tileX - px) + Math.abs(door.tileZ - pz);
      if (md > 1) continue;
      door.closedUntil = now + 3000;
      door.targetRot = 0;
      door.currentRot = 0;
      door.group.rotation.y = 0;
      audio.triggerDoorSlam();
      // Slam = noise = Observer hears.
      observerDistractedUntil = now + 2500;
      distractionX = door.centerX;
      distractionZ = door.centerZ;
      events.onHint?.("Door slammed — buys you a few seconds.");
      return true;
    }
    return false;
  }

  function buildClosedTiles(): Set<string> {
    const now = performance.now();
    const set = new Set<string>();
    for (const door of doorStates) {
      if (door.closedUntil > now) set.add(`${door.tileX},${door.tileZ}`);
    }
    return set;
  }

  function setVirtualInput(input: Partial<VirtualInput>) {
    if (typeof input.moveX === "number") {
      virtualInput.moveX = Math.max(-1, Math.min(1, input.moveX));
    }
    if (typeof input.moveZ === "number") {
      virtualInput.moveZ = Math.max(-1, Math.min(1, input.moveZ));
    }
    if (typeof input.sprinting === "boolean") {
      virtualInput.sprinting = input.sprinting;
    }
  }

  function canOccupy(x: number, z: number, radius: number, ignoreDoors = false) {
    const samples: Array<[number, number]> = [
      [x - radius, z - radius],
      [x + radius, z - radius],
      [x - radius, z + radius],
      [x + radius, z + radius],
      [x, z],
    ];
    return samples.every(([sx, sz]) => {
      const gx = Math.floor(sx / TILE_SIZE);
      const gz = Math.floor(sz / TILE_SIZE);
      const closedDoor =
        !ignoreDoors &&
        doorStates.some(
          door =>
            door.tileX === gx &&
            door.tileZ === gz &&
            door.currentRot < DOOR_PASSABLE_ROT
        );
      return !isBlocked(parsed, gx, gz) && !closedDoor;
    });
  }

  // Collision: prevents clipping through wall barriers while still allowing
  // slide-along-wall movement and intentionally open doorways.
  function tryMove(dx: number, dz: number, radius = PLAYER_RADIUS) {
    const nx = camera.position.x + dx;
    const nz = camera.position.z + dz;
    if (canOccupy(nx, camera.position.z, radius)) camera.position.x = nx;
    if (canOccupy(camera.position.x, nz, radius)) camera.position.z = nz;
  }

  function tryMoveEnemy(dx: number, dz: number) {
    const nx = enemyMesh.position.x + dx;
    const nz = enemyMesh.position.z + dz;
    if (canOccupy(nx, enemyMesh.position.z, ENEMY_RADIUS, true))
      enemyMesh.position.x = nx;
    if (canOccupy(enemyMesh.position.x, nz, ENEMY_RADIUS, true))
      enemyMesh.position.z = nz;
    enemyLight.position.set(enemyMesh.position.x, 1.6, enemyMesh.position.z);
  }

  function updateLocalEnemy(dt: number, elapsed: number, now: number) {
    if (!enemyMesh.visible || now - lastRemoteEnemyAt < REMOTE_ENEMY_TIMEOUT_MS)
      return;

    // Don't move enemy during catch sequence — it's already "there"
    if (catchSequenceActive) {
      observer.update(dt, elapsed, 0);
      observer.syncLights();
      return;
    }

    // Track last known player position (update only when not hiding/distracted)
    const distracted = now < observerDistractedUntil;
    if (!isHiding && !distracted) {
      lastKnownPlayerX = camera.position.x;
      lastKnownPlayerZ = camera.position.z;
      isInvestigating = false;
    }

    // Lunge telegraph — fire exactly when chase begins so the player gets a
    // clear "you've been seen" beat before the Observer accelerates.
    const chasingNow = !isInvestigating && !isHiding;
    if (chasingNow && !wasChasingLastFrame) {
      observer.triggerLungeTelegraph();
    }
    wasChasingLastFrame = chasingNow;

    // Periodic A* recompute
    pathRecomputeTimer -= dt;
    if (pathRecomputeTimer <= 0 || !enemyPath) {
      pathRecomputeTimer = PATH_RECOMPUTE_INTERVAL;

      let targetX: number;
      let targetZ: number;
      if (distracted) {
        targetX = distractionX;
        targetZ = distractionZ;
        isInvestigating = true;
      } else if (isHiding) {
        targetX = lastKnownPlayerX;
        targetZ = lastKnownPlayerZ;
      } else {
        targetX = camera.position.x;
        targetZ = camera.position.z;
      }

      const closed = buildClosedTiles();
      const newPath = findPath(
        parsed,
        enemyMesh.position.x,
        enemyMesh.position.z,
        targetX,
        targetZ,
        closed
      );
      if (newPath !== null) {
        enemyPath = newPath;
      }
      // If hiding and reached last-known-pos, patrol named waypoints (or wander as fallback).
      if (isHiding && !distracted && (!enemyPath || enemyPath.length === 0)) {
        isInvestigating = true;
        if (patrolWaypoints.length > 0) {
          const wp = patrolWaypoints[patrolIndex % patrolWaypoints.length];
          const dist = Math.hypot(
            wp.x - enemyMesh.position.x,
            wp.z - enemyMesh.position.z
          );
          if (dist < 1.0)
            patrolIndex = (patrolIndex + 1) % patrolWaypoints.length;
          lastKnownPlayerX = wp.x;
          lastKnownPlayerZ = wp.z;
          enemyPath =
            findPath(
              parsed,
              enemyMesh.position.x,
              enemyMesh.position.z,
              wp.x,
              wp.z,
              closed
            ) ?? [];
        } else {
          const wander = {
            x: lastKnownPlayerX + (Math.random() - 0.5) * 12,
            z: lastKnownPlayerZ + (Math.random() - 0.5) * 12,
          };
          enemyPath =
            findPath(
              parsed,
              enemyMesh.position.x,
              enemyMesh.position.z,
              wander.x,
              wander.z,
              closed
            ) ?? [];
        }
      }
    }

    // Follow path
    const baseSpeed = mapDef.claudeSpeed * enemySpeedMultiplier;
    const speedMult = isInvestigating ? INVESTIGATING_SPEED_FACTOR : 1.0;
    const speed = baseSpeed * speedMult * dt;

    if (enemyPath && enemyPath.length > 0) {
      const wp = enemyPath[0];
      const dx = wp.x - enemyMesh.position.x;
      const dz = wp.z - enemyMesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.5) {
        enemyPath.shift();
      } else {
        tryMoveEnemy((dx / dist) * speed, (dz / dist) * speed);
        enemyMesh.lookAt(
          camera.position.x,
          enemyMesh.position.y,
          camera.position.z
        );
      }
    } else {
      // Fallback direct move (no valid path found — shouldn't happen on well-formed maps).
      // While hiding, never aim at the live player position — drift toward the
      // last-known location so a failed pathfind doesn't betray hiding intent.
      const fx = isHiding ? lastKnownPlayerX : camera.position.x;
      const fz = isHiding ? lastKnownPlayerZ : camera.position.z;
      const dx = fx - enemyMesh.position.x;
      const dz = fz - enemyMesh.position.z;
      const dist = Math.hypot(dx, dz) || 1;
      tryMoveEnemy((dx / dist) * speed, (dz / dist) * speed);
      enemyMesh.lookAt(fx, enemyMesh.position.y, fz);
    }

    // Enemy light proximity (audio is driven from the main tick now via
    // updateObserverPosition + tickOcclusion + setHeartbeatProximity).
    const distToPlayer = Math.hypot(
      enemyMesh.position.x - camera.position.x,
      enemyMesh.position.z - camera.position.z
    );
    const proximity = Math.max(0, 1 - distToPlayer / 14);

    enemyLight.position.set(enemyMesh.position.x, 1.6, enemyMesh.position.z);
    enemyLight.visible = quality !== "low" && enemyMesh.visible;
    enemyLight.intensity = 0.3 + proximity * 0.5;

    const distForAnim = distToPlayer;
    observer.update(dt, elapsed, distForAnim, camera.position);
    observer.syncLights();
  }

  function checkPickups() {
    for (let i = keyMeshes.length - 1; i >= 0; i--) {
      const k = keyMeshes[i];
      const dx = k.position.x - camera.position.x;
      const dz = k.position.z - camera.position.z;
      if (dx * dx + dz * dz < 1.4 * 1.4) {
        keyGroup.remove(k);
        const light = keyLights.get(k);
        if (light) {
          keyGroup.remove(light);
          keyLights.delete(k);
        }
        const sparkleHandle = keyAudioHandles.get(k);
        if (sparkleHandle !== undefined) {
          audio.spatial.stop(sparkleHandle);
          keyAudioHandles.delete(k);
        }
        // Spatial static burst from the key's location, plus the 2D
        // pickup sting for the "got it" feedback.
        audio.playAt("static_burst", k.position.x, k.position.y, k.position.z);
        audio.triggerKeyPickup();
        // Particle burst — gold sparks + expanding ring at the key's
        // position; the engine ticks/dispose this from the main loop.
        activeBursts.push(
          new PickupBurst(scene, k.position.x, k.position.y, k.position.z),
        );
        keyMeshes.splice(i, 1);
        events.onKeyPickup?.(keyMeshes.length);
        Haptics.pickup();
        emitDirector("keyPickup");
      }
    }
    // Battery pickups — refill flashlight charge.
    for (let i = batteryMeshes.length - 1; i >= 0; i--) {
      const b = batteryMeshes[i];
      const dx = b.position.x - camera.position.x;
      const dz = b.position.z - camera.position.z;
      if (dx * dx + dz * dz < PICKUP_TRIGGER_RADIUS_SQ) {
        batteryGroup.remove(b);
        batteryMeshes.splice(i, 1);
        batteryCharge = Math.min(1, batteryCharge + BATTERY_PICKUP_RESTORE);
        flashlight.setBattery(batteryCharge);
        events.onBatteryChange?.(batteryCharge);
        events.onHint?.("Battery picked up. Flashlight restored.");
        Haptics.pickup();
      }
    }
    // Note pickups — increment counter, hint progress.
    for (let i = noteMeshes.length - 1; i >= 0; i--) {
      const n = noteMeshes[i];
      const dx = n.position.x - camera.position.x;
      const dz = n.position.z - camera.position.z;
      if (dx * dx + dz * dz < PICKUP_TRIGGER_RADIUS_SQ) {
        noteGroup.remove(n);
        noteMeshes.splice(i, 1);
        notesCollected++;
        events.onNotesChange?.(notesCollected, totalNotes);
        events.onHint?.(
          notesCollected === totalNotes
            ? "All notes collected."
            : `Note ${notesCollected}/${totalNotes}.`
        );
        Haptics.pickup();
      }
    }
    if (parsed.exit) {
      const ex = parsed.exit.x * TILE_SIZE + TILE_SIZE / 2;
      const ez = parsed.exit.z * TILE_SIZE + TILE_SIZE / 2;
      const dx = ex - camera.position.x;
      const dz = ez - camera.position.z;
      const exitDistSq = dx * dx + dz * dz;
      if (keyMeshes.length === 0) {
        if (exitDistSq < 2 * 2) events.onEscape?.();
      } else if (exitDistSq < 2.2 * 2.2) {
        const now = performance.now();
        if (now - lastExitHintAt > 1800) {
          lastExitHintAt = now;
          events.onHint?.(`${keyMeshes.length} key(s) still missing.`);
        }
      }
    }
    if (enemyMesh.visible && !catchSequenceActive) {
      const dx = enemyMesh.position.x - camera.position.x;
      const dz = enemyMesh.position.z - camera.position.z;
      const distSq = dx * dx + dz * dz;
      const nextDanger =
        distSq < 4 * 4 ? "critical" : distSq < 9 * 9 ? "near" : "safe";
      if (nextDanger !== dangerState) {
        if (nextDanger !== "safe") {
          Haptics.pulse();
        }
        if (nextDanger === "critical" && dangerState !== "critical") {
          cameraRig.pulseDamage(0.2);
          events.onHint?.("The Observer has found you.");
        } else if (nextDanger === "near" && dangerState === "safe") {
          events.onHint?.("Something is close. Do not run.");
        }
        dangerState = nextDanger;
        events.onDangerChange?.(dangerState);
        emitDirector("dangerChange");
      }
      // Catch sequence — freeze input, flash screen, delay onCaught
      if (!isHiding && distSq < CATCH_DIST * CATCH_DIST) {
        catchSequenceActive = true;
        catchSequenceTimer = CATCH_SEQUENCE_DURATION;
        audio.triggerJumpScare();
        Haptics.catch();
        // Flash white then fade
        catchOverlay.style.opacity = "1";
        // "Phasing out" audio bend: drop heartbeat + ambient rate so the
        // mix audibly drags during the cinematic. Reset on completion.
        const hbHowl = audio.getHowl("heartbeat_loop");
        if (hbHowl) {
          try { hbHowl.rate(0.6); } catch { /* ignore */ }
        }
        const ambHowl = audio.getHowl("ambient_loop");
        if (ambHowl) {
          try { ambHowl.rate(0.5); } catch { /* ignore */ }
        }
      }
    }
  }

  // ── Loop ──────────────────────────────────────────────────────────────────
  const clock = new THREE.Clock();
  const perf = createPerfMonitor(perfFlag);
  let raf = 0;
  let disposed = false;

  // ── Scene canary ──────────────────────────────────────────────────────────
  // Reads the center pixel ~1Hz. If we get five consecutive near-black
  // samples (5 seconds of darkness), inject an emergency AmbientLight and
  // force the flashlight on. Defends against future lighting regressions
  // making the game permanently unplayable.
  let blackFrameCount = 0;
  let nextCanaryAt = 0;
  let emergencyAmbientInjected = false;
  const CANARY_PIXEL_BUFFER = new Uint8Array(4);

  function checkSceneCanary(now: number): void {
    if (now < nextCanaryAt) return;
    nextCanaryAt = now + 1000;
    if (emergencyAmbientInjected) return;
    try {
      const gl = renderer.getContext();
      const w = renderer.domElement.width;
      const h = renderer.domElement.height;
      gl.readPixels(
        Math.floor(w / 2),
        Math.floor(h / 2),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        CANARY_PIXEL_BUFFER
      );
    } catch {
      // readPixels can throw mid-context-loss; treat as "skip this sample".
      return;
    }
    const r = CANARY_PIXEL_BUFFER[0];
    const g = CANARY_PIXEL_BUFFER[1];
    const b = CANARY_PIXEL_BUFFER[2];
    const luminance = r * 0.299 + g * 0.587 + b * 0.114;

    if (luminance < 4) {
      blackFrameCount++;
      if (blackFrameCount >= 5) {
        // 5 consecutive near-black samples — this is broken, bail us out.
        // eslint-disable-next-line no-console
        console.error(
          "[CANARY] Scene rendering near-black for 5s. Injecting emergency ambient."
        );
        const emergency = new THREE.AmbientLight(0xffffff, 0.4);
        emergency.name = "emergency_ambient";
        scene.add(emergency);
        flashlight.light.visible = true;
        flashlight.light.intensity = Math.max(flashlight.light.intensity, 1.5);
        emergencyAmbientInjected = true;
      }
    } else {
      blackFrameCount = 0;
    }
  }

  function tick() {
    if (disposed) return;
    try {
      perf.begin();
      adaptiveQuality.tick();
      const nowMs = performance.now();
      lightCuller.update(camera.position.x, camera.position.z, nowMs);
      if (LIGHT_DEBUG) {
        dumpLightingState(scene, camera, renderer);
      }
      if (nowMs - lastPropCullAt > 500) {
        lastPropCullAt = nowMs;
        props.cullByDistance(camera.position.x, camera.position.z);
      }
      const dt = Math.min(clock.getDelta(), 0.05);

      // ── Catch sequence ──────────────────────────────────────────────────
      if (catchSequenceActive) {
        catchSequenceTimer -= dt;
        const flashProgress = Math.max(
          0,
          catchSequenceTimer / CATCH_SEQUENCE_DURATION
        );
        const inverseProgress = 1 - flashProgress;

        // Lurch the camera toward the Observer so it feels like being pulled in.
        const dxCatch = enemyMesh.position.x - camera.position.x;
        const dzCatch = enemyMesh.position.z - camera.position.z;
        const lurchT = Math.min(1, inverseProgress * 1.5);
        camera.position.x += dxCatch * 0.04 * lurchT;
        camera.position.z += dzCatch * 0.04 * lurchT;

        // Force-look at the Observer's face — head height ≈ 1.6 above origin.
        camera.lookAt(
          enemyMesh.position.x,
          enemyMesh.position.y + 1.4,
          enemyMesh.position.z
        );

        // Camera shake intensifies as the sequence completes.
        const shake = inverseProgress * 0.05;
        camera.rotation.x += (Math.random() - 0.5) * shake;
        camera.rotation.y += (Math.random() - 0.5) * shake;

        // Flash overlay decay
        catchOverlay.style.opacity = String(flashProgress.toFixed(3));

        // PostFX spike — bloom, noise, and CA all push hard.
        sharedUniforms.bloomIntensity.value =
          basePostFx.bloomIntensity + flashProgress * 4.0;
        sharedUniforms.noiseOpacity.value =
          basePostFx.noiseOpacity + flashProgress * 1.2;
        sharedUniforms.chromaticAberrationStrength.value =
          flashProgress * 0.012;

        // Fade to black across the LAST 30% of the sequence. flashProgress
        // counts down from 1 to 0; we want fade rising as flashProgress
        // approaches 0 — i.e. once flashProgress < 0.3.
        const fade = flashProgress > 0.3 ? 0 : (0.3 - flashProgress) / 0.3;
        events.onCatchFade?.(fade);

        if (catchSequenceTimer <= 0) {
          catchSequenceActive = false;
          catchOverlay.style.opacity = "0";
          sharedUniforms.chromaticAberrationStrength.value = 0;
          // Reset audio rates so they're not 0.6/0.5 forever after.
          const hbHowl = audio.getHowl("heartbeat_loop");
          if (hbHowl) {
            try { hbHowl.rate(1.0); } catch { /* ignore */ }
          }
          const ambHowl = audio.getHowl("ambient_loop");
          if (ambHowl) {
            try { ambHowl.rate(1.0); } catch { /* ignore */ }
          }
          events.onCatchFade?.(1); // hold full black through onCaught hand-off
          events.onCaught?.();
          return;
        }
        // Render only — skip input/movement during catch
        if (!isContextLost()) {
          if (postfx) postfx.render(dt);
          else renderer.render(scene, camera);
        }
        raf = requestAnimationFrame(tick);
        return;
      }

      // Lerp toward the target yaw/pitch each frame. Frame-rate-independent
      // via 1 - exp(-k·dt). On a fast desktop this is effectively instant
      // (k=22 → 99% in ~210ms); on rate-limited mobile pointer streams it
      // smooths out the staircase.
      const lookK = 1 - Math.exp(-LOOK_LERP_RATE * dt);
      yaw += (targetYaw - yaw) * lookK;
      pitch += (targetPitch - pitch) * lookK;
      camera.rotation.order = "YXZ";
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;

      timeLeft = Math.max(0, timeLeft - dt);
      const timerSecond = Math.ceil(timeLeft);
      if (timerSecond !== lastTimerSecond) {
        lastTimerSecond = timerSecond;
        events.onTimer?.(timerSecond);
        if (timerSecond === 30) {
          lastDirectorTickSecond = timerSecond;
          events.onHint?.("Thirty seconds left. Reach the exit.");
          emitDirector("timerWarning");
        } else if (lastDirectorTickSecond - timerSecond >= 5) {
          lastDirectorTickSecond = timerSecond;
          emitDirector("tick");
        }
      }
      if (timeLeft <= 0) {
        events.onTimeUp?.();
        return;
      }

      const sprinting = keys.has("ShiftLeft") || virtualInput.sprinting;
      isSprinting = sprinting;
      let fx = 0;
      let fz = 0;
      if (keys.has("KeyW") || keys.has("ArrowUp")) fz -= 1;
      if (keys.has("KeyS") || keys.has("ArrowDown")) fz += 1;
      if (keys.has("KeyA") || keys.has("ArrowLeft")) fx -= 1;
      if (keys.has("KeyD") || keys.has("ArrowRight")) fx += 1;
      fx += virtualInput.moveX;
      fz += virtualInput.moveZ;
      let moveMagnitude = 0;
      if (fx !== 0 || fz !== 0) {
        const rawLen = Math.hypot(fx, fz);
        const inputMagnitude = Math.min(1, rawLen);
        fx /= rawLen;
        fz /= rawLen;
        moveMagnitude = sprinting ? inputMagnitude : 0.6 * inputMagnitude;
        const sin = Math.sin(yaw);
        const cos = Math.cos(yaw);
        const speed = calculateMoveSpeed(isHiding, sprinting, inputMagnitude);
        const targetVx = (fx * cos + fz * sin) * speed;
        const targetVz = (-fx * sin + fz * cos) * speed;
        const maxDelta = MOVE_ACCELERATION * dt;
        velocityX += Math.max(
          -maxDelta,
          Math.min(maxDelta, targetVx - velocityX)
        );
        velocityZ += Math.max(
          -maxDelta,
          Math.min(maxDelta, targetVz - velocityZ)
        );
      } else {
        const maxDelta = MOVE_DECELERATION * dt;
        const speed = Math.hypot(velocityX, velocityZ);
        if (speed <= maxDelta) {
          velocityX = 0;
          velocityZ = 0;
        } else {
          const scale = (speed - maxDelta) / speed;
          velocityX *= scale;
          velocityZ *= scale;
        }
      }
      if (velocityX !== 0 || velocityZ !== 0) {
        tryMove(velocityX * dt, velocityZ * dt);
      }

      isMoving = moveMagnitude > 0;

      // Chromatic aberration target: rises with Observer proximity (most of the
      // signal) and a small constant while sprinting. Catch sequence overrides
      // this from inside its own block.
      const caProx = enemyMesh.visible
        ? Math.max(
            0,
            1 -
              Math.hypot(
                enemyMesh.position.x - camera.position.x,
                enemyMesh.position.z - camera.position.z
              ) /
                14
          )
        : 0;
      const caSprint = sprinting && isMoving ? 0.0015 : 0;
      sharedUniforms.chromaticAberrationStrength.value = Math.min(
        0.006,
        caSprint + caProx * 0.004
      );

      const t = clock.elapsedTime;
      const tickNow = performance.now();
      updateLocalEnemy(dt, t, tickNow);

      // ── Throwable physics ─────────────────────────────────────────────
      for (let i = activeThrows.length - 1; i >= 0; i--) {
        const tw = activeThrows[i];
        // Despawn cans that have been on the floor for 2s.
        if (tw.expireAt && tickNow >= tw.expireAt) {
          // Don't dispose throwGeo here — it's shared across all cans.
          // Released once in dispose() below.
          scene.remove(tw.mesh);
          activeThrows.splice(i, 1);
          continue;
        }
        if (tw.bounced) continue;
        tw.vy -= THROWABLE_GRAVITY * dt;
        tw.mesh.position.x += tw.vx * dt;
        tw.mesh.position.y += tw.vy * dt;
        tw.mesh.position.z += tw.vz * dt;
        tw.mesh.rotation.x += dt * 8;
        tw.mesh.rotation.z += dt * 6;
        if (tw.mesh.position.y < 0.06) {
          tw.mesh.position.y = 0.06;
          tw.bounced = true;
          tw.expireAt = tickNow + 2000;
          distractionX = tw.mesh.position.x;
          distractionZ = tw.mesh.position.z;
          observerDistractedUntil = tickNow + THROWABLE_INVESTIGATE_MS;
          audio.triggerThrowableImpact();
        }
      }

      // ── Door reopen ───────────────────────────────────────────────────
      for (const door of doorStates) {
        if (door.closedUntil && tickNow >= door.closedUntil) {
          door.closedUntil = 0;
        }
      }

      for (const k of keyMeshes) {
        k.rotation.y += dt * 2;
        k.position.y = 0.9 + Math.sin(t * 2 + k.position.x) * 0.08;
      }
      // Hovering & rotating pickups for batteries / notes — same vibe as keys.
      for (const b of batteryMeshes) {
        b.rotation.y += dt * 1.6;
        b.position.y = 0.7 + Math.sin(t * 2.5 + b.position.x) * 0.06;
      }
      for (const n of noteMeshes) {
        n.rotation.y += dt * 1.2;
        n.position.y = 0.85 + Math.sin(t * 2.2 + n.position.z) * 0.05;
      }

      // Flashlight battery drain — only while the flashlight is on.
      if (flashlight.isOn() && batteryCharge > 0) {
        batteryCharge = Math.max(0, batteryCharge - BATTERY_DRAIN_PER_SEC * dt);
        flashlight.setBattery(batteryCharge);
        const pct = Math.round(batteryCharge * 100);
        // Throttle event emission to 1% changes so React state churn is minimal.
        if (pct !== lastBatteryReportPct) {
          lastBatteryReportPct = pct;
          events.onBatteryChange?.(batteryCharge);
          if (pct === 25 || pct === 10) {
            events.onHint?.(`Flashlight battery at ${pct}%.`);
          } else if (pct === 0) {
            events.onHint?.("Flashlight is dead. Find a battery.");
          }
        }
      }

      flickers.update(dt);
      shadowBudget.update(camera);
      cameraRig.update(dt, { moveMagnitude, sprinting, crouched: isHiding }, t);
      heartbeat.update(
        dt,
        camera,
        enemyMesh.visible ? enemyMesh.position : null
      );
      updateAnxietyEffects(heartbeat.intensity(), t, dt);

      // Spatial-audio wiring. Listener tracks the camera; Observer voice
      // (breath / stalk / footsteps / moans) follows enemyMesh; occlusion
      // ticks at ~8Hz and lerps the per-source volume; heartbeat is
      // distance-driven (not state-driven). Ambient mixer breathes the
      // wind layer + holds the static drone constant.
      audio.setListener(
        camera.position.x,
        camera.position.y,
        camera.position.z,
        yaw,
      );
      const enemyDx = enemyMesh.position.x - camera.position.x;
      const enemyDz = enemyMesh.position.z - camera.position.z;
      const enemyDist = Math.hypot(enemyDx, enemyDz);
      const observerChasing = enemyMesh.visible && enemyDist < 9;
      audio.updateObserverPosition(
        enemyMesh.position.x,
        enemyMesh.position.y,
        enemyMesh.position.z,
        observerChasing,
      );
      audio.tickSpatial(dt);
      audio.tickOcclusion(camera.position.x, camera.position.z, performance.now());
      audio.setHeartbeatProximity(enemyMesh.visible ? enemyDist : 999);
      audio.tickAmbient(dt);
      audio.update(dt);
      tickDoorSwings(dt);
      // Tick active pickup bursts. update() returns true when a burst is
      // done; we splice from the back so indices stay valid mid-loop.
      for (let i = activeBursts.length - 1; i >= 0; i--) {
        if (activeBursts[i].update(dt)) {
          activeBursts[i].dispose(scene);
          activeBursts.splice(i, 1);
        }
      }
      footstepDust.update(dt);
      dust?.update(dt, camera);
      // Footsteps — player + enemy. Both fire on actual horizontal movement
      // distance, with surface variants picked from the tile char under each
      // foot. Enemy steps spatialize from the Observer's position.
      footstepSystem.tick(
        camera.position.x,
        camera.position.z,
        sprinting,
        isHiding,
      );
      if (enemyMesh.visible) {
        enemyFootstepSystem.tick(
          enemyMesh.position.x,
          enemyMesh.position.z,
          observerChasing,
          false,
        );
      }
      checkPickups();
      if (!isContextLost()) {
        if (batterySaver) {
          frameSkip++;
          if (frameSkip < FRAME_SKIP_TARGET) {
            raf = requestAnimationFrame(tick);
            return;
          }
          frameSkip = 0;
        }
        if (postfx) postfx.render(dt);
        else renderer.render(scene, camera);
      }
      checkSceneCanary(performance.now());
      perf.end(renderer);
    } catch (err) {
      // A throw inside the RAF callback would otherwise repeat every frame
      // (the next frame is already queued), spamming the console and
      // appearing to "crash" the page. Stop the loop and surface the error.
      disposed = true;
      cancelAnimationFrame(raf);
      const error = err instanceof Error ? err : new Error(String(err));
      console.error("[engine] render loop crashed:", error);
      events.onError?.(error);
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // Kick off PostFX async init. Until it resolves the loop renders directly
  // through the renderer (graceful degradation handled in PostFX itself).
  void createPostFX(renderer, scene, camera, {
    uniforms: sharedUniforms,
    quality: options.quality,
    // LUT asset lands in Phase 4 alongside texture pipeline; skip until
    // present so we don't fetch a 404 every page load.
    lutUrl: undefined,
  })
    .then(fx => {
      if (disposed) {
        fx.dispose();
        return;
      }
      postfx = fx;
      if (batterySaver) postfx.setEnabled(false);
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      postfx.setSize(w, h);
    })
    .catch(err => {
      // PostFX is non-essential; surface as warning, keep playing.
      console.warn(
        "[engine] PostFX init failed; falling back to direct render",
        err
      );
    });

  tick();

  return {
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      unsubBatterySaver();
      ro.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousemove", onMouseMove);
      renderer.domElement.removeEventListener(
        "pointerdown",
        onCanvasPointerDown
      );
      renderer.domElement.removeEventListener(
        "pointermove",
        onCanvasPointerMove
      );
      renderer.domElement.removeEventListener("pointerup", onCanvasPointerEnd);
      renderer.domElement.removeEventListener(
        "pointercancel",
        onCanvasPointerEnd
      );
      renderer.domElement.removeEventListener("click", onCanvasClick);
      detachContextHandlers();
      flashlight.dispose();
      decals.dispose();
      wallDecals.dispose();
      wallFixtures.dispose();
      // Wall + door-frame geometries (materials owned by MaterialFactory /
      // explicit doorFrameMat below).
      for (const g of wallBuild.geometries) g.dispose();
      for (const g of doorFrameBuild.geometries) g.dispose();
      doorFrameMat.dispose();
      ceilingFixtures.dispose();
      props.dispose();
      cobwebs.dispose();
      dust?.dispose();
      footstepDust.dispose(scene);
      shadowBudget.dispose();
      lightCuller.dispose();
      audio.dispose();
      postfx?.dispose();
      perf.dispose();
      renderer.dispose();
      observer.dispose();
      disposeObserverCache();
      // Release shared throwable resources before scene.traverse hits them.
      for (const tw of activeThrows) scene.remove(tw.mesh);
      activeThrows.length = 0;
      throwGeo.dispose();
      throwMat.dispose();
      if (catchOverlay.parentNode === container)
        container.removeChild(catchOverlay);
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      scene.traverse(obj => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose?.();
        const mat = mesh.material as
          | THREE.Material
          | THREE.Material[]
          | undefined;
        if (Array.isArray(mat)) mat.forEach(m => m.dispose());
        else mat?.dispose?.();
      });
      // The MaterialFactory cache holds the wall/floor/ceiling materials we
      // just disposed; reset so the next engine instance gets fresh ones.
      resetMaterialCache();
    },
    setRemotePlayers,
    setEnemy,
    setVirtualInput,
    toggleHide,
    throwObject,
    getPlayerState: () => ({
      x: camera.position.x,
      z: camera.position.z,
      rotY: yaw,
    }),
    unlockAudio: () => audio.unlock(),
    setSensitivity: (s: number) => {
      sensitivity = s;
    },
    getMinimapState: () => ({
      playerX: camera.position.x,
      playerZ: camera.position.z,
      enemyX: enemyMesh.visible ? enemyMesh.position.x : null,
      enemyZ: enemyMesh.visible ? enemyMesh.position.z : null,
      enemyVisible: enemyMesh.visible,
      keys: keyMeshes.map(k => ({ x: k.position.x, z: k.position.z })),
      exitX: parsed.exit ? parsed.exit.x * TILE_SIZE + TILE_SIZE / 2 : 0,
      exitZ: parsed.exit ? parsed.exit.z * TILE_SIZE + TILE_SIZE / 2 : 0,
      exitOpen: keyMeshes.length === 0,
      mapWidth: parsed.width,
      mapHeight: parsed.height,
      tileSize: TILE_SIZE,
      tiles: parsed.tiles,
    }),
    getObserverIndicatorState: (): ObserverIndicatorState => {
      if (!enemyMesh.visible) return { angleRelative: 0, intensity: 0 };
      const dx = enemyMesh.position.x - camera.position.x;
      const dz = enemyMesh.position.z - camera.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 16) return { angleRelative: 0, intensity: 0 };
      // World-space yaw to Observer; camera looks down -Z when yaw=0, so
      // forward = (-sin(yaw), -cos(yaw)). atan2(dx, -dz) gives the angle of
      // the Observer measured from -Z, which we then offset by yaw to get
      // the relative angle. Wrap to [-π, π].
      const observerYaw = Math.atan2(dx, -dz);
      let rel = observerYaw - yaw;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      // Intensity rises sharply under 8m. Chasing (close enough that
      // observer_stalk plays) bumps the indicator to full strength.
      const distScalar = Math.max(0, Math.min(1, 1 - dist / 16));
      const chasing = dist < 9;
      const intensity = distScalar * (chasing ? 1 : 0.6);
      return { angleRelative: rel, intensity };
    },
  };
}
