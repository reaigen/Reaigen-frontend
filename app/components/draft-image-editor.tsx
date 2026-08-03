"use client";
/* eslint-disable @next/next/no-img-element -- owner media uses short-lived signed URLs */

import * as React from "react";
import type { ReaiImageEditOperations } from "../lib/api/client";
import { t } from "../lib/i18n";
import type { DraftUpload } from "../lib/tour-types";
import { Button } from "../lib/ui/button";
import { cn } from "../lib/utils";
import { CheckIcon, RotateIcon } from "./icons";

type CropAspect = NonNullable<ReaiImageEditOperations["crop_aspect"]>;
type Rotation = NonNullable<ReaiImageEditOperations["rotation"]>;

interface EditState {
  autoEnhance: boolean;
  autoWhiteBalance: boolean;
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
  autoEnhance: false,
  autoWhiteBalance: false,
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
  const operations: ReaiImageEditOperations = {};
  if (state.autoEnhance) operations.auto_enhance = true;
  if (state.autoWhiteBalance) operations.auto_white_balance = true;
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

function EditorSlider({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block rounded-[calc(var(--floating-panel-radius)-0.45rem)] px-1.5 py-1.5 transition-colors focus-within:bg-foreground/[0.035]">
      <span className="mb-1.5 flex items-center justify-between gap-3 text-[10px]">
        <span className="font-medium text-foreground/70">{label}</span>
        <span className="min-w-10 text-right font-mono text-[9px] tabular-nums text-muted-foreground">{displayValue}</span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
        className="h-8 w-full cursor-pointer accent-foreground disabled:cursor-not-allowed disabled:opacity-45"
      />
    </label>
  );
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
  const [naturalAspect, setNaturalAspect] = React.useState(16 / 10);
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
  }, [upload.id]);

  const operations = React.useMemo(() => buildOperations(edit), [edit]);
  const hasChanges = Object.keys(operations).length > 0;
  const chosenAspect = CROP_ASPECTS.find((option) => option.value === edit.cropAspect)?.ratio;
  const rotatedNaturalAspect = edit.rotation === 90 || edit.rotation === 270
    ? 1 / naturalAspect
    : naturalAspect;
  const previewAspect = chosenAspect ?? rotatedNaturalAspect;
  const displayAspect = showOriginal ? naturalAspect : previewAspect;
  const effectiveBrightness = Math.max(0.15, Math.min(4, (2 ** edit.exposure) * edit.brightness));
  const previewFilter = showOriginal
    ? "none"
    : [
        `brightness(${effectiveBrightness})`,
        `contrast(${edit.contrast * (edit.autoEnhance ? 1.06 : 1)})`,
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

  const setValue = <K extends keyof EditState>(key: K, value: EditState[K]) => {
    setEdit((current) => ({ ...current, [key]: value }));
  };

  const rotate = (direction: -1 | 1) => {
    setEdit((current) => ({
      ...current,
      rotation: ((current.rotation + (direction * 90) + 360) % 360) as Rotation,
    }));
  };

  const beginCropDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (edit.cropAspect === "original" || busy || showOriginal) return;
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

  const temperatureOpacity = showOriginal ? 0 : Math.abs(edit.temperature) * 0.18;
  const tintOpacity = showOriginal ? 0 : Math.abs(edit.tint) * 0.14;

  return (
    <div className="grid items-start gap-4 min-[760px]:grid-cols-[minmax(0,1.25fr)_minmax(17rem,0.75fr)]">
      <section className="floating-panel-shape min-w-0 overflow-hidden border border-border/65 bg-card">
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border/55 px-3.5">
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold" title={label}>{label}</p>
            <p className="text-[9px] text-muted-foreground">{t("draft.media.livePreview", lang)}</p>
          </div>
          <div className="floating-toolbar grid shrink-0 grid-cols-2 p-1">
            <button
              type="button"
              onClick={() => setShowOriginal(true)}
              aria-pressed={showOriginal}
              className={cn(
                "floating-control-sm px-2.5 text-[9px] font-semibold",
                showOriginal ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t("reai.mediaOriginal", lang)}
            </button>
            <button
              type="button"
              onClick={() => setShowOriginal(false)}
              aria-pressed={!showOriginal}
              className={cn(
                "floating-control-sm px-2.5 text-[9px] font-semibold",
                !showOriginal ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t("draft.media.editedPreview", lang)}
            </button>
          </div>
        </div>

        <div className="flex min-h-[24rem] items-center justify-center bg-black/[0.035] p-3 sm:p-5">
          <div
            className={cn(
              "relative max-h-[68dvh] w-full max-w-3xl touch-none select-none overflow-hidden rounded-[calc(var(--floating-panel-radius)-0.35rem)] bg-black shadow-card",
              edit.cropAspect !== "original" && !showOriginal && "cursor-move",
            )}
            style={{ aspectRatio: displayAspect }}
            onPointerDown={beginCropDrag}
            onPointerMove={continueCropDrag}
            onPointerUp={finishCropDrag}
            onPointerCancel={finishCropDrag}
          >
            <img
              src={upload.file_url}
              alt={label}
              draggable={false}
              onLoad={(event) => {
                const image = event.currentTarget;
                if (image.naturalWidth && image.naturalHeight) {
                  setNaturalAspect(image.naturalWidth / image.naturalHeight);
                }
              }}
              className={cn(
                "absolute left-1/2 top-1/2 max-w-none transition-[filter,transform,object-position,width,height] duration-150 motion-reduce:transition-none",
                edit.cropAspect === "original" ? "object-contain" : "object-cover",
              )}
              style={{
                filter: previewFilter,
                objectPosition: showOriginal
                  ? "50% 50%"
                  : `${50 + (edit.cropX * 50)}% ${50 + (edit.cropY * 50)}%`,
                width: !showOriginal && (edit.rotation === 90 || edit.rotation === 270)
                  ? `${100 / Math.max(previewAspect, 0.01)}%`
                  : "100%",
                height: !showOriginal && (edit.rotation === 90 || edit.rotation === 270)
                  ? `${previewAspect * 100}%`
                  : "100%",
                transform: `translate(-50%, -50%) rotate(${showOriginal ? 0 : edit.rotation}deg)`,
              }}
            />
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
            {edit.cropAspect !== "original" && !showOriginal ? (
              <span className="pointer-events-none absolute inset-0 border border-white/50 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.18)]" aria-hidden="true" />
            ) : null}
          </div>
        </div>
        <p className="border-t border-border/55 px-4 py-3 text-[10px] leading-relaxed text-muted-foreground">
          {t("draft.media.editorPreviewHint", lang)}
        </p>
      </section>

      <aside className="space-y-3">
        <section className="floating-panel-shape border border-border/65 bg-card p-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
            {t("draft.media.adjustments", lang)}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {([
              ["autoEnhance", "reai.mediaOperation.auto_enhance"],
              ["autoWhiteBalance", "reai.mediaOperation.auto_white_balance"],
            ] as const).map(([key, labelKey]) => {
              const active = edit[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setValue(key, !active)}
                  disabled={busy}
                  aria-pressed={active}
                  className={cn(
                    "min-h-11 rounded-[calc(var(--floating-panel-radius)-0.45rem)] border px-2.5 py-2 text-left text-[9px] font-semibold transition-colors disabled:opacity-45",
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-border/70 bg-background/45 text-foreground/65 hover:border-foreground/35 hover:text-foreground",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <CheckIcon size={12} className={active ? "opacity-100" : "opacity-25"} />
                    {t(labelKey, lang)}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 space-y-0.5">
            <EditorSlider label={t("reai.mediaOperation.exposure_ev", lang)} value={edit.exposure} min={-2} max={2} step={0.05} displayValue={`${formatter.format(edit.exposure)} EV`} disabled={busy} onChange={(value) => setValue("exposure", value)} />
            <EditorSlider label={t("reai.mediaOperation.brightness", lang)} value={edit.brightness} min={0.5} max={1.5} step={0.05} displayValue={neutralFormatter.format(edit.brightness)} disabled={busy} onChange={(value) => setValue("brightness", value)} />
            <EditorSlider label={t("reai.mediaOperation.contrast", lang)} value={edit.contrast} min={0.5} max={1.5} step={0.05} displayValue={neutralFormatter.format(edit.contrast)} disabled={busy} onChange={(value) => setValue("contrast", value)} />
            <EditorSlider label={t("reai.mediaOperation.saturation", lang)} value={edit.saturation} min={0.5} max={1.5} step={0.05} displayValue={neutralFormatter.format(edit.saturation)} disabled={busy} onChange={(value) => setValue("saturation", value)} />
            <EditorSlider label={t("reai.mediaOperation.sharpness", lang)} value={edit.sharpness} min={0.5} max={1.5} step={0.05} displayValue={neutralFormatter.format(edit.sharpness)} disabled={busy} onChange={(value) => setValue("sharpness", value)} />
            <EditorSlider label={t("reai.mediaOperation.temperature", lang)} value={edit.temperature} min={-1} max={1} step={0.05} displayValue={formatter.format(edit.temperature)} disabled={busy} onChange={(value) => setValue("temperature", value)} />
            <EditorSlider label={t("reai.mediaOperation.tint", lang)} value={edit.tint} min={-1} max={1} step={0.05} displayValue={formatter.format(edit.tint)} disabled={busy} onChange={(value) => setValue("tint", value)} />
            <EditorSlider label={t("reai.mediaOperation.hue_degrees", lang)} value={edit.hue} min={-45} max={45} step={1} displayValue={`${formatter.format(edit.hue)}°`} disabled={busy} onChange={(value) => setValue("hue", value)} />
          </div>
        </section>

        <section className="floating-panel-shape border border-border/65 bg-card p-3.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
              {t("draft.media.cropAndRotate", lang)}
            </p>
            <span className="text-[9px] tabular-nums text-muted-foreground">{edit.rotation}°</span>
          </div>
          <div className="mt-3 grid grid-cols-5 gap-1">
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
                  "min-h-9 rounded-full border px-1.5 text-[9px] font-semibold transition-colors disabled:opacity-45",
                  edit.cropAspect === option.value
                    ? "border-foreground bg-foreground text-background"
                    : "border-border/70 text-muted-foreground hover:border-foreground/35 hover:text-foreground",
                )}
              >
                {option.value === "original" ? t("draft.media.cropOriginal", lang) : option.value}
              </button>
            ))}
          </div>
          {edit.cropAspect !== "original" ? (
            <div className="mt-2 space-y-0.5">
              <EditorSlider label={t("draft.media.cropX", lang)} value={edit.cropX} min={-1} max={1} step={0.02} displayValue={formatter.format(edit.cropX)} disabled={busy} onChange={(value) => setValue("cropX", value)} />
              <EditorSlider label={t("draft.media.cropY", lang)} value={edit.cropY} min={-1} max={1} step={0.02} displayValue={formatter.format(edit.cropY)} disabled={busy} onChange={(value) => setValue("cropY", value)} />
            </div>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => rotate(-1)} disabled={busy} className="w-full px-2 text-[9px]">
              <RotateIcon size={13} className="scale-x-[-1]" /> {t("draft.media.rotateLeft", lang)}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => rotate(1)} disabled={busy} className="w-full px-2 text-[9px]">
              <RotateIcon size={13} /> {t("draft.media.rotateRight", lang)}
            </Button>
          </div>
        </section>

        <section className="floating-panel-shape border border-border/65 bg-card p-3.5">
          <p className="text-[10px] leading-relaxed text-muted-foreground">{t("reai.mediaCreateHint", lang)}</p>
          {!hasChanges ? (
            <p role="status" className="mt-2 text-[10px] font-medium text-foreground/55">{t("draft.media.noEdits", lang)}</p>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => setEdit(DEFAULT_EDIT)} disabled={busy || !hasChanges} className="w-full">
              {t("draft.media.resetEdits", lang)}
            </Button>
            <Button type="button" onClick={() => void onSave(operations)} disabled={busy || !hasChanges} loading={busy} className="w-full px-3">
              {t("draft.media.saveAsVersion", lang)}
            </Button>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy} className="mt-2 w-full">
            {t("common.cancel", lang)}
          </Button>
        </section>
      </aside>
    </div>
  );
}
