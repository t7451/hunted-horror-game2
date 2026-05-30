import type { ElementType, HTMLAttributes, ReactNode } from "react";

type OffsetMode = "auto" | "none" | "fixed";

interface Props extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  offset?: OffsetMode;
  children: ReactNode;
}

const SHADOW_AUTO =
  "calc(var(--ana-intensity) * -2px) 0 var(--ana-magenta)," +
  "calc(var(--ana-intensity) * 2px) 0 var(--ana-cyan)," +
  "0 0 4px rgba(0,0,0,0.9)";

const SHADOW_FIXED =
  "-1px 0 var(--ana-magenta), 1px 0 var(--ana-cyan), 0 0 4px rgba(0,0,0,0.9)";

export function ChromaticText({
  as: Tag = "span",
  offset = "auto",
  style,
  children,
  ...rest
}: Props) {
  const textShadow =
    offset === "none"
      ? undefined
      : offset === "fixed"
        ? SHADOW_FIXED
        : SHADOW_AUTO;
  return (
    <Tag
      {...rest}
      style={{
        textShadow,
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}
