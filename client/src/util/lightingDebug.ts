// client/src/util/lightingDebug.ts
//
// Throttled lighting state dump used to diagnose "scene renders pure black"
// regressions. Enabled via the ?lightdebug=1 URL flag from engine.ts. Logs
// every 2s; screams loudly if total illumination falls below the floor we
// know is needed for ambient PBR materials to read at all.

import * as THREE from "three";

let lastLog = 0;
const LOG_INTERVAL_MS = 2000;

type FogLike = THREE.Fog | THREE.FogExp2 | null;

function fogColorHex(fog: FogLike): string {
  if (!fog) return "none";
  return `#${fog.color.getHexString()}`;
}

function fogNear(fog: FogLike): string {
  if (fog instanceof THREE.Fog) return fog.near.toFixed(1);
  return "n/a";
}

function fogFar(fog: FogLike): string {
  if (fog instanceof THREE.Fog) return fog.far.toFixed(1);
  return "n/a";
}

export function dumpLightingState(
  scene: THREE.Scene,
  camera: THREE.Camera,
  renderer: THREE.WebGLRenderer
): void {
  const now = performance.now();
  if (now - lastLog < LOG_INTERVAL_MS) return;
  lastLog = now;

  let ambientCount = 0;
  let ambientTotal = 0;
  let hemiCount = 0;
  let hemiTotal = 0;
  let pointCount = 0;
  let pointTotal = 0;
  let pointVisibleCount = 0;
  let spotCount = 0;
  let spotTotal = 0;
  let dirCount = 0;
  let dirTotal = 0;
  let nearestPointDist = Infinity;
  let nearestPointIntensity = 0;

  scene.traverse(obj => {
    if (obj instanceof THREE.AmbientLight) {
      ambientCount++;
      ambientTotal += obj.intensity;
    } else if (obj instanceof THREE.HemisphereLight) {
      hemiCount++;
      hemiTotal += obj.intensity;
    } else if (obj instanceof THREE.PointLight) {
      pointCount++;
      pointTotal += obj.intensity;
      if (obj.visible && obj.intensity > 0.001) {
        pointVisibleCount++;
        const d = obj.position.distanceTo(camera.position);
        if (d < nearestPointDist) {
          nearestPointDist = d;
          nearestPointIntensity = obj.intensity;
        }
      }
    } else if (obj instanceof THREE.SpotLight) {
      spotCount++;
      spotTotal += obj.intensity;
    } else if (obj instanceof THREE.DirectionalLight) {
      dirCount++;
      dirTotal += obj.intensity;
    }
  });

  const fog = scene.fog as FogLike;

  // eslint-disable-next-line no-console
  console.log("[LIGHT DUMP]", {
    ambient: { count: ambientCount, totalIntensity: ambientTotal.toFixed(3) },
    hemi: { count: hemiCount, totalIntensity: hemiTotal.toFixed(3) },
    point: {
      count: pointCount,
      visible: pointVisibleCount,
      totalIntensity: pointTotal.toFixed(3),
      nearestDist:
        nearestPointDist === Infinity ? "none" : nearestPointDist.toFixed(2),
      nearestIntensity: nearestPointIntensity.toFixed(3),
    },
    spot: { count: spotCount, totalIntensity: spotTotal.toFixed(3) },
    dir: { count: dirCount, totalIntensity: dirTotal.toFixed(3) },
    renderer: {
      toneMappingExposure: renderer.toneMappingExposure,
      shadowMapEnabled: renderer.shadowMap.enabled,
      pixelRatio: renderer.getPixelRatio().toFixed(2),
    },
    fog: {
      enabled: !!fog,
      color: fogColorHex(fog),
      near: fogNear(fog),
      far: fogFar(fog),
    },
    sceneBg:
      scene.background instanceof THREE.Color
        ? `#${scene.background.getHexString()}`
        : "none",
  });

  // Hard warning: if literally nothing illuminates the scene, log loud.
  // Hemisphere lights count for the floor — a 0.1 hemi alone keeps the
  // scene visible enough to play through.
  const visibleFraction = pointVisibleCount / Math.max(1, pointCount);
  const totalIllum =
    ambientTotal +
    hemiTotal +
    pointTotal * visibleFraction +
    spotTotal +
    dirTotal;
  if (totalIllum < 0.05) {
    // eslint-disable-next-line no-console
    console.error(
      "[SCENE BLACK] No effective light reaching scene. Total illumination:",
      totalIllum.toFixed(4)
    );
  }
}
