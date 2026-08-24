"use client";

import * as React from "react";
import { Input } from "../../lib/ui/input";
import { t, type LocaleKey } from "../../lib/i18n";
import { LinkIcon, LockIcon } from "../icons";

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
    <div className="space-y-3.5">
      <h3 className="px-0.5 text-[13px] font-semibold text-foreground/70">
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
              className="editor-control-capsule floating-panel-shape pen-touch-target relative flex min-h-16 items-center gap-2.5 border border-border/55 px-3 py-2.5 text-left transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${active ? "bg-foreground text-background" : "bg-secondary/80 text-foreground/50"}`}>
                {option.icon}
              </span>
              {/* Check sits in the flow, so wrapping copy can never run under it. */}
              <span className="min-w-0 flex-1">
                <span className="block break-words text-[13px] font-semibold leading-snug text-foreground/90">{t(option.labelKey as LocaleKey, lang)}</span>
                <span className="mt-0.5 block break-words text-[12px] leading-snug text-foreground/60">{t(option.descriptionKey as LocaleKey, lang)}</span>
              </span>
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                  active ? "border-foreground" : "border-foreground/25 bg-card/65"
                }`}
              >
                {active ? <span className="h-2.5 w-2.5 rounded-full bg-foreground" /> : null}
              </span>
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
            className="editor-control-capsule h-11 rounded-full px-4 text-[14px] tabular-nums"
            autoFocus
          />
          <p className="text-[11px] text-foreground/50">{t("shared.pin.minLength", lang)}</p>
        </div>
      )}
    </div>
  );
}
