// client/src/world/TheObserver.ts
// "The Observer" — the AI villain of HUNTED BY THE OBSERVER.
//
// Built from Three.js primitives. Reads as something tall, asymmetric, and
// uncomfortable to look at:
//   - 2.4m frame, narrow torso, long thin legs
//   - LEFT arm reaches near the floor; right arm normal length
//   - Oversized angular head pitched into the shoulders, perma-tilted
//   - Hollow recessed eye sockets with red emissive eye points (flicker +
//     proximity dropout) and a crooked grin
//   - Tall flared cloth/cloak with per-frame vertex displacement
//   - Walk-cycle bob + sway tied to actual velocity, plus a "lunge
//     telegraph" the engine can fire on chase-entry to freeze + jerk

import * as THREE from "three";

const BODY_DARK = 0x070708;
const HEAD_DARK = 0x050508;
const EYE_RED = 0xff2820;
const EYE_LIGHT_COLOR = 0xff3018;
const EYE_LIGHT_DISTANCE = 6.5;

// Shared geometry/material cache so multiple instances don't re-allocate.
const _geoCache = new Map<string, THREE.BufferGeometry>();

function cachedGeo<T extends THREE.BufferGeometry>(
  key: string,
  factory: () => T
): T {
  if (!_geoCache.has(key)) _geoCache.set(key, factory());
  return _geoCache.get(key) as T;
}

function buildFaceTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#020203";
  ctx.fillRect(0, 0, size, size);

  // Faint corrupted-data noise around the head — keeps the existing
  // "wrong render" undertone behind the new physical eye sockets.
  ctx.fillStyle = "#150810";
  ctx.font = "7px monospace";
  const lines = [
    "PROC 0x1F4A",
    "ERR: 0xDEAD",
    "READ 0x00FF",
    ">> WATCHING",
    "0xCALC..",
    "ERR: NULL",
    "DIST 0.00",
    "PROC KILL",
  ];
  lines.forEach((line, i) => {
    ctx.fillStyle = i % 3 === 0 ? "#3a0a0a" : "#180808";
    ctx.fillText(line, 4, 12 + i * 9);
  });

  // Scanline overlay.
  for (let y = 0; y < size; y += 2) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, y, size, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const CLOTH_HEIGHT = 1.6;
const CLOTH_RADIAL = 16;
const CLOTH_HEIGHT_SEG = 8;

function buildClothGeometry(): THREE.CylinderGeometry {
  // Open-ended flared cylinder — open top so the torso drops into the cloak.
  const geo = new THREE.CylinderGeometry(
    0.35,
    0.85,
    CLOTH_HEIGHT,
    CLOTH_RADIAL,
    CLOTH_HEIGHT_SEG,
    true
  );
  // Cache the rest pose so animateCloth can offset from it each frame
  // without drift.
  const pos = geo.attributes.position;
  geo.userData.basePositions = new Float32Array(pos.array as Float32Array);
  return geo;
}

export type ObserverPose = {
  position: THREE.Vector3;
  yaw: number;
};

export class TheObserver {
  readonly group: THREE.Group;
  readonly leftEyeLight: THREE.PointLight;
  readonly rightEyeLight: THREE.PointLight;

  private bodyMat: THREE.MeshStandardMaterial;
  private headMat: THREE.MeshStandardMaterial;
  private clothMat: THREE.MeshStandardMaterial;

  private torso!: THREE.Mesh;
  private head!: THREE.Mesh;
  private cloth!: THREE.Mesh;
  private leftEye!: THREE.Mesh;
  private rightEye!: THREE.Mesh;
  private faceTex?: THREE.CanvasTexture;
  private bodyContainer!: THREE.Group;

  private elapsed = 0;
  private nextTwitchAt = 6;
  private twitchUntil = 0;
  private currentSpeed = 0;
  private walkPhase = 0;
  private lastWorldPos = new THREE.Vector3();
  private lastWorldPosValid = false;
  private telegraphUntil = 0;
  private telegraphHeadResetAt = 0;
  private headTrackYaw = 0;

