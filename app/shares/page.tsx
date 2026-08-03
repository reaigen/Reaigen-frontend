"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../components/hooks/use-auth";
import { AppShell } from "../components/app-shell";
import { CollectionState } from "../components/collection-state";
import { Button } from "../lib/ui/button";
import { t, getUserLanguage } from "../lib/i18n";
import { listShares, listDrafts } from "../lib/api/client";
import type { DraftListingItem, ShareData } from "../lib/tour-types";
import { PageLoading } from "../components/page-loading";
import { CollectionLoading } from "../components/collection-loading";
import { PageHeader } from "../components/page-header";
import { SidePanel } from "../components/side-panel";
import { SearchField } from "../components/search-field";
import { ArrowRightIcon, InfoIcon, LinkIcon } from "../components/icons";
import { Thumbnail } from "../components/thumbnail";
import { SegmentedControl } from "../components/segmented-control";
import { ShareManagementPanel, ShareManagementRow } from "../components/share-management-card";
import { currentGalleryUploads } from "../lib/media";

function draftThumbnail(draft: DraftListingItem): string | null {
  return currentGalleryUploads(draft.raw_uploads, "image")[0]?.file_url ?? null;
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
  const [selectedShareId, setSelectedShareId] = React.useState<number | null>(null);
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
      setSelectedShareId((current) => current === id ? null : current);
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
  const selectedShare = selectedShareId == null
    ? null
    : shares.find((share) => share.id === selectedShareId) ?? null;
  const selectedDraft = selectedShare ? draftById.get(selectedShare.draft) : null;
  const selectedTitle = selectedShare
    ? selectedShare.title || selectedShare.draft_title || selectedDraft?.title || t("shares.untitledTour", lang)
    : "";

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

        <div className="mb-5 flex flex-col gap-3 sm:mb-7 md:flex-row md:items-end md:justify-between">
          <div className="flex w-full min-w-0 items-center gap-3 rounded-full border border-border/80 bg-card px-4 py-0.5 shadow-control md:max-w-[340px] md:rounded-none md:border-x-0 md:border-t-0 md:bg-transparent md:px-0 md:pb-2 md:pt-0 md:shadow-none">
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder={t("shares.search", lang)}
              clearLabel={t("dashboard.clearSearch", lang)}
              className="min-w-0 flex-1"
              appearance="toolbar"
            />
          </div>
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
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border/70 bg-border/70 shadow-card sm:grid-cols-2">
            {filtered.map((share) => {
              const draft = draftById.get(share.draft);
              const tourName = share.title || share.draft_title || draft?.title || t("shares.untitledTour", lang);

              return (
                <ShareManagementRow
                  key={share.id}
                  share={share}
                  title={tourName}
                  lang={lang}
                  dateFormat={user?.localization?.date_format}
                  onManage={() => setSelectedShareId(share.id)}
                />
              );
            })}
          </div>
        )}
      </div>

      <ShareManagementPanel
        open={selectedShare != null}
        onOpenChange={(open) => {
          if (!open) setSelectedShareId(null);
        }}
        share={selectedShare}
        title={selectedTitle}
        tourLink={selectedShare?.draft ? `/draft/${selectedShare.draft}` : null}
        lang={lang}
        dateFormat={user?.localization?.date_format}
        onUpdate={(updated) => {
          if (selectedShare) handleShareUpdate(selectedShare.id, updated);
        }}
        onEdit={() => {
          if (selectedShare?.draft) router.push(`/draft/${selectedShare.draft}/sharing`);
        }}
      />

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
                <ArrowRightIcon size={14} className="mr-2 shrink-0 text-foreground/25 transition group-hover:translate-x-0.5 group-hover:text-foreground/60" />
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
