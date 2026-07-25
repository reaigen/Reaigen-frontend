"use client";

import { useState, useCallback, useEffect, useRef, type RefObject } from "react";
import { ArrowDownIcon, ArrowUpIcon, EyeOpenIcon, PlusIcon, TrashIcon, UpdateIcon } from "@radix-ui/react-icons";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ChevronDownIcon, PlayIcon } from "./icons";
import { Button } from "@/app/lib/ui/button";
import { saveCameras, getCameras } from "@/app/lib/api/client";
import { getSafeApiErrorMessage } from "@/app/lib/api/error-message";
import { cameraFovDegrees, cameraFovRadians, markIdentityCamera, normalizeCameraData } from "@/app/lib/camera-coordinates";
import { t } from "@/app/lib/i18n";
import type { CameraData, Vec3 } from "@/app/lib/tour-types";
import type { SplatViewerHandle } from "./splat-viewer";

interface CameraShot {
  position: Vec3;
  forward: Vec3;
  up: Vec3;
  fov: number;
  label: string;
}

interface Props {
  splatId: number;
  viewerRef: RefObject<SplatViewerHandle | null>;
  /** Shot index reported by the viewer (arrow-key / tour navigation). */
  activeShotIdx?: number;
  /** Already-loaded viewer cameras; avoids a duplicate request in the studio. */
  initialCameras?: CameraData | null;
  defaultMode?: "edit" | "preview";
  onSaved?: () => void;
  lang?: string;
}

