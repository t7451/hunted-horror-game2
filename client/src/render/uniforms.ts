// Shared uniform refs that bridge gameplay state into the PostFX stack.
// Heartbeat (Phase 7) will pulse vignette intensity through `vignetteDarkness`,
// damage spikes will bump `chromaticAberration`, etc. Kept as plain refs so
// non-shader systems can write them without importing postprocessing types.

export type SharedUniforms = {
  vignetteDarkness: { value: number };
  vignetteOffset: { value: number };
  noiseOpacity: { value: number };
  bloomIntensity: { value: number };
  /** Per-axis offset applied to ChromaticAberrationEffect each frame. */
  chromaticAberrationStrength: { value: number };
};

export function createSharedUniforms(): SharedUniforms {
  return {
    vignetteDarkness: { value: 0.82 },
    vignetteOffset: { value: 0.28 },
    noiseOpacity: { value: 0.055 },
    bloomIntensity: { value: 1.4 },
    chromaticAberrationStrength: { value: 0 },
  };
}
