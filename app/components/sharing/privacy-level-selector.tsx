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
    <div className="space-y-3.5">
      <h3 className="px-0.5 text-[12px] font-semibold text-foreground/65">
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
                <span className="block break-words text-[12px] font-semibold leading-snug text-foreground/85">{t(option.labelKey as LocaleKey, lang)}</span>
                <span className="mt-0.5 block break-words text-[11px] leading-snug text-muted-foreground">{t(option.descriptionKey as LocaleKey, lang)}</span>
              </span>
              <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
                {active ? (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-background">
                    <CheckIcon size={9} />
                  </span>
                ) : null}
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