  constructor(shadowsEnabled: boolean) {
    this.group = new THREE.Group();
    this.group.name = "the_observer";

    this.bodyMat = new THREE.MeshStandardMaterial({
      color: BODY_DARK,
      roughness: 0.95,
      metalness: 0,
    });
    this.headMat = new THREE.MeshStandardMaterial({
      color: HEAD_DARK,
      roughness: 0.85,
      metalness: 0,
    });
    this.clothMat = new THREE.MeshStandardMaterial({
      color: 0x040405,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });

    this.leftEyeLight = new THREE.PointLight(
      EYE_LIGHT_COLOR,
      0,
      EYE_LIGHT_DISTANCE,
      2
    );
    this.leftEyeLight.castShadow = false;
    this.rightEyeLight = new THREE.PointLight(
      EYE_LIGHT_COLOR,
      0,
      EYE_LIGHT_DISTANCE,
      2
    );
    this.rightEyeLight.castShadow = false;
    // Eye lights are pinned to world space by syncLights() each frame so they
    // stay in lock-step with the head's animated position. They live in the
    // group for ownership, but their positions are written in world coords.

    this._build(shadowsEnabled);
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  set visible(v: boolean) {
    this.group.visible = v;
    this.leftEyeLight.visible = v;
    this.rightEyeLight.visible = v;
    if (!v) {
      this.lastWorldPosValid = false;
    }
  }

  /**
   * Orient the body so its FACE (+Z forward) points at the target.
   *
   * `THREE.Object3D.lookAt` aligns local -Z to the target, but TheObserver
   * is built with its face on +Z (eyes/mouth at z = +0.21, head distortion
   * flattens z < 0 as "back of skull"). Using lookAt would turn the
   * Observer's back to the player. We compute yaw via atan2(dx, dz) so +Z
   * points at the target — matching the head-tracking math in update().
   */
  lookAt(x: number, _y: number, z: number): void {
    const dx = x - this.group.position.x;
    const dz = z - this.group.position.z;
    if (dx === 0 && dz === 0) return;
    this.group.rotation.y = Math.atan2(dx, dz);
  }

  /**
   * Engine calls this when the AI state machine transitions into chase from
   * a non-chase state. Freezes locomotion for 0.4s and snaps the head down
   * for 80ms — gives the player a clear "you've been seen" tell.
   */
  triggerLungeTelegraph(): void {
    this.telegraphUntil = this.elapsed + 0.4;
    this.currentSpeed = 0;
    this.head.rotation.x = -0.2;
    this.telegraphHeadResetAt = this.elapsed + 0.08;
  }

  /**
   * Per-frame animation update.
   * @param dt              delta time (seconds)
   * @param elapsed         total elapsed seconds (passed for compatibility;
   *                        internal `this.elapsed` advances independently)
   * @param distToPlayer    world-space distance to player
   * @param playerWorldPos  optional player position for head tracking
   */
  update(
    dt: number,
    _elapsed: number,
    distToPlayer: number,
    playerWorldPos?: THREE.Vector3
  ): void {
    if (!this.group.visible) return;
    this.elapsed += dt;

    // Detect actual movement to drive walk-cycle speed (the engine sets
    // group.position directly each frame; we infer speed from the delta).
    const cur = this.group.position;
    let measuredSpeed = 0;
    if (this.lastWorldPosValid) {
      const dxw = cur.x - this.lastWorldPos.x;
      const dzw = cur.z - this.lastWorldPos.z;
      measuredSpeed = Math.hypot(dxw, dzw) / Math.max(dt, 1e-4);
    }
    this.lastWorldPos.copy(cur);
    this.lastWorldPosValid = true;

    // Smooth observed speed so the walk cycle doesn't twitch on path snaps.
    this.currentSpeed = THREE.MathUtils.lerp(
      this.currentSpeed,
      measuredSpeed,
      Math.min(1, dt * 2.5)
    );

    // Lunge-telegraph freeze: head reset, then early-out before bob/sway.
    if (this.elapsed < this.telegraphHeadResetAt) {
      // hold head in jerked pose
    } else if (this.elapsed < this.telegraphUntil) {
      this.head.rotation.x = 0;
    }
    if (this.elapsed < this.telegraphUntil) {
      this.bodyContainer.position.y = 0;
      this.bodyContainer.rotation.z = 0;
      this.animateCloth(this.elapsed, dt);
      this._driveEyes(distToPlayer, dt);
      return;
    }

    // Walk cycle — bob + sway scale with current observed speed. Frequency
    // tracks speed so a faster Observer "marches" rather than gliding.
    this.walkPhase += dt * Math.max(0.3, this.currentSpeed) * 1.5;
    const speedFrac = Math.min(1, this.currentSpeed / 3.2);
    const bob = Math.sin(this.walkPhase * 2) * 0.05 * speedFrac;
    const sway = Math.sin(this.walkPhase) * 0.04 * speedFrac;
    this.bodyContainer.position.y = bob;
    this.bodyContainer.rotation.z = sway;

    // Chest pseudo-breath.
    const breath = Math.sin(this.elapsed * 1.2) * 0.012;
    this.torso.scale.set(1 + breath, 1 - breath * 0.3, 1 + breath);

    // Head tracking — when player is within 8m, head turns toward player
    // clamped to ±60° from body forward.
    if (playerWorldPos && distToPlayer < 8) {
      const dx = playerWorldPos.x - this.group.position.x;
      const dz = playerWorldPos.z - this.group.position.z;
      const targetWorldYaw = Math.atan2(dx, dz);
      let delta = targetWorldYaw - this.group.rotation.y;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      const clamped = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, delta));
      this.headTrackYaw = THREE.MathUtils.lerp(
        this.headTrackYaw,
        clamped,
        Math.min(1, dt * 4)
      );
    } else {
      this.headTrackYaw = THREE.MathUtils.lerp(
        this.headTrackYaw,
        0,
        Math.min(1, dt * 2)
      );
    }
    this.head.rotation.y = this.headTrackYaw;

