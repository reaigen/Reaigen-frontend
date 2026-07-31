"use client";

import { useEffect, useState, useRef, use, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../components/hooks/use-auth";
import {
  authorUsdSceneTransformOperation,
  getDraft,
  getWebTourWorkspace,
  hasWebCreationAccess,
  saveWebTourThumbnail,
  saveWebTourWorkspace,
  getSplatPackage,
  getSplatViewer,
  getSplatsByDraft,
} from "../../lib/api/client";
import { isApiNotFound } from "../../lib/api/error-message";
import { selectTourThumbnailCamera } from "../../lib/tour-thumbnail-camera";
import type {
  CameraData,
  DraftDetailItem,
  GlobalSceneTransform,
  RoomKitCageWall,
  SpatialTransformTool,
  SpatialViewMode,
  SplatInspectionStats,
  SplatViewerPayload,
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
import { parseRoomKitCage } from "../../lib/spatial-editor-data";
import {
  cloneGlobalSceneTransform,
  composedRootTransformFromScene,
  composeGlobalSceneTransform,
  globalSceneTransformsEqual,
  IDENTITY_GLOBAL_SCENE_TRANSFORM,
  relativeGlobalSceneTransform,
} from "../../lib/global-scene-transform";

const SplatViewer = dynamic(() => import("../../components/splat-viewer"), { ssr: false });
const SOG_READY_TIMEOUT_MS = 15000;

function pickRenderableUrl(viewer: SplatViewerPayload): string {
  return viewer.asset.url;
}

function pickFallbackRenderableUrl(viewer: SplatViewerPayload): string | null {
  return viewer.representations.find(
    (representation) => representation.format === "ply",
  )?.url ?? null;
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

export default function TourPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tourId?: string | string[] }>;
}) {
  const { id } = use(params);
  const query = use(searchParams);
  const splatId = parseInt(id, 10);
  const rawTourId = Array.isArray(query.tourId) ? query.tourId[0] : query.tourId;
  const requestedTourId = rawTourId ? parseInt(rawTourId, 10) : undefined;
  const { isAuthenticated, isLoading, user } = useAuth();
  const router = useRouter();
  const [spatialEditorAllowed, setSpatialEditorAllowed] = useState(false);
  const [spatialAccessLoading, setSpatialAccessLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      setSpatialEditorAllowed(false);
      if (!isLoading) setSpatialAccessLoading(false);
      return;
    }
    let active = true;
    setSpatialAccessLoading(true);
    void hasWebCreationAccess()
      .then((allowed) => {
        if (active) setSpatialEditorAllowed(allowed);
      })
      .catch(() => {
        if (active) setSpatialEditorAllowed(false);
      })
      .finally(() => {
        if (active) setSpatialAccessLoading(false);
      });
    return () => { active = false; };
  }, [isAuthenticated, isLoading]);
  const lang = getUserLanguage(user?.localization);

  const [viewer, setViewer] = useState<SplatViewerPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shotIdx, setShotIdx] = useState(0);
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
  const [showSpatialGrid, setShowSpatialGrid] = useState(false);
  const [spatialTransformTool, setSpatialTransformTool] = useState<SpatialTransformTool>("select");
  const [globalSceneTransform, setGlobalSceneTransform] = useState<GlobalSceneTransform>(
    () => cloneGlobalSceneTransform(IDENTITY_GLOBAL_SCENE_TRANSFORM),
  );
  const [savedGlobalSceneTransform, setSavedGlobalSceneTransform] = useState<GlobalSceneTransform>(
    () => cloneGlobalSceneTransform(IDENTITY_GLOBAL_SCENE_TRANSFORM),
  );
  const [globalTransformSaving, setGlobalTransformSaving] = useState(false);
  const [globalTransformError, setGlobalTransformError] = useState<string | null>(null);
  const splatRef = useRef<SplatViewerHandle | null>(null);
  const thumbnailBackfillRef = useRef(false);
  const loadedCollisionSplatRef = useRef<number | null>(null);
  const resolvedSplatId = viewer?.splat_id ?? splatId;
  const viewerCameras = viewer?.cameras as CameraData | undefined;
  const preferSavedCameras = !!viewerCameras?.cameras?.length || viewer?.format !== "sog";
  const preferredRenderUrl = viewer ? pickRenderableUrl(viewer) : null;
  const fallbackRenderUrl = viewer ? pickFallbackRenderableUrl(viewer) : null;
  const activePruneMask = viewer?.prune_mask ?? viewer?.workspace?.nodes.find(
    (node) => node.splat_id === resolvedSplatId,
  )?.prune;
  const workspaceComposition = useMemo(
    () => (viewer?.workspace?.nodes ?? [])
      .filter((node) => (
        node.splat_id !== resolvedSplatId
        && node.visible
        && Boolean(node.asset.url)
      ))
      .map((node) => ({
        id: node.id,
        url: node.asset.url!,
        visible: node.visible,
        pruneMask: node.prune,
        transform: {
          version: 1 as const,
          coordinateSpace: "reaigen_y_up" as const,
          translation: node.transform.translation,
          rotationDeg: node.transform.rotationDeg,
          scale3: node.transform.scale3 ?? [
            node.transform.scale,
            node.transform.scale,
            node.transform.scale,
          ],
          scale: node.transform.scale,
        },
      })),
    [resolvedSplatId, viewer?.workspace?.nodes],
  );

  const backfillAutomaticThumbnail = useCallback(async () => {
    if (
      thumbnailBackfillRef.current
      || !spatialEditorAllowed
      || !Number.isFinite(requestedTourId)
    ) return;
    thumbnailBackfillRef.current = true;
    try {
      const workspace = await getWebTourWorkspace(requestedTourId!);
      if (workspace.thumbnail_revision === workspace.revision) return;
      const thumbnailCamera = selectTourThumbnailCamera(workspace.cameras);
      if (!thumbnailCamera) return;
      const imageData = await splatRef.current?.captureThumbnail(
        thumbnailCamera.camera,
      );
      if (!imageData) return;
      await saveWebTourThumbnail(
        requestedTourId!,
        workspace.revision,
        imageData,
        thumbnailCamera.cameraId,
      );
    } catch {
      // The tour remains usable if the derivative cannot be refreshed.
    } finally {
      thumbnailBackfillRef.current = false;
    }
  }, [requestedTourId, spatialEditorAllowed]);

  useEffect(() => {
    if (!viewerReady) return;
    const timer = window.setTimeout(() => {
      void backfillAutomaticThumbnail();
    }, 500);
    return () => window.clearTimeout(timer);
  }, [backfillAutomaticThumbnail, viewerReady]);

  useEffect(() => {
    // Start downloading the renderer chunk while the viewer payload is still
    // in flight so opening a tour does not serialize API, JS and GPU startup.
    void import("../../components/splat-viewer");
  }, []);

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
    getSplatViewer(splatId, {
      tourId: Number.isFinite(requestedTourId) ? requestedTourId : undefined,
    })
      .then(async (data) => {
        if (Number.isFinite(requestedTourId)) return data;
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
        const transform = composedRootTransformFromScene(data.scene_description);
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
  }, [isAuthenticated, splatId, requestedTourId, router, lang, retryCount]);

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
    setSpatialDataLoading(true);

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
    }).finally(() => {
      if (!cancelled) setSpatialDataLoading(false);
    });
    return () => { cancelled = true; };
  }, [resolvedSplatId, viewer]);

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

  const handleShotChange = useCallback((idx: number) => {
    setShotIdx(idx);
  }, []);

  const globalTransformDirty = useMemo(
    () => !globalSceneTransformsEqual(globalSceneTransform, savedGlobalSceneTransform),
    [globalSceneTransform, savedGlobalSceneTransform],
  );
  const editorTransformDelta = useMemo(
    () => relativeGlobalSceneTransform(
      savedGlobalSceneTransform,
      globalSceneTransform,
    ),
    [globalSceneTransform, savedGlobalSceneTransform],
  );

  const applyViewerSnapshot = useCallback((current: SplatViewerPayload) => {
    const transform = composedRootTransformFromScene(current.scene_description);
    setGlobalSceneTransform(transform);
    setSavedGlobalSceneTransform(cloneGlobalSceneTransform(transform));
    setGlobalTransformError(null);
    setViewer(current);
  }, []);

  const saveTourCameras = useCallback(async (
    cameraData: CameraData,
  ): Promise<CameraData> => {
    if (!Number.isFinite(requestedTourId)) {
      throw new Error("Tour workspace is unavailable");
    }
    const workspace = await getWebTourWorkspace(requestedTourId!);
    await saveWebTourWorkspace(requestedTourId!, {
      base_revision: workspace.revision,
      name: workspace.name,
      nodes: workspace.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        visible: node.visible,
        transform: node.transform,
        prune: node.prune,
      })),
      cameras: cameraData.cameras as unknown as Array<Record<string, unknown>>,
    });
    const current = await getSplatViewer(resolvedSplatId, {
      fresh: true,
      tourId: requestedTourId,
    });
    applyViewerSnapshot(current);
    return current.cameras;
  }, [
    applyViewerSnapshot,
    requestedTourId,
    resolvedSplatId,
  ]);

  const persistGlobalTransform = useCallback(async () => {
    if (!globalTransformDirty) return true;
    setGlobalTransformSaving(true);
    setGlobalTransformError(null);
    try {
      if (Number.isFinite(requestedTourId)) {
        const workspace = await getWebTourWorkspace(requestedTourId!);
        const sourceNode = workspace.nodes.find(
          (node) => node.splat_id === resolvedSplatId,
        );
        if (!sourceNode) throw new Error("Tour source node is unavailable");
        const scale3 = globalSceneTransform.scale3 ?? [
          globalSceneTransform.scale,
          globalSceneTransform.scale,
          globalSceneTransform.scale,
        ];
        await saveWebTourWorkspace(requestedTourId!, {
          base_revision: workspace.revision,
          name: workspace.name,
          nodes: workspace.nodes.map((node) => ({
            id: node.id,
            name: node.name,
            visible: node.visible,
            transform: node.splat_id === resolvedSplatId
              ? {
                  translation: [...globalSceneTransform.translation],
                  rotationDeg: [...globalSceneTransform.rotationDeg],
                  scale3: [...scale3],
                  scale: globalSceneTransform.scale,
                }
              : node.transform,
            prune: node.prune,
          })),
          cameras: workspace.cameras,
        });
        const current = await getSplatViewer(resolvedSplatId, {
          fresh: true,
          tourId: requestedTourId,
        });
        applyViewerSnapshot(current);
        return true;
      }
      const response = await authorUsdSceneTransformOperation(
        resolvedSplatId,
        editorTransformDelta,
        viewer?.scene_description?.stage?.revision ?? 0,
        viewer?.scene_description?.usdStage?.stageSha256,
      );
      const saved = composedRootTransformFromScene(response.sceneDescription);
      setGlobalSceneTransform(saved);
      setSavedGlobalSceneTransform(cloneGlobalSceneTransform(saved));
      setViewer((current) => current ? {
        ...current,
        scene_description: response.sceneDescription,
        cameras: current.cameras ? {
          ...current.cameras,
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
  }, [
    applyViewerSnapshot,
    editorTransformDelta,
    globalSceneTransform,
    globalTransformDirty,
    lang,
    requestedTourId,
    resolvedSplatId,
    viewer?.scene_description?.stage?.revision,
    viewer?.scene_description?.usdStage?.stageSha256,
  ]);

  const closeAdvancedEditor = useCallback(() => {
    // Closing the viewport never authors a hidden operation. Only Apply may
    // create a USD opinion. Discard the pending session-layer delta.
    setGlobalSceneTransform(cloneGlobalSceneTransform(savedGlobalSceneTransform));
    setGlobalTransformError(null);
    setSpatialTransformTool("select");
    setAdvancedOpen(false);
    // Leave the scene-composition viewport in the active tour pose.
    window.requestAnimationFrame(() => {
      splatRef.current?.goToShot(shotIdx, false);
    });
  }, [savedGlobalSceneTransform, shotIdx]);

  const openAdvancedEditor = useCallback(async () => {
    setSpatialTransformTool("select");
    setAdvancedOpen(true);
    try {
      // Scene deliveries can be promoted while the tour page remains open.
      // Revalidate before editing so the controls always represent the
      // current immutable USD revision instead of a stale mounted payload.
      const current = await getSplatViewer(resolvedSplatId, {
        fresh: true,
        tourId: Number.isFinite(requestedTourId) ? requestedTourId : undefined,
      });
      const transform = composedRootTransformFromScene(current.scene_description);
      setGlobalSceneTransform(transform);
      setSavedGlobalSceneTransform(cloneGlobalSceneTransform(transform));
      setGlobalTransformError(null);
      setViewer(current);
    } catch {
      // The already loaded delivery remains usable when revalidation is
      // temporarily unavailable.
    }
  }, [requestedTourId, resolvedSplatId]);

  if (isLoading || spatialAccessLoading || (!viewer && !error)) {
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
        ref={splatRef}
        splatUrl={activeRenderUrl ?? viewer.asset.url}
        splatId={resolvedSplatId}
        initialCameras={viewerCameras}
        outputsVersion={viewer.asset.fingerprint}
        initialPruneMask={activePruneMask}
        preferSavedCameras={preferSavedCameras}
        onReady={() => setViewerReady(true)}
        onError={() => {
          if (fallbackRenderUrl && activeRenderUrl !== fallbackRenderUrl) {
            setViewerReady(false);
            setActiveRenderUrl(fallbackRenderUrl);
          }
        }}
        onShotChange={handleShotChange}
        spatialViewMode={advancedOpen ? spatialViewMode : "surface"}
        roomKitCage={roomKitCage}
        showRoomKitCage={advancedOpen && showRoomKitCage}
        showSpatialGrid={advancedOpen && showSpatialGrid}
        globalSceneTransform={globalSceneTransform}
        spatialTransformTool={advancedOpen ? spatialTransformTool : "select"}
        spatialGizmoResetKey={viewer.scene_description?.stage?.revision}
        onSpatialTransformChange={(transform) => {
          setGlobalTransformError(null);
          setGlobalSceneTransform(transform);
        }}
        onInspectionStats={setInspectionStats}
        spatialNavigation={advancedOpen}
        compositionAssets={workspaceComposition}
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
              className="floating-control pen-touch-target flex w-[var(--floating-control)] items-center justify-center border border-white/20 bg-black/45 text-white/90 shadow-lg backdrop-blur-xl transition-colors hover:bg-black/60 active:scale-95 xl:w-auto xl:gap-2 xl:px-3"
            >
              <ArrowLeftIcon size={16} />
              <span className="hidden text-[12px] font-medium xl:inline">{t("common.back", lang)}</span>
            </button>
            {spatialEditorAllowed ? (
              <button
                type="button"
                onClick={() => { void openAdvancedEditor(); }}
                className="floating-capsule pen-touch-target flex items-center gap-2 border px-3 text-[11px] font-semibold text-foreground transition-transform hover:scale-[1.02] active:scale-[0.98]"
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
            saveHandler={
              Number.isFinite(requestedTourId)
                ? saveTourCameras
                : undefined
            }
            onSaved={(saved) => {
              setViewer((current) => current ? {
                ...current,
                cameras: saved,
                scene_description: saved.sceneDescription ?? current.scene_description,
              } : current);
            }}
            lang={lang}
          />
        </>
      ) : (
        <AdvancedTourEditor
          title={draft?.title || String(viewer.metadata?.title ?? t("spatialEditor.title", lang))}
          lang={lang}
          sceneDescription={viewer.scene_description}
          viewMode={spatialViewMode}
          onViewModeChange={setSpatialViewMode}
          stats={inspectionStats}
          dataLoading={spatialDataLoading}
          cageCount={roomKitCage.length}
          showCage={showRoomKitCage}
          onShowCageChange={setShowRoomKitCage}
          showGrid={showSpatialGrid}
          onShowGridChange={setShowSpatialGrid}
          transform={editorTransformDelta}
          transformTool={spatialTransformTool}
          onTransformToolChange={setSpatialTransformTool}
          onTransformChange={(transform) => {
            setGlobalTransformError(null);
            setGlobalSceneTransform(composeGlobalSceneTransform(
              savedGlobalSceneTransform,
              transform,
            ));
          }}
          transformDirty={globalTransformDirty}
          transformSaving={globalTransformSaving}
          transformError={globalTransformError}
          onApplyTransform={() => { void persistGlobalTransform(); }}
          onFrameScene={() => splatRef.current?.frameScene()}
          onClose={closeAdvancedEditor}
        />
      )}
    </div>
  );
}
