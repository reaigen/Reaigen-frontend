"use client";

import * as React from "react";
import { Input } from "../../lib/ui/input";
import { t, type LocaleKey } from "../../lib/i18n";
import { CheckIcon, LinkIcon, LockIcon } from "../icons";

export type PrivacyLevel = "open" | "pin";

interface PrivacyLevelSelectorProps {
  level: PrivacyLevel;
  pin: string;
  onLevelChange: (level: PrivacyLevel) => void;
  onPinChange: (pin: string) => void;
  lang: string;
}

export function PrivacyLevelSelector({ level, pin, onLevelChange, onPinChange, lang }: PrivacyLevelSelectorProps) {
  const options: { value: PrivacyLevel; icon: React.ReactNode; labelKey: string; descriptionKey: string }[] = [
    {
      value: "open",
      icon: <LinkIcon size={13} />,
      labelKey: "sharing.privacyOpen",
      descriptionKey: "sharing.privacyOpenDesc",
    },
    {
      value: "pin",
      icon: <LockIcon size={13} />,
      labelKey: "sharing.privacyPin",
      descriptionKey: "sharing.privacyPinDesc",
    },
  ];

  return (
    <div className="space-y-3">
      <h3 className="text-[13px] font-semibold text-foreground/70">
        {t("sharing.protection", lang)}
      </h3>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const active = option.value === level;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => {
                onLevelChange(option.value);
                if (option.value !== "pin") onPinChange("");
              }}
              className={`relative flex min-h-[4.25rem] items-start gap-3 rounded-2xl border px-3.5 py-3 text-left transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${active ? "border-foreground/25 bg-card shadow-control" : "border-border/55 bg-card/70 hover:border-foreground/15 hover:bg-card"}`}
            >
              <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${active ? "bg-foreground text-background" : "bg-secondary text-foreground/55"}`}>
                {option.icon}
              </span>
              <span className="min-w-0 pr-5">
                <span className="block text-[12px] font-semibold leading-snug text-foreground/85">{t(option.labelKey as LocaleKey, lang)}</span>
                <span className="mt-1 block text-[10px] leading-snug text-muted-foreground">{t(option.descriptionKey as LocaleKey, lang)}</span>
              </span>
              {active ? (
                <span className="absolute right-3 top-3 flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-background">
                  <CheckIcon size={9} />
                </span>
              ) : null}
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
            className="h-11 rounded-xl text-[14px] tabular-nums"
            autoFocus
          />
          <p className="text-[11px] text-foreground/50">{t("shared.pin.minLength", lang)}</p>
        </div>
      )}
    </div>
  );
}
