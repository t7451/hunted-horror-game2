import * as THREE from "three";

// Factory for placed light sources (lamps, candles, ceiling bulbs, key
// markers). All practicals are warm tungsten by default; the threat
// carries a cold-blue light which is created via this same factory so
// the budget enforcement in Phase 6 can treat them uniformly.

export type PracticalOptions = {
  position: THREE.Vector3;
  color?: number;
  intensity?: number;
  distance?: number;
  decay?: number;
  castShadow?: boolean;
};

export function createPractical(opts: PracticalOptions): THREE.PointLight {
  const {
    position,
    color = 0xffaa55,
    intensity = 1.2,
    distance = 6,
    decay = 2,
    castShadow = false,
  } = opts;
  const light = new THREE.PointLight(color, intensity, distance, decay);
  light.position.copy(position);
  light.castShadow = castShadow;
  if (castShadow) {
    // Small map — interior practicals don't need a high-res shadow.
    light.shadow.mapSize.set(512, 512);
    light.shadow.bias = -0.0005;
    light.shadow.radius = 4;
  }
  return light;
}
