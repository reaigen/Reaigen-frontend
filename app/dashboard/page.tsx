"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../components/hooks/use-auth";
import { AppShell } from "../components/app-shell";
import { CollectionCard } from "../components/collection-card";
import { CollectionState } from "../components/collection-state";
import { t, getUserLanguage } from "../lib/i18n";
import { listAllSplats, listDrafts } from "../lib/api/client";
import type { DraftListingItem, SplatListItem } from "../lib/tour-types";
import Link from "next/link";
import { Thumbnail } from "../components/thumbnail";
import { PageLoading } from "../components/page-loading";
import { PageHeader } from "../components/page-header";
import { StatusPill } from "../components/status-pill";
import { SearchField } from "../components/search-field";
import { GridLayoutToggle } from "../components/grid-layout-toggle";
import { ArrowRightIcon, ImageIcon, InfoIcon, ShareIcon } from "../components/icons";
import { Button } from "../lib/ui/button";

function compactNumber(value: string | number | null | undefined, lang?: string) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat(lang, { maximumFractionDigits: n % 1 === 0 ? 0 : 1 }).format(n);
}

function formatMoney(value: string | number | null | undefined, currency: string | null | undefined, lang: string) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency: currency || "EUR", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${compactNumber(n, lang)}${currency ? ` ${currency}` : ""}`;
  }
}

function getDraftThumbnail(draft: DraftListingItem): string | null {
  const uploads = draft.raw_uploads ?? [];
  const img = uploads
    .filter((u) => u.mime_type?.startsWith("image") || u.asset_type === "photo")
    .sort((a, b) => a.sort_order - b.sort_order)[0];
  return img?.file_url ?? null;
}

type DashboardTourState = "ready" | "processing" | "issues";

function getTourState(item: SplatListItem): DashboardTourState {
  const status = item.status.toLowerCase();
  if (status === "failed" || status === "cancelled") return "issues";
  if (status === "completed" && (item.has_sog || item.has_splat || item.has_ply)) return "ready";
  return "processing";
}

export default function DashboardPage() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const router = useRouter();

  const [drafts, setDrafts] = React.useState<DraftListingItem[]>([]);
  const [draftsLoading, setDraftsLoading] = React.useState(true);
  const [draftsError, setDraftsError] = React.useState(false);
  const [reloadNonce, setReloadNonce] = React.useState(0);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(false);
  const [totalCount, setTotalCount] = React.useState(0);
  const pageRef = React.useRef(1);

  const [tourStates, setTourStates] = React.useState<Record<number, DashboardTourState>>({});
  const [searchInput, setSearchInput] = React.useState("");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [gridCols, setGridCols] = React.useState<1 | 2>(2);
  // Read persisted layout after mount to avoid a hydration mismatch
  React.useEffect(() => {
    const cached = localStorage.getItem("reaigen:gridCols");
    if (cached === "1") setGridCols(1);
  }, []);
  const handleGridCols = React.useCallback((cols: 1 | 2) => {
    setGridCols(cols);
    localStorage.setItem("reaigen:gridCols", String(cols));
  }, []);
  const abortRef = React.useRef<AbortController | null>(null);
  const sentinelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isLoading, isAuthenticated, router]);

  const loadPage = React.useCallback(async (page: number, append: boolean) => {
    // Cancel any in-flight search request to prevent race conditions
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const data = await listDrafts(page, 20, searchQuery);
    // If this request was superseded, discard results
    if (controller.signal.aborted) return;

    const results = data.results ?? [];
    setDrafts((prev) => append ? [...prev, ...results] : results);
    setHasMore(!!data.next);
    setTotalCount(data.count ?? 0);
    pageRef.current = page;

  }, [searchQuery]);

  // Load tour availability in batches. This avoids one by-draft request per card.
  React.useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    void listAllSplats().then((splats) => {
      if (!active) return;
      const map: Record<number, DashboardTourState> = {};
      for (const splat of splats) {
        const state = getTourState(splat);
        if (!map[splat.source_draft] || (state === "ready" && map[splat.source_draft] !== "ready")) {
          map[splat.source_draft] = state;
        }
      }
      setTourStates(map);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [isAuthenticated]);

  React.useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput.trim()), 150);
    return () => clearTimeout(timer);
  }, [searchInput]);

  React.useEffect(() => {
    if (!isAuthenticated) return;
    setDraftsLoading(true);
    setDraftsError(false);
    loadPage(1, false)
      .catch(() => setDraftsError(true))
      .finally(() => setDraftsLoading(false));
  }, [searchQuery, isAuthenticated, loadPage, reloadNonce]);

  React.useEffect(() => {
    if (!isAuthenticated) return;
    const refreshAfterAgentEdit = () => { void loadPage(1, false); };
    const applyAgentSearch = (event: Event) => {
      const query = (event as CustomEvent<{ query?: string }>).detail?.query?.trim();
      if (query) setSearchInput(query);
    };
    window.addEventListener("reai-creations-updated", refreshAfterAgentEdit);
    window.addEventListener("reai-workspace-search", applyAgentSearch);
    return () => {
      window.removeEventListener("reai-creations-updated", refreshAfterAgentEdit);
      window.removeEventListener("reai-workspace-search", applyAgentSearch);
    };
  }, [isAuthenticated, loadPage]);

  const handleLoadMore = React.useCallback(async () => {
    setLoadingMore(true);
    try { await loadPage(pageRef.current + 1, true); } catch {}
    setLoadingMore(false);
  }, [loadPage]);

  // Infinite scroll: observe sentinel div to auto-load next page
  React.useEffect(() => {
    if (!hasMore || loadingMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) handleLoadMore(); },
      { rootMargin: "400px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, handleLoadMore]);

  // Background polling: refresh page 1 every 60s when tab is visible
  React.useEffect(() => {
    if (!isAuthenticated) return;
    const poll = () => {
      if (document.hidden) return;
      listDrafts(1, 20, searchQuery).then((data) => {
        const results = data.results ?? [];
        if (results[0]?.id !== drafts[0]?.id || results.length !== Math.min(drafts.length, 20)) {
          setDrafts((prev) => {
            const appended = prev.slice(20);
            return [...results, ...appended];
          });
          setTotalCount(data.count ?? 0);
          setHasMore(!!data.next);
        }
      }).catch(() => {});
    };
    const id = setInterval(poll, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [isAuthenticated, searchQuery, drafts]);

  if (isLoading || !user) {
    return <PageLoading />;
  }

  const lang = getUserLanguage(user.localization);

  return (
    <AppShell user={user} onLogout={logout}>
      <div className="mx-auto w-full max-w-[1180px]">
        <PageHeader
          eyebrow={user.first_name ? `${t("dashboard.welcome", lang)}, ${user.first_name}` : t("dashboard.welcome", lang)}
          title={t("dashboard.creationsTitle", lang)}
          description={t("dashboard.creationsSubtitle", lang)}
          actions={totalCount > 0 ? <StatusPill>{totalCount} {t("dashboard.items", lang)}</StatusPill> : undefined}
          className="mb-5 sm:mb-8"
        />
        {/* Search bar */}
        <div className="mb-5 flex items-center gap-3 rounded-full border border-border/80 bg-card px-4 py-0.5 shadow-control sm:mb-7 md:rounded-none md:border-x-0 md:border-t-0 md:bg-transparent md:px-0 md:pb-2 md:pt-0 md:shadow-none">
          <SearchField
            value={searchInput}
            onChange={setSearchInput}
            onClear={() => setSearchQuery("")}
            placeholder={t("dashboard.searchPlaceholder", lang)}
            clearLabel={t("dashboard.clearSearch", lang)}
            className="flex-1"
            appearance="toolbar"
          />
          <GridLayoutToggle value={gridCols} onChange={handleGridCols} lang={lang} />
        </div>

        {/* Cards */}
        {draftsLoading ? (
          <div className={`grid grid-cols-1 gap-7 ${gridCols === 2 ? "md:grid-cols-2" : "mx-auto max-w-2xl"}`}>
            {Array.from({ length: gridCols === 2 ? 4 : 3 }).map((_, i) => (
              <CollectionCard key={i} loading>
                <div className="aspect-[16/10] bg-muted/45" />
                <div className="flex h-12 items-center justify-between px-4">
                  <div className="h-3 w-1/3 rounded bg-muted/55" />
                  <div className="h-3 w-14 rounded bg-muted/40" />
                </div>
              </CollectionCard>
            ))}
          </div>
        ) : draftsError ? (
          <CollectionState
            kind="error"
            icon={<InfoIcon size={20} />}
            title={t("dashboard.loadFailed", lang)}
            action={<Button type="button" variant="outline" size="sm" onClick={() => setReloadNonce((value) => value + 1)}>{t("common.tryAgain", lang)}</Button>}
          />
        ) : drafts.length === 0 ? (
          <CollectionState
            icon={<ImageIcon size={20} />}
            title={t(searchQuery ? "dashboard.noResults" : "dashboard.noSplatsTitle", lang)}
            description={t(searchQuery ? "dashboard.noResultsHint" : "dashboard.noSplats", lang)}
            action={searchQuery ? <Button type="button" variant="outline" size="sm" onClick={() => { setSearchInput(""); setSearchQuery(""); }}>{t("dashboard.clearSearch", lang)}</Button> : undefined}
          />
        ) : (
          <>
          <div className={`grid grid-cols-1 gap-7 ${gridCols === 2 ? "md:grid-cols-2" : "mx-auto max-w-2xl"}`}>
            {drafts.map((draft, idx) => {
              const prefPrice = formatMoney(draft.price_preferred, draft.price_preferred_currency, lang);
              const origPrice = formatMoney(draft.price, draft.currency, lang);
              const price = prefPrice || origPrice;
              const showOrigPrice = prefPrice && origPrice && draft.price_preferred_currency !== draft.currency;
              const address = draft.display_address || [draft.city, draft.state, draft.country].filter(Boolean).join(", ");
              const thumbUrl = getDraftThumbnail(draft);
              const draftTour = tourStates[draft.id];
              const tourStatusLabel = draftTour === "ready"
                ? t("dashboard.tourReady", lang)
                : draftTour === "issues"
                  ? t("dashboard.status.failed", lang)
                  : draftTour === "processing"
                    ? t("dashboard.status.processing", lang)
                    : null;

              return (
                <CollectionCard
                  key={draft.id}
                  revealIndex={idx}
                >
                  <Link
                    href={`/draft/${draft.id}`}
                    className="block focus-visible:outline-none"
                    onMouseEnter={() => router.prefetch(`/draft/${draft.id}`)}
                  >
                    <div className="relative aspect-[16/10] overflow-hidden bg-[#d8d2c8]">
                      {thumbUrl ? (
                        <Thumbnail src={thumbUrl} alt={draft.title} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]" priority={idx < 4} />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#ded8ce] to-[#bbb3a7]">
                          <ImageIcon size={42} className="text-black/15" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/5 to-black/15" aria-hidden="true" />
                      <StatusPill
                        tone={draftTour === "ready" ? "success" : draftTour === "issues" ? "danger" : draftTour === "processing" ? "warning" : draft.is_complete ? "neutral" : "warning"}
                        dot
                        className="absolute left-3 top-3 border-white/25 bg-white/90 text-black shadow-[0_4px_16px_rgba(0,0,0,0.14)]"
                      >
                        {tourStatusLabel
                          ?? (draft.is_complete
                            ? t("dashboard.listingComplete", lang)
                            : t("dashboard.listingDraft", lang))}
                      </StatusPill>
                      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-4 sm:p-5">
                        <div className="min-w-0 flex-1">
                          <h2 className="truncate text-[17px] font-semibold leading-snug tracking-[-0.02em] text-white">{draft.title || t("dashboard.untitled", lang)}</h2>
                          {address && (
                            <p className="mt-1 truncate text-[12px] text-white/70">{address}</p>
                          )}
                        </div>
                        {price && (
                          <div className="shrink-0 rounded-full border border-white/45 bg-white/90 px-3 py-1.5 text-right text-black shadow-sm backdrop-blur-md">
                            <span className="block text-[13px] font-semibold tabular-nums">{price}</span>
                            {showOrigPrice && (
                              <span className="block text-[11px] text-black/55 tabular-nums">{origPrice}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex h-12 items-center justify-between gap-4 border-t border-border/70 bg-card px-4">
                      <p className="flex min-w-0 items-center gap-2 truncate text-[11px] font-medium text-foreground/65">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${draft.is_portfolio_visible ? "bg-emerald-600" : "bg-foreground/20"}`} aria-hidden="true" />
                        <span className="truncate">{draft.is_portfolio_visible ? t("dashboard.portfolioVisible", lang) : t("dashboard.notInPortfolio", lang)}</span>
                      </p>
                      <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-semibold text-foreground/70 transition-colors group-hover:text-foreground">
                        {t("common.open", lang)} <ArrowRightIcon size={14} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                      </span>
                    </div>
                  </Link>

                  <button
                    type="button"
                    onClick={() => router.push(`/draft/${draft.id}/sharing`)}
                    className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/80 shadow-sm backdrop-blur-md transition-[background-color,color,opacity,transform] hover:scale-105 hover:bg-black/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                    aria-label={t("draft.share", lang)}
                  >
                    <ShareIcon size={14} />
                  </button>
                </CollectionCard>
              );
            })}

          </div>
          {hasMore && <div ref={sentinelRef} className="h-px" />}
          {loadingMore && (
            <div className={`grid grid-cols-1 gap-7 pt-7 ${gridCols === 2 ? "md:grid-cols-2" : "mx-auto max-w-2xl"}`}>
              {Array.from({ length: gridCols === 2 ? 2 : 1 }).map((_, i) => (
                <CollectionCard key={i} loading>
                  <div className="aspect-[16/10] bg-muted/45" />
                  <div className="flex h-12 items-center justify-between px-4">
                    <div className="h-3 w-1/3 rounded bg-muted/55" />
                    <div className="h-3 w-14 rounded bg-muted/40" />
                  </div>
                </CollectionCard>
              ))}
            </div>
          )}
          </>
        )}
      </div>

    </AppShell>
  );
}
