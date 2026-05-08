import type { ButtonHTMLAttributes, ReactNode } from "react";
export function AnalogButton(
  props: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }
) {
  return <button {...props} />;
}
