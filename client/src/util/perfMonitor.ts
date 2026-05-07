import type { WebGLRenderer } from "three";
import { isMobile } from "./device";

// Lightweight perf HUD — only mounts when `?perf=1` is in the URL.
// Logs renderer.info every 60 frames so we can track draw-call/triangle budgets.

// Texture-memory budgets per spec §6 — Three exposes a count, not bytes,
// so use it as a proxy: warn if we're holding more textures than typical
// for a "lit interior with PBR walls + props" scene.
const TEXTURE_BUDGET = isMobile ? 32 : 64;
const DRAW_CALL_SOFT_BUDGET = 12000;
const TRIANGLE_SOFT_BUDGET = 500_000;

export type PerfMonitor = {
  begin: () => void;
  end: (renderer: WebGLRenderer) => void;
  dispose: () => void;
};

type StatsLike = {
  dom: HTMLElement;
  begin: () => void;
  end: () => void;
};

export function createPerfMonitor(enabled: boolean): PerfMonitor {
  if (!enabled) {
    return { begin: noop, end: noop, dispose: noop };
  }

  let stats: StatsLike | null = null;
  // Dynamic import so non-perf sessions don't pay the cost.
  void import("three-stdlib")
    .then((mod) => {
      const StatsCtor = (mod as { Stats?: new () => StatsLike }).Stats;
      if (!StatsCtor) return;
      stats = new StatsCtor();
      stats.dom.style.position = "fixed";
      stats.dom.style.top = "8px";
      stats.dom.style.right = "8px";
      stats.dom.style.left = "auto";
      stats.dom.style.zIndex = "9999";
      document.body.appendChild(stats.dom);
    })
    .catch(() => {
      // three-stdlib not installed yet; HUD is opt-in so silently skip.
    });

  let frame = 0;
  let lastLogTs = performance.now();
  const warned = { textures: false, calls: false, triangles: false };

  return {
    begin: () => stats?.begin(),
    end: (renderer: WebGLRenderer) => {
      stats?.end();
      frame++;
      if (frame % 60 === 0) {
        const now = performance.now();
        const fps = Math.round(60000 / (now - lastLogTs));
        lastLogTs = now;
        const info = renderer.info;
        const calls = info.render.calls;
        const triangles = info.render.triangles;
        const textures = info.memory.textures;
        // eslint-disable-next-line no-console
        console.log("[perf]", {
          fps,
          calls,
          triangles,
          programs: info.programs?.length ?? 0,
          textures,
          geometries: info.memory.geometries,
        });
        // Soft-budget warnings — fire once when we cross the threshold
        // upward, so perf-tuning sessions get a clear signal in the
        // console without spam.
        if (textures > TEXTURE_BUDGET && !warned.textures) {
          // eslint-disable-next-line no-console
          console.warn(
            `[perf] texture count ${textures} exceeds budget ${TEXTURE_BUDGET}`,
          );
          warned.textures = true;
        }
        if (calls > DRAW_CALL_SOFT_BUDGET && !warned.calls) {
          // eslint-disable-next-line no-console
          console.warn(
            `[perf] draw calls ${calls} exceed soft budget ${DRAW_CALL_SOFT_BUDGET}`,
          );
          warned.calls = true;
        }
        if (triangles > TRIANGLE_SOFT_BUDGET && !warned.triangles) {
          // eslint-disable-next-line no-console
          console.warn(
            `[perf] triangles ${triangles} exceed soft budget ${TRIANGLE_SOFT_BUDGET}`,
          );
          warned.triangles = true;
        }
      }
    },
    dispose: () => {
      if (stats?.dom.parentNode) stats.dom.parentNode.removeChild(stats.dom);
      stats = null;
    },
  };
}

function noop() {}
