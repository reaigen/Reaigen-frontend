"use client";

import { useEffect, useState, useRef, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../components/hooks/use-auth";
import { getSplatViewer, getSplatsByDraft } from "../../lib/api/client";
import type { CameraData, SplatViewerPayload, TourData, TourShot } from "../../lib/tour-types";
import dynamic from "next/dynamic";
import TourControls from "../../components/tour-controls";
import CameraEditor from "../../components/camera-editor";
import { Button } from "../../lib/ui/button";

const SplatViewer = dynamic(() => import("../../components/splat-viewer"), { ssr: false });
const SOG_READY_TIMEOUT_MS = 15000;

function pickRenderableUrl(viewer: SplatViewerPayload): string {
  if (viewer.format === "sog") {
    return viewer.signed_outputs?.spz
      ?? viewer.signed_outputs?.["model.spz"]
      ?? viewer.signed_outputs?.splat
      ?? viewer.url
      ?? viewer.signed_outputs?.ply
      ?? viewer.signed_outputs?.["model.ply"]
      ?? viewer.signed_outputs?.["output_mcmc.ply"]
      ?? viewer.url;
  }
  return viewer.url;
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
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  const [viewer, setViewer] = useState<SplatViewerPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tourData, setTourData] = useState<TourData | null>(null);
  const [shotIdx, setShotIdx] = useState(0);
  const [editorVersion, setEditorVersion] = useState(0);
  const [activeRenderUrl, setActiveRenderUrl] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const splatRef = useRef<any>(null);
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
      .catch((e) => {
        const raw = e.body || e.message || "";
        if (raw.toLowerCase().includes("not found")) {
          setError("This tour could not be found.");
        } else {
          setError("Something went wrong loading this tour.");
        }
      });
  }, [isAuthenticated, splatId, router]);

  const handleShotChange = useCallback((idx: number, shot: TourShot | null) => {
    setShotIdx(idx);
  }, []);

  const handleTourLoaded = useCallback((data: TourData) => {
    setTourData(data);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-foreground/20 border-t-foreground rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-destructive">{error}</p>
          <Button variant="outline" onClick={() => router.back()}>Go back</Button>
        </div>
      </div>
    );
  }

  if (!viewer) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-foreground/20 border-t-foreground rounded-full" />
      </div>
    );
  }

  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden bg-black">
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
        onTourLoaded={handleTourLoaded}
      />

      {tourData && (
        <TourControls
          shots={tourData.shots}
          currentIdx={shotIdx}
          onGoToShot={(i) => splatRef.current?.goToShot(i)}
          onPrev={() => splatRef.current?.goToPrev()}
          onNext={() => splatRef.current?.goToNext()}
        />
      )}

      {/* Top bar */}
      <div className="absolute left-3 top-3 z-20 flex items-center gap-2 sm:left-4 sm:top-4">
        <Button variant="ghost" size="icon-sm" onClick={() => router.back()} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Button>
      </div>

      <CameraEditor
        splatId={resolvedSplatId}
        viewerRef={splatRef}
        tourData={tourData}
        defaultMode="edit"
        onSaved={() => setEditorVersion((v) => v + 1)}
      />
    </div>
  );
}
