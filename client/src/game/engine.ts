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
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  container.appendChild(renderer.domElement);

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
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
    parsed.spawn.z * TILE_SIZE + TILE_SIZE / 2,
  );

  // ── Lighting (Granny-style: dim warm interior + flashlight) ────────────────
  scene.add(new THREE.AmbientLight(0x1a1620, 0.35));
  const moonlight = new THREE.DirectionalLight(0x4a5577, 0.25);
  moonlight.position.set(20, 40, 10);
  scene.add(moonlight);

  const flashlight = new THREE.SpotLight(0xfff1c2, 6, 22, Math.PI / 6, 0.45, 1.6);
  flashlight.castShadow = true;
  flashlight.shadow.mapSize.set(1024, 1024);
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
    const light = new THREE.PointLight(0xffd24a, 0.6, 4, 2);
    light.position.copy(key.position);
    keyGroup.add(key);
    keyGroup.add(light);
    keyMeshes.push(key);
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
  let raf = 0;
  let disposed = false;

  function tick() {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
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

    // Animate keys (rotating + bobbing) for visual flair.
    const t = clock.elapsedTime;
    for (const k of keyMeshes) {
      k.rotation.y += dt * 2;
      k.position.y = 0.9 + Math.sin(t * 2 + k.position.x) * 0.08;
    }

    checkPickups();
    renderer.render(scene, camera);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
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
