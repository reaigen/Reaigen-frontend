"use client";

import { t, type LocaleKey } from "../../lib/i18n";

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
      <h3 className="text-[12px] font-medium text-foreground/50">
        {t("sharing.lifetime", lang)}
      </h3>

      <div className="flex items-center gap-1.5 flex-wrap">
        {LIFETIME_PRESETS.map((p) => (
          <button
            key={p.hours}
            type="button"
            onClick={() => onHoursChange(p.hours)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-all ${
              hours === p.hours
                ? "bg-foreground text-background border border-foreground"
                : "bg-foreground/[0.04] text-foreground/50 border border-transparent hover:bg-foreground/[0.07] hover:text-foreground/70"
            }`}
          >
            {t(p.labelKey, lang)}
          </button>
        ))}
      </div>
    </div>
  );
}
