import "./RecBadge.css";

interface Props {
  label?: string;
  paused?: boolean;
  className?: string;
}

export function RecBadge({ label = "REC TAPE 04", paused = false, className }: Props) {
  return (
    <div
      className={`ana-rec ${paused ? "ana-rec-paused" : ""} ${className ?? ""}`}
      role="status"
      aria-label={paused ? "paused" : "recording"}
    >
      <span className={paused ? "ana-rec-square" : "ana-rec-dot ana-rec-pulse"} />
      <span className="ana-rec-label">{label}</span>
    </div>
  );
}
