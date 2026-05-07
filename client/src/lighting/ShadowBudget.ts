import * as THREE from "three";
import { isMobile } from "../util/device";

// Runtime shadow-caster budget. Spec calls for 3 shadow-casting lights on
// desktop, 1 on mobile, prioritized by distance to camera each frame. Even
// with today's single shadow-casting flashlight, having this in place means
// future Phase-7+ additions (a shadowed enemy light, room-bound practicals)
// can register without each having to police itself.

const DEFAULT_BUDGET = isMobile ? 1 : 3;

type Tracked = {
  light: THREE.Light;
  baseCastShadow: boolean;
};

export class ShadowBudget {
  private readonly tracked: Tracked[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(public budget: number = DEFAULT_BUDGET) {}

  /**
   * Register a light whose `castShadow` flag should be enforced by the
   * budget. Stores the light's *intended* shadow setting; the budget can
   * temporarily clear `castShadow` and restore it next frame.
   */
  register(light: THREE.Light): void {
    this.tracked.push({ light, baseCastShadow: light.castShadow });
  }

  /**
   * Per-frame: sort tracked shadow-casters by distance to the camera, keep
   * the closest `budget` on, force the rest off. Cheap — the population
   * is tiny (single digits) so a full sort each frame is fine.
   */
  update(camera: THREE.Camera): void {
    if (this.tracked.length <= this.budget) {
      // Nothing to prune; restore base state in case it was cleared earlier.
      for (const t of this.tracked) t.light.castShadow = t.baseCastShadow;
      return;
    }
    const camPos = camera.getWorldPosition(this.tmp);
    // Compute squared distance once per light, then sort.
    const sorted = this.tracked
      .filter((t) => t.baseCastShadow)
      .map((t) => {
        const lp = t.light.getWorldPosition(new THREE.Vector3());
        return { t, d: lp.distanceToSquared(camPos) };
      })
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i < sorted.length; i++) {
      sorted[i].t.light.castShadow = i < this.budget;
    }
    // Lights whose baseCastShadow is false stay off.
    for (const t of this.tracked) {
      if (!t.baseCastShadow) t.light.castShadow = false;
    }
  }

  unregister(light: THREE.Light): void {
    const i = this.tracked.findIndex((t) => t.light === light);
    if (i >= 0) this.tracked.splice(i, 1);
  }

  dispose(): void {
    this.tracked.length = 0;
  }
}
