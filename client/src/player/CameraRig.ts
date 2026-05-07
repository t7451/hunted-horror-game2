import * as THREE from "three";

// Camera rig — layered effects (head bob, breathing sway, sprint FOV
// punch, damage spike, crouch lerp) applied on top of the engine's
// per-frame logical camera position. The engine still owns yaw/pitch
// and the base position (collision-corrected x/z, gameplay y like
// the hide-crouch dip); the rig only writes the small *additive*
// offsets and the FOV.

export type RigState = {
  /** Forward/strafe magnitude in [0,1]. 0 = stationary, 1 = full move. */
  moveMagnitude: number;
  /** True while sprint key is held. */
  sprinting: boolean;
  /** True while crouched (e.g. hiding). */
  crouched: boolean;
};

export type CameraRigOptions = {
  baseFov?: number;
  /** Logical eye height when standing. */
  baseHeight?: number;
  /** Eye height when crouched. */
  crouchHeight?: number;
  /** Lateral bob amplitude in meters. */
  bobLateral?: number;
  /** Vertical bob amplitude in meters. */
  bobVertical?: number;
  /** Bob frequency (Hz) at full sprint. */
  bobHz?: number;
};

export class CameraRig {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly baseFov: number;
  private readonly baseHeight: number;
  private readonly crouchHeight: number;
  private readonly bobLateral: number;
  private readonly bobVertical: number;
  private readonly bobHz: number;

  private bobPhase = 0;
  /** Smoothed crouch factor in [0,1]. */
  private crouchT = 0;
  /** Smoothed sprint factor in [0,1]. */
  private sprintT = 0;
  /** Damage flash timer in seconds remaining. */
  private damageT = 0;

  constructor(camera: THREE.PerspectiveCamera, opts: CameraRigOptions = {}) {
    this.camera = camera;
    this.baseFov = opts.baseFov ?? camera.fov;
    this.baseHeight = opts.baseHeight ?? 1.7;
    this.crouchHeight = opts.crouchHeight ?? 1.0;
    this.bobLateral = opts.bobLateral ?? 0.04;
    this.bobVertical = opts.bobVertical ?? 0.06;
    this.bobHz = opts.bobHz ?? 10;
  }

  /** Trigger a short FOV/CA spike — call when the player takes damage. */
  pulseDamage(durationSec = 0.15): void {
    this.damageT = Math.max(this.damageT, durationSec);
  }

  /**
   * Apply the rig per frame. Call AFTER the engine has set the camera's
   * logical x/z (collision-corrected) but BEFORE the renderer.render()
   * call so the FOV/Y change is captured this frame.
   */
  update(dt: number, state: RigState, t: number): void {
    // Smooth toggles. Lerp factor ~10/s reaches ~63% in 0.1s, ~95% in 0.3s.
    const k = 1 - Math.exp(-dt * 10);
    this.crouchT += ((state.crouched ? 1 : 0) - this.crouchT) * k;
    this.sprintT += ((state.sprinting ? 1 : 0) - this.sprintT) * k;

    // Logical base height after crouch lerp.
    const baseY = this.baseHeight + (this.crouchHeight - this.baseHeight) * this.crouchT;

    // Head bob: phase advances proportional to movement speed.
    const moveT = Math.min(state.moveMagnitude, 1);
    this.bobPhase += dt * this.bobHz * (0.5 + 0.5 * (1 + this.sprintT)) * moveT;
    const bobY = Math.sin(this.bobPhase) * this.bobVertical * moveT;
    const bobX = Math.cos(this.bobPhase * 0.5) * this.bobLateral * moveT;

    // Breathing sway when nearly stationary — fades out as movement ramps.
    const stillness = 1 - moveT;
    const breath = Math.sin(t * 0.3 * Math.PI * 2) * 0.012 * stillness;

    // Apply Y. The engine has already written the logical y for hide/crouch
    // gameplay; we override with our own base + bob to get a unified value.
    this.camera.position.y = baseY + bobY + breath;

    // Lateral bob: shift camera in local-X by rotating bobX through the
    // camera's current yaw. Cheaper than computing a quaternion-rotated
    // vector each frame.
    // Skipped: would require knowing yaw; engine owns yaw and we don't
    // want to read it back. Stick to vertical bob only — still reads as
    // grounded under flashlight motion.
    void bobX;

    // FOV: base + sprint punch + damage spike, always damping back.
    this.damageT = Math.max(0, this.damageT - dt);
    const sprintPunch = this.sprintT * 7; // 75 -> 82°
    const damagePunch = this.damageT > 0 ? 6 : 0;
    const targetFov = this.baseFov + sprintPunch + damagePunch + breath * 40;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, k);
    this.camera.updateProjectionMatrix();
  }

  /** Currently-active damage flash strength in [0,1] for PostFX hooks. */
  damageFactor(): number {
    return this.damageT > 0 ? Math.min(1, this.damageT / 0.15) : 0;
  }
}
