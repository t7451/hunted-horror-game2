import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { MAPS, MAP_KEYS, type MapKey } from "@shared/maps";
import { supportsWebGL, type GraphicsQuality } from "../util/device";
import { startGame, type EngineHandle, type RemotePlayer } from "./engine";
import type { DirectorUpdate } from "./aiDirector";
import { useIsMobile } from "../hooks/useMobile";
import LoadingScreen from "../ui/LoadingScreen";

type Status = "title" | "loading" | "playing" | "caught" | "escaped";
type Danger = "safe" | "near" | "critical";

const DANGER_STYLES: Record<Danger, string> = {
  critical: "bg-red-950/80 border-red-400 hunted-hud-critical",
  near: "bg-yellow-950/70 border-yellow-500/60 hunted-hud-near",
  safe: "bg-black/60 border-white/10",
};

const INITIAL_DIRECTOR: DirectorUpdate = {
  tension: 0.35,
  enemySpeedMultiplier: 1,
  reason: "calibrating",
};

const DESKTOP_START_HINT =
  "Click to lock pointer · WASD/Arrows move · Shift sprint · E hides near closets";
const MOBILE_START_HINT =
  "Drag left pad to move · swipe the screen to look · use sprint/hide buttons";
const DESKTOP_CONTROL_HINT =
  "WASD/Arrows move · Mouse look · Shift sprint · E hide near closets";
const MOBILE_CONTROL_HINT =
  "Drag left pad to move · swipe view to look · sprint / hide buttons";
