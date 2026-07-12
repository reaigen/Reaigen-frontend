"use client";

import * as React from "react";
import { Input } from "../../lib/ui/input";
import { t } from "../../lib/i18n";

export type PrivacyLevel = "open" | "pin";

interface PrivacyLevelSelectorProps {
  level: PrivacyLevel;
  pin: string;
  onLevelChange: (level: PrivacyLevel) => void;
  onPinChange: (pin: string) => void;
  lang: string;
}

export function PrivacyLevelSelector({ level, pin, onLevelChange, onPinChange, lang }: PrivacyLevelSelectorProps) {
  const options: { value: PrivacyLevel; icon: React.ReactNode; labelKey: string; descKey: string }[] = [
    {
      value: "open",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
      labelKey: "sharing.privacyOpen",
      descKey: "sharing.privacyOpenDesc",
    },
    {
      value: "pin",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
      labelKey: "sharing.privacyPin",
      descKey: "sharing.privacyPinDesc",
    },
  ];

  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-medium text-foreground/40 uppercase tracking-wider">
        {t("sharing.protection", lang)}
      </h3>

      <div className="rounded-lg border border-border/50 divide-y divide-border/40 overflow-hidden">
        {options.map((opt) => {
          const selected = level === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onLevelChange(opt.value);
                if (opt.value !== "pin") onPinChange("");
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-all ${
                selected ? "bg-foreground/[0.03]" : ""
              }`}
            >
              <span className={`w-3.5 h-3.5 rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-colors ${
                selected ? "border-foreground" : "border-foreground/20"
              }`}>
                {selected && <span className="w-1.5 h-1.5 rounded-full bg-foreground" />}
              </span>
              <span className={selected ? "text-foreground/60" : "text-foreground/25"}>{opt.icon}</span>
              <div className="min-w-0 flex-1">
                <span className={`text-[12px] font-medium ${selected ? "text-foreground" : "text-foreground/50"}`}>
                  {t(opt.labelKey as never, lang)}
                </span>
                <span className="text-[10px] text-foreground/30 ml-1.5">
                  {t(opt.descKey as never, lang)}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {level === "pin" && (
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder={t("shareDialog.pinPlaceholder", lang)}
          value={pin}
          onChange={(e) => onPinChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
          className="h-8 text-[12px]"
          autoFocus
        />
      )}
    </div>
  );
}
