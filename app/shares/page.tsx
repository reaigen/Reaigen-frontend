"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../components/hooks/use-auth";
import { AppShell } from "../components/app-shell";
import { Button } from "../lib/ui/button";
import { t, getUserLanguage, formatDate } from "../lib/i18n";
import {
  listShares,
  listAllDrafts,
  listAllSplats,
  pauseShare,
  resumeShare,
  revokeShare,
  getShareAnalytics,
} from "../lib/api/client";
import type { DraftListingItem, ShareData } from "../lib/tour-types";
import {
  copyToClipboard,
  shareUrl,
  fieldSummaryLabel,
  expiryLabel,
  STATUS_CONFIG,
  type ShareStats,
} from "../lib/share-ui";
import { PageLoading } from "../components/page-loading";
import { PageHeader } from "../components/page-header";
import { SidePanel } from "../components/side-panel";
import { SearchField } from "../components/search-field";
import { LinkIcon, SearchIcon } from "../components/icons";
import { Thumbnail } from "../components/thumbnail";

function draftThumbnail(draft: DraftListingItem): string | null {
  return (draft.raw_uploads ?? [])
    .filter((upload) => upload.mime_type?.startsWith("image") || upload.asset_type === "photo")
    .sort((a, b) => a.sort_order - b.sort_order)[0]?.file_url ?? null;
}

/* ── Share Row ────────────────────────────────────────────────────────── */

