import * as THREE from "three";
import {
  MAPS,
  parseMap,
  TILE_SIZE,
  WALL_HEIGHT,
  isBlocked,
  type MapKey,
  type MapDef,
  type ParsedMap,
} from "@shared/maps";
import {
  perfFlag,
  resolveGraphicsQuality,
  type GraphicsQuality,
} from "../util/device";
import { createPerfMonitor } from "../util/perfMonitor";
import { createRenderer } from "../render/Renderer";
import { createPostFX, type PostFX } from "../render/PostFX";
import { createSharedUniforms } from "../render/uniforms";
import { setupAtmosphere } from "../lighting/Atmosphere";
import { createPractical } from "../lighting/Practical";
import { FlickerGroup, LightFlicker } from "../lighting/Flicker";
import { ShadowBudget } from "../lighting/ShadowBudget";
import { createFlashlight } from "../player/Flashlight";
import { CameraRig } from "../player/CameraRig";
import { Heartbeat } from "../player/Heartbeat";
import { AudioWorld } from "../audio/AudioWorld";
import { getMaterial, resetMaterialCache } from "../materials/MaterialFactory";
import { DecalSpawner } from "../materials/Decals";
import { PropSpawner, type PropKind } from "../world/PropSpawner";
import { CobwebSet } from "../world/Cobwebs";
import { DustParticles } from "../world/DustParticles";
import { createAIDirector, type DirectorUpdate } from "./aiDirector";
import { findPath } from "./pathfinding";
import { TheObserver, disposeObserverCache } from "../world/TheObserver";

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
  onReady?: (info: { keys: number; timer: number; mapName: string }) => void;
  onKeyPickup?: (remaining: number) => void;
  onCaught?: () => void;
  onEscape?: () => void;
  onError?: (err: Error) => void;
  onHint?: (hint: string) => void;
  onTimer?: (remaining: number) => void;
  onDangerChange?: (danger: "safe" | "near" | "critical") => void;
  onHideChange?: (hidden: boolean) => void;
  onAIDirector?: (update: DirectorUpdate) => void;
};

