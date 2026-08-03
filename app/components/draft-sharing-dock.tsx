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
  CheckIcon,
  ClockIcon,
  CloseIcon,
  CopyIcon,
  ExternalLinkIcon,
  LockIcon,
  PlusIcon,
} from "./icons";
import {
  ShareCreateForm,
  defaultContentScope,
  type ShareFormData,
} from "./sharing/share-create-form";
import type { ContentScope } from "./sharing/content-scope-selector";
import { SidePanel } from "./side-panel";
import { StatusPill } from "./status-pill";

const LINKS_TIMEOUT_MS = 10_000;

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

function statusDotClass(status: string) {
  if (status === "active") return "bg-emerald-500";
  if (status === "paused") return "bg-amber-500";
  if (status === "expired") return "bg-foreground/30";
  return "bg-destructive";
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeoutId: number | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error("Share links request timed out")), LINKS_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId != null) window.clearTimeout(timeoutId);
  }
}

type DraftSharingDockProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draftId: number;
  draft: DraftDetailItem;
  splatData: SplatsByDraftPayload | null;
  tourAssets: DraftTourAssetsPayload | null;
  lang: string;
  dateFormat?: string | null;
};

export const DraftSharingDock = React.forwardRef<HTMLElement, DraftSharingDockProps>(function DraftSharingDock({
  open,
  onOpenChange,
  draftId,
  draft,
  splatData,
  tourAssets,
  lang,
  dateFormat,
}, forwardedRef) {
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
  const [selectedShareId, setSelectedShareId] = React.useState<number | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [editingShare, setEditingShare] = React.useState<ShareData | null>(null);
  const [scope, setScope] = React.useState<ContentScope>(() => (
    defaultContentScope(hasTour, hasPhotos, hasFloorplan)
  ));
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
  const wasOpenRef = React.useRef(false);
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  const requestIdRef = React.useRef(0);
  const noticeTimerRef = React.useRef<number | null>(null);
  const copyTimerRef = React.useRef<number | null>(null);

  const selectedShare = selectedShareId == null
    ? null
    : shares.find((share) => share.id === selectedShareId) ?? null;

  const loadLinks = React.useCallback(async (fresh = false) => {
    const requestId = ++requestIdRef.current;
    setLinksLoading(true);
    setLinksError(false);
    try {
      const allShares = await withTimeout(listShares(fresh ? { fresh: true } : undefined));
      if (requestId !== requestIdRef.current) return;
      const draftShares = allShares.filter((share) => (
        share.draft === draftId && share.status !== "revoked"
      ));
      setShares(draftShares);
      setLinksLoaded(true);
      setSelectedShareId((current) => (
        current != null && draftShares.some((share) => share.id === current)
          ? current
          : draftShares[0]?.id ?? null
      ));
      if (!draftShares.length) setCreating(true);
    } catch {
      if (requestId === requestIdRef.current) setLinksError(true);
    } finally {
      if (requestId === requestIdRef.current) setLinksLoading(false);
    }
  }, [draftId]);

  React.useEffect(() => {
    const becameOpen = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!becameOpen) return;
    headingRef.current?.focus({ preventScroll: true });
    if (!linksLoaded) void loadLinks();
  }, [linksLoaded, loadLinks, open]);

  React.useEffect(() => {
    const refresh = () => {
      if (open) void loadLinks(true);
    };
    window.addEventListener("reai-shares-updated", refresh);
    return () => window.removeEventListener("reai-shares-updated", refresh);
  }, [loadLinks, open]);

  React.useEffect(() => {
    setStats(null);
    setActionError(false);
    setConfirmRevoke(false);
    if (!open || selectedShareId == null) return;
    let current = true;
    void getShareAnalytics(selectedShareId)
      .then((response) => {
        if (current) setStats(response.stats);
      })
      .catch(() => {
        if (current) setActionError(true);
      });
    return () => { current = false; };
  }, [open, selectedShareId]);

  React.useEffect(() => () => {
    requestIdRef.current += 1;
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

  const openCreate = React.useCallback(() => {
    setCreating(true);
    setEditingShare(null);
    setFormError(null);
    setCopyFailedUrl(null);
    setScope(defaultContentScope(hasTour, hasPhotos, hasFloorplan));
    setFormVersion((version) => version + 1);
  }, [hasFloorplan, hasPhotos, hasTour]);

  const selectShare = React.useCallback((shareId: number) => {
    setSelectedShareId(shareId);
    setCreating(false);
    setEditingShare(null);
    setFormError(null);
    setCopyFailedUrl(null);
  }, []);

  const cancelCreate = React.useCallback(() => {
    setEditingShare(null);
    setFormError(null);
    setCopyFailedUrl(null);
    setCreating(false);
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
    setCreating(true);
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
        setCreating(false);
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
      setCreating(false);
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
        const remaining = shares.filter((share) => share.id !== selectedShare.id);
        setShares(remaining);
        setSelectedShareId(remaining[0]?.id ?? null);
        if (!remaining.length) setCreating(true);
      }
    } catch {
      setActionError(true);
    } finally {
      setActionLoading(false);
      setConfirmRevoke(false);
    }
  }, [selectedShare, shares]);

  if (!open) return null;

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
    <>
      <section
        ref={forwardedRef}
        aria-labelledby="draft-sharing-title"
        className="mt-8 scroll-mt-5 border-y border-border/70 py-5 animate-fade-in sm:py-6"
      >
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2
            ref={headingRef}
            id="draft-sharing-title"
            tabIndex={-1}
            className="text-[16px] font-semibold tracking-[-0.015em] outline-none"
          >
            {t("sharing.pageTitle", lang)}
          </h2>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {linksLoaded
              ? `${shares.length} · ${t("shares.title", lang)}`
              : draft.title || t("dashboard.untitled", lang)}
          </p>
          {linksLoading ? (
            <div className="loading-progress-track mt-3 w-16" role="progressbar" aria-label={t("common.loading", lang)}>
              <span className="loading-progress-indeterminate" />
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {shares.length || linksError ? (
            <Button type="button" variant="outline" size="sm" onClick={openCreate}>
              <PlusIcon size={13} /> {t("shares.createLink", lang)}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("common.close", lang)}
            onClick={() => {
              cancelCreate();
              onOpenChange(false);
            }}
          >
            <CloseIcon size={15} />
          </Button>
        </div>
      </header>

      {notice ? (
        <div role="status" className="mt-4 rounded-xl bg-surface-subtle px-3 py-2 text-[11px] font-medium text-foreground/65">
          {t(notice === "copied" ? "sharing.linkCopied" : "common.saved", lang)}
        </div>
      ) : null}

      {linksError && !shares.length ? (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-card px-4 py-3">
          <p className="text-[12px] text-muted-foreground">{t("shares.loadFailed", lang)}</p>
          <Button type="button" variant="outline" size="xs" onClick={() => void loadLinks(true)}>
            {t("common.tryAgain", lang)}
          </Button>
        </div>
      ) : null}

      {shares.length ? (
        <nav className="mt-5 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide" aria-label={t("shares.title", lang)}>
          {shares.map((share, index) => {
            const selected = share.id === selectedShareId;
            return (
              <button
                key={share.id}
                type="button"
                aria-pressed={selected}
                onClick={() => selectShare(share.id)}
                className={`floating-control min-w-fit gap-2 px-3 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  selected
                    ? "bg-foreground text-background shadow-sm"
                    : "border border-border/70 bg-card text-foreground/60 hover:bg-accent hover:text-foreground"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${selected ? "bg-background/75" : statusDotClass(share.status)}`} aria-hidden="true" />
                {t("sharing.linkLabel", lang)} {index + 1}
                <span className={selected ? "text-background/60" : "text-foreground/35"}>{share.access_count}</span>
              </button>
            );
          })}
        </nav>
      ) : null}

      {copyFailedUrl ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-border/70 bg-card p-2.5">
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

      {selectedShare ? (
        <div className="mt-4 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-control">
          <div className="flex min-w-0 items-start justify-between gap-4 p-4 sm:p-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-[14px] font-semibold">{selectedShare.title || t("sharing.linkLabel", lang)}</h3>
                <StatusPill tone={selectedStatus.tone} dot className="shrink-0">
                  {t(selectedStatus.labelKey, lang)}
                </StatusPill>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {formatDate(selectedShare.created_at, dateFormat, lang)} · {fieldSummaryLabel(selectedShare, lang)}
              </p>
            </div>
            {actionLoading ? (
              <div className="loading-progress-track mt-2 w-12" role="progressbar" aria-label={t("common.loading", lang)}>
                <span className="loading-progress-indeterminate" />
              </div>
            ) : null}
          </div>

          {(selectedShare.status === "active" || selectedShare.status === "paused") ? (
            <div className="border-t border-border/50 bg-surface-subtle p-3 sm:flex sm:items-center sm:gap-3 sm:px-4">
              <p className="min-w-0 flex-1 truncate select-all font-mono text-[11px] text-foreground/60">{shareUrl(selectedShare.token)}</p>
              <div className="mt-3 flex shrink-0 gap-2 sm:mt-0">
                <Button type="button" size="xs" onClick={() => void copyShare(selectedShare)}>
                  {copiedShareId === selectedShare.id ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                  {copiedShareId === selectedShare.id ? t("shares.copied", lang) : t("shares.copyLink", lang)}
                </Button>
                {selectedShare.status === "active" ? (
                  <Button asChild variant="outline" size="xs">
                    <a href={shareUrl(selectedShare.token)} target="_blank" rel="noreferrer">
                      <ExternalLinkIcon size={13} /> {t("common.open", lang)}
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 border-t border-border/50 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <AnalyticsGrid items={analyticsItems} />
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-foreground/50 md:max-w-[15rem] md:justify-end">
              {selectedExpiry ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-subtle px-2.5 py-1.5"><ClockIcon size={11} /> {selectedExpiry}</span>
              ) : null}
              {selectedShare.requires_pin ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-subtle px-2.5 py-1.5"><LockIcon size={11} /> {t("shares.pinProtected", lang)}</span>
              ) : null}
              {selectedShare.max_access_count ? (
                <span className="rounded-full bg-surface-subtle px-2.5 py-1.5">{t("shares.viewLimit", lang)} · {selectedShare.max_access_count}</span>
              ) : null}
            </div>
          </div>

          {actionError ? (
            <p role="alert" className="border-t border-border/50 px-4 py-2.5 text-[11px] font-medium text-destructive">{t("common.requestFailed", lang)}</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-border/50 p-3 sm:px-4">
            {confirmRevoke ? (
              <>
                <span className="mr-auto text-[11px] font-medium text-destructive/75">{t("shares.revokeConfirm", lang)}</span>
                <Button type="button" variant="ghost" size="xs" onClick={() => setConfirmRevoke(false)}>
                  {t("shares.cancel", lang)}
                </Button>
                <Button type="button" variant="destructive" size="xs" disabled={actionLoading} onClick={() => void runAction("revoke")}>
                  {t("shares.revoke", lang)}
                </Button>
              </>
            ) : (
              <>
                {(selectedShare.status === "active" || selectedShare.status === "paused") ? (
                  <Button type="button" size="xs" onClick={editSelectedShare}>{t("shares.editSettings", lang)}</Button>
                ) : null}
                {selectedShare.status === "active" ? (
                  <Button type="button" variant="outline" size="xs" disabled={actionLoading} onClick={() => void runAction("pause")}>
                    {t("shares.pause", lang)}
                  </Button>
                ) : null}
                {selectedShare.status === "paused" ? (
                  <Button type="button" variant="outline" size="xs" disabled={actionLoading} onClick={() => void runAction("resume")}>
                    {t("shares.resume", lang)}
                  </Button>
                ) : null}
                <span className="flex-1" />
                {selectedShare.status !== "revoked" ? (
                  <Button type="button" variant="ghost" size="xs" className="text-foreground/45 hover:bg-destructive/[0.05] hover:text-destructive" onClick={() => setConfirmRevoke(true)}>
                    {t("shares.revoke", lang)}
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : linksLoaded && !linksError ? (
        <div className="mt-5 rounded-xl border border-dashed border-border/70 px-5 py-7 text-center">
          <p className="text-[12px] font-medium">{t("shares.noShares", lang)}</p>
          <Button type="button" size="sm" className="mt-3" onClick={openCreate}>
            <PlusIcon size={13} /> {t("shares.createLink", lang)}
          </Button>
        </div>
      ) : null}
      </section>

      <SidePanel
        open={creating}
        onOpenChange={(nextOpen) => {
          if (nextOpen) setCreating(true);
          else cancelCreate();
        }}
        title={t(editingShare ? "shares.editSettings" : "sharing.createNewLink", lang)}
        description={draft.title || t("dashboard.untitled", lang)}
        headerMode="editor"
        closeIcon="back"
        className="sm:max-w-[580px]"
        contentClassName="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-4"
        lang={lang}
      >
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
          onCancelEdit={editingShare ? cancelCreate : undefined}
          layout="stacked"
          detailsMode="inline"
          stickyActions
          stickyActionsAtPanelEdge
        />
      </SidePanel>
    </>
  );
});
