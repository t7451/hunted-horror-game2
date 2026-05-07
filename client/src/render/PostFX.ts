import * as THREE from "three";
import {
  isMobile,
  resolveGraphicsQuality,
  type GraphicsQuality,
} from "../util/device";
import type { SharedUniforms } from "./uniforms";

// Post-processing pipeline. Built on the pmndrs `postprocessing` package so
// vignette/grain/bloom/LUT all run in a single fullscreen pass with proper
// framebuffer reuse instead of N hand-rolled EffectComposer passes.
//
// The package is dynamically imported so a renderer-only build (e.g. unit
// tests) doesn't pay for it, and so we can ship the engine even if the
// postprocessing optional dep isn't installed yet.

export type PostFX = {
  render: (dt: number) => void;
  setSize: (w: number, h: number) => void;
  dispose: () => void;
  /** True if the composer is fully wired (deps loaded, optional LUT applied or skipped). */
  ready: boolean;
};

export type PostFXOptions = {
  uniforms: SharedUniforms;
  lutUrl?: string;
  quality?: GraphicsQuality;
};

// Type-only shapes for the postprocessing module so TS compiles even when
// the package isn't installed. All real type checking happens at runtime.
type Effect = unknown;
type EffectComposerLike = {
  addPass: (pass: unknown) => void;
  setSize: (w: number, h: number) => void;
  render: (dt?: number) => void;
  dispose?: () => void;
};
type PPModule = {
  EffectComposer: new (
    renderer: THREE.WebGLRenderer,
    opts?: { multisampling?: number }
  ) => EffectComposerLike;
  RenderPass: new (scene: THREE.Scene, camera: THREE.Camera) => unknown;
  EffectPass: new (camera: THREE.Camera, ...effects: Effect[]) => unknown;
  BloomEffect: new (opts?: Record<string, unknown>) => Effect & {
    intensity: number;
  };
  VignetteEffect: new (opts?: Record<string, unknown>) => Effect & {
    darkness: number;
    offset: number;
  };
  NoiseEffect: new (opts?: Record<string, unknown>) => Effect & {
    blendMode: { opacity: { value: number } };
  };
  ChromaticAberrationEffect?: new (opts?: Record<string, unknown>) => Effect;
  SMAAEffect?: new () => Effect;
  LUT3DEffect?: new (lut: unknown) => Effect;
  LUTCubeLoader?: new () => { loadAsync: (url: string) => Promise<unknown> };
};

export async function createPostFX(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  opts: PostFXOptions
): Promise<PostFX> {
  const quality = resolveGraphicsQuality(opts.quality);
  if (quality === "low") {
    return {
      render: () => renderer.render(scene, camera),
      setSize: () => {},
      dispose: () => {},
      ready: false,
    };
  }

  const mod = (await import("postprocessing").catch(
    () => null
  )) as PPModule | null;
  if (!mod) {
    // Graceful fallback: package not installed yet. Caller can still drive a
    // raw renderer.render() — return a stub so callsites don't branch.
    return {
      render: () => renderer.render(scene, camera),
      setSize: () => {},
      dispose: () => {},
      ready: false,
    };
  }

  const composer = new mod.EffectComposer(renderer, {
    multisampling: quality === "high" ? 4 : 0,
  });
  composer.addPass(new mod.RenderPass(scene, camera));

  const bloom = new mod.BloomEffect({
    intensity: opts.uniforms.bloomIntensity.value,
    luminanceThreshold: 0.85, // only practicals bloom
    luminanceSmoothing: 0.2,
    mipmapBlur: true,
  });

  const vignette = new mod.VignetteEffect({
    darkness: opts.uniforms.vignetteDarkness.value,
    offset: opts.uniforms.vignetteOffset.value,
  });

  const noise = new mod.NoiseEffect({ premultiply: true });
  noise.blendMode.opacity.value = opts.uniforms.noiseOpacity.value;

  const effects: Effect[] = [];
  // Mobile drops chromatic aberration and LUT for cost; SMAA fills in for
  // the missing native MSAA.
  if (!isMobile && quality === "high" && mod.ChromaticAberrationEffect) {
    effects.push(
      new mod.ChromaticAberrationEffect({
        offset: new THREE.Vector2(0.0008, 0.0008),
      })
    );
  }

  if (opts.lutUrl && mod.LUTCubeLoader && mod.LUT3DEffect) {
    try {
      const lut = await new mod.LUTCubeLoader().loadAsync(opts.lutUrl);
      effects.push(new mod.LUT3DEffect(lut));
    } catch {
      // Asset not yet committed or network failure — skip color grade
      // rather than block the render path.
    }
  }

  effects.push(bloom);
  effects.push(vignette);
  effects.push(noise);

  // SMAA on mid/low desktop tiers and mobile compensates for disabled MSAA.
  if (quality !== "high" && mod.SMAAEffect) {
    effects.unshift(new mod.SMAAEffect());
  }

  composer.addPass(new mod.EffectPass(camera, ...effects));

  // Live uniform binding — gameplay systems can mutate the shared refs each
  // frame and the next render() picks them up.
  const live = {
    bloom: bloom as unknown as { intensity: number },
    vignette: vignette as unknown as { darkness: number; offset: number },
    noise: noise as unknown as { blendMode: { opacity: { value: number } } },
  };

  return {
    render: (dt: number) => {
      live.bloom.intensity = opts.uniforms.bloomIntensity.value;
      live.vignette.darkness = opts.uniforms.vignetteDarkness.value;
      live.vignette.offset = opts.uniforms.vignetteOffset.value;
      live.noise.blendMode.opacity.value = opts.uniforms.noiseOpacity.value;
      composer.render(dt);
    },
    setSize: (w, h) => composer.setSize(w, h),
    dispose: () => composer.dispose?.(),
    ready: true,
  };
}
