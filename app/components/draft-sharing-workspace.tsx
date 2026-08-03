"use client";

import * as React from "react";

import {
  createDraftShare,
  createSplatShare,
  getShareAnalytics,
  listShares,
  pauseShare,
  resumeShare,
  revokeShare,
  updateShare,
} from "../lib/api/client";
import { getSafeApiErrorMessage } from "../lib/api/error-message";
import { formatDate, t } from "../lib/i18n";
import { currentGalleryUploads } from "../lib/media";
import {
  copyToClipboard,
  expiryLabel,
  fieldSummaryLabel,
  shareUrl,
  STATUS_CONFIG,
  type ShareStats,
} from "../lib/share-ui";
import { selectShareableTour } from "../lib/tour-sharing";
import type {
  DraftDetailItem,
  DraftTourAssetsPayload,
  ShareData,
  SplatsByDraftPayload,
} from "../lib/tour-types";
import { Button } from "../lib/ui/button";
import { AnalyticsGrid, type AnalyticsGridItem } from "./analytics-grid";
import {
  ArrowLeftIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  ExternalLinkIcon,
  LinkIcon,
  LockIcon,
  PlusIcon,
} from "./icons";
import { SegmentedControl } from "./segmented-control";
import {
  ShareCreateForm,
  defaultContentScope,
  type ShareFormData,
} from "./sharing/share-create-form";
import type { ContentScope } from "./sharing/content-scope-selector";
import { StatusPill } from "./status-pill";

type WorkspaceMode = "links" | "create" | "manage";

function primaryShareSplat(data: SplatsByDraftPayload | null) {
  if (!data?.splats.length) return null;
  return data.parent_splat_id
    ? data.splats.find((splat) => (
        (splat.splat_id ?? splat.id) === data.parent_splat_id
      )) ?? data.splats[0]
    : data.splats[0];
}

function scopeFromShare(
  share: ShareData,
  capabilities: { tour: boolean; photos: boolean; floorplan: boolean },
): ContentScope {
  const visibleFields = new Set(
    share.fields
      .filter((field) => field.is_visible)
      .map((field) => field.field_name),
  );
  if (visibleFields.size === 0) {
    return {
      tour: false,
      photos: false,
      floorplan: false,
      details: false,
      selectedFields: new Set(["title"]),
    };
  }
  visibleFields.add("title");
  const structuralFields = new Set(["title", "tour", "uploads", "floorplan"]);
  return {
    tour: capabilities.tour && visibleFields.has("tour"),
    photos: capabilities.photos && visibleFields.has("uploads"),
    floorplan: capabilities.floorplan && visibleFields.has("floorplan"),
    details: [...visibleFields].some((field) => !structuralFields.has(field)),
    selectedFields: visibleFields,
  };
}

