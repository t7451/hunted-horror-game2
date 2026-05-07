import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MAPS, MAP_KEYS, type MapKey } from "@shared/maps";
import { supportsWebGL, type GraphicsQuality } from "../util/device";
import { startGame, type EngineHandle, type RemotePlayer } from "./engine";

type Status = "title" | "playing" | "caught" | "escaped";
type Danger = "safe" | "near" | "critical";

export default function Game3D() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<EngineHandle | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>("title");
  const [difficulty, setDifficulty] = useState<MapKey>("easy");
  const [quality, setQuality] = useState<GraphicsQuality>("auto");
  const [sensitivity, setSensitivity] = useState(1);
  const [keysLeft, setKeysLeft] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [danger, setDanger] = useState<Danger>("safe");
  const [hidden, setHidden] = useState(false);
  const [hint, setHint] = useState("Click to lock pointer · WASD to move · Shift to sprint");
  const [engineError, setEngineError] = useState<string | null>(null);
  const [webglSupported] = useState(() => supportsWebGL());

  const selectedMap = MAPS[difficulty];
  const difficultyOptions = useMemo(
    () =>
      MAP_KEYS.map((key) => ({
        key,
        ...MAPS[key],
      })),
    [],
  );

  useEffect(() => {
    if (status !== "playing" || !containerRef.current) return;
    setKeysLeft(null);
    setTimeLeft(selectedMap.timer);
    setDanger("safe");
    setHidden(false);
    setHint("Click to lock pointer · WASD/Arrows move · Shift sprint · E hides near closets");

    let handle: EngineHandle | null = null;
    try {
      handle = startGame(containerRef.current, {
        mapKey: difficulty,
        quality,
        sensitivity,
        events: {
          onReady: (info) => {
            setKeysLeft(info.keys);
            setTimeLeft(info.timer);
            setHint(`${info.mapName}: collect every key, then reach the green exit.`);
          },
          onKeyPickup: (remaining) => {
            setKeysLeft(remaining);
            setHint(remaining === 0 ? "All keys found. The exit is open." : "Key collected.");
          },
          onCaught: () => setStatus("caught"),
          onEscape: () => setStatus("escaped"),
          onError: (err) => {
            setEngineError(err.message || "Render loop crashed");
            setStatus("title");
          },
          onHint: setHint,
          onTimer: setTimeLeft,
          onDangerChange: setDanger,
          onHideChange: setHidden,
        },
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setEngineError(error.message);
      setStatus("title");
      return;
    }
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
        ws?.send(JSON.stringify({ type: "join", difficulty }));
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
      ws.addEventListener("error", () => setHint("Multiplayer offline · local Claude enabled"));
    } catch {
      setHint("Multiplayer offline · local Claude enabled");
    }

    return () => {
      if (stateTimer != null) window.clearInterval(stateTimer);
      ws?.close();
      wsRef.current = null;
      handle?.dispose();
      engineRef.current = null;
    };
  }, [difficulty, quality, selectedMap.timer, sensitivity, status]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black text-white select-none">
      <div ref={containerRef} className="absolute inset-0" />

      {status === "title" && (
        <Overlay>
          <h1 className="text-5xl font-bold tracking-widest mb-2">HUNTED</h1>
          <p className="opacity-70 mb-6">A browser-first horror escape with adaptive graphics</p>
          {!webglSupported && (
            <div className="mb-4 px-4 py-2 bg-red-900/70 border border-red-500 rounded text-sm text-red-100 max-w-md text-center">
              WebGL is unavailable in this browser. Enable hardware acceleration or try another
              browser.
            </div>
          )}
          {engineError && (
            <div className="mb-4 px-4 py-2 bg-red-900/70 border border-red-500 rounded text-sm text-red-100 max-w-md text-center">
              Render loop crashed: {engineError}
            </div>
          )}

          <div className="grid gap-3 w-[min(92vw,720px)] sm:grid-cols-3 mb-5">
            {difficultyOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setDifficulty(option.key)}
                className={`rounded border px-4 py-3 text-left transition-colors ${
                  difficulty === option.key
                    ? "border-red-400 bg-red-950/70"
                    : "border-white/20 bg-black/50 hover:border-white/50"
                }`}
              >
                <div className="font-semibold tracking-wide">{option.name}</div>
                <div className="mt-1 text-xs opacity-70">{option.summary}</div>
                <div className="mt-2 text-[11px] opacity-60">
                  {formatTime(option.timer)} · danger {option.difficulty}/3
                </div>
              </button>
            ))}
          </div>

          <div className="mb-6 grid w-[min(92vw,520px)] gap-3 rounded border border-white/15 bg-black/40 p-4 text-sm sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-widest opacity-60">Graphics</span>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as GraphicsQuality)}
                className="rounded bg-black/80 border border-white/20 px-2 py-2"
              >
                <option value="auto">Auto</option>
                <option value="low">Low latency</option>
                <option value="mid">Balanced</option>
                <option value="high">High atmosphere</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-widest opacity-60">Look sensitivity</span>
              <input
                type="range"
                min="0.5"
                max="1.6"
                step="0.1"
                value={sensitivity}
                onChange={(e) => setSensitivity(Number(e.target.value))}
              />
            </label>
          </div>

          <button
            type="button"
            disabled={!webglSupported}
            onClick={() => {
              setEngineError(null);
              setStatus("playing");
            }}
            className="px-8 py-3 bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:hover:bg-red-700 transition-colors rounded font-semibold tracking-widest"
          >
            ENTER THE HOUSE
          </button>
          <p className="mt-6 text-xs opacity-60 max-w-xl text-center">
            Find glowing keys, hide in closets with E, then reach the green exit before the timer
            expires. Low graphics skips costly effects for older browsers and mobile GPUs.
          </p>
        </Overlay>
      )}

      {status === "playing" && (
        <>
          <div
            className={`absolute top-3 left-3 max-w-sm text-xs font-mono px-3 py-2 rounded border ${
              danger === "critical"
                ? "bg-red-950/75 border-red-400"
                : danger === "near"
                  ? "bg-yellow-950/70 border-yellow-500/60"
                  : "bg-black/60 border-white/10"
            }`}
          >
            <div>Objective: {keysLeft === 0 ? "Reach the exit" : "Find every key"}</div>
            <div>Keys remaining: {keysLeft ?? "—"}</div>
            <div>Time left: {timeLeft == null ? "—" : formatTime(timeLeft)}</div>
            <div>Stealth: {hidden ? "hidden" : danger === "safe" ? "clear" : "Claude is close"}</div>
            <div className="mt-1 opacity-70">{hint}</div>
          </div>
          <div className="pointer-events-none absolute bottom-3 left-1/2 w-[min(92vw,520px)] -translate-x-1/2 rounded bg-black/50 px-3 py-2 text-center text-xs opacity-80">
            WASD/Arrows move · Mouse look · Shift sprint · E hide near closets
          </div>
        </>
      )}

      {status === "caught" && (
        <Overlay>
          <h2 className="text-4xl font-bold text-red-500 mb-4">CAUGHT</h2>
          <p className="mb-6 max-w-md text-center text-sm opacity-70">
            Claude found you before you completed the objective.
          </p>
          <RestartButton onClick={() => setStatus("playing")} />
        </Overlay>
      )}
      {status === "escaped" && (
        <Overlay>
          <h2 className="text-4xl font-bold text-green-400 mb-4">YOU ESCAPED</h2>
          <p className="mb-6 max-w-md text-center text-sm opacity-70">
            Every key recovered. The exit opened just in time.
          </p>
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

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center overflow-y-auto bg-black/75 px-4 py-8 backdrop-blur-sm">
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

function formatTime(value: number) {
  const seconds = Math.max(0, Math.ceil(value));
  const min = Math.floor(seconds / 60);
  const sec = String(seconds % 60).padStart(2, "0");
  return `${min}:${sec}`;
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
