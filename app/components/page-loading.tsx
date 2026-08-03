"use client";

import * as React from "react";

import { getBrowserLanguage, t } from "../lib/i18n";
import { cn } from "../lib/utils";
import { Button } from "../lib/ui/button";
import { ReaigenLoadingMark } from "./reaigen-loading-mark";

const RECOVERY_DELAY_MS = 10_000;

export function PageLoading({ className }: { className?: string }) {
  const [lang, setLang] = React.useState("en");
  const [showRecovery, setShowRecovery] = React.useState(false);

  React.useEffect(() => {
    setLang(getBrowserLanguage());
    const timer = window.setTimeout(() => setShowRecovery(true), RECOVERY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className={cn("fixed inset-0 flex items-center justify-center bg-background", className)}>
      <div className="flex flex-col items-center">
        <ReaigenLoadingMark status={t("common.loading", lang)} />
        <div className="mt-5 h-9" aria-live="polite">
          {showRecovery ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
            >
              {t("common.tryAgain", lang)}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
