import * as THREE from "three";
import { isMobile } from "../util/device";

// Only the explicit value "1" enables debug logging — `?lightdebug=0`
// (or presence-only) should NOT count as on. Mirrors the parsing used in
// engine.ts for the same flag.
const FLASHLIGHT_DEBUG =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("lightdebug") === "1";

function logFlashlightInit(light: THREE.Light, camera: THREE.Camera): void {
  if (!FLASHLIGHT_DEBUG) return;
  const distance =
    light instanceof THREE.PointLight || light instanceof THREE.SpotLight
      ? light.distance
      : null;
  console.log("[FLASHLIGHT INIT]", {
    type: light.type,
    intensity: light.intensity,
    distance,
    parent: light.parent?.name || light.parent?.type || "NONE",
    isAttachedToCamera:
      light.parent === camera || light.parent?.parent === camera,
    visible: light.visible,
  });
}

// Mobile gating is non-negotiable: SpotLight + castShadow crashes WebGL on
// some Android drivers (see spec §0). Mobile gets an unshadowed PointLight
// attached to the camera; desktop keeps the cone-cast SpotLight we had
// before, with a tightened distance so it reads as a flashlight instead of
// a room light.

export type FlashlightHandle = {
  toggle: () => void;
  isOn: () => boolean;
  setAnxiety: (intensity: number, elapsed: number) => void;
  /** Battery charge 0..1 — scales intensity & distance. */
  setBattery: (charge: number) => void;
  dispose: () => void;
  /** Underlying light — exposed so Phase 6 ShadowBudget can register it. */
  light: THREE.Light;
};

export function createFlashlight(camera: THREE.Camera): FlashlightHandle {
  if (isMobile) {
    const light = new THREE.PointLight(0xfff0d0, 2.5, 12, 1.8);
    const baseIntensity = light.intensity;
    const baseDistance = light.distance;
    let battery = 1;
    let anxietyScale = 1;
    let anxietyDist = 1;
    camera.add(light);
    logFlashlightInit(light, camera);
    const apply = () => {
      // Battery curve: 100% → 1.0, 25% → ~0.6, 5% → ~0.2 (deep cut at the
      // end). Anxiety can attenuate further (panic tremor), but we floor
      // both at non-zero so a transient panic spike or near-empty battery
      // doesn't leave the player in pitch black with the light "on".
      const b = THREE.MathUtils.clamp(battery, 0, 1);
      const batteryScale = b < 0.05 ? 0 : 0.2 + b * 0.8;
      const intensity = baseIntensity * anxietyScale * batteryScale;
      light.intensity = batteryScale === 0 ? 0 : Math.max(0.3, intensity);
      light.distance = baseDistance * anxietyDist * (0.6 + 0.4 * b);
    };
    return {
      toggle: () => {
        light.visible = !light.visible;
      },
      isOn: () => light.visible,
      setAnxiety: (intensity, elapsed) => {
        if (!light.visible) return;
        const panic = THREE.MathUtils.clamp(intensity, 0, 1);
        const tremor =
          Math.sin(elapsed * 37.1) * 0.08 + Math.sin(elapsed * 83.7) * 0.035;
        anxietyScale = 1 - panic * 0.28 + tremor * panic;
        anxietyDist = 1 - panic * 0.18;
        apply();
      },
      setBattery: charge => {
        battery = charge;
        apply();
      },
      dispose: () => {
        camera.remove(light);
        light.dispose();
      },
      light,
    };
  }

  const light = new THREE.SpotLight(0xfff0d0, 8, 18, Math.PI / 6, 0.4, 1.5);
  const baseIntensity = light.intensity;
  const baseDistance = light.distance;
  const baseAngle = light.angle;
  let battery = 1;
  let anxietyScale = 1;
  let anxietyDist = 1;
  let anxietyAngle = 1;
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.bias = -0.0008;
  light.shadow.camera.near = 0.5;
  light.shadow.camera.far = 18;
  light.position.set(0.25, -0.15, 0);

  const target = new THREE.Object3D();
  target.position.set(0, 0, -1);
  light.target = target;
  camera.add(light, target);
  logFlashlightInit(light, camera);

  const apply = () => {
    // See mobile-branch apply(): same battery curve, with a floor on the
    // resulting intensity (unless the battery is dead) so panic tremor or
    // near-empty battery can't drive the cone to pitch black while the
    // flashlight is still nominally "on".
    const b = THREE.MathUtils.clamp(battery, 0, 1);
    const batteryScale = b < 0.05 ? 0 : 0.2 + b * 0.8;
    const intensity = baseIntensity * anxietyScale * batteryScale;
    light.intensity = batteryScale === 0 ? 0 : Math.max(0.3, intensity);
    light.distance = baseDistance * anxietyDist * (0.6 + 0.4 * b);
    light.angle = baseAngle * anxietyAngle * (0.85 + 0.15 * b);
  };

  return {
    toggle: () => {
      light.visible = !light.visible;
    },
    isOn: () => light.visible,
    setAnxiety: (intensity, elapsed) => {
      if (!light.visible) return;
      const panic = THREE.MathUtils.clamp(intensity, 0, 1);
      const tremor =
        Math.sin(elapsed * 31.7) * 0.1 + Math.sin(elapsed * 71.3) * 0.045;
      anxietyScale = 1 - panic * 0.35 + tremor * panic;
      anxietyDist = 1 - panic * 0.22;
      anxietyAngle = 1 - panic * 0.18;
      apply();
    },
    setBattery: charge => {
      battery = charge;
      apply();
    },
    dispose: () => {
      camera.remove(light);
      camera.remove(target);
      light.dispose();
    },
    light,
  };
}
