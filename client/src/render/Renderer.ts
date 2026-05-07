import * as THREE from "three";
import {
  isMobile,
  pixelRatioForQuality,
  resolveGraphicsQuality,
  tier,
  type GraphicsQuality,
} from "../util/device";

// Single source of truth for renderer construction.
// Phase 2 of the visual overhaul: tier-aware shadow + AA selection so
// PostFX (next file) can layer SMAA on mobile without paying for MSAA twice.

export type CreatedRenderer = {
  renderer: THREE.WebGLRenderer;
  contextLost: () => boolean;
  detachContextHandlers: () => void;
};

export type RendererOptions = {
  canvas?: HTMLCanvasElement;
  quality?: GraphicsQuality;
};

export function createRenderer(options: RendererOptions = {}): CreatedRenderer {
  const quality = resolveGraphicsQuality(options.quality);
  const renderer = new THREE.WebGLRenderer({
    canvas: options.canvas,
    // SMAA via PostFX handles mobile AA so we skip native MSAA on phones.
    antialias: !isMobile && quality !== "low",
    powerPreference: "high-performance",
    stencil: false,
    depth: true,
  });
  renderer.setPixelRatio(pixelRatioForQuality(options.quality));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = quality === "low" ? 0.78 : 0.85;
  renderer.shadowMap.enabled = quality !== "low";
  // BasicShadowMap on mobile sidesteps the SpotLight+PCF crash class on
  // some Android drivers and is dramatically cheaper.
  renderer.shadowMap.type =
    isMobile || quality === "mid"
      ? THREE.BasicShadowMap
      : THREE.PCFSoftShadowMap;

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
      renderer.domElement.removeEventListener(
        "webglcontextrestored",
        onRestored
      );
    },
  };
}

export { tier };
