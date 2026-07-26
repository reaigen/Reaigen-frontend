"use client";

import { useEffect, useState, useRef, use, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../components/hooks/use-auth";
import {
  getDraft,
  getSplatPackage,
  getSplatViewer,
  getSplatsByDraft,
  saveGlobalSceneTransform,
} from "../../lib/api/client";
import { isApiNotFound } from "../../lib/api/error-message";
import type {
  CameraData,
  DraftDetailItem,
  GlobalSceneTransform,
  RoomKitCageWall,
  SpatialCameraMode,
  SpatialTrajectory,
  SpatialViewMode,
  SplatInspectionStats,
  SplatPackageRoomBundle,
  SplatViewerPayload,
  TourData,
} from "../../lib/tour-types";
import type { SplatViewerHandle } from "../../components/splat-viewer";
import dynamic from "next/dynamic";
import CameraEditor from "../../components/camera-editor";
import { AdvancedTourEditor } from "../../components/advanced-tour-editor";
import { Button } from "../../lib/ui/button";
import { getUserLanguage, t } from "../../lib/i18n";
import { PageLoading } from "../../components/page-loading";
import { ArrowLeftIcon, InfoIcon, SearchIcon, TechnicalIcon } from "../../components/icons";
import { buildTextDataMap } from "../../lib/floorplan-geometry";
import { parseRoomKitCage, parseScanTrajectory, trajectoryFromTour } from "../../lib/spatial-editor-data";
import {
  cloneGlobalSceneTransform,
  globalSceneTransformFromDescription,
  globalSceneTransformsEqual,
  IDENTITY_GLOBAL_SCENE_TRANSFORM,
} from "../../lib/global-scene-transform";

const SplatViewer = dynamic(() => import("../../components/splat-viewer"), { ssr: false });
const SOG_READY_TIMEOUT_MS = 15000;
const SPATIAL_EDITOR_RND_ENABLED = process.env.NODE_ENV === "development";

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

async function fetchTextAsset(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetch(url, { cache: "no-store" });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

async function fetchJsonAsset(url: string | undefined): Promise<unknown> {
  const text = await fetchTextAsset(url);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function trajectoryFromRoomBundle(
  bundle: SplatPackageRoomBundle,
  fallbackLabel: string,
): Promise<SpatialTrajectory | null> {
  const framesUrl = bundle.files.frames_jsonl?.url;
  if (!framesUrl) return null;
  const [frames, indices] = await Promise.all([
    fetchTextAsset(framesUrl),
    fetchJsonAsset(bundle.files.room_frame_indices_json?.url),
  ]);
  if (!frames) return null;
  const roomIdentity = bundle.scan_bundle_room_id
    ?? bundle.room_number
    ?? bundle.capture_folder_slug;
  return parseScanTrajectory(
    frames,
    indices,
    `scan-room-${roomIdentity}`,
    bundle.room_label?.trim() || fallbackLabel,
  );
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
  const [draft, setDraft] = useState<DraftDetailItem | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [spatialViewMode, setSpatialViewMode] = useState<SpatialViewMode>("surface");
  const [inspectionStats, setInspectionStats] = useState<SplatInspectionStats | null>(null);
  const [spatialDataLoading, setSpatialDataLoading] = useState(false);
  const [roomKitCage, setRoomKitCage] = useState<RoomKitCageWall[]>([]);
  const [showRoomKitCage, setShowRoomKitCage] = useState(true);
  const [packageTrajectories, setPackageTrajectories] = useState<SpatialTrajectory[]>([]);
  const [showSpatialTrajectory, setShowSpatialTrajectory] = useState(true);
  const [selectedSpatialCamera, setSelectedSpatialCamera] = useState(0);
  const [spatialCameraPreviewActive, setSpatialCameraPreviewActive] = useState(false);
  const [globalSceneTransform, setGlobalSceneTransform] = useState<GlobalSceneTransform>(
    () => cloneGlobalSceneTransform(IDENTITY_GLOBAL_SCENE_TRANSFORM),
  );
  const [savedGlobalSceneTransform, setSavedGlobalSceneTransform] = useState<GlobalSceneTransform>(
    () => cloneGlobalSceneTransform(IDENTITY_GLOBAL_SCENE_TRANSFORM),
  );
  const [globalTransformSaving, setGlobalTransformSaving] = useState(false);
  const [globalTransformError, setGlobalTransformError] = useState<string | null>(null);
  const [spatialCameraMode, setSpatialCameraMode] = useState<SpatialCameraMode>("orbit");
  const [loadedTour, setLoadedTour] = useState<TourData | null>(null);
  const splatRef = useRef<SplatViewerHandle | null>(null);
  const loadedPackageSplatRef = useRef<number | null>(null);
  const loadedCollisionSplatRef = useRef<number | null>(null);
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
      .then((data) => {
        const transform = globalSceneTransformFromDescription(
          data.scene_description,
          data.global_transform,
        );
        setGlobalSceneTransform(transform);
        setSavedGlobalSceneTransform(cloneGlobalSceneTransform(transform));
        setGlobalTransformError(null);
        setViewer(data);
      })
      .catch((err) => {
        if (isApiNotFound(err)) {
          setError(t("tour.error.notFound", lang));
        } else {
          setError(t("tour.error.loadFailed", lang));
        }
      });
  }, [isAuthenticated, splatId, router, lang, retryCount]);

  useEffect(() => {
    if (!isAuthenticated || !viewer?.draft_id) return;
    let cancelled = false;
    getDraft(viewer.draft_id)
      .then((value) => {
        if (!cancelled) setDraft(value);
      })
      .catch(() => {
        // The spatial editor can still use the authoritative splat package.
      });
    return () => { cancelled = true; };
  }, [isAuthenticated, viewer?.draft_id]);

  useEffect(() => {
    if (!viewer || loadedCollisionSplatRef.current === resolvedSplatId) return;
    let cancelled = false;
    setRoomKitCage([]);

    const loadCollisionGeometry = async () => {
      const splatPackage = await getSplatPackage(resolvedSplatId);
      if (cancelled) return;
      const geometryFile = splatPackage.original_roomkit_geometry?.files.roomplan_json
        ?? splatPackage.room_bundle?.files.roomplan_json;
      const roomPlan = await fetchJsonAsset(geometryFile?.url);
      if (!cancelled && roomPlan) {
        setRoomKitCage(parseRoomKitCage(roomPlan));
      }
      if (!cancelled) loadedCollisionSplatRef.current = resolvedSplatId;
    };

    loadCollisionGeometry().catch(() => {
      // The reconstruction footprint remains the declared runtime fallback.
      if (!cancelled) loadedCollisionSplatRef.current = resolvedSplatId;
    });
    return () => { cancelled = true; };
  }, [resolvedSplatId, viewer]);

  useEffect(() => {
    if (!advancedOpen || !viewer || loadedPackageSplatRef.current === resolvedSplatId) return;
    let cancelled = false;

    const loadSpatialPackage = async () => {
      setSpatialDataLoading(true);
      const splatPackage = await getSplatPackage(resolvedSplatId);
      if (cancelled) return;

      let bundles: SplatPackageRoomBundle[] = [];
      if (splatPackage.room_bundle) {
        bundles = [splatPackage.room_bundle];
      } else if (splatPackage.room_splats?.length) {
        const roomPackages = await Promise.allSettled(
          splatPackage.room_splats.map((room) => getSplatPackage(room.id)),
        );
        bundles = roomPackages.flatMap((result) => (
          result.status === "fulfilled" && result.value.room_bundle
            ? [result.value.room_bundle]
            : []
        ));
      }

      const trajectories = await Promise.all(
        bundles.map((bundle, index) => trajectoryFromRoomBundle(
          bundle,
          `${t("spatialEditor.scanPath", lang)} ${index + 1}`,
        )),
      );
      if (!cancelled) {
        setPackageTrajectories(trajectories.flatMap((trajectory) => trajectory ? [trajectory] : []));
        loadedPackageSplatRef.current = resolvedSplatId;
      }
    };

    loadSpatialPackage()
      .catch(() => {
        // Unavailable package layers stay explicitly unavailable; tour cameras
        // remain usable as a non-synthetic path fallback.
        if (!cancelled) loadedPackageSplatRef.current = resolvedSplatId;
      })
      .finally(() => {
        if (!cancelled) setSpatialDataLoading(false);
      });
    return () => { cancelled = true; };
  }, [advancedOpen, lang, resolvedSplatId, viewer]);

  useEffect(() => {
    if (roomKitCage.length || !draft?.draft_data?.length) return;
    const capturedRoom = buildTextDataMap(draft.draft_data).captured_room_json;
    if (!capturedRoom) return;
    try {
      setRoomKitCage(parseRoomKitCage(JSON.parse(capturedRoom)));
    } catch {
      // Invalid legacy geometry is ignored instead of guessed.
    }
  }, [draft, roomKitCage.length]);

  const spatialTrajectories = useMemo(() => {
    if (packageTrajectories.length) return packageTrajectories;
    if (!loadedTour) return [];
    const fallback = trajectoryFromTour(loadedTour, t("spatialEditor.tourPath", lang));
    return fallback ? [fallback] : [];
  }, [lang, loadedTour, packageTrajectories]);
  const spatialCameraSamples = useMemo(
    () => spatialTrajectories.flatMap((trajectory) => trajectory.samples),
    [spatialTrajectories],
  );
  const safeSpatialCamera = spatialCameraSamples.length
    ? Math.max(0, Math.min(spatialCameraSamples.length - 1, selectedSpatialCamera))
    : 0;
  const activeSpatialCamera = spatialCameraSamples[safeSpatialCamera] ?? null;
  const selectSpatialCamera = useCallback((index: number) => {
    if (!spatialCameraSamples.length) return;
    const nextIndex = ((index % spatialCameraSamples.length) + spatialCameraSamples.length)
      % spatialCameraSamples.length;
    setSelectedSpatialCamera(nextIndex);
    if (!spatialCameraPreviewActive) return;
    setSpatialCameraMode("fly");
    splatRef.current?.navigateToSpatialCamera(spatialCameraSamples[nextIndex], false);
  }, [spatialCameraPreviewActive, spatialCameraSamples]);
  const selectSpatialTrajectory = useCallback((trajectoryIndex: number) => {
    if (!spatialTrajectories.length) return;
    const safeTrajectoryIndex = Math.max(
      0,
      Math.min(spatialTrajectories.length - 1, trajectoryIndex),
    );
    const offset = spatialTrajectories
      .slice(0, safeTrajectoryIndex)
      .reduce((total, trajectory) => total + trajectory.samples.length, 0);
    splatRef.current?.stopCameraNavigation();
    setSpatialCameraPreviewActive(false);
    setSelectedSpatialCamera(offset);
  }, [spatialTrajectories]);

  useEffect(() => {
    if (!advancedOpen || !viewerReady) return;
    const frame = window.requestAnimationFrame(() => splatRef.current?.frameScene());
    return () => window.cancelAnimationFrame(frame);
  }, [advancedOpen, viewerReady]);

  const handleShotChange = useCallback((idx: number) => {
    setShotIdx(idx);
  }, []);

  const globalTransformDirty = useMemo(
    () => !globalSceneTransformsEqual(globalSceneTransform, savedGlobalSceneTransform),
    [globalSceneTransform, savedGlobalSceneTransform],
  );

  const persistGlobalTransform = useCallback(async () => {
    if (!globalTransformDirty) return true;
    setGlobalTransformSaving(true);
    setGlobalTransformError(null);
    try {
      const response = await saveGlobalSceneTransform(
        resolvedSplatId,
        globalSceneTransform,
        viewer?.scene_description?.stage?.revision,
      );
      const saved = globalSceneTransformFromDescription(
        response.sceneDescription,
        response.globalTransform,
      );
      setGlobalSceneTransform(saved);
      setSavedGlobalSceneTransform(cloneGlobalSceneTransform(saved));
      setViewer((current) => current ? {
        ...current,
        global_transform: saved,
        scene_description: response.sceneDescription,
        cameras: current.cameras ? {
          ...current.cameras,
          globalTransform: saved,
          sceneDescription: response.sceneDescription,
          sceneRevision: response.sceneRevision,
        } : current.cameras,
      } : current);
      return true;
    } catch {
      setGlobalTransformError(t("spatialEditor.transformSaveFailed", lang));
      return false;
    } finally {
      setGlobalTransformSaving(false);
    }
  }, [globalSceneTransform, globalTransformDirty, lang, resolvedSplatId, viewer?.scene_description?.stage?.revision]);

  const closeAdvancedEditor = useCallback(async () => {
    splatRef.current?.stopCameraNavigation();
    setSpatialCameraPreviewActive(false);
    if (!await persistGlobalTransform()) return;
    setAdvancedOpen(false);
    // Leave inspection mode in an actual tour pose. The transformed path has
    // already been rebuilt while the orientation changed; jumping to the
    // active shot makes the saved result immediately visible and prevents the
    // editor's orbit camera from masquerading as the published tour state.
    window.requestAnimationFrame(() => {
      splatRef.current?.goToShot(shotIdx, true);
    });
  }, [persistGlobalTransform, shotIdx]);

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
        onTourLoaded={setLoadedTour}
        spatialViewMode={advancedOpen ? spatialViewMode : "surface"}
        roomKitCage={roomKitCage}
        showRoomKitCage={advancedOpen && showRoomKitCage}
        spatialTrajectories={spatialTrajectories}
        showSpatialTrajectory={advancedOpen && showSpatialTrajectory}
        selectedSpatialCamera={advancedOpen ? activeSpatialCamera : null}
        globalSceneTransform={globalSceneTransform}
        onInspectionStats={setInspectionStats}
        spatialNavigation={advancedOpen}
        spatialCameraMode={spatialCameraMode}
        onSpatialCameraModeChange={setSpatialCameraMode}
        lang={lang}
      />

      {!advancedOpen ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-28 bg-gradient-to-b from-black/50 to-transparent" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-36 bg-gradient-to-t from-black/55 to-transparent" aria-hidden="true" />
        </>
      ) : null}

      {/* Top bar */}
      {!advancedOpen ? (
        <>
          <div className="absolute left-3 top-[calc(0.75rem+env(safe-area-inset-top,0px))] z-20 flex items-center gap-2 animate-fade-in sm:left-4 sm:top-[calc(1rem+env(safe-area-inset-top,0px))] xl:left-6 xl:top-[calc(1.5rem+env(safe-area-inset-top,0px))]">
            <button
              onClick={() => router.push(viewer.draft_id ? `/draft/${viewer.draft_id}` : "/tours")}
              aria-label={t("common.back", lang)}
              className="pen-touch-target flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white/90 shadow-lg backdrop-blur-xl transition-colors hover:bg-black/60 active:scale-95 xl:w-auto xl:gap-2 xl:px-3"
            >
              <ArrowLeftIcon size={16} />
              <span className="hidden text-[12px] font-medium xl:inline">{t("common.back", lang)}</span>
            </button>
            {SPATIAL_EDITOR_RND_ENABLED ? (
              <button
                type="button"
                onClick={() => setAdvancedOpen(true)}
                className="editor-glass-control pen-touch-target flex h-11 items-center gap-2 rounded-full border px-3 text-[11px] font-semibold text-foreground transition-transform hover:scale-[1.02] active:scale-[0.98]"
              >
                <TechnicalIcon size={14} />
                <span>{t("spatialEditor.open", lang)}</span>
                <span className="rounded-full bg-foreground/[0.07] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] text-foreground/55">
                  {t("spatialEditor.rnd", lang)}
                </span>
              </button>
            ) : null}
          </div>

          <CameraEditor
            splatId={resolvedSplatId}
            viewerRef={splatRef}
            activeShotIdx={shotIdx}
            initialCameras={viewerCameras}
            defaultMode="edit"
            onSaved={(saved) => {
              setViewer((current) => current ? {
                ...current,
                cameras: saved,
                global_transform: saved.globalTransform ?? current.global_transform,
                scene_description: saved.sceneDescription ?? current.scene_description,
              } : current);
              setEditorVersion((v) => v + 1);
            }}
            lang={lang}
          />
        </>
      ) : (
        <AdvancedTourEditor
          title={draft?.title || String(viewer.metadata?.title ?? t("spatialEditor.title", lang))}
          lang={lang}
          viewMode={spatialViewMode}
          onViewModeChange={setSpatialViewMode}
          stats={inspectionStats}
          dataLoading={spatialDataLoading}
          cageCount={roomKitCage.length}
          showCage={showRoomKitCage}
          onShowCageChange={setShowRoomKitCage}
          trajectories={spatialTrajectories}
          onSelectTrajectory={selectSpatialTrajectory}
          showPath={showSpatialTrajectory}
          onShowPathChange={setShowSpatialTrajectory}
          selectedCamera={safeSpatialCamera}
          onSelectCamera={selectSpatialCamera}
          onLookThroughCamera={() => {
            if (!activeSpatialCamera) return;
            setSpatialCameraPreviewActive(true);
            setSpatialCameraMode("fly");
            splatRef.current?.navigateToSpatialCamera(activeSpatialCamera, false);
          }}
          cameraPreviewActive={spatialCameraPreviewActive}
          onExitCameraPreview={() => {
            splatRef.current?.stopCameraNavigation();
            setSpatialCameraPreviewActive(false);
          }}
          rotation={globalSceneTransform.rotationDeg}
          onRotationChange={(rotation) => {
            setGlobalTransformError(null);
            setGlobalSceneTransform((current) => ({ ...current, rotationDeg: rotation }));
          }}
          transformDirty={globalTransformDirty}
          transformSaving={globalTransformSaving}
          transformError={globalTransformError}
          onSaveTransform={() => { void persistGlobalTransform(); }}
          cameraMode={spatialCameraMode}
          onCameraModeChange={(mode) => {
            splatRef.current?.stopCameraNavigation();
            setSpatialCameraPreviewActive(false);
            setSpatialCameraMode(mode);
          }}
          onFrameScene={() => splatRef.current?.frameScene()}
          onClose={() => { void closeAdvancedEditor(); }}
        />
      )}
    </div>
  );
}
