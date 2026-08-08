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
  disabled = false,
  onChange,
}: AdjustmentSliderProps) {
  const labelId = React.useId();
  const railRef = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{
    pointerId: number;
    anchorPx: number;
    anchorValue: number;
    lastValue: number;
    fine: boolean;
  } | null>(null);
  const [dragging, setDragging] = React.useState(false);

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
    // Holding shift is the escape hatch: without it the steps either side of the
    // detent are unreachable by dragging.
    if (!fine && showTick && width > 0 && Math.abs(raw - detent) * (width / span) <= DETENT_PX) {
      return detent;
    }
    return quantize(raw, min, max, step);
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
    const next = commit(valueAt(event.clientX), event.shiftKey);
    drag.current = {
      pointerId: event.pointerId,
      anchorPx: event.clientX,
      anchorValue: next,
      lastValue: next,
      fine: event.shiftKey,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    emit(next);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = drag.current;
    if (!session || session.pointerId !== event.pointerId) return;
    // Re-anchor when shift is toggled mid-drag so the knob never jumps.
    if (session.fine !== event.shiftKey) {
      session.fine = event.shiftKey;
      session.anchorPx = event.clientX;
      session.anchorValue = session.lastValue;
    }
    const rail = railRef.current;
    const width = rail?.getBoundingClientRect().width ?? 1;
    const travelled = ((event.clientX - session.anchorPx) / Math.max(width, 1)) * span;
    const scale = session.fine ? FINE_SCALE : 1;
    emit(commit(session.anchorValue + (travelled * scale), session.fine));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
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
    <div className={cn("select-none py-1", disabled && "opacity-45")}>
      <div className="flex items-baseline justify-between gap-3">
        <span id={labelId} className="text-[11px] font-medium text-foreground/70">
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
            "rounded-md px-1 py-0.5 text-[11px] font-medium tabular-nums transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isNeutral || disabled
              ? "text-muted-foreground"
              : "text-foreground hover:bg-foreground/[0.06]",
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
          "group relative flex h-6 touch-none items-center rounded-md outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring",
          disabled ? "cursor-not-allowed" : dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        style={{ paddingInline: THUMB_PX / 2 }}
      >
        <div
          ref={railRef}
          className={cn("relative h-1 w-full rounded-full", !trackGradient && "bg-foreground/[0.11]")}
          style={trackGradient ? { backgroundImage: trackGradient } : undefined}
        >
          {showTick ? (
            <span
              aria-hidden="true"
              className="absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/25"
              style={{ left: `${originFraction * 100}%` }}
            />
          ) : null}
          <span
            aria-hidden="true"
            className={cn(
              "absolute top-0 h-full rounded-full",
              trackGradient ? "bg-foreground/80" : "bg-foreground/55",
            )}
            style={{ left: `${fillLeft * 100}%`, width: `${fillWidth * 100}%` }}
          />
          <span
            aria-hidden="true"
            className={cn(
              "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-background shadow-control",
              "transition-[border-color,transform] duration-100 motion-reduce:transition-none",
              dragging
                ? "border-foreground scale-105"
                : "border-foreground/35 group-hover:border-foreground/60 group-focus-visible:border-foreground",
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
