import type * as THREE from "three";

const CULL_INTERVAL_MS = 250;

type Entry = { light: THREE.Light; baseIntensity: number };

/**
 * Distance-cull and dim point lights so practicals more than `cullDist`
 * tiles away from the player don't pay shader cost. Throttled to 4 Hz —
 * lights pop in/out infrequently enough that 250 ms granularity is invisible.
 */
export class LightCuller {
  private entries: Entry[] = [];
  private lastCheck = 0;

  constructor(private readonly cullDist: number = 18) {}

  register(light: THREE.Light): void {
    this.entries.push({ light, baseIntensity: light.intensity });
  }

  setBaseIntensity(light: THREE.Light, intensity: number): void {
    const e = this.entries.find(x => x.light === light);
    if (e) e.baseIntensity = intensity;
  }

  update(playerX: number, playerZ: number, now: number): void {
    if (now - this.lastCheck < CULL_INTERVAL_MS) return;
    this.lastCheck = now;
    const cullSq = this.cullDist * this.cullDist;
    const fadeBand = cullSq * 0.4;

    for (const { light, baseIntensity } of this.entries) {
      const dx = light.position.x - playerX;
      const dz = light.position.z - playerZ;
      const distSq = dx * dx + dz * dz;
      if (distSq > cullSq * 1.4) {
        light.visible = false;
      } else if (distSq > cullSq) {
        light.visible = true;
        const t = 1 - (distSq - cullSq) / fadeBand;
        light.intensity = baseIntensity * Math.max(0, Math.min(1, t));
      } else {
        light.visible = true;
        light.intensity = baseIntensity;
      }
    }
  }

  dispose(): void {
    this.entries = [];
  }
}
