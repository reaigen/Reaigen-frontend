"use client";
/* eslint-disable @next/next/no-img-element -- owner media uses short-lived signed URLs */

import * as React from "react";
import type { ReaiImageEditOperations } from "../lib/api/client";
import { t } from "../lib/i18n";
import {
  analyzeImage,
  mediaProxyUrl,
  previewSize,
  proposeTone,
  proposeWhiteBalance,
  renderPreview,
  type ImageStatistics,
  type PreviewOperations,
} from "../lib/image-preview";
import type { DraftUpload } from "../lib/tour-types";
import { AdjustmentSlider } from "../lib/ui/adjustment-slider";
import { Button } from "../lib/ui/button";
import { cn } from "../lib/utils";
import { RotateIcon, SparklesIcon } from "./icons";

/**
 * Rails for the colour controls, so the track shows the direction it grades in.
 * Muted on purpose — these sit inside an otherwise monochrome panel.
 */
const TEMPERATURE_TRACK = "linear-gradient(90deg, #6ba3e8 0%, #d5d3cf 50%, #e8b75c 100%)";
const TINT_TRACK = "linear-gradient(90deg, #6fb583 0%, #d5d3cf 50%, #c079b4 100%)";
const HUE_TRACK = "linear-gradient(90deg, #c079b4 0%, #cf7d6a 25%, #d5d3cf 50%, #86b36e 75%, #5fae9e 100%)";

type CropAspect = NonNullable<ReaiImageEditOperations["crop_aspect"]>;
type Rotation = NonNullable<ReaiImageEditOperations["rotation"]>;

interface EditState {
  exposure: number;
  brightness: number;
  contrast: number;
  saturation: number;
  sharpness: number;
  temperature: number;
  tint: number;
  hue: number;
  rotation: Rotation;
  cropAspect: CropAspect;
  cropX: number;
  cropY: number;
}

const DEFAULT_EDIT: EditState = {
  exposure: 0,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  sharpness: 1,
  temperature: 0,
  tint: 0,
  hue: 0,
  rotation: 0,
  cropAspect: "original",
  cropX: 0,
  cropY: 0,
};

const CROP_ASPECTS: Array<{ value: CropAspect; ratio: number | null }> = [
  { value: "original", ratio: null },
  { value: "1:1", ratio: 1 },
  { value: "4:3", ratio: 4 / 3 },
  { value: "3:2", ratio: 3 / 2 },
  { value: "16:9", ratio: 16 / 9 },
];

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function buildOperations(state: EditState): ReaiImageEditOperations {
  // Deliberately no `auto_enhance` / `auto_white_balance` flags: the automatic
  // buttons now write their result into the explicit controls, so what is sent is
  // exactly what the preview showed. Sending a flag instead would hand the
  // backend a second, different implementation to expand it with.
  const operations: ReaiImageEditOperations = {};
  if (state.exposure !== 0) operations.exposure_ev = round(state.exposure);
  if (state.brightness !== 1) operations.brightness = round(state.brightness);
  if (state.contrast !== 1) operations.contrast = round(state.contrast);
  if (state.saturation !== 1) operations.saturation = round(state.saturation);
  if (state.sharpness !== 1) operations.sharpness = round(state.sharpness);
  if (state.temperature !== 0) operations.temperature = round(state.temperature);
  if (state.tint !== 0) operations.tint = round(state.tint);
  if (state.hue !== 0) operations.hue_degrees = round(state.hue);
  if (state.rotation !== 0) operations.rotation = state.rotation;
  if (state.cropAspect !== "original") {
    operations.crop_aspect = state.cropAspect;
    operations.crop_x = round(state.cropX);
    operations.crop_y = round(state.cropY);
  }
  return operations;
}

function clampOffset(value: number) {
  return Math.max(-1, Math.min(1, value));
}

