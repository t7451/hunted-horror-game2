# Analog UI Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the found-footage analog visual language across every React/Tailwind 2D shell surface (title, loading, pause, HUD, mobile, gates, NotFound) with effects that react to AI Director tension during play.

**Architecture:** A thin component library under `client/src/ui/analog/` reads two CSS variables — `--tension` (live, 0..1) and `--analog-strength` (config, 0..1) — written to `document.documentElement` by a small signals module. Game3D writes live tension via an rAF-coalesced setter; menu surfaces push static tension via a hook. `<AnalogShell>` at App root recomputes `--analog-strength` from quality + device class + reduced-motion + battery-saver. CSS does the animation work; React does no per-frame re-renders.

**Tech Stack:** React 19, Tailwind 4, TypeScript (strict, `tsc --noEmit`), Wouter routing, existing `util/device.ts` and `util/batterySaver.ts`.

**Reference spec:** `docs/superpowers/specs/2026-05-08-analog-ui-shell-design.md`

**Testing model:** Project has no test runner. Each task validates via:
1. `pnpm check` (TypeScript clean — currently `corepack pnpm check` if pnpm shim is missing)
2. A specific runtime check (DevTools Elements / visible behavior)
3. Commit immediately on green

**Working directory:** `/home/skdevk/hunted-horror-game2`. Branch: `feat/batch11-audio-immersion`.

---

## File Structure

**Create (10 files):**

```
client/src/ui/analog/
  tokens.css          CSS custom properties (palette, fonts, scanline patterns, durations)
  signals.ts          --tension setter + useAnalogTension/useAnalogQuality hooks; rAF coalescing
  AnalogShell.tsx     wraps app, recomputes --analog-strength reactively
  Scanlines.tsx       fixed full-viewport overlay; opacity scales with tension
  ChromaticText.tsx   <span> with magenta/cyan text-shadow that scales with tension
  RecBadge.tsx        red dot + uppercase tape label; pulse rate scales with tension
  AnalogPanel.tsx     bordered grain container with optional [CLASSIFIED] stamp
  GlitchSweep.tsx     animated horizontal sweep, gated below intensity threshold
  AnalogButton.tsx    monospace press-tape button (primary | ghost)
  index.ts            re-exports the public surface
```

**Modify (12 files):**

```
client/src/index.css                 import tokens.css
client/src/App.tsx                   wrap routes in <AnalogShell> with one <Scanlines>
client/src/ui/TitleScreen.tsx        adopt analog components; useAnalogTension / useAnalogQuality
client/src/ui/LoadingScreen.tsx      adopt analog panel + ASCII progress
client/src/ui/PauseMenu.tsx          adopt analog panel + paused RecBadge; toggle data-paused on <html>
client/src/ui/Tutorial.tsx           wrap in AnalogPanel tone="paper"
client/src/ui/ObserverIndicator.tsx  ChromaticText label
client/src/ui/PortraitGate.tsx       wrap in AnalogPanel
client/src/ui/MobilePauseButton.tsx  swap to AnalogButton + paused RecBadge
client/src/ui/Minimap.tsx            wrap in AnalogPanel; chromatic offset on player dot
client/src/pages/NotFound.tsx        full SIGNAL LOST treatment
client/src/game/Game3D.tsx           setAnalogTension + useAnalogQuality + ChromaticText wrappers + GlitchSweep mount
```

---

## Task 1: Tokens, signals module, and CSS import

**Files:**
- Create: `client/src/ui/analog/tokens.css`
- Create: `client/src/ui/analog/signals.ts`
- Create: `client/src/ui/analog/index.ts`
- Modify: `client/src/index.css` (add `@import` for tokens)

- [ ] **Step 1: Write `tokens.css`**

```css
/* client/src/ui/analog/tokens.css
   Found-footage analog UI design tokens.
   Live signals (--tension, --analog-strength) are written by signals.ts and AnalogShell.
*/

@property --tension {
  syntax: "<number>";
  inherits: true;
  initial-value: 0.35;
}

@property --analog-strength {
  syntax: "<number>";
  inherits: true;
  initial-value: 1;
}

:root {
  /* Live signals (overwritten at runtime) */
  --tension: 0.35;
  --analog-strength: 1;

  /* Effective intensity (read-only convenience) */
  --ana-intensity: calc(var(--tension) * var(--analog-strength));

  /* Palette */
  --ana-fg: #f1f1f1;
  --ana-fg-dim: #a89488;
  --ana-bg: #060403;
  --ana-rec: #ff3a3a;
  --ana-cyan: #00d8ff;
  --ana-magenta: #ff00aa;
  --ana-rust: #6a3a2a;
  --ana-bone: #d4c2b8;

  /* Fonts */
  --ana-font-mono: "Courier New", ui-monospace, monospace;
  --ana-font-stencil: "Impact", "Arial Black", sans-serif;

  /* Scanline patterns */
  --ana-scan-default: repeating-linear-gradient(
    0deg,
    transparent 0 1px,
    rgba(255, 80, 80, 0.06) 1px 2px
  );
  --ana-scan-thick: repeating-linear-gradient(
    0deg,
    transparent 0 3px,
    rgba(255, 255, 255, 0.04) 3px 4px
  );

  /* Durations */
  --ana-pulse-base-ms: 1100ms;
  --ana-glitch-min-gap-ms: 4500ms;
}

@keyframes ana-rec-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.55; transform: scale(0.85); }
}

@keyframes ana-scan-drift {
  0%   { background-position: 0 0, 0 0; }
  100% { background-position: 0 12px, 0 -8px; }
}

@keyframes ana-glitch-sweep {
  0%   { transform: translateY(-100%); opacity: 0; }
  10%  { opacity: 0.7; }
  60%  { opacity: 0.4; }
  100% { transform: translateY(120vh); opacity: 0; }
}

html[data-paused="true"] .ana-scan-drift {
  animation-play-state: paused !important;
}

@media (prefers-reduced-motion: reduce) {
  .ana-scan-drift { animation: none; }
  .ana-glitch-sweep { display: none; }
  .ana-rec-pulse { animation: none; }
}
```

