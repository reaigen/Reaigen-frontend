import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../lib/utils";

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
      // DM Serif Display ships a single 400 cut, and the marketing site tracks
      // the mark in rather than out. Display serifs want negative tracking; the
      // old +0.005em was tuned for Georgia.
      className={cn("font-normal tracking-[-0.01em]", className)}
      style={{
        ...style,
        fontFamily: "var(--font-brand), ui-serif, Georgia, serif",
      }}
    >
      Reaigen
    </span>
  );
}