    // Occasional head twitch (every 6–12s).
    if (this.elapsed > this.nextTwitchAt && this.elapsed > this.twitchUntil) {
      const sign = Math.random() < 0.5 ? -1 : 1;
      this.head.rotation.z = 0.08 + sign * (0.2 + Math.random() * 0.2);
      this.twitchUntil = this.elapsed + 0.08;
      this.nextTwitchAt = this.elapsed + 6 + Math.random() * 6;
    } else if (this.elapsed > this.twitchUntil) {
      this.head.rotation.z = THREE.MathUtils.lerp(
        this.head.rotation.z,
        0.08,
        Math.min(1, dt * 8)
      );
    }

    this.animateCloth(this.elapsed, dt);
    this._driveEyes(distToPlayer, dt);
  }

  /** Sync world-space eye light positions to the (animated) head meshes. */
  syncLights(): void {
    const tmp = new THREE.Vector3();
    this.leftEye.getWorldPosition(tmp);
    this.leftEyeLight.position.copy(tmp);
    this.rightEye.getWorldPosition(tmp);
    this.rightEyeLight.position.copy(tmp);
  }

  dispose(): void {
    this.bodyMat.dispose();
    this.headMat.dispose();
    this.clothMat.dispose();
    this.faceTex?.dispose();
    this.group.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      const m = mesh.material as THREE.Material | undefined;
      if (
        m &&
        m !== this.bodyMat &&
        m !== this.headMat &&
        m !== this.clothMat
      ) {
        m.dispose();
      }
    });
    // Per-instance cloth geometry isn't cached.
    if (this.cloth?.geometry) this.cloth.geometry.dispose();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private _build(shadowsEnabled: boolean): void {
    // Body container holds everything that should bob/sway with the walk
    // cycle. The outer group stays world-aligned so AI position writes
    // remain authoritative.
    const bodyContainer = new THREE.Group();
    bodyContainer.name = "observer_body";
    this.bodyContainer = bodyContainer;
    this.group.add(bodyContainer);

    // Torso — narrow tapered cylinder, tall.
    const torsoGeo = cachedGeo(
      "obs_torso",
      () => new THREE.CylinderGeometry(0.22, 0.32, 1.1, 8, 4)
    );
    this.torso = new THREE.Mesh(torsoGeo, this.bodyMat);
    this.torso.position.y = 1.4;
    this.torso.castShadow = shadowsEnabled;
    bodyContainer.add(this.torso);

    // Head — distorted oversized sphere. Distortion lives on the cached geo
    // so all instances share it; safe because we never mutate again.
    const headGeo = cachedGeo("obs_head", () => {
      const g = new THREE.SphereGeometry(0.22, 14, 12);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const z = pos.getZ(i);
        if (z < 0) pos.setZ(i, z * 0.7); // flatten back of skull
        if (y < 0) pos.setY(i, y * 1.3); // elongate jaw
      }
      pos.needsUpdate = true;
      g.computeVertexNormals();
      return g;
    });
    this.head = new THREE.Mesh(headGeo, this.headMat);
    this.head.position.y = 2.1;
    this.head.rotation.z = 0.08; // perma-tilt
    this.head.castShadow = shadowsEnabled;
    bodyContainer.add(this.head);

    // Hollow eye sockets — recessed black spheres parented to head.
    const socketGeo = cachedGeo(
      "obs_socket",
      () => new THREE.SphereGeometry(0.045, 8, 6)
    );
    const socketMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    for (const side of [-1, 1]) {
      const socket = new THREE.Mesh(socketGeo, socketMat);
      socket.position.set(side * 0.07, 0.04, 0.18);
      this.head.add(socket);
    }

    // Inner emissive eye points (flicker source).
    const eyeGeo = cachedGeo(
      "obs_eye",
      () => new THREE.SphereGeometry(0.018, 6, 4)
    );
    const leftEyeMat = new THREE.MeshBasicMaterial({ color: EYE_RED });
    const rightEyeMat = new THREE.MeshBasicMaterial({ color: EYE_RED });
    this.leftEye = new THREE.Mesh(eyeGeo, leftEyeMat);
    this.leftEye.position.set(-0.07, 0.04, 0.21);
    this.head.add(this.leftEye);
    this.rightEye = new THREE.Mesh(eyeGeo, rightEyeMat);
    this.rightEye.position.set(0.07, 0.04, 0.21);
    this.head.add(this.rightEye);

    // Crooked thin mouth.
    const mouthGeo = cachedGeo(
      "obs_mouth",
      () => new THREE.PlaneGeometry(0.14, 0.012)
    );
    const mouthMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide,
    });
    const mouth = new THREE.Mesh(mouthGeo, mouthMat);
    mouth.position.set(0.01, -0.1, 0.21);
    mouth.rotation.z = 0.15;
    this.head.add(mouth);

    // Subtle "corrupted data" face plane behind the eyes — keeps the
    // residual horror-render texture without competing with the eyes.
    this.faceTex = buildFaceTexture();
    const facePlane = new THREE.Mesh(
      cachedGeo("obs_face", () => new THREE.PlaneGeometry(0.32, 0.32)),
      new THREE.MeshBasicMaterial({
        map: this.faceTex,
        transparent: true,
        opacity: 0.35,
      })
    );
    facePlane.position.set(0, 0, 0.205);
    this.head.add(facePlane);

    // ASYMMETRIC arms — the most important silhouette tell at distance.
    const leftArmGeo = cachedGeo(
      "obs_arm_left",
      () => new THREE.CylinderGeometry(0.05, 0.07, 1.4, 6)
    );
    const leftArm = new THREE.Mesh(leftArmGeo, this.bodyMat);
    leftArm.position.set(-0.28, 1.25, 0);
    leftArm.castShadow = shadowsEnabled;
    bodyContainer.add(leftArm);

    const rightArmGeo = cachedGeo(
      "obs_arm_right",
      () => new THREE.CylinderGeometry(0.05, 0.07, 0.85, 6)
    );
    const rightArm = new THREE.Mesh(rightArmGeo, this.bodyMat);
    rightArm.position.set(0.28, 1.45, 0);
    rightArm.castShadow = shadowsEnabled;
    bodyContainer.add(rightArm);

    // Long thin legs.
    const legGeo = cachedGeo(
      "obs_leg",
      () => new THREE.CylinderGeometry(0.06, 0.08, 1.0, 6)
    );
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, this.bodyMat);
      leg.position.set(side * 0.12, 0.5, 0);
      leg.castShadow = shadowsEnabled;
      bodyContainer.add(leg);
    }

    // Cloth shell — instance-owned geometry because we mutate per-vertex
    // each frame.
    this.cloth = new THREE.Mesh(buildClothGeometry(), this.clothMat);
    this.cloth.position.y = 0.95;
    this.cloth.castShadow = shadowsEnabled;
    bodyContainer.add(this.cloth);

    // Eye lights live on the outer group so syncLights can write world coords.
    this.group.add(this.leftEyeLight);
    this.group.add(this.rightEyeLight);
  }

  private clothNormalsFrame = 0;

  private animateCloth(t: number, _dt: number): void {
    const geo = this.cloth.geometry as THREE.BufferGeometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const base = geo.userData.basePositions as Float32Array | undefined;
    if (!base) return;
    for (let i = 0; i < pos.count; i++) {
      const i3 = i * 3;
      const bx = base[i3];
      const by = base[i3 + 1];
      const bz = base[i3 + 2];
      // y in [-CLOTH_HEIGHT/2, +CLOTH_HEIGHT/2]; remap to [0..1] from top
      // → bottom so the bottom hem flares while the shoulder edge stays put.
      const norm = (CLOTH_HEIGHT / 2 - by) / CLOTH_HEIGHT;
      const strength = norm * 0.06;
      const wave =
        Math.sin(t * 2.4 + by * 3) * strength +
        Math.cos(t * 1.7 + bx * 4) * strength * 0.5;
      pos.setX(i, bx + wave);
      pos.setZ(i, bz + wave * 0.7);
    }
    pos.needsUpdate = true;
    // Recomputing vertex normals every frame is expensive (full vert
    // iteration + cross products) and the cloth material is dark + low-spec
    // so the lighting delta is barely visible. Throttle to every 4th frame.
    if ((this.clothNormalsFrame++ & 3) === 0) {
      geo.computeVertexNormals();
    }
  }

  /**
   * Eye flicker + per-frame dropout, made frame-rate independent so the
   * perceived rate stays the same on 60Hz vs 120Hz refresh rates.
   * Dropout uses `1 - exp(-rate * dt)` to convert a per-second probability
   * into the equivalent per-frame probability.
   */
  private _driveEyes(distToPlayer: number, dt: number): void {
    const baseIntensity = THREE.MathUtils.clamp(1 - distToPlayer / 12, 0, 1);
    // ~1.2 dropouts per second when active, regardless of refresh rate.
    const dropoutProb = 1 - Math.exp(-1.2 * dt);
    const dropout = Math.random() < dropoutProb ? 0 : 1;
    const flicker = (0.5 + 0.5 * Math.sin(this.elapsed * 17)) * 0.3 + 0.7;
    const intensity = baseIntensity * flicker * dropout;
    const r = 0.6 + intensity * 0.4;
    const g = intensity * 0.15;
    const b = intensity * 0.08;
    (this.leftEye.material as THREE.MeshBasicMaterial).color.setRGB(r, g, b);
    (this.rightEye.material as THREE.MeshBasicMaterial).color.setRGB(r, g, b);
    const lightI = 0.25 + baseIntensity * 0.9 * dropout * flicker;
    this.leftEyeLight.intensity = lightI;
    this.rightEyeLight.intensity = lightI * 0.85;
  }
}

export function disposeObserverCache(): void {
  _geoCache.forEach(g => g.dispose());
  _geoCache.clear();
}
