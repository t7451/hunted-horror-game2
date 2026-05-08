import type * as THREE from "three";

const CULL_INTERVAL_MS = 250;
// Lights below this baseline are treated as intentionally off (e.g. the
// enemyLight in low-quality mode) — we never multiply them up from zero
// just because the player walks within range.
const ZERO_INTENSITY_EPS = 0.001;

type Entry = {
  light: THREE.Light;
  baseIntensity: number;
  /**
   * Whether `baseIntensity` reflects the engine's intended max for the
   * light. False until the first `update()` pass; lets the engine register
   * a light before fully configuring its intensity without locking it at
   * zero forever.
   */
  calibrated: boolean;
};

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
    // Defer baseline capture: intensity may not be final yet, and a
    // zero-baseline gets stuck dark forever (Hotfix 11.1 root cause).
    this.entries.push({
      light,
      baseIntensity: light.intensity,
      calibrated: false,
    });
  }

  setBaseIntensity(light: THREE.Light, intensity: number): void {
    const e = this.entries.find(x => x.light === light);
    if (e) {
      e.baseIntensity = intensity;
      e.calibrated = true;
    }
  }

  update(playerX: number, playerZ: number, now: number): void {
    if (now - this.lastCheck < CULL_INTERVAL_MS) return;
    this.lastCheck = now;
    const cullSq = this.cullDist * this.cullDist;
    const fadeBand = cullSq * 0.4;

    for (const entry of this.entries) {
      const { light } = entry;
      // First-pass calibration: capture intensity AFTER the engine had a
      // chance to set it. Without this, a light registered with intensity
      // 0 gets pinned dark even after the engine writes a real value.
      if (!entry.calibrated) {
        entry.baseIntensity = light.intensity;
        entry.calibrated = true;
      }
      // Skip lights that are intentionally zero (e.g. quality-gated to off).
      // Touching their intensity here would either pin them dark or undo a
      // deliberate engine override.
      if (entry.baseIntensity < ZERO_INTENSITY_EPS) continue;

      const baseIntensity = entry.baseIntensity;
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