export default function CameraEditor({ splatId, viewerRef, activeShotIdx, initialCameras, defaultMode = "edit", onSaved, lang = "en" }: Props) {
  const [shots, setShots] = useState<CameraShot[]>([]);
  const [mode, setMode] = useState<"edit" | "preview">(defaultMode);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [looping, setLooping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [sceneFov, setSceneFov] = useState<number>(85);
  const [isCollapsed, setIsCollapsed] = useState(() => (
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px), (pointer: coarse)").matches
  ));
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load existing saved cameras on mount. New camera payloads use identity
  // scene space; historical edited payloads are migrated once on read.
  useEffect(() => {
    let active = true;
    const applyCameraData = (rawData: CameraData) => {
      if (!active) return;
      const data = normalizeCameraData(rawData);
      const sceneCameraFov = data.sceneFov
        ? cameraFovRadians(data.sceneFov, 0.66)
        : null;
      if (data.cameras?.length) {
        const loaded = data.cameras.map((c, i) => ({
          position: c.position,
          forward: c.forward,
          up: c.up ?? [0, 1, 0],
          fov: sceneCameraFov ?? cameraFovRadians(c.fov ?? data.fovY, 0.66),
          label: `${t("cameraEditor.camera", lang)} ${i + 1}`,
        }));
        setShots(loaded);
        setSelectedIdx(defaultMode === "preview" ? 0 : null);
        setPreviewIdx(0);
        // Start in preview mode — fly to first shot but don't auto-loop
        if (defaultMode === "preview" && loaded.length > 0) {
          setMode("preview");
          setPreviewIdx(0);
        }
      }
      if (data.sceneFov) {
        const sceneFovDegrees = cameraFovDegrees(data.sceneFov);
        setSceneFov(sceneFovDegrees);
        viewerRef.current?.setFov(sceneFovDegrees);
      }
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
  }, [initialCameras, splatId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    viewerRef.current?.navigateToCamera(shot.position, shot.forward, false, shot.fov);
    if (!preview) setTransientMessage(`${t("cameraEditor.viewing", lang)} ${idx + 1}`, 1000);
  }, [lang, setTransientMessage, shots, viewerRef]);

  useEffect(() => {
    if (!loaded || !shots.length) return;
    if (defaultMode === "preview" && selectedIdx === 0) {
      viewerRef.current?.navigateToCamera(shots[0].position, shots[0].forward, true, shots[0].fov);
    }
  }, [defaultMode, loaded, selectedIdx, shots, viewerRef]);

  // ── Edit mode actions ──────────────────────────────────────────────────────

  const addShot = useCallback(() => {
    const cam = viewerRef.current?.getCurrentCamera();
    if (!cam) return;
    setShots((prev) => {
      const next = [
        ...prev,
        {
          position: cam.position,
          forward: cam.forward,
          up: cam.up,
          fov: cam.fov,
          label: `${t("cameraEditor.camera", lang)} ${prev.length + 1}`,
        },
      ];
      const nextIdx = next.length - 1;
      setSelectedIdx(nextIdx);
      setPreviewIdx(nextIdx);
      return next;
    });
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
        i === idx ? { ...s, position: cam.position, forward: cam.forward, up: cam.up, fov: cam.fov } : s
      )
    );
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
    setTransientMessage(t("cameraEditor.messageRemoved", lang));
  }, [setTransientMessage, lang]);

  const moveShot = useCallback((idx: number, dir: -1 | 1) => {
    setShots((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      if (selectedIdx === idx) setSelectedIdx(target);
      else if (selectedIdx === target) setSelectedIdx(idx);
      if (previewIdx === idx) setPreviewIdx(target);
      else if (previewIdx === target) setPreviewIdx(idx);
      // Renumber labels after reorder
      return next.map((s, i) => ({ ...s, label: `${t("cameraEditor.camera", lang)} ${i + 1}` }));
    });
    setTransientMessage(t("cameraEditor.messageOrderUpdated", lang), 1400);
  }, [previewIdx, selectedIdx, setTransientMessage, lang]);

  const handleSave = useCallback(async () => {
    if (!shots.length) {
      setIsError(false);
      setMessage(t("cameraEditor.messageAddShotFirst", lang));
      return;
    }
    setSaving(true);
    setIsError(false);
    setMessage(null);
    try {
      await saveCameras(splatId, {
        cameras: shots.map((s) => markIdentityCamera({
          position: [...s.position],
          forward: [...s.forward],
          up: [...s.up],
          fov: s.fov,
        })),
        fovY: shots[0]?.fov ?? 0.66,
        sceneFov,
      });
      setTransientMessage(t("cameraEditor.messageSaved", lang));
      onSaved?.();
    } catch (err) {
      setIsError(true);
      setMessage(`${t("cameraEditor.messageSaveFailed", lang)} ${getSafeApiErrorMessage(err, lang)}`);
    } finally {
      setSaving(false);
    }
  }, [shots, splatId, sceneFov, setTransientMessage, onSaved, lang]);

  const handleSceneFovChange = useCallback((value: number) => {
    setSceneFov(value);
    const radians = cameraFovRadians(value, 0.66);
    setShots((current) => current.map((shot) => ({ ...shot, fov: radians })));
    viewerRef.current?.setFov(value);
  }, [viewerRef]);

  // ── Preview mode ───────────────────────────────────────────────────────────

  const startPreview = useCallback(() => {
    if (!shots.length) return;
    setMode("preview");
    const targetIdx = selectedIdx ?? 0;
    setPreviewIdx(targetIdx);
    viewerRef.current?.navigateToCamera(shots[targetIdx].position, shots[targetIdx].forward, false, shots[targetIdx].fov);
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
      viewerRef.current?.navigateToCamera(shots[next].position, shots[next].forward, false, shots[next].fov);
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
    const next = selectedIdx == null || selectedIdx <= 0 ? shots.length - 1 : selectedIdx - 1;
    goToLocalShot(next, mode === "preview");
  }, [goToLocalShot, mode, selectedIdx, shots.length]);

  const nextShot = useCallback(() => {
    if (!shots.length) return;
    const next = selectedIdx == null || selectedIdx >= shots.length - 1 ? 0 : selectedIdx + 1;
    goToLocalShot(next, mode === "preview");
  }, [goToLocalShot, mode, selectedIdx, shots.length]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!loaded) return null;

  const ArrowLeft = <ArrowLeftIcon size={14} />;
  const ArrowRight = <ArrowRightIcon size={14} />;

  // ── Preview mode: floating pill with arrows ─────────────────────────────
  if (mode === "preview") {
    return (
      <div className="absolute inset-x-2 bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] z-30 flex justify-center animate-fade-in md:inset-x-6 md:bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] xl:inset-x-auto xl:bottom-auto xl:right-4 xl:top-4 xl:justify-end">
        <div className="flex max-w-full items-center gap-0.5 rounded-2xl border border-white/[0.1] bg-black/70 p-1 text-white shadow-2xl backdrop-blur-2xl sm:rounded-full">
          {/* Play / Pause */}
          <button
            type="button"
            onClick={() => setLooping((v) => !v)}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:h-8 sm:w-8 ${
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
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:h-8 sm:w-8"
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
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:h-8 sm:w-8"
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
            className="flex h-11 shrink-0 items-center rounded-full px-3 text-[11px] font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:h-8"
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
      <div className="absolute inset-x-2 bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] z-30 flex justify-center animate-fade-in md:inset-x-6 md:bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] xl:inset-x-auto xl:bottom-auto xl:right-4 xl:top-4 xl:justify-end">
        <div className="flex max-w-full items-center gap-0.5 rounded-2xl border border-white/[0.1] bg-black/70 p-1 text-white shadow-2xl backdrop-blur-2xl sm:rounded-full">
          <button
            type="button"
            onClick={() => setIsCollapsed(false)}
            className="flex h-11 min-w-0 items-center gap-2 rounded-full px-3 text-left text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:h-8 sm:px-2.5"
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
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:h-8 sm:w-8"
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
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:h-8 sm:w-8"
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
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.12] text-white/85 transition-colors hover:bg-white/[0.18] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 sm:h-8 sm:w-8"
            aria-label={t("cameraEditor.captureCurrentView", lang)}
            title={t("cameraEditor.captureCurrentView", lang)}
          >
            <PlusIcon className="h-4 w-4" />
          </button>

          {shots.length > 0 && (
            <button
              type="button"
              onClick={startPreview}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:h-8 sm:w-8"
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
    <div className="absolute inset-x-0 bottom-0 z-30 animate-fade-in md:inset-x-6 md:bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] md:mx-auto md:max-w-[42rem] xl:inset-x-auto xl:bottom-auto xl:right-4 xl:top-4 xl:mx-0 xl:w-[19.5rem]">
      <div className="max-h-[56dvh] overflow-hidden rounded-t-[1.25rem] border border-white/[0.1] bg-black/70 pb-[env(safe-area-inset-bottom,0px)] text-white shadow-2xl backdrop-blur-2xl md:max-h-[60dvh] md:rounded-2xl md:pb-0 xl:max-h-[calc(100dvh-4.5rem)] xl:rounded-xl">
        <div className="flex h-4 items-center justify-center md:hidden" aria-hidden="true">
          <span className="h-1 w-9 rounded-full bg-white/25" />
        </div>
        <div className="border-b border-white/[0.08] px-2.5 pb-2 pt-0 md:py-2.5">
          <div className="flex min-h-11 items-center justify-between md:min-h-0">
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
                  className="inline-flex h-11 items-center gap-1 rounded-full px-3 text-[11px] font-medium text-white/65 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 md:h-7 md:px-2"
                >
                  <PlayIcon className="h-3 w-3" />
                  {t("cameraEditor.preview", lang)}
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsCollapsed(true)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 md:h-7 md:w-7"
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
              className="h-11 rounded-full border-white/[0.08] bg-white/10 px-3 text-[12px] text-white shadow-none hover:bg-white/15 hover:shadow-none sm:h-8"
              onClick={addShot}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              {t("cameraEditor.captureCurrentView", lang)}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-11 rounded-full border-white/[0.08] bg-white/10 px-3 text-[12px] text-white/70 shadow-none hover:bg-white/15 hover:text-white sm:h-8"
              onClick={handleSave}
              loading={saving}
              disabled={!shots.length}
            >
              {t("cameraEditor.saveCameras", lang)}
            </Button>
          </div>

          <div className="flex min-h-11 items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 sm:min-h-9">
            <span className="shrink-0 text-[11px] font-medium text-white/55">{t("cameraEditor.sceneFov", lang)}</span>
            <input
              type="range"
              min={40}
              max={100}
              step={1}
              value={sceneFov}
              onChange={(event) => handleSceneFovChange(Number(event.target.value))}
              aria-label={t("cameraEditor.sceneFov", lang)}
              className="h-11 min-w-0 flex-1 cursor-pointer accent-white sm:h-9"
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
                    className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg py-1 text-left font-medium text-white/75 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-black/70 sm:min-h-0"
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
                      className="hidden h-7 w-7 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:inline-flex"
                      aria-label={t("cameraEditor.jumpToShot", lang)}
                      title={t("cameraEditor.jumpToShot", lang)}
                    >
                      <EyeOpenIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => updateShot(i)}
                      className={`inline-flex h-11 w-full items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:h-7 sm:w-7 ${
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
                      className="inline-flex h-11 w-full items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:opacity-25 sm:h-7 sm:w-7 sm:text-white/35"
                      aria-label={`${t("cameraEditor.moveUp", lang)} ${i + 1}`}
                      title={t("cameraEditor.moveUp", lang)}
                    >
                      <ArrowUpIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveShot(i, 1)}
                      disabled={i === shots.length - 1}
                      className="inline-flex h-11 w-full items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:opacity-25 sm:h-7 sm:w-7 sm:text-white/35"
                      aria-label={`${t("cameraEditor.moveDown", lang)} ${i + 1}`}
                      title={t("cameraEditor.moveDown", lang)}
                    >
                      <ArrowDownIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeShot(i)}
                      className="inline-flex h-11 w-full items-center justify-center rounded-full text-white/40 transition-colors hover:bg-red-500/15 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:h-7 sm:w-7 sm:text-white/30"
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
