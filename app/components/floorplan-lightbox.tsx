"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { t } from "../lib/i18n";
import type { DraftDataEntry } from "../lib/tour-types";
import type { UnitLookup } from "../lib/unit-catalog";
import type { ReaiViewerAction } from "../lib/reai-viewer-actions";
import FloorplanViewer from "./floorplan-viewer";
import { CloseIcon } from "./icons";

/**
 * Fullscreen floorplan, mirroring the photo lightbox: same surface, same close
 * capsule, same escape/focus/scroll-lock behaviour. Inline the plan is sized by
 * the column it sits in, which on a phone leaves the drawing too small to read
 * room by room.
 */
export function FloorplanLightbox({
  open,
  onClose,
  draftData,
  floorplanId,
  lang,
  units,
  targetAreaUnit,
  agentAction,
}: {
  open: boolean;
  onClose: () => void;
  draftData: DraftDataEntry[];
  floorplanId?: number | null;
  lang: string;
  units?: readonly UnitLookup[];
  targetAreaUnit?: number | string | null;
  agentAction?: ReaiViewerAction | null;
}) {
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const returnFocusRef = React.useRef<HTMLElement | null>(null);

  const MAX_SCALE = 4;
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const pointersRef = React.useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = React.useRef<{ distance: number; scale: number } | null>(null);
  // Refs hold the authoritative transform; state exists only to render it.
  // Deriving one from the other inside a setState updater would double-apply
  // under StrictMode, since updaters must stay free of side effects.
  const scaleRef = React.useRef(1);
  const offsetRef = React.useRef({ x: 0, y: 0 });
  const [scale, setScale] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const [gesturing, setGesturing] = React.useState(false);
  const [rotationDeg, setRotationDeg] = React.useState(0);
  const [measurementMode, setMeasurementMode] = React.useState<"distance" | "area" | null>(null);
  const [measurementSession, setMeasurementSession] = React.useState(0);

  const commit = React.useCallback((nextScale: number, nextOffset: { x: number; y: number }) => {
    scaleRef.current = nextScale;
    offsetRef.current = nextOffset;
    setScale(nextScale);
    setOffset(nextOffset);
  }, []);

  /** Keeps the drawing from being dragged off its own viewport. */
  const clampOffset = React.useCallback((next: { x: number; y: number }, atScale: number) => {
    const box = viewportRef.current?.getBoundingClientRect();
    if (!box) return next;
    const maxX = Math.max(0, (box.width * (atScale - 1)) / 2);
    const maxY = Math.max(0, (box.height * (atScale - 1)) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }, []);

  const applyScale = React.useCallback((nextScale: number, focal?: { x: number; y: number }) => {
    const clamped = Math.min(MAX_SCALE, Math.max(1, nextScale));
    const box = viewportRef.current?.getBoundingClientRect();
    const current = scaleRef.current;
    const currentOffset = offsetRef.current;

    if (clamped === 1) return commit(1, { x: 0, y: 0 });
    if (!box || !focal) return commit(clamped, clampOffset(currentOffset, clamped));

    // Hold the point between the fingers still while the scale changes.
    const fx = focal.x - (box.left + box.width / 2);
    const fy = focal.y - (box.top + box.height / 2);
    const ratio = clamped / current;
    commit(clamped, clampOffset(
      { x: fx - (fx - currentOffset.x) * ratio, y: fy - (fy - currentOffset.y) * ratio },
      clamped,
    ));
  }, [clampOffset, commit]);

  const resetZoom = React.useCallback(() => commit(1, { x: 0, y: 0 }), [commit]);

  const toggleZoom = React.useCallback((event: React.MouseEvent) => {
    if (scale > 1) resetZoom();
    else applyScale(2.5, { x: event.clientX, y: event.clientY });
  }, [applyScale, resetZoom, scale]);

  const onPointerDown = React.useCallback((event: React.PointerEvent) => {
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesturing(true);
  }, []);

  const onPointerMove = React.useCallback((event: React.PointerEvent) => {
    const points = pointersRef.current;
    if (!points.has(event.pointerId)) return;
    const previous = points.get(event.pointerId)!;
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const all = [...points.values()];

    if (all.length >= 2) {
      const [a, b] = all;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const start = pinchRef.current;
      if (!start) {
        pinchRef.current = { distance, scale: scaleRef.current };
        return;
      }
      if (start.distance > 0) {
        applyScale(start.scale * (distance / start.distance), {
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
        });
      }
      return;
    }

    // A single finger pans, but only once there is something to pan into.
    if (scaleRef.current > 1) {
      commit(scaleRef.current, clampOffset(
        {
          x: offsetRef.current.x + (event.clientX - previous.x),
          y: offsetRef.current.y + (event.clientY - previous.y),
        },
        scaleRef.current,
      ));
    }
  }, [applyScale, clampOffset, commit]);

  const endPointer = React.useCallback((event: React.PointerEvent) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) setGesturing(false);
  }, []);

  // A reopened plan should always start fitted, never mid-gesture from last time.
  React.useEffect(() => {
    if (open) return;
    pointersRef.current.clear();
    pinchRef.current = null;
    setGesturing(false);
    resetZoom();
  }, [open, resetZoom]);

  React.useEffect(() => {
    if (!open || agentAction?.surface !== "floorplan") return;
    const command = agentAction.command;
    if (command === "fit_floorplan" || command === "show_measurements") {
      resetZoom();
      setMeasurementMode(null);
      return;
    }
    if (command === "zoom_in") {
      applyScale(scaleRef.current * 1.5);
      return;
    }
    if (command === "zoom_out") {
      applyScale(scaleRef.current / 1.5);
      return;
    }
    if (command === "rotate_view_left" || command === "rotate_view_right") {
      setRotationDeg((current) => current + (command === "rotate_view_left" ? -90 : 90));
      return;
    }
    if (command === "orient_north" && typeof agentAction.parameters.north_offset_degrees === "number") {
      setRotationDeg(-agentAction.parameters.north_offset_degrees);
      return;
    }
    if (command === "start_distance_measurement" || command === "start_area_measurement") {
      setMeasurementMode(command === "start_distance_measurement" ? "distance" : "area");
      setMeasurementSession((current) => current + 1);
      resetZoom();
      return;
    }
    if (command !== "focus_room") return;
    const roomNumber = agentAction.parameters.room_number;
    if (!Number.isInteger(roomNumber)) return;
    resetZoom();
    const frame = window.requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      const badge = viewport?.querySelector<HTMLElement>(`[data-floorplan-room-number="${roomNumber}"]`);
      if (!viewport || !badge) return;
      const viewportRect = viewport.getBoundingClientRect();
      const badgeRect = badge.getBoundingClientRect();
      const desiredScale = 2.5;
      commit(desiredScale, clampOffset({
        x: (viewportRect.left + viewportRect.width / 2 - (badgeRect.left + badgeRect.width / 2)) * desiredScale,
        y: (viewportRect.top + viewportRect.height / 2 - (badgeRect.top + badgeRect.height / 2)) * desiredScale,
      }, desiredScale));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [agentAction, applyScale, clampOffset, commit, open, resetZoom]);

  React.useLayoutEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      returnFocusRef.current?.focus({ preventScroll: true });
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("draft.floorplan", lang)}
      className="fixed inset-0 z-[9999] flex items-center justify-center overscroll-contain bg-black/22 pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1rem,env(safe-area-inset-top))] text-foreground backdrop-blur-md animate-fade-in sm:pb-[max(2rem,env(safe-area-inset-bottom))] sm:pl-[max(2rem,env(safe-area-inset-left))] sm:pr-[max(2rem,env(safe-area-inset-right))] sm:pt-[max(2rem,env(safe-area-inset-top))] lg:pb-[max(3rem,env(safe-area-inset-bottom))] lg:pl-[max(3rem,env(safe-area-inset-left))] lg:pr-[max(3rem,env(safe-area-inset-right))] lg:pt-[max(3rem,env(safe-area-inset-top))]"
    >
      <div className="editor-glass-surface flex max-h-[calc(100dvh-2rem)] w-full max-w-[72rem] flex-col overflow-hidden rounded-[2rem] border border-white/70 shadow-[0_34px_100px_-34px_rgba(0,0,0,0.42)] sm:max-h-[calc(100dvh-4rem)] lg:max-h-[calc(100dvh-6rem)]">
      <header className="grid min-h-[4.5rem] shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-white/60 bg-card/72 px-5 backdrop-blur-2xl sm:px-7">
        <div className="min-w-0">
          <span className="block text-[16px] font-semibold tracking-[-0.015em] text-foreground">
            {t("draft.floorplan", lang)}
          </span>
          <span className="mt-0.5 block text-[11px] text-foreground/48">{t("draft.gallery.fullscreen", lang)}</span>
        </div>
        <div className="flex min-w-0 justify-end">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="glossy-capsule floating-icon-button pen-touch-target text-foreground/65 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label={t("common.close", lang)}
          >
            <CloseIcon size={17} />
          </button>
        </div>
      </header>

      {/*
        "See the whole thing" means fit the screen, not fill the width. The
        drawing is bounded by the space left under the header so the entire
        plan is on screen at once, and pinch takes it closer from there.

        The gesture is handled here rather than by the browser: page zoom is
        disabled app-wide, so without this a floorplan could be read only at
        the size it happened to render. Pinch scales about the point between
        your fingers, one finger pans once zoomed in, and double-tap toggles
        between fit and close-up — the same contract as a native photo viewer.
      */}
      <div
        ref={viewportRef}
        className="min-h-0 flex-1 touch-none overflow-auto bg-background/28 p-4 sm:p-7 lg:p-9"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onDoubleClick={toggleZoom}
      >
        <div
          className="mx-auto w-full max-w-[min(100%,52rem)] origin-center rounded-[1.6rem] bg-card/78 p-2 shadow-[0_18px_55px_-34px_rgba(0,0,0,0.34)] backdrop-blur-xl will-change-transform sm:p-3"
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) rotate(${rotationDeg}deg) scale(${scale})`,
            transition: gesturing ? "none" : "transform 200ms var(--motion-ease-smooth)",
          }}
        >
          <FloorplanViewer
            draftData={draftData}
            floorplanId={floorplanId}
            lang={lang}
            units={units}
            targetAreaUnit={targetAreaUnit}
            planClassName="max-h-[min(62dvh,38rem)]"
            measurementMode={measurementMode}
            measurementSession={measurementSession}
          />
        </div>
      </div>

      {measurementMode ? (
        <div className="floating-capsule pointer-events-none absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 px-4 text-[12px] font-semibold text-foreground shadow-control">
          {t(measurementMode === "distance" ? "floorplan.measureDistanceHint" : "floorplan.measureAreaHint", lang)}
        </div>
      ) : scale > 1 || rotationDeg !== 0 ? (
        <button
          type="button"
          onClick={() => {
            resetZoom();
            setRotationDeg(0);
          }}
          className="floating-capsule floating-control pointer-events-auto absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 px-4 text-[12px] font-semibold text-foreground shadow-control"
        >
          {t("floorplan.resetZoom", lang)}
        </button>
      ) : null}
      </div>
    </div>,
    document.body,
  );
}