- [ ] **Step 2: Write `signals.ts`**

```ts
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
```

- [ ] **Step 3: Write `index.ts` re-exports**

```ts
// client/src/ui/analog/index.ts
export { AnalogShell } from "./AnalogShell";
export { Scanlines } from "./Scanlines";
export { ChromaticText } from "./ChromaticText";
export { RecBadge } from "./RecBadge";
export { AnalogPanel } from "./AnalogPanel";
export { GlitchSweep } from "./GlitchSweep";
export { AnalogButton } from "./AnalogButton";
export {
  setAnalogTension,
  useAnalogTension,
  useAnalogQuality,
  getActiveAnalogQuality,
  subscribeAnalogQuality,
} from "./signals";
```

The component imports here will be unresolved until later tasks. That's intentional — `index.ts` is the contract; later tasks satisfy it.

- [ ] **Step 4: Add tokens import to `client/src/index.css`**

Open `client/src/index.css` and add this **at the very top of the file** (before any existing `@import` or Tailwind directive):

```css
@import "./ui/analog/tokens.css";
```

- [ ] **Step 5: Verify TypeScript still compiles, ignoring component imports**

Skip running `pnpm check` until Task 3 — the `index.ts` re-exports won't resolve yet. Instead verify by inspection:

```bash
ls client/src/ui/analog/
```

Expected output: `index.ts  signals.ts  tokens.css`.

- [ ] **Step 6: Commit**

```bash
git add client/src/ui/analog/tokens.css \
        client/src/ui/analog/signals.ts \
        client/src/ui/analog/index.ts \
        client/src/index.css
git commit -m "$(cat <<'EOF'
feat(ui/analog): tokens + signals foundation

Adds CSS custom-property tokens (palette, fonts, scan patterns,
keyframes) and the signals module exposing setAnalogTension,
useAnalogTension, and useAnalogQuality. Hooks use a stack-of-owners
model; the imperative setter is rAF-coalesced.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: AnalogShell

**Files:**
- Create: `client/src/ui/analog/AnalogShell.tsx`

- [ ] **Step 1: Write `AnalogShell.tsx`**

```tsx
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
```

- [ ] **Step 2: Verify file compiles in isolation**

Skip `pnpm check` for now — `index.ts` still references unwritten files. Inspect manually:

```bash
ls client/src/ui/analog/AnalogShell.tsx && wc -l client/src/ui/analog/AnalogShell.tsx
```

Expected: file exists, ~70 lines.

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/analog/AnalogShell.tsx
git commit -m "feat(ui/analog): AnalogShell wrapper

Subscribes to quality, reduced-motion, and battery-saver inputs;
recomputes --analog-strength on documentElement. Mounts once at
App root.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Scanlines and App-root mount

**Files:**
- Create: `client/src/ui/analog/Scanlines.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Write `Scanlines.tsx`**

```tsx
// client/src/ui/analog/Scanlines.tsx
import "./Scanlines.css";

export function Scanlines() {
  return <div aria-hidden className="ana-scanlines ana-scan-drift" />;
}
```

- [ ] **Step 2: Write `Scanlines.css` alongside it**

Create `client/src/ui/analog/Scanlines.css`:

```css
.ana-scanlines {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  background:
    var(--ana-scan-default),
    var(--ana-scan-thick);
  mix-blend-mode: screen;
  opacity: calc(0.12 + var(--ana-intensity) * 0.18);
  transition: opacity 200ms linear;
}

.ana-scan-drift {
  animation: ana-scan-drift 9s linear infinite;
}
```

- [ ] **Step 3: Modify `App.tsx` — mount AnalogShell + Scanlines**

Replace the contents of `client/src/App.tsx` with:

```tsx
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import { AnalogShell, Scanlines } from "./ui/analog";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <AnalogShell>
            <Scanlines />
            <Router />
          </AnalogShell>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
```

- [ ] **Step 4: Stub the remaining components so `index.ts` resolves**

Until the rest of Tasks 4-6 land, the imports in `index.ts` to `ChromaticText`, `RecBadge`, `AnalogPanel`, `GlitchSweep`, `AnalogButton` will fail. Add **placeholder stubs** so the project type-checks (each is a one-line component returning null). These will be replaced by real implementations in later tasks:

Create `client/src/ui/analog/ChromaticText.tsx`:
```tsx
import type { ReactNode } from "react";
export function ChromaticText({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
```

Create `client/src/ui/analog/RecBadge.tsx`:
```tsx
export function RecBadge() { return null; }
```

Create `client/src/ui/analog/AnalogPanel.tsx`:
```tsx
import type { ReactNode } from "react";
export function AnalogPanel({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
```

Create `client/src/ui/analog/GlitchSweep.tsx`:
```tsx
export function GlitchSweep() { return null; }
```

Create `client/src/ui/analog/AnalogButton.tsx`:
```tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";
export function AnalogButton(
  props: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }
) {
  return <button {...props} />;
}
```

- [ ] **Step 5: Run `pnpm check`**

```bash
corepack pnpm check
```

Expected: exit code 0 (TypeScript clean — no errors).

- [ ] **Step 6: Run dev server, verify scanlines visible**

```bash
corepack pnpm dev
```

Open the printed URL. In DevTools Elements, confirm:
- `<html>` has `style="--analog-strength: <number>"` set
- `<html>` has `data-analog-reduced="false"` (or `"true"` if reduced-motion is on)
- A `<div class="ana-scanlines ana-scan-drift">` exists at the top of `<body>`
- Visually: subtle drifting horizontal scanlines overlay the title screen

