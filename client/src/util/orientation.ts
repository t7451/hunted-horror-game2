type ScreenOrientationLockType =
  | "any"
  | "natural"
  | "landscape"
  | "portrait"
  | "portrait-primary"
  | "portrait-secondary"
  | "landscape-primary"
  | "landscape-secondary";

interface ScreenOrientationWithLock extends ScreenOrientation {
  lock?: (orientation: ScreenOrientationLockType) => Promise<void>;
}

export async function lockLandscape(): Promise<boolean> {
  try {
    const orientation = screen.orientation as ScreenOrientationWithLock;
    if (orientation?.lock) {
      await orientation.lock("landscape");
      return true;
    }
  } catch {
    // Ignore unsupported/fullscreen-required failures.
  }
  return false;
}

export function isPortrait(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(orientation: portrait)").matches;
}

export function onOrientationChange(cb: (portrait: boolean) => void): () => void {
  const mq = window.matchMedia("(orientation: portrait)");
  const handler = (e: MediaQueryListEvent) => cb(e.matches);
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
