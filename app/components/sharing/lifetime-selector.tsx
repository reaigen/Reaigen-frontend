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
    <div className="space-y-3">
      <h3 className="text-[13px] font-semibold text-foreground/70">
        {t("sharing.lifetime", lang)}
      </h3>

      {hours === null && currentExpiry ? (
        <p className="rounded-xl bg-surface-subtle px-3 py-2 text-[11px] text-muted-foreground">
          {t("shares.expires", lang)} · <span className="font-semibold text-foreground/70">{formatDate(currentExpiry, undefined, lang)}</span>
        </p>
      ) : null}

      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5" role="group" aria-label={t("sharing.lifetime", lang)}>
        {LIFETIME_PRESETS.map((preset) => {
          const active = hours === preset.hours;
          return (
            <button
              key={preset.hours}
              type="button"
              aria-pressed={active}
              onClick={() => onHoursChange(preset.hours)}
              className={`min-h-11 rounded-full border px-2 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${active ? "border-foreground bg-foreground text-background shadow-control" : "border-border/55 bg-card text-foreground/60 hover:border-foreground/20 hover:text-foreground"}`}
            >
              {t(preset.labelKey, lang)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
