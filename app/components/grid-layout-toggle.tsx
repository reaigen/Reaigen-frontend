"use client";

import { ViewGridIcon, ViewHorizontalIcon } from "@radix-ui/react-icons";
import { cn } from "../lib/utils";
import { t } from "../lib/i18n";

interface GridLayoutToggleProps {
  value: 1 | 2;
  onChange: (value: 1 | 2) => void;
  lang?: string;
  /** Override the list-grid glyphs/labels when the two modes mean something
      else (e.g. the detail page's focused column vs wide workspace). */
  singleIcon?: React.ReactNode;
  doubleIcon?: React.ReactNode;
  singleLabel?: string;
  doubleLabel?: string;
}

export function GridLayoutToggle({ value, onChange, lang = "en", singleIcon, doubleIcon, singleLabel, doubleLabel }: GridLayoutToggleProps) {
  const labelSingle = singleLabel ?? t("dashboard.gridSingle", lang);
  const labelDouble = doubleLabel ?? t("dashboard.gridCompact", lang);
  return (
    <div
      // Opaque, no backdrop blur: translucent fills over backdrop-filter lag
      // behind live window resizes and flash the white root background through.
      className="floating-toolbar hidden shrink-0 border-border/65 bg-secondary [backdrop-filter:none] [-webkit-backdrop-filter:none] md:flex"
      role="group"
      aria-label={`${labelSingle} / ${labelDouble}`}
    >
      <button
        type="button"
        data-testid="layout-single"
        onClick={() => onChange(1)}
        className={cn(
          "floating-icon-button-sm transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          value === 1
            ? "bg-card text-foreground shadow-control"
            : "text-foreground/65 hover:text-foreground/85",
        )}
        aria-label={labelSingle}
        aria-pressed={value === 1}
        title={labelSingle}
      >
        {singleIcon ?? <ViewHorizontalIcon width={16} height={16} aria-hidden="true" />}
      </button>
      <button
        type="button"
        data-testid="layout-compact"
        onClick={() => onChange(2)}
        className={cn(
          "floating-icon-button-sm transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          value === 2
            ? "bg-card text-foreground shadow-control"
            : "text-foreground/65 hover:text-foreground/85",
        )}
        aria-label={labelDouble}
        aria-pressed={value === 2}
        title={labelDouble}
      >
        {doubleIcon ?? <ViewGridIcon width={16} height={16} aria-hidden="true" />}
      </button>
    </div>
  );
}
