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

// ── Fact icons ──
const FactIcon = {
  bed: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>,
  bath: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><path d="M4 12h16a1 1 0 0 1 1 1v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-3a1 1 0 0 1 1-1Z"/><path d="M6 12V5a2 2 0 0 1 2-2h3v2.25"/></svg>,
  area: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18"/><path d="M9 3v18"/></svg>,
} as Record<string, React.ReactNode>;

function listingFacts(draft: DraftListingItem, lang: string) {
  const layout = draft.specs?.layout ?? {};
  const facts: { icon: string; text: string }[] = [];
  if (layout.bedrooms != null && layout.bedrooms !== "") facts.push({ icon: "bed", text: `${layout.bedrooms} ${t("dashboard.bedroomsShort", lang)}` });
  if (layout.bathrooms != null && layout.bathrooms !== "") facts.push({ icon: "bath", text: `${layout.bathrooms} ${t("dashboard.bathroomsShort", lang)}` });
  const area = draft.area_preferred ?? draft.area;
  const areaUnit = draft.area_preferred_unit ?? draft.area_unit_display;
  if (area != null && area !== "") facts.push({ icon: "area", text: `${compactNumber(area, lang)}${areaUnit ? ` ${areaUnit}` : ""}` });
  return facts;
}

export default function DashboardPage() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const router = useRouter();

  // Drafts = paginated primary listing
  const [drafts, setDrafts] = React.useState<DraftListingItem[]>([]);
  const [draftsLoading, setDraftsLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(false);
  const [totalCount, setTotalCount] = React.useState(0);
  const pageRef = React.useRef(1);

  // Splat IDs per draft (for share/tour buttons)
  const [splatIds, setSplatIds] = React.useState<Record<number, number>>({});

  const [shareTarget, setShareTarget] = React.useState<{ splatId: number; title: string } | null>(null);
  const [searchInput, setSearchInput] = React.useState("");
  const [searchQuery, setSearchQuery] = React.useState("");

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isLoading, isAuthenticated, router]);

  // Paginated draft loading with server-side search
  const loadPage = React.useCallback(async (page: number, append: boolean) => {
    const data = await listDrafts(page, 20, searchQuery);
    const results = data.results ?? [];
    setDrafts((prev) => append ? [...prev, ...results] : results);
    setHasMore(!!data.next);
    setTotalCount(data.count ?? 0);
    pageRef.current = page;

    // Resolve splat IDs for new drafts (for share/tour buttons)
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

  // Debounce search input → server query
  React.useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Fetch drafts when search query or auth changes
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
      <div className="mx-auto w-full max-w-xl animate-fade-in">
        {/* Search bar */}
        <div className="mb-4 flex items-center gap-3 border-b border-border/70 pb-3">
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
              className="h-9 w-full border-0 border-b border-transparent bg-transparent pl-6 pr-8 text-[13px] outline-none placeholder:text-muted-foreground/60 focus:border-foreground/35"
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
          <span className="text-[12px] text-muted-foreground tabular-nums shrink-0">
            {drafts.length}{totalCount > 0 ? ` / ${totalCount}` : ""}
          </span>
        </div>

        {/* Cards */}
        {draftsLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-xl overflow-hidden border border-border/40">
                <div className="aspect-[16/10] bg-muted/30" />
                <div className="px-3.5 py-2.5 flex gap-3">
                  <div className="h-3 w-16 rounded bg-muted/40" />
                  <div className="h-3 w-12 rounded bg-muted/30" />
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
          <div className="space-y-4">
            {drafts.map((draft, idx) => {
              const price = formatMoney(draft.price_preferred ?? draft.price, draft.price_preferred_currency ?? draft.currency, lang);
              const facts = listingFacts(draft, lang);
              const address = draft.display_address || [draft.city, draft.state, draft.country].filter(Boolean).join(", ");
              const thumbUrl = getDraftThumbnail(draft);
              const draftSplatId = splatIds[draft.id];

              return (
                <div key={draft.id} className="overflow-hidden rounded-xl border border-border/60 transition-shadow hover:shadow-lg">
                  {/* Hero image with overlay */}
                  <Link href={`/draft/${draft.id}`} className="block">
                    <div className="relative aspect-[16/10] bg-muted/20">
                      {thumbUrl ? (
                        <Thumbnail src={thumbUrl} alt={draft.title} className="absolute inset-0 w-full h-full object-cover" priority={idx < 4} />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-foreground/8">
                            <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
                            <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                            <path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/60 via-black/25 to-transparent" />
                      <div className="absolute inset-x-0 bottom-0 p-3.5">
                        <h2 className="text-[15px] font-semibold text-white leading-tight truncate">{draft.title}</h2>
                        {address && (
                          <p className="mt-0.5 flex items-center gap-1 text-[12px] text-white/75 truncate">
                            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="flex-shrink-0"><path d="M8 1.5a4.5 4.5 0 0 1 4.5 4.5c0 3.5-4.5 8.5-4.5 8.5S3.5 9.5 3.5 6A4.5 4.5 0 0 1 8 1.5Z" stroke="currentColor" strokeWidth="1.2"/><circle cx="8" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.2"/></svg>
                            {address}
                          </p>
                        )}
                      </div>
                      {price && (
                        <div className="absolute top-3 right-3 rounded-full bg-white/90 backdrop-blur-sm px-2.5 py-1 text-[12px] font-semibold text-foreground shadow-sm">
                          {price}
                        </div>
                      )}
                    </div>
                  </Link>

                  {/* Facts footer + actions */}
                  <div className="flex items-center justify-between px-3.5 py-2 bg-background">
                    {facts.length > 0 ? (
                      <div className="flex items-center gap-3 min-w-0">
                        {facts.map((f) => (
                          <span key={f.text} className="inline-flex items-center gap-1.5 text-[12px] text-foreground/60">
                            {FactIcon[f.icon]} {f.text}
                          </span>
                        ))}
                      </div>
                    ) : <div />}

                    {draftSplatId && (
                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        <button
                          onClick={() => setShareTarget({ splatId: draftSplatId, title: draft.title })}
                          className="p-1.5 rounded-md text-foreground/40 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                          aria-label={t("dashboard.share", lang)}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>
                        </button>
                        <Link href={`/tour/${draftSplatId}`} className="p-1.5 rounded-md text-foreground/40 hover:text-foreground hover:bg-foreground/[0.04] transition-colors" aria-label={t("dashboard.viewTour", lang)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {hasMore && (
              <div className="flex justify-center pt-2 pb-4">
                <Button variant="ghost" size="sm" className="text-[12px] text-foreground/45" onClick={handleLoadMore} disabled={loadingMore}>
                  {loadingMore ? (
                    <div className="animate-spin h-4 w-4 border-2 border-foreground/15 border-t-foreground/60 rounded-full" />
                  ) : (
                    t("dashboard.loadMore", lang)
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {shareTarget && (
        <ShareDialog splatId={shareTarget.splatId} title={shareTarget.title} open={!!shareTarget} onClose={() => setShareTarget(null)} lang={lang} />
      )}
    </AppShell>
  );
}
