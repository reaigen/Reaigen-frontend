"use client";

import * as React from "react";

import {
  createDraftShare,
  createSplatShare,
  listShares,
  updateShare,
} from "../lib/api/client";
import { getSafeApiErrorMessage } from "../lib/api/error-message";
import { t } from "../lib/i18n";
import { copyToClipboard, shareUrl } from "../lib/share-ui";
import { selectShareableTour } from "../lib/tour-sharing";
import type {
  DraftDetailItem,
  DraftTourAssetsPayload,
  ShareData,
  SplatsByDraftPayload,
} from "../lib/tour-types";
import { currentGalleryUploads } from "../lib/media";
import { Button } from "../lib/ui/button";
import { CollectionLoading } from "./collection-loading";
import { ShareManagementPanel, ShareManagementRow } from "./share-management-card";
import {
  ShareCreateForm,
  defaultContentScope,
  type ShareFormData,
} from "./sharing/share-create-form";
import type { ContentScope } from "./sharing/content-scope-selector";
import { SidePanel } from "./side-panel";

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

export function DraftSharingPanel({
  open,
  onOpenChange,
  draftId,
  draft,
  splatData,
  tourAssets,
  lang,
  dateFormat,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draftId: number;
  draft: DraftDetailItem;
  splatData: SplatsByDraftPayload | null;
  tourAssets: DraftTourAssetsPayload | null;
  lang: string;
  dateFormat?: string;
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
  const title = draft.title || t("dashboard.untitled", lang);

  const [shares, setShares] = React.useState<ShareData[]>([]);
  const [linksLoading, setLinksLoading] = React.useState(false);
  const [linksError, setLinksError] = React.useState(false);
  const [scope, setScope] = React.useState<ContentScope>(() => (
    defaultContentScope(hasTour, hasPhotos, hasFloorplan)
  ));
  const [editingShare, setEditingShare] = React.useState<ShareData | null>(null);
  const [selectedShareId, setSelectedShareId] = React.useState<number | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<"copied" | "saved" | null>(null);
  const [copyFailedUrl, setCopyFailedUrl] = React.useState<string | null>(null);
  const [formVersion, setFormVersion] = React.useState(0);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const formRef = React.useRef<HTMLDivElement | null>(null);
  const panelOpenRef = React.useRef(false);

  const loadLinks = React.useCallback(async () => {
    setLinksLoading(true);
    setLinksError(false);
    try {
      const allShares = await listShares({ fresh: true });
      setShares(allShares.filter((share) => (
        share.draft === draftId && share.status !== "revoked"
      )));
    } catch {
      setLinksError(true);
    } finally {
      setLinksLoading(false);
    }
  }, [draftId]);

  React.useEffect(() => {
    const wasOpen = panelOpenRef.current;
    panelOpenRef.current = open;
    if (!open) {
      setEditingShare(null);
      setSelectedShareId(null);
      setFormError(null);
      setNotice(null);
      setCopyFailedUrl(null);
      return;
    }
    if (wasOpen) return;
    setScope(defaultContentScope(hasTour, hasPhotos, hasFloorplan));
    void loadLinks();
  }, [hasFloorplan, hasPhotos, hasTour, loadLinks, open]);

  const showNotice = React.useCallback((value: "copied" | "saved") => {
    setNotice(value);
    window.setTimeout(() => setNotice((current) => current === value ? null : current), 2_000);
  }, []);

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
        setEditingShare(null);
        setScope(defaultContentScope(hasTour, hasPhotos, hasFloorplan));
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
      setScope(defaultContentScope(hasTour, hasPhotos, hasFloorplan));
      setFormVersion((version) => version + 1);
      const url = shareUrl(created.token);
      setCopyFailedUrl(null);
      if (await copyToClipboard(url)) {
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
    hasFloorplan,
    hasPhotos,
    hasTour,
    lang,
    primarySplatId,
    scope.tour,
    shareableTour?.id,
    showNotice,
  ]);

  const cancelEdit = React.useCallback(() => {
    setEditingShare(null);
    setFormError(null);
    setScope(defaultContentScope(hasTour, hasPhotos, hasFloorplan));
  }, [hasFloorplan, hasPhotos, hasTour]);

  const handleShareUpdate = React.useCallback((shareId: number, updated: ShareData | null) => {
    if (!updated) {
      setShares((current) => current.filter((share) => share.id !== shareId));
      setSelectedShareId((current) => current === shareId ? null : current);
      return;
    }
    setShares((current) => current.map((share) => (
      share.id === shareId ? updated : share
    )));
  }, []);

  const selectedShare = selectedShareId == null
    ? null
    : shares.find((share) => share.id === selectedShareId) ?? null;

  return (
    <>
      <SidePanel
        open={open}
        onOpenChange={onOpenChange}
        title={t("sharing.pageTitle", lang)}
        description={title}
        lang={lang}
        headerMode="editor"
        className="sm:max-w-[640px]"
        contentClassName="space-y-6"
        contentRef={contentRef}
      >
        {notice ? (
          <div role="status" className="rounded-xl border border-border/60 bg-card px-3 py-2 text-[12px] font-medium text-foreground/70">
            {t(notice === "copied" ? "sharing.linkCopied" : "common.saved", lang)}
          </div>
        ) : null}

        {copyFailedUrl ? (
          <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-card p-2.5">
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

        <section ref={formRef} className="scroll-mt-4">
          <div className="mb-3 flex min-h-8 items-center justify-between gap-3 px-1">
            <h2 className="text-[14px] font-semibold tracking-[-0.01em]">
              {t(editingShare ? "shares.editSettings" : "sharing.createNewLink", lang)}
            </h2>
            {editingShare ? (
              <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold text-foreground/55">
                {t("sharing.linkLabel", lang)}
              </span>
            ) : null}
          </div>
          <ShareCreateForm
            key={formVersion}
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
            onCancelEdit={cancelEdit}
          />
        </section>

        <section>
          <div className="mb-2.5 flex items-center gap-2 px-1">
            <h2 className="text-[13px] font-semibold text-foreground/70">
              {t("sharing.activeLinks", lang)}
            </h2>
            {!linksLoading ? (
              <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-foreground/[0.07] px-1.5 text-[11px] font-semibold text-foreground/50 tabular-nums">
                {shares.length}
              </span>
            ) : null}
          </div>
          {linksLoading ? (
            <CollectionLoading label={t("common.loading", lang)} className="min-h-20 pt-4" />
          ) : linksError ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5">
              <p className="text-[12px] text-muted-foreground">{t("shares.loadFailed", lang)}</p>
              <Button type="button" variant="outline" size="xs" onClick={() => void loadLinks()}>
                {t("common.tryAgain", lang)}
              </Button>
            </div>
          ) : shares.length ? (
            <div className="max-h-[15rem] divide-y divide-border/60 overflow-y-auto rounded-2xl border border-border/70 bg-card scrollbar-thin">
              {shares.map((share) => (
                <ShareManagementRow
                  key={share.id}
                  share={share}
                  title={share.title || t("sharing.linkLabel", lang)}
                  lang={lang}
                  dateFormat={dateFormat}
                  onManage={() => setSelectedShareId(share.id)}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-border/60 px-4 py-6 text-center text-[12px] text-muted-foreground">
              {t("shares.noShares", lang)}
            </p>
          )}
        </section>
      </SidePanel>

      <ShareManagementPanel
        open={selectedShare != null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSelectedShareId(null);
        }}
        share={selectedShare}
        title={selectedShare?.title || title}
        tourLink={`/draft/${draftId}`}
        lang={lang}
        dateFormat={dateFormat}
        onUpdate={(updated) => {
          if (selectedShare) handleShareUpdate(selectedShare.id, updated);
        }}
        onEdit={() => {
          if (!selectedShare) return;
          setEditingShare(selectedShare);
          setFormError(null);
          setScope(scopeFromShare(selectedShare, {
            tour: hasTour,
            photos: hasPhotos,
            floorplan: hasFloorplan,
          }));
          setSelectedShareId(null);
          window.requestAnimationFrame(() => {
            formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }}
      />
    </>
  );
}