const JOYSTICK_RADIUS_FACTOR = 0.36;

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
  const [director, setDirector] = useState<DirectorUpdate>(INITIAL_DIRECTOR);
  const [hint, setHint] = useState(
    "Click to lock pointer · WASD to move · Shift to sprint"
  );
  const [engineError, setEngineError] = useState<string | null>(null);
  const [webglSupported] = useState(() => supportsWebGL());
  const isMobile = useIsMobile();

  const selectedMap = MAPS[difficulty];
  const difficultyOptions = useMemo(
    () =>
      MAP_KEYS.map(key => ({
        key,
        ...MAPS[key],
      })),
    []
  );

  useEffect(() => {
    if (status !== "playing" || !containerRef.current) return;
    setKeysLeft(null);
    setTimeLeft(selectedMap.timer);
    setDanger("safe");
    setHidden(false);
    setDirector(INITIAL_DIRECTOR);
    setHint(isMobile ? MOBILE_START_HINT : DESKTOP_START_HINT);

    let handle: EngineHandle | null = null;
    try {
      handle = startGame(containerRef.current, {
        mapKey: difficulty,
        quality,
        sensitivity,
        events: {
          onReady: info => {
            setKeysLeft(info.keys);
            setTimeLeft(info.timer);
            setHint(
              isMobile
                ? `${info.mapName}: collect keys, then reach the green exit. Drag to look.`
                : `${info.mapName}: collect every key, then reach the green exit.`
            );
          },
          onKeyPickup: remaining => {
            setKeysLeft(remaining);
            setHint(
              remaining === 0
                ? "All keys found. The exit is open."
                : "Key collected."
            );
          },
          onCaught: () => setStatus("caught"),
          onEscape: () => setStatus("escaped"),
          onError: err => {
            setEngineError(err.message || "Render loop crashed");
            setStatus("title");
          },
          onHint: setHint,
          onTimer: setTimeLeft,
          onDangerChange: setDanger,
          onHideChange: setHidden,
          onAIDirector: setDirector,
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
          ws.send(
            JSON.stringify({ type: "move", x: s.x, z: s.z, rotY: s.rotY })
          );
        }, 80);
      });
      ws.addEventListener("message", ev => {
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
      ws.addEventListener("error", () =>
        setHint("Multiplayer offline · local Observer enabled")
      );
    } catch {
      setHint("Multiplayer offline · local Observer enabled");
    }

    return () => {
      if (stateTimer != null) window.clearInterval(stateTimer);
      ws?.close();
      wsRef.current = null;
      handle?.dispose();
      engineRef.current = null;
    };
  }, [difficulty, isMobile, quality, selectedMap.timer, sensitivity, status]);

  const setVirtualMove = useCallback((moveX: number, moveZ: number) => {
    engineRef.current?.setVirtualInput({ moveX, moveZ });
  }, []);

  const setVirtualSprint = useCallback((sprinting: boolean) => {
    engineRef.current?.setVirtualInput({ sprinting });
  }, []);

  const toggleVirtualHide = useCallback(() => {
    engineRef.current?.toggleHide();
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black text-white select-none">
      <div ref={containerRef} className="absolute inset-0" />

      {status === "title" && (
        <Overlay>
          <h1 className="text-5xl font-bold tracking-widest mb-2">HUNTED</h1>
          <p className="opacity-70 mb-6">
            A browser-first horror escape with adaptive graphics
          </p>
          {!webglSupported && (
            <div className="mb-4 px-4 py-2 bg-red-900/70 border border-red-500 rounded text-sm text-red-100 max-w-md text-center">
              WebGL is unavailable in this browser. Enable hardware acceleration
              or try another browser.
            </div>
          )}
          {engineError && (
            <div className="mb-4 px-4 py-2 bg-red-900/70 border border-red-500 rounded text-sm text-red-100 max-w-md text-center">
              Render loop crashed: {engineError}
            </div>
          )}

          <div className="grid gap-3 w-[min(92vw,720px)] sm:grid-cols-3 mb-5">
            {difficultyOptions.map(option => (
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
              <span className="text-xs uppercase tracking-widest opacity-60">
                Graphics
              </span>
              <select
                value={quality}
                onChange={e => setQuality(e.target.value as GraphicsQuality)}
                className="rounded bg-black/80 border border-white/20 px-2 py-2"
              >
                <option value="auto">Auto</option>
                <option value="low">Low latency</option>
                <option value="mid">Balanced</option>
                <option value="high">High atmosphere</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-widest opacity-60">
                Look sensitivity
              </span>
              <input
                type="range"
                min="0.5"
                max="1.6"
                step="0.1"
                value={sensitivity}
                onChange={e => setSensitivity(Number(e.target.value))}
              />
            </label>
          </div>

          <button
            type="button"
            disabled={!webglSupported}
            onClick={() => {
              setEngineError(null);
              setStatus("loading");
            }}
            className="px-8 py-3 bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:hover:bg-red-700 transition-colors rounded font-semibold tracking-widest"
          >
            ENTER THE HOUSE
          </button>
          <p className="mt-6 text-xs opacity-60 max-w-xl text-center">
            Find glowing keys, hide in closets with E, then reach the green exit
            before the timer expires. A local AI director adapts pursuit pace
            and hints entirely in your browser.
          </p>
        </Overlay>
      )}

      {status === "loading" && (
        <LoadingScreen onReady={() => setStatus("playing")} />
      )}

      {status === "playing" && (
        <>
          <div
            className={`pointer-events-none absolute inset-0 hunted-fear-vignette ${
              danger === "critical"
                ? "hunted-fear-critical"
                : danger === "near"
                  ? "hunted-fear-near"
                  : ""
            }`}
          />
          <div
            className={`absolute top-3 left-3 max-w-sm text-xs font-mono px-3 py-2 rounded border ${DANGER_STYLES[danger]}`}
          >
            <div>
              Objective: {keysLeft === 0 ? "Reach the exit" : "Find every key"}
            </div>
            <div>Keys remaining: {keysLeft ?? "—"}</div>
            <div>
              Time left: {timeLeft === null ? "—" : formatTime(timeLeft)}
            </div>
            <div>
              Stealth:{" "}
              {hidden
                ? "hidden"
                : danger === "safe"
                  ? "clear"
                  : "The Observer is close"}
            </div>
            <div>
              AI Director: {Math.round(director.tension * 100)}% tension · pace{" "}
              {director.enemySpeedMultiplier.toFixed(2)}x
            </div>
            <div className="opacity-60">Mode: {director.reason}</div>
            <div className="mt-1 opacity-70">{hint}</div>
          </div>
          <div className="pointer-events-none absolute bottom-3 left-1/2 w-[min(92vw,520px)] -translate-x-1/2 rounded bg-black/50 px-3 py-2 text-center text-xs opacity-80">
            {isMobile ? MOBILE_CONTROL_HINT : DESKTOP_CONTROL_HINT}
          </div>
          {danger !== "safe" && (
            <div className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-[10px] uppercase tracking-[0.35em] text-red-200/50 [writing-mode:vertical-rl]">
              {danger === "critical" ? "do not turn around" : "he heard you"}
            </div>
          )}
          {isMobile && (
            <MobileControls
              onMove={setVirtualMove}
              onSprint={setVirtualSprint}
              onHide={toggleVirtualHide}
            />
          )}
        </>
      )}

      {status === "caught" && (
        <Overlay>
          <h2 className="text-4xl font-bold text-red-500 mb-4">CAUGHT</h2>
          <p className="text-4xl font-mono text-white/20 tracking-widest mb-2">
            PROCESS TERMINATED
          </p>
          <p className="text-sm font-mono text-white/30 mb-6">
            {`0x${Math.floor(Math.random() * 0xffff)
              .toString(16)
              .toUpperCase()
              .padStart(4, "0")}`}
          </p>
          <RestartButton onClick={() => setStatus("playing")} />
        </Overlay>
      )}
      {status === "escaped" && (
        <Overlay>
          <h2 className="text-4xl font-bold text-green-400 mb-4">
            YOU ESCAPED
          </h2>
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

function MobileControls({
  onMove,
  onSprint,
  onHide,
}: {
  onMove: (moveX: number, moveZ: number) => void;
  onSprint: (sprinting: boolean) => void;
  onHide: () => void;
}) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0, active: false });

  const updatePad = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const pad = padRef.current;
      if (!pad) return;
      const rect = pad.getBoundingClientRect();
      const radius = Math.max(1, rect.width * JOYSTICK_RADIUS_FACTOR);
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      const len = Math.hypot(dx, dy);
      const scale = len > radius ? radius / len : 1;
      const x = dx * scale;
      const y = dy * scale;
      onMove(x / radius, y / radius);
      setKnob({ x, y, active: true });
    },
    [onMove]
  );

  const releasePad = useCallback(() => {
    pointerIdRef.current = null;
    onMove(0, 0);
    setKnob({ x: 0, y: 0, active: false });
  }, [onMove]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between px-4 pb-16 sm:px-8">
      <div
        ref={padRef}
        className="pointer-events-auto relative h-32 w-32 rounded-full border border-white/25 bg-black/45 backdrop-blur"
        style={{ touchAction: "none" }}
        onPointerDown={event => {
          pointerIdRef.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          updatePad(event);
        }}
        onPointerMove={event => {
          if (pointerIdRef.current === event.pointerId) updatePad(event);
        }}
        onPointerUp={releasePad}
        onPointerCancel={releasePad}
      >
        <div
          className={`absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/35 ${
            knob.active ? "bg-red-500/70" : "bg-white/20"
          }`}
          style={{
            transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
          }}
        />
        <div className="absolute inset-x-0 bottom-3 text-center text-[10px] uppercase tracking-widest text-white/60">
          Move
        </div>
      </div>

      <div className="pointer-events-auto flex flex-col gap-3">
        <button
          type="button"
          className="h-16 w-24 rounded-full border border-red-300/40 bg-red-900/65 text-xs font-bold uppercase tracking-widest shadow-lg backdrop-blur active:bg-red-600/80"
          style={{ touchAction: "none" }}
          onPointerDown={() => onSprint(true)}
          onPointerUp={() => onSprint(false)}
          onPointerCancel={() => onSprint(false)}
          onPointerLeave={() => onSprint(false)}
        >
          Sprint
        </button>
        <button
          type="button"
          className="h-16 w-24 rounded-full border border-white/30 bg-black/60 text-xs font-bold uppercase tracking-widest shadow-lg backdrop-blur active:bg-white/20"
          onClick={onHide}
        >
          Hide
        </button>
      </div>
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
