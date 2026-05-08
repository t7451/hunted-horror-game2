import { Suspense, lazy, useEffect, useState } from "react";
import { TitleScreen } from "../ui/TitleScreen";
import { type MapKey } from "@shared/maps";
import { type GraphicsQuality } from "../util/device";

// Game3D (+ Three.js + engine) only loads after the user clicks Enter.
// Initial page is title-screen-only; the heavy game chunk loads on-demand.
const Game3D = lazy(() => import("../game/Game3D"));

function detectWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(
      c.getContext("webgl2") ??
      c.getContext("webgl") ??
      c.getContext("experimental-webgl")
    );
  } catch {
    return false;
  }
}

interface GameOptions {
  difficulty: MapKey;
  quality: GraphicsQuality;
  sensitivity: number;
}

export default function Home() {
  const [opts, setOpts] = useState<GameOptions | null>(null);
  const [volume, setVolume] = useState(0.8);
  const webglSupported = detectWebGL();

  // Apply master volume globally so the title screen and game share one knob.
  useEffect(() => {
    void import("howler")
      .then(({ Howler }) => Howler.volume(volume))
      .catch(() => {});
  }, [volume]);

  if (!opts) {
    return (
      <TitleScreen
        onEnter={setOpts}
        webglSupported={webglSupported}
        volume={volume}
        onVolume={setVolume}
      />
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-black font-mono text-xs tracking-widest text-white opacity-60">
          LOADING ENGINE…
        </div>
      }
    >
      <Game3D
        initialDifficulty={opts.difficulty}
        initialQuality={opts.quality}
        initialSensitivity={opts.sensitivity}
        initialVolume={volume}
        onReturnToTitle={() => setOpts(null)}
        onVolumeChange={setVolume}
      />
    </Suspense>
  );
}
