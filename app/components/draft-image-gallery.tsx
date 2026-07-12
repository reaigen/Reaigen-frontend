"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Thumbnail } from "./thumbnail";

interface DraftImageGalleryProps {
  images: { url: string; thumbnail_url?: string | null }[];
  alt: string;
  /** Fallback thumbnail URL if no images */
  fallbackUrl?: string | null;
}

// ── Lightbox overlay ─────────────────────────────────────────────────────

function Lightbox({
  images,
  alt,
  startIndex,
  onClose,
}: {
  images: { url: string }[];
  alt: string;
  startIndex: number;
  onClose: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(startIndex);
  const count = images.length;

  // Scroll to start position on mount
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ left: startIndex * el.clientWidth, behavior: "instant" as ScrollBehavior });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track scroll position
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !el.clientWidth) return;
    setIndex(Math.max(0, Math.min(Math.round(el.scrollLeft / el.clientWidth), count - 1)));
  }, [count]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // Keyboard: arrows + escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      const el = scrollRef.current;
      if (!el) return;
      if (e.key === "ArrowLeft" && index > 0) {
        el.scrollTo({ left: (index - 1) * el.clientWidth, behavior: "smooth" });
      } else if (e.key === "ArrowRight" && index < count - 1) {
        el.scrollTo({ left: (index + 1) * el.clientWidth, behavior: "smooth" });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, index, count]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const goTo = (i: number) => {
    scrollRef.current?.scrollTo({ left: i * (scrollRef.current?.clientWidth ?? 0), behavior: "smooth" });
  };

  const content = (
    <div className="fixed inset-0 bg-background flex flex-col" style={{ zIndex: 9999 }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/50 shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] text-foreground/70 hover:text-foreground hover:bg-foreground/[0.05] transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>
        <span className="text-[13px] text-muted-foreground tabular-nums">
          {index + 1} / {count}
        </span>
      </div>

      {/* Scrollable images — tap background to close */}
      <div
        ref={scrollRef}
        className="flex flex-1 min-h-0 w-full overflow-x-auto scrollbar-none items-stretch"
        style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}
        onClick={onClose}
      >
        {images.map((img, i) => (
          <div
            key={img.url}
            className="flex w-full flex-none items-center justify-center p-4 sm:p-10"
            style={{ scrollSnapAlign: "start" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt={`${alt} ${i + 1}`}
              className="max-h-full max-w-full object-contain select-none rounded-lg"
              draggable={false}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        ))}
      </div>

      {/* Bottom bar: arrows + dots */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-border/50 shrink-0">
        {/* Prev arrow */}
        <button
          type="button"
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          className="flex h-8 w-8 items-center justify-center rounded-full text-foreground/40 hover:text-foreground hover:bg-foreground/[0.05] transition-colors disabled:opacity-20 disabled:pointer-events-none"
          aria-label="Previous"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Dots / counter */}
        {count <= 12 ? (
          <div className="flex gap-1.5" role="tablist">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Image ${i + 1}`}
                onClick={() => goTo(i)}
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  i === index ? "w-4 bg-foreground/60" : "w-1.5 bg-foreground/15"
                }`}
              />
            ))}
          </div>
        ) : (
          <span className="text-[12px] text-muted-foreground tabular-nums">{index + 1} / {count}</span>
        )}

        {/* Next arrow */}
        <button
          type="button"
          onClick={() => goTo(index + 1)}
          disabled={index >= count - 1}
          className="flex h-8 w-8 items-center justify-center rounded-full text-foreground/40 hover:text-foreground hover:bg-foreground/[0.05] transition-colors disabled:opacity-20 disabled:pointer-events-none"
          aria-label="Next"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
            <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

// ── Gallery ──────────────────────────────────────────────────────────────

export function DraftImageGallery({ images, alt, fallbackUrl }: DraftImageGalleryProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const count = images.length;

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !el.clientWidth) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setActiveIndex(Math.max(0, Math.min(idx, count - 1)));
  }, [count]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const goTo = useCallback((idx: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(idx, count - 1));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" });
  }, [count]);

  const goPrev = useCallback(() => goTo(activeIndex - 1), [goTo, activeIndex]);
  const goNext = useCallback(() => goTo(activeIndex + 1), [goTo, activeIndex]);

  // No images — show fallback or placeholder
  if (count === 0) {
    return (
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-muted/30">
        {fallbackUrl ? (
          <Thumbnail src={fallbackUrl} alt={alt} className="absolute inset-0 h-full w-full object-cover" priority />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-foreground/10" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
              <path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        )}
      </div>
    );
  }

  // Single image
  if (count === 1) {
    return (
      <>
        <div
          className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-muted/30 cursor-pointer"
          onClick={() => setLightboxIndex(0)}
        >
          <Thumbnail src={images[0].url} alt={alt} className="absolute inset-0 h-full w-full object-cover" priority />
        </div>
        {lightboxIndex !== null && (
          <Lightbox images={images} alt={alt} startIndex={0} onClose={() => setLightboxIndex(null)} />
        )}
      </>
    );
  }

  // Multiple images — carousel
  return (
    <>
      <div className="group relative overflow-hidden rounded-xl bg-muted/30">
        {/* Scrollable track */}
        <div
          ref={scrollRef}
          className="flex w-full overflow-x-auto scrollbar-none"
          style={{
            scrollSnapType: "x mandatory",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {images.map((img, i) => (
            <div
              key={img.url}
              className="relative aspect-[16/10] w-full flex-none cursor-pointer"
              style={{ scrollSnapAlign: "start" }}
              onClick={() => setLightboxIndex(i)}
            >
              <Thumbnail
                src={img.url}
                alt={`${alt} ${i + 1}`}
                className="absolute inset-0 h-full w-full object-cover"
                priority={i === 0}
              />
            </div>
          ))}
        </div>

        {/* Prev / Next arrows */}
        {activeIndex > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
            className="absolute left-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition-opacity hover:bg-black/50 sm:h-9 sm:w-9"
            aria-label="Previous"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {activeIndex < count - 1 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goNext(); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition-opacity hover:bg-black/50 sm:h-9 sm:w-9"
            aria-label="Next"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        {/* Dot indicators / counter */}
        <div className="absolute bottom-3 inset-x-0 flex justify-center pointer-events-none">
          {count <= 10 ? (
            <div className="flex gap-1.5 pointer-events-auto" role="tablist">
              {images.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === activeIndex}
                  aria-label={`Image ${i + 1}`}
                  onClick={() => goTo(i)}
                  className={`h-1.5 rounded-full transition-all duration-200 ${
                    i === activeIndex ? "w-4 bg-white shadow-sm" : "w-1.5 bg-white/50"
                  }`}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-full bg-black/40 px-2.5 py-0.5 text-[11px] font-medium text-white tabular-nums backdrop-blur-sm">
              {activeIndex + 1} / {count}
            </div>
          )}
        </div>
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <Lightbox images={images} alt={alt} startIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      )}
    </>
  );
}
