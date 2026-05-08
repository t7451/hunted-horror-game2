const KEY = "hunted_joystick_v1";

export type JoystickPrefs = {
  size: number;       // 0.7–1.3, default 1.0
  opacity: number;    // 0.3–1.0, default 0.6
  swap: boolean;      // false = joystick on left, true = joystick on right (left-handed)
};

const DEFAULT: JoystickPrefs = { size: 1.0, opacity: 0.6, swap: false };

export function loadJoystickPrefs(): JoystickPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<JoystickPrefs>;
    return { ...DEFAULT, ...parsed };
  } catch { return { ...DEFAULT }; }
}

export function saveJoystickPrefs(prefs: JoystickPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}
