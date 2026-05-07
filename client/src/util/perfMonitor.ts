import type { WebGLRenderer } from "three";

// Lightweight perf HUD — only mounts when `?perf=1` is in the URL.
// Logs renderer.info every 60 frames so we can track draw-call/triangle budgets.

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
        // eslint-disable-next-line no-console
        console.log("[perf]", {
          fps,
          calls: info.render.calls,
          triangles: info.render.triangles,
          programs: info.programs?.length ?? 0,
          textures: info.memory.textures,
          geometries: info.memory.geometries,
        });
      }
    },
    dispose: () => {
      if (stats?.dom.parentNode) stats.dom.parentNode.removeChild(stats.dom);
      stats = null;
    },
  };
}

function noop() {}
