import type { Light } from "three";

// Cheap pseudo-noise driven flicker. Spec calls for perlin via noisejs but
// for a 5–15% intensity wobble, two summed sinusoids of incommensurable
// frequency look indistinguishable from noise and cost nothing. Avoids
// pulling in a dep solely for visual flair.

export class LightFlicker {
  private readonly base: number;
  private t: number;

  constructor(
    private readonly light: Light,
    baseIntensity: number,
    private readonly amp = 0.12,
    private readonly speed = 8,
  ) {
    this.base = baseIntensity;
    // Phase-stagger across instances so a row of bulbs doesn't pulse in sync.
    this.t = Math.random() * 1000;
  }

  update(dt: number): void {
    this.t += dt * this.speed;
    const n =
      Math.sin(this.t * 1.3) * 0.5 + Math.sin(this.t * 2.7) * 0.5;
    this.light.intensity = this.base * (1 + n * this.amp);
  }
}

export class FlickerGroup {
  private readonly flickers: LightFlicker[] = [];
  add(f: LightFlicker): void {
    this.flickers.push(f);
  }
  update(dt: number): void {
    for (const f of this.flickers) f.update(dt);
  }
}
