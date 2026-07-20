"use client";

import * as React from "react";
import { Input } from "../../lib/ui/input";
import { t, type LocaleKey } from "../../lib/i18n";

export type PrivacyLevel = "open" | "pin";

interface PrivacyLevelSelectorProps {
  level: PrivacyLevel;
  pin: string;
  onLevelChange: (level: PrivacyLevel) => void;
  onPinChange: (pin: string) => void;
  lang: string;
}

export function PrivacyLevelSelector({ level, pin, onLevelChange, onPinChange, lang }: PrivacyLevelSelectorProps) {
  const options: { value: PrivacyLevel; icon: React.ReactNode; labelKey: string }[] = [
    {
      value: "open",
      icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
      labelKey: "sharing.privacyOpen",
    },
    {
      value: "pin",
      icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
      labelKey: "sharing.privacyPin",
    },
  ];

  return (
    <div className="space-y-3">
      <h3 className="text-[13px] font-semibold text-foreground/70">
        {t("sharing.protection", lang)}
      </h3>

      {/* Segmented control */}
      <div role="radiogroup" aria-label={t("sharing.protection", lang)} className="flex rounded-xl bg-foreground/[0.05] p-1">
        {options.map((opt) => {
          const selected = level === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                onLevelChange(opt.value);
                if (opt.value !== "pin") onPinChange("");
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                selected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-foreground/50 hover:text-foreground/70"
              }`}
            >
              {opt.icon}
              {t(opt.labelKey as never, lang)}
            </button>
          );
        })}
      </div>

      {level === "pin" && (
        <div className="space-y-1.5 animate-fade-in">
          <Input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder={t("shareDialog.pinPlaceholder", lang)}
            value={pin}
            onChange={(e) => onPinChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
            className="h-9 text-[12px]"
            autoFocus
          />
          <p className="text-[11px] text-foreground/50">{t("shared.pin.minLength", lang)}</p>
        </div>
      )}
    </div>
  );
}
