"use client";

import { useState, useCallback } from "react";

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

  const onLoad = useCallback(() => setLoaded(true), []);
  const onError = useCallback(() => setError(true), []);

  if (error) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-muted/20">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-foreground/8" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
          <path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }

  return (
    <>
      {/* Shimmer placeholder */}
      {!loaded && (
        <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-muted/30 via-muted/60 to-muted/30 bg-[length:200%_100%]" />
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
        className={`${className} transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </>
  );
}
