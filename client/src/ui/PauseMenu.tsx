import { useState } from "react";
import { Haptics, loadHapticsPref, setHapticsEnabled } from "../util/haptics";

interface Props {
  volume: number;
  sensitivity: number;
  onVolume: (v: number) => void;
  onSensitivity: (v: number) => void;
  onResume: () => void;
  onQuit: () => void;
}

export function PauseMenu({
  volume,
  sensitivity,
  onVolume,
  onSensitivity,
  onResume,
  onQuit,
}: Props) {
  const [hapticsOn, setHapticsOn] = useState(() => loadHapticsPref());

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="flex w-72 flex-col gap-4 rounded border border-white/20 bg-black/90 px-8 py-6">
        <h2 className="text-center font-mono text-xl tracking-widest text-white/80">
          PAUSED
        </h2>

        <label className="flex flex-col gap-1 text-xs">
          <span className="uppercase tracking-widest opacity-60">
            Master volume
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

        <label className="flex flex-col gap-1 text-xs">
          <span className="uppercase tracking-widest opacity-60">
            Look sensitivity
          </span>
          <input
            type="range"
            min="0.5"
            max="1.6"
            step="0.1"
            value={sensitivity}
            onChange={e => onSensitivity(Number(e.target.value))}
            className="accent-red-500"
          />
        </label>

        <label className="flex items-center justify-between text-sm tracking-widest uppercase">
          <span>Haptics</span>
          <button
            type="button"
            onClick={() => {
              const next = !hapticsOn;
              setHapticsOn(next);
              setHapticsEnabled(next);
              if (next) Haptics.light();
            }}
            className={`relative h-6 w-12 rounded-full transition-colors ${
              hapticsOn ? "bg-red-700" : "bg-white/20"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                hapticsOn ? "left-6" : "left-0.5"
              }`}
            />
          </button>
        </label>

        <div className="mt-2 flex flex-col gap-2">
          <button
            type="button"
            onClick={onResume}
            autoFocus
            className="w-full rounded border border-white/25 bg-white/10 py-2 text-sm font-semibold tracking-widest transition-colors hover:bg-white/20"
          >
            Resume
          </button>
          <button
            type="button"
            onClick={onQuit}
            className="w-full rounded border border-red-500/30 bg-red-950/50 py-2 text-sm tracking-widest text-red-300 transition-colors hover:bg-red-900/60"
          >
            Quit to Menu
          </button>
        </div>

        <p className="text-center font-mono text-[10px] opacity-30">
          ESC to resume
        </p>
      </div>
    </div>
  );
}
