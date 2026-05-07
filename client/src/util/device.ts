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
