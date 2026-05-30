// client/src/ui/analog/AnalogShell.tsx
import { useEffect, useState, type ReactNode } from "react";
import { isMobile, tier, type GraphicsQuality } from "../../util/device";
import {
  isBatterySaverEnabled,
  subscribeBatterySaver,
} from "../../util/batterySaver";
import { subscribeAnalogQuality } from "./signals";

type Tier = "low" | "mid" | "high";

const QUALITY_BASE: Record<Tier, number> = {
  low: 0.4,
  mid: 0.7,
  high: 1.0,
};

function resolveAutoTier(): Tier {
  if (isMobile) {
    // device.ts already pessimizes mobile; respect it
    return tier === "high" ? "mid" : tier;
  }
  return tier;
}

function resolveBase(quality: GraphicsQuality): number {
  if (quality === "auto") return QUALITY_BASE[resolveAutoTier()];
  return QUALITY_BASE[quality];
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function computeStrength(
  quality: GraphicsQuality,
  reducedMotion: boolean,
  batterySaver: boolean
): number {
  let s = resolveBase(quality);
  if (batterySaver) s *= 0.6;
  if (reducedMotion && s > 0.3) s = 0.3;
  return Math.max(0, Math.min(1, s));
}

interface Props {
  children: ReactNode;
}

export function AnalogShell({ children }: Props) {
  const [quality, setQuality] = useState<GraphicsQuality>("auto");
  const [reducedMotion, setReducedMotion] = useState<boolean>(prefersReducedMotion);
  const [batterySaver, setBatterySaver] = useState<boolean>(isBatterySaverEnabled);

  useEffect(() => subscribeAnalogQuality(setQuality), []);

  useEffect(() => subscribeBatterySaver(setBatterySaver), []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const listener = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    const v = computeStrength(quality, reducedMotion, batterySaver);
    document.documentElement.style.setProperty("--analog-strength", String(v));
    document.documentElement.dataset.analogReduced = reducedMotion
      ? "true"
      : "false";
  }, [quality, reducedMotion, batterySaver]);

  return <>{children}</>;
}
