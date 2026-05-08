// Edge-of-screen direction indicator for the Observer. Reads
// engine.getObserverIndicatorState() each frame and only shows when the
// Observer is off-screen (|relative-angle| > 0.9 rad ≈ 51°) and within
// audible range. Lets the player triangulate the threat by ear + this cue.

import { useEffect, useRef } from "react";
import type { EngineHandle } from "../game/engine";
import { ChromaticText } from "./analog";

export type ObserverIndicatorProps = {
  engine: EngineHandle | null;
};

export function ObserverIndicator({ engine }: ObserverIndicatorProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!engine) return;
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      if (!el) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const state = engine.getObserverIndicatorState();
      const offScreen = Math.abs(state.angleRelative) > 0.9;
      if (!offScreen || state.intensity < 0.05) {
        el.style.opacity = "0";
        raf = requestAnimationFrame(tick);
        return;
      }
      el.style.opacity = String(state.intensity * 0.85);
      // angleRelative: 0 = straight ahead, ±π/2 = sides, ±π = behind.
      // Map to a circle ~42% of viewport (centered) so the arrow always sits
      // near the screen edge.
      const screenX = 0.5 + Math.sin(state.angleRelative) * 0.42;
      const screenY = 0.5 - Math.cos(state.angleRelative) * 0.42;
      el.style.left = `${screenX * 100}%`;
      el.style.top = `${screenY * 100}%`;
      el.style.transform = `translate(-50%, -50%) rotate(${state.angleRelative}rad)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  return (
    <div
      ref={ref}
      className="absolute z-20 pointer-events-none transition-opacity duration-200"
      style={{ opacity: 0 }}
      aria-hidden="true"
    >
      <svg width="48" height="48" viewBox="-12 -12 24 24">
        <path
          d="M 0 -8 L 6 4 L 0 1 L -6 4 Z"
          fill="rgb(248 113 113)"
          stroke="rgba(0,0,0,0.6)"
          strokeWidth="1"
          style={{ filter: "drop-shadow(0 0 6px rgba(248,113,113,0.6))" }}
        />
      </svg>
      <ChromaticText
        as="div"
        offset="auto"
        className="text-[10px] tracking-[0.3em] uppercase text-white/70 text-center leading-none mt-0.5"
      >
        PROXIMITY
      </ChromaticText>
    </div>
  );
}
