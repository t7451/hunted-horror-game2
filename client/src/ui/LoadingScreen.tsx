import { useEffect, useRef, useState } from "react";
import { buildLoadManifest } from "../loaders/loadManifest";
import { preloadAssets } from "../loaders/AssetPreloader";
import { useIsMobile } from "../hooks/useMobile";
import { requestFullscreen } from "../util/fullscreen";

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
};

export default function LoadingScreen({ onReady }: LoadingScreenProps) {
  const isMobile = useIsMobile();
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<string>("Building the house");
  const [tipIdx, setTipIdx] = useState(0);
  const [ready, setReady] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const startedRef = useRef(false);

  // Real preload: HTTP-cache-warm every audio file and KTX2 texture so the
  // engine's first decode is near-instant. Hold the screen at least 600ms
  // even on cached returns so the UX has visual stability.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const ctrl = new AbortController();
    const manifest = buildLoadManifest();
    const minDuration = 600;
    const start = performance.now();

    void preloadAssets(
      manifest,
      p => {
        setProgress(p.ratio);
        setPhase(p.currentLabel);
      },
      ctrl.signal
    ).then(() => {
      const elapsed = performance.now() - start;
      const wait = Math.max(0, minDuration - elapsed);
      window.setTimeout(() => setReady(true), wait);
    });

    return () => ctrl.abort();
  }, []);

  // Rotate tips every 4s so a slow connection doesn't get a static screen.
  useEffect(() => {
    const id = window.setInterval(() => {
      setTipIdx((i) => (i + 1) % TIPS.length);
    }, 4000);
    return () => window.clearInterval(id);
  }, []);

  const handleEnter = () => {
    if (!ready || fadingOut) return;
    if (isMobile) {
      void requestFullscreen();
    }
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
