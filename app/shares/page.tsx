"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../components/hooks/use-auth";
import { AppShell } from "../components/app-shell";
import { AnalyticsGrid, type AnalyticsGridItem } from "../components/analytics-grid";
import { CollectionState } from "../components/collection-state";
import { Button } from "../lib/ui/button";
import { t, getUserLanguage, formatDate } from "../lib/i18n";
import {
  listShares,
  listDrafts,
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
import { CollectionLoading } from "../components/collection-loading";
import { PageHeader } from "../components/page-header";
import { SidePanel } from "../components/side-panel";
import { SearchField } from "../components/search-field";
import { ArrowRightIcon, CheckIcon, ChevronDownIcon, ClockIcon, CopyIcon, ExternalLinkIcon, InfoIcon, LinkIcon, LockIcon } from "../components/icons";
import { Thumbnail } from "../components/thumbnail";
import { SegmentedControl } from "../components/segmented-control";
import { StatusPill } from "../components/status-pill";
import { currentGalleryUploads } from "../lib/media";

function draftThumbnail(draft: DraftListingItem): string | null {
  return currentGalleryUploads(draft.raw_uploads, "image")[0]?.file_url ?? null;
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
  const canRevoke = share.status !== "revoked";
  const cfg = STATUS_CONFIG[share.status] ?? STATUS_CONFIG.revoked;
  const expiry = expiryLabel(share.expires_at, lang);
  const analyticsItems: AnalyticsGridItem[] = stats
    ? [
        { label: t("shareDialog.analytics.totalViews", lang), value: stats.total_accesses },
        { label: t("shareDialog.analytics.uniqueVisitors", lang), value: stats.unique_ips },
        { label: t("shareDialog.analytics.authenticated", lang), value: stats.authenticated_accesses },
        ...(share.requires_pin ? [{ label: t("shareDialog.analytics.failedPins", lang), value: stats.failed_pin_attempts }] : []),
      ]
    : [{ label: t("shareDialog.analytics.totalViews", lang), value: share.access_count }];

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
    <div className={`overflow-hidden rounded-xl border transition-colors ${isLive ? "border-border bg-card" : "border-border/70 bg-surface-subtle"}`}>
      {/* Main row — always visible */}
      <div className="flex w-full flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-3">
        <button type="button" onClick={handleToggleExpand} aria-expanded={expanded} className="flex w-full min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          {/* Title + meta */}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className={`text-[13px] font-semibold truncate ${isLive ? "" : "text-foreground/50"}`}>{tourName}</span>
              {share.requires_pin && (
                <span className="shrink-0 inline-flex items-center gap-0.5 rounded bg-foreground/[0.07] px-1.5 py-px text-[11px] font-medium text-foreground/60 uppercase tracking-wider">
                  <LockIcon size={9} />
                  PIN
                </span>
              )}
              {expiry && <span className="shrink-0 rounded bg-foreground/[0.07] px-1.5 py-px text-[11px] font-medium text-foreground/50">{expiry}</span>}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-foreground/60">
              <span className="tabular-nums">{share.access_count} {share.access_count === 1 ? t("shares.viewSingular", lang) : t("shares.viewPlural", lang)}</span>
              <span className="text-foreground/35"> · </span>
              <span>{fieldSummaryLabel(share, lang)}</span>
              <span className="text-foreground/35"> · </span>
              <span>{formatDate(share.created_at, dateFormat, lang)}</span>
            </span>
          </span>

          <StatusPill tone={cfg.tone} dot className="shrink-0">
            {t(cfg.labelKey, lang)}
          </StatusPill>
          <ChevronDownIcon size={14} className={`shrink-0 text-foreground/35 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>

        {/* Recipient actions (live only) */}
        {isLive && (
          <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-auto">
            {isActive ? (
              <Button asChild variant="outline" size="xs" className="gap-1 text-[11px] text-foreground/70 hover:text-foreground [&_svg]:size-3">
                <a href={shareUrl(share.token)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  <ExternalLinkIcon size={12} />
                  {t("common.open", lang)}
                </a>
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={handleCopy}
              className={`gap-1 text-[11px] [&_svg]:size-3 ${copied ? "border-foreground bg-foreground text-background hover:bg-foreground hover:text-background" : "text-foreground/70 hover:text-foreground"}`}
            >
              {copied ? (
                <CheckIcon size={12} />
              ) : (
                <CopyIcon size={12} />
              )}
              {copied ? t("shares.copied", lang) : t("shares.copyLink", lang)}
            </Button>
          </div>
        )}

      </div>

      {/* Expanded detail panel */}
      <div className="grid transition-[grid-template-rows] duration-200 ease-out" style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}>
        <div className="overflow-hidden">
          <div className={`border-t border-border/40 px-4 py-3.5 space-y-3 ${expanded ? "" : "invisible"}`}>
          {/* URL row */}
          {isLive && (
            <div className="flex items-center gap-2 rounded-xl bg-surface-subtle px-3 py-2">
              <p className="flex-1 text-[11px] font-mono text-foreground/70 truncate select-all">{shareUrl(share.token)}</p>
            </div>
          )}

          <AnalyticsGrid items={analyticsItems} loading={statsLoading} />

          {/* Detail row: field permissions, limits, link to draft */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-foreground/60">
            <span>{fieldSummaryLabel(share, lang)}</span>
            {share.max_access_count && <span>{t("shares.viewLimit", lang)}: {share.max_access_count}</span>}
            {share.expires_at && (
              <span className="inline-flex items-center gap-1">
                <ClockIcon size={10} />
                {formatDate(share.expires_at, dateFormat, lang)}
              </span>
            )}
            {tourLink && (
              <Link href={tourLink} className="inline-flex items-center gap-1 text-foreground/60 hover:text-foreground hover:underline" onClick={(e) => e.stopPropagation()}>
                {t("shares.view", lang)} <ArrowRightIcon size={11} />
              </Link>
            )}
          </div>

          {/* Actions bar */}
          {actionError && <p role="alert" className="text-[11px] text-destructive">{t("common.requestFailed", lang)}</p>}
          {canRevoke && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-2">
              {isLive && (
                <Button type="button" variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onEdit(); }}
                  className="h-8 px-3.5 text-[12px] text-foreground/80 hover:text-foreground">
                  {t("shares.editSettings", lang)}
                </Button>
              )}
              {isActive && (
                <Button type="button" variant="outline" size="sm" onClick={handlePause} disabled={actionLoading}
                  className="h-8 px-3.5 text-[12px] text-foreground/60 hover:text-foreground">
                  {t("shares.pause", lang)}
                </Button>
              )}
              {isPaused && (
                <Button type="button" variant="outline" size="sm" onClick={handleResume} disabled={actionLoading}
                  className="h-8 px-3.5 text-[12px] text-foreground/70 hover:text-foreground">
                  {t("shares.resume", lang)}
                </Button>
              )}
              <div className="hidden flex-1 sm:block" />
              {!confirmRevoke ? (
                <Button type="button" variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setConfirmRevoke(true); }}
                  className="h-8 rounded-full px-3.5 text-[12px] text-foreground/50 hover:border-destructive/30 hover:bg-destructive/[0.04] hover:text-destructive">
                  {t("shares.revoke", lang)}
                </Button>
              ) : (
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                  <span className="mr-auto text-[11px] text-destructive/70">{t("shares.revokeConfirm", lang)}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setConfirmRevoke(false); }}
                    className="h-8 rounded-full px-3 text-[12px] text-foreground/50 hover:text-foreground">
                    {t("shares.cancel", lang)}
                  </Button>
                  <Button type="button" variant="destructive" size="sm" onClick={handleRevoke} disabled={actionLoading}
                    className="h-8 rounded-full px-3.5 text-[12px]">
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
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [draftsLoaded, setDraftsLoaded] = React.useState(false);
  const [draftsLoading, setDraftsLoading] = React.useState(false);
  const [draftsLoadingMore, setDraftsLoadingMore] = React.useState(false);
  const [draftsHasMore, setDraftsHasMore] = React.useState(false);
  const [draftsError, setDraftsError] = React.useState(false);
  const [filter, setFilter] = React.useState<"all" | "active" | "inactive">("active");
  const [query, setQuery] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [draftQuery, setDraftQuery] = React.useState("");
  const [draftSearchQuery, setDraftSearchQuery] = React.useState("");
  const draftsPageRef = React.useRef(1);
  const draftsRequestRef = React.useRef(0);

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isLoading, isAuthenticated, router]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setShares(await listShares({ fresh: true }));
    } catch {
      setShares([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDraftPage = React.useCallback(async (page: number, append: boolean) => {
    const requestId = append ? draftsRequestRef.current : ++draftsRequestRef.current;
    if (append) {
      setDraftsLoadingMore(true);
    } else {
      setDrafts([]);
      setDraftsLoaded(false);
      setDraftsLoading(true);
      setDraftsLoadingMore(false);
      setDraftsError(false);
    }
    try {
      const data = await listDrafts(page, 30, draftSearchQuery);
      if (requestId !== draftsRequestRef.current) return;
      setDrafts((current) => {
        const results = data.results ?? [];
        if (!append) return results;
        const seen = new Set(current.map((draft) => draft.id));
        return [...current, ...results.filter((draft) => !seen.has(draft.id))];
      });
      setDraftsHasMore(!!data.next);
      draftsPageRef.current = page;
    } catch {
      if (requestId === draftsRequestRef.current && !append) setDraftsError(true);
    } finally {
      if (requestId === draftsRequestRef.current) {
        setDraftsLoaded(true);
        setDraftsLoading(false);
        setDraftsLoadingMore(false);
      }
    }
  }, [draftSearchQuery]);

  React.useEffect(() => {
    if (isAuthenticated) void load();
  }, [isAuthenticated, load]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDraftSearchQuery(draftQuery.trim()), 150);
    return () => window.clearTimeout(timer);
  }, [draftQuery]);

  React.useEffect(() => {
    if (!createOpen) return;
    void loadDraftPage(1, false);
    return () => { draftsRequestRef.current += 1; };
  }, [createOpen, loadDraftPage]);

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
    const title = share.title || share.draft_title || draftById.get(share.draft)?.title || "";
    return `${title} ${share.status}`.toLowerCase().includes(normalizedQuery);
  });
  const activeCount = shares.filter((s) => s.status === "active").length;
  const pausedCount = shares.filter((s) => s.status === "paused").length;
  const inactiveCount = shares.filter((s) => s.status === "expired" || s.status === "revoked").length;
  const selectableDrafts = drafts;

  return (
    <AppShell user={user} onLogout={logout}>
      <div className="mx-auto w-full max-w-[1180px] pb-10">
        <PageHeader
          title={t("shares.title", lang)}
          description={t("shares.subtitle", lang)}
          actions={(
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <LinkIcon size={15} /> {t("shares.createLink", lang)}
            </Button>
          )}
          className="mb-5 sm:mb-8"
        />

        <div className="mb-5 flex flex-col gap-3 sm:mb-7 sm:flex-row sm:items-center sm:justify-between">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={t("shares.search", lang)}
            clearLabel={t("dashboard.clearSearch", lang)}
            className="min-w-0 flex-1 sm:max-w-[300px]"
          />
          <SegmentedControl
            value={filter}
            onChange={setFilter}
            ariaLabel={t("shares.title", lang)}
            className="w-full sm:w-auto"
            itemClassName="text-[11px]"
            options={[
              { value: "all", label: t("shares.allShares", lang), count: shares.length },
              { value: "active", label: t("shares.activeOnly", lang), count: activeCount + pausedCount },
              { value: "inactive", label: t("shares.inactiveOnly", lang), count: inactiveCount },
            ]}
          />
        </div>

        {/* Content */}
        {loading ? (
          <CollectionLoading label={t("common.loading", lang)} />
        ) : loadError ? (
          <CollectionState
            kind="error"
            icon={<InfoIcon size={20} />}
            title={t("shares.loadFailed", lang)}
            action={<Button type="button" variant="outline" size="sm" onClick={() => void load()}>{t("common.tryAgain", lang)}</Button>}
          />
        ) : filtered.length === 0 ? (
          <CollectionState
            icon={<LinkIcon size={20} />}
            title={shares.length ? t("shares.noResults", lang) : t("shares.noShares", lang)}
            description={shares.length ? t("shares.noResultsHint", lang) : t("shares.noSharesHint", lang)}
            action={shares.length
              ? <Button type="button" variant="outline" size="sm" onClick={() => { setQuery(""); setFilter("all"); }}>{t("shares.allShares", lang)}</Button>
              : <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>{t("shares.createLink", lang)}</Button>}
          />
        ) : (
          <div className="space-y-2.5">
            {filtered.map((share) => {
              const draft = draftById.get(share.draft);
              const tourName = share.title || share.draft_title || draft?.title || t("shares.untitledTour", lang);
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
        <div className="border-b border-border/40 pb-3">
          <SearchField
            value={draftQuery}
            onChange={setDraftQuery}
            placeholder={t("shares.searchCreations", lang)}
            clearLabel={t("dashboard.clearSearch", lang)}
          />
        </div>
        <div className="mt-5 space-y-2">
          {draftsLoading || (!draftsLoaded && !draftsError) ? (
            <CollectionLoading label={t("common.loading", lang)} className="min-h-40" />
          ) : draftsError && drafts.length === 0 ? (
            <CollectionState
              kind="error"
              icon={<InfoIcon size={20} />}
              title={t("shares.loadFailed", lang)}
              action={<Button type="button" variant="outline" size="sm" onClick={() => void loadDraftPage(1, false)}>{t("common.tryAgain", lang)}</Button>}
            />
          ) : selectableDrafts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/65 px-5 py-12 text-center">
              <p className="text-[13px] font-medium">{t("shares.noCreations", lang)}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("shares.noCreationsHint", lang)}</p>
            </div>
          ) : (
            <>
          {selectableDrafts.map((draft) => {
            const cover = draftThumbnail(draft);
            const activeLinks = shares.filter((share) => share.draft === draft.id && (share.status === "active" || share.status === "paused")).length;
            return (
              <Link
                key={draft.id}
                href={`/draft/${draft.id}/sharing`}
                prefetch
                className="group flex w-full items-center gap-3 rounded-xl border border-transparent p-2 text-left transition hover:border-border/55 hover:bg-surface"
              >
                <span className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-foreground/[0.045]">
                  {cover ? <Thumbnail src={cover} alt="" className="h-full w-full object-cover" /> : <LinkIcon size={18} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-foreground/20" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{draft.title || t("dashboard.untitled", lang)}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{draft.display_address || [draft.city, draft.country].filter(Boolean).join(", ") || t("shares.configureAccess", lang)}</span>
                  {activeLinks > 0 ? <span className="mt-1 block text-[11px] font-medium text-foreground/45">{activeLinks} {t("shares.existingLinks", lang)}</span> : null}
                </span>
                <span className="pr-2 text-foreground/25 transition group-hover:translate-x-0.5 group-hover:text-foreground/60">→</span>
              </Link>
            );
          })}
          {draftsHasMore ? (
            <div className="flex justify-center pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={draftsLoadingMore}
                onClick={() => void loadDraftPage(draftsPageRef.current + 1, true)}
              >
                {draftsLoadingMore ? t("common.loading", lang) : t("dashboard.loadMore", lang)}
              </Button>
            </div>
          ) : null}
            </>
          )}
        </div>
      </SidePanel>

    </AppShell>
  );
}
