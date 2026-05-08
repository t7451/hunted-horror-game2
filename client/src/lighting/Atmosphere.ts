import * as THREE from "three";
import { isMobile } from "../util/device";
import type { ColorProfile } from "@shared/maps";

// Global lighting + fog setup. Replaces the old strong AmbientLight +
// DirectionalLight (which flat-lit the entire interior) with a near-zero
// cold ambient + hemisphere fill, so practicals (lamps, flashlight) are
// the only meaningful light sources. Matches the Granny / RE7 baseline
// the spec calls for: you can't see across a room without a light.

/**
 * Lift any color whose perceived luminance is below `minBrightness`
 * (0..1) toward gray. Defends against per-map color profiles that set
 * fog or ambient to pure black, which would either occlude the scene
 * with black fog or leave PBR materials completely unlit.
 */
function clampColor(hex: number, minBrightness = 0.04): number {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (luminance >= minBrightness) return hex;
  const lift = (minBrightness - luminance) / (1 - luminance);
  const nr = r + (1 - r) * lift;
  const ng = g + (1 - g) * lift;
  const nb = b + (1 - b) * lift;
  return (
    (Math.round(nr * 255) << 16) |
    (Math.round(ng * 255) << 8) |
    Math.round(nb * 255)
  );
}

export function setupAtmosphere(scene: THREE.Scene, profile?: ColorProfile) {
  // Per-map colorProfile values are clamped to a minimum perceived luminance
  // so a Basement-style profile with `ambientColor: 0x000000` can never make
  // PBR materials read as pure black (Hotfix 11.1).
  const ambientColor = clampColor(profile?.ambientColor ?? 0x151c28);
  const ambientIntensity = Math.max(0.05, profile?.ambientIntensity ?? 0.032);
  scene.add(new THREE.AmbientLight(ambientColor, ambientIntensity));

  // Baseline ambient — a small, neutral-gray AmbientLight that we never
  // touch again. Even if every practical is culled and the profile ambient
  // is somehow zeroed, this keeps the scene dim instead of pitch black.
  // Intentionally NOT registered with LightCuller — it's a global, not a
  // positional point light.
  const baseline = new THREE.AmbientLight(0x1a1a22, 0.08);
  baseline.name = "baseline_ambient";
  scene.add(baseline);

  // Hemisphere gives sky/ground variation without the cost of a proper IBL.
  const hemiSky = clampColor(profile?.hemiSky ?? 0x26364f);
  const hemiGround = clampColor(profile?.hemiGround ?? 0x160807);
  const hemi = new THREE.HemisphereLight(hemiSky, hemiGround, 0.1);
  scene.add(hemi);

  // Exponential fog — denser on mobile to mask LOD pop-in once room culling lands.
  // Fog is hard-clamped to a tiny non-zero color so we never render a
  // black fog wall over the scene.
  const fogColor = clampColor(profile?.fogColor ?? 0x05070b, 0.02);
  const baseDensity = profile?.fogDensity ?? 0.048;
  const density = isMobile ? baseDensity * 1.18 : baseDensity;
  scene.fog = new THREE.FogExp2(fogColor, density);
  scene.background = new THREE.Color(fogColor);
}
