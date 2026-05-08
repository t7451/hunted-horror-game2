// client/src/audio/AudioWorld.ts
// Howler-backed audio world. Matches the procedural WebAudio API exactly so
// engine.ts needs zero changes beyond the new triggerJumpScare /
// triggerKeyPickup / setEntityProximity calls.
//
// Graceful degradation: each sound channel is wrapped in try/catch.
// If a file 404s or Howler fails to decode, that channel falls back to
// inline WebAudio synthesis. The game never goes silent due to missing assets.

import { Howl, Howler } from "howler";
import { AUDIO_MANIFEST, FOOTSTEP_POOL, type SoundId } from "./audio-manifest";

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

function proceduralStep(ctx: AudioContext, dest: AudioNode, vol: number) {
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
  filter.frequency.value = 600;
  const gain = ctx.createGain();
  gain.gain.value = vol;
  src.connect(filter).connect(gain).connect(dest);
  src.start(ctx.currentTime);
  src.stop(ctx.currentTime + dur + 0.02);
}

export class AudioWorld {
  private sounds = new Map<SoundId, Howl>();
  private unlocked = false;
  private fallbackCtx: AudioContext | null = null;
  private fallbackDest: AudioNode | null = null;
  private heartbeatPhase = 0;
  private _heartbeatIntensity = 0;
  private lastMoanAt = 0;
  private lastFootstepIndex = 0;
  private entityProximity = 0;

  constructor(opts: AudioWorldOptions = {}) {
    if (typeof opts.masterVolume === "number") {
      Howler.volume(opts.masterVolume);
    }
  }

  unlock(): boolean {
    if (this.unlocked) return true;
    try {
      Howler.ctx?.resume?.();

      for (const [id, def] of Object.entries(AUDIO_MANIFEST) as [SoundId, typeof AUDIO_MANIFEST[SoundId]][]) {
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
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        try {
          this.fallbackCtx = new Ctor();
          void this.fallbackCtx.resume();
          this.fallbackDest = this.fallbackCtx.destination;
        } catch { /* ignore */ }
      }

      this.unlocked = true;
      return true;
    } catch (err) {
      console.error("[AudioWorld] unlock failed:", err);
      return false;
    }
  }

  setHeartbeatIntensity(intensity: number): void {
    this._heartbeatIntensity = Math.max(0, Math.min(1, intensity));
    const breathVol = Math.max(0, (this._heartbeatIntensity - 0.5) * 2 * 0.18);
    this.fadeTo("breath_panic", breathVol, 400);
    if (breathVol > 0.02) {
      const h = this.sounds.get("breath_panic");
      if (h && !h.playing()) this.play("breath_panic");
    }
  }

  setEntityProximity(proximity: number): void {
    this.entityProximity = Math.max(0, Math.min(1, proximity));
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

  update(dt: number): void {
    if (!this.unlocked) return;
    if (this._heartbeatIntensity > 0.1) {
      const bpm = 60 + (130 - 60) * this._heartbeatIntensity;
      const period = 60 / bpm;
      this.heartbeatPhase += dt;
      if (this.heartbeatPhase >= period) {
        this.heartbeatPhase = 0;
        this.fireHeartbeat();
      }
    } else {
      this.heartbeatPhase = 0;
    }
    if (this.entityProximity > 0.3) {
      const now = performance.now() / 1000;
      const cooldown = 6 - this.entityProximity * 3;
      if (now - this.lastMoanAt > cooldown) {
        this.lastMoanAt = now;
        this.play(Math.random() < 0.5 ? "observer_moan_1" : "observer_moan_2");
      }
    }
  }

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

  triggerKeyPickup(): void {
    if (!this.unlocked) return;
    this.play("key_pickup");
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

  triggerJumpScare(): void {
    if (!this.unlocked) return;
    this.play("static_burst");
    setTimeout(() => { this.play("jump_scare_sting"); }, 120);
    this.fadeTo("observer_stalk", 0, 200);
    this.fadeTo("observer_breathing", 0, 200);
    this.fadeTo("ambient_loop", 0, 400);
  }

  dispose(): void {
    for (const howl of this.sounds.values()) {
      howl.stop();
      howl.unload();
    }
    this.sounds.clear();
    try { this.fallbackCtx?.close(); } catch { /* ignore */ }
    this.fallbackCtx = null;
    this.fallbackDest = null;
    this.unlocked = false;
  }

  private play(id: SoundId): void {
    try { this.sounds.get(id)?.play(); } catch { /* ignore */ }
  }

  private fadeTo(id: SoundId, volume: number, durationMs: number): void {
    const h = this.sounds.get(id);
    if (!h) return;
    try { h.fade(h.volume(), volume, durationMs); } catch { /* ignore */ }
  }

  private fireHeartbeat(): void {
    const h = this.sounds.get("heartbeat_loop");
    if (h) {
      h.volume(0.35 + this._heartbeatIntensity * 0.5);
      h.play();
    } else if (this.fallbackCtx && this.fallbackDest) {
      const amp = 0.4 * this._heartbeatIntensity;
      const now = this.fallbackCtx.currentTime;
      proceduralKick(this.fallbackCtx, this.fallbackDest, amp, now);
      proceduralKick(this.fallbackCtx, this.fallbackDest, amp * 0.65, now + 0.18);
    }
  }
}
