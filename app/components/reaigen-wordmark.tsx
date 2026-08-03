import type { ComponentPropsWithoutRef } from "react";

type ReaigenWordmarkProps = Omit<ComponentPropsWithoutRef<"span">, "children">;

/** Canonical Reaigen wordmark typography used across app and shared surfaces. */
export function ReaigenWordmark({
  className = "",
  style,
  ...props
}: ReaigenWordmarkProps) {
  return (
    <span
      {...props}
      className={`font-medium tracking-[0.005em] ${className}`}
      style={{
        ...style,
        fontFamily: "var(--font-brand), ui-serif, Georgia, serif",
      }}
    >
      Reaigen
    </span>
  );
}
