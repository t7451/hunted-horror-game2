// client/src/audio/SpatialAudio.ts
// Thin wrapper over Howler's positional-audio API. Each play() call binds a
// specific Howl playback id to a world (x, y, z) and a per-source occlusion
// value. The listener position/orientation is updated each frame from the
// camera. Volume is smoothed toward base * (1 - occlusion * 0.7) in tick().

import { Howl, Howler } from "howler";
import { AUDIO_MANIFEST, type SoundId } from "./audio-manifest";

type ListenerState = { x: number; y: number; z: number; yaw: number };
type SourceState = {
  id: number; // howler sound id
  howl: Howl;
  soundId: SoundId;
  x: number;
  y: number;
  z: number;
  occlusion: number; // 0 = clear, 1 = fully occluded
  baseVolume: number;
  active: boolean;
};

const OCCLUSION_LERP = 6; // higher = snappier transitions through walls

export class SpatialAudio {
  private sources = new Map<number, SourceState>();
  private listener: ListenerState = { x: 0, y: 1.6, z: 0, yaw: 0 };

  setListener(x: number, y: number, z: number, yaw: number): void {
    this.listener.x = x;
    this.listener.y = y;
    this.listener.z = z;
    this.listener.yaw = yaw;
    // Howler.pos / Howler.orientation drive the AudioListener that backs all
    // spatial sources. They're guarded because Howler can be in non-Web-Audio
    // mode (HTML5 fallback) where these are no-ops.
    try {
      Howler.pos(x, y, z);
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      Howler.orientation(fx, 0, fz, 0, 1, 0);
    } catch {
      /* ignore */
    }
  }

  /**
   * Play a manifest sound at a world position. Returns a handle id usable
   * with move() / stop() / setOcclusion(). For looping spatial sounds, call
   * once and update position via move().
   */
  play(soundId: SoundId, howl: Howl, x: number, y: number, z: number): number {
    const def = AUDIO_MANIFEST[soundId];
    if (!def?.spatial) {
      // Non-spatial — caller used wrong API; play normally and don't track.
      return howl.play();
    }

    const id = howl.play();
    try {
      // The Howler typings only declare `inverse | linear`, but the Web
      // Audio runtime supports `exponential` and that's what we want for
      // distance falloff. Cast through the typed shape.
      howl.pannerAttr(
        {
          panningModel: "HRTF",
          distanceModel: "inverse",
          refDistance: def.refDistance ?? 2,
          rolloffFactor: def.rolloffFactor ?? 1,
          maxDistance: def.maxDistance ?? 20,
          coneInnerAngle: 360,
          coneOuterAngle: 0,
          coneOuterGain: 0,
        },
        id,
      );
      howl.pos(x, y, z, id);
    } catch {
      /* ignore — non-spatial Howler backend */
    }

    this.sources.set(id, {
      id,
      howl,
      soundId,
      x,
      y,
      z,
      occlusion: 0,
      baseVolume: def.volume,
      active: true,
    });
    return id;
  }

  move(handleId: number, x: number, y: number, z: number): void {
    const src = this.sources.get(handleId);
    if (!src || !src.active) return;
    src.x = x;
    src.y = y;
    src.z = z;
    try {
      src.howl.pos(x, y, z, handleId);
    } catch {
      /* ignore */
    }
  }

  stop(handleId: number): void {
    const src = this.sources.get(handleId);
    if (!src) return;
    src.active = false;
    try {
      src.howl.stop(handleId);
    } catch {
      /* ignore */
    }
    this.sources.delete(handleId);
  }

  /** Set the occlusion target (0..1) for a source. tick() lerps the volume. */
  setOcclusion(handleId: number, target: number): void {
    const src = this.sources.get(handleId);
    if (!src) return;
    src.occlusion = target;
  }

  /** Per-frame volume update — applies smoothed occlusion to active sources. */
  tick(dt: number): void {
    const k = 1 - Math.exp(-OCCLUSION_LERP * dt);
    for (const src of this.sources.values()) {
      if (!src.active) continue;
      // Approximate occlusion via volume drop. Full HRTF panning stays
      // intact; perceptually muffled is enough for gameplay.
      const targetVol = src.baseVolume * (1 - src.occlusion * 0.7);
      let currentVol = src.baseVolume;
      try {
        currentVol = src.howl.volume(src.id) as number;
      } catch {
        /* ignore */
      }
      const newVol = currentVol + (targetVol - currentVol) * k;
      try {
        src.howl.volume(newVol, src.id);
      } catch {
        /* ignore */
      }
    }
  }

  getSources(): IterableIterator<SourceState> {
    return this.sources.values();
  }

  dispose(): void {
    for (const src of this.sources.values()) {
      try {
        src.howl.stop(src.id);
      } catch {
        /* ignore */
      }
    }
    this.sources.clear();
  }
}

export type { SourceState as SpatialSourceState };
