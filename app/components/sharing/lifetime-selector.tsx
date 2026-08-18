"use client";

import { formatDate, t, type LocaleKey } from "../../lib/i18n";

const LIFETIME_PRESETS = [
  { labelKey: "shareDialog.expiry.oneHour" as LocaleKey, hours: 1 },
  { labelKey: "shareDialog.expiry.twentyFourHours" as LocaleKey, hours: 24 },
  { labelKey: "shareDialog.expiry.sevenDays" as LocaleKey, hours: 168 },
  { labelKey: "shareDialog.expiry.thirtyDays" as LocaleKey, hours: 720 },
  { labelKey: "sharing.lifetimeNever" as LocaleKey, hours: 0 },
] as const;

interface LifetimeSelectorProps {
  hours: number | null;
  onHoursChange: (hours: number) => void;
  currentExpiry?: string | null;
  lang: string;
}

export function LifetimeSelector({ hours, onHoursChange, currentExpiry, lang }: LifetimeSelectorProps) {
  return (
    <div className="space-y-3.5">
      <h3 className="px-0.5 text-[13px] font-semibold text-foreground/70">
        {t("sharing.lifetime", lang)}
      </h3>

      {hours === null && currentExpiry ? (
        <p className="rounded-xl bg-surface-subtle px-3 py-2 text-[11px] text-muted-foreground">
          {t("shares.expires", lang)} · <span className="font-semibold text-foreground/70">{formatDate(currentExpiry, undefined, lang)}</span>
        </p>
      ) : null}

      <div className="selection-capsule-track overflow-x-auto scrollbar-hide" role="group" aria-label={t("sharing.lifetime", lang)}>
        {LIFETIME_PRESETS.map((preset) => {
          const active = hours === preset.hours;
          return (
            <button
              key={preset.hours}
              type="button"
              aria-pressed={active}
              onClick={() => onHoursChange(preset.hours)}
              className="selection-capsule-item pen-touch-target min-w-[5.75rem] flex-1 shrink-0 px-3 text-[12px] leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t(preset.labelKey, lang)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
