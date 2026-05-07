// Procedural WebAudio sound bed. Spec §8 calls for Howler with recorded
// loops (`house_drone_loop.ogg`, `heartbeat_loop.ogg`,
// `breath_panic_loop.ogg`, footstep pools), but the audio asset bundle
// isn't committed yet. To unblock the system end-to-end without new
// deps, this Phase 8 ships a pure WebAudio synthesis layer:
//
// - A low-frequency drone bed (always-on once unlocked) for ambient
//   unease.
// - A heartbeat thump driven by the Phase 7 `Heartbeat.intensity()`
//   curve. Plays a short kick burst every cycle; rate scales with
//   threat proximity.
// - A footstep click triggered when the player moves on the ground.
//
// Public API (`unlock` / `setHeartbeatIntensity` / `triggerFootstep` /
// `dispose`) matches what a Howler-backed implementation would expose,
// so swapping in real loops later is localized.

export type AudioWorldOptions = {
  bedVolume?: number;
  heartbeatVolume?: number;
  footstepVolume?: number;
};

export class AudioWorld {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bedGain: GainNode | null = null;
  private bedNodes: AudioNode[] = [];

  private readonly bedVolume: number;
  private readonly heartbeatVolume: number;
  private readonly footstepVolume: number;

  private heartbeatPhase = 0;
  private heartbeatIntensity = 0;
  /** Wallclock seconds since heartbeat last fired a thump. */
  private lastThumpTs = 0;
  private lastWhisperTs = -99;

  private unlocked = false;

  constructor(opts: AudioWorldOptions = {}) {
    this.bedVolume = opts.bedVolume ?? 0.05;
    this.heartbeatVolume = opts.heartbeatVolume ?? 0.5;
    this.footstepVolume = opts.footstepVolume ?? 0.18;
  }

  /**
   * Must be called from a user gesture (button click) on iOS Safari and
   * older Chrome — autoplay policies otherwise block all audio.
   */
  unlock(): boolean {
    if (this.unlocked) return true;
    const Ctor =
      (window as unknown as { AudioContext?: typeof AudioContext })
        .AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return false;
    try {
      this.ctx = new Ctor();
      void this.ctx.resume();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
      this.startBed();
      this.unlocked = true;
      return true;
    } catch {
      return false;
    }
  }

  /** Keep heartbeat audio in sync with the visual pulse from Phase 7. */
  setHeartbeatIntensity(intensity: number): void {
    this.heartbeatIntensity = Math.max(0, Math.min(1, intensity));
  }

  /**
   * Per-frame tick. Drives the heartbeat thump; the bed runs continuously
   * via scheduled nodes so it doesn't need polling.
   */
  update(dt: number): void {
    if (!this.unlocked || !this.ctx) return;
    if (this.bedGain) {
      const target = this.bedVolume * (1 + this.heartbeatIntensity * 1.8);
      this.bedGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.35);
    }
    if (this.heartbeatIntensity > 0.35) this.maybeWhisper();
    if (this.heartbeatIntensity <= 0.01) return;
    const bpm = 60 + (130 - 60) * this.heartbeatIntensity;
    const period = 60 / bpm;
    this.heartbeatPhase += dt;
    if (this.heartbeatPhase >= period) {
      this.heartbeatPhase = 0;
      const now = this.ctx.currentTime;
      // Two-thump pattern: lub-dub with a short gap.
      this.thump(now, 0.6 * this.heartbeatIntensity);
      this.thump(now + 0.18, 0.4 * this.heartbeatIntensity);
      this.lastThumpTs = now;
    }
  }

  /** Fire a footstep click. Caller controls cadence (e.g. every N steps). */
  triggerFootstep(): void {
    if (!this.unlocked || !this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    // Short filtered noise burst — reads as a soft "step" without an asset.
    const dur = 0.06;
    const buf = this.ctx.createBuffer(
      1,
      this.ctx.sampleRate * dur,
      this.ctx.sampleRate
    );
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const env = 1 - i / data.length;
      data[i] = (Math.random() * 2 - 1) * env * env;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 600;
    const gain = this.ctx.createGain();
    gain.gain.value = this.footstepVolume;
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  dispose(): void {
    if (!this.ctx) return;
    for (const n of this.bedNodes) {
      try {
        (n as { stop?: () => void }).stop?.();
        (n as { disconnect?: () => void }).disconnect?.();
      } catch {
        // ignore — context may already be closed
      }
    }
    this.bedNodes = [];
    try {
      this.master?.disconnect();
      void this.ctx.close();
    } catch {
      // ignore
    }
    this.master = null;
    this.bedGain = null;
    this.ctx = null;
    this.unlocked = false;
  }

  // ── internals ────────────────────────────────────────────────────────────
  private startBed(): void {
    if (!this.ctx || !this.master) return;
    // Two slightly detuned low oscillators + a slow LFO on a band-pass
    // filter give a textured drone without needing a recorded loop.
    const bedGain = this.ctx.createGain();
    bedGain.gain.value = this.bedVolume;
    bedGain.connect(this.master);
    this.bedGain = bedGain;

    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 30;
    lfo.connect(lfoGain);

    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 90;
    bp.Q.value = 4;
    lfoGain.connect(bp.frequency);

    const o1 = this.ctx.createOscillator();
    o1.type = "sawtooth";
    o1.frequency.value = 55;
    const o2 = this.ctx.createOscillator();
    o2.type = "sawtooth";
    o2.frequency.value = 56.7;

    o1.connect(bp);
    o2.connect(bp);
    bp.connect(bedGain);

    const now = this.ctx.currentTime;
    o1.start(now);
    o2.start(now);
    lfo.start(now);
    this.bedNodes.push(o1, o2, lfo, bp, bedGain, lfoGain);
  }

  private thump(at: number, amp: number): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    // Quick descending pitch sweep makes a "kick"-like thump.
    osc.frequency.setValueAtTime(140, at);
    osc.frequency.exponentialRampToValueAtTime(40, at + 0.18);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(
      this.heartbeatVolume * amp,
      at + 0.01
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
    osc.connect(gain).connect(this.master);
    osc.start(at);
    osc.stop(at + 0.25);
  }

  private maybeWhisper(): void {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const gap = 4.5 - this.heartbeatIntensity * 2.4;
    if (now - this.lastWhisperTs < gap) return;
    this.lastWhisperTs = now;

    const dur = 0.45 + Math.random() * 0.35;
    const buf = this.ctx.createBuffer(
      1,
      this.ctx.sampleRate * dur,
      this.ctx.sampleRate
    );
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      const env = Math.sin(Math.PI * t);
      data[i] = (Math.random() * 2 - 1) * env * env;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 520 + Math.random() * 260;
    filter.Q.value = 7;
    const pan = this.ctx.createStereoPanner?.();
    const gain = this.ctx.createGain();
    gain.gain.value = 0.045 + this.heartbeatIntensity * 0.08;
    src.connect(filter);
    if (pan) {
      pan.pan.value = Math.random() < 0.5 ? -0.75 : 0.75;
      filter.connect(pan).connect(gain).connect(this.master);
    } else {
      filter.connect(gain).connect(this.master);
    }
    src.start(now);
    src.stop(now + dur);
  }
}
