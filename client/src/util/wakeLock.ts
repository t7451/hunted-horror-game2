type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};

interface WakeLockCapableNavigator {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
}

let sentinel: WakeLockSentinelLike | null = null;
let visibilityHandlerBound = false;
let acquireInFlight = false;

export async function acquireWakeLock(): Promise<boolean> {
  if (acquireInFlight) return false;
  const nav = navigator as WakeLockCapableNavigator;
  if (!nav.wakeLock) return false;
  acquireInFlight = true;
  try {
    sentinel = await nav.wakeLock.request("screen");
    sentinel.addEventListener("release", () => {
      sentinel = null;
    });
    if (!visibilityHandlerBound) {
      visibilityHandlerBound = true;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && !sentinel) {
          void acquireWakeLock();
        }
      });
    }
    return true;
  } catch {
    return false;
  } finally {
    acquireInFlight = false;
  }
}

export async function releaseWakeLock(): Promise<void> {
  if (!sentinel) return;
  try {
    await sentinel.release();
  } catch {
    // ignore
  }
  sentinel = null;
}
