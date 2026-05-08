import { useState } from "react";
import { MAPS, MAP_KEYS, type MapKey } from "@shared/maps";
import { type GraphicsQuality } from "../util/device";
import { loadStats } from "../hooks/useGameStats";

function formatTime(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface Props {
  onEnter: (opts: {
    difficulty: MapKey;
    quality: GraphicsQuality;
    sensitivity: number;
  }) => void;
  webglSupported: boolean;
  volume: number;
  onVolume: (v: number) => void;
}

export function TitleScreen({
  onEnter,
  webglSupported,
  volume,
  onVolume,
}: Props) {
  const [difficulty, setDifficulty] = useState<MapKey>("easy");
  const [quality, setQuality] = useState<GraphicsQuality>("auto");
  const [sensitivity, setSensitivity] = useState(1);

  const difficultyOptions = MAP_KEYS.map(key => ({ key, ...MAPS[key] }));

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-black px-4 py-8 text-white">
      {/* Atmospheric drifting radial gradient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(ellipse at 30% 40%, #1a0808 0%, #050202 50%, #000 100%)",
          animation: "title-drift 18s ease-in-out infinite",
        }}
      />
      {/* Subtle red scanlines (CRT decay) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-20 mix-blend-screen"
        style={{
          background:
            "repeating-linear-gradient(0deg, transparent 0 2px, rgba(255,80,80,0.05) 2px 3px)",
        }}
      />
      <h1 className="relative mb-2 text-5xl font-bold tracking-widest">
        HUNTED
      </h1>
      <p className="mb-6 text-sm opacity-70">
        A browser-first horror escape · adaptive AI · no install
      </p>

      {!webglSupported && (
        <div className="mb-4 max-w-md rounded border border-red-500 bg-red-900/70 px-4 py-2 text-center text-sm text-red-100">
          WebGL unavailable. Enable hardware acceleration or try another
          browser.
        </div>
      )}

      <div className="mb-5 grid w-[min(92vw,720px)] gap-3 sm:grid-cols-3">
        {difficultyOptions.map(opt => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setDifficulty(opt.key)}
            className={`rounded border px-4 py-3 text-left transition-colors ${
              difficulty === opt.key
                ? "border-red-400 bg-red-950/70"
                : "border-white/20 bg-black/50 hover:border-white/50"
            }`}
          >
            <div className="font-semibold tracking-wide">{opt.name}</div>
            <div className="mt-1 text-xs opacity-70">{opt.summary}</div>
            <div className="mt-2 text-[11px] opacity-60">
              {formatTime(opt.timer)} · danger {opt.difficulty}/3
            </div>
          </button>
        ))}
      </div>

      <div className="mb-6 grid w-[min(92vw,720px)] gap-3 rounded border border-white/15 bg-black/40 p-4 text-sm sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-widest opacity-60">
            Graphics
          </span>
          <select
            value={quality}
            onChange={e => setQuality(e.target.value as GraphicsQuality)}
            className="rounded border border-white/20 bg-black/80 px-2 py-2"
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
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-widest opacity-60">
            Volume
          </span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={e => onVolume(Number(e.target.value))}
            className="accent-red-500"
          />
        </label>
      </div>

      <button
        type="button"
        disabled={!webglSupported}
        onClick={() => onEnter({ difficulty, quality, sensitivity })}
        className="rounded bg-red-700 px-8 py-3 font-semibold tracking-widest transition-colors hover:bg-red-600 disabled:opacity-40"
      >
        ENTER THE HOUSE
      </button>
      <p className="mt-6 max-w-xl text-center text-xs opacity-60">
        Find glowing keys · hide in closets with E · reach the green exit before
        time runs out. Your browser runs the AI director locally.
      </p>

      <BestTimesDisplay />
    </div>
  );
}

function BestTimesDisplay() {
  const stats = loadStats();
  const hasBests = Object.keys(stats.bestTimes).length > 0;
  const recentRuns = stats.runs.slice(0, 5);
  if (!hasBests && recentRuns.length === 0) return null;

  return (
    <div className="mt-8 space-y-3 font-mono text-xs text-white/40">
      {hasBests && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-widest text-white/30">
            Best Escapes
          </div>
          {(["easy", "normal", "hard"] as MapKey[]).map(key => {
            const t = stats.bestTimes[key];
            if (t === undefined) return null;
            return (
              <div key={key} className="flex gap-4">
                <span className="w-20">{MAPS[key].name}</span>
                <span className="text-green-400/60">{formatTime(t)}</span>
              </div>
            );
          })}
        </div>
      )}

      {recentRuns.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-widest text-white/30">
            Recent
          </div>
          {recentRuns.map((run, i) => {
            const mapName =
              MAPS[run.difficulty as MapKey]?.name ?? run.difficulty;
            return (
              <div key={i} className="flex gap-3">
                <span
                  className={
                    run.result === "escaped"
                      ? "text-green-400/60"
                      : "text-red-400/60"
                  }
                >
                  {run.result === "escaped" ? "✓" : "✗"}
                </span>
                <span className="w-20">{mapName}</span>
                <span>
                  {run.result === "escaped"
                    ? formatTime(run.timeUsed)
                    : `${formatTime(run.timeUsed)} in`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="text-[10px] text-white/25">
        {stats.escapedCount} escaped · {stats.caughtCount} caught
      </div>
    </div>
  );
}
