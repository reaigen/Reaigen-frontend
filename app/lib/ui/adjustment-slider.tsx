"use client";

import * as React from "react";
import { cn } from "../utils";

/**
 * A Lightroom/Resolve-style adjustment control in the light monochrome palette.
 *
 * The native range input fills from its minimum, so a bipolar control (exposure,
 * temperature, tint…) draws a half-filled bar while it is still neutral. Here the
 * fill grows out of `origin` instead, so an untouched control reads as an empty
 * track with the knob parked at its detent.
 */

const THUMB_PX = 16;
/** Pointer distance under which a drag snaps onto the origin detent. */
const DETENT_PX = 7;
/** Sensitivity multiplier while shift is held. */
const FINE_SCALE = 0.2;

/**
 * Sensitivity by how far the pointer has strayed from the rail, coarsest first.
 *
 * Shift is the fine control on a desktop and there is no shift on a phone, where
 * it is needed most: exposure covers 80 steps, so on a ~230px rail one step is
 * under 3px and a fingertip cannot place a value. Dragging away from the rail is
 * the gesture iOS and Lightroom both use for this, and it costs a touch-only
 * control nothing — a mouse simply never leaves the first band.
 */
const VERTICAL_SCALES: Array<{ beyondPx: number; scale: number }> = [
  { beyondPx: 110, scale: 0.1 },
  { beyondPx: 55, scale: 0.3 },
  { beyondPx: 0, scale: 1 },
];

function scaleForDistance(distancePx: number) {
  return VERTICAL_SCALES.find((band) => distancePx > band.beyondPx)?.scale ?? 1;
}

/**
 * The control also has to sit on the dark glass of the tour overlays, where the
 * light palette disappears. Both sets keep the same geometry — hollow ring knob,
 * thin rail, fill out of the origin — so it reads as one control in either place.
 *
 * `onDark` deliberately spells its colours out rather than leaning on the
 * `.camera-editor-workspace` class remap in globals.css: that remap flattens
 * every `bg-white/*` step onto a single grey, which would sink the fill into the
 * rail. Callers that render on both pass the tone explicitly instead.
 */
const TONES = {
  default: {
    label: "text-foreground/70",
    readoutIdle: "text-muted-foreground",
    readoutActive: "text-foreground hover:bg-foreground/[0.06]",
    focus: "focus-visible:ring-ring",
    rail: "bg-foreground/[0.11]",
    tick: "bg-foreground/25",
    fill: "bg-foreground/55",
    fillOverGradient: "bg-foreground/80",
    knob: "bg-background border-foreground/35",
    knobHover: "group-hover:border-foreground/60 group-focus-visible:border-foreground",
    knobDragging: "border-foreground",
    fineRing: "ring-foreground/25",
  },
  onDark: {
    label: "text-white/60",
    readoutIdle: "text-white/45",
    readoutActive: "text-white hover:bg-white/[0.14]",
    focus: "focus-visible:ring-white/40",
    rail: "bg-white/20",
    tick: "bg-white/35",
    fill: "bg-white/70",
    fillOverGradient: "bg-white/90",
    knob: "bg-black/70 border-white/45",
    knobHover: "group-hover:border-white/75 group-focus-visible:border-white",
    knobDragging: "border-white",
    fineRing: "ring-white/30",
  },
} as const;

export type AdjustmentSliderTone = keyof typeof TONES;

function decimalsOf(step: number) {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

function quantize(value: number, min: number, max: number, step: number) {
  const stepped = Math.round((value - min) / step) * step + min;
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(decimalsOf(step)));
}

export interface AdjustmentSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Neutral value the fill grows from and the detent snaps to. Defaults to `min`. */
  origin?: number;
  /** Formatted read-out, also announced as `aria-valuetext`. */
  displayValue: string;
  /** Accessible name for the read-out's reset affordance, e.g. "Reset". */
  resetLabel: string;
  /** CSS gradient painted on the rail to show what the control does (colour controls only). */
  trackGradient?: string;
  /** Palette to render in. `onDark` is for the glass tour/camera overlays. */
  tone?: AdjustmentSliderTone;
  disabled?: boolean;
  onChange: (value: number) => void;
}

