"use client";

import { useState, useCallback, useEffect, useRef, type RefObject } from "react";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, ChevronDownIcon, EyeOpenIcon, PlusIcon, PlayIcon, TrashIcon, UpdateIcon } from "@radix-ui/react-icons";
import { Button } from "@/app/lib/ui/button";
import { saveCameras, getCameras } from "@/app/lib/api/client";
import { getSafeApiErrorMessage } from "@/app/lib/api/error-message";
import { t } from "@/app/lib/i18n";
import type { Vec3 } from "@/app/lib/tour-types";
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
  defaultMode?: "edit" | "preview";
  onSaved?: () => void;
  lang?: string;
}

export default function CameraEditor({ splatId, viewerRef, activeShotIdx, defaultMode = "edit", onSaved, lang = "en" }: Props) {
  const [shots, setShots] = useState<CameraShot[]>([]);
  const [mode, setMode] = useState<"edit" | "preview">(defaultMode);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [looping, setLooping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sceneFov, setSceneFov] = useState<number>(65);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load existing saved cameras on mount
  useEffect(() => {
    getCameras(splatId)
      .then((data) => {
        if (data.cameras?.length) {
          const loaded = data.cameras.map((c, i) => ({
            position: c.position,
            forward: c.forward,
            up: c.up ?? [0, 1, 0],
            fov: Number(c.fov ?? data.fovY ?? 0.66),
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
          setSceneFov(data.sceneFov);
          viewerRef.current?.setFov(data.sceneFov);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
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
    };
  }, []);

  const setTransientMessage = useCallback((next: string | null, ms = 2200) => {
    if (clearMessageTimerRef.current) clearTimeout(clearMessageTimerRef.current);
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
      setMessage(t("cameraEditor.messageAddShotFirst", lang));
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await saveCameras(splatId, {
        cameras: shots.map((s) => ({
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
      setMessage(`${t("cameraEditor.messageSaveFailed", lang)} ${getSafeApiErrorMessage(err, lang)}`);
    } finally {
      setSaving(false);
    }
  }, [shots, splatId, sceneFov, setTransientMessage, onSaved, lang]);

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

  // Shared arrow SVG
  const ArrowLeft = (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  const ArrowRight = (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  // ── Preview mode: floating pill with arrows ─────────────────────────────
  if (mode === "preview") {
    return (
      <div className="absolute inset-x-2 top-4 z-30 flex justify-end animate-fade-in sm:inset-x-auto sm:right-4">
        <div className="flex max-w-full items-center gap-1 rounded-full border border-white/[0.08] bg-black/70 px-1.5 py-1 text-white shadow-2xl backdrop-blur-2xl">
          {/* Play / Pause */}
          <button
            onClick={() => setLooping((v) => !v)}
            className={`rounded-full p-1.5 transition-colors ${
              looping ? "bg-white/15 text-white" : "text-white/60 hover:bg-white/10 hover:text-white"
            }`}
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
              onClick={prevShot}
              className="rounded-full p-1 text-white/55 transition-colors hover:bg-white/10 hover:text-white"
              aria-label={t("cameraEditor.prev", lang)}
            >
              {ArrowLeft}
            </button>
          )}

          {/* Camera dots */}
          {shots.length > 1 && (
            <div className="flex items-center gap-1 px-0.5">
              {shots.map((_, i) => (
                <button
                  key={i}
                  onClick={() => previewGoTo(i)}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === previewIdx ? "w-4 bg-white" : "w-1.5 bg-white/30 hover:bg-white/55"
                  }`}
                  aria-label={`${t("cameraEditor.camera", lang)} ${i + 1}`}
                />
              ))}
            </div>
          )}

          {/* Next arrow */}
          {shots.length > 1 && (
            <button
              onClick={nextShot}
              className="rounded-full p-1 text-white/55 transition-colors hover:bg-white/10 hover:text-white"
              aria-label={t("cameraEditor.next", lang)}
            >
              {ArrowRight}
            </button>
          )}

          {/* Divider */}
          <div className="h-4 w-px bg-white/15" />

          {/* Edit button */}
          <button
            onClick={stopPreview}
            className="rounded-full px-2.5 py-1 text-[11px] font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
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
      <div className="absolute inset-x-2 top-4 z-30 flex justify-end animate-fade-in sm:inset-x-auto sm:right-4">
        <div className="flex max-w-full items-center gap-1 rounded-full border border-white/[0.08] bg-black/70 px-1.5 py-1 text-white shadow-2xl backdrop-blur-2xl">
          {/* Prev arrow */}
          {shots.length > 1 && (
            <button
              onClick={prevShot}
              className="rounded-full p-1 text-white/55 transition-colors hover:bg-white/10 hover:text-white"
              aria-label={t("cameraEditor.prev", lang)}
            >
              {ArrowLeft}
            </button>
          )}

          {/* Camera dots */}
          {shots.length > 1 && (
            <div className="flex items-center gap-1 px-0.5">
              {shots.map((_, i) => (
                <button
                  key={i}
                  onClick={() => goToLocalShot(i)}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === selectedIdx ? "w-4 bg-white" : "w-1.5 bg-white/30 hover:bg-white/55"
                  }`}
                  aria-label={`${t("cameraEditor.camera", lang)} ${i + 1}`}
                />
              ))}
            </div>
          )}

          {/* Next arrow */}
          {shots.length > 1 && (
            <button
              onClick={nextShot}
              className="rounded-full p-1 text-white/55 transition-colors hover:bg-white/10 hover:text-white"
              aria-label={t("cameraEditor.next", lang)}
            >
              {ArrowRight}
            </button>
          )}

          {/* Divider */}
          <div className="h-4 w-px bg-white/15" />

          {/* Preview */}
          {shots.length > 0 && (
            <button
              onClick={startPreview}
              className="rounded-full p-1.5 text-white/55 transition-colors hover:bg-white/10 hover:text-white"
              title={t("cameraEditor.preview", lang)}
            >
              <PlayIcon className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Expand */}
          <button
            onClick={() => setIsCollapsed(false)}
            className="rounded-full p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
            aria-label={t("cameraEditor.expand", lang)}
          >
            <ChevronDownIcon className="h-3.5 w-3.5 rotate-180" />
          </button>

          <div className="hidden pl-0.5 pr-2 text-[11px] font-medium text-white/45 sm:block">
            {(selectedIdx ?? 0) + 1} / {shots.length}
          </div>
        </div>
      </div>
    );
  }

  // ── Edit mode expanded: full camera panel ───────────────────────────────
  return (
    <div className="absolute inset-x-2 top-14 z-30 animate-fade-in sm:inset-x-auto sm:right-4 sm:top-4 sm:w-[19.5rem]">
      <div className="max-h-[calc(100dvh-4.5rem)] overflow-hidden rounded-2xl border border-white/[0.08] bg-black/70 text-white shadow-2xl backdrop-blur-2xl">
        <div className="border-b border-white/[0.08] p-2.5">
          <div className="flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-[13px] font-semibold">{t("cameraEditor.title", lang)}</h3>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/50 tabular-nums">
                {shots.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {shots.length > 0 && (
                <button
                  type="button"
                  onClick={startPreview}
                  className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-white/55 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <PlayIcon className="h-3 w-3" />
                  {t("cameraEditor.preview", lang)}
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsCollapsed(true)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white"
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
              className="h-8 rounded-full border-white/[0.08] bg-white/10 px-3 text-[12px] text-white shadow-none hover:translate-y-0 hover:bg-white/15 hover:shadow-none"
              onClick={addShot}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              {t("cameraEditor.captureCurrentView", lang)}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-full border-white/[0.08] bg-white/10 px-3 text-[12px] text-white/65 shadow-none hover:bg-white/15 hover:text-white"
              onClick={handleSave}
              loading={saving}
              disabled={!shots.length}
            >
              {t("cameraEditor.saveCameras", lang)}
            </Button>
          </div>

          {shots.length === 0 ? (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-3">
              <p className="text-[12px] font-medium text-white/65">{t("cameraEditor.emptyTitle", lang)}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-white/40">{t("cameraEditor.emptyHint", lang)}</p>
            </div>
          ) : (
            <div className="max-h-[42dvh] space-y-1 overflow-y-auto pr-0.5 sm:max-h-[22rem]">
              {shots.map((shot, i) => (
                <div
                  key={i}
                  className={`grid grid-cols-[1fr_auto] items-center gap-1.5 rounded-xl border px-2 py-1.5 text-xs transition-colors duration-200 ${
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
                    className="flex min-w-0 items-center gap-2 rounded-lg py-1 text-left font-medium text-white/75 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-black/70"
                    title={t("cameraEditor.jumpToShot", lang)}
                  >
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/10 px-1.5 text-[10px] font-semibold text-white/55">
                      {i + 1}
                    </span>
                    <span className="truncate text-[12px]">{shot.label}</span>
                    {selectedIdx === i && (
                      <CheckIcon className="h-3.5 w-3.5 shrink-0 text-white/55" aria-label={t("cameraEditor.viewing", lang)} />
                    )}
                  </button>

                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => goToLocalShot(i)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                      aria-label={t("cameraEditor.jumpToShot", lang)}
                      title={t("cameraEditor.jumpToShot", lang)}
                    >
                      <EyeOpenIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => updateShot(i)}
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
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
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-white/35 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-25"
                      aria-label={`${t("cameraEditor.moveUp", lang)} ${i + 1}`}
                      title={t("cameraEditor.moveUp", lang)}
                    >
                      <ArrowUpIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveShot(i, 1)}
                      disabled={i === shots.length - 1}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-white/35 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-25"
                      aria-label={`${t("cameraEditor.moveDown", lang)} ${i + 1}`}
                      title={t("cameraEditor.moveDown", lang)}
                    >
                      <ArrowDownIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeShot(i)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-white/30 transition-colors hover:bg-red-500/15 hover:text-red-400"
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
            <p className={`px-1 text-[11px] ${message.startsWith(t("cameraEditor.messageSaveFailed", lang)) ? "text-red-400" : "text-white/55"}`}>
              {message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