function ShareRow({
  share,
  tourName,
  tourLink,
  lang,
  dateFormat,
  onUpdate,
  onEdit,
}: {
  share: ShareData;
  tourName: string;
  tourLink: string | null;
  lang: string;
  dateFormat?: string | null;
  onUpdate: (updated: ShareData | null) => void;
  onEdit: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const [actionLoading, setActionLoading] = React.useState(false);
  const [confirmRevoke, setConfirmRevoke] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [stats, setStats] = React.useState<ShareStats | null>(null);
  const [statsLoading, setStatsLoading] = React.useState(false);
  const [actionError, setActionError] = React.useState(false);

  const isActive = share.status === "active";
  const isPaused = share.status === "paused";
  const isLive = isActive || isPaused;
  const cfg = STATUS_CONFIG[share.status] ?? STATUS_CONFIG.revoked;
  const expiry = expiryLabel(share.expires_at, lang);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await copyToClipboard(shareUrl(share.token))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleToggleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !stats && !statsLoading) {
      setStatsLoading(true);
      getShareAnalytics(share.id).then((a) => setStats(a.stats)).catch(() => setActionError(true)).finally(() => setStatsLoading(false));
    }
  };

  const handlePause = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setActionError(false);
    setActionLoading(true);
    try { const r = await pauseShare(share.id); onUpdate(r.share); } catch { setActionError(true); }
    setActionLoading(false);
  };

  const handleResume = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setActionError(false);
    setActionLoading(true);
    try { const r = await resumeShare(share.id); onUpdate(r.share); } catch { setActionError(true); }
    setActionLoading(false);
  };

  const handleRevoke = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setActionError(false);
    setActionLoading(true);
    try { await revokeShare(share.id); onUpdate(null); } catch { setActionError(true); }
    setActionLoading(false);
  };

  return (
    <div className={`rounded-xl border transition-colors ${isLive ? "border-border/60 bg-background hover:border-border" : "border-border/40 bg-muted/20"}`}>
      {/* Main row — always visible */}
      <div className="w-full px-4 py-3.5 flex items-center gap-3">
        <button type="button" onClick={handleToggleExpand} aria-expanded={expanded} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          {/* Status dot */}
          <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />

          {/* Title + meta */}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className={`text-[13px] font-semibold truncate ${isLive ? "" : "text-foreground/50"}`}>{tourName}</span>
              {share.requires_pin && (
                <span className="shrink-0 inline-flex items-center gap-0.5 rounded bg-foreground/[0.07] px-1.5 py-px text-[11px] font-medium text-foreground/60 uppercase tracking-wider">
                  <svg aria-hidden="true" width="8" height="8" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.5" /></svg>
                  PIN
                </span>
              )}
              {expiry && <span className="shrink-0 rounded bg-foreground/[0.07] px-1.5 py-px text-[11px] font-medium text-foreground/50">{expiry}</span>}
            </span>
            <span className="mt-0.5 flex items-center gap-2 text-[11px] text-foreground/60">
              <span className="tabular-nums">{share.access_count} {share.access_count === 1 ? t("shares.viewSingular", lang) : t("shares.viewPlural", lang)}</span>
              <span className="text-foreground/35">·</span>
              <span>{fieldSummaryLabel(share, lang)}</span>
              <span className="text-foreground/35">·</span>
              <span>{formatDate(share.created_at, dateFormat, lang)}</span>
            </span>
          </span>

          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cfg.bg} ${cfg.text}`}>
            {t(cfg.labelKey, lang)}
          </span>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" className={`shrink-0 text-foreground/35 transition-transform ${expanded ? "rotate-180" : ""}`}>
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Copy button (live only) */}
        {isLive && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={handleCopy}
            className={`shrink-0 gap-1 text-[11px] [&_svg]:size-3 ${copied ? "border-foreground bg-foreground text-background hover:bg-foreground hover:text-background" : "text-foreground/70 hover:text-foreground"}`}
          >
            {copied ? (
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            ) : (
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" /><path d="M10.5 5.5V3.5C10.5 2.67 9.83 2 9 2H3.5C2.67 2 2 2.67 2 3.5V9C2 9.83 2.67 10.5 3.5 10.5H5.5" stroke="currentColor" strokeWidth="1.5" /></svg>
            )}
            {copied ? t("shares.copied", lang) : t("shares.copyLink", lang)}
          </Button>
        )}

      </div>

      {/* Expanded detail panel */}
      <div className="grid transition-[grid-template-rows] duration-200 ease-out" style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}>
        <div className="overflow-hidden">
          <div className={`border-t border-border/40 px-4 py-3.5 space-y-3 ${expanded ? "" : "invisible"}`}>
          {/* URL row */}
          {isLive && (
            <div className="flex items-center gap-2 rounded-xl bg-foreground/[0.03] px-3 py-2">
              <p className="flex-1 text-[11px] font-mono text-foreground/70 truncate select-all">{shareUrl(share.token)}</p>
            </div>
          )}

          {/* Analytics grid */}
          <div className={`grid gap-2 ${share.requires_pin ? "grid-cols-4" : "grid-cols-3"}`}>
            {statsLoading ? (
              <div className="col-span-full flex items-center justify-center py-3">
                <div className="animate-spin h-4 w-4 border-2 border-foreground/10 border-t-foreground/50 rounded-full" />
              </div>
            ) : stats ? (
              <>
                <div className="rounded-xl bg-foreground/[0.03] px-3 py-2.5 text-center">
                  <p className="text-[17px] font-semibold tabular-nums leading-tight">{stats.total_accesses}</p>
                  <p className="text-[11px] text-foreground/50 mt-0.5">{t("shareDialog.analytics.totalViews", lang)}</p>
                </div>
                <div className="rounded-xl bg-foreground/[0.03] px-3 py-2.5 text-center">
                  <p className="text-[17px] font-semibold tabular-nums leading-tight">{stats.unique_ips}</p>
                  <p className="text-[11px] text-foreground/50 mt-0.5">{t("shareDialog.analytics.uniqueVisitors", lang)}</p>
                </div>
                <div className="rounded-xl bg-foreground/[0.03] px-3 py-2.5 text-center">
                  <p className="text-[17px] font-semibold tabular-nums leading-tight">{stats.authenticated_accesses}</p>
                  <p className="text-[11px] text-foreground/50 mt-0.5">{t("shareDialog.analytics.authenticated", lang)}</p>
                </div>
                {share.requires_pin && (
                  <div className="rounded-xl bg-foreground/[0.03] px-3 py-2.5 text-center">
                    <p className="text-[17px] font-semibold tabular-nums leading-tight">{stats.failed_pin_attempts}</p>
                    <p className="text-[11px] text-foreground/50 mt-0.5">{t("shareDialog.analytics.failedPins", lang)}</p>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="rounded-xl bg-foreground/[0.03] px-3 py-2.5 text-center">
                  <p className="text-[17px] font-semibold tabular-nums leading-tight">{share.access_count}</p>
                  <p className="text-[11px] text-foreground/50 mt-0.5">{t("shareDialog.analytics.totalViews", lang)}</p>
                </div>
              </>
            )}
          </div>

          {/* Detail row: field permissions, limits, link to draft */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-foreground/60">
            <span>{fieldSummaryLabel(share, lang)}</span>
            {share.max_access_count && <span>{t("shares.viewLimit", lang)}: {share.max_access_count}</span>}
            {share.expires_at && (
              <span>
                <svg aria-hidden="true" width="10" height="10" viewBox="0 0 16 16" fill="none" className="inline mr-0.5 -mt-px"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" /><path d="M8 5v3.5l2.5 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                {formatDate(share.expires_at, dateFormat, lang)}
              </span>
            )}
            {tourLink && (
              <Link href={tourLink} className="text-foreground/60 hover:text-foreground hover:underline" onClick={(e) => e.stopPropagation()}>
                {t("shares.view", lang)} →
              </Link>
            )}
          </div>

          {/* Actions bar */}
          {actionError && <p role="alert" className="text-[11px] text-destructive">{t("common.requestFailed", lang)}</p>}
          {isLive && (
            <div className="flex items-center gap-2 pt-2 border-t border-border/40">
              <Button type="button" variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onEdit(); }}
                className="h-8 rounded-lg px-3.5 text-[12px] text-foreground/80 hover:text-foreground">
                {t("shares.editSettings", lang)}
              </Button>
              {isActive && (
                <Button type="button" variant="outline" size="sm" onClick={handlePause} disabled={actionLoading}
                  className="h-8 rounded-lg px-3.5 text-[12px] text-foreground/60 hover:text-foreground">
                  {t("shares.pause", lang)}
                </Button>
              )}
              {isPaused && (
                <Button type="button" variant="outline" size="sm" onClick={handleResume} disabled={actionLoading}
                  className="h-8 rounded-lg px-3.5 text-[12px] text-foreground/70 hover:text-foreground">
                  {t("shares.resume", lang)}
                </Button>
              )}
              <div className="flex-1" />
              {!confirmRevoke ? (
                <Button type="button" variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setConfirmRevoke(true); }}
                  className="h-8 rounded-lg px-3.5 text-[12px] text-foreground/50 hover:border-destructive/30 hover:bg-destructive/[0.04] hover:text-destructive">
                  {t("shares.revoke", lang)}
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-destructive/70">{t("shares.revokeConfirm", lang)}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setConfirmRevoke(false); }}
                    className="h-8 rounded-lg px-3 text-[12px] text-foreground/50 hover:text-foreground">
                    {t("shares.cancel", lang)}
                  </Button>
                  <Button type="button" variant="destructive" size="sm" onClick={handleRevoke} disabled={actionLoading}
                    className="h-8 rounded-lg px-3.5 text-[12px]">
                    {t("shares.revoke", lang)}
                  </Button>
                </div>
              )}
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function SharesPage() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const router = useRouter();
  const [shares, setShares] = React.useState<ShareData[]>([]);
  const [drafts, setDrafts] = React.useState<DraftListingItem[]>([]);
  const [splatsByDraft, setSplatsByDraft] = React.useState<Record<number, { title: string; splatId: number; thumbnail: string | null }>>({});
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [filter, setFilter] = React.useState<"all" | "active" | "inactive">("active");
  const [query, setQuery] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [draftQuery, setDraftQuery] = React.useState("");

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isLoading, isAuthenticated, router]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const [shareResult, draftResult, splatResult] = await Promise.allSettled([
      listShares({ fresh: true }),
      listAllDrafts(),
      listAllSplats(),
    ]);
    if (shareResult.status === "fulfilled") setShares(shareResult.value);
    else {
      setShares([]);
      setLoadError(true);
    }
    if (draftResult.status === "fulfilled") setDrafts(draftResult.value);
    if (splatResult.status === "fulfilled") {
      const map: Record<number, { title: string; splatId: number; thumbnail: string | null }> = {};
      for (const splat of splatResult.value) {
        if (!splat.source_draft || map[splat.source_draft]) continue;
        map[splat.source_draft] = { title: splat.title, splatId: splat.id, thumbnail: splat.thumbnail_url ?? null };
      }
      setSplatsByDraft(map);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    if (isAuthenticated) void load();
  }, [isAuthenticated, load]);

  React.useEffect(() => {
    if (!isAuthenticated) return;
    const refresh = () => {
      listShares({ fresh: true }).then(setShares).catch(() => undefined);
    };
    window.addEventListener("reai-shares-updated", refresh);
    return () => window.removeEventListener("reai-shares-updated", refresh);
  }, [isAuthenticated]);

  const handleShareUpdate = React.useCallback((id: number, updated: ShareData | null) => {
    if (!updated) {
      setShares((p) => p.filter((s) => s.id !== id));
    } else {
      setShares((p) => p.map((s) => s.id === id ? updated : s));
    }
  }, []);

  if (isLoading || !user) {
    return <PageLoading />;
  }

  const lang = getUserLanguage(user.localization);
  const draftById = new Map(drafts.map((draft) => [draft.id, draft]));
  const statusFiltered = filter === "active"
    ? shares.filter((s) => s.status === "active" || s.status === "paused")
    : filter === "inactive"
      ? shares.filter((s) => s.status === "expired" || s.status === "revoked")
      : shares;
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = statusFiltered.filter((share) => {
    if (!normalizedQuery) return true;
    const title = share.title || draftById.get(share.draft)?.title || splatsByDraft[share.draft]?.title || "";
    return `${title} ${share.status}`.toLowerCase().includes(normalizedQuery);
  });
  const activeCount = shares.filter((s) => s.status === "active").length;
  const pausedCount = shares.filter((s) => s.status === "paused").length;
  const totalViews = shares.reduce((total, share) => total + (share.access_count || 0), 0);
  const normalizedDraftQuery = draftQuery.trim().toLowerCase();
  const selectableDrafts = drafts.filter((draft) => {
    if (!normalizedDraftQuery) return true;
    return `${draft.title} ${draft.display_address ?? ""} ${draft.city}`.toLowerCase().includes(normalizedDraftQuery);
  });

  return (
    <AppShell user={user} onLogout={logout}>
      <div className="mx-auto w-full max-w-4xl space-y-6 animate-fade-in pb-10">
        <PageHeader
          title={t("shares.title", lang)}
          description={t("shares.subtitle", lang)}
          actions={(
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <LinkIcon size={15} /> {t("shares.createLink", lang)}
            </Button>
          )}
        />

        {!loading && !loadError && shares.length > 0 && (
          <div className="grid grid-cols-3 divide-x divide-border/45 overflow-hidden rounded-2xl border border-border/55 bg-surface">
            <div className="px-4 py-3 sm:px-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{t("shares.statusActive", lang)}</p>
              <p className="mt-1 text-[20px] font-semibold tabular-nums">{activeCount}</p>
            </div>
            <div className="px-4 py-3 sm:px-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{t("shares.statusPaused", lang)}</p>
              <p className="mt-1 text-[20px] font-semibold tabular-nums">{pausedCount}</p>
            </div>
            <div className="px-4 py-3 sm:px-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{t("shares.totalViews", lang)}</p>
              <p className="mt-1 text-[20px] font-semibold tabular-nums">{totalViews}</p>
            </div>
          </div>
        )}

        {shares.length > 0 && (
          <div className="flex flex-col gap-3 border-b border-border/45 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block min-w-0 flex-1 sm:max-w-[300px]">
              <span className="sr-only">{t("shares.search", lang)}</span>
              <SearchIcon size={15} className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-foreground/35" />
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("shares.search", lang)} className="h-9 w-full border-0 bg-transparent pl-6 pr-2 text-[12px] outline-none placeholder:text-foreground/35" />
            </label>
            <div className="flex items-center gap-0.5 rounded-lg bg-muted/55 p-0.5">
              {(["all", "active", "inactive"] as const).map((f) => (
                <button
                  type="button"
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${filter === f ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {f === "all" ? t("shares.allShares", lang) : f === "active" ? t("shares.activeOnly", lang) : t("shares.inactiveOnly", lang)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Column headers */}
        {!loading && filtered.length > 0 && (
          <div className="hidden items-center gap-3 px-4 text-[10px] font-medium text-foreground/50 uppercase tracking-wider sm:flex">
            <span className="w-2" />
            <span className="flex-1">{t("shares.tableTour", lang)}</span>
            <span className="w-16 text-center">{t("shares.tableStatus", lang)}</span>
            <span className="w-20" />
            <span className="w-3.5" />
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/50 px-4 py-3.5 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-muted/50" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-1/3 rounded bg-muted/40" />
                    <div className="h-2.5 w-2/5 rounded bg-muted/25" />
                  </div>
                  <div className="h-5 w-14 rounded-full bg-muted/30" />
                </div>
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-border/55 bg-surface px-6 py-16 text-center">
            <p className="text-[14px] font-semibold">{t("shares.loadFailed", lang)}</p>
            <button type="button" onClick={() => void load()} className="mt-3 text-[12px] font-semibold underline underline-offset-4">{t("common.tryAgain", lang)}</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-12 h-12 rounded-full bg-foreground/[0.04] flex items-center justify-center mb-4">
              <LinkIcon size={22} className="text-foreground/25" />
            </div>
            <p className="text-[14px] font-medium text-foreground/60">{shares.length ? t("shares.noResults", lang) : t("shares.noShares", lang)}</p>
            <p className="text-[12px] text-muted-foreground mt-1 max-w-[280px]">{shares.length ? t("shares.noResultsHint", lang) : t("shares.noSharesHint", lang)}</p>
            {!shares.length && <Button type="button" variant="outline" size="sm" className="mt-4 text-[12px]" onClick={() => setCreateOpen(true)}>{t("shares.createLink", lang)}</Button>}
          </div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map((share) => {
              const draft = draftById.get(share.draft);
              const draftTour = splatsByDraft[share.draft];
              const tourName = share.title || draft?.title || draftTour?.title || t("shares.untitledTour", lang);
              const tourLink = share.draft ? `/draft/${share.draft}` : null;

              return (
                <ShareRow
                  key={share.id}
                  share={share}
                  tourName={tourName}
                  tourLink={tourLink}
                  lang={lang}
                  dateFormat={user?.localization?.date_format}
                  onUpdate={(updated) => handleShareUpdate(share.id, updated)}
                  onEdit={() => {
                    if (share.draft) router.push(`/draft/${share.draft}/sharing`);
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      <SidePanel
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("shares.createLink", lang)}
        description={t("shares.selectCreationHint", lang)}
      >
        <label className="relative block">
          <span className="sr-only">{t("shares.searchCreations", lang)}</span>
          <SearchIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground/35" />
          <input
            type="search"
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder={t("shares.searchCreations", lang)}
            className="h-10 w-full rounded-xl border border-border/55 bg-surface pl-9 pr-3 text-[12px] outline-none transition focus:border-foreground/25 focus:ring-2 focus:ring-foreground/[0.055]"
          />
        </label>
        <div className="mt-5 space-y-2">
          {selectableDrafts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/65 px-5 py-12 text-center">
              <p className="text-[13px] font-medium">{t("shares.noCreations", lang)}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("shares.noCreationsHint", lang)}</p>
            </div>
          ) : selectableDrafts.map((draft) => {
            const cover = draftThumbnail(draft) ?? splatsByDraft[draft.id]?.thumbnail ?? null;
            const activeLinks = shares.filter((share) => share.draft === draft.id && (share.status === "active" || share.status === "paused")).length;
            return (
              <button
                type="button"
                key={draft.id}
                onClick={() => router.push(`/draft/${draft.id}/sharing`)}
                className="group flex w-full items-center gap-3 rounded-xl border border-transparent p-2 text-left transition hover:border-border/55 hover:bg-surface"
              >
                <span className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-foreground/[0.045]">
                  {cover ? <Thumbnail src={cover} alt="" className="h-full w-full object-cover" /> : <LinkIcon size={18} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-foreground/20" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{draft.title || t("dashboard.untitled", lang)}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{draft.display_address || [draft.city, draft.country].filter(Boolean).join(", ") || t("shares.configureAccess", lang)}</span>
                  {activeLinks > 0 ? <span className="mt-1 block text-[10px] font-medium text-foreground/45">{activeLinks} {t("shares.existingLinks", lang)}</span> : null}
                </span>
                <span className="pr-2 text-foreground/25 transition group-hover:translate-x-0.5 group-hover:text-foreground/60">→</span>
              </button>
            );
          })}
        </div>
      </SidePanel>

    </AppShell>
  );
}
