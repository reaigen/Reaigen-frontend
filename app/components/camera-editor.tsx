"use client";

import { useState, useCallback, useEffect, useRef, type RefObject } from "react";
import { ArrowDownIcon, ArrowUpIcon, EyeOpenIcon, PlusIcon, TrashIcon, UpdateIcon } from "@radix-ui/react-icons";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ChevronDownIcon, PlayIcon } from "./icons";
import { Button } from "@/app/lib/ui/button";
import { saveCameras, getCameras } from "@/app/lib/api/client";
import { getSafeApiErrorMessage } from "@/app/lib/api/error-message";
import { cameraFovDegrees, cameraFovRadians, markIdentityCamera, normalizeCameraData } from "@/app/lib/camera-coordinates";
import { t } from "@/app/lib/i18n";
import type { CameraData, GlobalSceneTransform, Vec3 } from "@/app/lib/tour-types";
import type { SplatViewerHandle } from "./splat-viewer";

interface CameraShot {
  id: string;
  position: Vec3;
  forward: Vec3;
  up: Vec3;
  fov: number;
  label: string;
  kind: "authored";
  role: "tour" | "hero" | "transition";
}

function newCameraId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `camera-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface Props {
  splatId: number;
  viewerRef: RefObject<SplatViewerHandle | null>;
  /** Shot index reported by the viewer (arrow-key / tour navigation). */
  activeShotIdx?: number;
  /** Already-loaded viewer cameras; avoids a duplicate request in the studio. */
  initialCameras?: CameraData | null;
  defaultMode?: "edit" | "preview";
  onSaved?: (saved: CameraData) => void;
  saveHandler?: (data: CameraData) => Promise<CameraData>;
  sceneTransform?: GlobalSceneTransform;
  appearance?: "overlay" | "workspace";
  lang?: string;
}

export default function CameraEditor({ splatId, viewerRef, activeShotIdx, initialCameras, defaultMode = "edit", onSaved, saveHandler, sceneTransform, appearance = "overlay", lang = "en" }: Props) {
  const [shots, setShots] = useState<CameraShot[]>([]);
  const [mode, setMode] = useState<"edit" | "preview">(defaultMode);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [looping, setLooping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [sceneFov, setSceneFov] = useState<number>(60);
  const [sceneRevision, setSceneRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  // Keep the 3D scene primary on every device. The compact capsule still
  // exposes camera count, navigation, capture, and preview; users expand the
  // full editor only when they intentionally start editing.
  const [isCollapsed, setIsCollapsed] = useState(true);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editGenerationRef = useRef(0);
  const initialPreviewPoseAppliedRef = useRef(false);

  // Camera coordinates returned by SplatViewer are already canonical. Keep the
  // prop for API compatibility with other editor surfaces, but never apply the
  // scene inverse a second time.
  void sceneTransform;

  // Load existing saved cameras on mount. New camera payloads use identity
  // scene space; historical edited payloads are migrated once on read.
  useEffect(() => {
    initialPreviewPoseAppliedRef.current = false;
    let active = true;
    const applyCameraData = (rawData: CameraData) => {
      if (!active) return;
      const data = normalizeCameraData(rawData);
      const currentViewportFov = viewerRef.current?.getCurrentCamera()?.fov ?? Math.PI / 3;
      const loadedShots = (data.cameras ?? []).map((c, i) => ({
          id: c.id ?? newCameraId(),
          position: c.position,
          forward: c.forward,
          up: c.up ?? [0, 1, 0],
          // A shot's captured lens is authoritative. sceneFov is only a
          // fallback for historical payloads that did not store per-shot FOV.
          fov: cameraFovRadians(c.fov ?? data.fovY ?? data.sceneFov, currentViewportFov),
          label: c.label ?? c.name ?? `${t("cameraEditor.camera", lang)} ${i + 1}`,
          kind: "authored" as const,
          role: (c.role === "hero" || c.role === "transition" ? c.role : "tour") as CameraShot["role"],
        }));
      setShots(loadedShots);
      setDirty(false);
      editGenerationRef.current += 1;
      setSelectedIdx(defaultMode === "preview" && loadedShots.length ? 0 : null);
      if (loadedShots.length) {
        setPreviewIdx(0);
        // Start in preview mode — fly to first shot but don't auto-loop
        if (defaultMode === "preview") {
          setMode("preview");
          setPreviewIdx(0);
        }
      } else {
        setPreviewIdx(0);
        setMode("edit");
      }
      if (data.sceneFov) {
        const sceneFovDegrees = cameraFovDegrees(data.sceneFov);
        setSceneFov(sceneFovDegrees);
      } else {
        setSceneFov(cameraFovDegrees(
          loadedShots[0]?.fov ?? currentViewportFov,
        ));
      }
      setSceneRevision(data.sceneRevision ?? data.sceneDescription?.stage?.revision ?? 0);
    };

    if (initialCameras) {
      applyCameraData(initialCameras);
      setLoaded(true);
      return () => { active = false; };
    }

    getCameras(splatId)
      .then(applyCameraData)
      .catch(() => {})
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [splatId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync with external shot index (arrow-key navigation in viewer)
  useEffect(() => {
    if (activeShotIdx == null || !shots.length) return;
    const idx = Math.max(0, Math.min(activeShotIdx, shots.length - 1));
    setSelectedIdx(idx);
    setPreviewIdx(idx);
  }, [activeShotIdx, shots.length]);

  // Cleanup preview timer on unmount
  useEffect(() => {
    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      if (clearMessageTimerRef.current) clearTimeout(clearMessageTimerRef.current);
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  const setTransientMessage = useCallback((next: string | null, ms = 2200) => {
    if (clearMessageTimerRef.current) clearTimeout(clearMessageTimerRef.current);
    setIsError(false);
    setMessage(next);
    if (next) {
      clearMessageTimerRef.current = setTimeout(() => setMessage(null), ms);
    }
  }, []);

  const goToLocalShot = useCallback((idx: number, preview = false) => {
    const shot = shots[idx];
    if (!shot) return;
    setSelectedIdx(idx);
    setPreviewIdx(idx);
    if (preview) setMode("preview");
    // Editing a camera remains an exact cut. Preview arrows and camera dots
    // are presentation navigation, so they travel from the currently rendered
    // pose instead of snapping between saved shots.
    viewerRef.current?.navigateToCamera(
      shot.position,
      shot.forward,
      !preview,
      shot.fov,
      shot.up,
    );
    if (!preview) setTransientMessage(`${t("cameraEditor.viewing", lang)} ${idx + 1}`, 1000);
  }, [lang, setTransientMessage, shots, viewerRef]);

  useEffect(() => {
    if (!loaded || !shots.length) return;
    if (
      defaultMode === "preview"
      && !initialPreviewPoseAppliedRef.current
    ) {
      initialPreviewPoseAppliedRef.current = true;
      viewerRef.current?.navigateToCamera(
        shots[0].position,
        shots[0].forward,
        true,
        shots[0].fov,
        shots[0].up,
      );
    }
  }, [defaultMode, loaded, shots, viewerRef]);

  // ── Edit mode actions ──────────────────────────────────────────────────────

  const addShot = useCallback(() => {
    const cam = viewerRef.current?.getCurrentCamera();
    if (!cam) return;
    setShots((prev) => {
      const next = [
        ...prev,
        {
          id: newCameraId(),
          position: [...cam.position] as Vec3,
          forward: [...cam.forward] as Vec3,
          up: [...cam.up] as Vec3,
          fov: cam.fov,
          label: `${t("cameraEditor.camera", lang)} ${prev.length + 1}`,
          kind: "authored" as const,
          role: "tour" as const,
        },
      ];
      const nextIdx = next.length - 1;
      setSelectedIdx(nextIdx);
      setPreviewIdx(nextIdx);
      return next;
    });
    editGenerationRef.current += 1;
    setDirty(true);
    setMode("edit");
    setIsCollapsed(false);
    setTransientMessage(t("cameraEditor.messageCaptured", lang));
  }, [viewerRef, setTransientMessage, lang]);

  const [updatedIdx, setUpdatedIdx] = useState<number | null>(null);

  const updateShot = useCallback((idx: number) => {
    const cam = viewerRef.current?.getCurrentCamera();
    if (!cam) return;
    setShots((prev) =>
      prev.map((s, i) =>
        i === idx ? {
          ...s,
          position: [...cam.position] as Vec3,
          forward: [...cam.forward] as Vec3,
          up: [...cam.up] as Vec3,
          fov: cam.fov,
        } : s
      )
    );
    editGenerationRef.current += 1;
    setDirty(true);
    setUpdatedIdx(idx);
    setSelectedIdx(idx);
    setPreviewIdx(idx);
    setTimeout(() => setUpdatedIdx(null), 1500);
    setTransientMessage(t("cameraEditor.messageUpdated", lang));
  }, [viewerRef, setTransientMessage, lang]);

  const removeShot = useCallback((idx: number) => {
    setShots((prev) => {
      const next = prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, label: `${t("cameraEditor.camera", lang)} ${i + 1}` }));
      if (!next.length) {
        setSelectedIdx(null);
        setPreviewIdx(0);
        setMode("edit");
        setLooping(false);
      } else {
        const nextIdx = Math.max(0, Math.min(idx, next.length - 1));
        setSelectedIdx(nextIdx);
        setPreviewIdx(nextIdx);
      }
      return next;
    });
    editGenerationRef.current += 1;
    setDirty(true);
    setTransientMessage(t("cameraEditor.messageRemoved", lang));
  }, [setTransientMessage, lang]);

  const moveShot = useCallback((idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= shots.length) return;
    setShots((prev) => {
      const next = [...prev];
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      if (selectedIdx === idx) setSelectedIdx(target);
      else if (selectedIdx === target) setSelectedIdx(idx);
      if (previewIdx === idx) setPreviewIdx(target);
      else if (previewIdx === target) setPreviewIdx(idx);
      // Renumber labels after reorder
      return next.map((s, i) => ({ ...s, label: `${t("cameraEditor.camera", lang)} ${i + 1}` }));
    });
    editGenerationRef.current += 1;
    setDirty(true);
    setTransientMessage(t("cameraEditor.messageOrderUpdated", lang), 1400);
  }, [previewIdx, selectedIdx, setTransientMessage, shots.length, lang]);

  const handleSave = useCallback(async (announce = true) => {
    const generation = editGenerationRef.current;
    const snapshot = shots.map((shot) => ({
      ...shot,
      position: [...shot.position] as Vec3,
      forward: [...shot.forward] as Vec3,
      up: [...shot.up] as Vec3,
    }));
    setSaving(true);
    setIsError(false);
    if (announce) setMessage(null);
    try {
      const payload: CameraData = {
        cameras: snapshot.map((s) => markIdentityCamera({
          id: s.id,
          position: [...s.position],
          forward: [...s.forward],
          up: [...s.up],
          fov: s.fov,
          label: s.label,
          kind: s.kind,
          role: s.role,
        })),
        fovY: snapshot[0]?.fov ?? cameraFovRadians(sceneFov, 0.66),
        sceneFov,
      };
      const saved = saveHandler
        ? await saveHandler(payload)
        : await saveCameras(splatId, {
            ...payload,
            baseRevision: sceneRevision,
          });
      setSceneRevision(saved.sceneRevision ?? saved.sceneDescription?.stage?.revision ?? sceneRevision + 1);
      if (
        editGenerationRef.current === generation
        && saved.cameras?.length === snapshot.length
      ) {
        setShots((current) => current.map((shot, index) => ({
          ...shot,
          id: saved.cameras[index]?.id ?? shot.id,
        })));
      }
      if (editGenerationRef.current === generation) setDirty(false);
      if (announce) setTransientMessage(t("cameraEditor.messageSaved", lang));
      onSaved?.(saved);
    } catch (err) {
      setIsError(true);
      setMessage(`${t("cameraEditor.messageSaveFailed", lang)} ${getSafeApiErrorMessage(err, lang)}`);
    } finally {
      setSaving(false);
    }
  }, [shots, splatId, sceneFov, sceneRevision, setTransientMessage, onSaved, saveHandler, lang]);

  // Camera edits are workspace edits. Persist them automatically so collapsing
  // or closing the panel cannot silently discard a captured shot.
  useEffect(() => {
    if (!loaded || !dirty || saving) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      void handleSave(false);
    }, 650);
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [dirty, handleSave, loaded, saving]);

  const handleSceneFovChange = useCallback((value: number) => {
    setSceneFov(value);
    const radians = cameraFovRadians(value, 0.66);
    setShots((current) => current.map((shot) => ({ ...shot, fov: radians })));
    editGenerationRef.current += 1;
    setDirty(true);
    viewerRef.current?.setFov(value);
  }, [viewerRef]);

  // ── Preview mode ───────────────────────────────────────────────────────────

  const startPreview = useCallback(() => {
    if (!shots.length) return;
    setMode("preview");
    const targetIdx = selectedIdx ?? 0;
    setPreviewIdx(targetIdx);
    viewerRef.current?.navigateToCamera(
      shots[targetIdx].position,
      shots[targetIdx].forward,
      false,
      shots[targetIdx].fov,
      shots[targetIdx].up,
    );
  }, [selectedIdx, shots, viewerRef]);

  const stopPreview = useCallback(() => {
    setMode("edit");
    setLooping(false);
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    viewerRef.current?.enableFreeCamera();
  }, [viewerRef]);

  // Auto-advance only when looping is enabled
  useEffect(() => {
    if (mode !== "preview" || !looping || !shots.length) return;
    previewTimerRef.current = setTimeout(() => {
      const next = (previewIdx + 1) % shots.length;
      setPreviewIdx(next);
      setSelectedIdx(next);
      viewerRef.current?.navigateToCamera(
        shots[next].position,
        shots[next].forward,
        false,
        shots[next].fov,
        shots[next].up,
      );
    }, 5200);
    return () => { if (previewTimerRef.current) clearTimeout(previewTimerRef.current); };
  }, [mode, looping, previewIdx, shots, viewerRef]);

  const previewGoTo = useCallback((idx: number) => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    goToLocalShot(idx, true);
  }, [goToLocalShot]);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const prevShot = useCallback(() => {
    if (!shots.length) return;
    const current = selectedIdx ?? previewIdx;
    const next = (current - 1 + shots.length) % shots.length;
    goToLocalShot(next, mode === "preview");
  }, [goToLocalShot, mode, previewIdx, selectedIdx, shots.length]);

  const nextShot = useCallback(() => {
    if (!shots.length) return;
    const current = selectedIdx ?? previewIdx;
    const next = (current + 1) % shots.length;
    goToLocalShot(next, mode === "preview");
  }, [goToLocalShot, mode, previewIdx, selectedIdx, shots.length]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!loaded) return null;

  const ArrowLeft = <ArrowLeftIcon size={14} />;
  const ArrowRight = <ArrowRightIcon size={14} />;
  const canGoPrevious = shots.length > 1;
  const canGoNext = shots.length > 1;

  // ── Preview mode: floating pill with arrows ─────────────────────────────
  if (mode === "preview") {
    return (
      <div className={`absolute inset-x-2 bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] z-30 flex justify-center animate-fade-in md:inset-x-6 md:bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] xl:inset-x-auto xl:bottom-auto xl:right-4 xl:justify-end ${appearance === "workspace" ? "camera-editor-workspace xl:top-20" : "xl:top-4"}`}>
        <div className="floating-toolbar-shape max-w-full border border-white/[0.1] bg-black/70 text-white shadow-2xl backdrop-blur-2xl">
          {/* Play / Pause */}
          <button
            type="button"
            onClick={() => setLooping((v) => !v)}
            className={`floating-icon-button focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
              looping ? "bg-white/15 text-white" : "text-white/60 hover:bg-white/10 hover:text-white"
            }`}
            aria-label={looping ? t("cameraEditor.pauseAutoplay", lang) : t("cameraEditor.autoplay", lang)}
            title={looping ? t("cameraEditor.pauseAutoplay", lang) : t("cameraEditor.autoplay", lang)}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              {looping ? (
                <>
                  <rect x="3.5" y="3" width="2.5" height="8" rx="0.5" fill="currentColor" />
                  <rect x="8" y="3" width="2.5" height="8" rx="0.5" fill="currentColor" />
                </>
              ) : (
                <path d="M4 2.5L11.5 7L4 11.5V2.5Z" fill="currentColor" />
              )}
            </svg>
          </button>

          {/* Prev arrow */}
          {shots.length > 1 && (
            <button
              type="button"
              onClick={prevShot}
              disabled={!canGoPrevious}
              className="floating-icon-button text-white/60 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-default disabled:opacity-25 disabled:hover:bg-transparent"
              aria-label={t("cameraEditor.prev", lang)}
            >
              {ArrowLeft}
            </button>
          )}

          {/* Camera dots */}
          {shots.length > 1 && (
            <div className="hidden items-center sm:flex">
              {shots.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => previewGoTo(i)}
                  className="group/dot rounded-full p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  aria-label={`${t("cameraEditor.camera", lang)} ${i + 1}`}
                  aria-current={i === previewIdx ? "true" : undefined}
                >
                  <span
                    className={`block h-1.5 rounded-full transition-all duration-300 ${
                      i === previewIdx ? "w-4 bg-white" : "w-1.5 bg-white/30 group-hover/dot:bg-white/55"
                    }`}
                  />
                </button>
              ))}
            </div>
          )}

          <div className="min-w-0 px-1.5 text-center sm:hidden">
            <span className="block max-w-[6.5rem] truncate text-[11px] font-medium text-white/80">
              {shots[previewIdx]?.label}
            </span>
            <span className="block text-[10px] tabular-nums text-white/45">{previewIdx + 1} / {shots.length}</span>
          </div>

          {/* Next arrow */}
          {shots.length > 1 && (
            <button
              type="button"
              onClick={nextShot}
              disabled={!canGoNext}
              className="floating-icon-button text-white/60 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-default disabled:opacity-25 disabled:hover:bg-transparent"
              aria-label={t("cameraEditor.next", lang)}
            >
              {ArrowRight}
            </button>
          )}

          {/* Divider */}
          <div className="h-4 w-px bg-white/15" />

          {/* Edit button */}
          <button
            type="button"
            onClick={stopPreview}
            className="floating-control px-3 text-[11px] text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            {t("cameraEditor.edit", lang)}
          </button>

          <div className="hidden pl-1 pr-2 text-[11px] font-medium text-white/45 sm:block">
            {previewIdx + 1} / {shots.length}
          </div>
        </div>
      </div>
    );
  }

  // ── Edit collapsed: compact pill ────────────────────────────────────────
  if (isCollapsed) {
    return (
      <div className={`absolute inset-x-2 bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] z-30 flex justify-center animate-fade-in md:inset-x-6 md:bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] xl:inset-x-auto xl:bottom-auto xl:right-4 xl:justify-end ${appearance === "workspace" ? "camera-editor-workspace xl:top-20" : "xl:top-4"}`}>
        <div className="floating-toolbar-shape max-w-full border border-white/[0.1] bg-black/70 text-white shadow-2xl backdrop-blur-2xl">
          <button
            type="button"
            onClick={() => setIsCollapsed(false)}
            className="floating-control min-w-0 gap-2 px-3 text-left text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            aria-label={t("cameraEditor.expand", lang)}
          >
            <EyeOpenIcon className="h-4 w-4 shrink-0 text-white/60" />
            <span className="truncate text-[12px] font-semibold">{t("cameraEditor.title", lang)}</span>
            <span className="text-[10px] tabular-nums text-white/45">{shots.length}</span>
            <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 rotate-180 text-white/45" />
          </button>

          {/* Prev arrow */}
          {shots.length > 1 && (
            <button
              type="button"
              onClick={prevShot}
              disabled={!canGoPrevious}
              className="floating-icon-button text-white/60 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-default disabled:opacity-25 disabled:hover:bg-transparent"
              aria-label={t("cameraEditor.prev", lang)}
            >
              {ArrowLeft}
            </button>
          )}

          {/* Camera dots */}
          {shots.length > 1 && (
            <div className="hidden items-center sm:flex">
              {shots.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => goToLocalShot(i)}
                  className="group/dot rounded-full p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  aria-label={`${t("cameraEditor.camera", lang)} ${i + 1}`}
                  aria-current={i === selectedIdx ? "true" : undefined}
                >
                  <span
                    className={`block h-1.5 rounded-full transition-all duration-300 ${
                      i === selectedIdx ? "w-4 bg-white" : "w-1.5 bg-white/30 group-hover/dot:bg-white/55"
                    }`}
                  />
                </button>
              ))}
            </div>
          )}

          {/* Next arrow */}
          {shots.length > 1 && (
            <button
              type="button"
              onClick={nextShot}
              disabled={!canGoNext}
              className="floating-icon-button text-white/60 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-default disabled:opacity-25 disabled:hover:bg-transparent"
              aria-label={t("cameraEditor.next", lang)}
            >
              {ArrowRight}
            </button>
          )}

          {/* Divider */}
          <div className="h-4 w-px bg-white/15" />

          <button
            type="button"
            onClick={addShot}
            className="floating-icon-button bg-white/[0.12] text-white/85 hover:bg-white/[0.18] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            aria-label={t("cameraEditor.captureCurrentView", lang)}
            title={t("cameraEditor.captureCurrentView", lang)}
          >
            <PlusIcon className="h-4 w-4" />
          </button>

          {shots.length > 0 && (
            <button
              type="button"
              onClick={startPreview}
              className="floating-icon-button text-white/60 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              aria-label={t("cameraEditor.preview", lang)}
              title={t("cameraEditor.preview", lang)}
            >
              <PlayIcon className="h-3.5 w-3.5" />
            </button>
          )}

        </div>
      </div>
    );
  }

  // ── Edit mode expanded: full camera panel ───────────────────────────────
  return (
    <div className={`absolute inset-x-0 bottom-0 z-30 animate-fade-in md:inset-x-6 md:bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] md:mx-auto md:max-w-[42rem] xl:inset-x-auto xl:bottom-auto xl:right-4 xl:mx-0 xl:w-[20rem] ${appearance === "workspace" ? "camera-editor-workspace xl:top-20" : "xl:top-4"}`}>
      <div className="max-h-[56dvh] overflow-hidden rounded-t-[var(--floating-panel-radius)] border border-white/[0.1] bg-black/70 pb-[env(safe-area-inset-bottom,0px)] text-white shadow-2xl backdrop-blur-2xl md:max-h-[60dvh] md:rounded-[var(--floating-panel-radius)] md:pb-0 xl:max-h-[calc(100dvh-4.5rem)]">
        <div className="flex h-4 items-center justify-center md:hidden" aria-hidden="true">
          <span className="h-1 w-9 rounded-full bg-white/25" />
        </div>
        <div className="border-b border-white/[0.08] px-2.5 pb-2 pt-0 md:py-2.5">
          <div className="flex min-h-11 items-center justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-[13px] font-semibold">{t("cameraEditor.title", lang)}</h3>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/50 tabular-nums">
                {shots.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {shots.length > 0 && (
                <button
                  type="button"
                  onClick={startPreview}
                  className="floating-control-sm gap-1 px-3 text-white/65 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  <PlayIcon className="h-3 w-3" />
                  {t("cameraEditor.preview", lang)}
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsCollapsed(true)}
                className="floating-icon-button-sm text-white/55 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                aria-label={t("cameraEditor.collapse", lang)}
              >
                <ChevronDownIcon className="h-4 w-4 transition-transform duration-200" />
              </button>
            </div>
          </div>
        </div>
        <div className="space-y-2 overflow-y-auto p-2.5">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button
              variant="outline"
              size="sm"
              className="floating-control-sm h-auto border-white/[0.08] bg-white/10 px-3 text-white shadow-none hover:bg-white/15 hover:shadow-none"
              onClick={addShot}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              {t("cameraEditor.captureCurrentView", lang)}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="floating-control-sm h-auto border-white/[0.08] bg-white/10 px-3 text-white/70 shadow-none hover:bg-white/15 hover:text-white"
              onClick={() => void handleSave()}
              loading={saving}
            >
              {dirty ? t("cameraEditor.saveCameras", lang) : t("cameraEditor.messageSaved", lang)}
            </Button>
          </div>

          <div className="flex min-h-11 items-center gap-3 rounded-[var(--floating-panel-radius)] border border-white/[0.06] bg-white/[0.04] px-3">
            <span className="shrink-0 text-[11px] font-medium text-white/55">{t("cameraEditor.sceneFov", lang)}</span>
            <input
              type="range"
              min={40}
              max={100}
              step={1}
              value={sceneFov}
              onChange={(event) => handleSceneFovChange(Number(event.target.value))}
              aria-label={t("cameraEditor.sceneFov", lang)}
              className="h-11 min-w-0 flex-1 cursor-pointer accent-white"
            />
            <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-white/65">{Math.round(sceneFov)}°</span>
          </div>

          {shots.length === 0 ? (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-3">
              <p className="text-[12px] font-medium text-white/65">{t("cameraEditor.emptyTitle", lang)}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-white/40">{t("cameraEditor.emptyHint", lang)}</p>
            </div>
          ) : (
            <div className="max-h-[30dvh] space-y-1.5 overflow-y-auto pr-0.5 md:max-h-[38dvh] xl:max-h-[22rem]">
              {shots.map((shot, i) => (
                <div
                  key={i}
                  className={`grid grid-cols-1 items-center gap-1 rounded-xl border px-2 py-1.5 text-xs transition-colors duration-200 sm:grid-cols-[1fr_auto] sm:gap-1.5 sm:rounded-lg ${
                    updatedIdx === i
                      ? "border-white/15 bg-white/10"
                      : selectedIdx === i
                        ? "border-white/10 bg-white/[0.06]"
                        : "border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.06]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => goToLocalShot(i)}
                    className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg py-1 text-left font-medium text-white/75 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-black/70"
                    title={t("cameraEditor.jumpToShot", lang)}
                  >
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/10 px-1.5 text-[11px] font-semibold text-white/55">
                      {i + 1}
                    </span>
                    <span className="truncate text-[12px]">{shot.label}</span>
                    {selectedIdx === i && (
                      <CheckIcon className="h-3.5 w-3.5 shrink-0 text-white/55" aria-label={t("cameraEditor.viewing", lang)} />
                    )}
                  </button>

                  <div className="grid grid-cols-4 items-center border-t border-white/[0.06] pt-1 sm:flex sm:border-0 sm:pt-0">
                    <button
                      type="button"
                      onClick={() => goToLocalShot(i)}
                      className="floating-icon-button hidden text-white/40 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:inline-flex"
                      aria-label={t("cameraEditor.jumpToShot", lang)}
                      title={t("cameraEditor.jumpToShot", lang)}
                    >
                      <EyeOpenIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => updateShot(i)}
                      className={`floating-icon-button w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:w-11 ${
                        updatedIdx === i
                          ? "bg-white/15 text-white"
                          : selectedIdx === i
                            ? "bg-white/10 text-white/60 hover:bg-white/15 hover:text-white"
                            : "text-white/45 hover:bg-white/10 hover:text-white"
                      }`}
                      aria-label={updatedIdx === i ? t("cameraEditor.updated", lang) : t("cameraEditor.useCurrentView", lang)}
                      title={updatedIdx === i ? t("cameraEditor.updated", lang) : t("cameraEditor.useCurrentView", lang)}
                    >
                      {updatedIdx === i ? (
                        <CheckIcon className="h-3.5 w-3.5" />
                      ) : (
                        <UpdateIcon className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => moveShot(i, -1)}
                      disabled={i === 0}
                      className="floating-icon-button w-full text-white/45 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:opacity-25 sm:w-11 sm:text-white/35"
                      aria-label={`${t("cameraEditor.moveUp", lang)} ${i + 1}`}
                      title={t("cameraEditor.moveUp", lang)}
                    >
                      <ArrowUpIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveShot(i, 1)}
                      disabled={i === shots.length - 1}
                      className="floating-icon-button w-full text-white/45 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:opacity-25 sm:w-11 sm:text-white/35"
                      aria-label={`${t("cameraEditor.moveDown", lang)} ${i + 1}`}
                      title={t("cameraEditor.moveDown", lang)}
                    >
                      <ArrowDownIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeShot(i)}
                      className="floating-icon-button w-full text-white/40 hover:bg-red-500/15 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:w-11 sm:text-white/30"
                      aria-label={`${t("cameraEditor.delete", lang)} ${i + 1}`}
                      title={t("cameraEditor.delete", lang)}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {message && (
            <p role="status" aria-live="polite" className={`px-1 text-[11px] ${isError ? "text-red-400" : "text-white/55"}`}>
              {message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
