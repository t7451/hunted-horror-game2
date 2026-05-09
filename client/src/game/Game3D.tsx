import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { MAPS, type MapKey } from "@shared/maps";
import { type GraphicsQuality } from "../util/device";
import { startGame, type EngineHandle, type RemotePlayer } from "./engine";
import type { DirectorUpdate } from "./aiDirector";
import { useIsMobile } from "../hooks/useMobile";
import LoadingScreen from "../ui/LoadingScreen";
import { recordRun } from "../hooks/useGameStats";
import { getDailySeed, saveDailyResult } from "../hooks/useDailyChallenge";
import { Minimap } from "../ui/Minimap";
import { ObserverIndicator } from "../ui/ObserverIndicator";
import { PauseMenu } from "../ui/PauseMenu";
import { MobilePauseButton } from "../ui/MobilePauseButton";
import { PortraitGate } from "../ui/PortraitGate";
import { lockLandscape } from "../util/orientation";
import { acquireWakeLock, releaseWakeLock } from "../util/wakeLock";
import { Tutorial, shouldShowTutorial, markTutorialSeen } from "../ui/Tutorial";
import { loadJoystickPrefs, type JoystickPrefs } from "../util/joystickPrefs";

type Status = "loading" | "playing" | "caught" | "escaped" | "time_up";
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
// Input shaping — see shapeJoystick. Values picked from Batch 10 spec to
// kill stick drift, give precise sub-walk control, and saturate before the
// thumb hits the visible ring.
const JOYSTICK_DEADZONE = 0.12;
const JOYSTICK_OUTER_LIMIT = 0.85;
const JOYSTICK_RESPONSE_CURVE = 1.6;
const INPUT_LERP_RATE = 18;
const SPRINT_DOUBLE_TAP_MS = 280;

function shapeJoystick(rawX: number, rawY: number): { x: number; z: number } {
  const mag = Math.hypot(rawX, rawY);
  if (mag < JOYSTICK_DEADZONE) return { x: 0, z: 0 };
  const remapped = Math.min(
    1,
    (mag - JOYSTICK_DEADZONE) / (JOYSTICK_OUTER_LIMIT - JOYSTICK_DEADZONE)
  );
  const shaped = Math.pow(remapped, JOYSTICK_RESPONSE_CURVE);
  return { x: (rawX / mag) * shaped, z: (rawY / mag) * shaped };
}

interface Props {
  initialDifficulty: MapKey;
  initialQuality: GraphicsQuality;
  initialSensitivity: number;
  initialVolume: number;
  isDaily?: boolean;
  /** For multiplayer: the WebSocket already established by the lobby screen. */
  multiWs?: WebSocket;
  /** For multiplayer: the local player ID assigned by the server during lobby. */
  localPlayerId?: string;
  onReturnToTitle: () => void;
  onVolumeChange?: (v: number) => void;
}

