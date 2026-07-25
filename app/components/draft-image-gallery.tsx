"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
import { ArrowLeftIcon, ArrowRightIcon, CloseIcon, EditIcon } from "./icons";
import { Thumbnail } from "./thumbnail";

export interface GalleryImage {
  id?: number;
  url: string;
  thumbnail_url?: string | null;
  name?: string;
}

interface DraftImageGalleryProps {
  images: GalleryImage[];
  alt: string;
  /** Tour thumbnail used only when the creation has no gallery photos. */
  fallbackUrl?: string | null;
  lang?: string;
  onActiveImageChange?: (imageId: number | null) => void;
  onManage?: () => void;
  manageLabel?: string;
}

function counterLabel(index: number, count: number, lang: string) {
  return `${index + 1} ${t("draft.imageOf", lang)} ${count}`;
}

function ExpandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 2.5H2.5V6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GalleryLightbox({
  images,
  alt,
  startIndex,
  lang,
  onClose,
  onIndexChange,
}: {
  images: GalleryImage[];
  alt: string;
  startIndex: number;
  lang: string;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const returnFocusRef = React.useRef<HTMLElement | null>(null);
  const [index, setIndex] = React.useState(startIndex);
  const count = images.length;

  const goTo = React.useCallback((next: number, behavior: ScrollBehavior = "smooth") => {
    const element = scrollRef.current;
    if (!element) return;
    const clamped = Math.max(0, Math.min(next, count - 1));
    element.scrollTo({ left: clamped * element.clientWidth, behavior });
    setIndex(clamped);
  }, [count]);

  React.useLayoutEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = scrollRef.current;
    if (element) element.scrollLeft = startIndex * element.clientWidth;
    setIndex(startIndex);
    const frame = requestAnimationFrame(() => {
      closeRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      returnFocusRef.current?.focus({ preventScroll: true });
    };
  }, [startIndex]);

  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const handleScroll = () => {
      if (!element.clientWidth) return;
      setIndex(Math.max(0, Math.min(Math.round(element.scrollLeft / element.clientWidth), count - 1)));
    };
    element.addEventListener("scroll", handleScroll, { passive: true });
    return () => element.removeEventListener("scroll", handleScroll);
  }, [count]);

  React.useEffect(() => onIndexChange(index), [index, onIndexChange]);

  React.useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, []);

  React.useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(index - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goTo(index + 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        goTo(0);
      } else if (event.key === "End") {
        event.preventDefault();
        goTo(count - 1);
      } else if (event.key === "Tab") {
        const controls = Array.from(
          rootRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [],
        );
        if (controls.length === 0) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [count, goTo, index, onClose]);

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-[9999] flex overscroll-contain bg-white text-black"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex h-[72px] items-center justify-between px-3 pt-safe sm:px-5">
        <span aria-live="polite" aria-atomic="true" className="rounded-full border border-black/[0.08] bg-white/90 px-3 py-1.5 text-[11px] font-semibold tabular-nums text-black/60 shadow-sm backdrop-blur-xl">
          {counterLabel(index, count, lang)}
        </span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="pointer-events-auto flex h-11 items-center gap-2 rounded-full border border-black/[0.08] bg-white/90 px-4 text-[12px] font-semibold text-black/70 shadow-sm backdrop-blur-xl transition-colors hover:bg-black hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/25"
          aria-label={t("common.close", lang)}
        >
          <CloseIcon size={17} />
          <span>{t("common.close", lang)}</span>
        </button>
      </div>

      {count > 1 ? (
        <>
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
            className="absolute left-2 top-1/2 z-30 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-black/[0.08] bg-white/90 text-black/65 shadow-sm backdrop-blur-xl transition-colors hover:bg-black hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/25 disabled:pointer-events-none disabled:opacity-40 sm:left-5"
            aria-label={t("draft.gallery.previous", lang)}
          >
            <ArrowLeftIcon size={18} />
          </button>
          <button
            type="button"
            onClick={() => goTo(index + 1)}
            disabled={index === count - 1}
            className="absolute right-2 top-1/2 z-30 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-black/[0.08] bg-white/90 text-black/65 shadow-sm backdrop-blur-xl transition-colors hover:bg-black hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/25 disabled:pointer-events-none disabled:opacity-40 sm:right-5"
            aria-label={t("draft.gallery.next", lang)}
          >
            <ArrowRightIcon size={18} />
          </button>
        </>
      ) : null}

      <div
        ref={scrollRef}
        className="flex h-full w-full touch-pan-x snap-x snap-mandatory overflow-x-auto scrollbar-none"
      >
        {images.map((image, imageIndex) => (
          <div
            key={`${image.id ?? image.url}-${imageIndex}`}
            className={cn(
              "flex h-full w-full flex-none snap-start items-center justify-center px-4 pt-[72px] sm:px-20",
              count > 1 ? "pb-24" : "pb-5",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.url}
              alt={image.name || `${alt} ${imageIndex + 1}`}
              className="max-h-full max-w-full select-none object-contain shadow-[0_12px_44px_rgba(0,0,0,0.08)]"
              draggable={false}
            />
          </div>
        ))}
      </div>

      {count > 1 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center px-3 pb-safe">
          <div className="pointer-events-auto flex max-w-full gap-2 overflow-x-auto rounded-2xl border border-black/[0.07] bg-white/90 p-2 shadow-[0_8px_28px_rgba(0,0,0,0.10)] backdrop-blur-2xl scrollbar-none">
            {images.map((image, imageIndex) => (
              <button
                key={`${image.id ?? image.url}-lightbox-thumb`}
                type="button"
                onClick={() => goTo(imageIndex)}
                className={cn(
                  "relative h-10 w-16 shrink-0 overflow-hidden rounded-lg border bg-black/[0.03] transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/25",
                  imageIndex === index ? "border-black/70 ring-1 ring-black/15" : "border-black/[0.07] opacity-55 hover:opacity-100",
                )}
                aria-label={counterLabel(imageIndex, count, lang)}
                aria-current={imageIndex === index ? "true" : undefined}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.thumbnail_url || image.url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

export function DraftImageGallery({ images, alt, fallbackUrl, lang = "en", onActiveImageChange, onManage, manageLabel }: DraftImageGalleryProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const displayImages = React.useMemo<GalleryImage[]>(
    () => images.length > 0 ? images : fallbackUrl ? [{ url: fallbackUrl, name: alt }] : [],
    [alt, fallbackUrl, images],
  );
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null);
  const count = displayImages.length;

  React.useEffect(() => {
    if (activeIndex < count) return;
    setActiveIndex(Math.max(0, count - 1));
  }, [activeIndex, count]);

  React.useEffect(() => {
    const source = images.length > 0 ? images[activeIndex] : undefined;
    onActiveImageChange?.(source?.id ?? null);
  }, [activeIndex, images, onActiveImageChange]);

  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const handleScroll = () => {
      if (!element.clientWidth) return;
      setActiveIndex(Math.max(0, Math.min(Math.round(element.scrollLeft / element.clientWidth), count - 1)));
    };
    element.addEventListener("scroll", handleScroll, { passive: true });
    return () => element.removeEventListener("scroll", handleScroll);
  }, [count]);

  const goTo = React.useCallback((next: number, behavior: ScrollBehavior = "auto") => {
    const element = scrollRef.current;
    if (!element) return;
    const clamped = Math.max(0, Math.min(next, count - 1));
    element.scrollTo({ left: clamped * element.clientWidth, behavior });
    setActiveIndex(clamped);
  }, [count]);

  const closeLightbox = React.useCallback(() => setLightboxIndex(null), []);
  const syncLightboxIndex = React.useCallback((next: number) => goTo(next, "auto"), [goTo]);

  if (count === 0) {
    return (
      <div className="detail-hero-gallery relative aspect-[16/10] w-full overflow-hidden bg-white ring-1 ring-inset ring-black/[0.045] md:aspect-video md:rounded-xl">
        <div className="flex h-full w-full items-center justify-center">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-black/10" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
            <path d="m21 15-5-5L5 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="detail-hero-gallery group relative aspect-[16/10] overflow-hidden bg-white ring-1 ring-inset ring-black/[0.045] md:aspect-video md:rounded-xl">
        <div ref={scrollRef} className="flex h-full w-full snap-x snap-mandatory overflow-x-auto scrollbar-none">
          {displayImages.map((image, imageIndex) => (
            <div
              key={`${image.id ?? image.url}-${imageIndex}`}
              className="relative h-full w-full flex-none snap-start bg-white"
            >
              <Thumbnail
                src={image.url}
                alt={image.name || `${alt} ${imageIndex + 1}`}
                className="absolute inset-0 h-full w-full object-cover"
                priority={imageIndex === 0}
              />
            </div>
          ))}
        </div>

        {onManage ? (
          <button
            type="button"
            onClick={onManage}
            className="absolute left-3 top-3 flex h-11 items-center gap-2 rounded-full border border-black/10 bg-white/90 px-3.5 text-[11px] font-semibold text-black/70 shadow-sm backdrop-blur-xl transition hover:bg-black hover:text-white hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/25 sm:h-9"
            aria-label={manageLabel}
          >
            <EditIcon size={15} />
            <span>{manageLabel}</span>
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setLightboxIndex(activeIndex)}
          className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-white/90 text-black/70 shadow-sm backdrop-blur-xl transition hover:bg-black hover:text-white hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/25 sm:h-9 sm:w-9"
          aria-label={t("draft.gallery.fullscreen", lang)}
        >
          <ExpandIcon />
        </button>

        {count > 1 ? (
          <>
            <button
              type="button"
              onClick={() => goTo(activeIndex - 1)}
              disabled={activeIndex === 0}
              className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-black/10 bg-white/90 text-black/70 shadow-sm backdrop-blur-xl transition hover:bg-black hover:text-white hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/25 disabled:pointer-events-none disabled:opacity-40"
              aria-label={t("draft.gallery.previous", lang)}
            >
              <ArrowLeftIcon size={18} />
            </button>
            <button
              type="button"
              onClick={() => goTo(activeIndex + 1)}
              disabled={activeIndex === count - 1}
              className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-black/10 bg-white/90 text-black/70 shadow-sm backdrop-blur-xl transition hover:bg-black hover:text-white hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/25 disabled:pointer-events-none disabled:opacity-40"
              aria-label={t("draft.gallery.next", lang)}
            >
              <ArrowRightIcon size={18} />
            </button>
          </>
        ) : null}

        {count > 1 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            {count <= 10 ? (
              <div className="pointer-events-auto flex items-center rounded-full border border-black/[0.07] bg-white/90 px-1 py-0.5 shadow-sm backdrop-blur-xl">
                {displayImages.map((image, imageIndex) => (
                  <button
                    key={`${image.id ?? image.url}-indicator`}
                    type="button"
                    onClick={() => goTo(imageIndex)}
                    className="group/dot rounded-full p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/25"
                    aria-label={counterLabel(imageIndex, count, lang)}
                    aria-current={imageIndex === activeIndex ? "true" : undefined}
                  >
                    <span
                      className={cn(
                        "block h-1.5 rounded-full transition-all duration-200",
                        imageIndex === activeIndex ? "w-4 bg-black/75" : "w-1.5 bg-black/25 group-hover/dot:bg-black/45",
                      )}
                    />
                  </button>
                ))}
              </div>
            ) : (
              <span className="rounded-full border border-black/[0.07] bg-white/90 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-black/65 shadow-sm backdrop-blur-xl">
                {counterLabel(activeIndex, count, lang)}
              </span>
            )}
          </div>
        ) : null}
      </div>

      {lightboxIndex !== null ? (
        <GalleryLightbox
          images={displayImages}
          alt={alt}
          startIndex={lightboxIndex}
          lang={lang}
          onClose={closeLightbox}
          onIndexChange={syncLightboxIndex}
        />
      ) : null}
    </>
  );
}
