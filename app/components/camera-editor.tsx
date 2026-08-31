"use client";

import { useState, useCallback, useEffect, useRef, type RefObject } from "react";
import { ArrowDownIcon, ArrowUpIcon, EyeOpenIcon, PlusIcon, TrashIcon, UpdateIcon } from "@radix-ui/react-icons";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ChevronDownIcon, PlayIcon } from "./icons";
import { AdjustmentSlider } from "@/app/lib/ui/adjustment-slider";
import { Button } from "@/app/lib/ui/button";
import { saveCameras, getCameras } from "@/app/lib/api/client";
import { getSafeApiErrorMessage } from "@/app/lib/api/error-message";
import { savedCameraNavigationIsInstant, stableCameraReferenceUp } from "@/app/lib/camera-navigation";
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

function cameraDisplayLabel(shot: CameraShot | undefined, index: number, lang: string) {
  const label = shot?.label?.trim();
  // Generated labels are positional and were baked in whatever language the
  // capture session ran in, so a list can read "Kamera 1, Camera 2". Treat
  // every generated form as generated and render it in the current language;
  // only a label the user actually typed passes through.
  if (!label || label === "|" || label === String(index + 1) || /^(camera|kamera)\s+\d+$/i.test(label)) {
    return `${t("cameraEditor.camera", lang)} ${index + 1}`;
  }
  return label;
}

interface Props {
  splatId: number;
  viewerRef: RefObject<SplatViewerHandle | null>;
  /** Shot index reported by the viewer (arrow-key / tour navigation). */
  activeShotIdx?: number;
  /** Already-loaded viewer cameras; avoids a duplicate request in the studio. */
  initialCameras?: CameraData | null;
  defaultMode?: "edit" | "preview";
  /** Whether the owning camera surface is currently visible to the user. */
  isOpen?: boolean;
  onSaved?: (saved: CameraData) => void;
  /** Stage camera edits in the owning workspace before the debounced save. */
  onChange?: (data: CameraData) => void;
  saveHandler?: (data: CameraData) => Promise<CameraData>;
  sceneTransform?: GlobalSceneTransform;
  appearance?: "overlay" | "workspace";
  lang?: string;
}

function cameraPayload(shots: CameraShot[], sceneFov: number): CameraData {
  return {
    cameras: shots.map((shot) => markIdentityCamera({
      id: shot.id,
      position: [...shot.position],
      forward: [...shot.forward],
      up: stableCameraReferenceUp(shot.up),
      fov: shot.fov,
      label: shot.label,
      kind: shot.kind,
      role: shot.role,
    })),
    fovY: shots[0]?.fov ?? cameraFovRadians(sceneFov, 0.66),
    sceneFov,
  };
}

