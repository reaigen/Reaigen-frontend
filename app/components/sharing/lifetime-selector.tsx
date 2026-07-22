"use client";

import { t, type LocaleKey } from "../../lib/i18n";
import { SegmentedControl } from "../segmented-control";

const LIFETIME_PRESETS = [
  { labelKey: "shareDialog.expiry.oneHour" as LocaleKey, hours: 1 },
  { labelKey: "shareDialog.expiry.twentyFourHours" as LocaleKey, hours: 24 },
  { labelKey: "shareDialog.expiry.sevenDays" as LocaleKey, hours: 168 },
  { labelKey: "shareDialog.expiry.thirtyDays" as LocaleKey, hours: 720 },
  { labelKey: "sharing.lifetimeNever" as LocaleKey, hours: 0 },
] as const;

interface LifetimeSelectorProps {
  hours: number;
  onHoursChange: (hours: number) => void;
  lang: string;
}

export function LifetimeSelector({ hours, onHoursChange, lang }: LifetimeSelectorProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-[13px] font-semibold text-foreground/70">
        {t("sharing.lifetime", lang)}
      </h3>

      <SegmentedControl
        value={hours}
        onChange={onHoursChange}
        ariaLabel={t("sharing.lifetime", lang)}
        className="w-full"
        itemClassName="min-w-[4.75rem] flex-1 text-[12px]"
        options={LIFETIME_PRESETS.map((preset) => ({
          value: preset.hours,
          label: t(preset.labelKey, lang),
        }))}
      />
    </div>
  );
}
