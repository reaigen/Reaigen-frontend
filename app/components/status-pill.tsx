import * as React from "react";
import { cn } from "../lib/utils";

const tones = {
  neutral: "border-border/80 bg-card text-foreground/75",
  strong: "border-primary bg-primary text-primary-foreground",
  success: "border-success/20 bg-success/[0.06] text-success",
  warning: "border-warning/20 bg-warning/[0.07] text-warning",
  danger: "border-destructive/20 bg-destructive/[0.06] text-destructive",
} as const;

const dotTones = {
  neutral: "bg-foreground/35",
  strong: "bg-primary-foreground/75",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
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
        "floating-status inline-flex items-center gap-1.5 border",
        tones[tone],
        className,
      )}
    >
      {dot ? <span className={cn("h-1.5 w-1.5 rounded-full", dotTones[tone])} /> : null}
      {children}
    </span>
  );
}
