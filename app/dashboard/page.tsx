"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../components/hooks/use-auth";
import { AppShell } from "../components/app-shell";
import { t, getUserLanguage } from "../lib/i18n";
import type { LocaleKey } from "../lib/locales";
import { listAllSplats, listDrafts } from "../lib/api/client";
import type { DraftListingItem } from "../lib/tour-types";
import Link from "next/link";
import { Thumbnail } from "../components/thumbnail";
import { PageLoading } from "../components/page-loading";
import { PageHeader } from "../components/page-header";
import { StatusPill } from "../components/status-pill";
import { SearchField } from "../components/search-field";
import { GridLayoutToggle } from "../components/grid-layout-toggle";

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

/** Build a "3 Bed · 2 Bath · 120 m²" string */
function factsLine(draft: DraftListingItem, lang: string): string {
  const layout = draft.specs?.layout ?? {};
  const parts: string[] = [];
  if (layout.bedrooms != null && layout.bedrooms !== "") parts.push(`${layout.bedrooms} ${t("dashboard.bedroomsShort", lang)}`);
  if (layout.bathrooms != null && layout.bathrooms !== "") parts.push(`${layout.bathrooms} ${t("dashboard.bathroomsShort", lang)}`);
  const area = draft.area_preferred ?? draft.area;
  const areaUnit = draft.area_preferred_unit ?? draft.area_unit_display;
  if (area != null && area !== "") {
    let areaStr = `${compactNumber(area, lang)}${areaUnit ? ` ${areaUnit}` : ""}`;
    // Show original in parentheses if different unit
    if (draft.area_preferred && draft.area && draft.area_preferred_unit !== draft.area_unit_display && draft.area_unit_display) {
      areaStr += ` (${compactNumber(draft.area, lang)} ${draft.area_unit_display})`;
    }
    parts.push(areaStr);
  }
  return parts.join(" · ");
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

  const [splatIds, setSplatIds] = React.useState<Record<number, number>>({});
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
      const map: Record<number, number> = {};
      for (const splat of splats) {
        if (!map[splat.source_draft]) map[splat.source_draft] = splat.id;
      }
      setSplatIds(map);
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

  // Show back-to-top button after scrolling down
  const [showBackToTop, setShowBackToTop] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (isLoading || !user) {
    return <PageLoading />;
  }

  const lang = getUserLanguage(user.localization);

  return (
    <AppShell user={user} onLogout={logout}>
      <div className="mx-auto w-full max-w-[1180px]">
        <PageHeader
          title={t("dashboard.creationsTitle", lang)}
          description={t("dashboard.creationsSubtitle", lang)}
          actions={totalCount > 0 ? <StatusPill>{totalCount} {t("dashboard.items", lang)}</StatusPill> : undefined}
          className="mb-4 sm:mb-7"
        />
        {/* Search bar */}
        <div className="mb-4 flex items-center gap-3 border-b border-border/40 pb-3 sm:mb-6">
          <SearchField
            value={searchInput}
            onChange={setSearchInput}
            onClear={() => setSearchQuery("")}
            placeholder={t("dashboard.searchPlaceholder", lang)}
            clearLabel={t("dashboard.clearSearch", lang)}
            className="flex-1"
          />
          <GridLayoutToggle value={gridCols} onChange={handleGridCols} lang={lang} />
        </div>

        {/* Cards */}
        {draftsLoading ? (
          <div className={`grid grid-cols-1 gap-6 ${gridCols === 2 ? "md:grid-cols-2" : "mx-auto max-w-2xl"}`}>
            {Array.from({ length: gridCols === 2 ? 4 : 3 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-[16/10] rounded-xl bg-muted/30" />
                <div className="mt-2.5 px-0.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-4 w-2/3 rounded bg-muted/40" />
                      <div className="h-3 w-1/2 rounded bg-muted/30" />
                    </div>
                    <div className="h-4 w-16 shrink-0 rounded bg-muted/40" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : draftsError ? (
          <div role="alert" className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-[14px] font-medium text-foreground/60">{t("dashboard.loadFailed", lang)}</p>
            <button
              type="button"
              onClick={() => setReloadNonce((value) => value + 1)}
              className="mt-4 inline-flex h-8 items-center rounded-full border border-border/70 bg-surface px-3.5 text-[13px] font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {t("common.tryAgain", lang)}
            </button>
          </div>
        ) : drafts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-foreground/[0.04]">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-foreground/25" aria-hidden="true">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-[14px] font-medium text-foreground/60">{t("dashboard.noSplatsTitle", lang)}</p>
            <p className="mt-1 max-w-[260px] text-[12px] leading-relaxed text-muted-foreground">{t("dashboard.noSplats", lang)}</p>
          </div>
        ) : (
          <>
          <div className={`grid grid-cols-1 gap-6 ${gridCols === 2 ? "md:grid-cols-2" : "mx-auto max-w-2xl"}`}>
            {drafts.map((draft, idx) => {
              const prefPrice = formatMoney(draft.price_preferred, draft.price_preferred_currency, lang);
              const origPrice = formatMoney(draft.price, draft.currency, lang);
              const price = prefPrice || origPrice;
              const showOrigPrice = prefPrice && origPrice && draft.price_preferred_currency !== draft.currency;
              const facts = factsLine(draft, lang);
              const address = draft.display_address || [draft.city, draft.state, draft.country].filter(Boolean).join(", ");
              const thumbUrl = getDraftThumbnail(draft);
              const draftSplatId = splatIds[draft.id];

              return (
                <Link
                  key={draft.id}
                  href={`/draft/${draft.id}`}
                  className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onMouseEnter={() => router.prefetch(`/draft/${draft.id}`)}
                >
                  {/* Image */}
                  <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-muted/20 transition-shadow group-hover:shadow-lg">
                    {thumbUrl ? (
                      <Thumbnail src={thumbUrl} alt={draft.title} className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" priority={idx < 4} />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-foreground/8">
                          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
                          <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                          <path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    )}
                    {/* 3D Tour badge */}
                    {draftSplatId && (
                      <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/50 backdrop-blur-sm px-2.5 py-1 text-[11px] font-medium text-white">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                        {t("dashboard.tourReady", lang)}
                      </div>
                    )}
                    {!draftSplatId && !draft.is_complete && (
                      <div className="absolute left-3 top-3 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
                        {t("dashboard.listingDraft", lang)}
                      </div>
                    )}
                    {/* Share button */}
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/draft/${draft.id}/sharing`); }}
                      className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white/75 opacity-100 backdrop-blur-sm transition-all hover:bg-black/65 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                      aria-label={t("draft.share", lang)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>
                    </button>
                  </div>

                  {/* Property info */}
                  <div className="mt-2.5 px-0.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h2 className="text-[15px] font-semibold leading-snug truncate">{draft.title || t("dashboard.untitled", lang)}</h2>
                        {address && (
                          <p className="mt-0.5 text-[13px] text-muted-foreground truncate">{address}</p>
                        )}
                      </div>
                      {price && (
                        <div className="text-right shrink-0">
                          <span className="text-[15px] font-semibold tabular-nums">{price}</span>
                          {showOrigPrice && (
                            <p className="text-[11px] text-muted-foreground tabular-nums">{origPrice}</p>
                          )}
                        </div>
                      )}
                    </div>
                    {facts && (
                      <p className="mt-1 text-[13px] text-foreground/50">{facts}</p>
                    )}
                  </div>
                </Link>
              );
            })}

          </div>
          {hasMore && <div ref={sentinelRef} className="h-px" />}
          {loadingMore && (
            <div className={`grid grid-cols-1 gap-6 pt-6 ${gridCols === 2 ? "md:grid-cols-2" : "mx-auto max-w-2xl"}`}>
              {Array.from({ length: gridCols === 2 ? 2 : 1 }).map((_, i) => (
                <div key={i} className="animate-pulse">
                  <div className="aspect-[16/10] rounded-xl bg-muted/30" />
                  <div className="mt-2.5 px-0.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="h-4 w-2/3 rounded bg-muted/40" />
                        <div className="h-3 w-1/2 rounded bg-muted/30" />
                      </div>
                      <div className="h-4 w-16 shrink-0 rounded bg-muted/40" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          </>
        )}
      </div>

      {/* Back to top */}
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className={`fixed bottom-6 right-6 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-foreground/80 text-background shadow-lg backdrop-blur-sm transition-opacity hover:bg-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${showBackToTop ? "opacity-100" : "pointer-events-none opacity-0"}`}
        aria-label={t("dashboard.backToTop", lang)}
        aria-hidden={!showBackToTop}
        tabIndex={showBackToTop ? 0 : -1}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 13V3M4 7l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </AppShell>
  );
}
