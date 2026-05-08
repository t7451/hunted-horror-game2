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
const CRACK_RED = 0xff3a20;
const AURA_DARK = 0x060608;

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

  ctx.strokeStyle = "rgba(255,45,24,0.22)";
  ctx.lineWidth = 1;
  const cracks = [
    [
      [57, 21],
      [53, 38],
      [61, 52],
      [55, 71],
    ],
    [
      [75, 26],
      [82, 41],
      [77, 60],
      [86, 82],
    ],
    [
      [66, 72],
      [60, 86],
      [68, 101],
    ],
  ];
  for (const crack of cracks) {
    ctx.beginPath();
    crack.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildSmokeTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);

  const gradients: Array<[number, number, number, number]> = [
    [38, 42, 34, 0.3],
    [84, 52, 42, 0.24],
    [56, 90, 48, 0.2],
    [102, 94, 30, 0.16],
    [28, 104, 24, 0.14],
  ];
  for (const [x, y, radius, alpha] of gradients) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, `rgba(0,0,0,${alpha})`);
    g.addColorStop(0.58, `rgba(0,0,0,${alpha * 0.42})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  for (let i = 0; i < 40; i++) {
    const x = (i * 37) % size;
    const y = (i * 53) % size;
    const a = 0.025 + ((i * 11) % 9) * 0.004;
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.fillRect(x, y, 1 + (i % 3), 1 + ((i + 1) % 3));
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
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
  private smokeTex?: THREE.CanvasTexture;
  private bodyContainer!: THREE.Group;
  private auraPlanes: THREE.Mesh[] = [];
  private tendrils: THREE.Mesh[] = [];
  private crackMats: THREE.MeshBasicMaterial[] = [];
  private auraMats: THREE.MeshBasicMaterial[] = [];
  private glitchMats: THREE.MeshBasicMaterial[] = [];

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
      emissive: 0x130202,
      emissiveIntensity: 0.18,
      roughness: 0.95,
      metalness: 0,
    });
    this.headMat = new THREE.MeshStandardMaterial({
      color: HEAD_DARK,
      emissive: 0x160202,
      emissiveIntensity: 0.12,
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
      this._animatePresence(distToPlayer, dt);
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
    this._animatePresence(distToPlayer, dt);
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
    this.smokeTex?.dispose();
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

    const chestCrackGeo = cachedGeo(
      "obs_chest_crack_long",
      () => new THREE.PlaneGeometry(0.024, 0.34)
    );
    const chestCrackShortGeo = cachedGeo(
      "obs_chest_crack_short",
      () => new THREE.PlaneGeometry(0.018, 0.18)
    );
    const chestCracks = [
      { geo: chestCrackGeo, x: -0.045, y: 0.16, z: 0.326, rz: -0.24, o: 0.5 },
      {
        geo: chestCrackShortGeo,
        x: 0.035,
        y: 0.02,
        z: 0.323,
        rz: 0.34,
        o: 0.38,
      },
      { geo: chestCrackShortGeo, x: 0.0, y: -0.18, z: 0.31, rz: -0.48, o: 0.3 },
    ];
    for (const c of chestCracks) {
      const mat = new THREE.MeshBasicMaterial({
        color: CRACK_RED,
        transparent: true,
        opacity: c.o,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      mat.userData.baseOpacity = c.o;
      this.crackMats.push(mat);
      const crack = new THREE.Mesh(c.geo, mat);
      crack.position.set(c.x, c.y, c.z);
      crack.rotation.z = c.rz;
      crack.renderOrder = 4;
      this.torso.add(crack);
    }

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

    const eyeRingGeo = cachedGeo(
      "obs_eye_ring",
      () => new THREE.TorusGeometry(0.036, 0.004, 5, 10)
    );
    const eyeShardGeo = cachedGeo(
      "obs_eye_glitch_shard",
      () => new THREE.PlaneGeometry(0.055, 0.007)
    );
    for (const side of [-1, 1]) {
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xff4a24,
        transparent: true,
        opacity: 0.58,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      ringMat.userData.baseOpacity = 0.58;
      this.glitchMats.push(ringMat);
      const ring = new THREE.Mesh(eyeRingGeo, ringMat);
      ring.position.set(side * 0.07, 0.04, 0.214);
      ring.scale.y = 0.68;
      ring.renderOrder = 5;
      this.head.add(ring);

      for (let i = 0; i < 2; i++) {
        const shardMat = new THREE.MeshBasicMaterial({
          color: i === 0 ? 0xff2918 : 0xff8a38,
          transparent: true,
          opacity: 0.38,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        shardMat.userData.baseOpacity = 0.38;
        this.glitchMats.push(shardMat);
        const shard = new THREE.Mesh(eyeShardGeo, shardMat);
        shard.position.set(
          side * (0.085 + i * 0.014),
          0.07 - i * 0.065,
          0.222 + i * 0.002
        );
        shard.rotation.z = side * (0.3 + i * 0.25);
        shard.renderOrder = 6;
        this.head.add(shard);
      }
    }

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

    const faceCrackGeo = cachedGeo(
      "obs_face_crack",
      () => new THREE.PlaneGeometry(0.012, 0.15)
    );
    const faceCracks = [
      { x: -0.026, y: 0.09, rz: -0.28, o: 0.5 },
      { x: 0.046, y: 0.025, rz: 0.24, o: 0.42 },
      { x: -0.004, y: -0.088, rz: -0.42, o: 0.32 },
    ];
    for (const c of faceCracks) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff5230,
        transparent: true,
        opacity: c.o,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      mat.userData.baseOpacity = c.o;
      this.crackMats.push(mat);
      const crack = new THREE.Mesh(faceCrackGeo, mat);
      crack.position.set(c.x, c.y, 0.226);
      crack.rotation.z = c.rz;
      crack.renderOrder = 7;
      this.head.add(crack);
    }

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

    const shoulderSpikeGeo = cachedGeo(
      "obs_shoulder_spike",
      () => new THREE.ConeGeometry(0.048, 0.46, 5, 1)
    );
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const spike = new THREE.Mesh(shoulderSpikeGeo, this.bodyMat);
        spike.position.set(
          side * (0.2 + i * 0.055),
          1.84 - i * 0.04,
          -0.04 + i * 0.08
        );
        spike.rotation.z = -side * (0.78 + i * 0.12);
        spike.rotation.x = (i - 1) * 0.24;
        spike.scale.setScalar(1 - i * 0.12);
        spike.castShadow = shadowsEnabled;
        bodyContainer.add(spike);
      }
    }

    const tendrilGeo = cachedGeo(
      "obs_back_tendril",
      () => new THREE.ConeGeometry(0.032, 0.78, 5, 1)
    );
    const tendrilSpecs = [
      { x: -0.18, y: 1.58, z: -0.18, rx: -1.08, rz: 0.22, s: 1.0 },
      { x: 0.0, y: 1.72, z: -0.2, rx: -0.92, rz: -0.08, s: 0.86 },
      { x: 0.17, y: 1.5, z: -0.17, rx: -1.2, rz: -0.2, s: 0.92 },
      { x: -0.06, y: 1.28, z: -0.18, rx: -1.34, rz: 0.06, s: 0.74 },
    ];
    for (const spec of tendrilSpecs) {
      const tendril = new THREE.Mesh(tendrilGeo, this.bodyMat);
      tendril.position.set(spec.x, spec.y, spec.z);
      tendril.rotation.set(spec.rx, 0, spec.rz);
      tendril.scale.setScalar(spec.s);
      tendril.castShadow = shadowsEnabled;
      tendril.userData.baseRotX = spec.rx;
      tendril.userData.baseRotZ = spec.rz;
      this.tendrils.push(tendril);
      bodyContainer.add(tendril);
    }

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

    this.smokeTex = buildSmokeTexture();
    const auraGeo = cachedGeo(
      "obs_shadow_aura",
      () => new THREE.PlaneGeometry(1.85, 2.55, 1, 1)
    );
    const auraRotations = [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4];
    auraRotations.forEach((rot, i) => {
      const mat = new THREE.MeshBasicMaterial({
        color: AURA_DARK,
        map: this.smokeTex,
        transparent: true,
        opacity: 0.16 - i * 0.018,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      mat.userData.baseOpacity = 0.16 - i * 0.018;
      this.auraMats.push(mat);
      const aura = new THREE.Mesh(auraGeo, mat);
      aura.position.y = 1.16;
      aura.rotation.y = rot;
      aura.scale.set(0.86 + i * 0.05, 1, 0.86 + i * 0.05);
      aura.renderOrder = 1;
      aura.userData.baseRotY = rot;
      aura.userData.baseScale = 0.86 + i * 0.05;
      this.auraPlanes.push(aura);
      bodyContainer.add(aura);
    });

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

  private _animatePresence(distToPlayer: number, _dt: number): void {
    const proximity = THREE.MathUtils.clamp(1 - distToPlayer / 12, 0, 1);
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 5.3);
    const slowPulse = 0.5 + 0.5 * Math.sin(this.elapsed * 1.7 + 0.6);

    this.bodyMat.emissiveIntensity = 0.14 + proximity * 0.16 + pulse * 0.035;
    this.headMat.emissiveIntensity = 0.1 + proximity * 0.2 + pulse * 0.05;

    this.crackMats.forEach((mat, i) => {
      const base = (mat.userData.baseOpacity as number | undefined) ?? 0.4;
      const stagger = 0.5 + 0.5 * Math.sin(this.elapsed * (6.5 + i * 0.4) + i);
      mat.opacity = Math.min(
        0.88,
        base * (0.68 + stagger * 0.34) + proximity * 0.12
      );
    });

    this.glitchMats.forEach((mat, i) => {
      const base = (mat.userData.baseOpacity as number | undefined) ?? 0.4;
      const jitter = 0.5 + 0.5 * Math.sin(this.elapsed * (14 + i) + i * 2.3);
      mat.opacity = Math.min(
        0.82,
        base * (0.42 + jitter * 0.5) + proximity * 0.18
      );
    });

    if (this.smokeTex) {
      this.smokeTex.offset.x = Math.sin(this.elapsed * 0.19) * 0.035;
      this.smokeTex.offset.y = (this.elapsed * 0.028) % 1;
    }

    this.auraMats.forEach((mat, i) => {
      const base = (mat.userData.baseOpacity as number | undefined) ?? 0.12;
      const ripple = 0.5 + 0.5 * Math.sin(this.elapsed * (1.3 + i * 0.18) + i);
      mat.opacity = base * (0.58 + proximity * 0.95 + ripple * 0.22);
    });

    this.auraPlanes.forEach((aura, i) => {
      const baseRotY = (aura.userData.baseRotY as number | undefined) ?? 0;
      const baseScale = (aura.userData.baseScale as number | undefined) ?? 1;
      aura.rotation.y = baseRotY + Math.sin(this.elapsed * 0.42 + i) * 0.035;
      aura.position.y = 1.13 + Math.sin(this.elapsed * 1.1 + i * 0.7) * 0.045;
      aura.scale.set(
        baseScale + slowPulse * 0.08 + proximity * 0.05,
        1.02 + pulse * 0.08,
        1
      );
    });

    this.tendrils.forEach((tendril, i) => {
      const baseRotX = (tendril.userData.baseRotX as number | undefined) ?? 0;
      const baseRotZ = (tendril.userData.baseRotZ as number | undefined) ?? 0;
      tendril.rotation.x = baseRotX + Math.sin(this.elapsed * 1.9 + i) * 0.045;
      tendril.rotation.z =
        baseRotZ + Math.cos(this.elapsed * 1.4 + i * 1.7) * 0.035;
    });
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
    const eyeScale = 0.85 + intensity * 0.55;
    this.leftEye.scale.setScalar(eyeScale);
    this.rightEye.scale.setScalar(eyeScale * 0.92);
    const lightI = 0.25 + baseIntensity * 0.9 * dropout * flicker;
    this.leftEyeLight.intensity = lightI;
    this.rightEyeLight.intensity = lightI * 0.85;
  }
}

export function disposeObserverCache(): void {
  _geoCache.forEach(g => g.dispose());
  _geoCache.clear();
}