Stop the dev server (Ctrl+C).

- [ ] **Step 7: Commit**

```bash
git add client/src/ui/analog/Scanlines.tsx \
        client/src/ui/analog/Scanlines.css \
        client/src/ui/analog/ChromaticText.tsx \
        client/src/ui/analog/RecBadge.tsx \
        client/src/ui/analog/AnalogPanel.tsx \
        client/src/ui/analog/GlitchSweep.tsx \
        client/src/ui/analog/AnalogButton.tsx \
        client/src/App.tsx
git commit -m "feat(ui/analog): Scanlines + App-root mount

Mounts AnalogShell + Scanlines at App root. Component stubs
added for ChromaticText/RecBadge/AnalogPanel/GlitchSweep/
AnalogButton — replaced by real implementations in subsequent
tasks. pnpm check passes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: ChromaticText and RecBadge

**Files:**
- Modify: `client/src/ui/analog/ChromaticText.tsx`
- Modify: `client/src/ui/analog/RecBadge.tsx`
- Create: `client/src/ui/analog/RecBadge.css`

- [ ] **Step 1: Replace `ChromaticText.tsx` with the real implementation**

```tsx
// client/src/ui/analog/ChromaticText.tsx
import type { ElementType, HTMLAttributes, ReactNode } from "react";

type OffsetMode = "auto" | "none" | "fixed";

interface Props extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  offset?: OffsetMode;
  children: ReactNode;
}

const SHADOW_AUTO =
  "calc(var(--ana-intensity) * -2px) 0 var(--ana-magenta)," +
  "calc(var(--ana-intensity) * 2px) 0 var(--ana-cyan)," +
  "0 0 4px rgba(0,0,0,0.9)";

const SHADOW_FIXED =
  "-1px 0 var(--ana-magenta), 1px 0 var(--ana-cyan), 0 0 4px rgba(0,0,0,0.9)";

export function ChromaticText({
  as: Tag = "span",
  offset = "auto",
  style,
  children,
  ...rest
}: Props) {
  const textShadow =
    offset === "none"
      ? undefined
      : offset === "fixed"
        ? SHADOW_FIXED
        : SHADOW_AUTO;
  return (
    <Tag
      {...rest}
      style={{
        textShadow,
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}
```

- [ ] **Step 2: Replace `RecBadge.tsx` with the real implementation**

```tsx
// client/src/ui/analog/RecBadge.tsx
import "./RecBadge.css";

interface Props {
  label?: string;
  paused?: boolean;
  className?: string;
}

export function RecBadge({ label = "REC TAPE 04", paused = false, className }: Props) {
  return (
    <div
      className={`ana-rec ${paused ? "ana-rec-paused" : ""} ${className ?? ""}`}
      role="status"
      aria-label={paused ? "paused" : "recording"}
    >
      <span className={paused ? "ana-rec-square" : "ana-rec-dot ana-rec-pulse"} />
      <span className="ana-rec-label">{label}</span>
    </div>
  );
}
```

- [ ] **Step 3: Write `RecBadge.css`**

```css
.ana-rec {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--ana-font-mono);
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--ana-rec);
  text-transform: uppercase;
}

.ana-rec-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ana-rec);
  box-shadow: 0 0 6px var(--ana-rec);
  display: inline-block;
}

.ana-rec-square {
  width: 8px;
  height: 8px;
  background: var(--ana-fg-dim);
  display: inline-block;
}

.ana-rec-pulse {
  animation: ana-rec-pulse
    calc(var(--ana-pulse-base-ms) - var(--ana-intensity) * 600ms)
    ease-in-out infinite;
}

.ana-rec-paused .ana-rec-label {
  color: var(--ana-fg-dim);
}
```

- [ ] **Step 4: Run `pnpm check`**

```bash
corepack pnpm check
```

Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add client/src/ui/analog/ChromaticText.tsx \
        client/src/ui/analog/RecBadge.tsx \
        client/src/ui/analog/RecBadge.css
git commit -m "feat(ui/analog): ChromaticText + RecBadge

ChromaticText wraps children with magenta/cyan text-shadow that
scales with --ana-intensity. RecBadge renders a pulsing red dot
+ uppercase mono label; paused state swaps to a square.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: AnalogPanel and AnalogButton

**Files:**
- Modify: `client/src/ui/analog/AnalogPanel.tsx`
- Modify: `client/src/ui/analog/AnalogButton.tsx`
- Create: `client/src/ui/analog/AnalogPanel.css`
- Create: `client/src/ui/analog/AnalogButton.css`

- [ ] **Step 1: Replace `AnalogPanel.tsx`**

```tsx
// client/src/ui/analog/AnalogPanel.tsx
import type { HTMLAttributes, ReactNode } from "react";
import "./AnalogPanel.css";

interface Props extends HTMLAttributes<HTMLDivElement> {
  tone?: "dark" | "paper";
  classified?: boolean;
  children: ReactNode;
}

