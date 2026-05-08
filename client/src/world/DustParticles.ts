import * as THREE from "three";

// Drifting dust motes. Spec §10 polish punch-list calls for ~200 particles
// in lit volumes with additive blending. We render them as a single Points
// object so the cost is one draw call regardless of count, and animate
// positions on the CPU since that's still <1ms for 200 verts.
//
// Particles wrap inside an axis-aligned box centered on the player so we
// always see motes around the camera even though the actual particle
// population is tiny.

export type DustParticlesOptions = {
  count?: number;
  /** Size of the AABB the particles wrap inside, in meters. */
  volume?: THREE.Vector3;
  color?: number;
  /** Particle screen-space size in pixels-ish units (PointsMaterial.size). */
  size?: number;
  /** Drift speed in m/s. */
  speed?: number;
};

const DEFAULT_VOLUME = new THREE.Vector3(20, 4, 20);

/**
 * Build a small soft-circle sprite once and share it across all DustParticles
 * instances. Without this, PointsMaterial renders motes as hard square white
 * pixels — exactly the "white spec" look we want to avoid. The radial alpha
 * gradient gives motes a soft glow that blends into the lit volumes.
 */
let sharedSpriteTexture: THREE.Texture | null = null;
function getSpriteTexture(): THREE.Texture {
  if (sharedSpriteTexture) return sharedSpriteTexture;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // Extremely rare (no 2D canvas support). Return an empty texture rather
    // than throwing — the engine will still render points, just without the
    // soft-sprite improvement.
    sharedSpriteTexture = new THREE.Texture();
    return sharedSpriteTexture;
  }
  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  // Warm white core fading smoothly to fully transparent at the rim.
  grad.addColorStop(0.0, "rgba(255, 248, 230, 1.0)");
  grad.addColorStop(0.25, "rgba(255, 240, 210, 0.65)");
  grad.addColorStop(0.55, "rgba(255, 230, 190, 0.18)");
  grad.addColorStop(1.0, "rgba(255, 220, 180, 0.0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  sharedSpriteTexture = tex;
  return tex;
}

export class DustParticles {
  private readonly points: THREE.Points;
  private readonly geom: THREE.BufferGeometry;
  private readonly mat: THREE.PointsMaterial;
  private readonly count: number;
  private readonly volume: THREE.Vector3;
  private readonly halfVolume: THREE.Vector3;
  private readonly speed: number;
  private readonly velocities: Float32Array;
  /** Per-particle size scale so motes aren't all uniform. */
  private readonly sizes: Float32Array;
  /** Reused per-frame Vector3 to avoid alloc churn at 60Hz. */
  private readonly tmpCamPos = new THREE.Vector3();

  constructor(scene: THREE.Scene, opts: DustParticlesOptions = {}) {
    this.count = opts.count ?? 200;
    this.volume = (opts.volume ?? DEFAULT_VOLUME).clone();
    this.halfVolume = this.volume.clone().multiplyScalar(0.5);
    this.speed = opts.speed ?? 0.08;

    const positions = new Float32Array(this.count * 3);
    this.velocities = new Float32Array(this.count * 3);
    this.sizes = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * this.volume.x;
      positions[i * 3 + 1] = (Math.random() - 0.5) * this.volume.y;
      positions[i * 3 + 2] = (Math.random() - 0.5) * this.volume.z;
      // Slow drift, biased upward so motes feel like they're floating.
      this.velocities[i * 3 + 0] = (Math.random() - 0.5) * this.speed;
      this.velocities[i * 3 + 1] = (Math.random() * 0.3 + 0.1) * this.speed;
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * this.speed;
      // Vary mote size between ~0.4× and ~1.4× of the base size for a more
      // organic look — uniform sprites read as "specks", varied ones as dust.
      this.sizes[i] = 0.4 + Math.random() * 1.0;
    }

    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.geom.setAttribute("aScale", new THREE.BufferAttribute(this.sizes, 1));
    // Note: per-particle aScale (0.4–1.4) effectively scales each mote, so
    // the base size here is the average mote size before that multiplier.
    const baseSize = opts.size ?? 0.04;
    this.mat = new THREE.PointsMaterial({
      color: opts.color ?? 0xffe8c4,
      size: baseSize,
      map: getSpriteTexture(),
      transparent: true,
      // Lower opacity + soft sprite removes the harsh "white pixel" look.
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      // Discard fully transparent fragments to avoid square halos when
      // additively blending with bright surfaces.
      alphaTest: 0.01,
    });
    // Apply the per-particle size attribute by multiplying gl_PointSize in the
    // material's vertex shader. This keeps us on the cheap built-in
    // PointsMaterial pipeline while still varying per-mote size.
    this.mat.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "void main() {",
          "attribute float aScale;\nvoid main() {",
        )
        .replace("gl_PointSize = size;", "gl_PointSize = size * aScale;");
    };
    this.points = new THREE.Points(this.geom, this.mat);
    this.points.frustumCulled = false; // we wrap around the camera each frame
    this.points.name = "dust";
    // Render after opaque geometry so additive blending composites correctly.
    this.points.renderOrder = 2;
    scene.add(this.points);
  }

  /**
   * Per-frame: drift each particle by its velocity, wrap any that escape
   * the AABB centered on the camera. Cheap — 200 particles × 3 axes.
   */
  update(dt: number, camera: THREE.Camera): void {
    const camPos = camera.getWorldPosition(this.tmpCamPos);
    this.points.position.copy(camPos);

    const arr = this.geom.attributes.position.array as Float32Array;
    const v = this.velocities;
    const hx = this.halfVolume.x;
    const hy = this.halfVolume.y;
    const hz = this.halfVolume.z;
    for (let i = 0; i < this.count; i++) {
      arr[i * 3 + 0] += v[i * 3 + 0] * dt;
      arr[i * 3 + 1] += v[i * 3 + 1] * dt;
      arr[i * 3 + 2] += v[i * 3 + 2] * dt;
      // Wrap on each axis — keeps motes always in view of the player.
      if (arr[i * 3 + 0] > hx) arr[i * 3 + 0] -= this.volume.x;
      else if (arr[i * 3 + 0] < -hx) arr[i * 3 + 0] += this.volume.x;
      if (arr[i * 3 + 1] > hy) arr[i * 3 + 1] -= this.volume.y;
      else if (arr[i * 3 + 1] < -hy) arr[i * 3 + 1] += this.volume.y;
      if (arr[i * 3 + 2] > hz) arr[i * 3 + 2] -= this.volume.z;
      else if (arr[i * 3 + 2] < -hz) arr[i * 3 + 2] += this.volume.z;
    }
    this.geom.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geom.dispose();
    this.mat.dispose();
  }
}
