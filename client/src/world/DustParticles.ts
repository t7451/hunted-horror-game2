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

export class DustParticles {
  private readonly points: THREE.Points;
  private readonly geom: THREE.BufferGeometry;
  private readonly mat: THREE.PointsMaterial;
  private readonly count: number;
  private readonly volume: THREE.Vector3;
  private readonly halfVolume: THREE.Vector3;
  private readonly speed: number;
  private readonly velocities: Float32Array;
  /** Reused per-frame Vector3 to avoid alloc churn at 60Hz. */
  private readonly tmpCamPos = new THREE.Vector3();

  constructor(scene: THREE.Scene, opts: DustParticlesOptions = {}) {
    this.count = opts.count ?? 200;
    this.volume = (opts.volume ?? DEFAULT_VOLUME).clone();
    this.halfVolume = this.volume.clone().multiplyScalar(0.5);
    this.speed = opts.speed ?? 0.08;

    const positions = new Float32Array(this.count * 3);
    this.velocities = new Float32Array(this.count * 3);
    for (let i = 0; i < this.count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * this.volume.x;
      positions[i * 3 + 1] = (Math.random() - 0.5) * this.volume.y;
      positions[i * 3 + 2] = (Math.random() - 0.5) * this.volume.z;
      // Slow drift, biased upward so motes feel like they're floating.
      this.velocities[i * 3 + 0] = (Math.random() - 0.5) * this.speed;
      this.velocities[i * 3 + 1] = (Math.random() * 0.3 + 0.1) * this.speed;
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * this.speed;
    }

    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.mat = new THREE.PointsMaterial({
      color: opts.color ?? 0xfff0d0,
      size: opts.size ?? 0.04,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geom, this.mat);
    this.points.frustumCulled = false; // we wrap around the camera each frame
    this.points.name = "dust";
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
