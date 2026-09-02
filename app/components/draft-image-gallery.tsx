"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { writeDragItem } from "../lib/agent-pool";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
import { ArrowLeftIcon, ArrowRightIcon, CloseIcon, EditIcon, GridIcon } from "./icons";
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
  /** Public shared pages expose the collage as a labelled phone action. */
  mobileOverviewLabel?: boolean;
}

function counterLabel(index: number, count: number, lang: string) {
  return `${index + 1} ${t("draft.imageOf", lang)} ${count}`;
}

function preferredScrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined") return "auto";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function preloadNeighbors(images: GalleryImage[], index: number, fullResolution = false) {
  if (typeof window === "undefined") return;
  [index - 1, index + 1].forEach((next) => {
    const candidate = images[next];
    const source = candidate
      ? (fullResolution ? candidate.url : (candidate.thumbnail_url || candidate.url))
      : null;
    if (!source) return;
    const image = new Image();
    image.decoding = "async";
    image.src = source;
  });
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
  startInOverview,
  lang,
  onClose,
  onIndexChange,
}: {
  images: GalleryImage[];
  alt: string;
  startIndex: number;
  startInOverview?: boolean;
  lang: string;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const returnFocusRef = React.useRef<HTMLElement | null>(null);
  const pendingPhotoIndexRef = React.useRef(startIndex);
  const [index, setIndex] = React.useState(startIndex);
  const count = images.length;
  // Any multi-photo set earns the collage overview; only a lone photo has
  // nothing to lay out. (The desktop hero mosaic keeps its own 5-tile gate.)
  const overviewAvailable = count >= 2;
  const [viewMode, setViewMode] = React.useState<"photo" | "overview">(
    startInOverview && overviewAvailable ? "overview" : "photo",
  );

  const goTo = React.useCallback((next: number, behavior: ScrollBehavior = preferredScrollBehavior()) => {
    const element = scrollRef.current;
    if (!element) return;
    const clamped = Math.max(0, Math.min(next, count - 1));
    pendingPhotoIndexRef.current = clamped;
    element.scrollTo({ left: clamped * element.clientWidth, behavior });
    setIndex(clamped);
  }, [count]);

  React.useLayoutEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = scrollRef.current;
    if (element) element.scrollLeft = startIndex * element.clientWidth;
    pendingPhotoIndexRef.current = startIndex;
    setIndex(startIndex);
    const frame = requestAnimationFrame(() => {
      closeRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      returnFocusRef.current?.focus({ preventScroll: true });
    };
  }, [startIndex]);

  React.useLayoutEffect(() => {
    if (viewMode !== "photo") return;
    const frame = requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (element) element.scrollLeft = pendingPhotoIndexRef.current * element.clientWidth;
    });
    return () => cancelAnimationFrame(frame);
  }, [viewMode]);

  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const handleScroll = () => {
      if (!element.clientWidth) return;
      const nextIndex = Math.max(0, Math.min(Math.round(element.scrollLeft / element.clientWidth), count - 1));
      pendingPhotoIndexRef.current = nextIndex;
      setIndex(nextIndex);
    };
    element.addEventListener("scroll", handleScroll, { passive: true });
    return () => element.removeEventListener("scroll", handleScroll);
  }, [count, viewMode]);

  React.useEffect(() => onIndexChange(index), [index, onIndexChange]);

  React.useEffect(() => {
    // Full-resolution neighbours are useful only after the recipient has
    // entered the lightbox. The inline gallery warms resized previews instead.
    preloadNeighbors(images, index, true);
  }, [images, index]);

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
      } else if (viewMode === "photo" && event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(index - 1);
      } else if (viewMode === "photo" && event.key === "ArrowRight") {
        event.preventDefault();
        goTo(index + 1);
      } else if (viewMode === "photo" && event.key === "Home") {
        event.preventDefault();
        goTo(0);
      } else if (viewMode === "photo" && event.key === "End") {
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
  }, [count, goTo, index, onClose, viewMode]);

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-[9999] flex overscroll-contain bg-surface text-foreground animate-in fade-in duration-200"
    >
      {/*
        3.25rem tall with 4px inset: the buttons' 44px touch circles then sit
        with an even 4px margin on every side. At h-12/px-1.5 the circle was
        44px in a 48px pill — its hover fill grazed the top edge and visually
        broke through the capsule's left cap.
      */}
      <div className="media-overlay-surface pointer-events-none absolute left-1/2 top-[max(.75rem,env(safe-area-inset-top))] z-40 grid h-[3.25rem] w-[min(calc(100%_-_1.5rem),36rem)] -translate-x-1/2 grid-cols-[1fr_minmax(0,auto)_1fr] items-center rounded-full px-1 sm:top-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex min-w-0 justify-start">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="pen-touch-target pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full text-foreground/72 transition-colors hover:bg-foreground/[0.075] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            aria-label={t("common.close", lang)}
          >
            <CloseIcon size={17} />
          </button>
        </div>
        {/*
          The header floats over the content, and in overview the photo grid
          scrolls right beneath it — bare text sat on whatever image happened to
          be underneath and disappeared. It now carries the same capsule as the
          two controls flanking it, so all three stay legible over anything.
        */}
        {/*
          A "1 / 1" counter states nothing — the arrows already hide themselves
          at a single image, and the capsule was the only chrome left claiming
          there was something to page through.
        */}
        {viewMode === "overview" && count > 1 ? (
          <span
            aria-live="polite"
            aria-atomic="true"
            className="inline-flex h-9 items-center justify-center px-3.5 text-[12px] font-semibold tabular-nums tracking-[-0.01em] text-foreground/78"
          >
            {t("draft.gallery.allPhotos", lang)}
          </span>
        ) : (
          <span className="max-w-[min(52vw,28rem)] truncate px-4 py-2 text-[12px] font-semibold text-foreground/72">
            {count > 1 ? counterLabel(index, count, lang) : alt}
          </span>
        )}
        <div className="flex min-w-0 justify-end">
          {overviewAvailable ? (
            <button
              type="button"
              onClick={() => {
                if (viewMode === "overview") {
                  pendingPhotoIndexRef.current = index;
                  setViewMode("photo");
                } else {
                  setViewMode("overview");
                }
              }}
              className="pen-touch-target pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full text-foreground/72 transition-colors hover:bg-foreground/[0.075] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              aria-label={t(viewMode === "overview" ? "draft.gallery.photoView" : "draft.gallery.allPhotos", lang)}
              aria-pressed={viewMode === "overview"}
            >
              {viewMode === "overview" ? <ExpandIcon /> : <GridIcon size={16} />}
            </button>
          ) : null}
        </div>
      </div>

      {viewMode === "photo" && count > 1 ? (
        <>
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
            className="media-overlay-control floating-icon-button pen-touch-target absolute left-2 top-1/2 z-30 hidden h-12 w-12 -translate-y-1/2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:invisible sm:left-7 sm:inline-flex sm:h-[3.25rem] sm:w-[3.25rem]"
            aria-label={t("draft.gallery.previous", lang)}
          >
            <ArrowLeftIcon size={20} />
          </button>
          <button
            type="button"
            onClick={() => goTo(index + 1)}
            disabled={index === count - 1}
            className="media-overlay-control floating-icon-button pen-touch-target absolute right-2 top-1/2 z-30 hidden h-12 w-12 -translate-y-1/2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:invisible sm:right-7 sm:inline-flex sm:h-[3.25rem] sm:w-[3.25rem]"
            aria-label={t("draft.gallery.next", lang)}
          >
            <ArrowRightIcon size={20} />
          </button>
        </>
      ) : null}

      {viewMode === "photo" ? (
        <div
          ref={scrollRef}
          className="flex h-full w-full touch-pan-x snap-x snap-mandatory overflow-x-auto overscroll-x-contain scrollbar-none"
        >
          {images.map((image, imageIndex) => (
            <div
              key={`${image.id ?? image.url}-${imageIndex}`}
              className="flex h-full w-full flex-none snap-start items-center justify-center pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[calc(4.75rem+env(safe-area-inset-top))] sm:pl-[max(4.5rem,env(safe-area-inset-left))] sm:pr-[max(4.5rem,env(safe-area-inset-right))] sm:pt-[calc(5.25rem+env(safe-area-inset-top))] lg:pl-[max(6rem,env(safe-area-inset-left))] lg:pr-[max(6rem,env(safe-area-inset-right))]"
            >
              <div className="relative inline-flex max-h-[calc(100dvh-6.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] max-w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={`${alt} ${imageIndex + 1}`}
                  loading={Math.abs(imageIndex - index) <= 1 ? "eager" : "lazy"}
                  decoding="async"
                  fetchPriority={imageIndex === index ? "high" : "auto"}
                  className={cn(
                    // The field behind it is white, so a light photo used to bleed
                    // straight into the background with no edge. The shadow and
                    // hairline give it one without tinting the surround.
                    "max-h-[calc(100dvh-6.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] max-w-full select-none rounded-[var(--radius)] object-contain shadow-soft ring-1 ring-black/[0.06] transition-opacity duration-200 ease-out motion-reduce:transition-none",
                    imageIndex === index ? "opacity-100" : "opacity-80",
                  )}
                  draggable={false}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex h-full w-full flex-col overflow-y-auto overscroll-y-contain pb-[max(2rem,env(safe-area-inset-bottom))] pl-[max(.75rem,env(safe-area-inset-left))] pr-[max(.75rem,env(safe-area-inset-right))] pt-[calc(5rem+env(safe-area-inset-top))] scrollbar-none sm:pb-[max(3rem,env(safe-area-inset-bottom))] sm:pl-[max(2rem,env(safe-area-inset-left))] sm:pr-[max(2rem,env(safe-area-inset-right))] sm:pt-[calc(6rem+env(safe-area-inset-top))]">
          <div className="mx-auto mt-3 grid w-full max-w-[100rem] grid-flow-dense auto-rows-[clamp(8rem,34vw,13rem)] grid-cols-2 gap-2 sm:mt-4 sm:gap-3 md:auto-rows-[clamp(9.5rem,14vw,16rem)] md:grid-cols-4">
            {images.map((image, imageIndex) => {
              const isFeatureTile = imageIndex % 5 === 0;
              return (
                <button
                  type="button"
                  key={`${image.id ?? image.url}-overview-${imageIndex}`}
                  // Draggable into the Agent window, where the photo becomes
                  // the subject of the conversation.
                  draggable={typeof image.id === "number"}
                  onDragStart={(event) => {
                    if (typeof image.id !== "number") return;
                    writeDragItem(event.dataTransfer, {
                      kind: "image",
                      uploadId: image.id,
                      url: image.thumbnail_url || image.url,
                      label: `${t("draft.media.photo", lang)} ${imageIndex + 1}`,
                    });
                  }}
                  onClick={() => {
                    pendingPhotoIndexRef.current = imageIndex;
                    setIndex(imageIndex);
                    setViewMode("photo");
                  }}
                  className={cn(
                    "group relative overflow-hidden rounded-[var(--radius)] border bg-surface-subtle text-left shadow-sm transition-[border-color,transform] hover:border-foreground/35 hover:shadow-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.995]",
                    isFeatureTile ? "col-span-2 row-span-2" : "col-span-1 row-span-1",
                    imageIndex === index ? "border-foreground/45" : "border-border/65",
                  )}
                  aria-label={`${counterLabel(imageIndex, count, lang)}: ${t("draft.gallery.photoView", lang)}`}
                  aria-current={imageIndex === index ? "true" : undefined}
                >
                  <Thumbnail
                    src={image.thumbnail_url || image.url}
                    alt={`${alt} ${imageIndex + 1}`}
                    fallbackSrc={image.url}
                    className="absolute inset-0 h-full w-full select-none object-cover"
                    priority={imageIndex < 2}
                  />
                  <span
                    className={cn(
                      "media-overlay-surface floating-control-sm pointer-events-none absolute bottom-2 left-2 min-w-9 px-2.5 text-[11px] tabular-nums sm:bottom-3 sm:left-3",
                      imageIndex === index && "ring-1 ring-inset ring-black/20",
                    )}
                  >
                    {imageIndex + 1}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

export function DraftImageGallery({ images, alt, fallbackUrl, lang = "en", onActiveImageChange, onManage, manageLabel, mobileOverviewLabel = false }: DraftImageGalleryProps) {
  const galleryRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const pointerStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const suppressImageClickRef = React.useRef(false);
  const displayImages = React.useMemo<GalleryImage[]>(
    () => images.length > 0 ? images : fallbackUrl ? [{ url: fallbackUrl, name: alt }] : [],
    [alt, fallbackUrl, images],
  );
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null);
  const [lightboxStartsInOverview, setLightboxStartsInOverview] = React.useState(false);
  const count = displayImages.length;
  /*
   * Any multi-photo listing gets the desktop mosaic — a lone big-screen
   * carousel for three photos read as the phone layout stretched wide. Each
   * count gets a grid it can fill completely, so there are never empty cells:
   * 2 → halves, 3 → lead + two stacked, 4 → quad, 5+ → lead + four.
   */
  const mosaicAvailable = count >= 2;
  const mosaicCount = count >= 5 ? 5 : Math.min(count, 4);
  const mosaicGrid = count >= 5
    ? "grid-cols-4 grid-rows-2"
    : count === 4
      ? "grid-cols-2 grid-rows-2"
      : count === 3
        ? "grid-cols-3 grid-rows-2"
        : "grid-cols-2 grid-rows-1";
  const mosaicLeadTile = count >= 5 || count === 3 ? "col-span-2 row-span-2" : "";

  React.useEffect(() => {
    if (activeIndex < count) return;
    setActiveIndex(Math.max(0, count - 1));
  }, [activeIndex, count]);

  React.useEffect(() => {
    const source = images.length > 0 ? images[activeIndex] : undefined;
    onActiveImageChange?.(source?.id ?? null);
  }, [activeIndex, images, onActiveImageChange]);

  React.useEffect(() => {
    preloadNeighbors(displayImages, activeIndex);
  }, [activeIndex, displayImages]);

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

  const goTo = React.useCallback((next: number, behavior: ScrollBehavior = preferredScrollBehavior()) => {
    const element = scrollRef.current;
    if (!element) return;
    const clamped = Math.max(0, Math.min(next, count - 1));
    element.scrollTo({ left: clamped * element.clientWidth, behavior });
    setActiveIndex(clamped);
  }, [count]);

  const openLightbox = React.useCallback((imageIndex: number, overview = false) => {
    setLightboxStartsInOverview(overview);
    setLightboxIndex(imageIndex);
  }, []);
  const closeLightbox = React.useCallback(() => {
    setLightboxIndex(null);
    setLightboxStartsInOverview(false);
  }, []);
  const syncLightboxIndex = React.useCallback((next: number) => goTo(next, "auto"), [goTo]);
  const handleKeyboardNavigation = React.useCallback((event: React.KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(activeIndex - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      goTo(activeIndex + 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      goTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      goTo(count - 1);
    } else if (event.key.toLocaleLowerCase("en") === "f") {
      event.preventDefault();
      openLightbox(activeIndex);
    }
  }, [activeIndex, count, goTo, openLightbox]);

  if (count === 0) {
    return (
      <div className="detail-hero-gallery relative aspect-[4/3] w-full overflow-hidden bg-white ring-1 ring-inset ring-black/[0.045] sm:aspect-[16/10] md:aspect-video md:rounded-xl">
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
      <div
        ref={galleryRef}
        role="region"
        aria-label={alt}
        onKeyDown={handleKeyboardNavigation}
        className={cn(
          "detail-hero-gallery group relative aspect-[4/3] w-full overflow-hidden bg-white ring-1 ring-inset ring-black/[0.045] sm:aspect-[16/10] md:aspect-video md:rounded-xl",
          count === 1 && "detail-hero-gallery-single",
        )}
      >
        <div
          ref={scrollRef}
          onPointerDown={(event) => {
            pointerStartRef.current = { x: event.clientX, y: event.clientY };
            suppressImageClickRef.current = false;
          }}
          onPointerMove={(event) => {
            const start = pointerStartRef.current;
            if (!start) return;
            if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) suppressImageClickRef.current = true;
          }}
          onPointerUp={() => {
            pointerStartRef.current = null;
            window.setTimeout(() => { suppressImageClickRef.current = false; }, 0);
          }}
          onPointerCancel={() => {
            pointerStartRef.current = null;
            suppressImageClickRef.current = false;
          }}
          className={cn(
            "flex h-full w-full touch-pan-x snap-x snap-mandatory overflow-x-auto overscroll-x-contain scrollbar-none",
            mosaicAvailable && "lg:hidden",
          )}
        >
          {displayImages.map((image, imageIndex) => (
            <button
              type="button"
              key={`${image.id ?? image.url}-${imageIndex}`}
              onClick={() => {
                if (suppressImageClickRef.current) return;
                openLightbox(imageIndex);
              }}
              tabIndex={imageIndex === activeIndex ? 0 : -1}
              aria-label={`${t("draft.gallery.fullscreen", lang)}: ${counterLabel(imageIndex, count, lang)}`}
              aria-current={imageIndex === activeIndex ? "true" : undefined}
              className="relative h-full w-full flex-none snap-start overflow-hidden bg-white text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black/40"
            >
              <span
                className={cn(
                  "pointer-events-none absolute inset-0 transition-[transform,filter] duration-500 ease-out",
                  imageIndex === activeIndex ? "scale-100 blur-0" : "scale-[1.015] blur-[1px]",
                )}
              >
                <Thumbnail
                  src={image.thumbnail_url || image.url}
                  fallbackSrc={image.url}
                  alt={`${alt} · ${counterLabel(imageIndex, count, lang)}`}
                  className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
                  priority={imageIndex === 0}
                />
              </span>
              <span className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-300 group-hover:bg-black/[0.015]" />
            </button>
          ))}
        </div>

        {mosaicAvailable ? (
          <div className={cn("hidden h-full w-full gap-1 lg:grid", mosaicGrid)}>
            {displayImages.slice(0, mosaicCount).map((image, imageIndex) => (
              <button
                type="button"
                key={`${image.id ?? image.url}-mosaic-${imageIndex}`}
                onClick={() => openLightbox(imageIndex)}
                className={cn(
                  "group/tile relative overflow-hidden bg-surface-subtle text-left outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  imageIndex === 0 && mosaicLeadTile,
                )}
                aria-label={`${t("draft.gallery.photoView", lang)}: ${counterLabel(imageIndex, count, lang)}`}
              >
                <Thumbnail
                  src={image.thumbnail_url || image.url}
                  fallbackSrc={image.url}
                  alt={`${alt} ${imageIndex + 1}`}
                  className="absolute inset-0 h-full w-full select-none object-cover"
                  priority={imageIndex < 2}
                />
                <span className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-200 group-hover/tile:bg-black/[0.035]" />
              </button>
            ))}
          </div>
        ) : null}

        {onManage ? (
          <button
            type="button"
            onClick={onManage}
            className="media-overlay-control floating-control-sm pen-touch-target absolute left-3 top-3 gap-2 px-3 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/25 sm:min-h-11 sm:px-4 sm:text-[12px] sm:font-medium"
            aria-label={manageLabel}
          >
            <EditIcon size={15} />
            <span>{manageLabel}</span>
          </button>
        ) : null}

        {mosaicAvailable ? <button
          type="button"
          data-testid="draft-gallery-icon-overview-open"
          onClick={() => openLightbox(activeIndex, true)}
          className={cn(
            "media-overlay-control pen-touch-target absolute right-3 top-3 inline-flex h-9 min-h-9 items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/25 sm:h-11 sm:min-h-11",
            mobileOverviewLabel
              ? "floating-control-sm gap-2 rounded-full px-3.5 text-[11px] font-semibold"
              : "floating-icon-button w-11 rounded-full",
            mosaicAvailable && "lg:hidden",
          )}
          aria-label={t("draft.gallery.allPhotos", lang)}
        >
          <GridIcon size={16} />
          {mobileOverviewLabel ? (
            <>
              <span>{t("draft.gallery.allPhotos", lang)}</span>
              <span className="tabular-nums opacity-55">{count}</span>
            </>
          ) : null}
        </button> : null}

        {mosaicAvailable ? (
        <button
          type="button"
          data-testid="draft-gallery-overview-open"
          onClick={() => openLightbox(activeIndex, true)}
            className="media-overlay-control floating-control pen-touch-target absolute bottom-3 right-3 z-10 hidden gap-2 px-4 text-[12px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/25 lg:inline-flex"
            aria-label={t("draft.gallery.allPhotos", lang)}
          >
            <GridIcon size={16} />
            <span>{t("draft.gallery.allPhotos", lang)}</span>
            <span className="tabular-nums opacity-60">{count}</span>
          </button>
        ) : null}

        {count > 1 ? (
          <>
            <button
              type="button"
              onClick={() => goTo(activeIndex - 1)}
              disabled={activeIndex === 0}
              className={cn(
                /*
                 * No `disabled:pointer-events-none` here, deliberately. The
                 * image behind these arrows opens the lightbox, so making a
                 * disabled arrow transparent to clicks meant that the moment
                 * you paged onto the first or last photo, the very next click
                 * — still aimed at the arrow — fell through and threw the
                 * fullscreen gallery open. A spent arrow now simply absorbs
                 * the click, which is what pressing a dead control should do.
                 */
                "media-overlay-control floating-icon-button pen-touch-target absolute left-3 top-1/2 hidden -translate-y-1/2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/25 disabled:cursor-default disabled:opacity-30 sm:inline-flex",
                mosaicAvailable && "lg:hidden",
              )}
              aria-label={t("draft.gallery.previous", lang)}
            >
              <ArrowLeftIcon size={18} />
            </button>
            <button
              type="button"
              onClick={() => goTo(activeIndex + 1)}
              disabled={activeIndex === count - 1}
              className={cn(
                // Same reasoning as the previous arrow: a disabled arrow must
                // still swallow the click rather than let it reach the image.
                "media-overlay-control floating-icon-button pen-touch-target absolute right-3 top-1/2 hidden -translate-y-1/2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/25 disabled:cursor-default disabled:opacity-30 sm:inline-flex",
                mosaicAvailable && "lg:hidden",
              )}
              aria-label={t("draft.gallery.next", lang)}
            >
              <ArrowRightIcon size={18} />
            </button>
          </>
        ) : null}

        {count > 1 ? (
          <div className={cn(
            "pointer-events-none absolute inset-x-0 bottom-3 flex justify-center",
            mosaicAvailable && "lg:hidden",
          )}>
            {count <= 10 ? (
              <div
                role="status"
                aria-label={counterLabel(activeIndex, count, lang)}
                className="media-overlay-surface flex h-8 items-center gap-2 rounded-full px-3"
              >
                {displayImages.map((image, imageIndex) => (
                  <span
                    key={`${image.id ?? image.url}-indicator`}
                    aria-hidden="true"
                    className={cn(
                      "block h-1.5 rounded-full transition-[width,background-color] duration-200",
                      imageIndex === activeIndex ? "w-4 bg-black/75" : "w-1.5 bg-black/25",
                    )}
                  />
                ))}
              </div>
            ) : (
              <span className="media-overlay-surface rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums">
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
          startInOverview={lightboxStartsInOverview}
          lang={lang}
          onClose={closeLightbox}
          onIndexChange={syncLightboxIndex}
        />
      ) : null}
    </>
  );
}
