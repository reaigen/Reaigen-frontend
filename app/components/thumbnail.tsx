"use client";

import { useState, useCallback, useEffect, useRef } from "react";

interface ThumbnailProps {
  src: string;
  alt: string;
  className?: string;
  /** Priority image (above the fold) — skips lazy loading */
  priority?: boolean;
  /** Direct signed URL used only when the same-origin preview cannot load. */
  fallbackSrc?: string | null;
}

/**
 * Optimized image component with:
 * - Native lazy loading + async decoding
 * - A short opacity settle on load (no movement or layout shift)
 * - A still tonal bed while the image decodes
 */
export function Thumbnail({ src, alt, className = "", priority = false, fallbackSrc = null }: ThumbnailProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [activeSrc, setActiveSrc] = useState(src);
  const imageRef = useRef<HTMLImageElement>(null);

  /* Signed media URLs can refresh after hydration. A result from the old URL
     must not poison the replacement, and a cached load event must never be a
     prerequisite for making valid media visible. */
  useEffect(() => {
    setActiveSrc(src);
    setLoaded(false);
    setError(false);
  }, [src]);

  // Browsers can satisfy a private cached preview before React subscribes to
  // its load event. Promote that already-decoded image on the next frame so a
  // cache hit never leaves a permanent neutral tile.
  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) setLoaded(true);
  }, [activeSrc]);

  const onLoad = useCallback(() => setLoaded(true), []);
  const onError = useCallback(() => {
    if (fallbackSrc && activeSrc !== fallbackSrc) {
      setActiveSrc(fallbackSrc);
      setLoaded(false);
      return;
    }
    setError(true);
  }, [activeSrc, fallbackSrc]);

  if (error) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-surface-subtle">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-foreground/15" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
          <path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }

  return (
    <>
      {/* A still tonal bed keeps layout stable without making media appear to
          slide across the card while it loads. */}
      {!loaded && (
        <div className="absolute inset-0 bg-surface-subtle" />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imageRef}
        src={activeSrc}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        // Lazy loading already keeps distant cards out of the request queue.
        // Forcing every other image to `low` also penalised a card the moment
        // it scrolled into view, leaving a neutral tile after the user arrived.
        fetchPriority={priority ? "high" : "auto"}
        onLoad={onLoad}
        onError={onError}
        className={`${className} transition-opacity duration-150 ease-out motion-reduce:transition-none ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </>
  );
}
