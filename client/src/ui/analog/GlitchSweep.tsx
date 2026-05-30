// client/src/ui/analog/GlitchSweep.tsx
import { useEffect, useRef, useState } from "react";
import "./GlitchSweep.css";

interface Props {
  threshold?: number;
}

const POLL_MS = 400;

function readIntensity(): number {
  if (typeof document === "undefined") return 0;
  const cs = getComputedStyle(document.documentElement);
  const t = parseFloat(cs.getPropertyValue("--tension")) || 0;
  const s = parseFloat(cs.getPropertyValue("--analog-strength")) || 0;
  return t * s;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function GlitchSweep({ threshold = 0.6 }: Props) {
  const [active, setActive] = useState(false);
  const [seed, setSeed] = useState(0);
  const reducedMotion = useRef<boolean>(prefersReducedMotion());

  useEffect(() => {
    if (reducedMotion.current) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      setActive(readIntensity() >= threshold);
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [threshold]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const schedule = () => {
      if (cancelled) return;
      const wait = 1500 + Math.random() * 4000;
      window.setTimeout(() => {
        if (cancelled) return;
        setSeed(s => s + 1);
        schedule();
      }, wait);
    };
    schedule();
    return () => {
      cancelled = true;
    };
  }, [active]);

  if (reducedMotion.current || !active) return null;

  return (
    <div aria-hidden className="ana-glitch-host">
      <div key={seed} className="ana-glitch-sweep" />
    </div>
  );
}
