import { useEffect, useState } from "react";
import { useIsMobile } from "../hooks/useMobile";
import { isPortrait, onOrientationChange } from "../util/orientation";

export function PortraitGate() {
  const isMobile = useIsMobile();
  const [portrait, setPortrait] = useState(() => isMobile && isPortrait());

  useEffect(() => {
    if (!isMobile) return;
    setPortrait(isPortrait());
    return onOrientationChange(setPortrait);
  }, [isMobile]);

  if (!isMobile || !portrait) return null;

  return (
    <div
      className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-black px-6 text-center text-white"
      role="alert"
      aria-live="polite"
    >
      <svg
        width="80"
        height="80"
        viewBox="0 0 80 80"
        fill="none"
        className="mb-6 animate-pulse"
      >
        <rect
          x="22"
          y="6"
          width="36"
          height="68"
          rx="6"
          stroke="white"
          strokeWidth="3"
        />
        <circle cx="40" cy="64" r="3" fill="white" />
        <path
          d="M 60 38 Q 70 38 70 28"
          stroke="rgb(248 113 113)"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 65 23 L 70 28 L 75 23"
          stroke="rgb(248 113 113)"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
      <h2 className="mb-2 text-xl font-bold tracking-widest text-red-300">
        ROTATE YOUR DEVICE
      </h2>
      <p className="max-w-xs text-sm opacity-60">
        HUNTED is built for landscape. Please rotate your device to landscape
        orientation to continue.
      </p>
    </div>
  );
}
