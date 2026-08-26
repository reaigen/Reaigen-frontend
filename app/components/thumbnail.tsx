"use client";

import { useState, useCallback, useEffect } from "react";

interface ThumbnailProps {
  src: string;
  alt: string;
  className?: string;
  /** Priority image (above the fold) — skips lazy loading */
  priority?: boolean;
}

/**
 * Optimized image component with:
 * - Native lazy loading + async decoding
 * - CSS fade-in on load (no layout shift)
 * - Shimmer placeholder while loading
 */
export function Thumbnail({ src, alt, className = "", priority = false }: ThumbnailProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  /* Signed media URLs can refresh after hydration. A result from the old URL
     must not poison the replacement, and a cached load event must never be a
     prerequisite for making valid media visible. */
  useEffect(() => {
    setLoaded(false);
    setError(false);
  }, [src]);

  const onLoad = useCallback(() => setLoaded(true), []);
  const onError = useCallback(() => setError(true), []);

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
        src={src}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : "low"}
        onLoad={onLoad}
        onError={onError}
        className={`${className} opacity-100`}
      />
    </>
  );
}
