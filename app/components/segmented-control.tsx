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
        "selection-capsule-track overflow-x-auto scrollbar-hide",
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
              "selection-capsule-item min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              iconOnly && "w-11 px-0",
              itemClassName,
            )}
          >
            {option.icon}
            {option.label}
            {option.count !== undefined ? (
              <span className={cn("tabular-nums", active ? "text-foreground/52" : "text-foreground/40")}>{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