export function AdjustmentSlider({
  label,
  value,
  min,
  max,
  step,
  origin,
  displayValue,
  resetLabel,
  trackGradient,
  tone = "default",
  disabled = false,
  onChange,
}: AdjustmentSliderProps) {
  const palette = TONES[tone];
  const labelId = React.useId();
  const railRef = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{
    pointerId: number;
    anchorPx: number;
    anchorValue: number;
    lastValue: number;
    scale: number;
  } | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [fineDrag, setFineDrag] = React.useState(false);

  const detent = origin ?? min;
  const span = max - min || 1;
  const isNeutral = value === detent;
  const showTick = detent > min && detent < max;

  const fraction = (input: number) => (input - min) / span;
  const originFraction = fraction(detent);
  const valueFraction = fraction(value);
  const fillLeft = Math.min(originFraction, valueFraction);
  const fillWidth = Math.abs(valueFraction - originFraction);

  const commit = (raw: number, fine = false) => {
    const rail = railRef.current;
    const width = rail?.getBoundingClientRect().width ?? 0;
    // Snap in pointer space so the detent feels identical at any track width.
    // Fine mode is the escape hatch: without it the steps either side of the
    // detent are unreachable by dragging.
    if (!fine && showTick && width > 0 && Math.abs(raw - detent) * (width / span) <= DETENT_PX) {
      return detent;
    }
    return quantize(raw, min, max, step);
  };

  /**
   * Shift, or straying off the rail, either one. Whichever the person is using,
   * the value moves at the same reduced rate and the detent stops grabbing.
   */
  const scaleFor = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.shiftKey) return FINE_SCALE;
    const rail = railRef.current;
    if (!rail) return 1;
    const bounds = rail.getBoundingClientRect();
    const centre = bounds.top + (bounds.height / 2);
    return scaleForDistance(Math.abs(event.clientY - centre));
  };

  const valueAt = (clientX: number) => {
    const rail = railRef.current;
    if (!rail) return value;
    const bounds = rail.getBoundingClientRect();
    return min + ((clientX - bounds.left) / Math.max(bounds.width, 1)) * span;
  };

  const emit = (next: number) => {
    if (drag.current) drag.current.lastValue = next;
    if (next !== value) onChange(next);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    // Always coarse on the press itself: the press lands on the rail, so the
    // vertical distance is zero, and jumping to the tapped position is the point.
    const next = commit(valueAt(event.clientX), event.shiftKey);
    drag.current = {
      pointerId: event.pointerId,
      anchorPx: event.clientX,
      anchorValue: next,
      lastValue: next,
      scale: event.shiftKey ? FINE_SCALE : 1,
    };
    setDragging(true);
    setFineDrag(event.shiftKey);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    emit(next);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = drag.current;
    if (!session || session.pointerId !== event.pointerId) return;
    // Re-anchor whenever the sensitivity changes mid-drag — shift pressed, or the
    // finger crossing a band — so the knob carries on from where it already is
    // instead of teleporting to wherever the new rate puts the anchor.
    const scale = scaleFor(event);
    if (session.scale !== scale) {
      session.scale = scale;
      session.anchorPx = event.clientX;
      session.anchorValue = session.lastValue;
      setFineDrag(scale < 1);
    }
    const rail = railRef.current;
    const width = rail?.getBoundingClientRect().width ?? 1;
    const travelled = ((event.clientX - session.anchorPx) / Math.max(width, 1)) * span;
    emit(commit(session.anchorValue + (travelled * scale), scale < 1));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    setFineDrag(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const coarse = event.shiftKey ? 10 : 1;
    let next: number | null = null;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = quantize(value + (step * coarse), min, max, step);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = quantize(value - (step * coarse), min, max, step);
        break;
      case "PageUp":
        next = quantize(value + (step * 10), min, max, step);
        break;
      case "PageDown":
        next = quantize(value - (step * 10), min, max, step);
        break;
      case "Home":
        next = min;
        break;
      case "End":
        next = max;
        break;
      case "Backspace":
      case "Delete":
        next = detent;
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next !== null && next !== value) onChange(next);
  };

  return (
    <div className={cn("select-none py-0.5", disabled && "opacity-45")}>
      <div className="flex items-baseline justify-between gap-3">
        <span id={labelId} className={cn("text-[12px] font-medium", palette.label)}>
          {label}
        </span>
        {/* Always the same element and padding: swapping span/button here shifted
            the read-out sideways the moment a control left its detent. */}
        <button
          type="button"
          disabled={disabled || isNeutral}
          onClick={() => onChange(detent)}
          aria-label={isNeutral ? undefined : `${label} · ${resetLabel}`}
          className={cn(
            "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-1 py-0.5 text-[12px] font-medium tabular-nums transition-colors sm:min-h-9 sm:min-w-9",
            "focus-visible:outline-none focus-visible:ring-2",
            palette.focus,
            isNeutral || disabled ? palette.readoutIdle : palette.readoutActive,
          )}
        >
          {displayValue}
        </button>
      </div>

      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={labelId}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={displayValue}
        aria-disabled={disabled || undefined}
        aria-orientation="horizontal"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => { if (!disabled) onChange(detent); }}
        onKeyDown={onKeyDown}
        className={cn(
          // h-9, not the h-6 the rail needs to look right: the hit area is what a
          // fingertip has to find, and a 24px row inside a scrolling tray is a
          // coin toss between grabbing the control and scrolling past it. The
          // rail and knob keep their own sizes inside it.
          "group relative flex h-11 touch-none items-center rounded-md outline-none",
          "focus-visible:ring-2",
          palette.focus,
          disabled ? "cursor-not-allowed" : dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        style={{ paddingInline: THUMB_PX / 2 }}
      >
        <div
          ref={railRef}
          className={cn("relative h-1 w-full rounded-full", !trackGradient && palette.rail)}
          style={trackGradient ? { backgroundImage: trackGradient } : undefined}
        >
          {showTick ? (
            <span
              aria-hidden="true"
              className={cn("absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 rounded-full", palette.tick)}
              style={{ left: `${originFraction * 100}%` }}
            />
          ) : null}
          <span
            aria-hidden="true"
            className={cn(
              "absolute top-0 h-full rounded-full",
              trackGradient ? palette.fillOverGradient : palette.fill,
            )}
            style={{ left: `${fillLeft * 100}%`, width: `${fillWidth * 100}%` }}
          />
          {/* The knob rings while the drag is running fine, which is the only
              feedback that the value has stopped tracking the finger 1:1. */}
          <span
            aria-hidden="true"
            className={cn(
              "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border shadow-control",
              "transition-[border-color,transform,box-shadow] duration-100 motion-reduce:transition-none",
              palette.knob,
              dragging ? cn(palette.knobDragging, "scale-105") : palette.knobHover,
              fineDrag && cn("ring-2", palette.fineRing),
            )}
            style={{
              left: `${valueFraction * 100}%`,
              height: THUMB_PX,
              width: THUMB_PX,
            }}
          />
        </div>
      </div>
    </div>
  );
}
