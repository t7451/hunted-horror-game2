import { useEffect, useRef, useState } from "react";
import type { MapKey } from "@shared/maps";
import { ChromaticText, AnalogPanel, AnalogButton } from "./analog";

interface LobbyPlayer {
  id: string;
  name: string;
}

interface Props {
  difficulty: MapKey;
  playerName: string;
  roomCode?: string; // undefined = create lobby, string = join existing lobby
  onGameStart: (ws: WebSocket, localPlayerId: string) => void;
  onCancel: () => void;
}

function buildWsUrl() {
  const override = import.meta.env.VITE_WS_URL as string | undefined;
  if (override && override.length > 0) return override;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

export function MultiplayerLobby({
  difficulty,
  playerName,
  roomCode: joinCode,
  onGameStart,
  onCancel,
}: Props) {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"connecting" | "lobby" | "error">("connecting");
  const [errorMsg, setErrorMsg] = useState("");
  const [myRoomCode, setMyRoomCode] = useState(joinCode ?? "");
  const [isHost, setIsHost] = useState(false);
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [copied, setCopied] = useState(false);
  const localPlayerIdRef = useRef<string>("");

  useEffect(() => {
    const wsUrl = buildWsUrl();
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      setStatus("error");
      setErrorMsg("Could not connect to game server.");
      return;
    }
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          type: "join",
          mode: "multi",
          difficulty,
          name: playerName,
          roomCode: joinCode ?? "",
        })
      );
    });

    ws.addEventListener("message", ev => {
      try {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        if (msg.type === "init") {
          localPlayerIdRef.current = String(msg.id ?? "");
          if (msg.roomCode) setMyRoomCode(String(msg.roomCode));
          setIsHost(!!msg.isHost);
          setStatus("lobby");
        } else if (msg.type === "lobbyUpdate") {
          const list = Array.isArray(msg.players) ? (msg.players as LobbyPlayer[]) : [];
          setPlayers(list);
          // If server transitioned lobby to playing (shouldn't happen without explicit start, but guard)
          if (msg.phase === "playing") {
            onGameStart(ws, localPlayerIdRef.current);
          }
        } else if (msg.type === "gameStart") {
          onGameStart(ws, localPlayerIdRef.current);
        } else if (msg.type === "error") {
          setStatus("error");
          setErrorMsg(String(msg.message ?? "Unknown error"));
        }
      } catch {
        // ignore malformed frames
      }
    });

    ws.addEventListener("error", () => {
      setStatus("error");
      setErrorMsg("Connection to server failed. Is the game server running?");
    });

    ws.addEventListener("close", () => {
      if (status !== "lobby") {
        setStatus("error");
        setErrorMsg("Disconnected from server.");
      }
    });

    return () => {
      ws.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startGame = () => {
    wsRef.current?.send(JSON.stringify({ type: "startGame" }));
  };

  const copyCode = async () => {
    if (!myRoomCode) return;
    try {
      await navigator.clipboard?.writeText(myRoomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black px-4 py-8 text-white">
      <ChromaticText as="h1" className="mb-6 text-4xl font-bold tracking-widest">
        MULTIPLAYER
      </ChromaticText>

      {status === "connecting" && (
        <AnalogPanel className="w-[min(92vw,480px)]">
          <div className="text-center text-sm opacity-70">Connecting to server…</div>
        </AnalogPanel>
      )}

      {status === "error" && (
        <AnalogPanel className="w-[min(92vw,480px)]">
          <div className="mb-3 text-center text-sm text-red-400">{errorMsg}</div>
          <AnalogButton variant="ghost" onClick={onCancel}>
            Back to Menu
          </AnalogButton>
        </AnalogPanel>
      )}

      {status === "lobby" && (
        <AnalogPanel className="w-[min(92vw,480px)] space-y-4">
          {/* Room code display */}
          <div className="text-center">
            <div className="mb-1 text-[10px] uppercase tracking-widest opacity-50">
              Room Code
            </div>
            <div className="flex items-center justify-center gap-3">
              <span className="font-mono text-3xl tracking-[0.4em] text-red-300">
                {myRoomCode}
              </span>
              <button
                type="button"
                onClick={copyCode}
                className="rounded border border-white/20 px-2 py-1 text-[10px] uppercase tracking-widest opacity-60 hover:opacity-100"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="mt-1 text-[10px] opacity-40">
              Share this code with friends
            </div>
          </div>

          {/* Player list */}
          <div>
            <div className="mb-2 text-[10px] uppercase tracking-widest opacity-50">
              Players ({players.length})
            </div>
            <div className="space-y-1">
              {players.map(p => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded bg-white/5 px-3 py-1.5 text-sm"
                >
                  <span
                    className={`h-2 w-2 rounded-full ${p.id === localPlayerIdRef.current ? "bg-green-400" : "bg-white/40"}`}
                  />
                  <span>
                    {p.name}
                    {p.id === localPlayerIdRef.current ? (
                      <span className="ml-2 text-[10px] opacity-50">(you)</span>
                    ) : null}
                  </span>
                </div>
              ))}
              {players.length === 0 && (
                <div className="text-xs opacity-40">Waiting for players…</div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2">
            {isHost ? (
              <AnalogButton
                variant="primary"
                disabled={players.length < 1}
                onClick={startGame}
              >
                Start Game
              </AnalogButton>
            ) : (
              <div className="text-center text-sm opacity-50">
                Waiting for host to start…
              </div>
            )}
            <AnalogButton variant="ghost" onClick={onCancel}>
              Leave Lobby
            </AnalogButton>
          </div>
        </AnalogPanel>
      )}
    </div>
  );
}
