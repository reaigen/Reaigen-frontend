"use client";

import * as React from "react";
import { cn } from "../lib/utils";
import { SearchIcon } from "./icons";

export function SearchField({
  value,
  onChange,
  onClear,
  placeholder,
  clearLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  placeholder: string;
  clearLabel: string;
  className?: string;
}) {
  return (
    <label className={cn("relative block min-w-0", className)}>
      <span className="sr-only">{placeholder}</span>
      <SearchIcon
        size={15}
        className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 w-full border-0 bg-transparent pl-6 pr-8 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60"
      />
      {value ? (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            onChange("");
            onClear?.();
          }}
          className="absolute right-0 top-1/2 -translate-y-1/2 rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={clearLabel}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </label>
  );
}
