import * as THREE from "three";
import type { SharedUniforms } from "../render/uniforms";

// Heartbeat / panic visualizer. Tracks distance from camera to threat and
// pulses the PostFX vignette darkness at heart-rate when the threat is
// near. Audio (heartbeat_loop / breath_panic_loop) is intentionally not
// driven from here — Phase 8 owns the AudioWorld layer; this file only
// handles the visual cue so it works before any audio assets land.

export type HeartbeatOptions = {
  /** Distance at which the pulse starts ramping in (meters). */
  proximity?: number;
  /** Base vignette darkness; pulse is added on top. */
  baseDarkness?: number;
  /** Maximum darkness pulse amplitude. */
  pulseAmplitude?: number;
  /** Heart rate at maximum proximity (BPM). */
  maxBpm?: number;
};

export class Heartbeat {
  private readonly proximity: number;
  private readonly baseDarkness: number;
  private readonly pulseAmplitude: number;
  private readonly maxBpm: number;

  private phase = 0;
  /** Cached intensity factor in [0,1] for external systems (audio later). */
  private _intensity = 0;

  constructor(
    private readonly uniforms: SharedUniforms,
    opts: HeartbeatOptions = {},
  ) {
    this.proximity = opts.proximity ?? 8;
    this.baseDarkness = opts.baseDarkness ?? uniforms.vignetteDarkness.value;
    this.pulseAmplitude = opts.pulseAmplitude ?? 0.25;
    this.maxBpm = opts.maxBpm ?? 130;
  }

  /**
   * Per-frame update.
   * @param dt    Frame delta in seconds.
   * @param camera The player camera.
   * @param threatPos World-space position of the active threat, or null.
   */
  update(dt: number, camera: THREE.Camera, threatPos: THREE.Vector3 | null): void {
    let intensity = 0;
    if (threatPos) {
      const camPos = camera.getWorldPosition(new THREE.Vector3());
      const d = camPos.distanceTo(threatPos);
      intensity = THREE.MathUtils.clamp(1 - d / this.proximity, 0, 1);
    }
    this._intensity = intensity;

    // Heart rate scales with intensity; phase advances and the sine drives
    // the visible pulse. Squared-sin gives a punchier "thump" than a plain
    // sine.
    const bpm = 60 + (this.maxBpm - 60) * intensity;
    const hz = bpm / 60;
    this.phase += dt * hz * Math.PI * 2;
    const thump = Math.pow(Math.max(0, Math.sin(this.phase)), 4);

    this.uniforms.vignetteDarkness.value =
      this.baseDarkness + thump * this.pulseAmplitude * intensity;
  }

  /** Read-only access for Phase 8 audio cross-fade or HUD effects. */
  intensity(): number {
    return this._intensity;
  }

  reset(): void {
    this.uniforms.vignetteDarkness.value = this.baseDarkness;
    this.phase = 0;
    this._intensity = 0;
  }
}