export default function Game3D({
  initialDifficulty,
  initialQuality,
  initialSensitivity,
  initialVolume,
  isDaily,
  multiWs,
  localPlayerId,
  onReturnToTitle,
  onVolumeChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<EngineHandle | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // Tracks the local player ID so we can filter it from remote-player broadcasts.
  const localPlayerIdRef = useRef<string>(localPlayerId ?? "");
  // Read by onCaught/onEscape callbacks, which capture state at engine init.
  const timeLeftRef = useRef<number | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [difficulty] = useState<MapKey>(initialDifficulty);
  const [quality] = useState<GraphicsQuality>(initialQuality);
  const [sensitivity, setSensitivity] = useState(initialSensitivity);
  const [volume, setVolumeState] = useState(initialVolume);
  const [paused, setPaused] = useState(false);
  const [showTutorial, setShowTutorial] = useState(() => shouldShowTutorial());
  const [throwables, setThrowables] = useState(3);
  const [keysLeft, setKeysLeft] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [batteryPct, setBatteryPct] = useState<number>(100);
  const [notes, setNotes] = useState<{ collected: number; total: number }>({
    collected: 0,
    total: 0,
  });
  const [danger, setDanger] = useState<Danger>("safe");
  const [hidden, setHidden] = useState(false);
  const [director, setDirector] = useState<DirectorUpdate>(INITIAL_DIRECTOR);
  const [hint, setHint] = useState(
    "Click to lock pointer · WASD to move · Shift to sprint"
  );
  const [runTimeLeft, setRunTimeLeft] = useState<number | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const isMobile = useIsMobile();
  const [pointerLocked, setPointerLocked] = useState(false);
  // Whether the gold key-pickup flash is currently visible. Set true on
  // pickup and cleared 420ms later — opacity transitions over 500ms.
  const [pickupFlashAt, setPickupFlashAt] = useState(0);
  const [pickupFlashOn, setPickupFlashOn] = useState(false);
  // Catch-sequence fade-to-black opacity (0..1). Driven by engine's
  // onCatchFade callback every frame the catch is active; resets when
  // status leaves "playing".
  const [catchFade, setCatchFade] = useState(0);
  useEffect(() => {
    if (!pickupFlashAt) return;
    setPickupFlashOn(true);
    const t = window.setTimeout(() => setPickupFlashOn(false), 420);
    return () => window.clearTimeout(t);
  }, [pickupFlashAt]);

  useEffect(() => {
    const onLockChange = () => {
      const locked = document.pointerLockElement != null;
      setPointerLocked(locked);
      // Releasing the lock while playing means the user hit ESC or alt-tabbed.
      // Auto-open the pause menu so they have a clear next action.
      if (!locked && !isMobile) setPaused(true);
    };
    document.addEventListener("pointerlockchange", onLockChange);
    return () =>
      document.removeEventListener("pointerlockchange", onLockChange);
  }, [isMobile]);

  // ESC toggles pause while playing. Browsers consume ESC to release pointer
  // lock, so we only act when the pointer isn't already locked.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape") return;
      if (status !== "playing") return;
      if (document.pointerLockElement) return;
      setPaused(p => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status]);

  // Master volume → Howler global. Lazy import keeps Howler off the title chunk.
  useEffect(() => {
    let cancelled = false;
    void import("howler")
      .then(({ Howler }) => {
        if (!cancelled) Howler.volume(volume);
      })
      .catch(() => {});
    onVolumeChange?.(volume);
    return () => {
      cancelled = true;
    };
  }, [volume, onVolumeChange]);

  const updateSensitivity = useCallback((v: number) => {
    setSensitivity(v);
    engineRef.current?.setSensitivity(v);
  }, []);

  const selectedMap = MAPS[difficulty];

  useEffect(() => {
    if (status !== "playing" || !containerRef.current) return;
    setKeysLeft(null);
    setTimeLeft(selectedMap.timer);
    timeLeftRef.current = selectedMap.timer;
    setRunTimeLeft(null);
    setIsNewBest(false);
    setThrowables(3);
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
        seed: isDaily ? getDailySeed() : undefined,
        events: {
          onReady: info => {
            setKeysLeft(info.keys);
            setTimeLeft(info.timer);
            setNotes({ collected: 0, total: info.notesTotal });
            setBatteryPct(100);
            setHint(
              isMobile
                ? `${info.mapName}: collect keys, then reach the green exit. Drag to look.`
                : `${info.mapName}: collect every key, then reach the green exit.`
            );
          },
          onKeyPickup: remaining => {
            setKeysLeft(remaining);
            setPickupFlashAt(performance.now());
            setHint(
              remaining === 0
                ? "All keys found. The exit is open."
                : "Key collected."
            );
          },
          onBatteryChange: charge =>
            setBatteryPct(Math.max(0, Math.min(100, Math.round(charge * 100)))),
          onNotesChange: (collected, total) => setNotes({ collected, total }),
          onCaught: () => {
            const tl = timeLeftRef.current ?? 0;
            const used = Math.round(selectedMap.timer - tl);
            setRunTimeLeft(tl);
            recordRun(difficulty, "caught", selectedMap.timer, tl);
            if (isDaily) saveDailyResult("caught", used);
            setStatus("caught");
            // Snap fade off once we leave the playing screen — the caught
            // status screen is its own backdrop.
            setCatchFade(0);
          },
          onCatchFade: (v: number) => setCatchFade(v),
          onTimeUp: () => {
            recordRun(difficulty, "caught", selectedMap.timer, 0);
            if (isDaily) saveDailyResult("caught", selectedMap.timer);
            setRunTimeLeft(0);
            setStatus("time_up");
          },
          onEscape: () => {
            const tl = timeLeftRef.current;
            const used = Math.round(selectedMap.timer - (tl ?? 0));
            const { isNewBest: nb } = recordRun(
              difficulty,
              "escaped",
              selectedMap.timer,
              tl ?? 0
            );
            if (isDaily) saveDailyResult("escaped", used);
            setRunTimeLeft(tl);
            setIsNewBest(nb);
            setStatus("escaped");
          },
          onError: err => {
            // eslint-disable-next-line no-console
            console.error("Render loop crashed:", err);
            onReturnToTitle();
          },
          onHint: setHint,
          onTimer: t => {
            timeLeftRef.current = t;
            setTimeLeft(t);
          },
          onDangerChange: setDanger,
          onHideChange: setHidden,
          onAIDirector: setDirector,
          onThrowableCount: setThrowables,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Failed to start engine:", err);
      onReturnToTitle();
      return;
    }
    engineRef.current = handle;

    // Best-effort multiplayer wiring. If no server is reachable (e.g. on a
    // static Netlify deploy without the websocket gateway), we silently
    // remain in single-player mode rather than failing the render.
    let ws: WebSocket | null = null;
    let stateTimer: number | null = null;
    let ownedWs = false; // whether we created the WS (so we close it on cleanup)

    const wireWs = (socket: WebSocket) => {
      ws = socket;
      wsRef.current = socket;
      stateTimer = window.setInterval(() => {
        if (!handle || socket.readyState !== WebSocket.OPEN) return;
        const s = handle.getPlayerState();
        socket.send(
          JSON.stringify({ type: "move", x: s.x, z: s.z, rotY: s.rotY })
        );
      }, 80);
      socket.addEventListener("message", ev => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (
            msg.type === "state" &&
            msg.players &&
            typeof msg.players === "object" &&
            !Array.isArray(msg.players)
          ) {
            const myId = localPlayerIdRef.current;
            const remotes: RemotePlayer[] = (
              Object.values(msg.players) as Array<RemotePlayer & { id: string }>
            )
              .filter(p => p.id !== myId)
              .map(p => ({
                id: p.id,
                x: p.x,
                z: p.z,
                rotY: p.rotY ?? 0,
                name: p.name,
              }));
            handle.setRemotePlayers(remotes);
            if (typeof msg.entity?.x === "number" && typeof msg.entity?.z === "number") {
              handle.setEnemy({ x: msg.entity.x, z: msg.entity.z });
            }
          }
        } catch {
          // ignore malformed frames
        }
      });
      socket.addEventListener("error", () =>
        setHint("Multiplayer offline · local Observer enabled")
      );
    };

    if (multiWs && multiWs.readyState !== WebSocket.CLOSED) {
      // Re-use the WebSocket that was established during the multiplayer lobby.
      wireWs(multiWs);
    } else {
      // Solo or fallback: open a fresh connection and join as solo.
      try {
        const wsUrl = buildWsUrl();
        const freshWs = new WebSocket(wsUrl);
        ownedWs = true;
        freshWs.addEventListener("open", () => {
          freshWs.send(
            JSON.stringify({ type: "join", mode: "solo", difficulty, name: "Player" })
          );
        });
        wireWs(freshWs);
      } catch {
        setHint("Multiplayer offline · local Observer enabled");
      }
    }

    return () => {
      if (stateTimer != null) window.clearInterval(stateTimer);
      // Only close a WebSocket we opened ourselves; a multiWs handed in from
      // the lobby is the caller's responsibility to manage.
      if (ownedWs) ws?.close();
      wsRef.current = null;
      handle?.dispose();
      engineRef.current = null;
    };
  }, [difficulty, isMobile, multiWs, quality, selectedMap.timer, sensitivity, status]);

  useEffect(() => {
    if (status !== "playing") return;
    void lockLandscape();
  }, [status]);

  useEffect(() => {
    if (status !== "playing") return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        setPaused(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [status]);

  useEffect(() => {
    if (status !== "playing") {
      void releaseWakeLock();
      return;
    }
    void acquireWakeLock();
    return () => {
      void releaseWakeLock();
    };
  }, [status]);

  const setVirtualMove = useCallback((moveX: number, moveZ: number) => {
    engineRef.current?.setVirtualInput({ moveX, moveZ });
  }, []);

  const setVirtualSprint = useCallback((sprinting: boolean) => {
    engineRef.current?.setVirtualInput({ sprinting });
  }, []);

  const toggleVirtualHide = useCallback(() => {
    engineRef.current?.toggleHide();
  }, []);

  const triggerThrow = useCallback(() => {
    engineRef.current?.throwObject();
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black text-white select-none">
      <PortraitGate />
      <div ref={containerRef} className="absolute inset-0" />

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
            <div>Cans: {throwables}/3 (F to throw)</div>
            <div>
              Time left: {timeLeft === null ? "—" : formatTime(timeLeft)}
            </div>
            <div className="flex items-center gap-2">
              <span>Battery:</span>
              <span
                className={`inline-block h-2 w-20 overflow-hidden rounded border ${
                  batteryPct < 15
                    ? "border-red-400/70"
                    : batteryPct < 35
                      ? "border-yellow-400/70"
                      : "border-white/30"
                }`}
                aria-label={`Flashlight battery ${batteryPct}%`}
              >
                <span
                  className={`block h-full ${
                    batteryPct < 15
                      ? "bg-red-500"
                      : batteryPct < 35
                        ? "bg-yellow-400"
                        : "bg-emerald-400"
                  }`}
                  style={{ width: `${batteryPct}%` }}
                />
              </span>
              <span className="opacity-70">{batteryPct}%</span>
            </div>
            {notes.total > 0 && (
              <div>
                Notes: {notes.collected}/{notes.total}
              </div>
            )}
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
              onThrow={triggerThrow}
              throwsRemaining={throwables}
            />
          )}
          {!showTutorial && (
            <MobilePauseButton onPause={() => setPaused(true)} />
          )}
          <Minimap engine={engineRef.current} />
          <ObserverIndicator engine={engineRef.current} />
          {/* Gold flash on key pickup. Fades opacity 1→0 over 500ms via
              a CSS transition; the timer in pickupFlashOn flips off ~420ms
              after pickup so the transition gets a full half-second runway. */}
          <div
            className="absolute inset-0 z-[15] pointer-events-none transition-opacity duration-500"
            style={{
              background:
                "radial-gradient(circle, rgba(255,217,102,0.18) 0%, transparent 60%)",
              opacity: pickupFlashOn ? 1 : 0,
            }}
          />
          {/* Catch-sequence fade-to-black. Driven directly by engine each
              frame (no transition — the engine's smooth ramp owns the
              animation). z-25 sits above HUD but below pause/menus. */}
          <div
            className="absolute inset-0 z-[25] pointer-events-none bg-black"
            style={{ opacity: catchFade }}
          />
        </>
      )}

      {status === "playing" && showTutorial && (
        <Tutorial
          onDone={() => {
            markTutorialSeen();
            setShowTutorial(false);
          }}
        />
      )}

      {status === "playing" && paused && (
        <PauseMenu
          volume={volume}
          sensitivity={sensitivity}
          onVolume={setVolumeState}
          onSensitivity={updateSensitivity}
          onResume={() => {
            setPaused(false);
            if (!isMobile) {
              const canvas = containerRef.current?.querySelector("canvas");
              canvas?.requestPointerLock?.();
            }
          }}
          onQuit={() => {
            setPaused(false);
            onReturnToTitle();
          }}
        />
      )}

      {status === "caught" && (
        <Overlay>
          <h2 className="mb-2 text-4xl font-bold text-red-500">CAUGHT</h2>
          <p className="mb-1 font-mono text-2xl tracking-widest text-white/20">
            PROCESS TERMINATED
          </p>
          <p className="mb-6 font-mono text-xs text-white/25">
            {`0x${Math.floor(Math.random() * 0xffff)
              .toString(16)
              .toUpperCase()
              .padStart(4, "0")}`}
          </p>
          {runTimeLeft !== null && (
            <p className="mb-4 text-sm opacity-50">
              Survived {formatTime(selectedMap.timer - runTimeLeft)} of{" "}
              {formatTime(selectedMap.timer)}
            </p>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStatus("loading")}
              className="rounded border border-red-500/40 bg-red-900/60 px-6 py-2 text-sm font-semibold tracking-widest transition-colors hover:bg-red-800/70"
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={onReturnToTitle}
              className="rounded border border-white/20 bg-black/60 px-6 py-2 text-sm tracking-widest transition-colors hover:border-white/40"
            >
              Menu
            </button>
          </div>
        </Overlay>
      )}
      {status === "escaped" && (
        <Overlay>
          <h2 className="mb-2 text-4xl font-bold text-green-400">
            YOU ESCAPED
          </h2>
          {isNewBest && (
            <p className="mb-1 font-mono text-xs uppercase tracking-widest text-yellow-400/80">
              ★ New Best Time
            </p>
          )}
          {runTimeLeft !== null && (
            <p className="mb-1 text-sm opacity-70">
              Time remaining: {formatTime(runTimeLeft)}
            </p>
          )}
          {runTimeLeft !== null && (
            <p className="mb-5 font-mono text-2xl text-white/80">
              Score: {Math.round(runTimeLeft * selectedMap.difficulty * 10)}
            </p>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStatus("loading")}
              className="rounded border border-green-500/40 bg-green-900/60 px-6 py-2 text-sm font-semibold tracking-widest transition-colors hover:bg-green-800/70"
            >
              Play Again
            </button>
            <button
              type="button"
              onClick={onReturnToTitle}
              className="rounded border border-white/20 bg-black/60 px-6 py-2 text-sm tracking-widest transition-colors hover:border-white/40"
            >
              Menu
            </button>
          </div>
        </Overlay>
      )}

      {status === "time_up" && (
        <Overlay>
          <h2 className="mb-2 text-4xl font-bold text-amber-400">TIME</h2>
          <p className="mb-6 font-mono text-xs tracking-widest text-white/40">
            THE HOUSE KEEPS YOU
          </p>
          <p className="mb-4 text-sm opacity-50">
            The Observer didn't need to find you.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStatus("loading")}
              className="rounded border border-amber-500/40 bg-amber-900/50 px-6 py-2 text-sm font-semibold tracking-widest transition-colors hover:bg-amber-800/60"
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={onReturnToTitle}
              className="rounded border border-white/20 bg-black/60 px-6 py-2 text-sm tracking-widest transition-colors hover:border-white/40"
            >
              Menu
            </button>
          </div>
        </Overlay>
      )}

      {status === "playing" && (isMobile || pointerLocked) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-1 w-1 rounded-full bg-white/80" />
        </div>
      )}

      {status === "playing" && !isMobile && !pointerLocked && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-500">
          <div className="rounded border border-white/20 bg-black/70 px-4 py-2 text-center text-xs text-white/70 backdrop-blur">
            <div className="font-mono tracking-widest">CLICK TO AIM</div>
            <div className="mt-0.5 text-[10px] opacity-60">
              ESC to release · WASD move · Shift sprint · E hide
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MobileControls({
  onMove,
  onSprint,
  onHide,
  onThrow,
  throwsRemaining,
}: {
  onMove: (moveX: number, moveZ: number) => void;
  onSprint: (sprinting: boolean) => void;
  onHide: () => void;
  onThrow: () => void;
  throwsRemaining: number;
}) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const activeJoystickPointer = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0, active: false });
  // Sprint visual state mirrors sprintActiveRef for rendering. The ref is
  // still the source of truth for handlers (no closure capture issues), but
  // the React state lets us tint the joystick knob when sprint engages.
  const [sprintEngaged, setSprintEngaged] = useState(false);
  const [prefs] = useState<JoystickPrefs>(() => loadJoystickPrefs());

  // Raw stick input (post-shaping) — written by the pointer handler. The
  // engine sees a smoothed copy via the rAF loop below, which gives us a
  // frame-rate-independent ease and removes the staircase that comes from
  // rate-limited touch event streams.
  const rawInputRef = useRef({ x: 0, z: 0 });
  const smoothedRef = useRef({ x: 0, z: 0 });
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  // Sprint state: double-tap-and-hold on the joystick. Replaces the old
  // dedicated Sprint button to free thumb-space and avoid the joystick's
  // ring overlapping the button on small screens.
  const lastJoystickTapAtRef = useRef(0);
  const sprintActiveRef = useRef(false);
  const onSprintRef = useRef(onSprint);
  onSprintRef.current = onSprint;

  const baseSize = 128;
  const joystickSize = Math.round(
    Math.min(
      176,
      Math.max(
        baseSize,
        (typeof window !== "undefined" ? window.innerWidth : 375) * 0.34
      )
    ) * prefs.size
  );

  // Per-frame smoothing → engine. Runs only while mounted.
  useEffect(() => {
    const EPS = 1e-3;
    let raf = 0;
    let last = performance.now();
    let lastSentNonzero = false;
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const k = 1 - Math.exp(-INPUT_LERP_RATE * dt);
      const sm = smoothedRef.current;
      const raw = rawInputRef.current;
      sm.x += (raw.x - sm.x) * k;
      sm.z += (raw.z - sm.z) * k;
      // Skip the engine call when both raw and smoothed are effectively
      // zero — but send one final zero so we don't strand the engine in a
      // non-zero virtual input state.
      const active =
        Math.abs(raw.x) >= EPS ||
        Math.abs(raw.z) >= EPS ||
        Math.abs(sm.x) >= EPS ||
        Math.abs(sm.z) >= EPS;
      if (active || lastSentNonzero) {
        onMoveRef.current(sm.x, sm.z);
        lastSentNonzero = active;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Reset all inputs on pointer cancel (system gesture, notification, etc.)
  useEffect(() => {
    const onCancel = () => {
      activeJoystickPointer.current = null;
      rawInputRef.current = { x: 0, z: 0 };
      if (sprintActiveRef.current) {
        sprintActiveRef.current = false;
        setSprintEngaged(false);
        onSprintRef.current(false);
      }
    };
    window.addEventListener("pointercancel", onCancel);
    return () => window.removeEventListener("pointercancel", onCancel);
  }, []);

  const updatePad = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
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
    // Normalize to unit circle, then shape (deadzone + curve) before
    // setting the smoothing target. World-Z is the inverse of screen-Y.
    const shaped = shapeJoystick(x / radius, y / radius);
    rawInputRef.current = { x: shaped.x, z: shaped.z };
    setKnob({ x, y, active: true });
  }, []);

  const releasePad = useCallback(() => {
    activeJoystickPointer.current = null;
    rawInputRef.current = { x: 0, z: 0 };
    setKnob({ x: 0, y: 0, active: false });
    if (sprintActiveRef.current) {
      sprintActiveRef.current = false;
      onSprintRef.current(false);
    }
  }, []);

  const joystickSide = prefs.swap ? "right" : "left";
  const buttonSide = prefs.swap ? "left" : "right";

  return (
    <div
      className="pointer-events-none absolute bottom-0 left-0 right-0"
      style={{
        paddingBottom: "calc(var(--safe-bottom) + 16px)",
        paddingLeft: "calc(var(--safe-left) + 12px)",
        paddingRight: "calc(var(--safe-right) + 12px)",
      }}
    >
      <div
        data-ui-element="joystick"
        className="pointer-events-auto absolute rounded-full border border-white/20 bg-black/35 backdrop-blur"
        style={{
          touchAction: "none",
          width: joystickSize,
          height: joystickSize,
          bottom: "8px",
          [joystickSide]: "12px",
          opacity: prefs.opacity,
        }}
      >
        <div
          ref={padRef}
          className="relative h-full w-full"
          onPointerDown={event => {
            if (event.pointerType !== "touch") return;
            if (activeJoystickPointer.current !== null) return;
            activeJoystickPointer.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            // Double-tap-and-hold → sprint. The hold portion is implicit:
            // the user is already touching the stick to move; releasing
            // ends sprint.
            const now = performance.now();
            if (now - lastJoystickTapAtRef.current < SPRINT_DOUBLE_TAP_MS) {
              sprintActiveRef.current = true;
              setSprintEngaged(true);
              onSprintRef.current(true);
            }
            lastJoystickTapAtRef.current = now;
            updatePad(event);
          }}
          onPointerMove={event => {
            if (event.pointerId !== activeJoystickPointer.current) return;
            updatePad(event);
          }}
          onPointerUp={event => {
            if (event.pointerId !== activeJoystickPointer.current) return;
            releasePad();
          }}
          onPointerCancel={event => {
            if (event.pointerId !== activeJoystickPointer.current) return;
            releasePad();
          }}
        >
          <div
            className={`absolute left-1/2 top-1/2 rounded-full border transition-colors ${
              sprintEngaged
                ? "border-amber-300/80 bg-amber-400/60"
                : knob.active
                  ? "border-red-400/60 bg-red-500/60"
                  : "border-white/30 bg-white/15"
            }`}
            style={{
              width: joystickSize * 0.42,
              height: joystickSize * 0.42,
              transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
            }}
          />
          <span className="absolute inset-x-0 bottom-2 select-none text-center text-[9px] uppercase tracking-widest text-white/40">
            move
          </span>
        </div>
        <div className="pointer-events-none absolute -bottom-5 left-1/2 -translate-x-1/2 select-none whitespace-nowrap text-[10px] uppercase tracking-widest text-white/30">
          Double tap to sprint
        </div>
      </div>

      {/* Opposite side: look-zone affordance + action buttons */}
      <div
        className="pointer-events-none absolute flex flex-col items-end justify-end gap-3"
        style={{
          [buttonSide]: "12px",
          bottom: "8px",
        }}
      >
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-20">
          <div
            className="rounded-full border border-white/30"
            style={{ width: 48, height: 48 }}
          />
          <span className="absolute mt-14 select-none text-[9px] uppercase tracking-widest text-white/60">
            look
          </span>
        </div>

        <button
          type="button"
          data-ui-element="hide"
          className="pointer-events-auto h-14 w-20 rounded-2xl border border-white/25 bg-black/55 text-[10px] font-bold uppercase tracking-widest shadow-lg backdrop-blur active:bg-white/20"
          style={{ touchAction: "none" }}
          onClick={onHide}
        >
          Hide / E
        </button>
        <button
          type="button"
          disabled={throwsRemaining <= 0}
          className="pointer-events-auto h-14 w-20 rounded-2xl border border-amber-300/40 bg-amber-900/55 text-[10px] font-bold uppercase tracking-widest shadow-lg backdrop-blur active:bg-amber-700/70 disabled:opacity-30"
          style={{ touchAction: "none" }}
          onClick={onThrow}
        >
          Throw {throwsRemaining}
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
