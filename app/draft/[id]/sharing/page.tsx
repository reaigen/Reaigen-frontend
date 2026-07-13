"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../components/hooks/use-auth";
import { AppShell } from "../../../components/app-shell";
import { Button } from "../../../lib/ui/button";
import {
  getDraft,
  getSplatsByDraft,
  getFloorplan,
  listShares,
  createDraftShare,
  createSplatShare,
} from "../../../lib/api/client";
import type { FloorplanDetail } from "../../../lib/api/client";
import { getSafeApiErrorMessage } from "../../../lib/api/error-message";
import { getUserLanguage, t } from "../../../lib/i18n";
import type { DraftDetailItem, ShareData, SplatsByDraftPayload } from "../../../lib/tour-types";
import { SharePreview } from "../../../components/sharing/share-preview";
import { ShareCreateForm, defaultContentScope, type ShareFormData } from "../../../components/sharing/share-create-form";
import { ShareLinkCard } from "../../../components/sharing/share-link-card";
import type { ContentScope } from "../../../components/sharing/content-scope-selector";
import { PageLoading } from "../../../components/page-loading";

async function copyToClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export default function SharingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const draftId = parseInt(id, 10);
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const router = useRouter();
  const lang = getUserLanguage(user?.localization);

  const [draft, setDraft] = useState<DraftDetailItem | null>(null);
  const [splatData, setSplatData] = useState<SplatsByDraftPayload | null>(null);
  const [floorplan, setFloorplan] = useState<FloorplanDetail | null>(null);
  const [shares, setShares] = useState<ShareData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scope, setScope] = useState<ContentScope | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justCopied, setJustCopied] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated || isNaN(draftId)) return;
    setLoading(true);
    Promise.all([
      getDraft(draftId),
      getSplatsByDraft(draftId).catch(() => null),
      listShares().catch(() => [] as ShareData[]),
    ]).then(([d, s, allShares]) => {
      setDraft(d);
      setSplatData(s);
      const draftShares = (allShares as ShareData[]).filter(
        (sh) => sh.draft === draftId && sh.status !== "revoked"
      );
      setShares(draftShares);
      if (d.floorplan_id) getFloorplan(d.floorplan_id).then(setFloorplan).catch(() => {});

      const hasSplat = !!(s?.splats?.length);
      const hasPhotos = (d.raw_uploads ?? []).some(
        (u: { mime_type?: string; asset_type?: string }) => u.mime_type?.startsWith("image") || u.asset_type === "photo"
      );
      const hasFp = !!d.floorplan_id || (d.draft_data ?? []).some(
        (e: { data_key: string }) => e.data_key === "captured_room_json" || e.data_key === "wall_graph_json"
      );
      setScope(defaultContentScope(hasSplat, hasPhotos, hasFp));
    }).catch((err) => {
      setError(getSafeApiErrorMessage(err, lang) || "Failed to load");
    }).finally(() => setLoading(false));
  }, [isAuthenticated, draftId, lang]);

  const primarySplat = splatData?.parent_splat_id
    ? splatData.splats.find((s) => (s.splat_id ?? s.id) === splatData.parent_splat_id) ?? splatData.splats[0]
    : splatData?.splats[0];
  const hasTour = !!primarySplat;
  const primarySplatId = primarySplat ? (primarySplat.splat_id ?? primarySplat.id) : undefined;
  const thumbUrl = primarySplat?.signed_outputs?.thumbnail ?? null;
  const fpUrl = floorplan?.composite_url ?? null;
  const hasPhotos = (draft?.raw_uploads ?? []).some(
    (u) => u.mime_type?.startsWith("image") || u.asset_type === "photo"
  );
  const hasFloorplan = !!fpUrl || (draft?.draft_data ?? []).some(
    (e) => e.data_key === "captured_room_json" || e.data_key === "wall_graph_json"
  );

  const handleCreate = useCallback(async (formData: ShareFormData) => {
    setFormError(null);
    setSaving(true);
    try {
      const s = scope?.tour && primarySplatId
        ? await createSplatShare(primarySplatId, formData)
        : await createDraftShare(draftId, formData);
      setShares((prev) => [s, ...prev]);
      const url = `${window.location.origin}/shared/${s.token}`;
      if (await copyToClipboard(url)) {
        setJustCopied(true);
        setTimeout(() => setJustCopied(false), 3000);
      }
    } catch (err) {
      setFormError(getSafeApiErrorMessage(err, lang) || t("shareDialog.errorCreate", lang));
    } finally {
      setSaving(false);
    }
  }, [scope?.tour, primarySplatId, draftId, lang]);

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
          <Button variant="outline" size="sm" onClick={() => router.back()}>{t("common.goBack", lang)}</Button>
        </div>
      </div>
    );
  }

  const title = draft.title || t("dashboard.untitled", lang);

  return (
    <AppShell user={user} onLogout={logout}>
      <div className="mx-auto w-full max-w-5xl animate-fade-in pb-10">
        {/* Back */}
        <button onClick={() => router.back()} className="mb-4 inline-flex items-center gap-1.5 rounded-xl px-2 py-1.5 -ml-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          {t("common.back", lang)}
        </button>

        {/* Title */}
        <h1 className="mb-5 text-[16px] font-semibold">
          {t("sharing.pageTitle", lang)}
          <span className="text-foreground/25 ml-2 font-normal text-[13px]">{title}</span>
        </h1>

        {/* Success banner — toast-style */}
        {justCopied && (
          <div className="mb-5 flex items-center gap-2 rounded-xl border border-foreground/15 bg-foreground/[0.05] px-4 py-2.5 animate-fade-in">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span className="text-[12px] font-medium">{t("sharing.linkCopied", lang)}</span>
          </div>
        )}

        {/* Two-panel layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-8">
          {/* Right panel — Controls (shown first on mobile) */}
          <div className="lg:order-2 space-y-3">
            {/* Active links */}
            {shares.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 px-1">
                  <h2 className="text-[12px] font-medium text-foreground/45">
                    {t("sharing.activeLinks", lang)}
                  </h2>
                  <span className="inline-flex items-center justify-center h-[18px] min-w-[18px] rounded-full bg-foreground/[0.07] px-1.5 text-[10px] font-semibold text-foreground/45 tabular-nums">
                    {shares.length}
                  </span>
                </div>
                {shares.map((share) => (
                  <ShareLinkCard
                    key={share.id}
                    share={share}
                    lang={lang}
                    onUpdate={(updated) => handleShareUpdate(share.id, updated)}
                    onEdit={() => {}}
                  />
                ))}
              </div>
            )}

            {/* Create new link */}
            <div className="rounded-2xl border border-border/60 bg-background p-5">
              <h2 className="text-[15px] font-semibold mb-4">{t("sharing.createNewLink", lang)}</h2>
              {scope && (
                <ShareCreateForm
                  scope={scope}
                  onScopeChange={setScope}
                  hasTour={hasTour}
                  hasPhotos={hasPhotos}
                  hasFloorplan={hasFloorplan}
                  lang={lang}
                  onSubmit={handleCreate}
                  saving={saving}
                  error={formError}
                />
              )}
            </div>
          </div>

          {/* Left panel — Audience Preview */}
          <div className="lg:order-1">
            <div className="lg:sticky lg:top-6">
              {scope && (
                <SharePreview
                  draft={draft}
                  scope={scope}
                  hasTour={hasTour}
                  thumbUrl={thumbUrl}
                  fpUrl={fpUrl}
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
