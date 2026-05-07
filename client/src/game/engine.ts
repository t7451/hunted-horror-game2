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
  onReady?: (info: { keys: number; timer: number; mapName: string }) => void;
  onKeyPickup?: (remaining: number) => void;
  onCaught?: () => void;
  onEscape?: () => void;
  onError?: (err: Error) => void;
  onHint?: (hint: string) => void;
  onTimer?: (remaining: number) => void;
  onDangerChange?: (danger: "safe" | "near" | "critical") => void;
  onHideChange?: (hidden: boolean) => void;
};

export type EngineHandle = {
  dispose: () => void;
  setRemotePlayers: (players: RemotePlayer[]) => void;
  setEnemy: (pos: { x: number; z: number } | null) => void;
  getPlayerState: () => { x: number; z: number; rotY: number };
};

const PLAYER_RADIUS = 0.6;
const PLAYER_HEIGHT = 1.7;
const MOVE_SPEED = 4.5;
const SPRINT_MULT = 1.6;
const HIDE_INTERACTION_DISTANCE = 2.2;
const REMOTE_ENEMY_TIMEOUT_MS = 1200;
const INVESTIGATING_SPEED_FACTOR = 0.25;

function calculateMoveSpeed(
  isHidden: boolean,
  isSprinting: boolean,
  dt: number
) {
  if (isHidden) return 0;
  return (isSprinting ? MOVE_SPEED * SPRINT_MULT : MOVE_SPEED) * dt;
}

