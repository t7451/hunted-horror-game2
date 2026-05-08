// client/src/audio/FootstepSystem.ts
// Detects steps from horizontal velocity (not a fixed timer) and fires the
// correct surface-specific variant via AudioWorld.playStep / playStepAt.
//
// Two consumers: the player (2D — listener IS the player), and the Observer
// (spatial — emitted from the enemy's world position). Both share the same
// detection logic — a sliding accumulator over distance walked, with a
// shorter stride threshold when sprinting.

import type { ParsedMap, SurfaceKind } from "@shared/maps";
import { getSurface } from "@shared/maps";
import type { AudioWorld } from "./AudioWorld";
import type { SoundId } from "./audio-manifest";

const STEP_DISTANCE_WALK = 1.4; // world units between steps at walk speed
const STEP_DISTANCE_SPRINT = 1.05;

const STEP_VARIANTS: Record<SurfaceKind, SoundId[]> = {
  wood: ["step_wood_1", "step_wood_2"],
  carpet: ["step_carpet_1", "step_carpet_2"],
  stone: ["step_stone_1", "step_stone_2"],
  creaky: ["step_creaky_1", "step_creaky_2"],
};

export class FootstepSystem {
  private accumDist = 0;
  private lastX = 0;
  private lastZ = 0;
  private initialized = false;
  private nextVariantIdx = 0;

  constructor(
    private audio: AudioWorld,
    private parsedMap: ParsedMap,
    private tileSize: number,
    private spatial = false,
    private onStep?: (x: number, z: number, surface: SurfaceKind) => void,
  ) {}

  reset(x: number, z: number): void {
    this.lastX = x;
    this.lastZ = z;
    this.accumDist = 0;
    this.initialized = true;
  }

  tick(x: number, z: number, sprinting: boolean, hiding: boolean): void {
    if (!this.initialized) {
      this.reset(x, z);
      return;
    }
    if (hiding) {
      // No steps while crouched in a closet, and don't immediately fire one
      // when the player un-hides.
      this.lastX = x;
      this.lastZ = z;
      this.accumDist = 0;
      return;
    }
    const dx = x - this.lastX;
    const dz = z - this.lastZ;
    const moved = Math.sqrt(dx * dx + dz * dz);
    if (moved < 0.001) return;

    this.accumDist += moved;
    this.lastX = x;
    this.lastZ = z;

    const stepThreshold = sprinting ? STEP_DISTANCE_SPRINT : STEP_DISTANCE_WALK;
    if (this.accumDist >= stepThreshold) {
      this.accumDist -= stepThreshold;
      this.fireStep(x, z, sprinting);
    }
  }

  private fireStep(x: number, z: number, sprinting: boolean): void {
    const tx = Math.floor(x / this.tileSize);
    const tz = Math.floor(z / this.tileSize);
    if (tz < 0 || tz >= this.parsedMap.height) return;
    if (tx < 0 || tx >= this.parsedMap.width) return;
    const surface = getSurface(this.parsedMap.tiles[tz][tx]);
    const variants = STEP_VARIANTS[surface];
    const variant = variants[this.nextVariantIdx % variants.length];
    this.nextVariantIdx++;
    const volScale = sprinting ? 1.0 : 0.7;
    if (this.spatial) {
      this.audio.playStepAt(variant, x, 0, z, volScale);
    } else {
      this.audio.playStep(variant, volScale);
    }
    this.onStep?.(x, z, surface);
  }
}
