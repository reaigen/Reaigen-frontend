import * as React from "react";
import { cn } from "../lib/utils";

const tones = {
  neutral: "border-black/[0.08] bg-white/[0.88] text-black/65",
  strong: "border-black bg-black text-white",
  success: "border-black/[0.08] bg-white/[0.92] text-black/75",
  warning: "border-black/[0.08] bg-white/[0.92] text-black/75",
  danger: "border-black/[0.08] bg-white/[0.92] text-black/75",
} as const;

const dotTones = {
  neutral: "bg-black/35",
  strong: "bg-white/75",
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
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-md",
        tones[tone],
        className,
      )}
    >
      {dot ? <span className={cn("h-1.5 w-1.5 rounded-full", dotTones[tone])} /> : null}
      {children}
    </span>
  );
}
