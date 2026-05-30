import { useEffect, useRef } from "react";
import type { EngineHandle } from "../game/engine";
import { AnalogPanel } from "./analog";
import { useIsMobile } from "../hooks/useMobile";

const DESKTOP_MAP_SCALE = 3.5;
const MOBILE_MAP_SCALE = 1.8;
const PLAYER_R = 3;
const ENEMY_R = 2.5;
const DOT_R = 2;

export function Minimap({ engine }: { engine: EngineHandle | null }) {
  const isMobile = useIsMobile();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const mapScale = isMobile ? MOBILE_MAP_SCALE : DESKTOP_MAP_SCALE;
  const markerScale = mapScale / DESKTOP_MAP_SCALE;

  useEffect(() => {
    if (!engine) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const s = engine.getMinimapState();
      const W = s.mapWidth * mapScale;
      const H = s.mapHeight * mapScale;
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
          ctx.fillRect(x * mapScale, z * mapScale, mapScale, mapScale);
        }
      }

      const T = s.tileSize;

      // Exit marker
      ctx.fillStyle = s.exitOpen ? "#22ff66" : "#114411";
      ctx.beginPath();
      ctx.arc(
        (s.exitX / T) * mapScale,
        (s.exitZ / T) * mapScale,
        (DOT_R + 1) * markerScale,
        0,
        Math.PI * 2
      );
      ctx.fill();

      // Keys
      ctx.fillStyle = "#ffd700";
      for (const k of s.keys) {
        ctx.beginPath();
        ctx.arc(
          (k.x / T) * mapScale,
          (k.z / T) * mapScale,
          DOT_R * markerScale,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }

      // Observer
      if (s.enemyVisible && s.enemyX !== null && s.enemyZ !== null) {
        ctx.fillStyle = "#ff5588";
        ctx.beginPath();
        ctx.arc(
          (s.enemyX / T) * mapScale,
          (s.enemyZ / T) * mapScale,
          ENEMY_R * markerScale,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }

      // Player
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(
        (s.playerX / T) * mapScale,
        (s.playerZ / T) * mapScale,
        PLAYER_R * markerScale,
        0,
        Math.PI * 2
      );
      ctx.fill();

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [engine, mapScale, markerScale]);

  const initial = engine?.getMinimapState();
  const W = initial ? initial.mapWidth * mapScale : 105;
  const H = initial ? initial.mapHeight * mapScale : 63;

  return (
    <AnalogPanel
      className={`pointer-events-none absolute overflow-hidden p-1 opacity-70 ${
        isMobile
          ? "right-2 max-w-[45vw]"
          : "right-3 top-3 transition-opacity hover:opacity-100"
      }`}
      style={
        isMobile
          ? {
              top: "calc(var(--safe-top) + 60px)",
            }
          : undefined
      }
    >
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="block"
        style={{
          imageRendering: "pixelated",
          width: isMobile ? "100%" : W,
          height: isMobile ? "auto" : H,
          maxWidth: isMobile ? "45vw" : undefined,
          maxHeight: isMobile ? "24vh" : undefined,
          filter:
            "drop-shadow(calc(var(--ana-intensity) * -2px) 0 var(--ana-magenta))" +
            " drop-shadow(calc(var(--ana-intensity) * 2px) 0 var(--ana-cyan))" +
            " drop-shadow(0 0 4px rgba(0,255,128,0.6))",
        }}
      />
    </AnalogPanel>
  );
}