export function AnalogPanel({
  tone = "dark",
  classified = false,
  className,
  children,
  ...rest
}: Props) {
  return (
    <div
      {...rest}
      className={`ana-panel ana-panel-${tone} ${className ?? ""}`}
    >
      {classified && <span className="ana-panel-stamp">FILE // CLASSIFIED</span>}
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Write `AnalogPanel.css`**

```css
.ana-panel {
  position: relative;
  border: 1px solid var(--ana-rust);
  font-family: var(--ana-font-mono);
  color: var(--ana-fg);
  padding: 16px;
  background-image:
    radial-gradient(circle at 22% 33%, rgba(255,255,255,0.04) 0 1px, transparent 2px),
    radial-gradient(circle at 71% 65%, rgba(255,255,255,0.03) 0 1px, transparent 2px),
    radial-gradient(circle at 45% 80%, rgba(255,255,255,0.05) 0 1px, transparent 2px);
  background-size: 8px 8px, 13px 13px, 6px 6px;
}

.ana-panel-dark {
  background-color: rgba(10, 6, 5, 0.85);
}

.ana-panel-paper {
  background-color: rgba(40, 28, 22, 0.85);
  color: var(--ana-bone);
  border-color: var(--ana-bone);
}

.ana-panel-stamp {
  position: absolute;
  top: -10px;
  left: 12px;
  padding: 2px 8px;
  background: var(--ana-bg);
  border: 2px solid var(--ana-rust);
  color: var(--ana-rust);
  font-family: var(--ana-font-mono);
  font-size: 9px;
  letter-spacing: 3px;
  text-transform: uppercase;
  transform: rotate(-2deg);
}
```

- [ ] **Step 3: Replace `AnalogButton.tsx`**

```tsx
// client/src/ui/analog/AnalogButton.tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./AnalogButton.css";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost";
  children: ReactNode;
}

export function AnalogButton({
  variant = "primary",
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      type={rest.type ?? "button"}
      {...rest}
      className={`ana-btn ana-btn-${variant} ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 4: Write `AnalogButton.css`**

```css
.ana-btn {
  font-family: var(--ana-font-mono);
  text-transform: uppercase;
  letter-spacing: 4px;
  font-size: 12px;
  padding: 10px 22px;
  cursor: pointer;
  border: 1px solid var(--ana-rust);
  background: rgba(20, 12, 8, 0.85);
  color: var(--ana-bone);
  transition: transform 150ms ease, color 150ms linear;
  position: relative;
}

.ana-btn:hover:not(:disabled) {
  transform: translateX(1px);
  color: var(--ana-fg);
}

.ana-btn:active:not(:disabled) {
  text-shadow:
    -2px 0 var(--ana-magenta),
    2px 0 var(--ana-cyan);
}

.ana-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ana-btn-primary {
  background: rgba(106, 58, 42, 0.55);
  border-color: var(--ana-rec);
  color: var(--ana-fg);
}

.ana-btn-ghost {
  background: rgba(0, 0, 0, 0.55);
  border-color: rgba(255, 255, 255, 0.25);
}
```

- [ ] **Step 5: Run `pnpm check`**

```bash
corepack pnpm check
```

Expected: exit code 0.

- [ ] **Step 6: Commit**

```bash
git add client/src/ui/analog/AnalogPanel.tsx \
        client/src/ui/analog/AnalogPanel.css \
        client/src/ui/analog/AnalogButton.tsx \
        client/src/ui/analog/AnalogButton.css
git commit -m "feat(ui/analog): AnalogPanel + AnalogButton

Bordered grain panel with optional FILE/CLASSIFIED stamp; tape-tab
button with primary and ghost variants.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: GlitchSweep

**Files:**
- Modify: `client/src/ui/analog/GlitchSweep.tsx`
- Create: `client/src/ui/analog/GlitchSweep.css`

- [ ] **Step 1: Replace `GlitchSweep.tsx`**

```tsx
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
```

- [ ] **Step 2: Write `GlitchSweep.css`**

```css
.ana-glitch-host {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 9998;
}

.ana-glitch-sweep {
  position: absolute;
  left: 0;
  right: 0;
  height: 6px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(0, 216, 255, 0.4),
    rgba(255, 0, 170, 0.4),
    transparent
  );
  mix-blend-mode: screen;
  animation: ana-glitch-sweep 1.4s linear forwards;
}
```

- [ ] **Step 3: Run `pnpm check`**

```bash
corepack pnpm check
```

Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/analog/GlitchSweep.tsx \
        client/src/ui/analog/GlitchSweep.css
git commit -m "feat(ui/analog): GlitchSweep

Polls --ana-intensity every 400ms; renders a moving horizontal
sweep at random intervals when intensity >= threshold (default
0.6). Returns null when intensity is low or prefers-reduced-motion
is set.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: TitleScreen analog adoption

**Files:**
- Modify: `client/src/ui/TitleScreen.tsx`

- [ ] **Step 1: Read the current file to confirm line ranges before editing**

```bash
wc -l client/src/ui/TitleScreen.tsx
```

Expected: ~367 lines.

- [ ] **Step 2: Apply the analog adoption to `TitleScreen.tsx`**

Make these specific changes:

1. **Add imports** at the top (after the existing import block):

```tsx
import {
  ChromaticText,
  RecBadge,
  AnalogPanel,
  AnalogButton,
  useAnalogTension,
  useAnalogQuality,
} from "./analog";
```

2. **Inside the `TitleScreen` component body**, after the existing `useState` calls, add:

```tsx
useAnalogTension(0.55);
useAnalogQuality(quality);
```

3. **Remove the bespoke radial gradient + scanlines `<div>` blocks** (currently the elements with `aria-hidden` containing `radial-gradient(...title-drift...)` and `repeating-linear-gradient(...rgba(255,80,80,0.05)...)`). Search for `title-drift` and `rgba(255,80,80,0.05)` and delete both `<div aria-hidden ...>` elements and any related local `<style>` blocks. The global `<Scanlines>` and AnalogShell now provide this.

4. **Add a corner `<RecBadge>`** at the top of the returned JSX (just inside the outer `<div className="relative flex min-h-screen ...">`):

```tsx
<div className="absolute top-4 left-4 z-10">
  <RecBadge label="TAPE 01" />
</div>
```

5. **Wrap the `<h1>HUNTED</h1>`** with ChromaticText:

```tsx
<ChromaticText
  as="h1"
  className="relative mb-2 text-5xl font-bold tracking-widest"
>
  HUNTED
</ChromaticText>
```

6. **Replace the difficulty cards `<button>`s** — find the `difficultyOptions.map(opt => ...)` block and replace each card's outer element. The current button has class `rounded border px-4 py-3 text-left transition-colors` etc. Wrap its inner content in `<AnalogPanel classified>` and keep the button as the click target:

```tsx
{difficultyOptions.map(opt => (
  <button
    key={opt.key}
    type="button"
    onClick={() => setDifficulty(opt.key)}
    className={`text-left transition-transform hover:translate-x-[1px] ${
      difficulty === opt.key ? "ring-2 ring-red-400" : ""
    }`}
  >
    <AnalogPanel classified={true}>
      <div className="font-semibold tracking-wide">{opt.name}</div>
      <div className="mt-1 text-xs opacity-70">{opt.summary}</div>
      <div className="mt-2 text-[11px] opacity-60">
        {formatTime(opt.timer)} · danger {opt.difficulty}/3
      </div>
    </AnalogPanel>
  </button>
))}
```

7. **Replace the ENTER button** — find the `<button ... rounded bg-red-700 ...>ENTER THE HOUSE</button>` and replace with:

```tsx
<AnalogButton
  variant="primary"
  disabled={!webglSupported}
  onClick={() => onEnter({ difficulty, quality, sensitivity })}
>
  Enter the House
</AnalogButton>
```

8. **Replace the daily challenge button** in `DailyChallengeButton` — keep its conditional logic; swap the outer `<button>` to `<AnalogButton variant="ghost" ...>`. Same props pass-through.

- [ ] **Step 3: Run `pnpm check`**

```bash
corepack pnpm check
```

Expected: exit code 0. If type errors arise about `AnalogButton` not accepting `disabled`, the button extends `ButtonHTMLAttributes<HTMLButtonElement>` so `disabled` is fine — re-check the spelling of imports.

- [ ] **Step 4: Visual verification**

```bash
corepack pnpm dev
```

Open the URL. Confirm:
- Title shows REC TAPE 01 corner badge with pulsing red dot
- "HUNTED" has visible chromatic offset (magenta/cyan) on a black background
- Difficulty cards are bordered with [FILE // CLASSIFIED] stamp at top-left
- ENTER button is monospace, uppercase, bordered, no rounded corners
- Scanlines drift gently overlaying everything
- DevTools Elements: `<html>` has `--tension: 0.55`

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add client/src/ui/TitleScreen.tsx
git commit -m "feat(ui): TitleScreen adopts analog system

Removes bespoke scanlines/drift gradient (now provided by
AnalogShell). Title gets ChromaticText, difficulty cards become
classified AnalogPanels, ENTER and Daily Challenge become
AnalogButtons. useAnalogTension(0.55) and useAnalogQuality(quality)
make the menu feel live and let the strength multiplier respond
to the user's quality dropdown.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: LoadingScreen analog adoption

**Files:**
- Modify: `client/src/ui/LoadingScreen.tsx`

- [ ] **Step 1: Read the current file**

```bash
wc -l client/src/ui/LoadingScreen.tsx
```

Expected: ~182 lines. Inspect with `Read` to find the progress-rendering block.

- [ ] **Step 2: Apply analog adoption**

1. **Add imports**:

```tsx
import { AnalogPanel, ChromaticText, useAnalogTension } from "./analog";
```

2. **Inside the component body**, add at the top:

```tsx
useAnalogTension(0.4);
```

3. **Wrap the existing centered content** in `<AnalogPanel>`. The component's outer div likely has classes for centering — keep them, and put the inner content inside `<AnalogPanel>`:

```tsx
return (
  <div className="flex min-h-screen items-center justify-center bg-black">
    <AnalogPanel className="w-[min(92vw,520px)]">
      <div className="mb-2 flex items-center justify-between">
        <ChromaticText className="text-xs tracking-[0.3em] uppercase">
          Loading Tape
        </ChromaticText>
        <span className="font-mono text-xs text-white/60">{percent}%</span>
      </div>
      <div className="font-mono text-sm tracking-widest text-white/80">
        {asciiBar(percent)}
      </div>
      {/* keep any existing status text below */}
      {existingStatusJSX}
    </AnalogPanel>
  </div>
);
```

4. **Add a helper `asciiBar`** above the component:

```tsx
function asciiBar(percent: number, width = 24): string {
  const filled = Math.round((percent / 100) * width);
  return `[${"█".repeat(filled)}${"·".repeat(width - filled)}]`;
}
```

5. **Replace the existing percentage/spinner UI** with the AnalogPanel block above. Preserve any existing status text or messages by passing them as children of AnalogPanel below the bar. If the file uses `currentTip` or similar variable names, keep them and render under the bar:

```tsx
<div className="mt-3 font-mono text-[11px] tracking-widest uppercase text-white/50">
  {currentTip}
</div>
```

If the variable name in the file differs, use the existing one — do not introduce new state.

- [ ] **Step 3: Run `pnpm check`**

```bash
corepack pnpm check
```

Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/LoadingScreen.tsx
git commit -m "feat(ui): LoadingScreen adopts analog panel

Wraps progress in AnalogPanel with ChromaticText 'LOADING TAPE'
header and an ASCII progress bar. useAnalogTension(0.4) so
scanlines remain subtle while loading.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: PauseMenu analog adoption + data-paused wiring

**Files:**
- Modify: `client/src/ui/PauseMenu.tsx`

- [ ] **Step 1: Read the current file**

```bash
wc -l client/src/ui/PauseMenu.tsx
```

Expected: ~132 lines.

- [ ] **Step 2: Apply analog adoption + paused wiring**

1. **Add imports**:

```tsx
import { useEffect } from "react";
import {
  AnalogPanel,
  AnalogButton,
  RecBadge,
  ChromaticText,
} from "./analog";
```

2. **Inside the component body**, add this effect that toggles the `data-paused` attribute on `<html>` while the menu is mounted:

```tsx
useEffect(() => {
  document.documentElement.setAttribute("data-paused", "true");
  return () => {
    document.documentElement.setAttribute("data-paused", "false");
  };
}, []);
```

3. **Wrap the menu's content** in `<AnalogPanel>` and replace the title/buttons. Preserve all existing button handlers (`onResume`, `onQuit`, etc.):

```tsx
return (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
    <AnalogPanel className="w-[min(92vw,460px)] flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <ChromaticText
          as="h2"
          className="text-3xl font-bold tracking-[0.4em] uppercase"
          style={{ fontFamily: "var(--ana-font-stencil)" }}
        >
          ‖ Paused
        </ChromaticText>
        <RecBadge paused label="TAPE 04" />
      </div>
      <AnalogButton variant="primary" onClick={onResume}>
        Resume
      </AnalogButton>
      <AnalogButton variant="ghost" onClick={onQuit}>
        Quit to Title
      </AnalogButton>
      {existingExtras /* keep volume slider, restart, etc. */}
    </AnalogPanel>
  </div>
);
```

If the component receives different prop names (e.g., `onContinue` instead of `onResume`), use the file's existing names — don't rename props.

- [ ] **Step 3: Run `pnpm check`**

```bash
corepack pnpm check
```

Expected: exit code 0.

- [ ] **Step 4: Visual verification**

```bash
corepack pnpm dev
```

Open URL, click Enter to start a game (or press Escape on the title). When PauseMenu appears, in DevTools Elements confirm `<html data-paused="true">`. The scanlines should stop drifting (frozen pattern). Resume and confirm `<html data-paused="false">`.

- [ ] **Step 5: Commit**

```bash
git add client/src/ui/PauseMenu.tsx
git commit -m "feat(ui): PauseMenu adopts analog system

AnalogPanel container, paused RecBadge, AnalogButtons. Sets
data-paused on <html> while open so Scanlines drift freezes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Tutorial and PortraitGate analog adoption

**Files:**
- Modify: `client/src/ui/Tutorial.tsx`
- Modify: `client/src/ui/PortraitGate.tsx`

- [ ] **Step 1: Modify `Tutorial.tsx`**

Add at top: `import { AnalogPanel, ChromaticText } from "./analog";`

Wrap the tutorial's outer container in `<AnalogPanel tone="paper">`. Preserve the existing typed-out cadence — do not change any existing state or effect logic. Replace plain heading elements (e.g., `<h2>` with the existing tutorial title) with `<ChromaticText as="h2" offset="fixed">`:

```tsx
return (
  <AnalogPanel tone="paper" className="w-[min(92vw,560px)]">
    <ChromaticText as="h2" offset="fixed" className="mb-3 text-lg uppercase tracking-[0.3em]">
      {existingTitleText}
    </ChromaticText>
    {existingTutorialBody}
  </AnalogPanel>
);
```

- [ ] **Step 2: Modify `PortraitGate.tsx`**

Add at top: `import { AnalogPanel, ChromaticText, RecBadge } from "./analog";`

Wrap the gate in `<AnalogPanel>` with a stenciled instruction. Preserve the orientation-detection logic.

```tsx
return (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
    <AnalogPanel className="w-[min(86vw,420px)] text-center">
      <RecBadge label="ROTATE DEVICE" />
      <ChromaticText
        as="h2"
        offset="fixed"
        className="mt-4 text-2xl font-bold tracking-[0.3em] uppercase"
      >
        {existingMessageText}
      </ChromaticText>
    </AnalogPanel>
  </div>
);
```

- [ ] **Step 3: Run `pnpm check`**

```bash
corepack pnpm check
```

Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/Tutorial.tsx client/src/ui/PortraitGate.tsx
git commit -m "feat(ui): Tutorial + PortraitGate adopt analog system

Tutorial wraps in paper-toned AnalogPanel; PortraitGate uses dark
panel with ROTATE DEVICE RecBadge.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Minimap and ObserverIndicator analog adoption

**Files:**
- Modify: `client/src/ui/Minimap.tsx`
- Modify: `client/src/ui/ObserverIndicator.tsx`

- [ ] **Step 1: Modify `ObserverIndicator.tsx`**

Add at top: `import { ChromaticText } from "./analog";`

Find the proximity-label JSX (currently a `<span>` or `<div>` rendering "PROXIMITY" or similar) and wrap that text node in `<ChromaticText offset="auto">`:

```tsx
<ChromaticText className="text-[10px] tracking-[0.3em] uppercase text-white/70">
  {labelText}
</ChromaticText>
```

Do not change the existing proximity-bar geometry, color logic, or threat thresholds. The ChromaticText wrap is a presentational layer only.

- [ ] **Step 2: Modify `Minimap.tsx`**

Add at top: `import { AnalogPanel } from "./analog";`

Wrap the existing minimap canvas/grid in `<AnalogPanel>`:

```tsx
return (
  <AnalogPanel className="p-1">
    {existingMinimapJSX}
  </AnalogPanel>
);
```

Locate the player-dot rendering (an absolutely-positioned `<div>` representing the player position) and add an inline-style chromatic offset that scales with `--ana-intensity`:

```tsx
<div
  className="..."
  style={{
    ...existingStyle,
    boxShadow:
      "calc(var(--ana-intensity) * -2px) 0 var(--ana-magenta)," +
      "calc(var(--ana-intensity) * 2px) 0 var(--ana-cyan)," +
      "0 0 4px rgba(0,255,128,0.6)",
  }}
/>
```

Preserve all existing position/color logic. The chromatic shadow is additive only.

- [ ] **Step 3: Run `pnpm check`**

```bash
corepack pnpm check
```

Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/Minimap.tsx client/src/ui/ObserverIndicator.tsx
git commit -m "feat(ui): Minimap + ObserverIndicator adopt analog system

Minimap wraps in AnalogPanel; player dot gets chromatic shadow
scaling with --ana-intensity. Observer label becomes ChromaticText.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: MobilePauseButton analog adoption

**Files:**
- Modify: `client/src/ui/MobilePauseButton.tsx`

- [ ] **Step 1: Read the current file**

```bash
wc -l client/src/ui/MobilePauseButton.tsx
```

Expected: ~32 lines.

- [ ] **Step 2: Modify**

Replace the file's body so it uses AnalogButton + paused RecBadge while keeping the existing onPress handler and positioning. Touch target must remain ≥44px.

```tsx
import { AnalogButton, RecBadge } from "./analog";

interface Props {
  onPress: () => void;
}

export function MobilePauseButton({ onPress }: Props) {
  return (
    <AnalogButton
      variant="ghost"
      onClick={onPress}
      aria-label="Pause game"
      className="fixed top-3 right-3 z-30 min-w-[44px] min-h-[44px] flex items-center justify-center !p-2"
    >
      <RecBadge paused label="‖" />
    </AnalogButton>
  );
}
```

If the file's existing prop is named differently (e.g., `onClick`), use that name.

- [ ] **Step 3: Run `pnpm check`**

```bash
corepack pnpm check
```

Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/MobilePauseButton.tsx
git commit -m "feat(ui): MobilePauseButton adopts AnalogButton

Ghost-variant button with paused RecBadge inside. Touch target
preserved at 44x44.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: NotFound analog adoption

**Files:**
- Modify: `client/src/pages/NotFound.tsx`

- [ ] **Step 1: Read current file**

```bash
wc -l client/src/pages/NotFound.tsx
```

Expected: ~49 lines.

- [ ] **Step 2: Replace contents**

```tsx
import { Link } from "wouter";
import {
  AnalogPanel,
  AnalogButton,
  ChromaticText,
  RecBadge,
  useAnalogTension,
} from "../ui/analog";

export default function NotFound() {
  useAnalogTension(0.7);
  return (
    <div className="flex min-h-screen items-center justify-center bg-black p-4">
      <AnalogPanel
        classified
        className="w-[min(92vw,560px)] flex flex-col items-center gap-6 py-8"
      >
        <RecBadge label="CHANNEL 03 — SIGNAL LOST" />
        <ChromaticText
          as="h1"
          className="text-4xl font-bold tracking-[0.4em] uppercase"
        >
          Signal Lost
        </ChromaticText>
        <p
          className="font-mono text-xs text-white/60 tracking-widest uppercase"
        >
          The page you looked for is not on this tape.
        </p>
        <Link href="/">
          <AnalogButton variant="primary">Return to feed</AnalogButton>
        </Link>
      </AnalogPanel>
    </div>
  );
}
```

If the existing NotFound uses a different routing import (e.g., `useLocation` instead of `Link`), preserve the existing navigation pattern — wrap the AnalogButton's onClick instead of Link.

- [ ] **Step 3: Run `pnpm check`**

```bash
corepack pnpm check
```

Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/NotFound.tsx
git commit -m "feat(pages): NotFound becomes SIGNAL LOST screen

Full-screen analog treatment with classified AnalogPanel,
ChromaticText title, RecBadge channel marker, and primary
AnalogButton return-to-feed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Game3D HUD wiring

**Files:**
- Modify: `client/src/game/Game3D.tsx`

- [ ] **Step 1: Locate the director state and HUD JSX**

```bash
grep -n "director\|tension\|HUD\|timer\|formatTime" client/src/game/Game3D.tsx | head -40
```

Note the line numbers for:
- The `useState<DirectorUpdate>(...)` call
- The `useEffect` that handles director updates from the engine
- The HUD JSX (timer display, key counter, hint text, REC indicator)
- The `initialQuality` prop

- [ ] **Step 2: Add imports**

```tsx
import {
  ChromaticText,
  GlitchSweep,
  setAnalogTension,
  useAnalogQuality,
} from "../ui/analog";
```

- [ ] **Step 3: Wire `useAnalogQuality`**

Inside the `Game3D` component body, after existing state declarations, add:

```tsx
useAnalogQuality(initialQuality);
```

This pushes the gameplay quality choice onto the stack. When Game3D unmounts (return to title), it pops back to whatever the title screen pushed.

- [ ] **Step 4: Wire `setAnalogTension`**

Find the `useEffect` (or callback from the engine) that handles director updates. Inside it, after `setDirector(update)`, add:

```tsx
setAnalogTension(update.tension);
```

If director updates are not currently in a `useEffect` but in an inline callback passed to the engine, add the call inside that callback. The point is: every time `director.tension` changes, call `setAnalogTension`.

If unsure where the update is fanned in, search:

```bash
grep -n "setDirector" client/src/game/Game3D.tsx
```

Add `setAnalogTension(...)` immediately after each `setDirector` call.

- [ ] **Step 5: Wrap HUD readouts in ChromaticText**

Find the HUD JSX block. Locate the timer (likely `formatTime(timeLeft)` or a `mm:ss` string) and wrap with ChromaticText. Same for the key counter (`KEYS x/N`) and any hint text.

```tsx
<ChromaticText className="font-mono text-2xl tracking-[0.3em]">
  {formatTime(timeLeft)}
</ChromaticText>
```

```tsx
<ChromaticText className="font-mono text-sm tracking-[0.3em]">
  KEYS {collected}/{total}
</ChromaticText>
```

If there's an existing hint or director-reason display:

```tsx
{director.hint && (
  <ChromaticText className="font-mono text-xs uppercase tracking-[0.3em] text-white/70">
    {director.hint}
  </ChromaticText>
)}
```

- [ ] **Step 6: Mount `<GlitchSweep>` once**

Inside the HUD JSX root (not nested inside conditionally-rendered overlays), add:

```tsx
<GlitchSweep />
```

The component self-gates on intensity threshold and reduced-motion.

- [ ] **Step 7: Run `pnpm check`**

```bash
corepack pnpm check
```

Expected: exit code 0.

- [ ] **Step 8: Visual verification**

```bash
corepack pnpm dev
```

Start a game. In DevTools Elements:
- `<html>` `--tension` value should change as you walk near the Observer
- `<html>` `--analog-strength` should reflect chosen quality
- HUD timer/keys should show subtle chromatic offset; offset should widen visibly when Observer closes
- A glitch sweep should appear at high tension (Observer adjacent)

- [ ] **Step 9: Commit**

```bash
git add client/src/game/Game3D.tsx
git commit -m "feat(game): wire Game3D to analog signals

setAnalogTension(director.tension) on each director update;
useAnalogQuality(initialQuality) so the strength multiplier
reflects gameplay quality. HUD timer/keys/hint wrapped in
ChromaticText. GlitchSweep mounted once for tension-gated
sweeps.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Final smoke pass

**Files:**
- No code changes; manual validation only.

- [ ] **Step 1: TypeScript clean**

```bash
corepack pnpm check
```

Expected: exit code 0.

- [ ] **Step 2: Smoke checklist on desktop**

```bash
corepack pnpm dev
```

Walk through:

- Title screen renders. ENTER button styled as analog. REC TAPE 01 corner badge pulses.
- Difficulty cards: classified stamp visible; selecting one rings it red.
- Daily challenge button works (ghost variant).
- Mobile section's joystick prefs (visible only via DevTools mobile emulation) opens and works.
- Click ENTER, loading screen renders with ASCII bar and "LOADING TAPE" header.
- Game canvas appears. HUD readouts (timer top-right, keys, hint) show chromatic offset.
- Walk toward the Observer; HUD chromatic offset visibly widens; glitch sweeps appear when within ~3m.
- Hide in a closet; tension drops; HUD relaxes.
- Press Escape. PauseMenu opens. Scanlines freeze. PAUSED title is stenciled. Resume returns to game.
- Quit to Title. NotFound screen reachable by visiting `/__missing__`. SIGNAL LOST renders.

- [ ] **Step 3: Smoke checklist on mobile**

Either real device (recommended) or DevTools "Toggle device toolbar" with iPhone 14 / Pixel 7. Verify:

- Title screen renders with no horizontal scroll.
- Effects are visibly less intense than desktop (due to mobile auto-tier).
- MobilePauseButton ≥44px touch target; tap pauses.
- PortraitGate appears when device is in landscape orientation; rotate dismisses.

- [ ] **Step 4: Reduced-motion verification**

In DevTools: Rendering panel → "Emulate CSS media feature prefers-reduced-motion" → "reduce".

Reload. Verify:
- Scanlines still render but no longer drift (CSS animation disabled by `@media`).
- GlitchSweep never appears (component returns null).
- RecBadge dot does not pulse.
- HUD chromatic offset is reduced (analog-strength floored to 0.3).

- [ ] **Step 5: DevTools sanity**

Open the Console — there should be no new errors.
In the Elements panel, inspect `<html>`. Computed styles should include both `--tension` (changes during play) and `--analog-strength` (constant per session).

- [ ] **Step 6: Final commit (only if any tweaks were made)**

If the smoke pass surfaced any small issues that need fixing:

```bash
git add <changed files>
git commit -m "fix(ui/analog): <specific fix described>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

If no changes were needed, skip commit.

- [ ] **Step 7: Done**

The 2D analog shell pass is complete. Next steps (out of scope for this plan): sub-project B (3D atmosphere) and sub-project C (marketing surface), each requiring its own brainstorm.

---

## Self-Review (writer's pre-flight)

**Spec coverage:** Each spec section maps to at least one task:
- *Architecture* → Task 1 (signals), Task 2 (AnalogShell)
- *Module layout* → Tasks 1-6 create every file in the spec's `client/src/ui/analog/` listing
- *Tension bridge* → Task 1 (signals.ts implementation), Task 14 (Game3D wiring)
- *CSS token contract* → Task 1 (tokens.css with every documented variable)
- *Component contracts* — `<AnalogShell>` Task 2, `<Scanlines>` Task 3, `<ChromaticText>`/`<RecBadge>` Task 4, `<AnalogPanel>`/`<AnalogButton>` Task 5, `<GlitchSweep>` Task 6
- *Per-surface application* — Task 7 (TitleScreen), 8 (LoadingScreen), 9 (PauseMenu), 10 (Tutorial+PortraitGate), 11 (Minimap+ObserverIndicator), 12 (MobilePauseButton), 13 (NotFound), 14 (Game3D HUD), App.tsx in Task 3, index.css in Task 1
- *Quality / device gating* → Task 2's `computeStrength`
- *Performance* — design enforces it (CSS-var write, no React re-render, `null` gating in GlitchSweep); Task 15 manually verifies
- *Testing strategy* → Task 15 explicitly walks the spec's smoke checklist

**Placeholder scan:** No "TBD"/"TODO" tokens in any task. Every code block contains complete code. The few cases referencing `existingExtras`/`existingTitleText`/`existingMessageText` are intentional — Tasks 8-12 modify files this plan deliberately did not pin to exact line ranges (they are short enough to be read by the implementer at task start; the plan tells them what to wrap and what to preserve).

**Type consistency:** `setAnalogTension(value: number)`, `useAnalogTension(value: number)`, `useAnalogQuality(quality: GraphicsQuality)`, `subscribeAnalogQuality` — names are consistent across Task 1 (definition), Tasks 7-14 (consumers).
