import * as THREE from "three";
import { isMobile } from "../util/device";

// Global lighting + fog setup. Replaces the old strong AmbientLight +
// DirectionalLight (which flat-lit the entire interior) with a near-zero
// cold ambient + hemisphere fill, so practicals (lamps, flashlight) are
// the only meaningful light sources. Matches the Granny / RE7 baseline
// the spec calls for: you can't see across a room without a light.

export function setupAtmosphere(scene: THREE.Scene) {
  // Cold global fill — kept under 0.06 so practicals dominate.
  scene.add(new THREE.AmbientLight(0x151c28, 0.032));

  // Hemisphere gives sky/ground variation without the cost of a proper IBL.
  const hemi = new THREE.HemisphereLight(0x26364f, 0x160807, 0.1);
  scene.add(hemi);

  // Exponential fog — denser on mobile to mask LOD pop-in and shorter draw
  // distance once room culling lands in Phase 6.
  scene.fog = new THREE.FogExp2(0x05070b, isMobile ? 0.058 : 0.048);
  scene.background = new THREE.Color(0x05070b);
}
