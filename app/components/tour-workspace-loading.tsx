import { t } from "../lib/i18n";
import { ArrowLeftIcon } from "./icons";
import { ReaigenLoadingMark } from "./reaigen-loading-mark";

/**
 * Route loading for the tour workspace. White, matching the app's loading
 * language everywhere else — the viewer's dark canvas only takes over once it
 * actually has a frame to show.
 */
export function TourWorkspaceLoading({
  backHref = "/tours",
  lang = "en",
}: {
  backHref?: string;
  lang?: string;
}) {
  return (
    <main
      data-testid="tour-workspace-loading"
      className="fixed inset-0 z-50 overflow-hidden bg-background text-foreground"
      aria-busy="true"
    >
      <h1 className="sr-only">{t("nav.tours", lang)}</h1>
      <a
        href={backHref}
        aria-label={t("common.back", lang)}
        className="viewer-top-control-icon pen-touch-target absolute left-3 top-[calc(0.75rem+env(safe-area-inset-top,0px))] z-20 flex items-center justify-center rounded-full border border-border/70 bg-white text-foreground shadow-control transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:left-4 sm:top-[calc(1rem+env(safe-area-inset-top,0px))] xl:left-6"
      >
        <ArrowLeftIcon size={18} />
      </a>
      <ReaigenLoadingMark status={t("common.loading", lang)} tone="light" />
    </main>
  );
}
