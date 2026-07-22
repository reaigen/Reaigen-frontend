"use client";

import * as React from "react";
import { cn } from "../lib/utils";

export interface SegmentedControlOption<T extends string | number> {
  value: T;
  label?: React.ReactNode;
  icon?: React.ReactNode;
  count?: React.ReactNode;
  ariaLabel?: string;
}

export function SegmentedControl<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
  itemClassName,
  iconOnly = false,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedControlOption<T>[];
  ariaLabel?: string;
  className?: string;
  itemClassName?: string;
  iconOnly?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "flex h-12 min-w-0 items-center gap-1 overflow-x-auto rounded-full border border-border/55 bg-surface p-1 shadow-control scrollbar-hide sm:h-11",
        className,
      )}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onChange(option.value)}
            aria-label={option.ariaLabel}
            aria-pressed={active}
            className={cn(
              "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-8",
              iconOnly && "w-10 px-0 sm:w-8",
              active
                ? "bg-foreground text-background shadow-sm"
                : "text-foreground/55 hover:bg-foreground/[0.045] hover:text-foreground",
              itemClassName,
            )}
          >
            {option.icon}
            {option.label}
            {option.count !== undefined ? (
              <span className={cn("tabular-nums", active ? "text-background/65" : "text-foreground/40")}>{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
