import { useEffect, useRef, useState } from "react";
import { startGame, type EngineHandle, type RemotePlayer } from "./engine";

type Status = "title" | "playing" | "caught" | "escaped";

export default function Game3D() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<EngineHandle | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>("title");
  const [keysLeft, setKeysLeft] = useState<number | null>(null);
  const [hint, setHint] = useState("Click to lock pointer · WASD to move · Shift to sprint");
  const [engineError, setEngineError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "playing" || !containerRef.current) return;
    const handle = startGame(containerRef.current, {
      mapKey: "easy",
      events: {
        onKeyPickup: (remaining) => setKeysLeft(remaining),
        onCaught: () => setStatus("caught"),
        onEscape: () => setStatus("escaped"),
        onError: (err) => {
          setEngineError(err.message || "Render loop crashed");
          setStatus("title");
        },
      },
    });
    engineRef.current = handle;

    // Best-effort multiplayer wiring. If no server is reachable (e.g. on a
    // static Netlify deploy without the websocket gateway), we silently
    // remain in single-player mode rather than failing the render.
    const wsUrl = buildWsUrl();
    let ws: WebSocket | null = null;
    let stateTimer: number | null = null;
    try {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.addEventListener("open", () => {
        ws?.send(JSON.stringify({ type: "join", difficulty: "easy" }));
        stateTimer = window.setInterval(() => {
          if (!handle || ws?.readyState !== WebSocket.OPEN) return;
          const s = handle.getPlayerState();
          ws.send(JSON.stringify({ type: "move", x: s.x, z: s.z, rotY: s.rotY }));
        }, 80);
      });
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "state" && Array.isArray(msg.players)) {
            const remotes: RemotePlayer[] = msg.players
              .filter((p: RemotePlayer & { self?: boolean }) => !p.self)
              .map((p: RemotePlayer) => ({
                id: p.id,
                x: p.x,
                z: p.z,
                rotY: p.rotY ?? 0,
                name: p.name,
              }));
            handle.setRemotePlayers(remotes);
            if (msg.enemy) handle.setEnemy({ x: msg.enemy.x, z: msg.enemy.z });
          }
        } catch {
          // ignore malformed frames
        }
      });
      ws.addEventListener("error", () => setHint("Multiplayer offline · single-player mode"));
    } catch {
      setHint("Multiplayer offline · single-player mode");
    }

    return () => {
      if (stateTimer != null) window.clearInterval(stateTimer);
      ws?.close();
      wsRef.current = null;
      handle.dispose();
      engineRef.current = null;
    };
  }, [status]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black text-white select-none">
      <div ref={containerRef} className="absolute inset-0" />

      {status === "title" && (
        <Overlay>
          <h1 className="text-5xl font-bold tracking-widest mb-2">HUNTED</h1>
          <p className="opacity-70 mb-8">A Granny-style multiplayer horror escape</p>
          {engineError && (
            <div className="mb-4 px-4 py-2 bg-red-900/70 border border-red-500 rounded text-sm text-red-100 max-w-md text-center">
              Render loop crashed: {engineError}
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setEngineError(null);
              setStatus("playing");
            }}
            className="px-8 py-3 bg-red-700 hover:bg-red-600 transition-colors rounded font-semibold tracking-widest"
          >
            ENTER THE HOUSE
          </button>
          <p className="mt-8 text-xs opacity-50 max-w-md text-center">
            Find every glowing key, then reach the green exit. Don&apos;t let
            Claude catch you. Move with WASD, look with the mouse.
          </p>
        </Overlay>
      )}

      {status === "playing" && (
        <div className="absolute top-3 left-3 text-xs font-mono bg-black/60 px-3 py-2 rounded">
          <div>Keys remaining: {keysLeft ?? "—"}</div>
          <div className="opacity-60">{hint}</div>
        </div>
      )}

      {status === "caught" && (
        <Overlay>
          <h2 className="text-4xl font-bold text-red-500 mb-4">CAUGHT</h2>
          <RestartButton onClick={() => setStatus("playing")} />
        </Overlay>
      )}
      {status === "escaped" && (
        <Overlay>
          <h2 className="text-4xl font-bold text-green-400 mb-4">YOU ESCAPED</h2>
          <RestartButton onClick={() => setStatus("playing")} />
        </Overlay>
      )}

      {status === "playing" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="w-1 h-1 bg-white/80 rounded-full" />
        </div>
      )}
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
      {children}
    </div>
  );
}

function RestartButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-6 py-2 bg-red-700 hover:bg-red-600 rounded font-semibold tracking-wider"
    >
      TRY AGAIN
    </button>
  );
}

function buildWsUrl() {
  // Priority:
  // 1. VITE_WS_URL — explicit override (e.g. wss://hunted-horror-game2.onrender.com/ws)
  //    used when the static client is hosted separately from the websocket
  //    backend (Netlify static + Render websocket service).
  // 2. Same-origin /ws — used in dev (vite proxies to localhost:2567) and
  //    when the Express + ws server serves the bundled client itself.
  const override = import.meta.env.VITE_WS_URL as string | undefined;
  if (override && override.length > 0) return override;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}
