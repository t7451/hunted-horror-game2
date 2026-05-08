// client/src/audio/AudioWorld.ts
// Howler-backed audio world. Two layers:
//   1. 2D global sounds (ambient, heartbeat, breath, jump-scare, UI stings).
//      These represent state, not a world position, and play through normal
//      Howl.play().
//   2. Spatial sounds via SpatialAudio (Observer voice/footsteps, key
//      sparkles, door creaks, throwables) — see SpatialAudio.ts.
//
// Graceful degradation: each Howl reports onloaderror and is removed from
// the registry on failure, so missing files become a silent slot rather
// than a thrown error. Footsteps additionally fall back to inline WebAudio
// synthesis (`proceduralStep`) so the game is never silent.

import { Howl, Howler } from "howler";
import { AUDIO_MANIFEST, FOOTSTEP_POOL, type SoundId } from "./audio-manifest";
import { SpatialAudio } from "./SpatialAudio";
import { computeOcclusion } from "./AudioOcclusion";
import type { ParsedMap } from "@shared/maps";

export type AudioWorldOptions = {
  masterVolume?: number;
};

function proceduralKick(ctx: AudioContext, dest: AudioNode, amp: number, at: number) {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(120, at);
  osc.frequency.exponentialRampToValueAtTime(35, at + 0.18);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(amp, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
  osc.connect(gain).connect(dest);
  osc.start(at);
  osc.stop(at + 0.25);
}

// Surface-tinted procedural step. `tone` parameter shifts the lowpass
// cutoff so carpet (low) sounds dampened, stone (high) sounds clack-y.
function proceduralStep(
  ctx: AudioContext,
  dest: AudioNode,
  vol: number,
  tone: number = 600,
) {
  const dur = 0.06;
  const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const env = 1 - i / data.length;
    data[i] = (Math.random() * 2 - 1) * env * env;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = tone;
  const gain = ctx.createGain();
  gain.gain.value = vol;
  src.connect(filter).connect(gain).connect(dest);
  src.start(ctx.currentTime);
  src.stop(ctx.currentTime + dur + 0.02);
}

const PROCEDURAL_STEP_TONE: Record<string, number> = {
  step_carpet_1: 320,
  step_carpet_2: 320,
  step_stone_1: 1100,
  step_stone_2: 1100,
  step_creaky_1: 540,
  step_creaky_2: 540,
  step_wood_1: 700,
  step_wood_2: 700,
};

export class AudioWorld {
  private sounds = new Map<SoundId, Howl>();
  private unlocked = false;
  private fallbackCtx: AudioContext | null = null;
  private fallbackDest: AudioNode | null = null;
  private heartbeatPhase = 0;
  private _heartbeatIntensity = 0;
  private heartbeatRate = 1.0;
  private heartbeatPlaying = false;
  private lastMoanAt = 0;
  private lastFootstepIndex = 0;
  private entityProximity = 0;
  private visibilityHandler: (() => void) | null = null;

  // Spatial audio state.
  readonly spatial = new SpatialAudio();
  private observerBreathHandle: number | null = null;
  private observerStalkHandle: number | null = null;
  private observerPos = { x: 0, y: 1.6, z: 0, dist: Infinity, chasing: false };
  private listenerPos = { x: 0, y: 1.6, z: 0 };

  // Occlusion state.
  private occlusionCheckAt = 0;
  private parsedMap: ParsedMap | null = null;
  private mapTileSize = 1;

  // Ambient mixer state.
  private windPhase = 0;

  constructor(opts: AudioWorldOptions = {}) {
    if (typeof opts.masterVolume === "number") {
      Howler.volume(opts.masterVolume);
    }
    if (typeof document !== "undefined") {
      this.visibilityHandler = () => {
        if (document.visibilityState === "hidden") {
          Howler.mute(true);
        } else {
          Howler.mute(false);
        }
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }
  }

  unlock(): boolean {
    if (this.unlocked) return true;
    try {
      Howler.ctx?.resume?.();

      for (const [id, def] of Object.entries(AUDIO_MANIFEST) as [
        SoundId,
        (typeof AUDIO_MANIFEST)[SoundId],
      ][]) {
        const howl = new Howl({
          src: def.src,
          loop: def.loop ?? false,
          volume: def.volume,
          preload: true,
          html5: false,
          onloaderror: (_id: number, err: unknown) => {
            console.warn(`[AudioWorld] failed to load ${id}:`, err);
            this.sounds.delete(id);
          },
        });
        this.sounds.set(id, howl);
      }

      this.play("ambient_loop");

      const Ctor =
        (
          window as unknown as {
            AudioContext?: typeof AudioContext;
            webkitAudioContext?: typeof AudioContext;
          }
        ).AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (Ctor) {
        try {
          this.fallbackCtx = new Ctor();
          void this.fallbackCtx.resume();
          this.fallbackDest = this.fallbackCtx.destination;
        } catch {
          /* ignore */
        }
      }

      this.unlocked = true;
      return true;
    } catch (err) {
      console.error("[AudioWorld] unlock failed:", err);
      return false;
    }
  }

  isUnlocked(): boolean {
    return this.unlocked;
  }

  // ── Spatial / listener ─────────────────────────────────────────────────────

  setListener(x: number, y: number, z: number, yaw: number): void {
    this.listenerPos.x = x;
    this.listenerPos.y = y;
    this.listenerPos.z = z;
    this.spatial.setListener(x, y, z, yaw);
  }

  /** One-shot positional sound (door creak, key pickup pop). */
  playAt(soundId: SoundId, x: number, y: number, z: number): number | null {
    if (!this.unlocked) return null;
    const howl = this.sounds.get(soundId);
    if (!howl) return null;
    return this.spatial.play(soundId, howl, x, y, z);
  }

  /** Drives the looping Observer voice from the enemy's world position. */
  updateObserverPosition(
    x: number,
    y: number,
    z: number,
    isChasing: boolean,
  ): void {
    this.observerPos.x = x;
    this.observerPos.y = y;
    this.observerPos.z = z;
    this.observerPos.chasing = isChasing;
    const dx = x - this.listenerPos.x;
    const dz = z - this.listenerPos.z;
    this.observerPos.dist = Math.sqrt(dx * dx + dz * dz);

    if (!this.unlocked) return;

    const breathHowl = this.sounds.get("observer_breathing");
    if (breathHowl && this.observerBreathHandle === null) {
      this.observerBreathHandle = this.spatial.play(
        "observer_breathing",
        breathHowl,
        x,
        y,
        z,
      );
    } else if (breathHowl && this.observerBreathHandle !== null) {
      this.spatial.move(this.observerBreathHandle, x, y, z);
    }

    const stalkHowl = this.sounds.get("observer_stalk");
    if (isChasing && stalkHowl && this.observerStalkHandle === null) {
      this.observerStalkHandle = this.spatial.play(
        "observer_stalk",
        stalkHowl,
        x,
        y,
        z,
      );
    } else if (!isChasing && this.observerStalkHandle !== null) {
      this.spatial.stop(this.observerStalkHandle);
      this.observerStalkHandle = null;
    } else if (this.observerStalkHandle !== null) {
      this.spatial.move(this.observerStalkHandle, x, y, z);
    }
  }

  tickSpatial(dt: number): void {
    if (!this.unlocked) return;
    this.spatial.tick(dt);
  }

  bindMap(parsed: ParsedMap, tileSize: number): void {
    this.parsedMap = parsed;
    this.mapTileSize = tileSize;
  }

  tickOcclusion(listenerX: number, listenerZ: number, now: number): void {
    if (!this.parsedMap) return;
    if (now - this.occlusionCheckAt < 120) return; // ~8Hz
    this.occlusionCheckAt = now;
    for (const src of this.spatial.getSources()) {
      if (!src.active) continue;
      const occ = computeOcclusion(
        this.parsedMap,
        this.mapTileSize,
        src.x,
        src.z,
        listenerX,
        listenerZ,
      );
      this.spatial.setOcclusion(src.id, occ);
    }
  }

  // ── Heartbeat (continuous distance-driven) ────────────────────────────────

  setHeartbeatProximity(distance: number): void {
    if (!this.unlocked) return;
    const heartbeat = this.sounds.get("heartbeat_loop");
    if (!heartbeat) return;

    // 12m+ = calm, 0m = panicked.
    const t = Math.max(0, Math.min(1, 1 - distance / 12));
    // Volume curve: silent until 8m, ramps up sharp under 4m.
    const targetVol = t < 0.33 ? 0 : (t - 0.33) * 1.5;
    const targetRate = 0.8 + t * 0.7;

    let cur = 0;
    try {
      cur = heartbeat.volume() as number;
    } catch {
      /* ignore */
    }
    const newVol = cur + (targetVol - cur) * 0.06;
    try {
      heartbeat.volume(newVol);
    } catch {
      /* ignore */
    }

    this.heartbeatRate += (targetRate - this.heartbeatRate) * 0.04;
    try {
      heartbeat.rate(this.heartbeatRate);
    } catch {
      /* ignore */
    }

    if (t > 0.4 && !this.heartbeatPlaying) {
      try {
        heartbeat.loop(true);
        heartbeat.play();
      } catch {
        /* ignore */
      }
      this.heartbeatPlaying = true;
    }
  }

  // ── Ambient mixer ─────────────────────────────────────────────────────────

  tickAmbient(dt: number): void {
    if (!this.unlocked) return;

    // Wind breathes in/out over 28s cycles.
    this.windPhase += dt;
    const wind = this.sounds.get("ambient_wind");
    if (wind) {
      const breath =
        (Math.sin((this.windPhase / 28) * Math.PI * 2) + 1) / 2;
      try {
        wind.volume(0.05 + breath * 0.18);
        if (!wind.playing()) wind.play();
      } catch {
        /* ignore */
      }
    }

    // Sub-bass drone always at low volume.
    const drone = this.sounds.get("static_drone");
    if (drone) {
      try {
        if (!drone.playing()) {
          drone.volume(0.12);
          drone.loop(true);
          drone.play();
        }
      } catch {
        /* ignore */
      }
    }
  }

  // ── Footsteps (player 2D, observer spatial) ───────────────────────────────

  playStep(soundId: SoundId, volumeScale: number): void {
    if (!this.unlocked) return;
    const howl = this.sounds.get(soundId);
    const def = AUDIO_MANIFEST[soundId];
    if (howl) {
      const id = howl.play();
      if (def) {
        try {
          howl.volume(def.volume * volumeScale, id);
        } catch {
          /* ignore */
        }
      }
      try {
        howl.rate(0.95 + Math.random() * 0.1, id);
      } catch {
        /* ignore */
      }
    } else if (this.fallbackCtx && this.fallbackDest) {
      const tone = PROCEDURAL_STEP_TONE[soundId] ?? 600;
      const baseVol = def?.volume ?? 0.4;
      proceduralStep(this.fallbackCtx, this.fallbackDest, baseVol * volumeScale, tone);
    }
  }

  playStepAt(
    soundId: SoundId,
    x: number,
    y: number,
    z: number,
    volumeScale: number,
  ): void {
    if (!this.unlocked) return;
    const howl = this.sounds.get(soundId);
    const def = AUDIO_MANIFEST[soundId];
    if (!howl || !def) return;
    // Spatialize via SpatialAudio. The sound is a one-shot (no manifest loop),
    // so we don't track the handle; SpatialAudio will keep it for the life of
    // the playback.
    const handle = this.spatial.play(soundId, howl, x, y, z);
    try {
      howl.volume(def.volume * volumeScale, handle);
    } catch {
      /* ignore */
    }
    try {
      howl.rate(0.92 + Math.random() * 0.08, handle);
    } catch {
      /* ignore */
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  getHowl(id: SoundId): Howl | null {
    return this.sounds.get(id) ?? null;
  }

  // ── Per-frame ─────────────────────────────────────────────────────────────

  update(dt: number): void {
    if (!this.unlocked) return;
    void dt;
    // Moans on cooldown when Observer is chasing within audible range.
    // (Heartbeat moved to setHeartbeatProximity; entityProximity-based
    // gating below remains for legacy callers until engine fully migrates.)
    if (this.observerPos.chasing && this.observerPos.dist < 18) {
      const now = performance.now() / 1000;
      const proximityFactor = 1 - this.observerPos.dist / 18;
      const cooldown = 6 - proximityFactor * 3;
      if (now - this.lastMoanAt > cooldown) {
        this.lastMoanAt = now;
        const moanId =
          Math.random() < 0.5 ? "observer_moan_1" : "observer_moan_2";
        this.playAt(
          moanId,
          this.observerPos.x,
          this.observerPos.y,
          this.observerPos.z,
        );
      }
    } else if (this.entityProximity > 0.3) {
      // Legacy path: setEntityProximity callers (until engine migrates).
      const now = performance.now() / 1000;
      const cooldown = 6 - this.entityProximity * 3;
      if (now - this.lastMoanAt > cooldown) {
        this.lastMoanAt = now;
        this.play(Math.random() < 0.5 ? "observer_moan_1" : "observer_moan_2");
      }
    }
  }

  // ── Triggers (public) ─────────────────────────────────────────────────────

  triggerKeyPickup(): void {
    if (!this.unlocked) return;
    this.play("key_pickup");
  }

  triggerJumpScare(): void {
    if (!this.unlocked) return;
    this.play("static_burst");
    setTimeout(() => {
      this.play("jump_scare_sting");
    }, 120);
    this.fadeTo("observer_stalk", 0, 200);
    this.fadeTo("observer_breathing", 0, 200);
    this.fadeTo("ambient_loop", 0, 400);
  }

  /** Legacy 2D footstep (engine.ts hasn't migrated to FootstepSystem yet). */
  triggerFootstep(): void {
    if (!this.unlocked) return;
    this.lastFootstepIndex = (this.lastFootstepIndex + 1) % FOOTSTEP_POOL.length;
    const id = FOOTSTEP_POOL[this.lastFootstepIndex];
    const h = this.sounds.get(id);
    if (h) {
      h.play();
    } else if (this.fallbackCtx && this.fallbackDest) {
      proceduralStep(this.fallbackCtx, this.fallbackDest, 0.18);
    }
  }

  // ── Legacy methods (kept until engine.ts fully migrates) ──────────────────

  setHeartbeatIntensity(intensity: number): void {
    // Kept as a no-op for now; engine will switch to setHeartbeatProximity.
    this._heartbeatIntensity = Math.max(0, Math.min(1, intensity));
    void this.heartbeatPhase; // satisfy "unused" once we delete this fn
  }

  setEntityProximity(proximity: number): void {
    this.entityProximity = Math.max(0, Math.min(1, proximity));
    // Note: spec replaces this with updateObserverPosition. Kept so the
    // engine compiles until the migration in this branch is complete.
    const stalkVol = this.entityProximity * 0.22;
    const breathVol = Math.max(0, (this.entityProximity - 0.4) * 0.3);
    this.fadeTo("observer_stalk", stalkVol, 600);
    this.fadeTo("observer_breathing", breathVol, 800);
    if (stalkVol > 0.02) {
      const h = this.sounds.get("observer_stalk");
      if (h && !h.playing()) this.play("observer_stalk");
    }
    if (breathVol > 0.02) {
      const h = this.sounds.get("observer_breathing");
      if (h && !h.playing()) this.play("observer_breathing");
    }
  }

  /** Sharp metallic clatter at a thrown-object impact location. */
  triggerThrowableImpact(): void {
    if (!this.unlocked) return;
    const h = this.sounds.get("static_burst");
    if (!h) return;
    const id = h.play();
    h.rate(1.6, id);
    setTimeout(() => {
      try {
        h.rate(1.0, id);
      } catch {
        /* sound may have ended */
      }
    }, 320);
  }

  /** Heavier creak-then-thud for door slams. */
  triggerDoorSlam(): void {
    if (!this.unlocked) return;
    const h = this.sounds.get("door_creak");
    if (!h) return;
    const id = h.play();
    h.rate(0.7, id);
    setTimeout(() => {
      try {
        h.rate(1.0, id);
      } catch {
        /* sound may have ended */
      }
    }, 600);
  }

  // ── Disposal ──────────────────────────────────────────────────────────────

  dispose(): void {
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
    this.spatial.dispose();
    this.observerBreathHandle = null;
    this.observerStalkHandle = null;
    for (const howl of this.sounds.values()) {
      howl.stop();
      howl.unload();
    }
    this.sounds.clear();
    try {
      this.fallbackCtx?.close();
    } catch {
      /* ignore */
    }
    this.fallbackCtx = null;
    this.fallbackDest = null;
    this.unlocked = false;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private play(id: SoundId): void {
    try {
      this.sounds.get(id)?.play();
    } catch {
      /* ignore */
    }
  }

  private fadeTo(id: SoundId, volume: number, durationMs: number): void {
    const h = this.sounds.get(id);
    if (!h) return;
    try {
      h.fade(h.volume() as number, volume, durationMs);
    } catch {
      /* ignore */
    }
  }

  private fireHeartbeat(): void {
    // Legacy entry: only used if setHeartbeatIntensity callers exist before
    // the engine migrates to setHeartbeatProximity. Currently a stub —
    // kept so the file compiles without dead code warnings.
    void this._heartbeatIntensity;
  }
}
