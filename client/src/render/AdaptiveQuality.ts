import type { WebGLRenderer } from "three";

const SAMPLE_WINDOW_MS = 3000;
const FPS_DROP_THRESHOLD = 30;
const FPS_RAISE_THRESHOLD = 55;
const MIN_DPR = 0.6;
const MAX_DPR = 2.0;
const STEP = 0.1;
const MIN_SAMPLES = 60;

/**
 * Watches frame deltas and adjusts the renderer pixel ratio when the FPS
 * average drifts outside the comfort band. A 4-second cooldown after each
 * change prevents oscillation.
 */
export class AdaptiveQuality {
  private samples: number[] = [];
  private lastTs = performance.now();
  private currentDpr: number;
  private lastChange = 0;
  private readonly cooldownMs = 4000;
  private readonly maxSamples = SAMPLE_WINDOW_MS / 16;

  constructor(
    private renderer: WebGLRenderer,
    private maxDpr: number = MAX_DPR
  ) {
    this.currentDpr = Math.min(maxDpr, renderer.getPixelRatio());
  }

  tick(): void {
    const now = performance.now();
    const dt = now - this.lastTs;
    this.lastTs = now;
    if (dt <= 0 || dt > 100) return;

    const fps = 1000 / dt;
    this.samples.push(fps);
    if (this.samples.length > this.maxSamples) this.samples.shift();
    if (this.samples.length < MIN_SAMPLES) return;
    if (now - this.lastChange < this.cooldownMs) return;

    let sum = 0;
    for (const s of this.samples) sum += s;
    const avg = sum / this.samples.length;

    if (avg < FPS_DROP_THRESHOLD && this.currentDpr > MIN_DPR) {
      this.currentDpr = Math.max(MIN_DPR, this.currentDpr - STEP);
      this.renderer.setPixelRatio(this.currentDpr);
      this.lastChange = now;
      this.samples.length = 0;
    } else if (avg > FPS_RAISE_THRESHOLD && this.currentDpr < this.maxDpr) {
      this.currentDpr = Math.min(this.maxDpr, this.currentDpr + STEP);
      this.renderer.setPixelRatio(this.currentDpr);
      this.lastChange = now;
      this.samples.length = 0;
    }
  }

  getCurrentDpr(): number {
    return this.currentDpr;
  }
}
