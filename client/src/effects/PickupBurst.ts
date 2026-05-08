// client/src/effects/PickupBurst.ts
// One-shot particle burst + expanding ring when the player collects a key.
// Adds visible feedback to a moment that was previously silent for the
// renderer (the audio fires, but the mesh just disappeared).
//
// Each burst is allocated when the key is collected and disposes itself
// once the longest-lived element (the ring) finishes. The engine keeps a
// flat array of active bursts and ticks them per frame.

import * as THREE from "three";

const PARTICLE_COUNT = 16;
const LIFETIME = 0.8;
const PARTICLE_SIZE = 0.04;

type Particle = {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  born: number;
};

export class PickupBurst {
  private particles: Particle[] = [];
  private ring: THREE.Mesh;
  private ringBorn: number;
  private group = new THREE.Group();
  private done = false;

  constructor(
    scene: THREE.Scene,
    x: number,
    y: number,
    z: number,
    color = 0xffd966,
  ) {
    this.group.position.set(x, y, z);
    scene.add(this.group);

    const partGeo = new THREE.SphereGeometry(PARTICLE_SIZE, 4, 3);
    const partMatProto = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
    });
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
      const elevation = Math.random() * Math.PI - Math.PI / 2;
      const speed = 1.5 + Math.random() * 1.5;
      const m = new THREE.Mesh(partGeo, partMatProto.clone());
      this.group.add(m);
      this.particles.push({
        mesh: m,
        vx: Math.cos(angle) * Math.cos(elevation) * speed,
        vy: Math.sin(elevation) * speed + 1.5,
        vz: Math.sin(angle) * Math.cos(elevation) * speed,
        born: performance.now(),
      });
    }
    // The shared particle geometry is referenced by all 16 meshes; we
    // intentionally don't dispose the prototype material — each clone is
    // disposed individually in dispose().

    const ringGeo = new THREE.RingGeometry(0.08, 0.12, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.group.add(this.ring);
    this.ringBorn = performance.now();
  }

  /** Returns true when the burst is done and should be disposed. */
  update(dt: number): boolean {
    const now = performance.now();
    for (const p of this.particles) {
      const age = (now - p.born) / 1000;
      if (age > LIFETIME) continue;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.vy -= 6 * dt; // gravity
      const t = age / LIFETIME;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t;
    }
    const ringAge = (now - this.ringBorn) / 1000;
    if (ringAge < LIFETIME) {
      const t = ringAge / LIFETIME;
      this.ring.scale.setScalar(1 + t * 12);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.9;
    }
    if (now - this.ringBorn > LIFETIME * 1000 + 200) {
      this.done = true;
      return true;
    }
    return false;
  }

  isDone(): boolean {
    return this.done;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.group.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
  }
}
