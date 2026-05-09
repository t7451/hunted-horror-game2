import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { TitleScreen } from "../ui/TitleScreen";
import { MultiplayerLobby } from "../ui/MultiplayerLobby";
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
  daily?: boolean;
  mode?: "solo" | "multi";
  playerName?: string;
  roomCode?: string;
}

export default function Home() {
  const [opts, setOpts] = useState<GameOptions | null>(null);
  const [volume, setVolume] = useState(0.8);
  const webglSupported = detectWebGL();
  // For multiplayer: the WebSocket opened by MultiplayerLobby is handed off
  // to Game3D so it doesn't open a second connection.
  const multiWsRef = useRef<WebSocket | null>(null);
  const multiPlayerIdRef = useRef<string>("");

  // Apply master volume globally so the title screen and game share one knob.
  useEffect(() => {
    void import("howler")
      .then(({ Howler }) => Howler.volume(volume))
      .catch(() => {});
  }, [volume]);

  const returnToTitle = () => {
    multiWsRef.current = null;
    multiPlayerIdRef.current = "";
    setOpts(null);
  };

  // Title screen
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

  // Multiplayer lobby (pre-game waiting room)
  if (opts.mode === "multi" && !multiWsRef.current) {
    return (
      <MultiplayerLobby
        difficulty={opts.difficulty}
        playerName={opts.playerName ?? "Player"}
        roomCode={opts.roomCode}
        onGameStart={(ws, localPlayerId) => {
          multiWsRef.current = ws;
          multiPlayerIdRef.current = localPlayerId;
          // Force a re-render to move on to Game3D
          setOpts(o => (o ? { ...o } : o));
        }}
        onCancel={returnToTitle}
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
        isDaily={opts.daily ?? false}
        multiWs={opts.mode === "multi" ? (multiWsRef.current ?? undefined) : undefined}
        localPlayerId={opts.mode === "multi" ? multiPlayerIdRef.current : undefined}
        onReturnToTitle={returnToTitle}
        onVolumeChange={setVolume}
      />
    </Suspense>
  );
}
