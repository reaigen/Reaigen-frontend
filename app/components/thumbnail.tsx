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

  if (error) return null;

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
