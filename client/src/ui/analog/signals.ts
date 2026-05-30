// client/src/ui/analog/signals.ts
// Single source of truth for the live `--tension` value and the
// active `quality` selection. Surfaces push values via hooks; Game3D
// writes live tension via the imperative setter.

import { useEffect } from "react";
import type { GraphicsQuality } from "../../util/device";

const TENSION_DEFAULT = 0.35;
const QUALITY_DEFAULT: GraphicsQuality = "auto";

let pendingTension: number | null = null;
let rafHandle: number | null = null;

function flushTension(): void {
  rafHandle = null;
  if (pendingTension == null) return;
  const v = clamp01(pendingTension);
  pendingTension = null;
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--tension", String(v));
  }
}

export function setAnalogTension(value: number): void {
  pendingTension = value;
  if (rafHandle != null) return;
  if (typeof requestAnimationFrame === "undefined") {
    flushTension();
    return;
  }
  rafHandle = requestAnimationFrame(flushTension);
}

// Stack of active tension owners (most recent wins).
const tensionStack: number[] = [];

function applyTopTension(): void {
  const top = tensionStack.length
    ? tensionStack[tensionStack.length - 1]
    : TENSION_DEFAULT;
  setAnalogTension(top);
}

export function useAnalogTension(value: number): void {
  useEffect(() => {
    tensionStack.push(value);
    applyTopTension();
    return () => {
      const idx = tensionStack.lastIndexOf(value);
      if (idx >= 0) tensionStack.splice(idx, 1);
      applyTopTension();
    };
  }, [value]);
}

// Stack of active quality owners (most recent wins).
const qualityStack: GraphicsQuality[] = [];
const qualitySubscribers = new Set<(q: GraphicsQuality) => void>();

function applyTopQuality(): void {
  const top = qualityStack.length
    ? qualityStack[qualityStack.length - 1]
    : QUALITY_DEFAULT;
  qualitySubscribers.forEach(cb => cb(top));
}

export function useAnalogQuality(quality: GraphicsQuality): void {
  useEffect(() => {
    qualityStack.push(quality);
    applyTopQuality();
    return () => {
      const idx = qualityStack.lastIndexOf(quality);
      if (idx >= 0) qualityStack.splice(idx, 1);
      applyTopQuality();
    };
  }, [quality]);
}

export function getActiveAnalogQuality(): GraphicsQuality {
  return qualityStack.length
    ? qualityStack[qualityStack.length - 1]
    : QUALITY_DEFAULT;
}

export function subscribeAnalogQuality(
  cb: (q: GraphicsQuality) => void
): () => void {
  qualitySubscribers.add(cb);
  cb(getActiveAnalogQuality());
  return () => {
    qualitySubscribers.delete(cb);
  };
}

export function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function ease(v: number): number {
  // ease-in-out cubic on a [0,1] input
  const t = clamp01(v);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
