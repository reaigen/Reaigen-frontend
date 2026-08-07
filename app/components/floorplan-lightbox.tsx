"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { t } from "../lib/i18n";
import type { DraftDataEntry } from "../lib/tour-types";
import type { UnitLookup } from "../lib/unit-catalog";
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
}: {
  open: boolean;
  onClose: () => void;
  draftData: DraftDataEntry[];
  floorplanId?: number | null;
  lang: string;
  units?: readonly UnitLookup[];
  targetAreaUnit?: number | string | null;
}) {
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const returnFocusRef = React.useRef<HTMLElement | null>(null);

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
      className="fixed inset-0 z-[9999] flex flex-col overscroll-contain bg-surface text-foreground animate-fade-in"
    >
      <header className="grid h-20 shrink-0 grid-cols-[1fr_auto_1fr] items-center px-3 pt-safe sm:h-24 sm:px-8">
        <div className="flex min-w-0 justify-start">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="floating-capsule floating-control pen-touch-target gap-2 bg-card/95 px-3.5 text-foreground shadow-control hover:bg-foreground hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-4"
            aria-label={t("common.close", lang)}
          >
            <CloseIcon size={17} />
            <span className="hidden text-sm font-semibold sm:inline">{t("common.close", lang)}</span>
          </button>
        </div>
        <span className="text-sm font-semibold tracking-[-0.01em] text-foreground/70 sm:text-base">
          {t("draft.floorplan", lang)}
        </span>
        <span />
      </header>

      {/*
        "See the whole thing" means fit the screen, not fill the width. On a
        27" display, filling the width made the plan larger than the inline one
        it was opened from. The drawing is bounded by the space actually left
        under the header so the entire plan is on screen at once.
      */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8 scrollbar-thin">
        <div className="mx-auto w-full max-w-[min(100%,72rem)]">
          <FloorplanViewer
            draftData={draftData}
            floorplanId={floorplanId}
            lang={lang}
            units={units}
            targetAreaUnit={targetAreaUnit}
            planClassName="max-h-[calc(100dvh-16rem)]"
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