export default function CameraEditor({ splatId, viewerRef, activeShotIdx, initialCameras, defaultMode = "preview", isOpen = true, onSaved, onChange, saveHandler, sceneTransform, appearance = "overlay", lang = "en" }: Props) {
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
  // Framing a shot means holding a pose while reaching for controls, which a
  // thumb on a phone cannot do well. Authoring is desktop-only; phones keep the
  // full preview pill. Width, not pointer: touchscreen laptops report a coarse
  // pointer and would lose authoring they can perform perfectly well.
  const [compactViewport, setCompactViewport] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches,
  );
  const shotsRef = useRef<CameraShot[]>([]);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editGenerationRef = useRef(0);
  // Mirrors editGenerationRef so the autosave effect re-runs on every edit.
  const [editGeneration, setEditGeneration] = useState(0);
  // Generation whose save failed. Autosave stays parked on it until the next
  // edit, so a rejected save cannot become a 650ms retry loop.
  const failedGenerationRef = useRef<number | null>(null);
  const wasOpenRef = useRef(false);

  // Camera coordinates returned by SplatViewer are already canonical. Keep the
  // prop for API compatibility with other editor surfaces, but never apply the
  // scene inverse a second time.
  void sceneTransform;

  // The workspace remap in globals.css flattens the pill onto light glass but
  // only rewrites the white/* steps it lists. The shot dots sit outside that
  // list (bg-white, bg-white/30), which left them white-on-white in the
  // advanced editor, so they pick their ink from the appearance directly.
  const shotDotClass = (active: boolean) => active
    ? `w-4 ${appearance === "workspace" ? "bg-foreground/80" : "bg-white"}`
    : `w-1.5 ${
      appearance === "workspace"
        ? "bg-foreground/30 group-hover/dot:bg-foreground/55"
        : "bg-white/30 group-hover/dot:bg-white/55"
    }`;

  // Load existing saved cameras on mount. New camera payloads use identity
  // scene space; historical edited payloads are migrated once on read.
  useEffect(() => {
    let active = true;
    const applyCameraData = (rawData: CameraData) => {
      if (!active) return;
      const data = normalizeCameraData(rawData);
      const currentViewportFov = viewerRef.current?.getCurrentCamera()?.fov ?? Math.PI / 3;
      const loadedShots = (data.cameras ?? []).map((c, i) => ({
          id: c.id ?? newCameraId(),
          position: c.position,
          forward: c.forward,
          up: stableCameraReferenceUp(c.up ?? [0, 1, 0]),
          // A shot's captured lens is authoritative. sceneFov is only a
          // fallback for historical payloads that did not store per-shot FOV.
          fov: cameraFovRadians(c.fov ?? data.fovY ?? data.sceneFov, currentViewportFov),
          label: c.label ?? c.name ?? `${t("cameraEditor.camera", lang)} ${i + 1}`,
          kind: "authored" as const,
          role: (c.role === "hero" || c.role === "transition" ? c.role : "tour") as CameraShot["role"],
        }));
      shotsRef.current = loadedShots;
      setShots(loadedShots);
      setDirty(false);
      editGenerationRef.current += 1;
      setSelectedIdx(loadedShots.length ? 0 : null);
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

  /** Record a user edit and let autosave pick it up. */
  const markEdited = useCallback(() => {
    editGenerationRef.current += 1;
    setEditGeneration(editGenerationRef.current);
    setDirty(true);
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
    // Camera editing is an exact look-through operation. Preview navigation is
    // the only place where a presentation flight belongs; otherwise Update
    // could capture and persist a half-finished trajectory instead of the
    // authored camera pose.
    viewerRef.current?.navigateToCamera(
      shot.position,
      shot.forward,
      savedCameraNavigationIsInstant(preview ? "preview" : "edit"),
      shot.fov,
      shot.up,
    );
    if (!preview) setTransientMessage(`${t("cameraEditor.viewing", lang)} ${idx + 1}`, 1000);
  }, [lang, setTransientMessage, shots, viewerRef]);

  // Treat each panel access as a fresh camera-review session. The advanced
  // editor keeps this component mounted while the camera panel is hidden, so
  // mount-time defaults alone cannot restore Preview when the user reopens it.
  // Entering Edit remains an explicit action via stopPreview().
  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      setLooping(false);
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
      viewerRef.current?.enableFreeCamera();
      return;
    }
    if (!loaded || wasOpenRef.current) return;
    wasOpenRef.current = true;

    const currentShots = shotsRef.current;
    if (!currentShots.length) {
      setMode("edit");
      setSelectedIdx(null);
      setPreviewIdx(0);
      viewerRef.current?.enableFreeCamera();
      return;
    }

    const targetIdx = selectedIdx != null && selectedIdx < currentShots.length
      ? selectedIdx
      : 0;
    setSelectedIdx(targetIdx);
    setPreviewIdx(targetIdx);
    setLooping(false);
    setMode(defaultMode);
    if (defaultMode === "preview") {
      setIsCollapsed(true);
      const shot = currentShots[targetIdx];
      viewerRef.current?.navigateToCamera(
        shot.position,
        shot.forward,
        savedCameraNavigationIsInstant("initial"),
        shot.fov,
        shot.up,
      );
    } else {
      viewerRef.current?.enableFreeCamera();
    }
  }, [defaultMode, isOpen, loaded, selectedIdx, viewerRef]);

  // ── Edit mode actions ──────────────────────────────────────────────────────

  const addShot = useCallback(() => {
    const cam = viewerRef.current?.getCurrentCamera();
    if (!cam) return;
    const currentShots = shotsRef.current;
    const next = [
      ...currentShots,
      {
        id: newCameraId(),
        position: [...cam.position] as Vec3,
        forward: [...cam.forward] as Vec3,
        up: [...cam.up] as Vec3,
        fov: cam.fov,
        label: `${t("cameraEditor.camera", lang)} ${currentShots.length + 1}`,
        kind: "authored" as const,
        role: "tour" as const,
      },
    ];
    const nextIdx = next.length - 1;
    shotsRef.current = next;
    setShots(next);
    setSelectedIdx(nextIdx);
    setPreviewIdx(nextIdx);
    onChange?.(cameraPayload(next, sceneFov));
    markEdited();
    setMode("edit");
    setIsCollapsed(false);
    setTransientMessage(t("cameraEditor.messageCaptured", lang));
  }, [lang, markEdited, onChange, sceneFov, setTransientMessage, viewerRef]);

  const [updatedIdx, setUpdatedIdx] = useState<number | null>(null);

  const updateShot = useCallback((idx: number) => {
    const cam = viewerRef.current?.getCurrentCamera();
    if (!cam) return;
    const next = shotsRef.current.map((shot, i) =>
      i === idx ? {
        ...shot,
        position: [...cam.position] as Vec3,
        forward: [...cam.forward] as Vec3,
        up: [...cam.up] as Vec3,
        fov: cam.fov,
      } : shot
    );
    shotsRef.current = next;
    setShots(next);
    onChange?.(cameraPayload(next, sceneFov));
    markEdited();
    setUpdatedIdx(idx);
    setSelectedIdx(idx);
    setPreviewIdx(idx);
    setTimeout(() => setUpdatedIdx(null), 1500);
    setTransientMessage(t("cameraEditor.messageUpdated", lang));
  }, [lang, markEdited, onChange, sceneFov, setTransientMessage, viewerRef]);

  const removeShot = useCallback((idx: number) => {
    const next = shotsRef.current
      .filter((_, i) => i !== idx)
      .map((shot, i) => ({ ...shot, label: `${t("cameraEditor.camera", lang)} ${i + 1}` }));
    shotsRef.current = next;
    setShots(next);
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
    onChange?.(cameraPayload(next, sceneFov));
    markEdited();
    setTransientMessage(t("cameraEditor.messageRemoved", lang));
  }, [lang, markEdited, onChange, sceneFov, setTransientMessage]);

  const moveShot = useCallback((idx: number, dir: -1 | 1) => {
    const currentShots = shotsRef.current;
    const target = idx + dir;
    if (target < 0 || target >= currentShots.length) return;
    const reordered = [...currentShots];
    [reordered[idx], reordered[target]] = [reordered[target], reordered[idx]];
    const next = reordered.map((shot, i) => ({
      ...shot,
      label: `${t("cameraEditor.camera", lang)} ${i + 1}`,
    }));
    shotsRef.current = next;
    setShots(next);
    if (selectedIdx === idx) setSelectedIdx(target);
    else if (selectedIdx === target) setSelectedIdx(idx);
    if (previewIdx === idx) setPreviewIdx(target);
    else if (previewIdx === target) setPreviewIdx(idx);
    onChange?.(cameraPayload(next, sceneFov));
    markEdited();
    setTransientMessage(t("cameraEditor.messageOrderUpdated", lang), 1400);
  }, [lang, markEdited, onChange, previewIdx, sceneFov, selectedIdx, setTransientMessage]);

  const handleSave = useCallback(async (announce = true) => {
    const generation = editGenerationRef.current;
    const snapshot = shotsRef.current.map((shot) => ({
      ...shot,
      position: [...shot.position] as Vec3,
      forward: [...shot.forward] as Vec3,
      up: [...shot.up] as Vec3,
    }));
    setSaving(true);
    setIsError(false);
    if (announce) setMessage(null);
    try {
      const payload = cameraPayload(snapshot, sceneFov);
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
        setShots((current) => {
          const next = current.map((shot, index) => ({
            ...shot,
            id: saved.cameras[index]?.id ?? shot.id,
          }));
          shotsRef.current = next;
          return next;
        });
      }
      if (editGenerationRef.current === generation) setDirty(false);
      failedGenerationRef.current = null;
      if (announce) setTransientMessage(t("cameraEditor.messageSaved", lang));
      onSaved?.(saved);
    } catch (err) {
      // Park autosave on this generation. The edit stays dirty so an explicit
      // Save still retries, but the debounce no longer reschedules itself
      // against an endpoint that just rejected the exact same payload.
      failedGenerationRef.current = generation;
      setIsError(true);
      setMessage(`${t("cameraEditor.messageSaveFailed", lang)} ${getSafeApiErrorMessage(err, lang)}`);
    } finally {
      setSaving(false);
    }
  }, [splatId, sceneFov, sceneRevision, setTransientMessage, onSaved, saveHandler, lang]);

  // Camera edits are workspace edits. Persist them automatically so collapsing
  // or closing the panel cannot silently discard a captured shot.
  useEffect(() => {
    if (!loaded || !dirty || saving) return;
    if (failedGenerationRef.current === editGenerationRef.current) return;
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
  }, [dirty, editGeneration, handleSave, loaded, saving]);

  const handleSceneFovChange = useCallback((value: number) => {
    setSceneFov(value);
    const radians = cameraFovRadians(value, 0.66);
    const next = shotsRef.current.map((shot) => ({ ...shot, fov: radians }));
    shotsRef.current = next;
    setShots(next);
    onChange?.(cameraPayload(next, value));
    markEdited();
    viewerRef.current?.setFov(value);
  }, [markEdited, onChange, viewerRef]);

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

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const sync = () => setCompactViewport(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Rotating into a compact viewport mid-edit must not leave the user holding
  // an authoring surface they can no longer work. Pending edits already went
  // through the debounced autosave, so falling back to preview loses nothing.
  useEffect(() => {
    if (compactViewport && mode === "edit") startPreview();
  }, [compactViewport, mode, startPreview]);

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
  // A tour with no saved cameras opens straight in edit mode, which the
  // startPreview() fallback cannot undo because there is no shot to fly to.
  // On a phone there is then nothing to offer: authoring is desktop-only and
  // an empty preview pill would be worse than no chrome at all.
  if (compactViewport && mode === "edit") return null;

  const ArrowLeft = <ArrowLeftIcon size={14} />;
  const ArrowRight = <ArrowRightIcon size={14} />;
  const canGoPrevious = shots.length > 1;
  const canGoNext = shots.length > 1;

  // Below `xl` the workspace keeps its own toolbar pinned bottom-centre
  // (`bottom-4`, ~3.5rem tall) and the dock shares that spot at the same
  // z-index, so it painted straight over the toolbar. Sit above it instead.
  // `xl:bottom-auto` still hands the panel to the right rail unchanged.
  const dockBottom = appearance === "workspace"
    ? "md:bottom-[calc(5rem+env(safe-area-inset-bottom,0px))]"
    : "md:bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))]";
  const desktopTopDock = appearance === "workspace"
    ? "xl:right-4 xl:top-[3.75rem]"
    : "xl:right-6 xl:top-[calc(1rem+env(safe-area-inset-top,0px))]";

  // ── Preview mode: floating pill with arrows ─────────────────────────────
  if (mode === "preview") {
    return (
      <div data-testid="camera-editor-preview" className={`absolute inset-x-2 bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] z-30 flex justify-center animate-fade-in md:inset-x-6 ${dockBottom} xl:inset-x-auto xl:bottom-auto xl:justify-end ${desktopTopDock} ${appearance === "workspace" ? "camera-editor-workspace" : ""}`}>
        <div className="viewer-top-control floating-toolbar-shape max-w-full border border-white/[0.16] bg-black/60 text-white shadow-2xl backdrop-blur-2xl">
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
                  className="group/dot inline-flex min-h-9 min-w-9 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  aria-label={`${t("cameraEditor.camera", lang)} ${i + 1}`}
                  aria-current={i === previewIdx ? "true" : undefined}
                >
                  <span
                    className={`block h-1.5 rounded-full transition-all duration-300 ${shotDotClass(i === previewIdx)}`}
                  />
                </button>
              ))}
            </div>
          )}

          <div className="min-w-0 px-1.5 text-center sm:hidden">
            <span className="block max-w-[6.5rem] truncate text-[11px] font-medium text-white/80">
              {cameraDisplayLabel(shots[previewIdx], previewIdx, lang)}
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

          {/* Divider + Edit button — authoring is desktop-only */}
          {!compactViewport && (
            <>
              <div className="h-4 w-px bg-white/15" />

              <button
                type="button"
                data-testid="camera-editor-edit"
                onClick={stopPreview}
                className="floating-control px-3 text-[11px] text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                {t("cameraEditor.edit", lang)}
              </button>
            </>
          )}

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
      <div data-testid="camera-editor-collapsed" className={`absolute inset-x-2 bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] z-30 flex justify-center animate-fade-in md:inset-x-6 ${dockBottom} xl:inset-x-auto xl:bottom-auto xl:justify-end ${desktopTopDock} ${appearance === "workspace" ? "camera-editor-workspace" : ""}`}>
        <div className="viewer-top-control floating-toolbar-shape max-w-full border border-white/[0.16] bg-black/60 text-white shadow-2xl backdrop-blur-2xl">
          <button
            type="button"
            data-testid="camera-editor-expand"
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
                  className="group/dot inline-flex min-h-9 min-w-9 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  aria-label={`${t("cameraEditor.camera", lang)} ${i + 1}`}
                  aria-current={i === selectedIdx ? "true" : undefined}
                >
                  <span
                    className={`block h-1.5 rounded-full transition-all duration-300 ${shotDotClass(i === selectedIdx)}`}
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
    <div data-testid="camera-editor-expanded" className={`absolute inset-x-0 bottom-0 z-30 animate-fade-in md:inset-x-6 ${dockBottom} md:mx-auto md:max-w-[42rem] xl:inset-x-auto xl:bottom-auto xl:mx-0 xl:w-[20rem] ${desktopTopDock} ${appearance === "workspace" ? "camera-editor-workspace" : ""}`}>
      <div className="max-h-[56dvh] overflow-hidden rounded-t-[var(--floating-panel-radius)] border border-white/[0.16] bg-black/60 pb-[env(safe-area-inset-bottom,0px)] text-white shadow-2xl backdrop-blur-2xl md:max-h-[60dvh] md:rounded-[var(--floating-panel-radius)] md:pb-0 xl:max-h-[calc(100dvh-6.5rem)]">
        <div className="flex h-4 items-center justify-center md:hidden" aria-hidden="true">
          <span className="h-1 w-9 rounded-full bg-white/25" />
        </div>
        <div className="border-b border-white/[0.08] px-2.5 pb-2 pt-0 md:py-2.5">
          <div className="flex min-h-11 items-center justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-[13px] font-semibold">{t("cameraEditor.title", lang)}</h2>
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
            {dirty || saving ? (
              <Button
                variant="outline"
                size="sm"
                className="floating-control-sm h-auto border-white/[0.08] bg-white/10 px-3 text-white/70 shadow-none hover:bg-white/15 hover:text-white"
                onClick={() => void handleSave()}
                loading={saving}
              >
                {t("cameraEditor.saveCameras", lang)}
              </Button>
            ) : (
              <div
                className="inline-flex min-h-9 items-center gap-1.5 px-2 text-[11px] font-medium text-white/45"
                role="status"
              >
                <CheckIcon className="h-3.5 w-3.5 text-emerald-300/70" />
                {t("cameraEditor.messageSaved", lang)}
              </div>
            )}
          </div>

          {/* 60° is the lens the editor opens on, so it is the detent the fill
              grows out of — an untouched scene reads as an empty track. */}
          <div className="rounded-[var(--floating-panel-radius)] border border-white/[0.06] bg-white/[0.04] px-3 py-1">
            <AdjustmentSlider
              label={t("cameraEditor.sceneFov", lang)}
              value={sceneFov}
              min={40}
              max={100}
              step={1}
              origin={60}
              displayValue={`${Math.round(sceneFov)}°`}
              resetLabel={t("draft.media.resetEdits", lang)}
              tone={appearance === "workspace" ? "default" : "onDark"}
              onChange={handleSceneFovChange}
            />
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
                    <span className="min-w-0 flex-1 truncate text-[12px]">{cameraDisplayLabel(shot, i, lang)}</span>
                    {selectedIdx === i && (
                      <CheckIcon className="h-3.5 w-3.5 shrink-0 text-white/55" aria-label={t("cameraEditor.viewing", lang)} />
                    )}
                  </button>

                  <div className="grid grid-cols-4 items-center border-t border-white/[0.06] pt-1 sm:flex sm:border-0 sm:pt-0">
                    <button
                      type="button"
                      onClick={() => updateShot(i)}
                      className={`floating-icon-button w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:h-9 sm:w-9 ${
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
                      className="floating-icon-button w-full text-white/55 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:opacity-30 sm:h-9 sm:w-9 sm:text-white/50"
                      aria-label={`${t("cameraEditor.moveUp", lang)} ${i + 1}`}
                      title={t("cameraEditor.moveUp", lang)}
                    >
                      <ArrowUpIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveShot(i, 1)}
                      disabled={i === shots.length - 1}
                      className="floating-icon-button w-full text-white/55 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:opacity-30 sm:h-9 sm:w-9 sm:text-white/50"
                      aria-label={`${t("cameraEditor.moveDown", lang)} ${i + 1}`}
                      title={t("cameraEditor.moveDown", lang)}
                    >
                      <ArrowDownIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeShot(i)}
                      className="floating-icon-button w-full text-white/55 hover:bg-red-500/15 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:h-9 sm:w-9 sm:text-white/50"
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
