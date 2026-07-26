"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  SpatialCameraMode,
  SpatialTrajectory,
  SpatialViewMode,
  SplatInspectionStats,
  Vec3,
} from "../lib/tour-types";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CameraIcon,
  CheckIcon,
  EyeOpenIcon,
  FloorplanIcon,
  FrameIcon,
  OrbitIcon,
  RotateIcon,
  TechnicalIcon,
  TourIcon,
} from "./icons";

interface Props {
  title: string;
  lang: string;
  viewMode: SpatialViewMode;
  onViewModeChange: (mode: SpatialViewMode) => void;
  stats: SplatInspectionStats | null;
  dataLoading: boolean;
  cageCount: number;
  showCage: boolean;
  onShowCageChange: (value: boolean) => void;
  trajectories: SpatialTrajectory[];
  onSelectTrajectory: (index: number) => void;
  showPath: boolean;
  onShowPathChange: (value: boolean) => void;
  selectedCamera: number;
  onSelectCamera: (index: number) => void;
  onLookThroughCamera: () => void;
  cameraPreviewActive: boolean;
  onExitCameraPreview: () => void;
  rotation: Vec3;
  onRotationChange: (rotation: Vec3) => void;
  transformDirty: boolean;
  transformSaving: boolean;
  transformError: string | null;
  onSaveTransform: () => void;
  cameraMode: SpatialCameraMode;
  onCameraModeChange: (mode: SpatialCameraMode) => void;
  onFrameScene: () => void;
  onClose: () => void;
}

function replaceTokens(value: string, tokens: Record<string, string | number>) {
  return Object.entries(tokens).reduce(
    (result, [key, token]) => result.replace(`{${key}}`, String(token)),
    value,
  );
}

function normalizedDegrees(value: number) {
  if (!Number.isFinite(value)) return 0;
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return Math.abs(normalized) < 0.005 ? 0 : Math.round(normalized);
}

function LayerSwitch({
  icon,
  label,
  detail,
  checked,
  disabled,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  detail: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="pen-touch-target flex min-h-12 w-full items-center gap-3 rounded-2xl px-2 text-left transition-colors hover:bg-foreground/[0.05] disabled:cursor-default disabled:opacity-45"
    >
      <span className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
        checked && !disabled ? "bg-foreground text-background" : "bg-foreground/[0.06] text-foreground/55",
      )}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-semibold text-foreground">{label}</span>
        <span className="block truncate text-[9px] text-muted-foreground">{detail}</span>
      </span>
      <span className={cn(
        "relative h-6 w-10 shrink-0 rounded-full transition-colors",
        checked && !disabled ? "bg-foreground" : "bg-foreground/10",
      )}>
        <span className={cn(
        "absolute top-1 h-4 w-4 rounded-full bg-background shadow-sm transition-transform",
          checked && !disabled ? "translate-x-5" : "translate-x-1",
        )} />
      </span>
    </button>
  );
}