function ShareLinkCard({
  share,
  lang,
  dateFormat,
  copied,
  onCopy,
  onManage,
}: {
  share: ShareData;
  lang: string;
  dateFormat?: string | null;
  copied: boolean;
  onCopy: () => void;
  onManage: () => void;
}) {
  const status = STATUS_CONFIG[share.status] ?? STATUS_CONFIG.revoked;
  const expiry = expiryLabel(share.expires_at, lang);
  const title = share.title || t("sharing.linkLabel", lang);
  const isActive = share.status === "active";

  return (
    <article className="flex min-w-0 flex-col rounded-2xl border border-border/70 bg-card p-4 shadow-control">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-semibold text-foreground/90">{title}</h3>
          <p className="mt-1 truncate text-[10px] text-muted-foreground">
            {formatDate(share.created_at, dateFormat, lang)} · {share.access_count} {share.access_count === 1 ? t("shares.viewSingular", lang) : t("shares.viewPlural", lang)}
          </p>
        </div>
        <StatusPill tone={status.tone} dot className="shrink-0">
          {t(status.labelKey, lang)}
        </StatusPill>
      </div>

      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-foreground/45">
        <span className="truncate">{fieldSummaryLabel(share, lang)}</span>
        {share.requires_pin ? (
          <span className="inline-flex items-center gap-1"><LockIcon size={11} /> {t("shares.pinProtected", lang)}</span>
        ) : null}
        {expiry ? (
          <span className="inline-flex items-center gap-1"><ClockIcon size={11} /> {expiry}</span>
        ) : null}
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-border/50 pt-3">
        <Button type="button" variant="outline" size="xs" className="flex-1" onClick={onCopy}>
          {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
          {copied ? t("shares.copied", lang) : t("shares.copyLink", lang)}
        </Button>
        <Button type="button" variant="ghost" size="xs" className="flex-1" onClick={onManage}>
          {t("shares.manage", lang)}
        </Button>
        {isActive ? (
          <Button asChild variant="ghost" size="icon-sm" className="h-[var(--floating-status)] w-[var(--floating-status)]">
            <a href={shareUrl(share.token)} target="_blank" rel="noreferrer" aria-label={t("common.open", lang)}>
              <ExternalLinkIcon size={13} />
            </a>
          </Button>
        ) : null}
      </div>
    </article>
  );
}

export function DraftSharingWorkspace({
  active,
  draftId,
  draft,
  splatData,
  tourAssets,
  lang,
  dateFormat,
}: {
  active: boolean;
  draftId: number;
  draft: DraftDetailItem;
  splatData: SplatsByDraftPayload | null;
  tourAssets: DraftTourAssetsPayload | null;
  lang: string;
  dateFormat?: string | null;
}) {
  const legacyPrimarySplat = primaryShareSplat(splatData);
  const legacyPrimarySplatId = legacyPrimarySplat
    ? (legacyPrimarySplat.splat_id ?? legacyPrimarySplat.id)
    : null;
  const shareableTour = selectShareableTour(tourAssets, legacyPrimarySplatId);
  const hasTour = Boolean(shareableTour);
  const primarySplatId = shareableTour?.source_splat_id ?? undefined;
  const hasPhotos = currentGalleryUploads(draft.raw_uploads ?? [], "image").length > 0;
  const hasFloorplan = Boolean(
    draft.floorplan_id
    || (draft.draft_data ?? []).some((entry) => (
      entry.data_key === "captured_room_json"
      || entry.data_key === "wall_graph_json"
    )),
  );

  const [shares, setShares] = React.useState<ShareData[]>([]);
  const [linksLoading, setLinksLoading] = React.useState(false);
  const [linksLoaded, setLinksLoaded] = React.useState(false);
  const [linksError, setLinksError] = React.useState(false);
  const [mode, setMode] = React.useState<WorkspaceMode>("links");
  const [scope, setScope] = React.useState<ContentScope>(() => (
    defaultContentScope(hasTour, hasPhotos, hasFloorplan)
  ));
  const [editingShare, setEditingShare] = React.useState<ShareData | null>(null);
  const [selectedShareId, setSelectedShareId] = React.useState<number | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<"copied" | "saved" | null>(null);
  const [copyFailedUrl, setCopyFailedUrl] = React.useState<string | null>(null);
  const [copiedShareId, setCopiedShareId] = React.useState<number | null>(null);
  const [formVersion, setFormVersion] = React.useState(0);
  const [stats, setStats] = React.useState<ShareStats | null>(null);
  const [actionLoading, setActionLoading] = React.useState(false);
  const [actionError, setActionError] = React.useState(false);
  const [confirmRevoke, setConfirmRevoke] = React.useState(false);
  const wasActiveRef = React.useRef(false);
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  const noticeTimerRef = React.useRef<number | null>(null);
  const copyTimerRef = React.useRef<number | null>(null);

  const selectedShare = selectedShareId == null
    ? null
    : shares.find((share) => share.id === selectedShareId) ?? null;

  const loadLinks = React.useCallback(async (fresh = false) => {
    setLinksLoading(true);
    setLinksError(false);
    try {
      const allShares = await listShares(fresh ? { fresh: true } : undefined);
      setShares(allShares.filter((share) => (
        share.draft === draftId && share.status !== "revoked"
      )));
      setLinksLoaded(true);
    } catch {
      setLinksError(true);
    } finally {
      setLinksLoading(false);
    }
  }, [draftId]);

  React.useEffect(() => {
    const becameActive = active && !wasActiveRef.current;
    wasActiveRef.current = active;
    if (!becameActive) return;
    headingRef.current?.focus({ preventScroll: true });
    if (!linksLoaded) void loadLinks();
  }, [active, linksLoaded, loadLinks]);

  React.useEffect(() => {
    const refresh = () => {
      if (active) void loadLinks(true);
    };
    window.addEventListener("reai-shares-updated", refresh);
    return () => window.removeEventListener("reai-shares-updated", refresh);
  }, [active, loadLinks]);

  React.useEffect(() => {
    setStats(null);
    setActionError(false);
    setConfirmRevoke(false);
    if (mode !== "manage" || selectedShareId == null) return;
    let current = true;
    void getShareAnalytics(selectedShareId)
      .then((response) => {
        if (current) setStats(response.stats);
      })
      .catch(() => {
        if (current) setActionError(true);
      });
    return () => { current = false; };
  }, [mode, selectedShareId]);

  React.useEffect(() => () => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
  }, []);

  const showNotice = React.useCallback((value: "copied" | "saved") => {
    setNotice(value);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 2_000);
  }, []);

  const copyShare = React.useCallback(async (share: ShareData) => {
    const url = shareUrl(share.token);
    setCopyFailedUrl(null);
    if (!await copyToClipboard(url)) {
      setCopyFailedUrl(url);
      return;
    }
    setCopiedShareId(share.id);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopiedShareId(null), 2_000);
  }, []);

  const openLinks = React.useCallback(() => {
    setMode("links");
    setEditingShare(null);
    setFormError(null);
    setCopyFailedUrl(null);
    setConfirmRevoke(false);
  }, []);

  const openCreate = React.useCallback(() => {
    setMode("create");
    setSelectedShareId(null);
    setEditingShare(null);
    setFormError(null);
    setCopyFailedUrl(null);
    setScope(defaultContentScope(hasTour, hasPhotos, hasFloorplan));
    setFormVersion((version) => version + 1);
  }, [hasFloorplan, hasPhotos, hasTour]);

  const openManager = React.useCallback((shareId: number) => {
    setSelectedShareId(shareId);
    setEditingShare(null);
    setCopyFailedUrl(null);
    setMode("manage");
  }, []);

  const editSelectedShare = React.useCallback(() => {
    if (!selectedShare) return;
    setEditingShare(selectedShare);
    setFormError(null);
    setCopyFailedUrl(null);
    setScope(scopeFromShare(selectedShare, {
      tour: hasTour,
      photos: hasPhotos,
      floorplan: hasFloorplan,
    }));
    setFormVersion((version) => version + 1);
    setMode("create");
  }, [hasFloorplan, hasPhotos, hasTour, selectedShare]);

  const handleSubmit = React.useCallback(async (formData: ShareFormData) => {
    setFormError(null);
    setSaving(true);
    try {
      if (editingShare) {
        const updatePayload: Parameters<typeof updateShare>[1] & { tour_id?: number } = {
          ...formData,
          ...(scope.tour && shareableTour?.id
            ? { tour_id: shareableTour.id }
            : {}),
        };
        if (formData.expires_in_hours === 0) {
          delete updatePayload.expires_in_hours;
          updatePayload.expires_at = null;
        }
        if (
          editingShare.requires_pin
          && formData.share_type === "pin"
          && !formData.pin
        ) {
          delete updatePayload.share_type;
        }
        const updated = await updateShare(editingShare.id, updatePayload);
        setShares((current) => current.map((share) => (
          share.id === updated.id ? updated : share
        )));
        setSelectedShareId(updated.id);
        setEditingShare(null);
        setMode("manage");
        showNotice("saved");
        return;
      }

      const created = scope.tour && primarySplatId
        ? await createSplatShare(primarySplatId, {
            ...formData,
            tour_id: shareableTour?.id,
          })
        : await createDraftShare(draftId, formData);
      setShares((current) => [created, ...current]);
      setLinksLoaded(true);
      setSelectedShareId(created.id);
      setMode("manage");
      setFormVersion((version) => version + 1);
      const url = shareUrl(created.token);
      if (await copyToClipboard(url)) {
        setCopiedShareId(created.id);
        if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
        copyTimerRef.current = window.setTimeout(() => setCopiedShareId(null), 2_000);
        showNotice("copied");
      } else {
        setCopyFailedUrl(url);
      }
    } catch (error) {
      setFormError(
        getSafeApiErrorMessage(error, lang)
        || t("shareDialog.errorCreate", lang),
      );
    } finally {
      setSaving(false);
    }
  }, [
    draftId,
    editingShare,
    lang,
    primarySplatId,
    scope.tour,
    shareableTour?.id,
    showNotice,
  ]);

  const runAction = React.useCallback(async (action: "pause" | "resume" | "revoke") => {
    if (!selectedShare) return;
    setActionError(false);
    setActionLoading(true);
    try {
      if (action === "pause") {
        const response = await pauseShare(selectedShare.id);
        setShares((current) => current.map((share) => (
          share.id === selectedShare.id ? response.share : share
        )));
      } else if (action === "resume") {
        const response = await resumeShare(selectedShare.id);
        setShares((current) => current.map((share) => (
          share.id === selectedShare.id ? response.share : share
        )));
      } else {
        await revokeShare(selectedShare.id);
        setShares((current) => current.filter((share) => share.id !== selectedShare.id));
        setSelectedShareId(null);
        setMode("links");
      }
    } catch {
      setActionError(true);
    } finally {
      setActionLoading(false);
      setConfirmRevoke(false);
    }
  }, [selectedShare]);

  const activeCount = shares.filter((share) => share.status === "active").length;
  const totalViews = shares.reduce((sum, share) => sum + share.access_count, 0);
  const selectedStatus = selectedShare
    ? STATUS_CONFIG[selectedShare.status] ?? STATUS_CONFIG.revoked
    : STATUS_CONFIG.revoked;
  const selectedExpiry = selectedShare ? expiryLabel(selectedShare.expires_at, lang) : null;
  const analyticsItems: AnalyticsGridItem[] = selectedShare ? [
    { label: t("shareDialog.analytics.totalViews", lang), value: stats?.total_accesses ?? selectedShare.access_count },
    { label: t("shareDialog.analytics.uniqueVisitors", lang), value: stats?.unique_ips ?? "—" },
    { label: t("shareDialog.analytics.authenticated", lang), value: stats?.authenticated_accesses ?? "—" },
    ...(selectedShare.requires_pin
      ? [{ label: t("shareDialog.analytics.failedPins", lang), value: stats?.failed_pin_attempts ?? "—" }]
      : []),
  ] : [];

  return (
    <section aria-labelledby="draft-sharing-title" className="animate-fade-in">
      <header className="mb-6 flex flex-col gap-4 border-b border-border/65 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1
            ref={headingRef}
            id="draft-sharing-title"
            tabIndex={-1}
            className="text-[28px] font-semibold leading-tight tracking-[-0.03em] outline-none sm:text-[32px]"
          >
            {t("sharing.pageTitle", lang)}
          </h1>
          <p className="mt-1 truncate text-[12px] text-muted-foreground">
            {draft.title || t("dashboard.untitled", lang)}
          </p>
          {linksLoading ? (
            <div className="loading-progress-track mt-3 w-16" role="progressbar" aria-label={t("common.loading", lang)}>
              <span className="loading-progress-indeterminate" />
            </div>
          ) : null}
        </div>
        <SegmentedControl
          value={mode === "create" ? "create" : "links"}
          onChange={(value) => value === "create" ? openCreate() : openLinks()}
          ariaLabel={t("sharing.pageTitle", lang)}
          itemClassName="h-9 px-3 text-[11px]"
          options={[
            {
              value: "links",
              label: t("shares.title", lang),
              icon: <LinkIcon size={13} />,
              count: linksLoaded ? shares.length : undefined,
            },
            {
              value: "create",
              label: t("shares.createLink", lang),
              icon: <PlusIcon size={13} />,
            },
          ]}
        />
      </header>

      {notice ? (
        <div role="status" className="mb-5 rounded-xl border border-border/60 bg-card px-3 py-2 text-[12px] font-medium text-foreground/70 shadow-control">
          {t(notice === "copied" ? "sharing.linkCopied" : "common.saved", lang)}
        </div>
      ) : null}

      {copyFailedUrl ? (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-border/70 bg-card p-2.5 shadow-control">
          <p className="min-w-0 flex-1 truncate select-all font-mono text-[11px] text-foreground/65">{copyFailedUrl}</p>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={async () => {
              if (await copyToClipboard(copyFailedUrl)) {
                setCopyFailedUrl(null);
                showNotice("copied");
              }
            }}
          >
            {t("shares.copyLink", lang)}
          </Button>
        </div>
      ) : null}

      {mode === "links" ? (
        <div className="space-y-5">
          {shares.length ? (
            <AnalyticsGrid
              items={[
                { label: t("shares.allShares", lang), value: shares.length },
                { label: t("shares.activeOnly", lang), value: activeCount },
                { label: t("shares.totalViews", lang), value: totalViews },
              ]}
              className="sm:max-w-xl"
            />
          ) : null}

          {linksError && !shares.length ? (
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-card px-4 py-4 shadow-control">
              <p className="text-[12px] text-muted-foreground">{t("shares.loadFailed", lang)}</p>
              <Button type="button" variant="outline" size="xs" onClick={() => void loadLinks(true)}>
                {t("common.tryAgain", lang)}
              </Button>
            </div>
          ) : linksLoaded && !shares.length ? (
            <div className="rounded-2xl border border-dashed border-border/70 px-5 py-10 text-center">
              <p className="text-[13px] font-semibold">{t("shares.noShares", lang)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{t("shares.noSharesHint", lang)}</p>
              <Button type="button" size="sm" className="mt-4" onClick={openCreate}>
                <PlusIcon size={14} /> {t("shares.createLink", lang)}
              </Button>
            </div>
          ) : shares.length ? (
            <div className="grid max-h-[28rem] grid-cols-1 gap-3 overflow-y-auto pr-1 scrollbar-thin md:grid-cols-2">
              {shares.map((share) => (
                <ShareLinkCard
                  key={share.id}
                  share={share}
                  lang={lang}
                  dateFormat={dateFormat}
                  copied={copiedShareId === share.id}
                  onCopy={() => void copyShare(share)}
                  onManage={() => openManager(share.id)}
                />
              ))}
            </div>
          ) : null}

          {linksError && shares.length ? (
            <div className="flex items-center gap-3 text-[11px] text-destructive/75">
              <span>{t("shares.loadFailed", lang)}</span>
              <Button type="button" variant="ghost" size="xs" onClick={() => void loadLinks(true)}>
                {t("common.tryAgain", lang)}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {mode === "create" ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            {editingShare ? (
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => setMode("manage")} aria-label={t("common.back", lang)}>
                <ArrowLeftIcon size={15} />
              </Button>
            ) : null}
            <div>
              <h2 className="text-[15px] font-semibold">
                {t(editingShare ? "shares.editSettings" : "sharing.createNewLink", lang)}
              </h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{draft.title || t("dashboard.untitled", lang)}</p>
            </div>
          </div>
          <ShareCreateForm
            key={`${editingShare?.id ?? "new"}-${formVersion}`}
            scope={scope}
            onScopeChange={setScope}
            hasTour={hasTour}
            hasPhotos={hasPhotos}
            hasFloorplan={hasFloorplan}
            lang={lang}
            onSubmit={handleSubmit}
            saving={saving}
            error={formError}
            initialShare={editingShare}
            onCancelEdit={editingShare ? () => setMode("manage") : undefined}
            layout="workspace"
            stickyActions={false}
          />
        </div>
      ) : null}

      {mode === "manage" && selectedShare ? (
        <div className="mx-auto max-w-[860px] space-y-5">
          <div className="flex items-center justify-between gap-3">
            <Button type="button" variant="ghost" size="sm" onClick={openLinks}>
              <ArrowLeftIcon size={14} /> {t("shares.title", lang)}
            </Button>
            <StatusPill tone={selectedStatus.tone} dot>
              {t(selectedStatus.labelKey, lang)}
            </StatusPill>
          </div>

          <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-control sm:p-5">
            <div className="flex min-w-0 items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate text-[16px] font-semibold">{selectedShare.title || t("sharing.linkLabel", lang)}</h2>
                <p className="mt-1 text-[11px] text-muted-foreground">{t("shares.manage", lang)}</p>
              </div>
              {actionLoading ? (
                <div className="loading-progress-track mt-2 w-12" role="progressbar" aria-label={t("common.loading", lang)}>
                  <span className="loading-progress-indeterminate" />
                </div>
              ) : null}
            </div>

            {(selectedShare.status === "active" || selectedShare.status === "paused") ? (
              <div className="mt-4 rounded-xl bg-surface-subtle p-3 ring-1 ring-inset ring-border/45">
                <p className="truncate select-all font-mono text-[11px] text-foreground/60">{shareUrl(selectedShare.token)}</p>
                <div className="mt-3 flex gap-2">
                  <Button type="button" size="sm" className="flex-1" onClick={() => void copyShare(selectedShare)}>
                    {copiedShareId === selectedShare.id ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                    {copiedShareId === selectedShare.id ? t("shares.copied", lang) : t("shares.copyLink", lang)}
                  </Button>
                  {selectedShare.status === "active" ? (
                    <Button asChild variant="outline" size="sm" className="flex-1">
                      <a href={shareUrl(selectedShare.token)} target="_blank" rel="noreferrer">
                        <ExternalLinkIcon size={14} /> {t("common.open", lang)}
                      </a>
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>

          <section>
            <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.045em] text-muted-foreground">
              {t("shares.analytics", lang)}
            </h3>
            <AnalyticsGrid items={analyticsItems} />
          </section>

          <section>
            <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.045em] text-muted-foreground">
              {t("shares.tableAccess", lang)}
            </h3>
            <dl className="grid overflow-hidden rounded-2xl border border-border/70 bg-card shadow-control sm:grid-cols-2">
              <div className="flex items-center justify-between gap-4 px-4 py-3 text-[12px] sm:border-r sm:border-border/50">
                <dt className="text-muted-foreground">{t("shares.created", lang)}</dt>
                <dd className="text-right font-medium">{formatDate(selectedShare.created_at, dateFormat, lang)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-border/50 px-4 py-3 text-[12px] sm:border-t-0">
                <dt className="text-muted-foreground">{t("shares.tableAccess", lang)}</dt>
                <dd className="min-w-0 truncate text-right font-medium">{fieldSummaryLabel(selectedShare, lang)}</dd>
              </div>
              {selectedExpiry ? (
                <div className="flex items-center justify-between gap-4 border-t border-border/50 px-4 py-3 text-[12px] sm:border-r">
                  <dt className="text-muted-foreground">{t("shares.expires", lang)}</dt>
                  <dd className="inline-flex items-center gap-1.5 text-right font-medium"><ClockIcon size={12} /> {selectedExpiry}</dd>
                </div>
              ) : null}
              {selectedShare.requires_pin ? (
                <div className="flex items-center justify-between gap-4 border-t border-border/50 px-4 py-3 text-[12px]">
                  <dt className="text-muted-foreground">{t("shares.pinProtected", lang)}</dt>
                  <dd><LockIcon size={13} /></dd>
                </div>
              ) : null}
            </dl>
          </section>

          {actionError ? (
            <p role="alert" className="text-[11px] font-medium text-destructive">{t("common.requestFailed", lang)}</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
            {confirmRevoke ? (
              <>
                <span className="mr-auto text-[11px] font-medium text-destructive/75">{t("shares.revokeConfirm", lang)}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmRevoke(false)}>
                  {t("shares.cancel", lang)}
                </Button>
                <Button type="button" variant="destructive" size="sm" disabled={actionLoading} onClick={() => void runAction("revoke")}>
                  {t("shares.revoke", lang)}
                </Button>
              </>
            ) : (
              <>
                {(selectedShare.status === "active" || selectedShare.status === "paused") ? (
                  <Button type="button" size="sm" onClick={editSelectedShare}>{t("shares.editSettings", lang)}</Button>
                ) : null}
                {selectedShare.status === "active" ? (
                  <Button type="button" variant="outline" size="sm" disabled={actionLoading} onClick={() => void runAction("pause")}>
                    {t("shares.pause", lang)}
                  </Button>
                ) : null}
                {selectedShare.status === "paused" ? (
                  <Button type="button" variant="outline" size="sm" disabled={actionLoading} onClick={() => void runAction("resume")}>
                    {t("shares.resume", lang)}
                  </Button>
                ) : null}
                <span className="flex-1" />
                {selectedShare.status !== "revoked" ? (
                  <Button type="button" variant="ghost" size="sm" className="text-foreground/50 hover:bg-destructive/[0.05] hover:text-destructive" onClick={() => setConfirmRevoke(true)}>
                    {t("shares.revoke", lang)}
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
