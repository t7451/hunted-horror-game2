const STORAGE_KEY = "hunted_battery_saver_v1";

let enabled = false;
let autoDetected = false;
const subscribers = new Set<(v: boolean) => void>();

export function loadBatterySaverPref(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "1") enabled = true;
    else if (raw === "0") enabled = false;
  } catch { /* ignore */ }
  return enabled;
}

export function setBatterySaverEnabled(v: boolean): void {
  enabled = v;
  autoDetected = false;
  try { localStorage.setItem(STORAGE_KEY, v ? "1" : "0"); } catch { /* ignore */ }
  subscribers.forEach(cb => cb(v));
}

export function isBatterySaverEnabled(): boolean {
  return enabled;
}

export function subscribeBatterySaver(cb: (v: boolean) => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

interface BatteryManager {
  level: number;
  charging: boolean;
  addEventListener: (type: string, listener: () => void) => void;
}
interface NavigatorWithBattery extends Navigator {
  getBattery?: () => Promise<BatteryManager>;
}

/** Auto-enable when battery <20% and not charging. Doesn't override explicit pref. */
export async function autoDetectBatterySaver(): Promise<void> {
  // Skip if user already chose
  let userChose = false;
  try { userChose = localStorage.getItem(STORAGE_KEY) !== null; } catch { /* ignore */ }
  if (userChose) return;

  const nav = navigator as NavigatorWithBattery;
  if (!nav.getBattery) return;
  try {
    const battery = await nav.getBattery();
    const evaluate = () => {
      const shouldSave = battery.level < 0.2 && !battery.charging;
      if (shouldSave !== enabled) {
        enabled = shouldSave;
        autoDetected = true;
        subscribers.forEach(cb => cb(enabled));
      }
    };
    evaluate();
    battery.addEventListener("levelchange", evaluate);
    battery.addEventListener("chargingchange", evaluate);
  } catch { /* ignore */ }
}

export function isAutoDetected(): boolean {
  return autoDetected;
}
