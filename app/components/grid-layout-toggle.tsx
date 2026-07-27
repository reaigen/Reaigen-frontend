"use client";

import { ViewGridIcon, ViewHorizontalIcon } from "@radix-ui/react-icons";
import { cn } from "../lib/utils";
import { t } from "../lib/i18n";

interface GridLayoutToggleProps {
  value: 1 | 2;
  onChange: (value: 1 | 2) => void;
  lang?: string;
}

export function GridLayoutToggle({ value, onChange, lang = "en" }: GridLayoutToggleProps) {
  return (
    <div
      className="floating-toolbar hidden border-border/65 bg-secondary/80 md:flex"
      role="group"
      aria-label={`${t("dashboard.gridSingle", lang)} / ${t("dashboard.gridDouble", lang)}`}
    >
      <button
        type="button"
        onClick={() => onChange(1)}
        className={cn(
          "floating-icon-button-sm flex items-center justify-center transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          value === 1
            ? "bg-card text-foreground shadow-control"
            : "text-foreground/45 hover:text-foreground/75",
        )}
        aria-label={t("dashboard.gridSingle", lang)}
        aria-pressed={value === 1}
      >
        <ViewHorizontalIcon width={14} height={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => onChange(2)}
        className={cn(
          "floating-icon-button-sm flex items-center justify-center transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          value === 2
            ? "bg-card text-foreground shadow-control"
            : "text-foreground/45 hover:text-foreground/75",
        )}
        aria-label={t("dashboard.gridDouble", lang)}
        aria-pressed={value === 2}
      >
        <ViewGridIcon width={14} height={14} aria-hidden="true" />
      </button>
    </div>
  );
}
