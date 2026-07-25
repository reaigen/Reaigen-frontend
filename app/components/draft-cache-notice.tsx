"use client";

import { t } from "../lib/i18n";
import { Button } from "../lib/ui/button";
import { InfoIcon } from "./icons";

export function DraftCacheNotice({
  lang,
  refreshing,
  onRefresh,
}: {
  lang: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div role="status" className="mb-5 rounded-[1.5rem] border border-border/70 bg-card p-4 shadow-control sm:flex sm:items-center sm:gap-4 sm:rounded-2xl">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-foreground/45">
          <InfoIcon size={16} />
        </span>
        <div className="min-w-0 pt-0.5">
          <p className="text-[12px] font-semibold text-foreground/80">{t("draft.cachedTitle", lang)}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("draft.cachedNotice", lang)}</p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3 h-11 w-full shrink-0 sm:mt-0 sm:h-9 sm:w-auto"
        onClick={onRefresh}
        loading={refreshing}
      >
        {t("draft.refreshListing", lang)}
      </Button>
    </div>
  );
}