export function DraftImageEditor({
  upload,
  label,
  lang,
  busy,
  onCancel,
  onSave,
}: {
  upload: DraftUpload;
  label: string;
  lang: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (operations: ReaiImageEditOperations) => void | Promise<void>;
}) {
  const [edit, setEdit] = React.useState<EditState>(DEFAULT_EDIT);
  const [showOriginal, setShowOriginal] = React.useState(false);
  const [naturalAspect, setNaturalAspect] = React.useState<number | null>(null);
  const [stage, setStage] = React.useState({ width: 0, height: 0 });
  const stageRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [pipeline, setPipeline] = React.useState<{
    source: ImageData;
    target: ImageData;
    stats: ImageStatistics;
    width: number;
    height: number;
  } | null>(null);
  const cropDrag = React.useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    cropX: number;
    cropY: number;
    width: number;
    height: number;
  } | null>(null);

  React.useEffect(() => {
    setEdit(DEFAULT_EDIT);
    setShowOriginal(false);
    setNaturalAspect(null);
  }, [upload.id]);

  // Pull the bytes same-origin so the canvas stays readable, then keep a pristine
  // working copy plus its statistics. Failure is not fatal: the <img> preview
  // below stays on CSS filters, it just cannot show the statistical controls.
  React.useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setPipeline(null);

    void (async () => {
      try {
        const response = await fetch(mediaProxyUrl(upload.id), {
          signal: controller.signal,
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error(`media proxy ${response.status}`);
        const bitmap = await createImageBitmap(await response.blob());
        const sourceWidth = bitmap.width;
        const sourceHeight = bitmap.height;
        const { width, height } = previewSize(sourceWidth, sourceHeight);

        const scratch = document.createElement("canvas");
        scratch.width = width;
        scratch.height = height;
        const context = scratch.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("2d context unavailable");
        context.drawImage(bitmap, 0, 0, width, height);
        bitmap.close?.();
        if (cancelled) return;

        const source = context.getImageData(0, 0, width, height);
        setNaturalAspect(sourceWidth / sourceHeight);
        setPipeline({
          source,
          target: context.createImageData(width, height),
          stats: analyzeImage(source),
          width,
          height,
        });
      } catch {
        // Aborts and proxy failures both land here; the CSS-filter path remains.
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [upload.id]);

  // The frame is sized in JS from the measured stage. Pure-CSS `aspect-ratio`
  // contain needs whichever axis binds first, and getting it wrong is what made
  // the layout lurch when the crop or rotation changed.
  React.useLayoutEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setStage({ width: box.width, height: box.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const operations = React.useMemo(() => buildOperations(edit), [edit]);
  const hasChanges = Object.keys(operations).length > 0;
  const chosenAspect = CROP_ASPECTS.find((option) => option.value === edit.cropAspect)?.ratio;
  const rotatedNaturalAspect = naturalAspect === null
    ? null
    : (edit.rotation === 90 || edit.rotation === 270 ? 1 / naturalAspect : naturalAspect);
  const previewAspect = chosenAspect ?? rotatedNaturalAspect;
  const displayAspect = showOriginal ? naturalAspect : previewAspect;

  const frame = React.useMemo(() => {
    if (!displayAspect || stage.width <= 0 || stage.height <= 0) return null;
    const width = Math.min(stage.width, stage.height * displayAspect);
    return { width, height: width / displayAspect };
  }, [stage.width, stage.height, displayAspect]);

  const effectiveBrightness = Math.max(0.15, Math.min(4, (2 ** edit.exposure) * edit.brightness));
  const previewFilter = showOriginal
    ? "none"
    : [
        `brightness(${effectiveBrightness})`,
        `contrast(${edit.contrast})`,
        `saturate(${edit.saturation})`,
        `hue-rotate(${edit.hue}deg)`,
      ].join(" ");
  const formatter = React.useMemo(() => new Intl.NumberFormat(lang || "en", {
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }), [lang]);
  const neutralFormatter = React.useMemo(() => new Intl.NumberFormat(lang || "en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }), [lang]);
  const resetLabel = t("draft.media.resetEdits", lang);
  const cropLocked = edit.cropAspect === "original";

  // Deliberately keyed on the individual grading fields rather than `edit`:
  // panning a crop mutates `edit` on every pointermove, and re-grading the whole
  // working copy on each of those would stall the drag.
  const previewOperations = React.useMemo<PreviewOperations>(() => ({
    exposure: edit.exposure,
    brightness: edit.brightness,
    contrast: edit.contrast,
    saturation: edit.saturation,
    sharpness: edit.sharpness,
    temperature: edit.temperature,
    tint: edit.tint,
    hue: edit.hue,
  }), [
    edit.exposure, edit.brightness,
    edit.contrast, edit.saturation, edit.sharpness, edit.temperature,
    edit.tint, edit.hue,
  ]);

  React.useEffect(() => {
    if (!pipeline) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!context) return;
    const handle = requestAnimationFrame(() => {
      if (showOriginal) {
        context.putImageData(pipeline.source, 0, 0);
        return;
      }
      renderPreview(pipeline.source, pipeline.target, previewOperations, null);
      context.putImageData(pipeline.target, 0, 0);
    });
    return () => cancelAnimationFrame(handle);
  }, [pipeline, previewOperations, showOriginal]);

  const setValue = <K extends keyof EditState>(key: K, value: EditState[K]) => {
    setEdit((current) => ({ ...current, [key]: value }));
  };

  /**
   * Analyse the pristine working copy and move the relevant sliders to what the
   * estimator chose. Nothing is applied invisibly, and the values are ordinary
   * control values afterwards — resettable, adjustable, and saved verbatim.
   */
  const applyAuto = (kind: "tone" | "balance") => {
    if (!pipeline) return;
    setEdit((current) => (kind === "balance"
      ? { ...current, ...proposeWhiteBalance(pipeline.stats) }
      : { ...current, ...proposeTone(pipeline.stats) }));
  };

  const rotate = (direction: -1 | 1) => {
    setEdit((current) => ({
      ...current,
      rotation: ((current.rotation + (direction * 90) + 360) % 360) as Rotation,
    }));
  };

  const beginCropDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (cropLocked || busy || showOriginal) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    cropDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cropX: edit.cropX,
      cropY: edit.cropY,
      width: bounds.width,
      height: bounds.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const continueCropDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = cropDrag.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const cropX = clampOffset(session.cropX - ((event.clientX - session.startX) / Math.max(session.width, 1)) * 2);
    const cropY = clampOffset(session.cropY - ((event.clientY - session.startY) / Math.max(session.height, 1)) * 2);
    setEdit((current) => ({ ...current, cropX, cropY }));
  };

  const finishCropDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (cropDrag.current?.pointerId !== event.pointerId) return;
    cropDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  // Crop framing and rotation are geometry, so they apply the same way whether
  // the pixels come from the canvas or the CSS-filter fallback.
  const rotated = !showOriginal && (edit.rotation === 90 || edit.rotation === 270);
  const framingStyle: React.CSSProperties = {
    objectPosition: showOriginal
      ? "50% 50%"
      : `${50 + (edit.cropX * 50)}% ${50 + (edit.cropY * 50)}%`,
    width: rotated ? `${100 / Math.max(previewAspect ?? 1, 0.01)}%` : "100%",
    height: rotated ? `${(previewAspect ?? 1) * 100}%` : "100%",
    transform: `translate(-50%, -50%) rotate(${showOriginal ? 0 : edit.rotation}deg)`,
  };

  // Only used by the fallback <img>: once the canvas is live it carries the real
  // grade, and layering a CSS filter on top would apply everything twice.
  const temperatureOpacity = pipeline || showOriginal ? 0 : Math.abs(edit.temperature) * 0.18;
  const tintOpacity = pipeline || showOriginal ? 0 : Math.abs(edit.tint) * 0.14;

  // A plain segmented control, not `floating-toolbar` + `floating-control-sm`:
  // that pairing is 50px tall inside a 44px header, so it hung past the header
  // onto the canvas and its drop shadow read as a detached palette.
  const compareButton = (originalView: boolean, text: string) => (
    <button
      type="button"
      onClick={() => setShowOriginal(originalView)}
      aria-pressed={showOriginal === originalView}
      className={cn(
        "h-7 rounded-full px-3 text-[11px] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        showOriginal === originalView
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {text}
    </button>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col min-[820px]:flex-row">
      {/* Stage. Fixed share of the box: the frame resizes inside it, nothing outside moves. */}
      <section className="flex h-[46%] min-h-0 min-w-0 shrink-0 flex-col bg-foreground/[0.075] min-[820px]:h-auto min-[820px]:flex-1">
        <div className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-border/50 bg-card/60 px-3">
          <p className="truncate text-[11px] font-medium text-muted-foreground" title={label}>
            {label}
          </p>
          <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-border/60 bg-background/70 p-0.5">
            {compareButton(true, t("reai.mediaOriginal", lang))}
            {compareButton(false, t("draft.media.editedPreview", lang))}
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          <div ref={stageRef} className="absolute inset-3 flex items-center justify-center sm:inset-4">
            {/* Learn the photo's real shape before drawing any frame. Seeding a 16/10
                guess and correcting it on load snapped the whole stage on every open,
                worst on portrait photos where the frame flipped wide → tall. */}
            {naturalAspect === null ? (
              <img
                src={upload.file_url}
                alt=""
                aria-hidden="true"
                className="pointer-events-none absolute h-px w-px opacity-0"
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (image.naturalWidth && image.naturalHeight) {
                    setNaturalAspect(image.naturalWidth / image.naturalHeight);
                  }
                }}
              />
            ) : null}
            {frame ? (
              <div
                className={cn(
                  "relative touch-none select-none overflow-hidden rounded-lg bg-background shadow-soft",
                  "transition-[width,height] duration-150 motion-reduce:transition-none",
                  !cropLocked && !showOriginal && "cursor-move",
                )}
                style={{ width: frame.width, height: frame.height }}
                onPointerDown={beginCropDrag}
                onPointerMove={continueCropDrag}
                onPointerUp={finishCropDrag}
                onPointerCancel={finishCropDrag}
              >
                {pipeline ? (
                  <canvas
                    ref={canvasRef}
                    width={pipeline.width}
                    height={pipeline.height}
                    aria-label={label}
                    role="img"
                    className={cn(
                      "absolute left-1/2 top-1/2 max-w-none transition-[object-position] duration-150 motion-reduce:transition-none",
                      cropLocked ? "object-contain" : "object-cover",
                    )}
                    style={framingStyle}
                  />
                ) : (
                  <img
                    src={upload.file_url}
                    alt={label}
                    draggable={false}
                    className={cn(
                      "absolute left-1/2 top-1/2 max-w-none transition-[filter,object-position] duration-150 motion-reduce:transition-none",
                      cropLocked ? "object-contain" : "object-cover",
                    )}
                    style={{ ...framingStyle, filter: previewFilter }}
                  />
                )}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 transition-opacity"
                  style={{
                    background: edit.temperature >= 0 ? "#ff9a4d" : "#4d8dff",
                    mixBlendMode: "soft-light",
                    opacity: temperatureOpacity,
                  }}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 transition-opacity"
                  style={{
                    background: edit.tint >= 0 ? "#d959b8" : "#46aa72",
                    mixBlendMode: "soft-light",
                    opacity: tintOpacity,
                  }}
                />
                {!cropLocked && !showOriginal ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 border border-white/50 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.18)]"
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* One continuous rail: hairline-divided sections, its own scroll, pinned actions. */}
      <aside className="flex min-h-0 flex-1 flex-col border-t border-border/55 bg-card min-[820px]:w-[19.5rem] min-[820px]:flex-none min-[820px]:border-l min-[820px]:border-t-0">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin">
          <section className="border-b border-border/55 px-3.5 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
              {t("draft.media.adjustments", lang)}
            </p>
            {/* Actions, not toggles. Auto now writes its result into the sliders
                below, so you can see what it decided and adjust from there —
                and what gets saved is exactly what the preview showed. */}
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              {([
                ["tone", "reai.mediaOperation.auto_enhance"],
                ["balance", "reai.mediaOperation.auto_white_balance"],
              ] as const).map(([kind, labelKey]) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => applyAuto(kind)}
                  disabled={busy || !pipeline}
                  title={pipeline ? undefined : t("draft.media.livePreview", lang)}
                  className={cn(
                    "min-h-11 rounded-xl border px-2.5 py-2 text-left text-[11px] font-medium transition-colors",
                    "border-border/70 bg-background/45 text-foreground/75",
                    "hover:border-foreground/35 hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    "disabled:opacity-45",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <SparklesIcon size={12} className="shrink-0" />
                    {t(labelKey, lang)}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-2">
              <AdjustmentSlider label={t("reai.mediaOperation.exposure_ev", lang)} value={edit.exposure} min={-2} max={2} step={0.05} origin={0} displayValue={`${formatter.format(edit.exposure)} EV`} resetLabel={resetLabel} disabled={busy} onChange={(value) => setValue("exposure", value)} />
              <AdjustmentSlider label={t("reai.mediaOperation.brightness", lang)} value={edit.brightness} min={0.5} max={1.5} step={0.05} origin={1} displayValue={neutralFormatter.format(edit.brightness)} resetLabel={resetLabel} disabled={busy} onChange={(value) => setValue("brightness", value)} />
              <AdjustmentSlider label={t("reai.mediaOperation.contrast", lang)} value={edit.contrast} min={0.5} max={1.5} step={0.05} origin={1} displayValue={neutralFormatter.format(edit.contrast)} resetLabel={resetLabel} disabled={busy} onChange={(value) => setValue("contrast", value)} />
              <AdjustmentSlider label={t("reai.mediaOperation.saturation", lang)} value={edit.saturation} min={0.5} max={1.5} step={0.05} origin={1} displayValue={neutralFormatter.format(edit.saturation)} resetLabel={resetLabel} disabled={busy} onChange={(value) => setValue("saturation", value)} />
              <AdjustmentSlider label={t("reai.mediaOperation.sharpness", lang)} value={edit.sharpness} min={0.5} max={1.5} step={0.05} origin={1} displayValue={neutralFormatter.format(edit.sharpness)} resetLabel={resetLabel} disabled={busy} onChange={(value) => setValue("sharpness", value)} />
              <AdjustmentSlider label={t("reai.mediaOperation.temperature", lang)} value={edit.temperature} min={-1} max={1} step={0.05} origin={0} trackGradient={TEMPERATURE_TRACK} displayValue={formatter.format(edit.temperature)} resetLabel={resetLabel} disabled={busy} onChange={(value) => setValue("temperature", value)} />
              <AdjustmentSlider label={t("reai.mediaOperation.tint", lang)} value={edit.tint} min={-1} max={1} step={0.05} origin={0} trackGradient={TINT_TRACK} displayValue={formatter.format(edit.tint)} resetLabel={resetLabel} disabled={busy} onChange={(value) => setValue("tint", value)} />
              <AdjustmentSlider label={t("reai.mediaOperation.hue_degrees", lang)} value={edit.hue} min={-45} max={45} step={1} origin={0} trackGradient={HUE_TRACK} displayValue={`${formatter.format(edit.hue)}°`} resetLabel={resetLabel} disabled={busy} onChange={(value) => setValue("hue", value)} />
            </div>
          </section>

          <section className="px-3.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
                {t("draft.media.cropAndRotate", lang)}
              </p>
              <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
                {edit.rotation}°
              </span>
            </div>
            <div className="mt-2.5 grid grid-cols-5 gap-1">
              {CROP_ASPECTS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setEdit((current) => ({
                    ...current,
                    cropAspect: option.value,
                    cropX: option.value === "original" ? 0 : current.cropX,
                    cropY: option.value === "original" ? 0 : current.cropY,
                  }))}
                  disabled={busy}
                  aria-pressed={edit.cropAspect === option.value}
                  className={cn(
                    "min-h-9 rounded-full border px-1.5 text-[11px] font-medium transition-colors disabled:opacity-45",
                    edit.cropAspect === option.value
                      ? "border-foreground bg-foreground text-background"
                      : "border-border/70 text-muted-foreground hover:border-foreground/35 hover:text-foreground",
                  )}
                >
                  {option.value === "original" ? t("draft.media.cropOriginal", lang) : option.value}
                </button>
              ))}
            </div>
            {/* Always mounted, disabled while the crop is unconstrained — mounting these
                on demand pushed everything below them down. */}
            <div className="mt-2">
              <AdjustmentSlider label={t("draft.media.cropX", lang)} value={edit.cropX} min={-1} max={1} step={0.02} origin={0} displayValue={formatter.format(edit.cropX)} resetLabel={resetLabel} disabled={busy || cropLocked} onChange={(value) => setValue("cropX", value)} />
              <AdjustmentSlider label={t("draft.media.cropY", lang)} value={edit.cropY} min={-1} max={1} step={0.02} origin={0} displayValue={formatter.format(edit.cropY)} resetLabel={resetLabel} disabled={busy || cropLocked} onChange={(value) => setValue("cropY", value)} />
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => rotate(-1)} disabled={busy} className="w-full px-2 text-[11px]">
                <RotateIcon size={13} className="scale-x-[-1]" /> {t("draft.media.rotateLeft", lang)}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => rotate(1)} disabled={busy} className="w-full px-2 text-[11px]">
                <RotateIcon size={13} /> {t("draft.media.rotateRight", lang)}
              </Button>
            </div>
          </section>
        </div>

        <div className="shrink-0 border-t border-border/55 bg-card px-3.5 py-3">
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => setEdit(DEFAULT_EDIT)} disabled={busy || !hasChanges} className="w-full">
              {resetLabel}
            </Button>
            <Button
              type="button"
              onClick={() => void onSave(operations)}
              disabled={busy || !hasChanges}
              loading={busy}
              title={hasChanges ? undefined : t("draft.media.noEdits", lang)}
              className="w-full px-3"
            >
              {t("draft.media.saveAsVersion", lang)}
            </Button>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy} className="mt-1.5 w-full">
            {t("common.cancel", lang)}
          </Button>
        </div>
      </aside>
    </div>
  );
}
