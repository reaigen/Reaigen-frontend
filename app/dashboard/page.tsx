"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../components/hooks/use-auth";
import { AppShell } from "../components/app-shell";
import { Button } from "../lib/ui/button";
import { t, getUserLanguage } from "../lib/i18n";
import { listAllDrafts, listSplats } from "../lib/api/client";
import { ShareDialog } from "../components/share-dialog";
import type { DraftListingItem, SplatListItem } from "../lib/tour-types";
import Link from "next/link";

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function compactNumber(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: n % 1 === 0 ? 0 : 1 }).format(n);
}

function formatMoney(value: string | number | null | undefined, currency: string | null | undefined) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return `${value}${currency ? ` ${currency}` : ""}`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "EUR",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${compactNumber(n)}${currency ? ` ${currency}` : ""}`;
  }
}

function listingFacts(draft: DraftListingItem | undefined) {
  if (!draft) return [];
  const layout = draft.specs?.layout ?? {};
  const facts: string[] = [];
  if (layout.bedrooms != null && layout.bedrooms !== "") facts.push(`${layout.bedrooms} bd`);
  if (layout.bathrooms != null && layout.bathrooms !== "") facts.push(`${layout.bathrooms} ba`);
  const area = draft.area_preferred ?? draft.area;
  const areaUnit = draft.area_preferred_unit ?? draft.area_unit_display;
  if (area != null && area !== "") facts.push(`${compactNumber(area)}${areaUnit ? ` ${areaUnit}` : ""}`);
  return facts;
}

export default function DashboardPage() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const router = useRouter();
  const [splats, setSplats] = React.useState<SplatListItem[]>([]);
  const [draftsById, setDraftsById] = React.useState<Map<number, DraftListingItem>>(new Map());
  const [splatsLoading, setSplatsLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(false);
  const [totalCount, setTotalCount] = React.useState(0);
  const pageRef = React.useRef(1);
  const [shareTarget, setShareTarget] = React.useState<{ splatId: number; title: string } | null>(null);
  const [searchInput, setSearchInput] = React.useState("");
  const [searchQuery, setSearchQuery] = React.useState("");

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isLoading, isAuthenticated, router]);

  const loadPage = React.useCallback(async (page: number, append: boolean) => {
    const data = await listSplats(page, 20, searchQuery);
    const results = data.results ?? [];
    setSplats((prev) => {
      const merged = append ? [...prev, ...results] : results;
      const seenId = new Set<number>();
      const seenDraft = new Set<number>();
      return merged.filter((s) => {
        if (seenId.has(s.id)) return false;
        seenId.add(s.id);
        if (s.source_draft && seenDraft.has(s.source_draft)) return false;
        if (s.source_draft) seenDraft.add(s.source_draft);
        return true;
      });
    });
    setHasMore(!!data.next);
    setTotalCount(data.count ?? 0);
    pageRef.current = page;
  }, [searchQuery]);

  React.useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  React.useEffect(() => {
    if (!isAuthenticated) return;
    setSplatsLoading(true);
    loadPage(1, false).catch(() => {}).finally(() => setSplatsLoading(false));
  }, [searchQuery, isAuthenticated, loadPage]);

  React.useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    listAllDrafts()
      .then((drafts) => {
        if (cancelled) return;
        setDraftsById(new Map(drafts.map((draft) => [draft.id, draft])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const handleLoadMore = React.useCallback(async () => {
    setLoadingMore(true);
    try { await loadPage(pageRef.current + 1, true); } catch {}
    setLoadingMore(false);
  }, [loadPage]);

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-foreground/20 border-t-foreground rounded-full" />
      </div>
    );
  }

  const lang = getUserLanguage(user.localization);
  const visibleSplats = searchQuery
    ? splats.filter((splat) => {
        const draft = draftsById.get(splat.source_draft);
        const haystack = [
          splat.title,
          draft?.title,
          draft?.display_address,
          draft?.city,
          draft?.state,
          draft?.country,
          draft?.postal_code,
        ].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(searchQuery.toLowerCase());
      })
    : splats;

  return (
    <AppShell user={user} onLogout={logout}>
      <div className="mx-auto max-w-5xl animate-fade-in space-y-6">
        {/* Greeting */}
        <div className="border-b border-border/70 pb-5">
          <h1 className="text-[22px] sm:text-2xl font-bold tracking-tight">
            {t("dashboard.title", lang)}
          </h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            {t("dashboard.welcome", lang)}, {user.first_name || user.email}.
          </p>
        </div>

        {/* Tours header */}
        <section className="space-y-4">
          <div className="mb-3">
            <h2 className="text-[16px] sm:text-lg font-semibold tracking-tight">
              {t("dashboard.virtualTours", lang)}
            </h2>
          </div>

          <div className="mb-3 flex flex-col gap-2 border-y border-border/70 py-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block w-full sm:max-w-sm">
              <span className="sr-only">{t("dashboard.searchPlaceholder", lang)}</span>
              <svg
                width="15"
                height="15"
                viewBox="0 0 16 16"
                fill="none"
                className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              >
                <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t("dashboard.searchPlaceholder", lang)}
                className="h-9 w-full border-0 border-b border-transparent bg-transparent pl-6 pr-8 text-[13px] outline-none placeholder:text-muted-foreground/60 focus:border-foreground/35"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput("");
                    setSearchQuery("");
                  }}
                  className="absolute right-0 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M4.5 4.5L11.5 11.5M11.5 4.5L4.5 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </label>
            <p className="text-[12px] text-muted-foreground tabular-nums">
              {visibleSplats.length}{totalCount > 0 ? ` / ${totalCount}` : ""} tours
            </p>
          </div>

          {splatsLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin h-6 w-6 border-2 border-foreground/20 border-t-foreground rounded-full" />
            </div>
          ) : visibleSplats.length === 0 ? (
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
            <div className="grid grid-cols-2 gap-x-4 gap-y-6">
            {visibleSplats.map((splat) => {
              const isReady = splat.status === "completed" && (splat.has_ply || splat.has_splat || splat.has_sog);
              const draft = draftsById.get(splat.source_draft);
              const price = draft ? formatMoney(draft.price_preferred ?? draft.price, draft.price_preferred_currency ?? draft.currency) : null;
              const facts = listingFacts(draft);
              const address = draft?.display_address || [draft?.city, draft?.state, draft?.country].filter(Boolean).join(", ");
              return (
                <div key={splat.id} className="min-w-0">
                  {/* Thumbnail */}
                  <div className="aspect-[16/10] bg-muted/30 relative overflow-hidden rounded-md border border-border/70">
                    {splat.thumbnail_url ? (
                      <img src={splat.thumbnail_url} alt={splat.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-foreground/10">
                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" stroke="currentColor" strokeWidth="1.5" />
                          <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" stroke="currentColor" strokeWidth="1.5" />
                        </svg>
                      </div>
                    )}
                    <span className="absolute top-2 right-2 text-[10px] font-medium px-1.5 py-0.5 rounded-lg bg-background/90 text-foreground/70">
                      {statusLabel(splat.status)}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="pt-2.5">
                    <p className="text-[13px] font-medium truncate">{splat.title}</p>
                    {address ? (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{address}</p>
                    ) : (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{new Date(splat.created_at).toLocaleDateString()}</p>
                    )}
                    {(price || facts.length > 0) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-foreground/70">
                        {price && <span className="font-medium text-foreground/80">{price}</span>}
                        {facts.map((fact) => (
                          <span key={fact}>{fact}</span>
                        ))}
                      </div>
                    )}
                    {draft && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded-full bg-foreground/[0.05] px-2 py-0.5 text-[10px] font-medium text-foreground/55">
                          {draft.is_complete ? "Listing complete" : "Listing draft"}
                        </span>
                        <span className="rounded-full bg-foreground/[0.05] px-2 py-0.5 text-[10px] font-medium text-foreground/55">
                          {draft.is_portfolio_visible ? "Portfolio visible" : "Not in portfolio"}
                        </span>
                      </div>
                    )}

                    {isReady && (
                      <div className="mt-2 flex flex-col gap-1.5 sm:flex-row">
                        <Button
                          variant="ghost" size="sm"
                          className="h-8 flex-1 justify-start px-0 text-[11px] text-foreground/50 hover:bg-transparent hover:text-foreground sm:justify-center sm:px-3"
                          onClick={() => setShareTarget({ splatId: splat.id, title: splat.title })}
                        >
                          {t("dashboard.share", lang)}
                        </Button>
                        <Link href={`/tour/${splat.id}`} className="sm:flex-1">
                          <Button variant="ghost" size="sm" className="h-8 w-full justify-start px-0 text-[11px] text-foreground/50 hover:bg-transparent hover:text-foreground sm:justify-center sm:px-3">
                            {t("dashboard.viewTour", lang)}
                          </Button>
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

              {hasMore && (
                <div className="col-span-full flex justify-center pt-3">
                  <Button variant="ghost" size="sm" className="text-[12px] text-foreground/45" onClick={handleLoadMore} loading={loadingMore}>
                    {t("dashboard.loadMore", lang)}
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {shareTarget && (
        <ShareDialog splatId={shareTarget.splatId} title={shareTarget.title} open={!!shareTarget} onClose={() => setShareTarget(null)} />
      )}
    </AppShell>
  );
}
