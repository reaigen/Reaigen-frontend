import * as React from "react";
import { cn } from "../lib/utils";

const tones = {
  neutral: "border-border/80 bg-card text-foreground/75",
  strong: "border-foreground bg-foreground text-background",
  success: "border-border/80 bg-card text-foreground/75",
  warning: "border-border/80 bg-card text-foreground/75",
  danger: "border-border/80 bg-card text-foreground/75",
} as const;

const dotTones = {
  neutral: "bg-foreground/35",
  strong: "bg-background/75",
  success: "bg-emerald-600",
  warning: "bg-amber-600",
  danger: "bg-red-600",
} as const;

export function StatusPill({
  children,
  tone = "neutral",
  dot = false,
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof tones;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold",
        tones[tone],
        className,
      )}
    >
      {dot ? <span className={cn("h-1.5 w-1.5 rounded-full", dotTones[tone])} /> : null}
      {children}
    </span>
  );
}