function calculateEnemySpeed(
  investigating: boolean,
  baseSpeed: number,
  dt: number
) {
  const speed = investigating
    ? baseSpeed * INVESTIGATING_SPEED_FACTOR
    : baseSpeed;
  return speed * dt;
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
  scene.background = new THREE.Color(0x05050a);
  scene.fog = new THREE.FogExp2(0x05050a, 0.07);

  const camera = new THREE.PerspectiveCamera(78, 1, 0.05, 200);
  camera.position.set(
    parsed.spawn.x * TILE_SIZE + TILE_SIZE / 2,
    PLAYER_HEIGHT,
    parsed.spawn.z * TILE_SIZE + TILE_SIZE / 2
  );

  // ── Lighting (Granny-style: dim warm interior + flashlight) ────────────────
  scene.add(new THREE.AmbientLight(0x1a1620, quality === "low" ? 0.5 : 0.35));
  const moonlight = new THREE.DirectionalLight(0x4a5577, 0.25);
  moonlight.position.set(20, 40, 10);
  scene.add(moonlight);

  const flashlight = new THREE.SpotLight(
    0xfff1c2,
    6,
    22,
    Math.PI / 6,
    0.45,
    1.6
  );
  flashlight.castShadow = shadowsEnabled;
  flashlight.shadow.mapSize.set(
    quality === "high" ? 1024 : 512,
    quality === "high" ? 1024 : 512
  );
  flashlight.shadow.camera.near = 0.5;
  flashlight.shadow.camera.far = 22;
  camera.add(flashlight);
  camera.add(flashlight.target);
  flashlight.position.set(0.25, -0.15, 0);
  flashlight.target.position.set(0, 0, -1);
  scene.add(camera);

  // ── Materials ──────────────────────────────────────────────────────────────
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x6b4a32,
    roughness: 0.95,
    metalness: 0.02,
  });
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x2a1f17,
    roughness: 1,
    metalness: 0,
  });
  const ceilingMat = new THREE.MeshStandardMaterial({
    color: 0x14100c,
    roughness: 1,
    metalness: 0,
  });
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

  // Doors
  const doorGroup = new THREE.Group();
  parsed.doors.forEach(d => {
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.castShadow = shadowsEnabled;
    door.receiveShadow = shadowsEnabled;
    door.position.set(
      d.x * TILE_SIZE + TILE_SIZE / 2,
      (WALL_HEIGHT * 0.92) / 2,
      d.z * TILE_SIZE + TILE_SIZE / 2
    );
    doorGroup.add(door);
  });
  scene.add(doorGroup);

  // Keys (with little point lights)
  const keyGroup = new THREE.Group();
  const keyMeshes: THREE.Mesh[] = [];
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
      const light = new THREE.PointLight(0xffd24a, 0.6, 4, 2);
      light.position.copy(key.position);
      keyGroup.add(light);
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

  const enemyMesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.5, 1.4, 8, 16),
    new THREE.MeshStandardMaterial({
      color: 0x220a0a,
      emissive: 0x550000,
      emissiveIntensity: 0.4,
      roughness: 0.5,
    })
  );
  enemyMesh.castShadow = shadowsEnabled;
  enemyMesh.visible = false;
  scene.add(enemyMesh);
  const enemyLight = new THREE.PointLight(
    0xff2222,
    quality === "low" ? 0 : 0.8,
    6,
    2
  );
  enemyLight.visible = false;
  scene.add(enemyLight);
  let lastRemoteEnemyAt = 0;
  let dangerState: "safe" | "near" | "critical" = "safe";
  let isHiding = false;
  let timeLeft = mapDef.timer;
  let lastTimerSecond = Math.ceil(timeLeft);

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
  events.onReady?.({
    keys: keyMeshes.length,
    timer: mapDef.timer,
    mapName: mapDef.name,
  });
  events.onTimer?.(lastTimerSecond);

  // ── Input: pointer-lock first-person look + WASD ──────────────────────────
  let yaw = 0;
  let pitch = 0;
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

  const onCanvasClick = () => {
    if (document.pointerLockElement !== renderer.domElement) {
      renderer.domElement.requestPointerLock?.();
    }
  };
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
    camera.position.y = isHiding ? PLAYER_HEIGHT * 0.72 : PLAYER_HEIGHT;
    events.onHideChange?.(isHiding);
    events.onHint?.(
      isHiding
        ? "Hidden · press E to leave the closet"
        : "Out of hiding · keep moving"
    );
  }

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

  function tryMoveEnemy(dx: number, dz: number) {
    const nx = enemyMesh.position.x + dx;
    const nz = enemyMesh.position.z + dz;
    const gxN = Math.floor(nx / TILE_SIZE);
    const gzCur = Math.floor(enemyMesh.position.z / TILE_SIZE);
    if (!isBlocked(parsed, gxN, gzCur)) enemyMesh.position.x = nx;
    const gxCur = Math.floor(enemyMesh.position.x / TILE_SIZE);
    const gzN = Math.floor(nz / TILE_SIZE);
    if (!isBlocked(parsed, gxCur, gzN)) enemyMesh.position.z = nz;
    enemyLight.position.set(enemyMesh.position.x, 1.6, enemyMesh.position.z);
  }

  function updateLocalEnemy(dt: number, elapsed: number) {
    if (
      !enemyMesh.visible ||
      performance.now() - lastRemoteEnemyAt < REMOTE_ENEMY_TIMEOUT_MS
    )
      return;
    const dx = camera.position.x - enemyMesh.position.x;
    const dz = camera.position.z - enemyMesh.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    const investigating = isHiding && dist > 4;
    const speed = calculateEnemySpeed(investigating, mapDef.claudeSpeed, dt);
    const wobble = Math.sin(elapsed * 0.9) * 0.4;
    const tx = investigating ? Math.sin(elapsed * 0.35) + wobble : dx / dist;
    const tz = investigating ? Math.cos(elapsed * 0.31) - wobble : dz / dist;
    const len = Math.hypot(tx, tz) || 1;
    tryMoveEnemy((tx / len) * speed, (tz / len) * speed);
    enemyMesh.lookAt(
      camera.position.x,
      enemyMesh.position.y,
      camera.position.z
    );
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
          (c): c is THREE.PointLight =>
            (c as THREE.PointLight).isPointLight === true
        );
        const nearestLight = lights
          .map(l => ({ l, d: l.position.distanceToSquared(k.position) }))
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
      const distSq = dx * dx + dz * dz;
      const nextDanger =
        distSq < 4 * 4 ? "critical" : distSq < 9 * 9 ? "near" : "safe";
      if (nextDanger !== dangerState) {
        dangerState = nextDanger;
        events.onDangerChange?.(dangerState);
      }
      if (!isHiding && distSq < 1.5 * 1.5) events.onCaught?.();
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

      timeLeft = Math.max(0, timeLeft - dt);
      const timerSecond = Math.ceil(timeLeft);
      if (timerSecond !== lastTimerSecond) {
        lastTimerSecond = timerSecond;
        events.onTimer?.(timerSecond);
        if (timerSecond === 30)
          events.onHint?.("Thirty seconds left. Reach the exit.");
      }
      if (timeLeft <= 0) {
        events.onCaught?.();
        return;
      }

      const speed = calculateMoveSpeed(isHiding, keys.has("ShiftLeft"), dt);
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
      updateLocalEnemy(dt, t);
      for (const k of keyMeshes) {
        k.rotation.y += dt * 2;
        k.position.y = 0.9 + Math.sin(t * 2 + k.position.x) * 0.08;
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
      renderer.domElement.removeEventListener("click", onCanvasClick);
      detachContextHandlers();
      postfx?.dispose();
      perf.dispose();
      renderer.dispose();
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
