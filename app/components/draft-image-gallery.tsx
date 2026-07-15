"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
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
}

function counterLabel(index: number, count: number, lang: string) {
  return `${index + 1} ${t("draft.imageOf", lang)} ${count}`;
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d={direction === "left" ? "m10 12-4-4 4-4" : "m6 4 4 4-4 4"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExpandIcon({ collapse = false }: { collapse?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {collapse ? (
        <path d="M6 2.5V6H2.5M10 2.5V6h3.5M13.5 10H10v3.5M2.5 10H6v3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M6 2.5H2.5V6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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
  const [index, setIndex] = React.useState(startIndex);
  const [nativeFullscreen, setNativeFullscreen] = React.useState(false);
  const count = images.length;

  const goTo = React.useCallback((next: number, behavior: ScrollBehavior = "smooth") => {
    const element = scrollRef.current;
    if (!element) return;
    const clamped = Math.max(0, Math.min(next, count - 1));
    element.scrollTo({ left: clamped * element.clientWidth, behavior });
    setIndex(clamped);
  }, [count]);

  React.useEffect(() => {
    const frame = requestAnimationFrame(() => {
      goTo(startIndex, "auto");
      closeRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [goTo, startIndex]);

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
    const root = rootRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (document.fullscreenElement === root) void document.exitFullscreen();
    };
  }, []);

  React.useEffect(() => {
    const handleFullscreen = () => setNativeFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", handleFullscreen);
    return () => document.removeEventListener("fullscreenchange", handleFullscreen);
  }, []);

  React.useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (document.fullscreenElement === rootRef.current) void document.exitFullscreen();
        else onClose();
      } else if (event.key === "ArrowLeft") goTo(index - 1);
      else if (event.key === "ArrowRight") goTo(index + 1);
      else if (event.key === "Home") goTo(0);
      else if (event.key === "End") goTo(count - 1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [count, goTo, index, onClose]);

  const toggleNativeFullscreen = async () => {
    if (document.fullscreenElement === rootRef.current) await document.exitFullscreen();
    else if (rootRef.current?.requestFullscreen) await rootRef.current.requestFullscreen();
  };

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-[120] flex bg-black text-white animate-fade-in"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex h-16 items-center justify-between bg-gradient-to-b from-black/75 to-transparent px-3 pt-safe sm:px-5">
        <span className="rounded-full bg-black/40 px-3 py-1 text-[11px] font-medium tabular-nums text-white/75 backdrop-blur-xl">
          {counterLabel(index, count, lang)}
        </span>
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void toggleNativeFullscreen()}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white/75 backdrop-blur-xl transition-colors hover:bg-white hover:text-black"
            aria-label={nativeFullscreen ? t("draft.gallery.exitFullscreen", lang) : t("draft.gallery.fullscreen", lang)}
          >
            <ExpandIcon collapse={nativeFullscreen} />
          </button>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white/75 backdrop-blur-xl transition-colors hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            aria-label={t("common.close", lang)}
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {count > 1 ? (
        <>
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
            className="absolute left-2 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white/80 backdrop-blur-xl transition disabled:pointer-events-none disabled:opacity-0 hover:bg-white hover:text-black sm:left-4"
            aria-label={t("draft.gallery.previous", lang)}
          >
            <Chevron direction="left" />
          </button>
          <button
            type="button"
            onClick={() => goTo(index + 1)}
            disabled={index === count - 1}
            className="absolute right-2 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white/80 backdrop-blur-xl transition disabled:pointer-events-none disabled:opacity-0 hover:bg-white hover:text-black sm:right-4"
            aria-label={t("draft.gallery.next", lang)}
          >
            <Chevron direction="right" />
          </button>
        </>
      ) : null}

      <div
        ref={scrollRef}
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto scrollbar-none"
      >
        {images.map((image, imageIndex) => (
          <div
            key={`${image.id ?? image.url}-${imageIndex}`}
            className="flex h-full w-full flex-none snap-start items-center justify-center px-3 pb-24 pt-16 sm:px-16 sm:pb-24"
            onClick={onClose}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.url}
              alt={image.name || `${alt} ${imageIndex + 1}`}
              className="max-h-full max-w-full select-none object-contain"
              draggable={false}
              onClick={(event) => event.stopPropagation()}
            />
          </div>
        ))}
      </div>

      {count > 1 ? (
        <div className="absolute inset-x-0 bottom-0 z-30 border-t border-white/10 bg-black/70 px-3 py-2 pb-safe backdrop-blur-2xl">
          <div className="mx-auto flex max-w-4xl gap-2 overflow-x-auto scrollbar-none">
            {images.map((image, imageIndex) => (
              <button
                key={`${image.id ?? image.url}-lightbox-thumb`}
                type="button"
                onClick={() => goTo(imageIndex)}
                className={cn(
                  "relative h-12 w-16 shrink-0 overflow-hidden rounded-lg border bg-white/5 transition",
                  imageIndex === index ? "border-white ring-1 ring-white/30" : "border-white/10 opacity-55 hover:opacity-100",
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

export function DraftImageGallery({ images, alt, fallbackUrl, lang = "en", onActiveImageChange }: DraftImageGalleryProps) {
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

  if (count === 0) {
    return (
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted/30 md:rounded-2xl">
        <div className="flex h-full w-full items-center justify-center">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-foreground/10" aria-hidden="true">
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
      <div className="group relative aspect-[16/10] overflow-hidden bg-white ring-1 ring-inset ring-black/[0.045] md:rounded-2xl">
        <div ref={scrollRef} className="flex h-full w-full snap-x snap-mandatory overflow-x-auto scrollbar-none">
          {displayImages.map((image, imageIndex) => (
            <button
              key={`${image.id ?? image.url}-${imageIndex}`}
              type="button"
              onClick={() => setLightboxIndex(imageIndex)}
              className="relative h-full w-full flex-none snap-start bg-white focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black/40"
              aria-label={`${t("draft.gallery.fullscreen", lang)} · ${counterLabel(imageIndex, count, lang)}`}
            >
              <Thumbnail
                src={image.url}
                alt={image.name || `${alt} ${imageIndex + 1}`}
                className="absolute inset-0 h-full w-full object-cover"
                priority={imageIndex === 0}
              />
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setLightboxIndex(activeIndex)}
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-white/90 text-black/70 shadow-sm backdrop-blur-xl transition hover:bg-white hover:text-black hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/25"
          aria-label={t("draft.gallery.fullscreen", lang)}
        >
          <ExpandIcon />
        </button>

        {count > 1 ? (
          <>
            <button
              type="button"
              onClick={() => goTo(activeIndex - 1, "smooth")}
              disabled={activeIndex === 0}
              className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-black/10 bg-white/90 text-black/70 shadow-sm backdrop-blur-xl transition hover:bg-white hover:text-black hover:shadow-md disabled:pointer-events-none disabled:scale-90 disabled:opacity-0"
              aria-label={t("draft.gallery.previous", lang)}
            >
              <Chevron direction="left" />
            </button>
            <button
              type="button"
              onClick={() => goTo(activeIndex + 1, "smooth")}
              disabled={activeIndex === count - 1}
              className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-black/10 bg-white/90 text-black/70 shadow-sm backdrop-blur-xl transition hover:bg-white hover:text-black hover:shadow-md disabled:pointer-events-none disabled:scale-90 disabled:opacity-0"
              aria-label={t("draft.gallery.next", lang)}
            >
              <Chevron direction="right" />
            </button>
          </>
        ) : null}

        {count > 1 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            {count <= 10 ? (
              <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-black/[0.07] bg-white/90 px-2.5 py-2 shadow-sm backdrop-blur-xl">
                {displayImages.map((image, imageIndex) => (
                  <button
                    key={`${image.id ?? image.url}-indicator`}
                    type="button"
                    onClick={() => goTo(imageIndex, "smooth")}
                    className={cn(
                      "h-1.5 rounded-full transition-all duration-200",
                      imageIndex === activeIndex ? "w-4 bg-black/75" : "w-1.5 bg-black/25 hover:bg-black/45",
                    )}
                    aria-label={counterLabel(imageIndex, count, lang)}
                    aria-current={imageIndex === activeIndex ? "true" : undefined}
                  />
                ))}
              </div>
            ) : (
              <span className="rounded-full border border-black/[0.07] bg-white/90 px-2.5 py-1 text-[10px] font-semibold tabular-nums text-black/65 shadow-sm backdrop-blur-xl">
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
          onClose={() => setLightboxIndex(null)}
          onIndexChange={(next) => goTo(next, "auto")}
        />
      ) : null}
    </>
  );
}
