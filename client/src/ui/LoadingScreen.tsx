import { useEffect, useRef, useState } from "react";

// Loading screen between the difficulty-select title and the running scene.
// Spec §9 calls for progress driven by `AssetManager.onPhase` once real
// asset loading lands. Until then we drive a simulated phase sequence so
// the loading-flow UX is in place and the AssetManager can be wired by
// just replacing the timer with subscriptions.

const PHASES = [
  "Building the house",
  "Hanging paintings",
  "Lighting candles",
  "Sweeping the floors",
  "Listening at the door",
  "Ready",
] as const;
type Phase = (typeof PHASES)[number];

const TIPS = [
  "Don't run if The Observer is near.",
  "Hold E to hide near closets.",
  "Sprint with Shift, but the noise carries.",
  "The vignette pulses when you're being hunted.",
  "Find every key. Then find the green door.",
];

export type LoadingScreenProps = {
  /**
   * Called when the simulated load reaches "Ready" and the user is taken
   * into the scene. Game3D treats this as the cue to set
   * `status = "playing"`. Receives no args; the click that triggered the
   * Enter button is the iOS audio-unlock gesture (canvas click in-engine
   * also unlocks).
   */
  onReady: () => void;
  /** Optional overall load duration (ms). Default ~2.4s. */
  durationMs?: number;
};

export default function LoadingScreen({
  onReady,
  // Reduced from 2.4s to 1.0s — when we're not actually loading anything
  // (no real asset bundle yet), the long delay was just dead air. Real
  // AssetManager-driven progress will set its own pace.
  durationMs = 1000,
}: LoadingScreenProps) {
  const [progress, setProgress] = useState(0); // 0..1
  const [phase, setPhase] = useState<Phase>(PHASES[0]);
  const [tipIdx, setTipIdx] = useState(0);
  const [ready, setReady] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);

  // Drive progress + phase rotation. Each phase consumes an equal slice of
  // the duration; "Ready" lands exactly at progress = 1.
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / durationMs);
      setProgress(t);
      // Map [0,1] across the first N-1 phases; the final "Ready" only
      // shows once we hit 1.
      if (t >= 1) {
        setPhase("Ready");
        setReady(true);
        return;
      }
      const slot = Math.min(
        PHASES.length - 2,
        Math.floor(t * (PHASES.length - 1)),
      );
      setPhase(PHASES[slot]);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [durationMs]);

  // Rotate tips every 4s so a slow connection doesn't get a static screen.
  useEffect(() => {
    const id = window.setInterval(() => {
      setTipIdx((i) => (i + 1) % TIPS.length);
    }, 4000);
    return () => window.clearInterval(id);
  }, []);

  const handleEnter = () => {
    if (!ready || fadingOut) return;
    setFadingOut(true);
    // Match fade-out duration in the className transition (300ms).
    window.setTimeout(onReady, 300);
  };

  return (
    <div
      className={`absolute inset-0 z-50 flex flex-col items-center justify-center bg-black text-white transition-opacity duration-300 ${
        fadingOut ? "opacity-0" : "opacity-100"
      }`}
    >
      <CrtBackdrop />
      <div className="relative z-10 flex flex-col items-center px-6">
        <h1
          className="text-4xl sm:text-5xl font-bold tracking-[0.4em] text-red-300 drop-shadow-[0_0_24px_rgba(255,0,0,0.4)]"
          style={{ fontFamily: '"Special Elite", "Courier New", monospace' }}
        >
          HUNTED BY THE OBSERVER
        </h1>
        <div className="mt-3 text-xs uppercase tracking-[0.3em] opacity-60">
          {phase}
        </div>

        <div className="mt-8 w-[min(90vw,520px)]">
          <div className="relative h-1 w-full overflow-hidden rounded bg-white/10">
            <div
              className="absolute inset-y-0 left-0 bg-red-700 transition-[width] duration-200 ease-out"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 w-12 -skew-x-12 bg-gradient-to-r from-transparent via-white/40 to-transparent"
              style={{
                transform: `translateX(${progress * 540}px) skewX(-12deg)`,
                opacity: ready ? 0 : 0.7,
                transition: "opacity 200ms ease-out",
              }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[10px] uppercase tracking-widest opacity-40">
            <span>{Math.round(progress * 100)}%</span>
            <span>{ready ? "ready" : "loading"}</span>
          </div>
        </div>

        <div
          className="mt-10 max-w-md text-center text-sm italic opacity-60"
          aria-live="polite"
        >
          {TIPS[tipIdx]}
        </div>

        <button
          type="button"
          disabled={!ready}
          onClick={handleEnter}
          className={`mt-10 rounded border px-8 py-3 text-sm font-semibold tracking-[0.4em] uppercase transition-colors ${
            ready
              ? "border-red-400 bg-red-950/70 hover:bg-red-900 cursor-pointer"
              : "border-white/15 bg-black/50 opacity-50 cursor-not-allowed"
          }`}
        >
          Enter
        </button>
      </div>
    </div>
  );
}

// Cheap animated CRT noise — full-screen canvas re-painted every ~6 frames.
// 24x18 grid keyed to viewport DPR keeps cost negligible on mobile.
function CrtBackdrop() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = (canvas.width = 240);
    const h = (canvas.height = 180);
    let raf = 0;
    let frame = 0;
    const loop = () => {
      frame++;
      if (frame % 3 === 0) {
        const img = ctx.createImageData(w, h);
        for (let i = 0; i < w * h; i++) {
          const v = Math.random() < 0.4 ? 28 : 10;
          img.data[i * 4 + 0] = v;
          img.data[i * 4 + 1] = v * 0.6;
          img.data[i * 4 + 2] = v * 0.6;
          img.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <canvas
      ref={ref}
      className="absolute inset-0 h-full w-full opacity-25 mix-blend-screen"
      aria-hidden="true"
    />
  );
}
