// Shared uniform refs that bridge gameplay state into the PostFX stack.
// Heartbeat (Phase 7) will pulse vignette intensity through `vignetteDarkness`,
// damage spikes will bump `chromaticAberration`, etc. Kept as plain refs so
// non-shader systems can write them without importing postprocessing types.

export type SharedUniforms = {
  vignetteDarkness: { value: number };
  vignetteOffset: { value: number };
  noiseOpacity: { value: number };
  bloomIntensity: { value: number };
};

export function createSharedUniforms(): SharedUniforms {
  return {
    vignetteDarkness: { value: 0.68 },
    vignetteOffset: { value: 0.28 },
    noiseOpacity: { value: 0.08 },
    bloomIntensity: { value: 0.45 },
  };
}