function CameraTransport({
  lang,
  samples,
  selectedCamera,
  selectedTrajectory,
  rangeStart,
  rangeEnd,
  cameraPreviewActive,
  onSelectCamera,
  onLookThroughCamera,
  onExitCameraPreview,
  compact = false,
}: {
  lang: string;
  samples: SpatialTrajectory["samples"];
  selectedCamera: number;
  selectedTrajectory: SpatialTrajectory | null;
  rangeStart: number;
  rangeEnd: number;
  cameraPreviewActive: boolean;
  onSelectCamera: (index: number) => void;
  onLookThroughCamera: () => void;
  onExitCameraPreview: () => void;
  compact?: boolean;
}) {
  if (samples.length < 2) return null;

  const selectRelative = (direction: -1 | 1) => {
    const rangeLength = Math.max(1, rangeEnd - rangeStart + 1);
    const localIndex = selectedCamera - rangeStart;
    const next = rangeStart + ((localIndex + direction + rangeLength) % rangeLength);
    onSelectCamera(next);
  };
  const currentInTrajectory = selectedCamera - rangeStart + 1;
  const camerasInTrajectory = rangeEnd - rangeStart + 1;

  return (
    <div className={cn(
      "editor-glass-control border text-foreground",
      compact ? "rounded-[1.25rem] p-2" : "rounded-[1.5rem] p-1.5 pl-3",
    )}>
      <div className={cn(
        "flex items-center",
        compact ? "flex-wrap gap-1.5" : "gap-1.5",
      )}>
        <span className={cn("min-w-0", compact ? "mb-1 w-full px-1" : "w-36")}>
          <span className="block truncate text-[10px] font-semibold">
            {replaceTokens(t("spatialEditor.camera", lang), {
              current: currentInTrajectory,
              total: camerasInTrajectory,
            })}
          </span>
          <span className="block truncate text-[8px] text-muted-foreground">
            {selectedTrajectory?.label}
          </span>
        </span>
        <button
          type="button"
          onClick={() => selectRelative(-1)}
          className="pen-touch-target flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground/60 transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
          aria-label={t("cameraEditor.prev", lang)}
          title={`${t("cameraEditor.prev", lang)} · ←`}
        >
          <ArrowLeftIcon size={14} />
        </button>
        <button
          type="button"
          onClick={cameraPreviewActive ? onExitCameraPreview : onLookThroughCamera}
          className={cn(
            "pen-touch-target flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-3 text-[10px] font-semibold transition-colors",
            cameraPreviewActive
              ? "editor-control-capsule border text-foreground"
              : "bg-foreground text-background",
          )}
        >
          {cameraPreviewActive ? <OrbitIcon size={13} /> : <EyeOpenIcon size={13} />}
          <span className="truncate">
            {cameraPreviewActive
              ? t("spatialEditor.freeView", lang)
              : t("spatialEditor.lookThrough", lang)}
          </span>
        </button>
        <button
          type="button"
          onClick={() => selectRelative(1)}
          className="pen-touch-target flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground/60 transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
          aria-label={t("cameraEditor.next", lang)}
          title={`${t("cameraEditor.next", lang)} · →`}
        >
          <ArrowRightIcon size={14} />
        </button>
      </div>
      <label className={cn("block px-2", compact ? "mt-1" : "mt-0.5")}>
        <span className="sr-only">
          {replaceTokens(t("spatialEditor.camera", lang), {
            current: currentInTrajectory,
            total: camerasInTrajectory,
          })}
        </span>
        <input
          type="range"
          min={rangeStart}
          max={rangeEnd}
          step={1}
          value={selectedCamera}
          onChange={(event) => onSelectCamera(Number(event.target.value))}
          className={cn("w-full cursor-pointer accent-foreground", compact ? "h-9" : "h-7")}
        />
      </label>
    </div>
  );
}

