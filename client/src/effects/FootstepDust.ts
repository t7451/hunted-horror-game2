// client/src/effects/FootstepDust.ts
// Tiny dust kicks under each footstep on dusty surfaces (wood / creaky).
// Each spawn is a small InstancedMesh of 6 spheres flying outward + up
// with gravity, fading out over ~0.9s. The engine ticks active bursts and
// disposes them when the lifetime elapses.
//
// Disabled in battery-saver mode (the engine guards spawn() before
// calling); rebuilds nothing per-frame so the only ongoing cost is the
// matrix updates inside update().

import * as THREE from "three";

const DUST_PARTICLE_COUNT = 6;
const DUST_LIFETIME = 0.9;

type Burst = {
  mesh: THREE.InstancedMesh;
  born: number;
  positions: THREE.Vector3[];
  velocities: THREE.Vector3[];
};

export class FootstepDust {
  private bursts: Burst[] = [];
  private group = new THREE.Group();
  private dustGeo = new THREE.SphereGeometry(0.025, 4, 3);
  private dustMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.dustMat = new THREE.MeshBasicMaterial({
      color: 0x6a5a4a,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    scene.add(this.group);
  }

  spawn(x: number, z: number): void {
    const im = new THREE.InstancedMesh(
      this.dustGeo,
      this.dustMat,
      DUST_PARTICLE_COUNT,
    );
    im.frustumCulled = false;
    const positions: THREE.Vector3[] = [];
    const velocities: THREE.Vector3[] = [];
    const m = new THREE.Matrix4();
    for (let i = 0; i < DUST_PARTICLE_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.3 + Math.random() * 0.5;
      const pos = new THREE.Vector3(
        x + (Math.random() - 0.5) * 0.1,
        0.04,
        z + (Math.random() - 0.5) * 0.1,
      );
      const vel = new THREE.Vector3(
        Math.cos(angle) * speed * 0.4,
        0.4 + Math.random() * 0.3,
        Math.sin(angle) * speed * 0.4,
      );
      positions.push(pos);
      velocities.push(vel);
      m.makeTranslation(pos.x, pos.y, pos.z);
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
    this.group.add(im);
    this.bursts.push({ mesh: im, born: performance.now(), positions, velocities });
  }

  update(dt: number): void {
    const now = performance.now();
    const m = new THREE.Matrix4();
    for (let bi = this.bursts.length - 1; bi >= 0; bi--) {
      const b = this.bursts[bi];
      const age = (now - b.born) / 1000;
      if (age > DUST_LIFETIME) {
        this.group.remove(b.mesh);
        b.mesh.dispose();
        this.bursts.splice(bi, 1);
        continue;
      }
      const t = age / DUST_LIFETIME;
      const fade = 1 - t;
      for (let i = 0; i < DUST_PARTICLE_COUNT; i++) {
        const p = b.positions[i];
        const v = b.velocities[i];
        p.x += v.x * dt;
        p.y += v.y * dt;
        p.z += v.z * dt;
        v.y -= 1.2 * dt;
        m.makeScale(fade, fade, fade);
        m.setPosition(p.x, p.y, p.z);
        b.mesh.setMatrixAt(i, m);
      }
      b.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(scene: THREE.Scene): void {
    for (const b of this.bursts) {
      this.group.remove(b.mesh);
      b.mesh.dispose();
    }
    this.bursts = [];
    scene.remove(this.group);
    this.dustGeo.dispose();
    this.dustMat.dispose();
  }
}
