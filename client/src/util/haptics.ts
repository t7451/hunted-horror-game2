let enabled = true;
let lastTrigger = 0;
const MIN_INTERVAL_MS = 50;

export function setHapticsEnabled(v: boolean): void {
  enabled = v;
  try {
    localStorage.setItem("hunted_haptics", v ? "1" : "0");
  } catch {
    // ignore
  }
}

export function loadHapticsPref(): boolean {
  try {
    const raw = localStorage.getItem("hunted_haptics");
    if (raw === "0") enabled = false;
  } catch {
    // ignore
  }
  return enabled;
}

function vibrate(pattern: number | number[]): void {
  if (!enabled) return;
  if (!("vibrate" in navigator)) return;
  const now = performance.now();
  if (now - lastTrigger < MIN_INTERVAL_MS) return;
  lastTrigger = now;
  try {
    navigator.vibrate(pattern);
  } catch {
    // ignore
  }
}

export const Haptics = {
  light(): void {
    vibrate(10);
  },
  medium(): void {
    vibrate(25);
  },
  heavy(): void {
    vibrate(50);
  },
  pulse(): void {
    vibrate([15, 30, 15]);
  },
  catch(): void {
    vibrate([200, 50, 300]);
  },
  pickup(): void {
    vibrate([20, 40, 20]);
  },
};
