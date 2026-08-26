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
  LinkIcon,
  LockIcon,
  PlusIcon,
} from "./icons";
import {
  ShareCreateForm,
  defaultContentScope,
  type ShareFormData,
} from "./sharing/share-create-form";
import type { ContentScope } from "./sharing/content-scope-selector";
import { SegmentedControl } from "./segmented-control";
import { SidePanel } from "./side-panel";
import { StatusPill } from "./status-pill";

const LINKS_TIMEOUT_MS = 10_000;
const FEEDBACK_TIMEOUT_MS = 2_500;

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

type SharingView = "links" | "create";

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
  const [editingShare, setEditingShare] = React.useState<ShareData | null>(null);
  const [scope, setScope] = React.useState<ContentScope>(() => (
    defaultContentScope(hasTour, hasPhotos, hasFloorplan)
  ));
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [feedback, setFeedback] = React.useState<ShareFeedback | null>(null);
  const [formVersion, setFormVersion] = React.useState(0);
  const [stats, setStats] = React.useState<ShareStats | null>(null);
  const [actionLoading, setActionLoading] = React.useState(false);
  const [actionError, setActionError] = React.useState(false);
  const [confirmRevoke, setConfirmRevoke] = React.useState(false);
  const [activeView, setActiveView] = React.useState<SharingView>("links");
  const wasOpenRef = React.useRef(false);
  const viewInitializedRef = React.useRef(false);
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
    } catch {
      if (requestId === requestIdRef.current) setLinksError(true);
    } finally {
      if (requestId === requestIdRef.current) setLinksLoading(false);
    }
  }, [draftId]);

  React.useEffect(() => {
    if (!open) {
      // Reset on close, otherwise a remount looks like "already handled" and
      // the panel never asks for links again.
      wasOpenRef.current = false;
      viewInitializedRef.current = false;
      return;
    }
    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      headingRef.current?.focus({ preventScroll: true });
    }
    // Open, nothing loaded, nothing in flight and no error to show means the
    // previous attempt was dropped — ask again rather than sit on a skeleton.
    if (!linksLoaded && !linksLoading && !linksError) void loadLinks();
  }, [linksError, linksLoaded, linksLoading, loadLinks, open]);

  React.useEffect(() => {
    if (!open || !linksLoaded || viewInitializedRef.current) return;
    viewInitializedRef.current = true;
    setActiveView(shares.length > 0 ? "links" : "create");
  }, [linksLoaded, open, shares.length]);

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

  /*
    This cleanup used to bump requestIdRef to cancel in-flight work. React's
    StrictMode runs it on the simulated unmount as well, so the very first
    links fetch came back with a stale id, was discarded, and left the panel
    on "Loading…" permanently. A late setState on an unmounted component is a
    harmless no-op, so the id only needs to advance when a newer loadLinks
    supersedes an older one — which loadLinks already does itself.
  */
  React.useEffect(() => () => {
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

  /** Returns the always-present form to a blank new-link state. */
  const resetForm = React.useCallback(() => {
    setEditingShare(null);
    setFormError(null);
    showFeedback(null);
    setScope(defaultContentScope(hasTour, hasPhotos, hasFloorplan));
    setFormVersion((version) => version + 1);
  }, [hasFloorplan, hasPhotos, hasTour, showFeedback]);

  const showCreateView = React.useCallback(() => {
    resetForm();
    setActiveView("create");
  }, [resetForm]);

  const showLinksView = React.useCallback(() => {
    resetForm();
    setActiveView("links");
  }, [resetForm]);

  const selectShare = React.useCallback((shareId: number) => {
    setSelectedShareId(shareId);
    setFormError(null);
    showFeedback(null);
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
    setActiveView("create");
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
        setScope(defaultContentScope(hasTour, hasPhotos, hasFloorplan));
        setFormVersion((version) => version + 1);
        setActiveView("links");
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
      // The form stays on screen, so hand it back blank for the next link
      // instead of leaving the settings of the one just created.
      setScope(defaultContentScope(hasTour, hasPhotos, hasFloorplan));
      setFormVersion((version) => version + 1);
      setActiveView("links");
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
    hasFloorplan,
    hasPhotos,
    hasTour,
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
        if (remaining.length === 0) setActiveView("create");
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
        resetForm();
        onOpenChange(false);
      }}
      title={t("sharing.pageTitle", lang)}
      description={linksLoaded
        ? `${shares.length} · ${t("shares.title", lang)}`
        : (draft.title || t("dashboard.untitled", lang))}
      headerMode="editor"
      closeIcon="close"
      className="sm:max-w-[640px]"
      initialFocusRef={headingRef}
      lang={lang}
    >
      <div className="sharing-workspace space-y-4">
      <h2 ref={headingRef} tabIndex={-1} className="sr-only outline-none">{t("sharing.pageTitle", lang)}</h2>

      <SegmentedControl
        value={activeView}
        onChange={(view) => {
          if (view === "create") showCreateView();
          else showLinksView();
        }}
        ariaLabel={t("sharing.pageTitle", lang)}
        className="grid w-full grid-cols-2"
        itemClassName="w-full gap-2 text-[12px] font-semibold"
        options={[
          {
            value: "links",
            label: t("shares.title", lang),
            icon: <LinkIcon size={14} />,
            count: linksLoaded ? shares.length : undefined,
          },
          {
            value: "create",
            label: editingShare ? t("shares.editSettings", lang) : t("shares.createLink", lang),
            icon: <PlusIcon size={14} />,
          },
        ]}
      />

      {activeView === "create" ? (
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 px-0.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {t(editingShare ? "shares.editSettings" : "sharing.createNewLink", lang)}
          </h3>
          {editingShare ? (
            <Button type="button" variant="ghost" size="xs" onClick={showLinksView} disabled={saving}>
              {t("common.cancel", lang)}
            </Button>
          ) : null}
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
          onCancelEdit={editingShare ? showLinksView : undefined}
          layout="stacked"
          detailsMode="inline"
          stickyActions={false}
        />
      </section>
      ) : (

      <div className="space-y-4">

      {/*
        A 64px progress hairline alone in an empty panel read as a rendering
        fault rather than as loading. This traces the layout that is about to
        arrive — link rows, then the selected link's card — so nothing shifts
        when it does. Only on the first load: a background refresh already has
        real content on screen and must not replace it with placeholders.
      */}
      {linksLoading && !linksLoaded ? (
        <div className="space-y-4" role="status" aria-busy="true" aria-label={t("common.loading", lang)}>
          <span className="sr-only">{t("common.loading", lang)}</span>
          <div className="grid gap-2" aria-hidden="true">
            <span className="h-[3.75rem] animate-pulse rounded-xl bg-foreground/[0.055] motion-reduce:animate-none" />
            <span className="h-[3.75rem] animate-pulse rounded-xl bg-foreground/[0.035] motion-reduce:animate-none" />
          </div>
          <div aria-hidden="true" className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-control">
            <div className="p-4 sm:p-5">
              <span className="block h-4 w-40 max-w-full animate-pulse rounded-full bg-foreground/[0.06] motion-reduce:animate-none" />
              <span className="mt-2.5 block h-3 w-56 max-w-full animate-pulse rounded-full bg-foreground/[0.04] motion-reduce:animate-none" />
            </div>
            <div className="border-t border-border/50 bg-surface-subtle p-3 sm:px-4">
              <span className="block h-3 w-2/3 animate-pulse rounded-full bg-foreground/[0.05] motion-reduce:animate-none" />
              <div className="mt-3 flex gap-2">
                <span className="h-11 flex-1 animate-pulse rounded-full bg-foreground/[0.06] motion-reduce:animate-none sm:max-w-[10rem]" />
                <span className="h-11 flex-1 animate-pulse rounded-full bg-foreground/[0.04] motion-reduce:animate-none sm:max-w-[8rem]" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 border-t border-border/50 p-4 sm:p-5">
              <span className="h-16 animate-pulse rounded-lg bg-foreground/[0.04] motion-reduce:animate-none" />
              <span className="h-16 animate-pulse rounded-lg bg-foreground/[0.04] motion-reduce:animate-none" />
              <span className="h-16 animate-pulse rounded-lg bg-foreground/[0.04] motion-reduce:animate-none" />
            </div>
          </div>
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
        <nav className="grid gap-2" aria-label={t("shares.title", lang)}>
          {shares.map((share, index) => {
            const selected = share.id === selectedShareId;
            const status = STATUS_CONFIG[share.status] ?? STATUS_CONFIG.revoked;
            const views = `${share.access_count} ${t(share.access_count === 1 ? "shares.viewSingular" : "shares.viewPlural", lang)}`;
            return (
              <div
                key={share.id}
                className={`grid grid-cols-[minmax(0,1fr)_2.75rem] overflow-hidden rounded-xl border transition-colors ${
                  selected
                    ? "border-foreground/25 bg-surface-subtle"
                    : "border-border/65 bg-card hover:border-foreground/20"
                }`}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${t("sharing.linkLabel", lang)} ${index + 1} · ${t(status.labelKey, lang)} · ${views}`}
                  onClick={() => selectShare(share.id)}
                  className="flex min-w-0 items-center gap-3 px-3.5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(share.status)}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[13px] font-semibold">
                        {share.title || `${t("sharing.linkLabel", lang)} ${index + 1}`}
                      </span>
                      <span className="shrink-0 text-[10px] font-medium text-muted-foreground">
                        {t(status.labelKey, lang)}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">
                      {formatDate(share.created_at, dateFormat, lang)} · {views}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void copyShare(share)}
                  className="flex min-h-11 items-center justify-center border-l border-border/55 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  aria-label={`${t("shares.copyLink", lang)}: ${share.title || `${t("sharing.linkLabel", lang)} ${index + 1}`}`}
                  title={t("shares.copyLink", lang)}
                >
                  {feedback?.kind === "copied" && feedback.shareId === share.id
                    ? <CheckIcon size={15} />
                    : <CopyIcon size={15} />}
                </button>
              </div>
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
          </div>

          {/*
            Handing over the link is the whole point of this surface, so copy is
            a full-height primary rather than one of five equal-weight chips.
          */}
          {(selectedShare.status === "active" || selectedShare.status === "paused") ? (
            <div className="border-t border-border/50 bg-surface-subtle p-3 sm:px-4">
              {/*
                The URL is a second copy target. It is the thing being handed
                over, so pressing it is the obvious gesture — and on a phone it
                is a far easier hit than trying to text-select a wrapped URL.
              */}
              <button
                type="button"
                onClick={() => void copyShare(selectedShare)}
                title={t("shares.copyLink", lang)}
                className="block w-full rounded-lg text-left text-[12px] leading-relaxed text-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="block min-w-0 break-all">{shareUrl(selectedShare.token)}</span>
              </button>
              <div className="mt-3 flex gap-2">
                {/*
                  Confirmation stays monochrome — the product has no colour to
                  spend here, and a filled green button was louder than the
                  action it was confirming. The icon and label swap, and the
                  banner above announces it; both revert on the feedback
                  timeout.
                */}
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
            <div className="border-t border-border/50 bg-card/58 p-3 sm:px-4">
              <p className="text-[12px] font-semibold text-destructive">{t("shares.revokeConfirm", lang)}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-foreground/60">{t("shares.revokeConsequence", lang)}</p>
              <div className="mt-3 flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={actionLoading} onClick={() => setConfirmRevoke(false)}>
                  {t("shares.cancel", lang)}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-destructive/22 bg-destructive/[0.045] text-destructive shadow-none hover:bg-destructive/[0.08] hover:text-destructive"
                  disabled={actionLoading}
                  loading={actionLoading}
                  onClick={() => void runAction("revoke")}
                >
                  {t("shares.revoke", lang)}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/50 p-3 sm:px-4">
              {(selectedShare.status === "active" || selectedShare.status === "paused") ? (
                <Button type="button" variant="outline" size="sm" onClick={editSelectedShare}>{t("shares.editSettings", lang)}</Button>
              ) : null}
              {selectedShare.status === "active" ? (
                <Button type="button" variant="outline" size="sm" disabled={actionLoading} loading={actionLoading} onClick={() => void runAction("pause")}>
                  {t("shares.pause", lang)}
                </Button>
              ) : null}
              {selectedShare.status === "paused" ? (
                <Button type="button" variant="outline" size="sm" disabled={actionLoading} loading={actionLoading} onClick={() => void runAction("resume")}>
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
        <div className="flex min-h-40 flex-col items-center justify-center rounded-[1.75rem] border border-dashed border-border/70 bg-card/45 px-6 py-7 text-center">
          <p className="text-[12px] font-medium">{t("shares.noShares", lang)}</p>
          <p className="mx-auto mt-1 max-w-[22rem] text-[11px] leading-relaxed text-muted-foreground">{t("shares.noSharesHint", lang)}</p>
          <Button type="button" size="sm" className="mt-4" onClick={showCreateView}>
            <PlusIcon size={14} /> {t("shares.createLink", lang)}
          </Button>
        </div>
      ) : null}
      </div>
      )}
      </div>
    </SidePanel>
  );
}
