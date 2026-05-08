import * as React from "react";

/**
 * True if the device has a touchscreen, regardless of viewport width.
 * Falls back to width<1024 for SSR / old browsers without touch APIs.
 *
 * Priority:
 *  1. navigator.maxTouchPoints > 0  (modern: iOS / Android / Surface)
 *  2. 'ontouchstart' in window      (older Android WebView)
 *  3. window.innerWidth < 1024      (last-resort heuristic)
 */
export function useIsMobile(): boolean {
  const detect = (): boolean => {
    if (typeof window === "undefined") return false;
    if (navigator.maxTouchPoints > 0) return true;
    if ("ontouchstart" in window) return true;
    return window.innerWidth < 1024;
  };

  const [isMobile, setIsMobile] = React.useState<boolean>(detect);

  React.useEffect(() => {
    const update = () => setIsMobile(detect());
    window.addEventListener("resize", update);
    // Re-evaluate after a brief delay for Chromium quirks where
    // maxTouchPoints isn't fully resolved at first render.
    const t = window.setTimeout(update, 200);
    return () => {
      window.removeEventListener("resize", update);
      window.clearTimeout(t);
    };
  }, []);

  return isMobile;
}
