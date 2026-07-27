"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  GlobalSceneTransform,
  SpatialTransformTool,
  SpatialViewMode,
  SplatInspectionStats,
  UniversalSceneDescription,
  Vec3,
} from "../lib/tour-types";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
import {
  CheckIcon,
  CloseIcon,
  EyeOpenIcon,
  FloorplanIcon,
  FrameIcon,
  GridIcon,
  MinusIcon,
  MoveIcon,
  OrbitIcon,
  PlusIcon,
  RotateIcon,
  ScaleIcon,
  TechnicalIcon,
  TourIcon,
} from "./icons";

interface Props {
  title: string;
  lang: string;
  sceneDescription?: UniversalSceneDescription | null;
  viewMode: SpatialViewMode;
  onViewModeChange: (mode: SpatialViewMode) => void;
  stats: SplatInspectionStats | null;
  dataLoading: boolean;
  cageCount: number;
  showCage: boolean;
  onShowCageChange: (value: boolean) => void;
  showGrid: boolean;
  onShowGridChange: (value: boolean) => void;
  transform: GlobalSceneTransform;
  onTransformChange: (transform: GlobalSceneTransform) => void;
  transformTool: SpatialTransformTool;
  onTransformToolChange: (tool: SpatialTransformTool) => void;
  transformDirty: boolean;
  transformSaving: boolean;
  transformError: string | null;
  onApplyTransform: () => void;
  onFrameScene: () => void;
  onClose: () => void;
}

type AxisIndex = 0 | 1 | 2;

function normalizedDegrees(value: number) {
  if (!Number.isFinite(value)) return 0;
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return Math.abs(normalized) < 0.005 ? 0 : Math.round(normalized * 100) / 100;
}

function rounded(value: number, precision = 3) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** precision;
  const result = Math.round(value * factor) / factor;
  return Math.abs(result) < 1 / factor ? 0 : result;
}

function basename(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) || path;
}

function ModeButton({
  icon,
  label,
  shortcut,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  shortcut: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      aria-keyshortcuts={shortcut}
      title={`${label} · ${shortcut}`}
      onClick={onClick}
      className={cn(
        "floating-control group pen-touch-target relative gap-2 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-foreground text-background shadow-sm"
          : "text-foreground/55 hover:bg-foreground/[0.06] hover:text-foreground active:scale-95",
      )}
    >
      {icon}
      <span className={cn(active ? "inline" : "hidden")}>{label}</span>
      <span
        role="tooltip"
        className="floating-tooltip pointer-events-none absolute bottom-[calc(100%+0.65rem)] left-1/2 z-50 w-max -translate-x-1/2 translate-y-1 opacity-0 transition-[opacity,transform] group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100"
      >
        {label}
        <span className="ml-1.5 text-foreground/35">{shortcut}</span>
      </span>
    </button>
  );
}

function ViewportToolButton({
  icon,
  label,
  shortcut,
  active,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      aria-keyshortcuts={shortcut}
      title={shortcut ? `${label} · ${shortcut}` : label}
      onClick={onClick}
      className={cn(
        "floating-icon-button group pen-touch-target relative",
        active
          ? "bg-foreground text-background shadow-sm"
          : "text-foreground/48 hover:bg-foreground/[0.06] hover:text-foreground active:scale-95",
        disabled && "cursor-not-allowed opacity-30",
      )}
    >
      {icon}
      <span
        role="tooltip"
        className="floating-tooltip pointer-events-none absolute left-[calc(100%+0.7rem)] top-1/2 z-50 w-max -translate-y-1/2 translate-x-1 opacity-0 transition-[opacity,transform] group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
      >
        {label}
        {shortcut ? <span className="ml-1.5 text-foreground/35">{shortcut}</span> : null}
      </span>
    </button>
  );
}

