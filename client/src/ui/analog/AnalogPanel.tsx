// client/src/ui/analog/AnalogPanel.tsx
import type { HTMLAttributes, ReactNode } from "react";
import "./AnalogPanel.css";

interface Props extends HTMLAttributes<HTMLDivElement> {
  tone?: "dark" | "paper";
  classified?: boolean;
  children: ReactNode;
}

export function AnalogPanel({
  tone = "dark",
  classified = false,
  className,
  children,
  ...rest
}: Props) {
  return (
    <div
      {...rest}
      className={`ana-panel ana-panel-${tone} ${className ?? ""}`}
    >
      {classified && <span className="ana-panel-stamp">FILE // CLASSIFIED</span>}
      {children}
    </div>
  );
}
