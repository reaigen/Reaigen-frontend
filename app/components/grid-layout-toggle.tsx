"use client";

import { t } from "../lib/i18n";
import type { LocaleKey } from "../lib/locales";

interface GridLayoutToggleProps {
  value: 1 | 2;
  onChange: (value: 1 | 2) => void;
  lang?: string;
}

export function GridLayoutToggle({ value, onChange, lang = "en" }: GridLayoutToggleProps) {
  return (
    <div className="hidden items-center gap-0.5 rounded-full bg-foreground/[0.045] p-0.5 md:flex">
      <button
        type="button"
        onClick={() => onChange(1)}
        className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${value === 1 ? "bg-background text-foreground shadow-sm" : "text-foreground/35 hover:text-foreground/60"}`}
        aria-label={t("dashboard.gridSingle", lang)}
        aria-pressed={value === 1}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="12" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <rect x="2" y="9" width="12" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onChange(2)}
        className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${value === 2 ? "bg-background text-foreground shadow-sm" : "text-foreground/35 hover:text-foreground/60"}`}
        aria-label={t("dashboard.gridDouble", lang)}
        aria-pressed={value === 2}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}
