import { useState } from "react";
import { AnalogPanel, ChromaticText } from "./analog";

const STEPS = [
  {
    title: "Find the keys",
    body: "Glowing keys are scattered through the house. Collect every one before time runs out.",
    icon: "🔑",
  },
  {
    title: "Hide and move quietly",
    body: "Press E near closets to hide. Sprint with Shift, but the noise carries — The Observer hears.",
    icon: "🥫",
  },
  {
    title: "Reach the green door",
    body: "When all keys are collected, the exit unlocks. Watch the minimap — the blue dot is The Observer.",
    icon: "🚪",
  },
];

const TUTORIAL_KEY = "hunted_tutorial_seen_v1";

export function shouldShowTutorial(): boolean {
  try {
    return !localStorage.getItem(TUTORIAL_KEY);
  } catch {
    return false;
  }
}

export function markTutorialSeen(): void {
  try {
    localStorage.setItem(TUTORIAL_KEY, "1");
  } catch {
    /* storage full */
  }
}

export function Tutorial({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const s = STEPS[step];

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/85 backdrop-blur-sm">
      <AnalogPanel tone="paper" className="mx-4 w-[min(92vw,560px)]">
        <div className="mb-4 text-center text-5xl">{s.icon}</div>
        <ChromaticText as="h2" offset="fixed" className="mb-3 text-center text-2xl font-bold tracking-wide">
          {s.title}
        </ChromaticText>
        <p className="mb-6 text-center text-sm leading-relaxed text-white/70">
          {s.body}
        </p>

        <div className="mb-5 flex justify-center gap-1">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded transition-all ${
                i === step ? "w-8 bg-red-500" : "w-1.5 bg-white/20"
              }`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onDone}
            className="text-xs uppercase tracking-widest opacity-50 transition-opacity hover:opacity-80"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => (isLast ? onDone() : setStep(step + 1))}
            className="rounded border border-red-400 bg-red-900/60 px-6 py-2 text-sm font-semibold tracking-widest transition-colors hover:bg-red-800/70"
          >
            {isLast ? "Begin" : "Next"}
          </button>
        </div>
      </AnalogPanel>
    </div>
  );
}
