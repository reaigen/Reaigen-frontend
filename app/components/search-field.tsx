"use client";

import * as React from "react";
import { cn } from "../lib/utils";
import { CloseIcon, SearchIcon } from "./icons";

export function SearchField({
  value,
  onChange,
  onClear,
  placeholder,
  clearLabel,
  className,
  appearance = "field",
}: {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  placeholder: string;
  clearLabel: string;
  className?: string;
  appearance?: "field" | "toolbar" | "navbar";
}) {
  const toolbar = appearance === "toolbar";
  const navbar = appearance === "navbar";

  return (
    <label className={cn("relative block min-w-0", className)}>
      <span className="sr-only">{placeholder}</span>
      <SearchIcon
        size={toolbar || navbar ? 15 : 16}
        className={cn(
          "pointer-events-none absolute top-1/2 z-10 -translate-y-1/2 text-foreground/55",
          toolbar ? "left-0" : navbar ? "left-3.5" : "left-4",
        )}
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={cn(
          "w-full text-foreground outline-none [&::-webkit-search-cancel-button]:appearance-none",
          toolbar
            ? "h-11 border-0 bg-transparent pl-6 pr-8 text-[16px] placeholder:text-muted-foreground/80 focus-visible:placeholder:text-muted-foreground sm:text-[13px] md:h-10"
            : navbar
              ? "h-11 rounded-full border border-transparent bg-surface-subtle/85 pl-10 pr-9 text-[14px] shadow-none transition-[border-color,background-color,box-shadow] placeholder:text-muted-foreground/75 hover:bg-surface-subtle focus-visible:border-foreground/15 focus-visible:bg-surface-subtle focus-visible:ring-2 focus-visible:ring-ring/10"
            : "h-12 rounded-full border border-border/85 bg-card pl-11 pr-10 text-[16px] shadow-control transition-[border-color,box-shadow] placeholder:text-muted-foreground/80 hover:border-foreground/25 focus-visible:border-foreground/35 focus-visible:ring-2 focus-visible:ring-ring/12 sm:text-[14px]",
        )}
      />
      {value ? (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            onChange("");
            onClear?.();
          }}
          className={cn(
            "absolute top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            toolbar
              ? "right-0 h-8 w-8 hover:bg-foreground/[0.05]"
              : navbar
                ? "right-1 h-8 w-8 hover:bg-foreground/[0.05]"
              : "right-0.5 h-10 w-10 hover:bg-foreground/[0.05] sm:right-1.5 sm:h-8 sm:w-8",
          )}
          aria-label={clearLabel}
        >
          <CloseIcon size={13} />
        </button>
      ) : null}
    </label>
  );
}
