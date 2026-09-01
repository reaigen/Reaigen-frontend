"use client";
/* eslint-disable @next/next/no-img-element -- owner media uses short-lived signed URLs */

import * as React from "react";
import type { ReaiImageEditOperations } from "../lib/api/client";
import { t, type LocaleKey } from "../lib/i18n";
import {
  analyzeImage,
  mediaProxyUrl,
  PREVIEW_MAX_EDGE,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../lib/ui/tabs";
import { cn } from "../lib/utils";
import { RotateIcon, SparklesIcon } from "./icons";

/**
 * Rails for the colour controls, so the track shows the direction it grades in.
 * Muted on purpose — these sit inside an otherwise monochrome panel.
 */
const TEMPERATURE_TRACK = "linear-gradient(90deg, #6ba3e8 0%, #d5d3cf 50%, #e8b75c 100%)";
const TINT_TRACK = "linear-gradient(90deg, #6fb583 0%, #d5d3cf 50%, #c079b4 100%)";
const HUE_TRACK = "linear-gradient(90deg, #c079b4 0%, #cf7d6a 25%, #d5d3cf 50%, #86b36e 75%, #5fae9e 100%)";

/** Below this the panel stacks, and the controls become a tabbed tray. */
const STACKED_QUERY = "(max-width: 819px)";
/** How long a still press on the photo takes to become a peek at the original. */
const PEEK_HOLD_MS = 260;
/** Travel that turns a press into a crop pan instead of a peek. */
const PEEK_SLOP_PX = 8;

type CropAspect = NonNullable<ReaiImageEditOperations["crop_aspect"]>;
type Rotation = NonNullable<ReaiImageEditOperations["rotation"]>;
type ControlTab = "light" | "colour" | "crop";

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

function prefersStackedLayout() {
  if (typeof window === "undefined") return false;
  return window.matchMedia(STACKED_QUERY).matches;
}

export function DraftImageEditor({
  upload,
  label,
  lang,
  busy,
  onSave,
}: {
  upload: DraftUpload;
  label: string;
  lang: string;
  busy: boolean;
  onSave: (operations: ReaiImageEditOperations) => void | Promise<void>;
}) {
  const [edit, setEdit] = React.useState<EditState>(DEFAULT_EDIT);
  const [showOriginal, setShowOriginal] = React.useState(false);
  const [naturalAspect, setNaturalAspect] = React.useState<number | null>(null);
  const [stage, setStage] = React.useState({ width: 0, height: 0 });
  const [stacked, setStacked] = React.useState(prefersStackedLayout);
  const [tab, setTab] = React.useState<ControlTab>("light");
  const stageRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [pipeline, setPipeline] = React.useState<{
    source: ImageData;
    target: ImageData;
    stats: ImageStatistics;
    width: number;
    height: number;
  } | null>(null);
  // Tracked apart from `pipeline` because null means two different things, and
  // the phone showed both the same way: two greyed-out automatic buttons with a
  // tooltip nobody can hover, whether the working copy was ten seconds from
  // arriving or was never coming.
  const [pipelineState, setPipelineState] = React.useState<"loading" | "ready" | "failed">("loading");
  // Only the hold gesture, never the segmented control: when the control is what
  // switched the view it already says so, and a second badge is just noise.
  const [peeking, setPeeking] = React.useState(false);
  /**
   * One gesture on the photo, resolved by what the finger does next: hold still
   * and it peeks at the original, move and it pans the crop. Two separate
   * handlers could not do this — the pan used to start on touch-down, so there
   * was no way to hold without nudging the framing first.
   */
  const gesture = React.useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    cropX: number;
    cropY: number;
    width: number;
    height: number;
    holdTimer: number;
    peeking: boolean;
    panning: boolean;
  } | null>(null);

  React.useEffect(() => {
    setEdit(DEFAULT_EDIT);
    setShowOriginal(false);
    setPeeking(false);
    setNaturalAspect(null);
    setTab("light");
  }, [upload.id]);

  React.useEffect(() => {
    const query = window.matchMedia(STACKED_QUERY);
    const sync = () => setStacked(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Pull the bytes same-origin so the canvas stays readable, then keep a pristine
  // working copy plus its statistics. Failure is not fatal: the <img> preview
  // below stays on CSS filters, it just cannot show the statistical controls.
  React.useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setPipeline(null);
    setPipelineState("loading");

    void (async () => {
      try {
        const response = await fetch(mediaProxyUrl(upload.id, PREVIEW_MAX_EDGE), {
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
        setPipelineState("ready");
      } catch {
        // Aborts and proxy failures both land here; the CSS-filter path remains.
        if (!cancelled) setPipelineState("failed");
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

  React.useEffect(() => () => {
    if (gesture.current?.holdTimer) window.clearTimeout(gesture.current.holdTimer);
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
  const canPan = !cropLocked && !showOriginal && !busy;

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

  const endGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = gesture.current;
    if (session?.pointerId !== event.pointerId) return;
    window.clearTimeout(session.holdTimer);
    if (session.peeking) {
      setPeeking(false);
      setShowOriginal(false);
    }
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const beginGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (busy || gesture.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    // Arming the peek is pointless when the original is already on screen — it
    // would restore to "edited" on release and quietly undo an explicit choice.
    const holdTimer = showOriginal ? 0 : window.setTimeout(() => {
      const session = gesture.current;
      if (!session || session.panning) return;
      session.peeking = true;
      setPeeking(true);
      setShowOriginal(true);
    }, PEEK_HOLD_MS);
    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cropX: edit.cropX,
      cropY: edit.cropY,
      width: bounds.width,
      height: bounds.height,
      holdTimer,
      peeking: false,
      panning: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const continueGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = gesture.current;
    if (!session || session.pointerId !== event.pointerId || session.peeking) return;
    const travelled = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
    if (!session.panning) {
      if (travelled <= PEEK_SLOP_PX) return;
      window.clearTimeout(session.holdTimer);
      if (!canPan) return;
      session.panning = true;
    }
    const cropX = clampOffset(session.cropX - ((event.clientX - session.startX) / Math.max(session.width, 1)) * 2);
    const cropY = clampOffset(session.cropY - ((event.clientY - session.startY) / Math.max(session.height, 1)) * 2);
    setEdit((current) => ({ ...current, cropX, cropY }));
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
        "h-11 rounded-full px-3 text-[12px] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        showOriginal === originalView
          ? "bg-foreground/[0.08] text-foreground"
          : "bg-transparent text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
      )}
    >
      {text}
    </button>
  );

  /**
   * A full-width row rather than a tile in a two-up grid. These labels are long
   * outside English — "Automatické vyváženie bielej" wrapped onto two lines in a
   * half-width cell, which left the icon floating against a two-line block and
   * the pair ragged, since only one of the two ever wrapped. Across the panel
   * both fit on one line in every locale, so they stay the same height and read
   * as the pair of actions they are.
   */
  const autoButton = (kind: "tone" | "balance", labelKey: LocaleKey, className?: string) => (
    <button
      type="button"
      onClick={() => applyAuto(kind)}
      disabled={busy || !pipeline}
      aria-busy={pipelineState === "loading" || undefined}
      className={cn(
        "flex h-11 w-full items-center gap-2 rounded-xl border px-3 text-left text-[13px] font-medium transition-colors",
        "border-border/70 bg-surface text-foreground/80",
        "hover:border-foreground/30 hover:bg-foreground/[0.035] hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:opacity-45",
        className,
      )}
    >
      {pipelineState === "loading" ? (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-foreground/15 border-t-foreground/55"
        />
      ) : (
        <SparklesIcon size={14} className="shrink-0 text-foreground/40" />
      )}
      <span className="min-w-0 truncate">{t(labelKey, lang)}</span>
    </button>
  );

  /**
   * The one place the panel explains itself, and only when something is missing:
   * without the working copy the automatic buttons cannot run at all and three of
   * the sliders grade nothing visible, which is worth a sentence.
   */
  const previewUnavailable = pipelineState === "failed" ? (
    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
      {t("draft.media.livePreviewUnavailable", lang)}
    </p>
  ) : null;

  const lightSliders = (
    <>
      <AdjustmentSlider label={t("reai.mediaOperation.exposure_ev", lang)} value={edit.exposure} min={-2} max={2} step={0.05} origin={0} displayValue={`${formatter.format(edit.exposure)} EV`} resetLabel={resetLabel} disabled={busy} onChange={(value) => setValue("exposure", value)} />
      <AdjustmentSlider label={t("reai.mediaOperation.brightness", lang)} value={edit.brightness} min={0.5} max={1.5} step={0.05} origin={1} displayValue={neutralFormatter.format(edit.brightness)} resetLabel={resetLabel} disabled={busy} onChange={(value) => setValue("brightness", value)} />
      <AdjustmentSlider label={t("reai.mediaOperation.contrast", lang)} value={edit.contrast} min={0.5} max={1.5} step={0.05} origin={1} displayValue={neutralFormatter.format(edit.contrast)} resetLabel={resetLabel} disabled={busy} onChange={(value) => setValue("contrast", value)} />
      <AdjustmentSlider label={t("reai.mediaOperation.sharpness", lang)} value={edit.sharpness} min={0.5} max={1.5} step={0.05} origin={1} displayValue={neutralFormatter.format(edit.sharpness)} resetLabel={resetLabel} disabled={busy} onChange={(value) => setValue("sharpness", value)} />
    </>
  );

  const colourSliders = (
    <>
      <AdjustmentSlider label={t("reai.mediaOperation.saturation", lang)} value={edit.saturation} min={0.5} max={1.5} step={0.05} origin={1} displayValue={neutralFormatter.format(edit.saturation)} resetLabel={resetLabel} disabled={busy} onChange={(value) => setValue("saturation", value)} />
      <AdjustmentSlider label={t("reai.mediaOperation.temperature", lang)} value={edit.temperature} min={-1} max={1} step={0.05} origin={0} trackGradient={TEMPERATURE_TRACK} displayValue={formatter.format(edit.temperature)} resetLabel={resetLabel} disabled={busy} onChange={(value) => setValue("temperature", value)} />
      <AdjustmentSlider label={t("reai.mediaOperation.tint", lang)} value={edit.tint} min={-1} max={1} step={0.05} origin={0} trackGradient={TINT_TRACK} displayValue={formatter.format(edit.tint)} resetLabel={resetLabel} disabled={busy} onChange={(value) => setValue("tint", value)} />
      <AdjustmentSlider label={t("reai.mediaOperation.hue_degrees", lang)} value={edit.hue} min={-45} max={45} step={1} origin={0} trackGradient={HUE_TRACK} displayValue={`${formatter.format(edit.hue)}°`} resetLabel={resetLabel} disabled={busy} onChange={(value) => setValue("hue", value)} />
    </>
  );

  const cropChips = (
    <div className="selection-capsule-track grid grid-cols-[1.25fr_repeat(4,minmax(0,1fr))]">
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
          className="selection-capsule-item pen-touch-target min-w-0 px-1.5 text-[12px] leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45"
        >
          {option.value === "original" ? t("draft.media.cropOriginal", lang) : option.value}
        </button>
      ))}
    </div>
  );

  const cropControls = (
    <>
      {cropChips}
      {/* Always mounted, disabled while the crop is unconstrained — mounting these
          on demand pushed everything below them down. */}
      <div className="mt-2">
        <AdjustmentSlider label={t("draft.media.cropX", lang)} value={edit.cropX} min={-1} max={1} step={0.02} origin={0} displayValue={formatter.format(edit.cropX)} resetLabel={resetLabel} disabled={busy || cropLocked} onChange={(value) => setValue("cropX", value)} />
        <AdjustmentSlider label={t("draft.media.cropY", lang)} value={edit.cropY} min={-1} max={1} step={0.02} origin={0} displayValue={formatter.format(edit.cropY)} resetLabel={resetLabel} disabled={busy || cropLocked} onChange={(value) => setValue("cropY", value)} />
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => rotate(-1)} disabled={busy} className="min-h-11 w-full px-2 text-[11px]">
          <RotateIcon size={13} className="scale-x-[-1]" /> {t("draft.media.rotateLeft", lang)}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => rotate(1)} disabled={busy} className="min-h-11 w-full px-2 text-[11px]">
          <RotateIcon size={13} /> {t("draft.media.rotateRight", lang)}
        </Button>
      </div>
    </>
  );

  const sectionHeading = (text: string, trailing?: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3">
      <p className="text-[12px] font-semibold uppercase tracking-[0.11em] text-foreground/60">{text}</p>
      {trailing}
    </div>
  );

  const rotationReadout = (
    <span className="w-10 text-right text-[12px] tabular-nums text-foreground/60">
      {edit.rotation}°
    </span>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col min-[820px]:flex-row">
      {/* Stage. It takes whatever the tray leaves, rather than a fixed 46%: on a
          phone that share was a postage stamp, and it was measured against a
          viewport the browser chrome keeps changing. */}
      <section className="flex min-h-[7.5rem] min-w-0 flex-1 flex-col bg-foreground/[0.075] min-[820px]:h-auto">
        {/* Stacked, this whole row floats over the stage instead. It is 44px of
            chrome that a phone cannot spare, and the photo's name is already
            implied by the panel you tapped to get here. */}
        {stacked ? null : (
          <div className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-border/50 bg-card px-3">
            <p className="truncate text-[11px] font-medium text-muted-foreground" title={label}>
              {label}
            </p>
            <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-border/60 bg-surface-subtle p-0">
              {compareButton(true, t("reai.mediaOriginal", lang))}
              {compareButton(false, t("draft.media.editedPreview", lang))}
            </div>
          </div>
        )}

        <div className="relative min-h-0 flex-1">
          {stacked ? (
            <div className="floating-capsule absolute right-2 top-2 z-10 flex items-center gap-0.5 !bg-card/85 p-0 shadow-control backdrop-blur-xl">
              {compareButton(true, t("reai.mediaOriginal", lang))}
              {compareButton(false, t("draft.media.editedPreview", lang))}
            </div>
          ) : null}
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
                title={t("draft.media.holdToCompare", lang)}
                className={cn(
                  "relative touch-none select-none overflow-hidden rounded-lg bg-background shadow-soft",
                  "transition-[width,height] duration-150 motion-reduce:transition-none",
                  canPan && "cursor-move",
                )}
                style={{ width: frame.width, height: frame.height }}
                onPointerDown={beginGesture}
                onPointerMove={continueGesture}
                onPointerUp={endGesture}
                onPointerCancel={endGesture}
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
                {/* Only while the press is peeking: a permanent badge would be one
                    more thing sitting on top of the photograph. */}
                {peeking ? (
                  <span className="floating-capsule pointer-events-none absolute left-2 top-2 h-6 bg-card/90 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground/70">
                    {t("reai.mediaOriginal", lang)}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* One continuous rail: hairline-divided sections, its own scroll, pinned
          actions. Stacked it is capped rather than fixed, so a short tab hands
          its unused height back to the photo instead of padding itself out. */}
      <aside className="flex min-h-0 max-h-[60%] shrink-0 flex-col border-t border-border/55 bg-card min-[820px]:max-h-none min-[820px]:w-[19.5rem] min-[820px]:flex-none min-[820px]:border-l min-[820px]:border-t-0">
        {stacked ? (
          /* Three short panels beat one long scroll. Every grading control used
             to sit in a single well barely two sliders tall, so reaching hue or
             the crop chips meant scrolling blind with the photo out of view. */
          <Tabs
            value={tab}
            onValueChange={(next) => setTab(next as ControlTab)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabsList className="selection-capsule-track mx-3 mt-2.5 grid shrink-0 grid-cols-3">
              <TabsTrigger value="light" className="selection-capsule-item text-[12px]">{t("draft.media.tabLight", lang)}</TabsTrigger>
              <TabsTrigger value="colour" className="selection-capsule-item text-[12px]">{t("draft.media.tabColour", lang)}</TabsTrigger>
              <TabsTrigger value="crop" className="selection-capsule-item text-[12px]">{t("draft.media.tabCrop", lang)}</TabsTrigger>
            </TabsList>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 pb-2 scrollbar-thin">
              <TabsContent value="light" className="mt-2.5">
                {autoButton("tone", "reai.mediaOperation.auto_enhance", "w-full")}
                {previewUnavailable}
                <div className="mt-1.5">{lightSliders}</div>
              </TabsContent>
              <TabsContent value="colour" className="mt-2.5">
                {autoButton("balance", "reai.mediaOperation.auto_white_balance", "w-full")}
                {previewUnavailable}
                <div className="mt-1.5">{colourSliders}</div>
              </TabsContent>
              <TabsContent value="crop" className="mt-2.5">
                {/* Only once it means something. Beside a section heading a
                    permanent "0°" reads as a value; alone above the chips it
                    reads as an orphan. */}
                {edit.rotation === 0 ? null : (
                  <div className="mb-1.5 flex justify-end">{rotationReadout}</div>
                )}
                {cropControls}
              </TabsContent>
            </div>
          </Tabs>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin">
            <section className="border-b border-border/55 px-3.5 py-3">
              {sectionHeading(t("draft.media.adjustments", lang))}
              {/* Actions, not toggles. Auto now writes its result into the sliders
                  below, so you can see what it decided and adjust from there —
                  and what gets saved is exactly what the preview showed. */}
              <div className="mt-2.5 space-y-1.5">
                {autoButton("tone", "reai.mediaOperation.auto_enhance")}
                {autoButton("balance", "reai.mediaOperation.auto_white_balance")}
              </div>
              {previewUnavailable}
              <div className="mt-2">
                {lightSliders}
                {colourSliders}
              </div>
            </section>

            <section className="px-3.5 py-3">
              {sectionHeading(t("draft.media.cropAndRotate", lang), rotationReadout)}
              <div className="mt-2.5">{cropControls}</div>
            </section>
          </div>
        )}

        {/* `pb` carries the safe area itself: the panel's own bottom padding is
            stripped for this view, so on a gesture-bar phone the primary action
            sat underneath the home indicator. */}
        <div className="shrink-0 border-t border-border/55 bg-card px-3.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
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
          {/* The panel header is the single way back. Repeating Cancel here made
              the rail look like it had three competing footers. */}
        </div>
      </aside>
    </div>
  );
}
