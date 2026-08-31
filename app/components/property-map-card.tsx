"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
import { CloseIcon, LayoutIcon, LockIcon, MapPinIcon } from "./icons";

function coordinate(value: string | number | null | undefined, min: number, max: number) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export function PropertyMapCard({
  address,
  latitude,
  longitude,
  lang,
  compact = false,
  className,
}: {
  address?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  lang: string;
  compact?: boolean;
  className?: string;
}) {
  const lat = coordinate(latitude, -90, 90);
  const lng = coordinate(longitude, -180, 180);
  const normalizedAddress = address?.replace(/\s+/g, " ").trim() ?? "";
  const rawTarget = useMemo(() => (
    lat != null && lng != null
      ? { key: `${lat},${lng}`, lat, lng, address: normalizedAddress }
      : normalizedAddress.length >= 3
        ? { key: normalizedAddress, lat: null, lng: null, address: normalizedAddress }
        : null
  ), [lat, lng, normalizedAddress]);
  const [target, setTarget] = useState(rawTarget);
  const [mapSource, setMapSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(Boolean(rawTarget));
  const [retryNonce, setRetryNonce] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [expanded]);

  useEffect(() => {
    setTarget(rawTarget);
    setFailed(false);
  }, [rawTarget]);

  useEffect(() => {
    if (!target) {
      setMapSource(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let objectUrl: string | null = null;
    setMapSource(null);
    setFailed(false);
    setLoading(true);
    void fetch("/api/maps/static", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: target.address,
        latitude: target.lat,
        longitude: target.lng,
        lang: lang.slice(0, 2).toLowerCase(),
      }),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("map-unavailable");
        return response.blob();
      })
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setMapSource(objectUrl);
        setLoading(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setMapSource(null);
        setFailed(true);
        setLoading(false);
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [lang, retryNonce, target]);

  if (!target) return null;

  return (
    <>
      <section
        aria-label={t("draft.location", lang)}
        aria-busy={loading}
        className={cn(
          "group relative isolate overflow-hidden rounded-[1.6rem] border border-border/65 bg-[#e9eae7] shadow-card",
          compact ? "aspect-[4/3] min-h-[15rem] sm:aspect-[16/7]" : "aspect-[4/3] min-h-[17rem] sm:aspect-[18/7]",
          className,
        )}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(rgba(17,17,17,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(17,17,17,0.035)_1px,transparent_1px)] bg-[size:2rem_2rem]"
        />
        {!failed && mapSource ? (
          // Google supplies its own attribution within the Static Maps image.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={mapSource}
            src={mapSource}
            alt={target.address || t("draft.location", lang)}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            onError={() => setFailed(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : failed ? (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <div className="max-w-[18rem]">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-foreground/10 bg-white/88 text-foreground/58 shadow-control backdrop-blur-xl">
                <MapPinIcon size={20} />
              </span>
              <p className="mt-3 text-[13px] font-semibold text-foreground/68">{t("draft.mapPreviewUnavailable", lang)}</p>
              <button
                type="button"
                onClick={() => setRetryNonce((value) => value + 1)}
                className="mt-3 inline-flex min-h-9 items-center justify-center rounded-full border border-foreground/10 bg-white/88 px-4 text-[11px] font-semibold text-foreground/72 shadow-control transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("common.tryAgain", lang)}
              </button>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center" role="status" aria-label={t("common.loading", lang)}>
            <span className="inline-flex min-h-11 items-center gap-2.5 rounded-full border border-foreground/8 bg-white/78 px-4 text-[11px] font-semibold text-foreground/55 shadow-control backdrop-blur-xl">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border border-foreground/15 border-t-foreground/55 motion-reduce:animate-none" aria-hidden="true" />
              {t("common.loading", lang)}
            </span>
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/[0.08] via-transparent to-black/[0.24]" />
        <div className="absolute left-3 top-3 flex max-w-[calc(100%-7rem)] items-center gap-2 rounded-full border border-white/55 bg-white/82 px-3 py-2 text-[11px] font-semibold text-foreground shadow-control backdrop-blur-xl sm:left-4 sm:top-4">
          <LockIcon size={13} className="shrink-0" />
          <span className="truncate">{t("draft.location", lang)} · {t("draft.editor.private", lang)}</span>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label={t("draft.location", lang)}
          title={t("draft.location", lang)}
          className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/55 bg-white/86 text-foreground shadow-control backdrop-blur-xl transition-[background-color,transform] hover:bg-white active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-4 sm:top-4"
        >
          <LayoutIcon size={15} />
        </button>
        {target.address ? (
          <p className="absolute bottom-3 left-3 right-3 line-clamp-2 rounded-[1rem] border border-white/45 bg-white/84 px-3 py-2.5 text-[11px] font-medium leading-relaxed text-foreground/75 shadow-control backdrop-blur-xl sm:bottom-4 sm:left-4 sm:right-auto sm:max-w-[min(75%,34rem)] sm:rounded-full sm:px-4 sm:py-2">
            {target.address}
          </p>
        ) : null}
      </section>

      {expanded && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/25 p-3 backdrop-blur-md sm:p-6" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-label={t("draft.location", lang)}
            className="flex h-[min(90dvh,56rem)] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-white/70 bg-card/95 shadow-elevated backdrop-blur-2xl"
          >
            <header className="flex min-h-16 items-center justify-between gap-4 px-5 sm:px-7">
              <div className="min-w-0">
                <h2 className="truncate text-[16px] font-semibold tracking-[-0.015em]">{t("draft.location", lang)}</h2>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <LockIcon size={11} /> {t("draft.editor.private", lang)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                aria-label={t("common.close", lang)}
                className="floating-icon-button flex h-11 w-11 items-center justify-center text-foreground/65 hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CloseIcon size={18} />
              </button>
            </header>
            <div className="relative min-h-0 flex-1 overflow-hidden border-y border-border/55 bg-[#e9eae7]">
              {mapSource && !failed ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mapSource} alt={target.address || t("draft.location", lang)} className="h-full w-full object-cover" />
              ) : failed ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-foreground/55">
                  <MapPinIcon size={28} />
                  <p className="text-[13px] font-semibold">{t("draft.mapPreviewUnavailable", lang)}</p>
                  <button type="button" onClick={() => setRetryNonce((value) => value + 1)} className="rounded-full border border-border bg-card px-4 py-2 text-[11px] font-semibold shadow-control hover:bg-surface-subtle">{t("common.tryAgain", lang)}</button>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-foreground/45"><span className="h-5 w-5 animate-spin rounded-full border-2 border-foreground/15 border-t-foreground/55 motion-reduce:animate-none" /></div>
              )}
            </div>
            {target.address ? (
              <p className="px-5 py-4 text-[13px] font-medium text-foreground/72 sm:px-7">{target.address}</p>
            ) : null}
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
