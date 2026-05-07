import * as THREE from "three";
import {
  MAPS,
  parseMap,
  TILE_SIZE,
  WALL_HEIGHT,
  isBlocked,
  type MapDef,
  type ParsedMap,
} from "@shared/maps";
import { perfFlag } from "../util/device";
import { createPerfMonitor } from "../util/perfMonitor";
import { createRenderer } from "../render/Renderer";
import { createPostFX, type PostFX } from "../render/PostFX";
import { createSharedUniforms } from "../render/uniforms";
import { setupAtmosphere } from "../lighting/Atmosphere";
import { createPractical } from "../lighting/Practical";
import { FlickerGroup, LightFlicker } from "../lighting/Flicker";
import { createFlashlight } from "../player/Flashlight";
import { getMaterial, resetMaterialCache } from "../materials/MaterialFactory";
import { DecalSpawner } from "../materials/Decals";
import { PropSpawner, type PropKind } from "../world/PropSpawner";
import { CobwebSet } from "../world/Cobwebs";

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

export type EngineEvents = {
  onKeyPickup?: (remaining: number) => void;
  onCaught?: () => void;
  onEscape?: () => void;
  onError?: (err: Error) => void;
};

export type EngineHandle = {
  dispose: () => void;
  setRemotePlayers: (players: RemotePlayer[]) => void;
  setEnemy: (pos: { x: number; z: number } | null) => void;
  getPlayerState: () => { x: number; z: number; rotY: number };
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
const PLAYER_HEIGHT = 1.7;
const MOVE_SPEED = 4.5;
const SPRINT_MULT = 1.6;

export function startGame(
  container: HTMLElement,
  options: {
    mapKey?: keyof typeof MAPS;
    events?: EngineEvents;
  } = {},
): EngineHandle {
  const mapDef: MapDef = MAPS[options.mapKey ?? "easy"];
  const parsed = parseMap(mapDef);
  const events = options.events ?? {};

  // ── Renderer ───────────────────────────────────────────────────────────────
  // Tier-aware construction lives in render/Renderer.ts so PostFX can branch
  // identically (mobile drops native MSAA in favor of SMAA, etc.).
  const { renderer, contextLost: isContextLost, detachContextHandlers } = createRenderer();
  container.appendChild(renderer.domElement);

  const sharedUniforms = createSharedUniforms();
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
    parsed.spawn.z * TILE_SIZE + TILE_SIZE / 2,
  );

  // ── Lighting ───────────────────────────────────────────────────────────────
  // Atmosphere sets near-zero ambient + hemisphere + fog so practicals
  // dominate. Flashlight is mobile-gated: PointLight on Android (avoids the
  // SpotLight+shadow WebGL crash class), SpotLight on desktop.
  setupAtmosphere(scene);
  scene.add(camera);
  const flashlight = createFlashlight(camera);
  const flickers = new FlickerGroup();

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

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldD), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(worldW / 2, 0, worldD / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldD), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(worldW / 2, WALL_HEIGHT, worldD / 2);
  scene.add(ceiling);

  // Walls — instanced for performance
  const wallGeo = new THREE.BoxGeometry(TILE_SIZE, WALL_HEIGHT, TILE_SIZE);
  const wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, parsed.walls.length);
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  const tmp = new THREE.Object3D();
  parsed.walls.forEach((w, i) => {
    tmp.position.set(
      w.x * TILE_SIZE + TILE_SIZE / 2,
      WALL_HEIGHT / 2,
      w.z * TILE_SIZE + TILE_SIZE / 2,
    );
    tmp.updateMatrix();
    wallMesh.setMatrixAt(i, tmp.matrix);
  });
  wallMesh.instanceMatrix.needsUpdate = true;
  scene.add(wallMesh);

  // Seed grime/blood/water decals on random wall faces and floor patches
  // so surfaces don't read as procedurally-clean. Density target from spec
  // is 12–20 per room; we approximate by ratio to wall count until Phase 6
  // brings room volumes online.
  const decals = new DecalSpawner(scene);
  const decalCount = Math.min(80, Math.max(20, Math.floor(parsed.walls.length * 0.4)));
  for (let i = 0; i < decalCount; i++) {
    const w = parsed.walls[Math.floor(Math.random() * parsed.walls.length)];
    const wx = w.x * TILE_SIZE + TILE_SIZE / 2;
    const wz = w.z * TILE_SIZE + TILE_SIZE / 2;
    // Pick one of four cardinal faces; nudge the decal just outside the
    // wall cube so it doesn't z-fight with the wall geometry.
    const face = Math.floor(Math.random() * 4);
    const offset = TILE_SIZE / 2 + 0.01;
    const normal = new THREE.Vector3();
    const pos = new THREE.Vector3(wx, 0.4 + Math.random() * (WALL_HEIGHT - 0.8), wz);
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
    const kind = r < 0.15 ? "blood" : r < 0.35 ? "water" : "grime";
    decals.spawn({ kind, position: pos, normal, size: 0.4 + Math.random() * 0.7 });
  }

  // Doors
  const doorGroup = new THREE.Group();
  parsed.doors.forEach((d) => {
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(TILE_SIZE * 0.95, WALL_HEIGHT * 0.92, 0.2),
      doorMat,
    );
    door.castShadow = true;
    door.receiveShadow = true;
    door.position.set(
      d.x * TILE_SIZE + TILE_SIZE / 2,
      (WALL_HEIGHT * 0.92) / 2,
      d.z * TILE_SIZE + TILE_SIZE / 2,
    );
    doorGroup.add(door);
  });
  scene.add(doorGroup);

  // Keys (with little point lights)
  const keyGroup = new THREE.Group();
  const keyMeshes: THREE.Mesh[] = [];
  parsed.keys.forEach((k) => {
    const key = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.08, 8, 24), keyMat);
    key.castShadow = true;
    key.position.set(
      k.x * TILE_SIZE + TILE_SIZE / 2,
      0.9,
      k.z * TILE_SIZE + TILE_SIZE / 2,
    );
    // Each key beacon is a warm-tungsten practical. ~30% of them flicker so
    // the world doesn't read as static.
    const light = createPractical({
      position: key.position.clone(),
      color: 0xffd24a,
      intensity: 0.6,
      distance: 4,
    });
    keyGroup.add(key);
    keyGroup.add(light);
    keyMeshes.push(key);
    if (Math.random() < 0.3) {
      flickers.add(new LightFlicker(light, 0.6, 0.12, 7));
    }
  });
  scene.add(keyGroup);

  // Hiding closets
  parsed.hides.forEach((h) => {
    const closet = new THREE.Mesh(
      new THREE.BoxGeometry(TILE_SIZE * 0.9, WALL_HEIGHT * 0.8, TILE_SIZE * 0.9),
      hideMat,
    );
    closet.castShadow = true;
    closet.receiveShadow = true;
    closet.position.set(
      h.x * TILE_SIZE + TILE_SIZE / 2,
      (WALL_HEIGHT * 0.8) / 2,
      h.z * TILE_SIZE + TILE_SIZE / 2,
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
      // ~10% of free tiles get a prop. Sparse so the world doesn't read
      // as a furniture warehouse.
      if (propRng() > 0.1) continue;
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
      props.place(picked, new THREE.Vector3(px, 0, pz), propRng() * Math.PI * 2);
    }
  }
  props.commit();

  // Cobwebs in the upper corners of every wall tile that has a free
  // neighbor — gives an "in the corner of the room" feel without needing
  // proper room volumes (those land in Phase 6).
  const cobwebs = new CobwebSet(scene);
  const cobwebRng = mulberry32(0xc0bea73);
  for (const w of parsed.walls) {
    if (cobwebRng() > 0.15) continue;
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
    const exitMesh = new THREE.Mesh(
      new THREE.BoxGeometry(TILE_SIZE * 0.9, WALL_HEIGHT * 0.92, 0.3),
      exitMat,
    );
    exitMesh.position.set(
      parsed.exit.x * TILE_SIZE + TILE_SIZE / 2,
      (WALL_HEIGHT * 0.92) / 2,
      parsed.exit.z * TILE_SIZE + TILE_SIZE / 2,
    );
    scene.add(exitMesh);
    const exitLight = new THREE.PointLight(0x44ff66, 1.2, 8, 2);
    exitLight.position.copy(exitMesh.position);
    scene.add(exitLight);
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
          new THREE.MeshStandardMaterial({ color: 0x88aaee, roughness: 0.6 }),
        );
        mesh.castShadow = true;
        remoteGroup.add(mesh);
        remoteMeshes.set(p.id, mesh);
      }
      mesh.position.set(p.x, PLAYER_HEIGHT / 2 + 0.2, p.z);
      mesh.rotation.y = p.rotY;
    }
    for (const [id, mesh] of remoteMeshes) {
      if (!seen.has(id)) {
        remoteGroup.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        remoteMeshes.delete(id);
      }
    }
  }

  const enemyMesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.5, 1.4, 8, 16),
    new THREE.MeshStandardMaterial({
      color: 0x220a0a,
      emissive: 0x550000,
      emissiveIntensity: 0.4,
      roughness: 0.5,
    }),
  );
  enemyMesh.castShadow = true;
  enemyMesh.visible = false;
  scene.add(enemyMesh);
  const enemyLight = new THREE.PointLight(0xff2222, 0.8, 6, 2);
  enemyLight.visible = false;
  scene.add(enemyLight);

  function setEnemy(pos: { x: number; z: number } | null) {
    if (!pos) {
      enemyMesh.visible = false;
      enemyLight.visible = false;
      return;
    }
    enemyMesh.visible = true;
    enemyLight.visible = true;
    enemyMesh.position.set(pos.x, 1.0, pos.z);
    enemyLight.position.set(pos.x, 1.6, pos.z);
  }
  if (parsed.enemy) {
    setEnemy({
      x: parsed.enemy.x * TILE_SIZE + TILE_SIZE / 2,
      z: parsed.enemy.z * TILE_SIZE + TILE_SIZE / 2,
    });
  }

  // ── Input: pointer-lock first-person look + WASD ──────────────────────────
  let yaw = 0;
  let pitch = 0;
  const keys = new Set<string>();
  const onKeyDown = (e: KeyboardEvent) => keys.add(e.code);
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  const onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    yaw -= e.movementX * 0.0022;
    pitch -= e.movementY * 0.0022;
    pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
  };
  document.addEventListener("mousemove", onMouseMove);

  const onCanvasClick = () => {
    if (document.pointerLockElement !== renderer.domElement) {
      renderer.domElement.requestPointerLock?.();
    }
  };
  renderer.domElement.addEventListener("click", onCanvasClick);

  // Collision: prevents walking through wall tiles using axis-separated checks.
  function tryMove(dx: number, dz: number) {
    const nx = camera.position.x + dx;
    const nz = camera.position.z + dz;
    const gxN = Math.floor(nx / TILE_SIZE);
    const gzCur = Math.floor(camera.position.z / TILE_SIZE);
    if (!isBlocked(parsed, gxN, gzCur)) camera.position.x = nx;
    const gxCur = Math.floor(camera.position.x / TILE_SIZE);
    const gzN = Math.floor(nz / TILE_SIZE);
    if (!isBlocked(parsed, gxCur, gzN)) camera.position.z = nz;
    void PLAYER_RADIUS;
  }

  function checkPickups() {
    for (let i = keyMeshes.length - 1; i >= 0; i--) {
      const k = keyMeshes[i];
      const dx = k.position.x - camera.position.x;
      const dz = k.position.z - camera.position.z;
      if (dx * dx + dz * dz < 1.4 * 1.4) {
        keyGroup.remove(k);
        // Remove the matching point light (it was added directly after).
        const lights = keyGroup.children.filter(
          (c): c is THREE.PointLight => (c as THREE.PointLight).isPointLight === true,
        );
        const nearestLight = lights
          .map((l) => ({ l, d: l.position.distanceToSquared(k.position) }))
          .sort((a, b) => a.d - b.d)[0];
        if (nearestLight) keyGroup.remove(nearestLight.l);
        keyMeshes.splice(i, 1);
        events.onKeyPickup?.(keyMeshes.length);
      }
    }
    if (parsed.exit && keyMeshes.length === 0) {
      const ex = parsed.exit.x * TILE_SIZE + TILE_SIZE / 2;
      const ez = parsed.exit.z * TILE_SIZE + TILE_SIZE / 2;
      const dx = ex - camera.position.x;
      const dz = ez - camera.position.z;
      if (dx * dx + dz * dz < 2 * 2) events.onEscape?.();
    }
    if (enemyMesh.visible) {
      const dx = enemyMesh.position.x - camera.position.x;
      const dz = enemyMesh.position.z - camera.position.z;
      if (dx * dx + dz * dz < 1.5 * 1.5) events.onCaught?.();
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

      camera.rotation.order = "YXZ";
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;

      const speed = (keys.has("ShiftLeft") ? MOVE_SPEED * SPRINT_MULT : MOVE_SPEED) * dt;
      let fx = 0;
      let fz = 0;
      if (keys.has("KeyW") || keys.has("ArrowUp")) fz -= 1;
      if (keys.has("KeyS") || keys.has("ArrowDown")) fz += 1;
      if (keys.has("KeyA") || keys.has("ArrowLeft")) fx -= 1;
      if (keys.has("KeyD") || keys.has("ArrowRight")) fx += 1;
      if (fx !== 0 || fz !== 0) {
        const len = Math.hypot(fx, fz);
        fx /= len;
        fz /= len;
        const sin = Math.sin(yaw);
        const cos = Math.cos(yaw);
        const dx = (fx * cos + fz * sin) * speed;
        const dz = (-fx * sin + fz * cos) * speed;
        tryMove(dx, dz);
      }

      const t = clock.elapsedTime;
      for (const k of keyMeshes) {
        k.rotation.y += dt * 2;
        k.position.y = 0.9 + Math.sin(t * 2 + k.position.x) * 0.08;
      }

      flickers.update(dt);
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
    // LUT asset lands in Phase 4 alongside texture pipeline; skip until
    // present so we don't fetch a 404 every page load.
    lutUrl: undefined,
  })
    .then((fx) => {
      if (disposed) {
        fx.dispose();
        return;
      }
      postfx = fx;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      postfx.setSize(w, h);
    })
    .catch((err) => {
      // PostFX is non-essential; surface as warning, keep playing.
      console.warn("[engine] PostFX init failed; falling back to direct render", err);
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
      renderer.domElement.removeEventListener("click", onCanvasClick);
      detachContextHandlers();
      flashlight.dispose();
      decals.dispose();
      props.dispose();
      cobwebs.dispose();
      postfx?.dispose();
      perf.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose?.();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose?.();
      });
      // The MaterialFactory cache holds the wall/floor/ceiling materials we
      // just disposed; reset so the next engine instance gets fresh ones.
      resetMaterialCache();
    },
    setRemotePlayers,
    setEnemy,
    getPlayerState: () => ({
      x: camera.position.x,
      z: camera.position.z,
      rotY: yaw,
    }),
  };
}
