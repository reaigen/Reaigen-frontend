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
const FEEDBACK_TIMEOUT_MS = 2_500;
const SHARE_FORM_ID = "draft-share-form";

/**
 * One channel for every "did that work?" answer in this surface. Copying,
 * saving and a blocked clipboard used to render through three independent
 * states in three different places, so a single create could report success
 * three times in three visual languages.
 */
type ShareFeedback =
  | { kind: "copied"; shareId: number }
  | { kind: "saved" }
  | { kind: "copyFailed"; url: string };

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

export function DraftSharingDock({
  open,
  onOpenChange,
  draftId,
  draft,
  splatData,
  tourAssets,
  lang,
  dateFormat,
}: DraftSharingDockProps) {
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
  const [feedback, setFeedback] = React.useState<ShareFeedback | null>(null);
  const [formVersion, setFormVersion] = React.useState(0);
  const [formValid, setFormValid] = React.useState(true);
  const [stats, setStats] = React.useState<ShareStats | null>(null);
  const [actionLoading, setActionLoading] = React.useState(false);
  const [actionError, setActionError] = React.useState(false);
  const [confirmRevoke, setConfirmRevoke] = React.useState(false);
  const wasOpenRef = React.useRef(false);
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  const requestIdRef = React.useRef(0);
  const feedbackTimerRef = React.useRef<number | null>(null);

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
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
  }, []);

  /**
   * A blocked clipboard is the one result that needs to persist — it hands the
   * user a URL to copy by hand. Successes clear themselves.
   */
  const showFeedback = React.useCallback((next: ShareFeedback | null) => {
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    setFeedback(next);
    if (next && next.kind !== "copyFailed") {
      feedbackTimerRef.current = window.setTimeout(() => setFeedback(null), FEEDBACK_TIMEOUT_MS);
    }
  }, []);

  const copyShare = React.useCallback(async (share: ShareData) => {
    const url = shareUrl(share.token);
    showFeedback(
      await copyToClipboard(url)
        ? { kind: "copied", shareId: share.id }
        : { kind: "copyFailed", url },
    );
  }, [showFeedback]);

  const openCreate = React.useCallback(() => {
    setCreating(true);
    setEditingShare(null);
    setFormError(null);
    showFeedback(null);
    setScope(defaultContentScope(hasTour, hasPhotos, hasFloorplan));
    setFormVersion((version) => version + 1);
  }, [hasFloorplan, hasPhotos, hasTour, showFeedback]);

  const selectShare = React.useCallback((shareId: number) => {
    setSelectedShareId(shareId);
    setCreating(false);
    setEditingShare(null);
    setFormError(null);
    showFeedback(null);
  }, [showFeedback]);

  const cancelCreate = React.useCallback(() => {
    setEditingShare(null);
    setFormError(null);
    showFeedback(null);
    setCreating(false);
  }, [showFeedback]);

  const editSelectedShare = React.useCallback(() => {
    if (!selectedShare) return;
    setEditingShare(selectedShare);
    setFormError(null);
    showFeedback(null);
    setScope(scopeFromShare(selectedShare, {
      tour: hasTour,
      photos: hasPhotos,
      floorplan: hasFloorplan,
    }));
    setFormVersion((version) => version + 1);
    setCreating(true);
  }, [hasFloorplan, hasPhotos, hasTour, selectedShare, showFeedback]);

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
        showFeedback({ kind: "saved" });
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
      await copyShare(created);
    } catch (error) {
      setFormError(
        getSafeApiErrorMessage(error, lang)
        || t("shareDialog.errorCreate", lang),
      );
    } finally {
      setSaving(false);
    }
  }, [
    copyShare,
    draftId,
    editingShare,
    lang,
    primarySplatId,
    scope.tour,
    shareableTour?.id,
    showFeedback,
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
  const justCopied = feedback?.kind === "copied" && feedback.shareId === selectedShare?.id;
  const analyticsItems: AnalyticsGridItem[] = selectedShare ? [
    { label: t("shareDialog.analytics.totalViews", lang), value: stats?.total_accesses ?? selectedShare.access_count },
    { label: t("shareDialog.analytics.uniqueVisitors", lang), value: stats?.unique_ips ?? "—" },
    { label: t("shareDialog.analytics.authenticated", lang), value: stats?.authenticated_accesses ?? "—" },
    ...(selectedShare.requires_pin
      ? [{ label: t("shareDialog.analytics.failedPins", lang), value: stats?.failed_pin_attempts ?? "—" }]
      : []),
  ] : [];

  /*
   * Sharing is a task, not a passage of the listing: it used to render as an
   * inline section wedged between the gallery and the tour list, where a close
   * button sat over page content that never went away. It now owns a panel, and
   * the create form is a second view inside that same panel rather than a
   * dialog stacked on a dialog.
   */
  return (
    <SidePanel
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) return;
        cancelCreate();
        onOpenChange(false);
      }}
      title={t(creating ? (editingShare ? "shares.editSettings" : "sharing.createNewLink") : "sharing.pageTitle", lang)}
      description={creating
        ? (draft.title || t("dashboard.untitled", lang))
        : (linksLoaded ? `${shares.length} · ${t("shares.title", lang)}` : (draft.title || t("dashboard.untitled", lang)))}
      headerMode="editor"
      closeIcon={creating ? "back" : "close"}
      onBack={creating ? cancelCreate : undefined}
      headerAction={!creating && (shares.length > 0 || linksError) ? (
        <Button type="button" variant="ghost" size="icon" aria-label={t("shares.createLink", lang)} onClick={openCreate}>
          <PlusIcon size={18} />
        </Button>
      ) : undefined}
      className="sm:max-w-[580px]"
      lang={lang}
      footer={creating ? (
        <div className="flex w-full gap-2">
          {editingShare ? (
            <Button type="button" variant="outline" className="flex-1" onClick={cancelCreate} disabled={saving}>
              {t("common.cancel", lang)}
            </Button>
          ) : null}
          <Button type="submit" form={SHARE_FORM_ID} className="flex-1" disabled={saving || !formValid} loading={saving}>
            {t(editingShare ? "shareDialog.save" : "sharing.createAndCopy", lang)}
          </Button>
        </div>
      ) : undefined}
    >
      {creating ? (
        <ShareCreateForm
          key={`${editingShare?.id ?? "new"}-${formVersion}`}
          formId={SHARE_FORM_ID}
          onValidityChange={setFormValid}
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
          layout="stacked"
          detailsMode="inline"
        />
      ) : (
      <div className="space-y-4">
      <h2 ref={headingRef} tabIndex={-1} className="sr-only outline-none">{t("sharing.pageTitle", lang)}</h2>

      {linksLoading ? (
        <div className="loading-progress-track w-16" role="progressbar" aria-label={t("common.loading", lang)}>
          <span className="loading-progress-indeterminate" />
        </div>
      ) : null}

      {feedback && feedback.kind !== "copyFailed" ? (
        <div role="status" className="flex items-center gap-2 rounded-xl bg-surface-subtle px-3 py-2 text-[11px] font-medium text-foreground/70">
          <CheckIcon size={13} />
          {t(feedback.kind === "copied" ? "sharing.linkCopied" : "common.saved", lang)}
        </div>
      ) : null}

      {linksError && !shares.length ? (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-card px-4 py-3">
          <p className="text-[12px] text-muted-foreground">{t("shares.loadFailed", lang)}</p>
          <Button type="button" variant="outline" size="xs" onClick={() => void loadLinks(true)}>
            {t("common.tryAgain", lang)}
          </Button>
        </div>
      ) : null}

      {shares.length ? (
        <nav className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide" aria-label={t("shares.title", lang)}>
          {shares.map((share, index) => {
            const selected = share.id === selectedShareId;
            const status = STATUS_CONFIG[share.status] ?? STATUS_CONFIG.revoked;
            const views = `${share.access_count} ${t(share.access_count === 1 ? "shares.viewSingular" : "shares.viewPlural", lang)}`;
            return (
              <button
                key={share.id}
                type="button"
                aria-pressed={selected}
                // The chip is too small for status and view wording, but a
                // bare trailing number reads as an ID unless it's spelled out.
                aria-label={`${t("sharing.linkLabel", lang)} ${index + 1} · ${t(status.labelKey, lang)} · ${views}`}
                title={`${t(status.labelKey, lang)} · ${views}`}
                onClick={() => selectShare(share.id)}
                className={`floating-control min-w-fit gap-2 px-3 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  selected
                    ? "bg-foreground text-background shadow-sm"
                    : "border border-border/70 bg-card text-foreground/60 hover:bg-accent hover:text-foreground"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${selected ? "bg-background/75" : statusDotClass(share.status)}`} aria-hidden="true" />
                <span aria-hidden="true">{t("sharing.linkLabel", lang)} {index + 1}</span>
                <span aria-hidden="true" className={selected ? "text-background/60" : "text-foreground/35"}>{share.access_count}</span>
              </button>
            );
          })}
        </nav>
      ) : null}

      {feedback?.kind === "copyFailed" ? (
        <div role="alert" className="rounded-xl border border-border/70 bg-card p-3">
          <p className="text-[11px] font-medium text-foreground/70">{t("sharing.copyManualHint", lang)}</p>
          <p className="mt-2 select-all break-all rounded-lg bg-surface-subtle px-2.5 py-2 text-[12px] leading-relaxed text-foreground/75">
            {feedback.url}
          </p>
        </div>
      ) : null}

      {selectedShare ? (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-control">
          <div className="flex min-w-0 items-start justify-between gap-4 p-4 sm:p-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-[14px] font-semibold">{selectedShare.title || t("sharing.linkLabel", lang)}</h3>
                <StatusPill tone={selectedStatus.tone} dot className="shrink-0">
                  {t(selectedStatus.labelKey, lang)}
                </StatusPill>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {formatDate(selectedShare.created_at, dateFormat, lang)} · {fieldSummaryLabel(selectedShare, lang)}
              </p>
            </div>
            {actionLoading ? (
              <div className="loading-progress-track mt-2 w-12" role="progressbar" aria-label={t("common.loading", lang)}>
                <span className="loading-progress-indeterminate" />
              </div>
            ) : null}
          </div>

          {/*
            Handing over the link is the whole point of this surface, so copy is
            a full-height primary rather than one of five equal-weight chips.
          */}
          {(selectedShare.status === "active" || selectedShare.status === "paused") ? (
            <div className="border-t border-border/50 bg-surface-subtle p-3 sm:px-4">
              <p className="min-w-0 select-all break-all text-[12px] leading-relaxed text-foreground/60">
                {shareUrl(selectedShare.token)}
              </p>
              <div className="mt-3 flex gap-2">
                <Button type="button" onClick={() => void copyShare(selectedShare)} className="flex-1 sm:flex-none sm:min-w-[10rem]">
                  {justCopied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
                  {justCopied ? t("shares.copied", lang) : t("shares.copyLink", lang)}
                </Button>
                {selectedShare.status === "active" ? (
                  <Button asChild variant="outline" className="flex-1 sm:flex-none">
                    <a href={shareUrl(selectedShare.token)} target="_blank" rel="noreferrer">
                      <ExternalLinkIcon size={15} /> {t("common.open", lang)}
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 border-t border-border/50 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <AnalyticsGrid items={analyticsItems} />
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-foreground/50 md:max-w-[15rem] md:justify-end">
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

          {/*
            Deleting a live link is unrecoverable, so confirmation takes over the
            whole bar and states the consequence instead of sitting inline beside
            the routine actions it could be mistaken for.
          */}
          {confirmRevoke ? (
            <div className="border-t border-border/50 bg-destructive/[0.035] p-3 sm:px-4">
              <p className="text-[12px] font-semibold text-destructive">{t("shares.revokeConfirm", lang)}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-foreground/60">{t("shares.revokeConsequence", lang)}</p>
              <div className="mt-3 flex gap-2">
                <Button type="button" variant="destructive" size="sm" disabled={actionLoading} loading={actionLoading} onClick={() => void runAction("revoke")}>
                  {t("shares.revoke", lang)}
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={actionLoading} onClick={() => setConfirmRevoke(false)}>
                  {t("shares.cancel", lang)}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/50 p-3 sm:px-4">
              {(selectedShare.status === "active" || selectedShare.status === "paused") ? (
                <Button type="button" variant="outline" size="sm" onClick={editSelectedShare}>{t("shares.editSettings", lang)}</Button>
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
                <Button type="button" variant="ghost" size="sm" className="text-foreground/45 hover:bg-destructive/[0.05] hover:text-destructive" onClick={() => setConfirmRevoke(true)}>
                  {t("shares.revoke", lang)}
                </Button>
              ) : null}
            </div>
          )}
        </div>
      ) : linksLoaded && !linksError ? (
        <div className="rounded-2xl border border-dashed border-border/70 px-5 py-9 text-center">
          <p className="text-[12px] font-medium">{t("shares.noShares", lang)}</p>
          <p className="mx-auto mt-1 max-w-[22rem] text-[11px] leading-relaxed text-muted-foreground">{t("shares.noSharesHint", lang)}</p>
          <Button type="button" className="mt-4" onClick={openCreate}>
            <PlusIcon size={15} /> {t("shares.createLink", lang)}
          </Button>
        </div>
      ) : null}

      {/*
        Adding a second link is a first-class action, not a header affordance —
        the icon in the title bar is a shortcut, this is the one you can hit.
      */}
      {shares.length ? (
        <Button type="button" variant="outline" size="lg" className="w-full" onClick={openCreate}>
          <PlusIcon size={16} /> {t("sharing.createNewLink", lang)}
        </Button>
      ) : null}
      </div>
      )}
    </SidePanel>
  );
}