export function AdvancedTourEditor({
  title,
  lang,
  viewMode,
  onViewModeChange,
  stats,
  dataLoading,
  cageCount,
  showCage,
  onShowCageChange,
  trajectories,
  onSelectTrajectory,
  showPath,
  onShowPathChange,
  selectedCamera,
  onSelectCamera,
  onLookThroughCamera,
  cameraPreviewActive,
  onExitCameraPreview,
  rotation,
  onRotationChange,
  transformDirty,
  transformSaving,
  transformError,
  onSaveTransform,
  cameraMode,
  onCameraModeChange,
  onFrameScene,
  onClose,
}: Props) {
  const [orientationOpen, setOrientationOpen] = useState(false);
  const [axis, setAxis] = useState<0 | 1 | 2>(1);
  const samples = useMemo(() => trajectories.flatMap((trajectory) => trajectory.samples), [trajectories]);
  const safeCamera = samples.length
    ? Math.max(0, Math.min(samples.length - 1, selectedCamera))
    : 0;
  const selectedCameraContext = useMemo(() => {
    let offset = 0;
    for (const [trajectoryIndex, trajectory] of trajectories.entries()) {
      if (safeCamera < offset + trajectory.samples.length) {
        return {
          trajectory,
          trajectoryIndex,
          start: offset,
          end: offset + trajectory.samples.length - 1,
        };
      }
      offset += trajectory.samples.length;
    }
    const trajectory = trajectories[0] ?? null;
    return trajectory
      ? { trajectory, trajectoryIndex: 0, start: 0, end: trajectory.samples.length - 1 }
      : null;
  }, [safeCamera, trajectories]);
  const selectedTrajectory = selectedCameraContext?.trajectory ?? null;
  const selectedTrajectoryIndex = selectedCameraContext?.trajectoryIndex ?? 0;
  const trajectoryStart = selectedCameraContext?.start ?? 0;
  const trajectoryEnd = selectedCameraContext?.end ?? Math.max(0, samples.length - 1);
  const pathLabel = selectedTrajectory?.source === "scan"
    ? t("spatialEditor.scanPath", lang)
    : selectedTrajectory?.source === "saved"
      ? t("spatialEditor.savedPath", lang)
      : t("spatialEditor.tourPath", lang);
  const hasCage = cageCount > 0;
  const hasPath = samples.length > 1;
  const hasRotation = rotation.some((value) => Math.abs(value) > 0.005);
  const updateAxis = (value: number) => {
    const next = [...rotation] as Vec3;
    next[axis] = normalizedDegrees(value);
    onRotationChange(next);
  };

  useEffect(() => {
    if (!cameraPreviewActive || samples.length < 2) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable
        || target?.tagName === "INPUT"
        || target?.tagName === "TEXTAREA"
        || target?.tagName === "SELECT"
      ) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const rangeLength = Math.max(1, trajectoryEnd - trajectoryStart + 1);
      const localIndex = safeCamera - trajectoryStart;
      onSelectCamera(
        trajectoryStart + ((localIndex + direction + rangeLength) % rangeLength),
      );
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    cameraPreviewActive,
    onSelectCamera,
    safeCamera,
    samples.length,
    trajectoryEnd,
    trajectoryStart,
  ]);

  useEffect(() => {
    if (transformError) setOrientationOpen(true);
  }, [transformError]);

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <header className="editor-glass-surface pointer-events-auto absolute inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top,0px))] mx-auto flex min-h-12 max-w-[34rem] items-center justify-between gap-3 rounded-full border px-2.5 py-1.5 text-foreground sm:inset-x-auto sm:left-1/2 sm:top-[calc(1rem+env(safe-area-inset-top,0px))] sm:w-[min(34rem,calc(100vw-9rem))] sm:-translate-x-1/2">
        <span className="flex min-w-0 items-center gap-2.5 pl-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
            <TechnicalIcon size={14} />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate text-[12px] font-semibold">{t("spatialEditor.title", lang)}</span>
              <span className="rounded-full bg-foreground/[0.07] px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-foreground/55">
                {t("spatialEditor.rnd", lang)}
              </span>
            </span>
            <span className="block truncate text-[10px] text-muted-foreground">{title}</span>
          </span>
        </span>
        <button
          type="button"
          onClick={onClose}
          disabled={transformSaving}
          className="pen-touch-target flex h-10 shrink-0 items-center gap-2 rounded-full bg-foreground px-3 text-[11px] font-semibold text-background transition-transform hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
        >
          <CheckIcon size={13} />
          {transformSaving ? t("spatialEditor.savingTransform", lang) : t("spatialEditor.done", lang)}
        </button>
      </header>

      <nav className="editor-glass-control pointer-events-auto absolute bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] left-3 flex items-center gap-1 rounded-full border p-1.5 text-foreground md:bottom-auto md:top-1/2 md:-translate-y-1/2 md:flex-col">
        <button
          type="button"
          aria-pressed={cameraMode === "orbit"}
          onClick={() => onCameraModeChange("orbit")}
          className={cn(
            "pen-touch-target flex h-11 w-11 items-center justify-center rounded-full transition-colors",
            cameraMode === "orbit" ? "bg-foreground text-background" : "text-foreground/55 hover:bg-foreground/[0.06]",
          )}
          title={t("spatialEditor.orbit", lang)}
        >
          <OrbitIcon size={16} />
        </button>
        <button
          type="button"
          aria-pressed={cameraMode === "fly"}
          onClick={() => onCameraModeChange("fly")}
          className={cn(
            "pen-touch-target flex h-11 w-11 items-center justify-center rounded-full transition-colors",
            cameraMode === "fly" ? "bg-foreground text-background" : "text-foreground/55 hover:bg-foreground/[0.06]",
          )}
          title={t("spatialEditor.fly", lang)}
        >
          <CameraIcon size={16} />
        </button>
        <span className="mx-1 h-6 w-px bg-foreground/10 md:mx-2 md:my-1 md:h-px md:w-7" aria-hidden="true" />
        <button
          type="button"
          onClick={onFrameScene}
          className="pen-touch-target flex h-11 w-11 items-center justify-center rounded-full text-foreground/55 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          title={`${t("spatialEditor.frame", lang)} · F`}
        >
          <FrameIcon size={16} />
        </button>
      </nav>

      <section className="editor-glass-surface pointer-events-auto absolute inset-x-2 bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] max-h-[58dvh] overflow-y-auto rounded-[1.5rem] border p-3 text-foreground sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-[calc(5.25rem+env(safe-area-inset-top,0px))] sm:w-[18rem] sm:max-h-[calc(100dvh-6.5rem)]">
        <div className="flex items-center justify-between gap-3 px-2 pb-2">
          <h2 className="text-[11px] font-semibold">{t("spatialEditor.layers", lang)}</h2>
          {stats ? (
            <span className="text-[9px] tabular-nums text-muted-foreground">
              {replaceTokens(t("spatialEditor.gaussians", lang), {
                count: new Intl.NumberFormat(lang, { notation: "compact", maximumFractionDigits: 1 }).format(stats.gaussianCount),
              })}
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-2 rounded-full bg-foreground/[0.06] p-1">
          {(["surface", "centers"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={viewMode === mode}
              onClick={() => onViewModeChange(mode)}
              className={cn(
                "pen-touch-target h-10 rounded-full text-[10px] font-semibold transition-colors",
                viewMode === mode
                  ? "editor-control-capsule border text-foreground"
                  : "text-foreground/50 hover:text-foreground",
              )}
            >
              {mode === "surface" ? t("spatialEditor.surface", lang) : t("spatialEditor.centers", lang)}
            </button>
          ))}
        </div>

        <div className="mt-2 border-t border-foreground/[0.07] pt-2">
          <LayerSwitch
            icon={<FloorplanIcon size={15} />}
            label={t("spatialEditor.structure", lang)}
            detail={dataLoading
              ? t("spatialEditor.loading", lang)
              : hasCage
              ? `${t("spatialEditor.available", lang)} · ${cageCount}`
              : t("spatialEditor.unavailable", lang)}
            checked={showCage && hasCage}
            disabled={!hasCage}
            onChange={onShowCageChange}
          />
          <LayerSwitch
            icon={<TourIcon size={15} />}
            label={t("spatialEditor.path", lang)}
            detail={dataLoading && !hasPath
              ? t("spatialEditor.loading", lang)
              : hasPath
                ? `${pathLabel} · ${samples.length}`
                : t("spatialEditor.unavailable", lang)}
            checked={showPath && hasPath}
            disabled={!hasPath}
            onChange={onShowPathChange}
          />
          {showPath && trajectories.length > 1 ? (
            <div className="mt-1 flex gap-1 overflow-x-auto px-1 pb-1">
              {trajectories.map((trajectory, index) => (
                <button
                  key={trajectory.id}
                  type="button"
                  aria-pressed={selectedTrajectoryIndex === index}
                  onClick={() => onSelectTrajectory(index)}
                  className={cn(
                    "pen-touch-target h-9 shrink-0 rounded-full px-3 text-[9px] font-semibold transition-colors",
                    selectedTrajectoryIndex === index
                      ? "bg-foreground text-background"
                      : "editor-control-capsule border text-foreground/60",
                  )}
                >
                  {trajectory.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {showPath && hasPath ? (
          <div className="mt-2 sm:hidden">
            <CameraTransport
              compact
              lang={lang}
              samples={samples}
              selectedCamera={safeCamera}
              selectedTrajectory={selectedTrajectory}
              rangeStart={trajectoryStart}
              rangeEnd={trajectoryEnd}
              cameraPreviewActive={cameraPreviewActive}
              onSelectCamera={onSelectCamera}
              onLookThroughCamera={onLookThroughCamera}
              onExitCameraPreview={onExitCameraPreview}
            />
          </div>
        ) : null}

        <div className="mt-2 border-t border-foreground/[0.07] pt-2">
          <button
            type="button"
            onClick={() => setOrientationOpen((open) => !open)}
            className="pen-touch-target flex min-h-12 w-full items-center gap-3 rounded-2xl px-2 text-left transition-colors hover:bg-foreground/[0.05]"
          >
            <span className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              hasRotation ? "bg-foreground text-background" : "bg-foreground/[0.06] text-foreground/55",
            )}>
              <RotateIcon size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-semibold">{t("spatialEditor.orientation", lang)}</span>
              <span className="block truncate text-[9px] tabular-nums text-muted-foreground">
                X {rotation[0]}° · Y {rotation[1]}° · Z {rotation[2]}°
              </span>
            </span>
            <span className={cn(
              "rounded-full px-2 py-1 text-[8px] font-semibold",
              transformDirty
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                : "bg-foreground/[0.06] text-foreground/50",
            )}>
              {transformSaving
                ? t("spatialEditor.savingTransform", lang)
                : transformDirty
                  ? t("spatialEditor.unsavedTransform", lang)
                  : t("spatialEditor.savedTransform", lang)}
            </span>
          </button>

          {orientationOpen ? (
            <div className="mt-2 rounded-2xl bg-muted/55 p-2">
              <div className="grid grid-cols-3 rounded-full bg-card/55 p-1">
                {(["X", "Y", "Z"] as const).map((axisLabel, index) => (
                  <button
                    key={axisLabel}
                    type="button"
                    aria-pressed={axis === index}
                    onClick={() => setAxis(index as 0 | 1 | 2)}
                    className={cn(
                      "pen-touch-target h-9 rounded-full text-[10px] font-semibold",
                      axis === index ? "bg-foreground text-background" : "text-foreground/50",
                    )}
                    aria-label={`${t("spatialEditor.axis", lang)} ${axisLabel}`}
                  >
                    {axisLabel}
                  </button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => updateAxis(rotation[axis] - 90)}
                  className="editor-control-capsule pen-touch-target h-10 rounded-full border px-3 text-[10px] font-semibold"
                >
                  −90°
                </button>
                <label className="editor-control-capsule flex h-10 min-w-0 items-center rounded-full border px-3">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={-180}
                    max={180}
                    step={1}
                    value={rotation[axis]}
                    onChange={(event) => updateAxis(Number(event.target.value))}
                    className="w-full min-w-0 bg-transparent text-center text-[11px] font-semibold tabular-nums outline-none"
                    aria-label={`${t("spatialEditor.axis", lang)} ${["X", "Y", "Z"][axis]}`}
                  />
                  <span className="text-[10px] text-muted-foreground">°</span>
                </label>
                <button
                  type="button"
                  onClick={() => updateAxis(rotation[axis] + 90)}
                  className="editor-control-capsule pen-touch-target h-10 rounded-full border px-3 text-[10px] font-semibold"
                >
                  +90°
                </button>
              </div>
              <button
                type="button"
                disabled={!hasRotation}
                onClick={() => onRotationChange([0, 0, 0])}
                className="pen-touch-target mt-1 h-9 w-full rounded-full text-[9px] font-semibold text-foreground/55 hover:bg-foreground/[0.06] disabled:opacity-30"
              >
                {t("spatialEditor.reset", lang)}
              </button>
              <button
                type="button"
                disabled={!transformDirty || transformSaving}
                onClick={onSaveTransform}
                className="pen-touch-target mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-full bg-foreground text-[10px] font-semibold text-background transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:cursor-default disabled:opacity-35"
              >
                <CheckIcon size={12} />
                {transformSaving
                  ? t("spatialEditor.savingTransform", lang)
                  : t("spatialEditor.saveTransform", lang)}
              </button>
              {transformError ? (
                <p role="alert" className="px-2 pt-2 text-[9px] leading-relaxed text-destructive">
                  {transformError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {showPath && hasPath ? (
        <div className="pointer-events-auto absolute bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] left-1/2 hidden w-[min(34rem,calc(100vw-9rem))] -translate-x-1/2 sm:block">
          <CameraTransport
            lang={lang}
            samples={samples}
            selectedCamera={safeCamera}
            selectedTrajectory={selectedTrajectory}
            rangeStart={trajectoryStart}
            rangeEnd={trajectoryEnd}
            cameraPreviewActive={cameraPreviewActive}
            onSelectCamera={onSelectCamera}
            onLookThroughCamera={onLookThroughCamera}
            onExitCameraPreview={onExitCameraPreview}
          />
        </div>
      ) : (
        <div className="editor-glass-control pointer-events-none absolute bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] left-1/2 hidden -translate-x-1/2 rounded-full border px-3 py-2 text-[9px] font-medium text-foreground/55 md:block">
          {t("spatialEditor.controls", lang)}
        </div>
      )}
    </div>
  );
}
