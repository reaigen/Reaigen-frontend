import { t } from "../lib/i18n";
import { ArrowLeftIcon } from "./icons";
import { ReaigenLoadingMark } from "./reaigen-loading-mark";

/**
 * Route loading is already part of the immersive workspace. Keeping the same
 * canvas and back-control geometry avoids a white interstitial before the
 * viewer owns the screen.
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
      className="fixed inset-0 z-50 overflow-hidden bg-[#121214] text-white"
      aria-busy="true"
    >
      <h1 className="sr-only">{t("nav.tours", lang)}</h1>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/45 to-transparent" aria-hidden="true" />
      <a
        href={backHref}
        aria-label={t("common.back", lang)}
        className="viewer-top-control-icon pen-touch-target absolute left-3 top-[calc(0.75rem+env(safe-area-inset-top,0px))] z-20 flex items-center justify-center rounded-full border border-white/[0.16] bg-black/60 text-white shadow-2xl transition-colors hover:bg-black/72 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:left-4 sm:top-[calc(1rem+env(safe-area-inset-top,0px))] xl:left-6"
      >
        <ArrowLeftIcon size={18} color="#fff" />
      </a>
      <ReaigenLoadingMark status={t("common.loading", lang)} tone="dark" />
    </main>
  );
}
