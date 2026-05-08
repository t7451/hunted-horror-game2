import { useEffect, useRef } from "react";
import type { EngineHandle } from "../game/engine";
import { AnalogPanel } from "./analog";

const MAP_SCALE = 3.5;
const PLAYER_R = 3;
const ENEMY_R = 2.5;
const DOT_R = 2;

export function Minimap({ engine }: { engine: EngineHandle | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!engine) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const s = engine.getMinimapState();
      const W = s.mapWidth * MAP_SCALE;
      const H = s.mapHeight * MAP_SCALE;
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(0,0,0,0.72)";
      ctx.fillRect(0, 0, W, H);

      // Tile pass — wall / door / hide highlights so corridors are visible.
      for (let z = 0; z < s.tiles.length; z++) {
        const row = s.tiles[z];
        for (let x = 0; x < row.length; x++) {
          const t = row[x];
          if (t === "W") ctx.fillStyle = "rgba(255,255,255,0.12)";
          else if (t === "D") ctx.fillStyle = "rgba(160,100,60,0.25)";
          else if (t === "H") ctx.fillStyle = "rgba(60,60,100,0.25)";
          else continue;
          ctx.fillRect(x * MAP_SCALE, z * MAP_SCALE, MAP_SCALE, MAP_SCALE);
        }
      }

      const T = s.tileSize;

      // Exit marker
      ctx.fillStyle = s.exitOpen ? "#22ff66" : "#114411";
      ctx.beginPath();
      ctx.arc((s.exitX / T) * MAP_SCALE, (s.exitZ / T) * MAP_SCALE, DOT_R + 1, 0, Math.PI * 2);
      ctx.fill();

      // Keys
      ctx.fillStyle = "#ffd700";
      for (const k of s.keys) {
        ctx.beginPath();
        ctx.arc((k.x / T) * MAP_SCALE, (k.z / T) * MAP_SCALE, DOT_R, 0, Math.PI * 2);
        ctx.fill();
      }

      // Observer
      if (s.enemyVisible && s.enemyX !== null && s.enemyZ !== null) {
        ctx.fillStyle = "#ff5588";
        ctx.beginPath();
        ctx.arc((s.enemyX / T) * MAP_SCALE, (s.enemyZ / T) * MAP_SCALE, ENEMY_R, 0, Math.PI * 2);
        ctx.fill();
      }

      // Player
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc((s.playerX / T) * MAP_SCALE, (s.playerZ / T) * MAP_SCALE, PLAYER_R, 0, Math.PI * 2);
      ctx.fill();

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [engine]);

  const initial = engine?.getMinimapState();
  const W = initial ? initial.mapWidth * MAP_SCALE : 105;
  const H = initial ? initial.mapHeight * MAP_SCALE : 63;

  return (
    <AnalogPanel className="pointer-events-none absolute right-3 top-3 overflow-hidden p-1 opacity-70 transition-opacity hover:opacity-100">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="block"
        style={{
          imageRendering: "pixelated",
          width: W,
          height: H,
          filter:
            "drop-shadow(calc(var(--ana-intensity) * -2px) 0 var(--ana-magenta))" +
            " drop-shadow(calc(var(--ana-intensity) * 2px) 0 var(--ana-cyan))" +
            " drop-shadow(0 0 4px rgba(0,255,128,0.6))",
        }}
      />
    </AnalogPanel>
  );
}
