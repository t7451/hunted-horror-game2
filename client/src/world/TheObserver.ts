// client/src/world/TheObserver.ts
// "The Observer" — the AI villain of HUNTED BY THE OBSERVER.
//
// Design concept: a corrupted 3D render of something that was meant to be
// human. Built entirely from Three.js primitives — no GLTF needed.
//
// Visual anatomy:
//   - Tall, thin silhouette (2.4m, 0.45× width — taller than the player)
//   - Arms are WRONG: too long, hanging almost to the floor
//   - Head: angular octahedron, slightly too large, pitched forward
//   - Surface: near-black with cold blue-white emissive edge glow + wireframe
//     overlay — reads as "partially rendered geometry", not flesh
//   - Face: canvas-generated "error data" texture (hex addresses, "PROCESSING")
//   - Eyes: two cold white PointLights that cast real shadows
//   - Glitch: random arm twitch + vertex noise spike every few seconds
//
// What makes it unsettling:
//   - The too-long arms. At distance, the silhouette reads as deeply wrong.
//   - It doesn't bob when it walks. Humans always sway. This doesn't.
//   - The wireframe overlay looks like a half-loaded 3D model.
//   - The face texture looks like corrupted memory being read aloud.

import * as THREE from "three";

const COLD_DARK = 0x020406;
const COLD_EMISSIVE = 0x0a1828;
const WIRE_COLOR = 0x1a4a6a;
const EYE_COLOR = 0xd0eeff;

// Shared geometry/material cache so multiple instances don't re-allocate
const _geoCache = new Map<string, THREE.BufferGeometry>();
const _matCache = new Map<string, THREE.Material>();

function cachedGeo<T extends THREE.BufferGeometry>(key: string, factory: () => T): T {
  if (!_geoCache.has(key)) _geoCache.set(key, factory());
  return _geoCache.get(key) as T;
}

function buildSolidMat(color: number, emissive: number, emissiveIntensity: number, opacity = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity,
    roughness: 0.95,
    metalness: 0.05,
    transparent: opacity < 1,
    opacity,
  });
}

function buildWireMat(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: WIRE_COLOR,
    wireframe: true,
    transparent: true,
    opacity: 0.28,
  });
}

function buildFaceTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#010204";
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = "#0d2a3a";
  ctx.font = "7px monospace";
  const lines = [
    "PROC 0x1F4A",
    "ERR: 0xDEAD",
    "READ 0x00FF",
    ">> FOUND",
    "SYS ALERT",
    "0x4F 0x62",
    "0x73 0x65",
    "WATCHING",
    "0xCALC..",
    "ERR: NULL",
    ">> TARGET",
    "LOCK 0x01",
    "DIST 0.00",
    "0xFF 0x2B",
    "PROC KILL",
    ">> CAUGHT",
  ];
  lines.forEach((line, i) => {
    ctx.fillStyle = i % 3 === 0 ? "#1a4a5a" : "#0a2030";
    ctx.fillText(line, 4, 12 + i * 7);
  });

  // Evil smile — a wide, jagged grin carved across the lower half of the face.
  // Drawn before the scanline overlay so the scanlines still cross the teeth,
  // keeping it consistent with the "corrupted render" aesthetic.
  const cx = size / 2;
  const mouthY = size * 0.66;
  const mouthHalfW = size * 0.4;
  const mouthCurve = size * 0.18; // upward curve at the corners → evil grin

  // Mouth gum/cavity — dark blood-tinged red glow
  ctx.save();
  ctx.beginPath();
  // Top lip: upward-bowed line so corners pull up cruelly
  ctx.moveTo(cx - mouthHalfW, mouthY);
  ctx.quadraticCurveTo(cx, mouthY + mouthCurve * 0.55, cx + mouthHalfW, mouthY);
  // Bottom lip: deeper downward curve to give the mouth height
  ctx.quadraticCurveTo(cx, mouthY + mouthCurve * 1.9, cx - mouthHalfW, mouthY);
  ctx.closePath();
  ctx.fillStyle = "#3a0408";
  ctx.fill();
  // Faint inner glow
  ctx.fillStyle = "rgba(140, 20, 30, 0.35)";
  ctx.fill();
  ctx.clip();

  // Jagged teeth — uneven triangular shards, top and bottom rows
  const toothCount = 11;
  const toothW = (mouthHalfW * 2) / toothCount;
  ctx.fillStyle = "#d8d4c4";
  for (let i = 0; i < toothCount; i++) {
    const x = cx - mouthHalfW + i * toothW;
    // Top teeth point downward
    const topH = toothW * (1.1 + (i % 3) * 0.25);
    ctx.beginPath();
    ctx.moveTo(x, mouthY - 1);
    ctx.lineTo(x + toothW * 0.5, mouthY + topH);
    ctx.lineTo(x + toothW, mouthY - 1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = "#b8b2a0";
  for (let i = 0; i < toothCount - 1; i++) {
    const x = cx - mouthHalfW + (i + 0.5) * toothW;
    // Bottom teeth point upward, smaller and more uneven
    const botH = toothW * (0.7 + (i % 4) * 0.2);
    const botBase = mouthY + mouthCurve * 1.7;
    ctx.beginPath();
    ctx.moveTo(x, botBase);
    ctx.lineTo(x + toothW * 0.5, botBase - botH);
    ctx.lineTo(x + toothW, botBase);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Mouth outline — thin cold line so the grin reads at distance
  ctx.strokeStyle = "#0a0204";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - mouthHalfW, mouthY);
  ctx.quadraticCurveTo(cx, mouthY + mouthCurve * 0.55, cx + mouthHalfW, mouthY);
  ctx.stroke();

  // Scanline overlay
  for (let y = 0; y < size; y += 2) {
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(0, y, size, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

type LimbRef = {
  mesh: THREE.Mesh;
  baseRotation: THREE.Euler;
  glitchTimer: number;
  glitchDuration: number;
  targetRotation: THREE.Euler;
};

export class TheObserver {
  readonly group: THREE.Group;

  // Exposed so engine.ts can add to ShadowBudget / scene
  readonly leftEyeLight: THREE.PointLight;
  readonly rightEyeLight: THREE.PointLight;

  private solidMat: THREE.MeshStandardMaterial;
  private wireMat: THREE.MeshBasicMaterial;

  private leftArm!: LimbRef;
  private rightArm!: LimbRef;
  private headPivot!: THREE.Group;
  private emissiveIntensityBase = 0.6;

  private glitchAccum = 0;
  private nextGlitch = 2.5;

  constructor(shadowsEnabled: boolean) {
    this.group = new THREE.Group();

    this.solidMat = buildSolidMat(COLD_DARK, COLD_EMISSIVE, this.emissiveIntensityBase);
    this.wireMat = buildWireMat();

    this.leftEyeLight = new THREE.PointLight(EYE_COLOR, 0.45, 7, 2);
    this.leftEyeLight.castShadow = shadowsEnabled;
    this.rightEyeLight = new THREE.PointLight(EYE_COLOR, 0.45, 7, 2);
    this.rightEyeLight.castShadow = shadowsEnabled;

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
  }

  lookAt(x: number, y: number, z: number): void {
    this.group.lookAt(x, y, z);
  }

  /**
   * Per-frame animation update.
   * @param dt        delta time (seconds)
   * @param elapsed   total elapsed time (seconds)
   * @param distToPlayer  world-space distance to player (for proximity effects)
   */
  update(dt: number, elapsed: number, distToPlayer: number): void {
    if (!this.group.visible) return;

    // Proximity-scaled emissive intensity — pulses faster when close
    const proxFactor = Math.max(0, 1 - distToPlayer / 20);
    const pulse = Math.sin(elapsed * (1.8 + proxFactor * 3.5)) * 0.15 + 0.85;
    this.solidMat.emissiveIntensity = this.emissiveIntensityBase * pulse * (1 + proxFactor * 0.6);

    // Eye light intensity
    const eyeBase = 0.35 + proxFactor * 0.55;
    const eyeFlicker = Math.sin(elapsed * 11.3) * 0.04 + Math.sin(elapsed * 7.7) * 0.03;
    this.leftEyeLight.intensity = eyeBase + eyeFlicker;
    this.rightEyeLight.intensity = eyeBase + eyeFlicker * 0.8;

    // Wireframe opacity ramps up with proximity
    this.wireMat.opacity = 0.18 + proxFactor * 0.22;

    // Head tracks slightly toward player even when body is turning
    if (this.headPivot) {
      const headTilt = Math.sin(elapsed * 0.4) * 0.06;
      this.headPivot.rotation.z = headTilt * (1 + proxFactor);
      // Slight forward lean as if peering at something on the ground
      this.headPivot.rotation.x = 0.12 + proxFactor * 0.08;
    }

    // Glitch — random arm twitch
    this.glitchAccum += dt;
    this._updateLimb(this.leftArm, dt);
    this._updateLimb(this.rightArm, dt);

    if (this.glitchAccum >= this.nextGlitch) {
      this.glitchAccum = 0;
      this.nextGlitch = 1.5 + Math.random() * (4 - proxFactor * 2.5);
      this._triggerGlitch();
    }
  }

  /**
   * Sync world-space eye light positions each frame (called after group
   * position/rotation is updated by the engine).
   */
  syncLights(): void {
    const worldPos = new THREE.Vector3();
    this.leftEyeLight.position.copy(
      this.group.localToWorld(worldPos.set(-0.14, 2.2, -0.22))
    );
    this.rightEyeLight.position.copy(
      this.group.localToWorld(worldPos.set(0.14, 2.2, -0.22))
    );
  }

  dispose(): void {
    this.solidMat.dispose();
    this.wireMat.dispose();
    this.group.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const m = mesh.material as THREE.Material | undefined;
      if (m && m !== this.solidMat && m !== this.wireMat) m.dispose();
    });
  }

  // ── Construction ──────────────────────────────────────────────────────────

  private _build(shadowsEnabled: boolean): void {
    const mat = this.solidMat;
    const wire = this.wireMat;

    const addPair = (geo: THREE.BufferGeometry, pos: THREE.Vector3, rot?: THREE.Euler, scl?: THREE.Vector3) => {
      const solid = new THREE.Mesh(geo, mat);
      const wireframe = new THREE.Mesh(geo, wire);
      solid.castShadow = shadowsEnabled;
      solid.receiveShadow = false;
      if (rot) { solid.rotation.copy(rot); wireframe.rotation.copy(rot); }
      if (scl) { solid.scale.copy(scl); wireframe.scale.copy(scl); }
      const g = new THREE.Group();
      g.add(solid, wireframe);
      g.position.copy(pos);
      this.group.add(g);
      return g;
    };

    // Legs
    const legGeo = cachedGeo("leg", () => new THREE.CylinderGeometry(0.075, 0.06, 0.82, 8));
    addPair(legGeo, new THREE.Vector3(-0.12, 0.41, 0));
    addPair(legGeo, new THREE.Vector3(0.12, 0.41, 0));

    // Torso (narrow, tall)
    const torsoGeo = cachedGeo("torso", () => new THREE.BoxGeometry(0.42, 1.08, 0.18));
    addPair(torsoGeo, new THREE.Vector3(0, 1.36, 0));

    // Shoulders (thin bar across the top of torso)
    const shoulderGeo = cachedGeo("shoulder", () => new THREE.CylinderGeometry(0.045, 0.045, 0.62, 6));
    addPair(shoulderGeo, new THREE.Vector3(0, 1.9, 0), new THREE.Euler(0, 0, Math.PI / 2));

    // Arms — grotesquely long (tip at y ≈ 0.08 from floor)
    const armGeo = cachedGeo("arm", () => new THREE.CylinderGeometry(0.04, 0.03, 1.72, 6));
    const leftArmGroup = addPair(armGeo, new THREE.Vector3(-0.31, 1.04, 0));
    const rightArmGroup = addPair(armGeo, new THREE.Vector3(0.31, 1.04, 0));

    const leftArmMesh = leftArmGroup.children[0] as THREE.Mesh;
    const rightArmMesh = rightArmGroup.children[0] as THREE.Mesh;
    const baseRotL = new THREE.Euler(0, 0, 0.12);
    const baseRotR = new THREE.Euler(0, 0, -0.12);

    this.leftArm = {
      mesh: leftArmMesh,
      baseRotation: baseRotL.clone(),
      glitchTimer: 0,
      glitchDuration: 0,
      targetRotation: baseRotL.clone(),
    };
    this.rightArm = {
      mesh: rightArmMesh,
      baseRotation: baseRotR.clone(),
      glitchTimer: 0,
      glitchDuration: 0,
      targetRotation: baseRotR.clone(),
    };

    // Head — angular octahedron (not round = not human)
    const headGeo = cachedGeo("head", () => new THREE.OctahedronGeometry(0.24, 1));
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 2.14, 0);
    headPivot.rotation.x = 0.12; // pitched forward

    const headSolid = new THREE.Mesh(headGeo, mat);
    headSolid.castShadow = shadowsEnabled;
    headSolid.scale.set(1, 1.22, 0.88);
    const headWire = new THREE.Mesh(headGeo, wire);
    headWire.scale.copy(headSolid.scale);
    headPivot.add(headSolid, headWire);
    this.group.add(headPivot);
    this.headPivot = headPivot;

    // Face plane (data texture)
    const faceTex = buildFaceTexture();
    const faceMat = new THREE.MeshBasicMaterial({
      map: faceTex,
      transparent: true,
      opacity: 0.7,
    });
    const facePlane = new THREE.Mesh(
      cachedGeo("face", () => new THREE.PlaneGeometry(0.28, 0.26)),
      faceMat
    );
    facePlane.position.set(0, 0, -0.24);
    headPivot.add(facePlane);

    // Eye lights — parented to scene in engine.ts via syncLights()
    this.group.add(this.leftEyeLight);
    this.group.add(this.rightEyeLight);
    this.leftEyeLight.position.set(-0.14, 2.2, -0.22);
    this.rightEyeLight.position.set(0.14, 2.2, -0.22);
  }

  private _triggerGlitch(): void {
    // Randomly glitch one arm — snap to a raised or splayed position for 0.1–0.3s
    const arm = Math.random() < 0.5 ? this.leftArm : this.rightArm;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const glitchMag = (Math.random() * 0.6 + 0.3) * dir;
    arm.targetRotation = new THREE.Euler(
      arm.baseRotation.x + glitchMag,
      arm.baseRotation.y,
      arm.baseRotation.z
    );
    arm.glitchDuration = 0.08 + Math.random() * 0.22;
    arm.glitchTimer = arm.glitchDuration;
  }

  private _updateLimb(limb: LimbRef, dt: number): void {
    if (limb.glitchTimer > 0) {
      limb.glitchTimer -= dt;
      if (limb.glitchTimer <= 0) {
        limb.targetRotation = limb.baseRotation.clone();
      }
    }
    // Lerp rotation toward target (snap speed = 20/s)
    limb.mesh.rotation.x = THREE.MathUtils.lerp(
      limb.mesh.rotation.x,
      limb.targetRotation.x,
      Math.min(1, dt * 20)
    );
  }
}

export function disposeObserverCache(): void {
  _geoCache.forEach(g => g.dispose());
  _geoCache.clear();
  _matCache.forEach(m => m.dispose());
  _matCache.clear();
}
