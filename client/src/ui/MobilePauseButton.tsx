import { useIsMobile } from "../hooks/useMobile";
import { Haptics } from "../util/haptics";

export function MobilePauseButton({ onPause }: { onPause: () => void }) {
  const isMobile = useIsMobile();
  if (!isMobile) return null;

  return (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation();
        Haptics.light();
        onPause();
      }}
      onTouchStart={e => e.stopPropagation()}
      aria-label="Pause"
      data-ui-element="pause"
      className="absolute z-30 flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/70 backdrop-blur-sm transition-colors active:bg-black/90"
      style={{
        top: "calc(var(--safe-top) + 12px)",
        right: "calc(var(--safe-right) + 12px)",
        touchAction: "manipulation",
      }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="3" y="2" width="4" height="14" rx="1" fill="white" />
        <rect x="11" y="2" width="4" height="14" rx="1" fill="white" />
      </svg>
    </button>
  );
}