export type EngineHandle = {
  dispose: () => void;
  setRemotePlayers: (players: RemotePlayer[]) => void;
  setEnemy: (pos: { x: number; z: number } | null) => void;
  setVirtualInput: (input: Partial<VirtualInput>) => void;
  toggleHide: () => void;
  getPlayerState: () => { x: number; z: number; rotY: number };
  /**
   * Resume the audio context. Must be called from a user gesture (button
   * click) on iOS Safari or autoplay-blocked Chrome. No-op if already
   * unlocked.
   */
  unlockAudio: () => boolean;
};

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
const MOBILE_LOOK_SCALE = 0.005;

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
  } = {}
): EngineHandle {
  const mapDef: MapDef = MAPS[options.mapKey ?? "easy"];
  const parsed = parseMap(mapDef);
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

  const sharedUniforms = createSharedUniforms();
  const basePostFx = {
    vignetteOffset: sharedUniforms.vignetteOffset.value,
    noiseOpacity: sharedUniforms.noiseOpacity.value,
    bloomIntensity: sharedUniforms.bloomIntensity.value,
  };
  let postfx: PostFX | null = null;

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
  setupAtmosphere(scene);
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
  // Track distance walked so we step on a stride cadence rather than every
  // tick — feels less "every frame thunk" without an asset library.
  let stepDist = 0;
  let lastCamX = camera.position.x;
  let lastCamZ = camera.position.z;

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
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x3a1f10,
    roughness: 0.7,
    metalness: 0.05,
  });
  const keyMat = new THREE.MeshStandardMaterial({
    color: 0xffd24a,
    emissive: 0x2a1d00,
    emissiveIntensity: 0.6,
    metalness: 0.85,
    roughness: 0.3,
  });
  const hideMat = new THREE.MeshStandardMaterial({
    color: 0x40291a,
    roughness: 0.9,
    metalness: 0.05,
  });
  const exitMat = new THREE.MeshStandardMaterial({
    color: 0x1a4a1a,
    emissive: 0x0a4a0a,
    emissiveIntensity: 0.8,
    roughness: 0.6,
  });

  // ── World geometry ─────────────────────────────────────────────────────────
  const worldW = parsed.width * TILE_SIZE;
  const worldD = parsed.height * TILE_SIZE;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(worldW, worldD),
    floorMat
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(worldW / 2, 0, worldD / 2);
  floor.receiveShadow = shadowsEnabled;
  scene.add(floor);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(worldW, worldD),
    ceilingMat
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(worldW / 2, WALL_HEIGHT, worldD / 2);
  scene.add(ceiling);

  // Walls — instanced for performance
  const wallGeo = new THREE.BoxGeometry(TILE_SIZE, WALL_HEIGHT, TILE_SIZE);
  const wallMesh = new THREE.InstancedMesh(
    wallGeo,
    wallMat,
    parsed.walls.length
  );
  wallMesh.castShadow = shadowsEnabled;
  wallMesh.receiveShadow = shadowsEnabled;
  const tmp = new THREE.Object3D();
  parsed.walls.forEach((w, i) => {
    tmp.position.set(
      w.x * TILE_SIZE + TILE_SIZE / 2,
      WALL_HEIGHT / 2,
      w.z * TILE_SIZE + TILE_SIZE / 2
    );
    tmp.updateMatrix();
    wallMesh.setMatrixAt(i, tmp.matrix);
  });
  wallMesh.instanceMatrix.needsUpdate = true;
  scene.add(wallMesh);

  const doorGeo = new THREE.BoxGeometry(
    TILE_SIZE * 0.95,
    WALL_HEIGHT * 0.92,
    0.2
  );
  const keyGeo = new THREE.TorusGeometry(
    0.25,
    0.08,
    8,
    quality === "low" ? 16 : 24
  );
  const hideGeo = new THREE.BoxGeometry(
    TILE_SIZE * 0.9,
    WALL_HEIGHT * 0.8,
    TILE_SIZE * 0.9
  );

  // Seed grime/blood/water decals on random wall faces and floor patches
  // so surfaces don't read as procedurally-clean. Density target from spec
  // is 12–20 per room; we approximate by ratio to wall count until Phase 6
  // brings room volumes online.
  const decals = new DecalSpawner(scene);
  const decalCount =
    quality === "low"
      ? Math.min(30, Math.max(8, Math.floor(parsed.walls.length * 0.15)))
      : Math.min(80, Math.max(20, Math.floor(parsed.walls.length * 0.4)));
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

  // Doors
  const doorGroup = new THREE.Group();
  parsed.doors.forEach(d => {
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.castShadow = shadowsEnabled;
    door.receiveShadow = shadowsEnabled;
    const wallWest = isBlocked(parsed, d.x - 1, d.z);
    const wallEast = isBlocked(parsed, d.x + 1, d.z);
    const opensNorthSouth = wallWest && wallEast;
    door.position.set(
      d.x * TILE_SIZE + TILE_SIZE / 2,
      (WALL_HEIGHT * 0.92) / 2,
      d.z * TILE_SIZE + TILE_SIZE / 2
    );
    if (opensNorthSouth) {
      door.rotation.y = Math.PI / 2;
      door.position.x -= TILE_SIZE * 0.36;
    } else {
      door.position.z -= TILE_SIZE * 0.36;
    }
    doorGroup.add(door);
  });
  scene.add(doorGroup);

  // Keys (with little point lights)
  const keyGroup = new THREE.Group();
  const keyMeshes: THREE.Mesh[] = [];
  const keyLights = new Map<THREE.Mesh, THREE.PointLight>();
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
      if (Math.random() < 0.3) {
        flickers.add(new LightFlicker(light, 0.6, 0.12, 7));
      }
    }
    keyMeshes.push(key);
  });
  scene.add(keyGroup);

  // Hiding closets
  parsed.hides.forEach(h => {
    const closet = new THREE.Mesh(hideGeo, hideMat);
    closet.castShadow = shadowsEnabled;
    closet.receiveShadow = shadowsEnabled;
    closet.position.set(
      h.x * TILE_SIZE + TILE_SIZE / 2,
      (WALL_HEIGHT * 0.8) / 2,
      h.z * TILE_SIZE + TILE_SIZE / 2
    );
    scene.add(closet);
  });

  // Prop dressing — chairs/tables/lamps/shelves dropped into floor tiles
  // that aren't blocked, walls, doors, keys, hides, or the exit. One
  // InstancedMesh per kind so total draw-call cost is O(kinds), not
  // O(props). Seed is deterministic per map for a stable look.
  const props = new PropSpawner(scene);
  const blocked = new Set<string>();
  for (const w of parsed.walls) blocked.add(`${w.x},${w.z}`);
  for (const d of parsed.doors) blocked.add(`${d.x},${d.z}`);
  for (const k of parsed.keys) blocked.add(`${k.x},${k.z}`);
  for (const h of parsed.hides) blocked.add(`${h.x},${h.z}`);
  if (parsed.exit) blocked.add(`${parsed.exit.x},${parsed.exit.z}`);
  blocked.add(`${parsed.spawn.x},${parsed.spawn.z}`);

  const propRng = mulberry32(0x484e54);
  const propKinds: PropKind[] = ["chair", "table", "lamp", "shelf"];
  const propWeights = [0.4, 0.2, 0.25, 0.15];
  for (let gz = 0; gz < parsed.height; gz++) {
    for (let gx = 0; gx < parsed.width; gx++) {
      if (blocked.has(`${gx},${gz}`)) continue;
      // ~14% of free tiles get a prop. Dense silhouettes make doorways and
      // corners feel less readable without becoming a furniture warehouse.
      if (propRng() > 0.14) continue;
      const r = propRng();
      let acc = 0;
      let picked: PropKind = "chair";
      for (let i = 0; i < propKinds.length; i++) {
        acc += propWeights[i];
        if (r <= acc) {
          picked = propKinds[i];
          break;
        }
      }
      const cx = gx * TILE_SIZE + TILE_SIZE / 2;
      const cz = gz * TILE_SIZE + TILE_SIZE / 2;
      const jitter = TILE_SIZE * 0.2;
      const px = cx + (propRng() - 0.5) * jitter;
      const pz = cz + (propRng() - 0.5) * jitter;
      props.place(
        picked,
        new THREE.Vector3(px, 0, pz),
        propRng() * Math.PI * 2
      );
    }
  }
  props.commit();

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
  const cobwebRng = mulberry32(0xc0bea73);
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
    const exitMesh = new THREE.Mesh(doorGeo, exitMat);
    exitMesh.position.set(
      parsed.exit.x * TILE_SIZE + TILE_SIZE / 2,
      (WALL_HEIGHT * 0.92) / 2,
      parsed.exit.z * TILE_SIZE + TILE_SIZE / 2
    );
    scene.add(exitMesh);
    if (quality !== "low") {
      const exitLight = new THREE.PointLight(0x44ff66, 1.2, 8, 2);
      exitLight.position.copy(exitMesh.position);
      scene.add(exitLight);
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
    get position() { return observer.group.position; },
    get visible() { return observer.visible; },
    set visible(v: boolean) { observer.visible = v; },
    lookAt(x: number, y: number, z: number) { observer.lookAt(x, y, z); },
    castShadow: shadowsEnabled,
  };

  const enemyLight = new THREE.PointLight(0x1a2a3a, quality === "low" ? 0 : 0.5, 8, 2);
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
  let lastRemoteEnemyAt = 0;
  let dangerState: "safe" | "near" | "critical" = "safe";
  let isHiding = false;
  let timeLeft = mapDef.timer;
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
    enemyMesh.position.set(pos.x, 1.0, pos.z);
    enemyLight.position.set(pos.x, 1.6, pos.z);
  }

  function updateAnxietyEffects(intensity: number, elapsed: number) {
    const panic = THREE.MathUtils.clamp(intensity, 0, 1);
    const jitter = (Math.sin(elapsed * 41.3) + Math.sin(elapsed * 67.9)) * 0.5;
    sharedUniforms.vignetteOffset.value =
      basePostFx.vignetteOffset - panic * 0.09;
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
  });
  events.onTimer?.(lastTimerSecond);

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
  let velocityX = 0;
  let velocityZ = 0;
  const virtualInput: VirtualInput = { moveX: 0, moveZ: 0, sprinting: false };
  const keys = new Set<string>();
  const onKeyDown = (e: KeyboardEvent) => {
    keys.add(e.code);
    if (e.code === "KeyE") toggleHide();
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  const onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    const sensitivity = options.sensitivity ?? 1;
    yaw -= e.movementX * 0.0022 * sensitivity;
    pitch -= e.movementY * 0.0022 * sensitivity;
    pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
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

  const onCanvasPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
    audio.unlock();
    activeLookPointer = e.pointerId;
    lastLookX = e.clientX;
    lastLookY = e.clientY;
    captureCanvasPointer?.(e.pointerId);
    e.preventDefault();
  };

  const onCanvasPointerMove = (e: PointerEvent) => {
    if (activeLookPointer !== e.pointerId) return;
    const sensitivity = options.sensitivity ?? 1;
    yaw -= (e.clientX - lastLookX) * MOBILE_LOOK_SCALE * sensitivity;
    pitch -= (e.clientY - lastLookY) * MOBILE_LOOK_SCALE * sensitivity;
    pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
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

  function canOccupy(x: number, z: number, radius: number) {
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
      return !isBlocked(parsed, gx, gz);
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
    if (canOccupy(nx, enemyMesh.position.z, ENEMY_RADIUS))
      enemyMesh.position.x = nx;
    if (canOccupy(enemyMesh.position.x, nz, ENEMY_RADIUS))
      enemyMesh.position.z = nz;
    enemyLight.position.set(enemyMesh.position.x, 1.6, enemyMesh.position.z);
  }

  function updateLocalEnemy(dt: number, elapsed: number, now: number) {
    if (!enemyMesh.visible || now - lastRemoteEnemyAt < REMOTE_ENEMY_TIMEOUT_MS) return;

    // Don't move enemy during catch sequence — it's already "there"
    if (catchSequenceActive) {
      observer.update(dt, elapsed, 0);
      observer.syncLights();
      return;
    }

    // Track last known player position (update only when not hiding)
    if (!isHiding) {
      lastKnownPlayerX = camera.position.x;
      lastKnownPlayerZ = camera.position.z;
      isInvestigating = false;
    }

    // Periodic A* recompute
    pathRecomputeTimer -= dt;
    if (pathRecomputeTimer <= 0 || !enemyPath) {
      pathRecomputeTimer = PATH_RECOMPUTE_INTERVAL;

      const targetX = isHiding ? lastKnownPlayerX : camera.position.x;
      const targetZ = isHiding ? lastKnownPlayerZ : camera.position.z;

      const newPath = findPath(
        parsed,
        enemyMesh.position.x,
        enemyMesh.position.z,
        targetX,
        targetZ
      );
      if (newPath !== null) {
        enemyPath = newPath;
      }
      // If hiding and reached last-known-pos, patrol named waypoints (or wander as fallback).
      if (isHiding && (!enemyPath || enemyPath.length === 0)) {
        isInvestigating = true;
        if (patrolWaypoints.length > 0) {
          const wp = patrolWaypoints[patrolIndex % patrolWaypoints.length];
          const dist = Math.hypot(
            wp.x - enemyMesh.position.x,
            wp.z - enemyMesh.position.z
          );
          if (dist < 1.0) patrolIndex = (patrolIndex + 1) % patrolWaypoints.length;
          lastKnownPlayerX = wp.x;
          lastKnownPlayerZ = wp.z;
          enemyPath =
            findPath(parsed, enemyMesh.position.x, enemyMesh.position.z, wp.x, wp.z) ?? [];
        } else {
          const wander = {
            x: lastKnownPlayerX + (Math.random() - 0.5) * 12,
            z: lastKnownPlayerZ + (Math.random() - 0.5) * 12,
          };
          enemyPath =
            findPath(parsed, enemyMesh.position.x, enemyMesh.position.z, wander.x, wander.z) ?? [];
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
        enemyMesh.lookAt(camera.position.x, enemyMesh.position.y, camera.position.z);
      }
    } else {
      // Fallback direct move (no valid path found — shouldn't happen on well-formed maps)
      const dx = camera.position.x - enemyMesh.position.x;
      const dz = camera.position.z - enemyMesh.position.z;
      const dist = Math.hypot(dx, dz) || 1;
      tryMoveEnemy((dx / dist) * speed, (dz / dist) * speed);
      enemyMesh.lookAt(camera.position.x, enemyMesh.position.y, camera.position.z);
    }

    // Proximity audio
    const distToPlayer = Math.hypot(
      enemyMesh.position.x - camera.position.x,
      enemyMesh.position.z - camera.position.z
    );
    const proximity = Math.max(0, 1 - distToPlayer / 14);
    audio.setEntityProximity(proximity);

    enemyLight.position.set(enemyMesh.position.x, 1.6, enemyMesh.position.z);
    enemyLight.visible = quality !== "low" && enemyMesh.visible;
    enemyLight.intensity = 0.3 + proximity * 0.5;

    const distForAnim = distToPlayer;
    observer.update(dt, elapsed, distForAnim);
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
        keyMeshes.splice(i, 1);
        audio.triggerKeyPickup();
        events.onKeyPickup?.(keyMeshes.length);
        emitDirector("keyPickup");
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
        // Flash white then fade
        catchOverlay.style.opacity = "1";
      }
    }
  }

  // ── Loop ──────────────────────────────────────────────────────────────────
  const clock = new THREE.Clock();
  const perf = createPerfMonitor(perfFlag);
  let raf = 0;
  let disposed = false;

  function tick() {
    if (disposed) return;
    try {
      perf.begin();
      const dt = Math.min(clock.getDelta(), 0.05);

      // ── Catch sequence ──────────────────────────────────────────────────
      if (catchSequenceActive) {
        catchSequenceTimer -= dt;
        // Decay the flash overlay
        const flashProgress = Math.max(0, catchSequenceTimer / CATCH_SEQUENCE_DURATION);
        catchOverlay.style.opacity = String(flashProgress.toFixed(3));
        // Spike then decay PostFX for the visual static burst
        sharedUniforms.bloomIntensity.value = basePostFx.bloomIntensity + flashProgress * 2.8;
        sharedUniforms.noiseOpacity.value = basePostFx.noiseOpacity + flashProgress * 0.9;
        if (catchSequenceTimer <= 0) {
          catchSequenceActive = false;
          catchOverlay.style.opacity = "0";
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
        events.onCaught?.();
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

      const t = clock.elapsedTime;
      updateLocalEnemy(dt, t, performance.now());
      for (const k of keyMeshes) {
        k.rotation.y += dt * 2;
        k.position.y = 0.9 + Math.sin(t * 2 + k.position.x) * 0.08;
      }

      flickers.update(dt);
      shadowBudget.update(camera);
      cameraRig.update(dt, { moveMagnitude, sprinting, crouched: isHiding }, t);
      heartbeat.update(
        dt,
        camera,
        enemyMesh.visible ? enemyMesh.position : null
      );
      updateAnxietyEffects(heartbeat.intensity(), t);
      audio.setHeartbeatIntensity(heartbeat.intensity());
      audio.update(dt);
      dust?.update(dt, camera);
      // Footstep cadence — fire one click every ~0.8m of horizontal travel.
      const dxStep = camera.position.x - lastCamX;
      const dzStep = camera.position.z - lastCamZ;
      stepDist += Math.hypot(dxStep, dzStep);
      lastCamX = camera.position.x;
      lastCamZ = camera.position.z;
      const stride = sprinting ? 1.0 : 0.8;
      if (!isHiding && stepDist >= stride) {
        stepDist -= stride;
        audio.triggerFootstep();
      }
      checkPickups();
      if (!isContextLost()) {
        if (postfx) postfx.render(dt);
        else renderer.render(scene, camera);
      }
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
      props.dispose();
      cobwebs.dispose();
      dust?.dispose();
      shadowBudget.dispose();
      audio.dispose();
      postfx?.dispose();
      perf.dispose();
      renderer.dispose();
      observer.dispose();
      disposeObserverCache();
      if (catchOverlay.parentNode === container) container.removeChild(catchOverlay);
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
    getPlayerState: () => ({
      x: camera.position.x,
      z: camera.position.z,
      rotY: yaw,
    }),
    unlockAudio: () => audio.unlock(),
  };
}