function AxisValueField({
  axis,
  label,
  value,
  unit,
  step,
  selected,
  onSelect,
  onChange,
}: {
  axis?: "X" | "Y" | "Z";
  label: string;
  value: number;
  unit: string;
  step: number;
  selected: boolean;
  onSelect: () => void;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const inputFocused = useRef(false);
  const axisColor = axis === "X"
    ? "bg-[#ff3b30] text-white shadow-[0_2px_8px_rgba(255,59,48,0.28)]"
    : axis === "Y"
      ? "bg-[#30d158] text-[#06290f] shadow-[0_2px_8px_rgba(48,209,88,0.25)]"
      : "bg-[#0a84ff] text-white shadow-[0_2px_8px_rgba(10,132,255,0.28)]";

  useEffect(() => {
    if (!inputFocused.current) setDraft(String(value));
  }, [value]);

  const commitDraft = () => {
    const next = Number(draft);
    if (Number.isFinite(next)) {
      onChange(next);
      setDraft(String(next));
    } else {
      setDraft(String(value));
    }
  };

  return (
    <label
      className={cn(
        "flex min-h-[var(--floating-control-sm)] min-w-0 flex-1 cursor-text items-center justify-center gap-1.5 rounded-full px-2 transition-colors",
        selected
          ? "bg-foreground/[0.075] text-foreground"
          : "text-foreground/62 hover:bg-foreground/[0.035] hover:text-foreground",
      )}
      onPointerDown={onSelect}
    >
        {axis ? (
          <span className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold transition-colors",
            selected
              ? axisColor
              : "bg-foreground/[0.06] text-foreground/50",
          )}>
            {axis}
          </span>
        ) : null}
        <input
          type="number"
          inputMode="decimal"
          step={step}
          value={draft}
          aria-label={label}
          onFocus={(event) => {
            onSelect();
            inputFocused.current = true;
            event.currentTarget.select();
          }}
          onBlur={() => {
            inputFocused.current = false;
            commitDraft();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setDraft(String(value));
              event.currentTarget.blur();
            }
          }}
          onChange={(event) => {
            const nextDraft = event.target.value;
            setDraft(nextDraft);
            if (!["", "-", ".", "-."].includes(nextDraft)) {
              const next = Number(nextDraft);
              if (Number.isFinite(next)) onChange(next);
            }
          }}
          className="editor-number-input w-[3.5rem] min-w-0 bg-transparent text-right text-[13px] font-medium tabular-nums text-current outline-none"
        />
        <span className="text-[10px] font-medium text-foreground/38">{unit}</span>
    </label>
  );
}

