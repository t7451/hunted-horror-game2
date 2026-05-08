interface ElementWithWebkitFullscreen extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>;
}

export async function requestFullscreen(
  el: HTMLElement = document.documentElement
): Promise<boolean> {
  try {
    const target = el as ElementWithWebkitFullscreen;
    if (target.requestFullscreen) {
      await target.requestFullscreen({ navigationUI: "hide" });
    } else if (target.webkitRequestFullscreen) {
      await target.webkitRequestFullscreen();
    } else {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function isFullscreen(): boolean {
  return !!document.fullscreenElement;
}

export async function exitFullscreen(): Promise<void> {
  if (!document.fullscreenElement) return;
  try {
    await document.exitFullscreen();
  } catch {
    // ignore
  }
}
