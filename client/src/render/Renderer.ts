import * as THREE from "three";
import { dpr, isMobile, tier } from "../util/device";

// Single source of truth for renderer construction.
// Phase 2 of the visual overhaul: tier-aware shadow + AA selection so
// PostFX (next file) can layer SMAA on mobile without paying for MSAA twice.

export type CreatedRenderer = {
  renderer: THREE.WebGLRenderer;
  contextLost: () => boolean;
  detachContextHandlers: () => void;
};

export function createRenderer(canvas?: HTMLCanvasElement): CreatedRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    // SMAA via PostFX handles mobile AA so we skip native MSAA on phones.
    antialias: !isMobile,
    powerPreference: "high-performance",
    stencil: false,
    depth: true,
  });
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = true;
  // BasicShadowMap on mobile sidesteps the SpotLight+PCF crash class on
  // some Android drivers and is dramatically cheaper.
  renderer.shadowMap.type = isMobile ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;

  let lost = false;
  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
  };
  const onRestored = () => {
    lost = false;
  };
  renderer.domElement.addEventListener("webglcontextlost", onLost);
  renderer.domElement.addEventListener("webglcontextrestored", onRestored);

  return {
    renderer,
    contextLost: () => lost,
    detachContextHandlers: () => {
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onRestored);
    },
  };
}

export { tier };
