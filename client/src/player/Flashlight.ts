import * as THREE from "three";
import { isMobile } from "../util/device";

// Mobile gating is non-negotiable: SpotLight + castShadow crashes WebGL on
// some Android drivers (see spec §0). Mobile gets an unshadowed PointLight
// attached to the camera; desktop keeps the cone-cast SpotLight we had
// before, with a tightened distance so it reads as a flashlight instead of
// a room light.

export type FlashlightHandle = {
  toggle: () => void;
  isOn: () => boolean;
  dispose: () => void;
  /** Underlying light — exposed so Phase 6 ShadowBudget can register it. */
  light: THREE.Light;
};

export function createFlashlight(camera: THREE.Camera): FlashlightHandle {
  if (isMobile) {
    const light = new THREE.PointLight(0xfff0d0, 2.5, 12, 1.8);
    camera.add(light);
    return {
      toggle: () => {
        light.visible = !light.visible;
      },
      isOn: () => light.visible,
      dispose: () => {
        camera.remove(light);
        light.dispose();
      },
      light,
    };
  }

  const light = new THREE.SpotLight(0xfff0d0, 8, 18, Math.PI / 6, 0.4, 1.5);
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

  return {
    toggle: () => {
      light.visible = !light.visible;
    },
    isOn: () => light.visible,
    dispose: () => {
      camera.remove(light);
      camera.remove(target);
      light.dispose();
    },
    light,
  };
}
