"use client";

import * as React from "react";
import { Input } from "../../lib/ui/input";
import { t, type LocaleKey } from "../../lib/i18n";
import { LinkIcon, LockIcon } from "../icons";
import { SegmentedControl } from "../segmented-control";

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
      icon: <LinkIcon size={13} />,
      labelKey: "sharing.privacyOpen",
    },
    {
      value: "pin",
      icon: <LockIcon size={13} />,
      labelKey: "sharing.privacyPin",
    },
  ];

  return (
    <div className="space-y-3">
      <h3 className="text-[13px] font-semibold text-foreground/70">
        {t("sharing.protection", lang)}
      </h3>

      <SegmentedControl
        value={level}
        onChange={(nextLevel) => {
          onLevelChange(nextLevel);
          if (nextLevel !== "pin") onPinChange("");
        }}
        ariaLabel={t("sharing.protection", lang)}
        className="w-full"
        itemClassName="min-w-0 flex-1"
        options={options.map((option) => ({
          value: option.value,
          icon: option.icon,
          label: t(option.labelKey as LocaleKey, lang),
        }))}
      />

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
