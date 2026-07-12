"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../components/hooks/use-auth";
import { AppShell } from "../components/app-shell";
import { Button } from "../lib/ui/button";
import { t, getUserLanguage } from "../lib/i18n";
import { listDrafts, getSplatsByDraft } from "../lib/api/client";
import { ShareDialog } from "../components/share-dialog";
import type { DraftListingItem } from "../lib/tour-types";
import Link from "next/link";
import { Thumbnail } from "../components/thumbnail";

function compactNumber(value: string | number | null | undefined, lang?: string) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat(lang, { maximumFractionDigits: n % 1 === 0 ? 0 : 1 }).format(n);
}

function formatMoney(value: string | number | null | undefined, currency: string | null | undefined, lang: string) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return `${value}${currency ? ` ${currency}` : ""}`;
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
  if (area != null && area !== "") parts.push(`${compactNumber(area, lang)}${areaUnit ? ` ${areaUnit}` : ""}`);
  return parts.join(" · ");
}

export default function DashboardPage() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const router = useRouter();

  const [drafts, setDrafts] = React.useState<DraftListingItem[]>([]);
  const [draftsLoading, setDraftsLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(false);
  const [totalCount, setTotalCount] = React.useState(0);
  const pageRef = React.useRef(1);

  const [splatIds, setSplatIds] = React.useState<Record<number, number>>({});
  const [shareTarget, setShareTarget] = React.useState<{ splatId: number; title: string } | null>(null);
  const [searchInput, setSearchInput] = React.useState("");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [gridCols, setGridCols] = React.useState<1 | 2>(2);

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isLoading, isAuthenticated, router]);

  const loadPage = React.useCallback(async (page: number, append: boolean) => {
    const data = await listDrafts(page, 20, searchQuery);
    const results = data.results ?? [];
    setDrafts((prev) => append ? [...prev, ...results] : results);
    setHasMore(!!data.next);
    setTotalCount(data.count ?? 0);
    pageRef.current = page;

    const map: Record<number, number> = {};
    await Promise.all(
      results.map((d) =>
        getSplatsByDraft(d.id)
          .then((res) => { if (res?.parent_splat_id) map[d.id] = res.parent_splat_id; else if (res?.splats?.[0]) map[d.id] = res.splats[0].splat_id; })
          .catch(() => {})
      )
    );
    setSplatIds((prev) => ({ ...prev, ...map }));
  }, [searchQuery]);

  React.useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  React.useEffect(() => {
    if (!isAuthenticated) return;
    setDraftsLoading(true);
    loadPage(1, false).catch(() => {}).finally(() => setDraftsLoading(false));
  }, [searchQuery, isAuthenticated, loadPage]);

  const handleLoadMore = React.useCallback(async () => {
    setLoadingMore(true);
    try { await loadPage(pageRef.current + 1, true); } catch {}
    setLoadingMore(false);
  }, [loadPage]);

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-7 w-7 border-2 border-foreground/15 border-t-foreground/60 rounded-full" />
      </div>
    );
  }

  const lang = getUserLanguage(user.localization);

  return (
    <AppShell user={user} onLogout={logout}>
      <div className="w-full animate-fade-in">
        {/* Search bar */}
        <div className="mb-5 flex items-center gap-3">
          <label className="relative block flex-1 min-w-0">
            <span className="sr-only">{t("dashboard.searchPlaceholder", lang)}</span>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t("dashboard.searchPlaceholder", lang)}
              className="h-9 w-full border-0 border-b border-border/30 bg-transparent pl-6 pr-8 text-[13px] outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-foreground/40"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => { setSearchInput(""); setSearchQuery(""); }}
                className="absolute right-0 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label={t("dashboard.clearSearch", lang)}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4.5 4.5L11.5 11.5M11.5 4.5L4.5 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
            )}
          </label>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[12px] text-muted-foreground tabular-nums">
              {drafts.length}{totalCount > 0 ? ` / ${totalCount}` : ""}
            </span>
            <div className="hidden md:flex items-center gap-0.5 rounded-md bg-foreground/[0.04] p-0.5">
              <button
                type="button"
                onClick={() => setGridCols(1)}
                className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${gridCols === 1 ? "bg-background text-foreground shadow-sm" : "text-foreground/35 hover:text-foreground/60"}`}
                aria-label="Single column"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="2" y="9" width="12" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg>
              </button>
              <button
                type="button"
                onClick={() => setGridCols(2)}
                className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${gridCols === 2 ? "bg-background text-foreground shadow-sm" : "text-foreground/35 hover:text-foreground/60"}`}
                aria-label="Two columns"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg>
              </button>
            </div>
          </div>
        </div>

        {/* Cards */}
        {draftsLoading ? (
          <div className={`grid grid-cols-1 gap-6 ${gridCols === 2 ? "md:grid-cols-2" : "mx-auto max-w-2xl"}`}>
            {Array.from({ length: gridCols === 2 ? 4 : 3 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-[16/10] rounded-xl bg-muted/30" />
                <div className="mt-3 space-y-2 px-1">
                  <div className="h-4 w-2/3 rounded bg-muted/40" />
                  <div className="h-3 w-1/2 rounded bg-muted/30" />
                </div>
              </div>
            ))}
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
              const price = formatMoney(draft.price_preferred ?? draft.price, draft.price_preferred_currency ?? draft.currency, lang);
              const facts = factsLine(draft, lang);
              const address = draft.display_address || [draft.city, draft.state, draft.country].filter(Boolean).join(", ");
              const thumbUrl = getDraftThumbnail(draft);
              const draftSplatId = splatIds[draft.id];

              return (
                <Link key={draft.id} href={`/draft/${draft.id}`} className="group block">
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
                        3D
                      </div>
                    )}
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
                        <span className="text-[15px] font-semibold tabular-nums shrink-0">{price}</span>
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
          {hasMore && (
            <div className="flex justify-center pt-4 pb-4">
              <Button variant="ghost" size="sm" className="text-[12px] text-foreground/45" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore ? (
                  <div className="animate-spin h-4 w-4 border-2 border-foreground/15 border-t-foreground/60 rounded-full" />
                ) : (
                  t("dashboard.loadMore", lang)
                )}
              </Button>
            </div>
          )}
          </>
        )}
      </div>

      {shareTarget && (
        <ShareDialog splatId={shareTarget.splatId} title={shareTarget.title} open={!!shareTarget} onClose={() => setShareTarget(null)} lang={lang} />
      )}
    </AppShell>
  );
}