export function AdvancedTourEditor({
  title,
  lang,
  sceneDescription,
  viewMode,
  onViewModeChange,
  stats,
  dataLoading,
  cageCount,
  showCage,
  onShowCageChange,
  showGrid,
  onShowGridChange,
  transform,
  onTransformChange,
  transformTool,
  onTransformToolChange,
  transformDirty,
  transformSaving,
  transformError,
  onApplyTransform,
  onFrameScene,
  onClose,
}: Props) {
  const [sceneOpen, setSceneOpen] = useState(false);
  const [precisionOpen, setPrecisionOpen] = useState(false);
  const [activeAxis, setActiveAxis] = useState<AxisIndex>(0);
  const hasCage = cageCount > 0;
  const stageRevision = sceneDescription?.stage?.revision;
  const usdValid = sceneDescription?.usdStage?.validation.valid;
  const gaussianPrim = useMemo(
    () => sceneDescription?.prims?.find((prim) => (
      prim.typeName.toLowerCase().includes("gaussian")
      || prim.path.toLowerCase().includes("gaussiansplat")
    )),
    [sceneDescription?.prims],
  );
  const gaussianPath = gaussianPrim?.path ?? "/Reaigen/World/GaussianSplat";
  const roomKitPath = sceneDescription?.geometry?.roomKit?.primPath
    ?? "/Reaigen/Architecture/RoomKit";

  const activeVector = transformTool === "move"
    ? transform.translation
    : transform.rotationDeg;
  const activeUnit = transformTool === "move" ? "m" : "°";
  const activeStep = transformTool === "move" ? 0.01 : 1;
  const activePrecisionValue = transformTool === "scale"
    ? transform.scale
    : activeVector[activeAxis];

  const updateAxis = (axis: AxisIndex, rawValue: number) => {
    if (!Number.isFinite(rawValue)) return;
    if (transformTool === "scale") {
      onTransformChange({
        ...transform,
        scale: Math.max(0.001, Math.min(1000, rounded(rawValue))),
      });
      return;
    }
    const key = transformTool === "move" ? "translation" : "rotationDeg";
    const next = [...transform[key]] as Vec3;
    next[axis] = key === "rotationDeg"
      ? normalizedDegrees(rawValue)
      : Math.max(-10000, Math.min(10000, rounded(rawValue)));
    onTransformChange({ ...transform, [key]: next });
  };

  const resetActive = () => {
    if (transformTool === "move") {
      onTransformChange({ ...transform, translation: [0, 0, 0] });
    } else if (transformTool === "rotate") {
      onTransformChange({ ...transform, rotationDeg: [0, 0, 0] });
    } else if (transformTool === "scale") {
      onTransformChange({ ...transform, scale: 1 });
    }
  };

  useEffect(() => {
    setActiveAxis(0);
    if (transformTool === "select") setPrecisionOpen(false);
  }, [transformTool]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "s") {
        event.preventDefault();
        if (transformDirty && !transformSaving) onApplyTransform();
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable
        || target?.tagName === "INPUT"
        || target?.tagName === "TEXTAREA"
        || target?.tagName === "SELECT"
      ) return;
      const toolByKey: Partial<Record<string, SpatialTransformTool>> = {
        q: "select",
        w: "move",
        e: "rotate",
        r: "scale",
      };
      if (toolByKey[key]) {
        event.preventDefault();
        onTransformToolChange(toolByKey[key]!);
      } else if (key === "g") {
        event.preventDefault();
        onShowGridChange(!showGrid);
      } else if (key === "f") {
        event.preventDefault();
        onFrameScene();
      } else if (key === "escape") {
        if (precisionOpen) {
          event.preventDefault();
          setPrecisionOpen(false);
        } else if (sceneOpen) {
          event.preventDefault();
          setSceneOpen(false);
        } else if (transformTool !== "select") {
          event.preventDefault();
          onTransformToolChange("select");
        } else if (!transformDirty) {
          event.preventDefault();
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    onFrameScene,
    onApplyTransform,
    onClose,
    onShowGridChange,
    onTransformToolChange,
    precisionOpen,
    sceneOpen,
    showGrid,
    transformDirty,
    transformSaving,
    transformTool,
  ]);

  return (
    <div className="pointer-events-none absolute inset-0 z-30 text-foreground">
      <header className="floating-panel floating-header pointer-events-auto absolute inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top,0px))] mx-auto flex max-w-[38rem] items-center justify-between gap-3 sm:inset-x-auto sm:left-1/2 sm:w-[min(38rem,calc(100vw-7rem))] sm:-translate-x-1/2">
        <span className="flex min-w-0 items-center gap-2.5 pl-1">
          <span className="floating-icon-button-sm bg-foreground text-background">
            <TechnicalIcon size={15} />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate text-[12px] font-semibold">{t("spatialEditor.title", lang)}</span>
              <span className="rounded-full bg-foreground/[0.07] px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-[0.1em] text-foreground/50">
                {t("spatialEditor.rnd", lang)}
              </span>
            </span>
            <span className="block truncate text-[9px] text-muted-foreground">{title}</span>
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-1.5">
          <span className={cn(
            "hidden items-center gap-1.5 px-1 text-[9px] font-semibold sm:flex",
            transformDirty ? "text-amber-700 dark:text-amber-300" : "text-foreground/42",
          )}>
            <span className={cn(
              "h-1.5 w-1.5 rounded-full",
              transformDirty ? "bg-amber-500" : "bg-emerald-500",
            )} />
            {transformSaving
              ? t("spatialEditor.savingTransform", lang)
              : transformDirty
                ? t("spatialEditor.unsavedTransform", lang)
                : t("spatialEditor.savedTransform", lang)}
          </span>
          {transformDirty ? (
            <button
              type="button"
              onClick={onApplyTransform}
              disabled={transformSaving}
              aria-keyshortcuts="Control+S Meta+S"
              title={t("spatialEditor.applyTransformHint", lang)}
              className="floating-control pen-touch-target gap-1.5 bg-foreground px-4 text-[10px] text-background shadow-sm hover:scale-[1.015] active:scale-[0.985] disabled:cursor-wait disabled:opacity-60"
            >
              <CheckIcon size={12} />
              <span>{transformSaving
                ? t("spatialEditor.savingTransform", lang)
                : t("spatialEditor.applyTransform", lang)}</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            disabled={transformSaving}
            title={transformDirty
              ? t("spatialEditor.discardPendingAndClose", lang)
              : t("common.close", lang)}
            className={cn(
              "pen-touch-target gap-1.5 text-[9px] hover:scale-[1.015] active:scale-[0.985] disabled:cursor-wait disabled:opacity-60",
              transformDirty
                ? "floating-icon-button bg-foreground/[0.065] text-foreground/62 hover:bg-foreground/[0.1] hover:text-foreground"
                : "floating-control bg-foreground px-4 text-background",
            )}
          >
            <CloseIcon size={11} />
            <span className={cn(transformDirty && "sr-only")}>{t("common.close", lang)}</span>
          </button>
        </span>
      </header>

      <div className="floating-toolbar pointer-events-auto absolute left-3 top-1/2 -translate-y-1/2 flex-col sm:left-4">
        <ViewportToolButton
          icon={<EyeOpenIcon size={15} />}
          label={viewMode === "surface"
            ? t("spatialEditor.centers", lang)
            : t("spatialEditor.surface", lang)}
          onClick={() => onViewModeChange(viewMode === "surface" ? "centers" : "surface")}
          active={viewMode === "centers"}
        />
        <ViewportToolButton
          icon={<FloorplanIcon size={15} />}
          label={t("spatialEditor.structure", lang)}
          disabled={!hasCage}
          onClick={() => onShowCageChange(!showCage)}
          active={showCage && hasCage}
        />
        <ViewportToolButton
          icon={<GridIcon size={15} />}
          label={t("spatialEditor.grid", lang)}
          shortcut="G"
          onClick={() => onShowGridChange(!showGrid)}
          active={showGrid}
        />
        <ViewportToolButton
          icon={<FrameIcon size={15} />}
          label={t("spatialEditor.frame", lang)}
          shortcut="F"
          onClick={onFrameScene}
        />
        <span className="mx-auto h-px w-7 bg-foreground/[0.09]" />
        <button
          type="button"
          aria-expanded={sceneOpen}
          aria-label={t("spatialEditor.usdStructure", lang)}
          onClick={() => setSceneOpen((open) => !open)}
          className={cn(
            "floating-icon-button pen-touch-target group relative",
            sceneOpen
              ? "bg-foreground text-background"
              : "text-foreground/55 hover:bg-foreground/[0.06] hover:text-foreground",
          )}
          title={t("spatialEditor.usdStructure", lang)}
        >
          <TourIcon size={15} />
          <span
            aria-hidden="true"
            className="floating-tooltip pointer-events-none absolute left-[calc(100%+0.65rem)] z-50 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            {t("spatialEditor.usdStructure", lang)}
          </span>
        </button>
      </div>

      {sceneOpen ? (
        <section className="floating-panel pointer-events-auto absolute left-[4.75rem] top-1/2 w-[min(18rem,calc(100vw-6rem))] -translate-y-1/2 p-3 animate-fade-in sm:left-[5.25rem]">
          <div className="flex items-center justify-between gap-3 px-1 pb-2">
            <span>
              <span className="block text-[11px] font-semibold">{t("spatialEditor.usdStructure", lang)}</span>
              <span className="block max-w-[13rem] truncate text-[8px] text-muted-foreground">
                {sceneDescription?.stage?.identifier ?? "scene.usda"}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              {usdValid ? <CheckIcon size={10} className="text-emerald-600" /> : null}
              {stageRevision != null ? (
                <span className="rounded-full bg-foreground/[0.06] px-2 py-1 text-[8px] font-semibold text-foreground/45">
                  r{stageRevision}
                </span>
              ) : null}
            </span>
          </div>
          <div className="rounded-[1rem] bg-foreground/[0.045] p-2">
            <div className="flex items-center gap-2 rounded-[0.8rem] bg-card/70 px-3 py-2.5">
              <TourIcon size={13} />
              <span className="text-[10px] font-semibold">Reaigen</span>
              <span className="ml-auto text-[8px] text-muted-foreground">Xform</span>
            </div>
            <div className="ml-5 border-l border-foreground/[0.1] pl-3">
              <div className="flex items-center gap-2 py-2.5">
                <EyeOpenIcon size={13} className="text-foreground/50" />
                <span className="min-w-0 flex-1 truncate text-[9px] font-semibold">{basename(gaussianPath)}</span>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </div>
              <div className={cn("flex items-center gap-2 py-2.5", !hasCage && "opacity-40")}>
                <FloorplanIcon size={13} className="text-foreground/50" />
                <span className="min-w-0 flex-1 truncate text-[9px] font-semibold">{basename(roomKitPath)}</span>
                <span className="text-[8px] text-muted-foreground">
                  {dataLoading ? "…" : hasCage ? cageCount : "—"}
                </span>
              </div>
            </div>
          </div>
          {stats ? (
            <div className="flex items-center justify-between px-1 pt-2 text-[8px] text-muted-foreground">
              <span>{t("spatialEditor.gaussiansLabel", lang)}</span>
              <span className="font-semibold tabular-nums">
                {new Intl.NumberFormat(lang, {
                  notation: "compact",
                  maximumFractionDigits: 1,
                }).format(stats.gaussianCount)}
              </span>
            </div>
          ) : null}
        </section>
      ) : null}

      {viewMode === "centers" ? (
        <section className="floating-toolbar pointer-events-auto absolute bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] right-4 hidden min-h-[var(--floating-control)] gap-2.5 px-3 animate-fade-in xl:flex">
          <span className="text-[9px] font-semibold text-foreground/72">
            {t("spatialEditor.pointDiagnostic", lang)}
          </span>
          <span
            aria-hidden="true"
            className="h-1.5 w-14 rounded-full bg-[linear-gradient(90deg,rgba(46,52,58,0.72)_0%,rgba(224,109,51,0.9)_100%)]"
          />
          <span className="text-[8px] text-muted-foreground">
            {t("spatialEditor.pointSupported", lang)}
            <span aria-hidden="true" className="px-1.5 text-foreground/25">→</span>
            {t("spatialEditor.pointWeak", lang)}
          </span>
          {stats?.largeOrSparsePercent != null ? (
            <span className="rounded-full bg-foreground/[0.06] px-2 py-1 text-[8px] font-semibold tabular-nums text-foreground/55">
              {new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(
                stats.largeOrSparsePercent,
              )}%
            </span>
          ) : null}
        </section>
      ) : null}

      <section className="floating-toolbar pointer-events-auto absolute bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] left-1/2 max-w-[calc(100vw-1.5rem)] -translate-x-1/2">
        {transformError ? (
          <p
            role="alert"
            className="floating-capsule absolute bottom-[calc(100%+0.5rem)] left-1/2 flex w-max max-w-[min(24rem,calc(100vw-1.5rem))] -translate-x-1/2 items-center px-4 text-[10px] font-medium text-destructive"
          >
            {transformError}
          </p>
        ) : null}

        {precisionOpen && transformTool !== "select" ? (
          <div className="floating-panel absolute bottom-[calc(100%+0.55rem)] left-1/2 w-[min(31rem,calc(100vw-1.5rem))] -translate-x-1/2 p-2 animate-fade-in-up">
            <div className="mb-1.5 flex items-center justify-between gap-3 px-2">
              <span className="text-[11px] font-semibold">
                {transformTool === "move"
                  ? t("spatialEditor.position", lang)
                  : transformTool === "rotate"
                    ? t("spatialEditor.rotation", lang)
                    : t("spatialEditor.scale", lang)}
              </span>
              <button
                type="button"
                onClick={resetActive}
                className="floating-control-sm text-[9px] text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground"
              >
                {t("spatialEditor.reset", lang)}
              </button>
            </div>

            <div className={cn(
              "flex items-center gap-1.5",
              transformTool === "scale" && "mx-auto max-w-[18rem]",
            )}>
              <div className="floating-capsule flex min-w-0 flex-1 items-center p-1">
                {transformTool === "scale" ? (
                  <AxisValueField
                    label={t("spatialEditor.scale", lang)}
                    value={transform.scale}
                    unit="×"
                    step={0.05}
                    selected
                    onSelect={() => setActiveAxis(0)}
                    onChange={(value) => updateAxis(0, value)}
                  />
                ) : (
                  (["X", "Y", "Z"] as const).map((axis, index) => (
                    <div key={axis} className="flex min-w-0 flex-1 items-center">
                      {index > 0 ? (
                        <span className="h-5 w-px shrink-0 bg-foreground/[0.07]" />
                      ) : null}
                      <AxisValueField
                        axis={axis}
                        label={`${transformTool === "move"
                          ? t("spatialEditor.position", lang)
                          : t("spatialEditor.rotation", lang)} ${axis}`}
                        value={activeVector[index]}
                        unit={activeUnit}
                        step={activeStep}
                        selected={activeAxis === index}
                        onSelect={() => setActiveAxis(index as AxisIndex)}
                        onChange={(value) => updateAxis(index as AxisIndex, value)}
                      />
                    </div>
                  ))
                )}
              </div>

              <div className="floating-capsule flex shrink-0 items-center p-1">
                <button
                  type="button"
                  className="floating-icon-button pen-touch-target text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground active:bg-foreground active:text-background"
                  onClick={() => updateAxis(
                    transformTool === "scale" ? 0 : activeAxis,
                    activePrecisionValue - (transformTool === "scale" ? 0.05 : activeStep),
                  )}
                  aria-label={t("common.decrease", lang)}
                >
                  <MinusIcon size={12} />
                </button>
                <span className="h-5 w-px bg-foreground/[0.07]" />
                <button
                  type="button"
                  className="floating-icon-button pen-touch-target text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground active:bg-foreground active:text-background"
                  onClick={() => updateAxis(
                    transformTool === "scale" ? 0 : activeAxis,
                    activePrecisionValue + (transformTool === "scale" ? 0.05 : activeStep),
                  )}
                  aria-label={t("common.increase", lang)}
                >
                  <PlusIcon size={12} />
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <nav className="scrollbar-hide flex max-w-full items-center justify-center gap-1 overflow-x-auto rounded-full bg-foreground/[0.045] p-1">
          <ModeButton
            icon={<OrbitIcon size={15} />}
            label={t("spatialEditor.freeView", lang)}
            shortcut="Q"
            active={transformTool === "select"}
            onClick={() => onTransformToolChange("select")}
          />
          <ModeButton
            icon={<MoveIcon size={15} />}
            label={t("spatialEditor.moveTool", lang)}
            shortcut="W"
            active={transformTool === "move"}
            onClick={() => onTransformToolChange("move")}
          />
          <ModeButton
            icon={<RotateIcon size={15} />}
            label={t("spatialEditor.rotateTool", lang)}
            shortcut="E"
            active={transformTool === "rotate"}
            onClick={() => onTransformToolChange("rotate")}
          />
          <ModeButton
            icon={<ScaleIcon size={15} />}
            label={t("spatialEditor.scale", lang)}
            shortcut="R"
            active={transformTool === "scale"}
            onClick={() => onTransformToolChange("scale")}
          />
          {transformTool !== "select" ? (
            <>
              <span className="mx-0.5 h-7 w-px shrink-0 bg-foreground/[0.09]" />
              <button
                type="button"
                aria-expanded={precisionOpen}
                title={t("spatialEditor.precision", lang)}
                onClick={() => setPrecisionOpen((open) => !open)}
                className={cn(
                  "floating-capsule floating-control pen-touch-target gap-2 text-[10px]",
                  precisionOpen && "bg-foreground text-background",
                )}
              >
                <TechnicalIcon size={14} />
                <span className="hidden sm:inline">{t("spatialEditor.precision", lang)}</span>
              </button>
            </>
          ) : null}
        </nav>
      </section>
    </div>
  );
}
