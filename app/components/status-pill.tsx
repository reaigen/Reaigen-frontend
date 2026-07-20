import * as React from "react";
import { cn } from "../lib/utils";

const tones = {
  neutral: "border-border/60 bg-background/90 text-foreground/70",
  strong: "border-foreground bg-foreground text-background",
  success: "border-border/60 bg-background/90 text-foreground/70",
  warning: "border-border/60 bg-background/90 text-foreground/70",
  danger: "border-border/60 bg-background/90 text-foreground/70",
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
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-md",
        tones[tone],
        className,
      )}
    >
      {dot ? <span className={cn("h-1.5 w-1.5 rounded-full", dotTones[tone])} /> : null}
      {children}
    </span>
  );
}
