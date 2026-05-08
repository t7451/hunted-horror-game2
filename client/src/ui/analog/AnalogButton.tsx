// client/src/ui/analog/AnalogButton.tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./AnalogButton.css";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost";
  children: ReactNode;
}

export function AnalogButton({
  variant = "primary",
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      type={rest.type ?? "button"}
      {...rest}
      className={`ana-btn ana-btn-${variant} ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
