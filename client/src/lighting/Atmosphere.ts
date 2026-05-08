import * as THREE from "three";
import { isMobile } from "../util/device";
import type { ColorProfile } from "@shared/maps";

// Global lighting + fog setup. Replaces the old strong AmbientLight +
// DirectionalLight (which flat-lit the entire interior) with a near-zero
// cold ambient + hemisphere fill, so practicals (lamps, flashlight) are
// the only meaningful light sources. Matches the Granny / RE7 baseline
// the spec calls for: you can't see across a room without a light.

export function setupAtmosphere(scene: THREE.Scene, profile?: ColorProfile) {
  const ambientColor = profile?.ambientColor ?? 0x151c28;
  const ambientIntensity = profile?.ambientIntensity ?? 0.032;
  scene.add(new THREE.AmbientLight(ambientColor, ambientIntensity));

  // Hemisphere gives sky/ground variation without the cost of a proper IBL.
  const hemiSky = profile?.hemiSky ?? 0x26364f;
  const hemiGround = profile?.hemiGround ?? 0x160807;
  const hemi = new THREE.HemisphereLight(hemiSky, hemiGround, 0.1);
  scene.add(hemi);

  // Exponential fog — denser on mobile to mask LOD pop-in once room culling lands.
  const fogColor = profile?.fogColor ?? 0x05070b;
  const baseDensity = profile?.fogDensity ?? 0.048;
  const density = isMobile ? baseDensity * 1.18 : baseDensity;
  scene.fog = new THREE.FogExp2(fogColor, density);
  scene.background = new THREE.Color(fogColor);
}
