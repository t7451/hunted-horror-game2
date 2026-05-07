// Single source of truth for capability gating.
// Used by renderer/lighting/post-processing to branch on mobile vs desktop.

const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

export const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
export const isIOS = /iPhone|iPad|iPod/i.test(ua);
export const isAndroid = /Android/i.test(ua);

export const dpr =
  typeof window !== "undefined"
    ? Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2)
    : 1;

export type Tier = "low" | "mid" | "high";
export type GraphicsQuality = "auto" | Tier;

export const tier: Tier = (() => {
  if (typeof document === "undefined") return "mid";
  if (isMobile) return "low";
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
    if (!gl) return "low";
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = dbg
      ? (gl.getParameter(
          (dbg as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL,
        ) as string)
      : "";
    if (/Intel/i.test(renderer)) return "mid";
    return "high";
  } catch {
    return "mid";
  }
})();

export const perfFlag =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("perf");

export function resolveGraphicsQuality(quality: GraphicsQuality = "auto"): Tier {
  return quality === "auto" ? tier : quality;
}

export function pixelRatioForQuality(quality: GraphicsQuality = "auto") {
  const resolved = resolveGraphicsQuality(quality);
  if (typeof window === "undefined") return 1;
  const raw = window.devicePixelRatio || 1;
  if (resolved === "low") return Math.min(raw, isMobile ? 1.25 : 1.5);
  if (resolved === "mid") return Math.min(raw, 1.75);
  return Math.min(raw, 2);
}

export function supportsWebGL() {
  if (typeof document === "undefined") return true;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}
