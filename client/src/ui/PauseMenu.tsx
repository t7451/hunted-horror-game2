import { useState, useEffect } from "react";
import { Haptics, loadHapticsPref, setHapticsEnabled } from "../util/haptics";
import {
  isBatterySaverEnabled,
  setBatterySaverEnabled,
} from "../util/batterySaver";
import {
  AnalogPanel,
  AnalogButton,
  RecBadge,
  ChromaticText,
} from "./analog";

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
  const [batterySaver, setSaver] = useState(() => isBatterySaverEnabled());

  useEffect(() => {
    document.documentElement.setAttribute("data-paused", "true");
    return () => {
      document.documentElement.setAttribute("data-paused", "false");
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <AnalogPanel className="w-[min(92vw,460px)] flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <ChromaticText
            as="h2"
            className="text-3xl font-bold tracking-[0.4em] uppercase"
            style={{ fontFamily: "var(--ana-font-stencil)" }}
          >
            ‖ Paused
          </ChromaticText>
          <RecBadge paused label="TAPE 04" />
        </div>

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

        <label className="flex items-center justify-between text-sm tracking-widest uppercase">
          <span>Battery saver</span>
          <button
            type="button"
            onClick={() => {
              const next = !batterySaver;
              setSaver(next);
              setBatterySaverEnabled(next);
            }}
            className={`w-12 h-6 rounded-full transition-colors ${
              batterySaver ? "bg-amber-600" : "bg-white/20"
            } relative`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${
                batterySaver ? "left-6" : "left-0.5"
              }`}
            />
          </button>
        </label>

        <div className="mt-2 flex flex-col gap-2">
          <AnalogButton
            variant="primary"
            onClick={onResume}
            autoFocus
            className="w-full"
          >
            Resume
          </AnalogButton>
          <AnalogButton
            variant="ghost"
            onClick={onQuit}
            className="w-full"
          >
            Quit to Menu
          </AnalogButton>
        </div>

        <p className="text-center font-mono text-[10px] opacity-30">
          ESC to resume
        </p>
      </AnalogPanel>
    </div>
  );
}
