import { t } from "../lib/i18n";
import { ReaigenLoadingMark } from "./reaigen-loading-mark";

/**
 * Full-screen startup splash. The composition itself lives in
 * `ReaigenLoadingMark` so that this and the in-viewport loaders are literally
 * the same artwork — see the note there about the jump that two of them caused.
 */
export function PageLoading({ className, lang = "en" }: { className?: string; lang?: string }) {
  return (
    <div className={className ?? "fixed inset-0 z-50 bg-background"}>
      <ReaigenLoadingMark status={t("common.loading", lang)} />
    </div>
  );
}
