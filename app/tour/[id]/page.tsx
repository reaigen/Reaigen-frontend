"use client";

import { useEffect, useState, useRef, use, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../components/hooks/use-auth";
import { getSplatViewer, getSplatsByDraft } from "../../lib/api/client";
import { isApiNotFound } from "../../lib/api/error-message";
import type { CameraData, SplatViewerPayload } from "../../lib/tour-types";
import type { SplatViewerHandle } from "../../components/splat-viewer";
import dynamic from "next/dynamic";
import CameraEditor from "../../components/camera-editor";
import { Button } from "../../lib/ui/button";
import { getUserLanguage, t } from "../../lib/i18n";
import { PageLoading } from "../../components/page-loading";
import { ArrowLeftIcon, InfoIcon, SearchIcon } from "../../components/icons";

const SplatViewer = dynamic(() => import("../../components/splat-viewer"), { ssr: false });
const SOG_READY_TIMEOUT_MS = 15000;

function pickRenderableUrl(viewer: SplatViewerPayload): string {
  return viewer.signed_outputs?.sog
    ?? viewer.signed_outputs?.["model.sog"]
    ?? (viewer.format === "sog" ? viewer.url : undefined)
    ?? viewer.signed_outputs?.splat
    ?? viewer.signed_outputs?.["model.splat"]
    ?? viewer.signed_outputs?.spz
    ?? viewer.signed_outputs?.["model.spz"]
    ?? viewer.signed_outputs?.ply
    ?? viewer.signed_outputs?.["model.ply"]
    ?? viewer.signed_outputs?.["output_mcmc.ply"]
    ?? viewer.url;
}

function pickFallbackRenderableUrl(viewer: SplatViewerPayload): string | null {
  return viewer.signed_outputs?.ply
    ?? viewer.signed_outputs?.["model.ply"]
    ?? viewer.signed_outputs?.["output_mcmc.ply"]
    ?? null;
}

export default function TourPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const splatId = parseInt(id, 10);
  const { isAuthenticated, isLoading, user } = useAuth();
  const router = useRouter();
  const lang = getUserLanguage(user?.localization);

  const [viewer, setViewer] = useState<SplatViewerPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shotIdx, setShotIdx] = useState(0);
  const [editorVersion, setEditorVersion] = useState(0);
  const [activeRenderUrl, setActiveRenderUrl] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const splatRef = useRef<SplatViewerHandle | null>(null);
  const resolvedSplatId = viewer?.splat_id ?? splatId;
  const viewerCameras = viewer?.cameras as CameraData | undefined;
  const preferSavedCameras = !!viewerCameras?.cameras?.length || viewer?.format !== "sog";
  const preferredRenderUrl = viewer ? pickRenderableUrl(viewer) : null;
  const fallbackRenderUrl = viewer ? pickFallbackRenderableUrl(viewer) : null;

  useEffect(() => {
    setActiveRenderUrl(preferredRenderUrl);
    setViewerReady(false);
  }, [preferredRenderUrl]);

  useEffect(() => {
    if (!activeRenderUrl) return;
    if (viewerReady) return;
    if (!fallbackRenderUrl || activeRenderUrl === fallbackRenderUrl) return;
    if (!activeRenderUrl.split("?")[0].toLowerCase().endsWith(".sog")) return;

    const timer = window.setTimeout(() => {
      setActiveRenderUrl(fallbackRenderUrl);
    }, SOG_READY_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [activeRenderUrl, fallbackRenderUrl, viewerReady]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated || isNaN(splatId)) return;
    getSplatViewer(splatId)
      .then(async (data) => {
        if (!data.draft_id) return data;

        try {
          const byDraft = await getSplatsByDraft(data.draft_id);
          const canonicalSplatId = byDraft.parent_splat_id;
          if (canonicalSplatId && canonicalSplatId !== data.splat_id) {
            router.replace(`/tour/${canonicalSplatId}`);
            return await getSplatViewer(canonicalSplatId);
          }
        } catch {
          // Best-effort canonicalization; fall back to the explicit splat route.
        }

        return data;
      })
      .then((data) => setViewer(data))
      .catch((err) => {
        if (isApiNotFound(err)) {
          setError(t("tour.error.notFound", lang));
        } else {
          setError(t("tour.error.loadFailed", lang));
        }
      });
  }, [isAuthenticated, splatId, router, lang, retryCount]);

  const handleShotChange = useCallback((idx: number) => {
    setShotIdx(idx);
  }, []);

  if (isLoading || (!viewer && !error)) {
    return <PageLoading />;
  }

  if (error) {
    const isNotFound = error === t("tour.error.notFound", lang);
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
        <div className="text-center space-y-4 px-6 max-w-xs">
          <span
            className="text-[22px] text-foreground/80"
            style={{ fontFamily: "var(--font-brand), ui-serif, Georgia, serif", fontWeight: 400, letterSpacing: "0.01em" }}
          >
            Reaigen
          </span>
          <div className="pt-2">
            <div className="mx-auto w-12 h-12 rounded-full bg-foreground/[0.04] flex items-center justify-center mb-3">
              {isNotFound ? (
                <SearchIcon size={20} className="text-foreground/30" />
              ) : (
                <InfoIcon size={20} className="text-foreground/30" />
              )}
            </div>
            <p className="text-[14px] font-semibold text-foreground/70 mb-1">
              {isNotFound ? t("tour.error.notFoundTitle", lang) : t("tour.error.failedTitle", lang)}
            </p>
            <p className="text-[13px] text-foreground/50 leading-relaxed">{error}</p>
          </div>
          <div className="flex items-center justify-center gap-2 pt-1">
            {!isNotFound && (
              <Button variant="outline" size="sm" onClick={() => { setError(null); setRetryCount((c) => c + 1); }}>
                {t("common.tryAgain", lang)}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => router.push("/dashboard")}>
              {t("nav.dashboard", lang)}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!viewer) return null;

  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden bg-white">
      <SplatViewer
        key={editorVersion}
        ref={splatRef}
        splatUrl={activeRenderUrl ?? viewer.url}
        splatId={resolvedSplatId}
        tourUrl={viewer.tour_url ?? undefined}
        initialCameras={viewerCameras}
        camerasUrl={`/api/reaigen/splats/${resolvedSplatId}/cameras/`}
        outputsVersion={viewer.outputs_updated_at}
        preferSavedCameras={preferSavedCameras}
        onReady={() => setViewerReady(true)}
        onError={() => {
          if (fallbackRenderUrl && activeRenderUrl !== fallbackRenderUrl) {
            setViewerReady(false);
            setActiveRenderUrl(fallbackRenderUrl);
          }
        }}
        onShotChange={handleShotChange}
        lang={lang}
      />

      {/* Top bar */}
      <div className="absolute left-3 top-[calc(0.75rem+env(safe-area-inset-top,0px))] z-20 flex items-center gap-2 animate-fade-in sm:left-4 sm:top-[calc(1rem+env(safe-area-inset-top,0px))] xl:left-6 xl:top-[calc(1.5rem+env(safe-area-inset-top,0px))]">
        <button
          onClick={() => router.back()}
          aria-label={t("common.back", lang)}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white/90 shadow-lg backdrop-blur-xl transition-colors hover:bg-black/50 active:scale-95 xl:w-auto xl:gap-2 xl:px-3"
        >
          <ArrowLeftIcon size={16} />
          <span className="hidden text-[12px] font-medium xl:inline">{t("common.back", lang)}</span>
        </button>
      </div>

      <CameraEditor
        splatId={resolvedSplatId}
        viewerRef={splatRef}
        activeShotIdx={shotIdx}
        defaultMode="edit"
        onSaved={() => setEditorVersion((v) => v + 1)}
        lang={lang}
      />
    </div>
  );
}
