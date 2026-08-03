"use client";

import { useEffect, useState, useCallback, use, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../components/hooks/use-auth";
import { AppShell } from "../../../components/app-shell";
import { Button } from "../../../lib/ui/button";
import {
  getDraft,
  getSplatsByDraft,
  getDraftTourAssets,
  getFloorplan,
  listShares,
  createDraftShare,
  createSplatShare,
  listUnits,
  updateShare,
} from "../../../lib/api/client";
import type { FloorplanDetail } from "../../../lib/api/client";
import { getSafeApiErrorMessage } from "../../../lib/api/error-message";
import { getUserLanguage, t } from "../../../lib/i18n";
import type { DraftDetailItem, DraftTourAssetsPayload, ShareData, SplatsByDraftPayload } from "../../../lib/tour-types";
import { SharePreview } from "../../../components/sharing/share-preview";
import { ShareCreateForm, defaultContentScope, type ShareFormData } from "../../../components/sharing/share-create-form";
import { ShareLinkCard } from "../../../components/sharing/share-link-card";
import type { ContentScope } from "../../../components/sharing/content-scope-selector";
import { PageLoading } from "../../../components/page-loading";
import { copyToClipboard, shareUrl } from "../../../lib/share-ui";
import type { UnitLookup } from "../../../lib/unit-catalog";
import { currentGalleryUploads } from "../../../lib/media";
import { selectShareableTour } from "../../../lib/tour-sharing";

function primaryShareSplat(data: SplatsByDraftPayload | null) {
  if (!data?.splats.length) return null;
  return data.parent_splat_id
    ? data.splats.find((splat) => (splat.splat_id ?? splat.id) === data.parent_splat_id) ?? data.splats[0]
    : data.splats[0];
}

function scopeFromShare(
  share: ShareData,
  capabilities: { tour: boolean; photos: boolean; floorplan: boolean },
): ContentScope {
  const visibleFields = new Set(
    share.fields.filter((field) => field.is_visible).map((field) => field.field_name),
  );
  if (visibleFields.size === 0) {
    // Empty or legacy field sets are displayed fail-closed. Showing the
    // default bundle here would make an old/restricted link look broader than
    // it is and could publish extra content when the owner presses Save.
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

export default function SharingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const draftId = parseInt(id, 10);
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const router = useRouter();
  const lang = getUserLanguage(user?.localization);

  const [draft, setDraft] = useState<DraftDetailItem | null>(null);
  const [splatData, setSplatData] = useState<SplatsByDraftPayload | null>(null);
  const [tourAssets, setTourAssets] = useState<DraftTourAssetsPayload | null>(null);
  const [floorplan, setFloorplan] = useState<FloorplanDetail | null>(null);
  const [shares, setShares] = useState<ShareData[]>([]);
  const [unitCatalog, setUnitCatalog] = useState<UnitLookup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scope, setScope] = useState<ContentScope | null>(null);
  const [editingShare, setEditingShare] = useState<ShareData | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<"copied" | "saved" | null>(null);
  const [copyFailedUrl, setCopyFailedUrl] = useState<string | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const formRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated || isNaN(draftId)) return;
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [d, s, fetchedTourAssets, allShares, fetchedUnits] = await Promise.all([
          getDraft(draftId),
          getSplatsByDraft(draftId).catch(() => null),
          getDraftTourAssets(draftId).catch(() => null),
          // Sharing state is access control, so always revalidate it instead
          // of accepting the ordinary short-lived application cache.
          listShares({ fresh: true }).catch(() => [] as ShareData[]),
          listUnits().catch(() => []),
        ]);
        const fetchedFloorplan = d.floorplan_id
          ? await getFloorplan(d.floorplan_id).catch(() => null)
          : null;
        if (!active) return;
        setDraft(d);
        setSplatData(s);
        setTourAssets(fetchedTourAssets);
        setUnitCatalog(fetchedUnits);
        setFloorplan(fetchedFloorplan);
        const draftShares = (allShares as ShareData[]).filter(
          (sh) => sh.draft === draftId && sh.status !== "revoked"
        );
        setShares(draftShares);

        const preferredSplat = primaryShareSplat(s);
        const preferredSplatId = preferredSplat
          ? (preferredSplat.splat_id ?? preferredSplat.id)
          : null;
        const hasSplat = Boolean(
          selectShareableTour(fetchedTourAssets, preferredSplatId),
        );
        const hasPhotos = currentGalleryUploads(d.raw_uploads ?? [], "image").length > 0;
        const hasFp = !!d.floorplan_id || (d.draft_data ?? []).some(
          (e: { data_key: string }) => e.data_key === "captured_room_json" || e.data_key === "wall_graph_json"
        );
        setScope(defaultContentScope(hasSplat, hasPhotos, hasFp));
      } catch (err) {
        if (active) setError(getSafeApiErrorMessage(err, lang) || "Failed to load");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [isAuthenticated, draftId, lang]);

  const legacyPrimarySplat = primaryShareSplat(splatData);
  const legacyPrimarySplatId = legacyPrimarySplat
    ? (legacyPrimarySplat.splat_id ?? legacyPrimarySplat.id)
    : null;
  const shareableTour = selectShareableTour(tourAssets, legacyPrimarySplatId);
  const hasTour = Boolean(shareableTour);
  const primarySplatId = shareableTour?.source_splat_id ?? undefined;
  const thumbUrl = shareableTour?.thumbnail_url ?? null;
  const fpUrl = floorplan?.composite_url ?? null;
  const hasPhotos = currentGalleryUploads(draft?.raw_uploads ?? [], "image").length > 0;
  const hasFloorplan = !!draft?.floorplan_id || !!fpUrl || (draft?.draft_data ?? []).some(
    (e) => e.data_key === "captured_room_json" || e.data_key === "wall_graph_json"
  );

  const handleSubmit = useCallback(async (formData: ShareFormData) => {
    setFormError(null);
    setSaving(true);
    try {
      if (editingShare) {
        const updatePayload: Parameters<typeof updateShare>[1] & {
          tour_id?: number;
        } = {
          ...formData,
          ...(scope?.tour && shareableTour?.id
            ? { tour_id: shareableTour.id }
            : {}),
        };
        // The preset value 0 means "Never" in the UI. Django intentionally
        // accepts only positive expires_in_hours values, but exposes the
        // nullable expires_at field for clearing an existing expiry.
        if (formData.expires_in_hours === 0) {
          delete updatePayload.expires_in_hours;
          updatePayload.expires_at = null;
        }
        // Leaving an existing PIN blank means keep it; do not ask Django to
        // recreate PIN protection without the original secret.
        if (editingShare.requires_pin && formData.share_type === "pin" && !formData.pin) {
          delete updatePayload.share_type;
        }
        const updated = await updateShare(editingShare.id, updatePayload);
        setShares((current) => current.map((share) => share.id === updated.id ? updated : share));
        setEditingShare(null);
        setScope(defaultContentScope(hasTour, hasPhotos, hasFloorplan));
        setNotice("saved");
        setTimeout(() => setNotice(null), 2000);
        return;
      }
      const s = scope?.tour && primarySplatId
        ? await createSplatShare(primarySplatId, {
            ...formData,
            tour_id: shareableTour?.id,
          })
        : await createDraftShare(draftId, formData);
      setShares((prev) => [s, ...prev]);
      setScope(defaultContentScope(hasTour, hasPhotos, hasFloorplan));
      setFormVersion((version) => version + 1);
      const url = shareUrl(s.token);
      setCopyFailedUrl(null);
      if (await copyToClipboard(url)) {
        setNotice("copied");
        setTimeout(() => setNotice(null), 2000);
      } else {
        // Clipboard blocked — still surface the link with a manual copy action.
        setCopyFailedUrl(url);
      }
    } catch (err) {
      setFormError(getSafeApiErrorMessage(err, lang) || t("shareDialog.errorCreate", lang));
    } finally {
      setSaving(false);
    }
  }, [editingShare, scope?.tour, primarySplatId, shareableTour?.id, draftId, lang, hasTour, hasPhotos, hasFloorplan]);

  const cancelEdit = useCallback(() => {
    setEditingShare(null);
    setFormError(null);
    setScope(defaultContentScope(hasTour, hasPhotos, hasFloorplan));
  }, [hasFloorplan, hasPhotos, hasTour]);

  const handleShareUpdate = useCallback((shareId: number, updated: ShareData | null) => {
    if (!updated) {
      setShares((p) => p.filter((s) => s.id !== shareId));
    } else {
      setShares((p) => p.map((s) => s.id === shareId ? updated : s));
    }
  }, []);

  if (isLoading || (loading && !draft)) {
    return <PageLoading />;
  }

  if (error || !draft || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center space-y-4 max-w-xs">
          <p className="text-[14px] font-medium text-foreground/70">{error || t("draft.error.failedTitle", lang)}</p>
          <Button variant="outline" size="sm" onClick={() => router.push(`/draft/${draftId}`)}>{t("common.goBack", lang)}</Button>
        </div>
      </div>
    );
  }

  const title = draft.title || t("dashboard.untitled", lang);

  return (
    <AppShell user={user} onLogout={logout}>
      <div className="mx-auto w-full max-w-[1320px] pb-8 md:pb-10">
        <header className="mb-5 md:mb-6">
          <button
            type="button"
            onClick={() => router.push(`/draft/${draftId}`)}
            className="floating-control -ml-2 inline-flex items-center gap-1.5 px-3 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {t("common.back", lang)}
          </button>
          <div className="mt-3 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
            <h1 className="text-[28px] font-semibold leading-none tracking-[-0.035em] sm:text-[32px]">
              {t("sharing.pageTitle", lang)}
            </h1>
            <p className="truncate text-[13px] text-muted-foreground sm:max-w-[55vw]">
              {title}
            </p>
          </div>
        </header>

        {/* Two-panel layout */}
        <div className="relative grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,0.96fr)_minmax(29rem,1.04fr)] lg:items-start lg:gap-6">
          {/* Copy banner — absolutely positioned so it never shifts the layout */}
          {notice && (
            <div className="floating-capsule absolute inset-x-0 top-0 z-30 flex items-center gap-2 border border-foreground/15 bg-card/95 px-4 shadow-elevated backdrop-blur-xl animate-fade-in">
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span className="text-[12px] font-medium">{t(notice === "copied" ? "sharing.linkCopied" : "common.saved", lang)}</span>
            </div>
          )}
          {copyFailedUrl && (
            <div className="floating-capsule absolute inset-x-0 top-0 z-10 flex items-center gap-2 border px-4 animate-fade-in">
              <p className="min-w-0 flex-1 truncate select-all font-mono text-[12px] text-foreground/70">{copyFailedUrl}</p>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="shrink-0 text-[11px]"
                onClick={async () => {
                  if (await copyToClipboard(copyFailedUrl)) {
                    setCopyFailedUrl(null);
                    setNotice("copied");
                    setTimeout(() => setNotice(null), 2000);
                  }
                }}
              >
                {t("shares.copyLink", lang)}
              </Button>
            </div>
          )}
          {/* Right panel — Controls (shown first on mobile) */}
          <div className="order-1 space-y-5 lg:order-2">
            {/* Create or edit link */}
            <div ref={formRef} className="scroll-mt-24">
              <div className="mb-3 flex min-h-8 items-center justify-between gap-3 px-1.5">
                <h2 className="text-[16px] font-semibold tracking-[-0.015em]">{t(editingShare ? "shares.editSettings" : "sharing.createNewLink", lang)}</h2>
                {editingShare ? (
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold text-foreground/55">{t("sharing.linkLabel", lang)}</span>
                ) : null}
              </div>
              {scope && (
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
              )}
            </div>

            {/* Active links */}
            {shares.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <h2 className="text-[13px] font-semibold text-foreground/70">
                    {t("sharing.activeLinks", lang)}
                  </h2>
                  <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-foreground/[0.07] px-1.5 text-[11px] font-semibold text-foreground/50 tabular-nums">
                    {shares.length}
                  </span>
                </div>
                {shares.map((share) => (
                  <ShareLinkCard
                    key={share.id}
                    share={share}
                    lang={lang}
                    dateFormat={user.localization?.date_format}
                    onUpdate={(updated) => handleShareUpdate(share.id, updated)}
                    onEdit={() => {
                      setEditingShare(share);
                      setFormError(null);
                      setScope(scopeFromShare(share, { tour: hasTour, photos: hasPhotos, floorplan: hasFloorplan }));
                      requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Left panel — Audience Preview */}
          <div className="order-2 lg:order-1">
            <div className="lg:sticky lg:top-6">
              {scope && (
                <SharePreview
                  draft={draft}
                  scope={scope}
                  hasTour={hasTour}
                  thumbUrl={thumbUrl}
                  hasFloorplan={hasFloorplan}
                  units={unitCatalog}
                  lang={lang}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
