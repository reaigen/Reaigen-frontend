"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  GoogleMapCenter,
  GoogleMapsFailureReason,
  GoogleMapMarker,
  REAIGEN_GOOGLE_MAP_STYLES,
  REAIGEN_GOOGLE_MAPS_VERSION,
  googleMapsAddressEmbedUrl,
  loadGoogleMaps,
  resetGoogleMapsFailure,
  subscribeGoogleMapsFailure,
} from "../lib/google-maps-client";
import { MAPBOX_READY_TIMEOUT_MS, MAPBOX_STYLE, geocodeAddress, isMapboxToken, loadMapbox } from "../lib/mapbox-client";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
import { CloseIcon, LayoutIcon, LockIcon, MapPinIcon } from "./icons";
import "mapbox-gl/dist/mapbox-gl.css";

type ClientMapConfig = {
  apiKey: string | null;
  mapboxToken: string | null;
  center: GoogleMapCenter;
};

// Mapbox is the primary map; Google Maps takes over when Mapbox has no token
// or fails (operator, 2026-09-26: "we keep also google but now we have
// primary mapbox").
type MapProvider = "mapbox" | "google";

function MapboxCanvas({
  token,
  center,
  language,
  zoom,
  interactive,
  onReady,
  onError,
}: {
  token: string;
  center: GoogleMapCenter;
  language: string;
  zoom: number;
  interactive: boolean;
  onReady?: () => void;
  onError?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Callbacks are read through refs: a parent's inline handler must not tear
  // the map down and rebuild it on every render.
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
  }, [onError, onReady]);

  useEffect(() => {
    let active = true;
    let loaded = false;
    let map: { remove(): void } | null = null;
    const container = containerRef.current;
    if (!container) return;

    const fail = () => {
      if (!active || loaded) return;
      active = false;
      onErrorRef.current?.();
    };
    // A token Mapbox refuses or a blocked style never reaches "load"; the
    // Google fallback takes over instead of a spinner that never ends.
    const timer = window.setTimeout(fail, MAPBOX_READY_TIMEOUT_MS);

    void loadMapbox(token)
      .then((mapboxgl) => {
        if (!active) return;
        const instance = new mapboxgl.Map({
          container,
          style: MAPBOX_STYLE,
          center: [center.lng, center.lat],
          zoom,
          interactive,
          cooperativeGestures: interactive,
          attributionControl: true,
          language,
        });
        map = instance;
        if (interactive) instance.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
        new mapboxgl.Marker({ color: "#111111" }).setLngLat([center.lng, center.lat]).addTo(instance);
        instance.on("load", () => {
          if (!active) return;
          loaded = true;
          window.clearTimeout(timer);
          onReadyRef.current?.();
        });
        instance.on("error", () => fail());
      })
      .catch(() => fail());

    return () => {
      active = false;
      window.clearTimeout(timer);
      map?.remove();
      container.replaceChildren();
    };
  }, [token, center, interactive, language, zoom]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={cn("absolute inset-0 h-full w-full", !interactive && "pointer-events-none")}
    />
  );
}

const MAPS_RUNTIME_RELOAD_GUARD = "reaigen-google-maps-runtime-reload";

function GoogleMapCanvas({
  apiKey,
  center,
  language,
  zoom,
  interactive,
  onReady,
  onError,
}: {
  apiKey: string;
  center: GoogleMapCenter;
  language: string;
  zoom: number;
  interactive: boolean;
  onReady?: () => void;
  onError?: (reason: GoogleMapsFailureReason) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let marker: GoogleMapMarker | null = null;
    let readinessTimer: number | null = null;
    let readinessListener: { remove(): void } | null = null;
    const container = containerRef.current;
    if (!container) return;

    const unsubscribe = subscribeGoogleMapsFailure((reason) => {
      if (active) onError?.(reason);
    });

    void loadGoogleMaps(apiKey, language)
      .then((maps) => {
        if (!active) return;
        const map = new maps.Map(container, {
          center,
          zoom,
          styles: REAIGEN_GOOGLE_MAP_STYLES,
          backgroundColor: "#eef3f1",
          clickableIcons: false,
          disableDefaultUI: !interactive,
          fullscreenControl: false,
          gestureHandling: interactive ? "cooperative" : "none",
          keyboardShortcuts: interactive,
          mapTypeId: "roadmap",
          mapTypeControl: false,
          renderingType: "RASTER",
          rotateControl: false,
          scaleControl: interactive,
          streetViewControl: false,
          zoomControl: interactive,
        });
        marker = new maps.Marker({ position: center, map, clickable: false });

        const markReady = () => {
          if (!active) return;
          if (readinessTimer != null) window.clearTimeout(readinessTimer);
          readinessTimer = null;
          readinessListener?.remove();
          readinessListener = null;
          onReady?.();
        };
        readinessListener = map.addListener?.("tilesloaded", markReady) ?? null;
        if (!readinessListener) {
          window.requestAnimationFrame(markReady);
        } else {
          // Tile delivery can legitimately take longer on a constrained
          // connection. Keep the valid Google canvas mounted and end the
          // loading state instead of destroying it as a false failure.
          readinessTimer = window.setTimeout(markReady, 8_000);
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "";
        const reason: GoogleMapsFailureReason = (
          message === "google-maps-auth-failed"
          || message === "google-maps-load-failed"
          || message === "google-maps-stale-runtime"
          || message === "google-maps-timeout"
          || message === "google-maps-unavailable"
        ) ? message : "google-maps-unavailable";
        onError?.(reason);
      });

    return () => {
      active = false;
      unsubscribe();
      if (readinessTimer != null) window.clearTimeout(readinessTimer);
      readinessListener?.remove();
      marker?.setMap(null);
      container.replaceChildren();
    };
  }, [apiKey, center, interactive, language, onError, onReady, zoom]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={cn("absolute inset-0 h-full w-full", !interactive && "pointer-events-none")}
    />
  );
}

function coordinate(value: string | number | null | undefined, min: number, max: number) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function GoogleAddressMapFrame({
  address,
  lang,
  instance,
  onLoad,
  onError,
}: {
  address: string;
  lang: string;
  instance: string;
  onLoad: () => void;
  onError: () => void;
}) {
  const src = googleMapsAddressEmbedUrl(address, lang);
  if (!src) return null;

  return (
    <iframe
      key={instance}
      src={src}
      title={`${t("draft.location", lang)} · Google Maps`}
      className="absolute inset-0 h-full w-full border-0"
      referrerPolicy="strict-origin-when-cross-origin"
      allowFullScreen
      onLoad={onLoad}
      onError={onError}
    />
  );
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
  const [mapConfig, setMapConfig] = useState<ClientMapConfig | null>(null);
  const [provider, setProvider] = useState<MapProvider>("mapbox");
  const [addressProvider, setAddressProvider] = useState<MapProvider>("mapbox");
  const [addressMapbox, setAddressMapbox] = useState<{ token: string; center: GoogleMapCenter } | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(Boolean(rawTarget?.lat != null && rawTarget?.lng != null));
  const [retryNonce, setRetryNonce] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [addressMapRequested, setAddressMapRequested] = useState(false);
  const [addressMapStatus, setAddressMapStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [addressMapNonce, setAddressMapNonce] = useState(0);
  const cardRef = useRef<HTMLElement>(null);
  const targetKeyRef = useRef(rawTarget?.key ?? null);

  useEffect(() => {
    if (!target) {
      setShouldLoad(false);
      return;
    }
    const card = cardRef.current;
    if (!card || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setShouldLoad(true);
      observer.disconnect();
    }, { rootMargin: "600px 0px" });
    observer.observe(card);
    return () => observer.disconnect();
  }, [target]);

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
    const updateTarget = () => {
      const nextKey = rawTarget?.key ?? null;
      if (targetKeyRef.current === nextKey) return;
      targetKeyRef.current = nextKey;
      // The editable address is presentation text when saved coordinates are
      // available. Keep the map target stable while the user types so the
      // canvas does not disappear, refetch its key, and rebuild on every key.
      setTarget(rawTarget);
      setFailed(false);
      setAddressMapRequested(false);
      setAddressMapStatus("idle");
      setAddressProvider("mapbox");
      setAddressMapbox(null);
    };

    // Saved coordinates can render immediately. Address-only drafts debounce
    // while an editor is typing and wait for explicit consent before their
    // address is sent to the Google-hosted map frame.
    if (!rawTarget || rawTarget.lat != null) {
      updateTarget();
      return;
    }

    const timer = window.setTimeout(updateTarget, 500);
    return () => window.clearTimeout(timer);
  }, [rawTarget]);

  useEffect(() => {
    if (!target) {
      setMapConfig(null);
      setLoading(false);
      return;
    }

    // An address is not a coordinate. Do not make a request that the
    // authenticated endpoint must reject, and do not silently send a private
    // address to Google. The rendered state below waits for explicit action.
    if (target.lat == null || target.lng == null) {
      setMapConfig(null);
      setFailed(false);
      setLoading(false);
      return;
    }

    if (!shouldLoad) {
      setMapConfig(null);
      setLoading(true);
      return;
    }

    const controller = new AbortController();
    setMapConfig(null);
    setFailed(false);
    setLoading(true);
    void fetch("/api/maps/client", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        latitude: target.lat,
        longitude: target.lng,
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("map-unavailable");
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object") throw new Error("map-invalid-response");
        const { apiKey, mapboxToken, latitude, longitude } = payload as Record<string, unknown>;
        const googleKey = typeof apiKey === "string" && apiKey ? apiKey : null;
        const mapbox = isMapboxToken(mapboxToken) ? mapboxToken : null;
        if (
          (!googleKey && !mapbox)
          || typeof latitude !== "number"
          || typeof longitude !== "number"
        ) {
          throw new Error("map-invalid-response");
        }
        return { apiKey: googleKey, mapboxToken: mapbox, center: { lat: latitude, lng: longitude } };
      })
      .then((config) => {
        if (controller.signal.aborted) return;
        setProvider(config.mapboxToken ? "mapbox" : "google");
        setMapConfig(config);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setMapConfig(null);
        setFailed(true);
        setLoading(false);
      });

    return () => controller.abort();
  }, [lang, retryNonce, shouldLoad, target]);

  const handleMapReady = useCallback(() => {
    window.sessionStorage.removeItem(MAPS_RUNTIME_RELOAD_GUARD);
    setLoading(false);
  }, []);

  const handleMapError = useCallback((reason: GoogleMapsFailureReason) => {
    if (
      reason === "google-maps-stale-runtime"
      && window.sessionStorage.getItem(MAPS_RUNTIME_RELOAD_GUARD) !== REAIGEN_GOOGLE_MAPS_VERSION
    ) {
      window.sessionStorage.setItem(MAPS_RUNTIME_RELOAD_GUARD, REAIGEN_GOOGLE_MAPS_VERSION);
      window.location.reload();
      return;
    }
    console.error("Google Maps JavaScript unavailable", { reason });
    setMapConfig(null);
    setFailed(true);
    setLoading(false);
  }, []);

  // Mapbox failed: Google draws the same map when it has a key.
  const handleMapboxError = useCallback(() => {
    if (mapConfig?.apiKey) {
      console.error("Mapbox map unavailable; falling back to Google Maps");
      setProvider("google");
      setLoading(true);
      return;
    }
    console.error("Mapbox map unavailable and no Google fallback is configured");
    setMapConfig(null);
    setFailed(true);
    setLoading(false);
  }, [mapConfig]);

  const handleRetry = useCallback(() => {
    if (resetGoogleMapsFailure()) {
      window.location.reload();
      return;
    }
    setRetryNonce((value) => value + 1);
  }, []);

  const handleShowAddressMap = useCallback(() => {
    setAddressMapRequested(true);
    setAddressMapStatus("loading");
  }, []);

  const handleRetryAddressMap = useCallback(() => {
    setAddressMapNonce((value) => value + 1);
    setAddressProvider("mapbox");
    setAddressMapbox(null);
    setAddressMapStatus("loading");
  }, []);

  const addressFallbackToGoogle = useCallback(() => {
    setAddressMapbox(null);
    setAddressProvider("google");
  }, []);

  // After "Show map" only: ask the route for the Mapbox token (never sending
  // the address there), geocode in the browser, and draw the Mapbox map. Any
  // miss falls back to the Google-hosted frame, as before.
  useEffect(() => {
    if (!target || target.lat != null || !addressMapRequested || addressProvider !== "mapbox") return;
    const controller = new AbortController();
    void fetch("/api/maps/client", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose: "geocode" }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("map-unavailable");
        const { mapboxToken } = (await response.json()) as Record<string, unknown>;
        if (!isMapboxToken(mapboxToken)) throw new Error("map-invalid-response");
        const center = await geocodeAddress(target.address, lang, mapboxToken, controller.signal);
        if (!center) throw new Error("map-address-not-found");
        if (!controller.signal.aborted) setAddressMapbox({ token: mapboxToken, center });
      })
      .catch(() => {
        if (!controller.signal.aborted) addressFallbackToGoogle();
      });
    return () => controller.abort();
  }, [addressFallbackToGoogle, addressMapNonce, addressMapRequested, addressProvider, lang, target]);

  if (!target) return null;
  const isAddressOnly = target.lat == null || target.lng == null;

  return (
    <>
      <section
        ref={cardRef}
        aria-label={t("draft.location", lang)}
        aria-busy={loading || addressMapStatus === "loading"}
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
        {!failed && mapConfig && provider === "mapbox" && mapConfig.mapboxToken ? (
          <MapboxCanvas
            token={mapConfig.mapboxToken}
            center={mapConfig.center}
            language={lang.slice(0, 2).toLowerCase()}
            zoom={target.lat != null ? 15 : 14}
            interactive
            onReady={handleMapReady}
            onError={handleMapboxError}
          />
        ) : null}
        {!failed && mapConfig && provider === "google" && mapConfig.apiKey ? (
          <GoogleMapCanvas
            apiKey={mapConfig.apiKey}
            center={mapConfig.center}
            language={lang.slice(0, 2).toLowerCase()}
            zoom={target.lat != null ? 15 : 14}
            interactive
            onReady={handleMapReady}
            onError={handleMapError}
          />
        ) : null}
        {isAddressOnly && addressMapRequested && addressMapStatus !== "failed" && addressProvider === "mapbox" && addressMapbox ? (
          <MapboxCanvas
            key={`inline-mapbox-${target.key}-${addressMapNonce}`}
            token={addressMapbox.token}
            center={addressMapbox.center}
            language={lang.slice(0, 2).toLowerCase()}
            zoom={15}
            interactive
            onReady={() => setAddressMapStatus("ready")}
            onError={addressFallbackToGoogle}
          />
        ) : null}
        {isAddressOnly && addressMapRequested && addressMapStatus !== "failed" && addressProvider === "google" ? (
          <GoogleAddressMapFrame
            address={target.address}
            lang={lang}
            instance={`inline-${target.key}-${addressMapNonce}`}
            onLoad={() => setAddressMapStatus("ready")}
            onError={() => setAddressMapStatus("failed")}
          />
        ) : null}
        {failed ? (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <div className="max-w-[18rem]">
              <span className="media-overlay-surface mx-auto flex h-12 w-12 items-center justify-center rounded-full">
                <MapPinIcon size={20} />
              </span>
              <p className="mt-3 text-[13px] font-semibold text-foreground/68">{t("draft.mapPreviewUnavailable", lang)}</p>
              <button
                type="button"
                onClick={handleRetry}
                className="media-overlay-control mt-3 inline-flex min-h-9 items-center justify-center rounded-full px-4 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("common.tryAgain", lang)}
              </button>
            </div>
          </div>
        ) : null}
        {!failed && isAddressOnly && addressMapStatus === "failed" ? (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <div className="max-w-[18rem]">
              <span className="media-overlay-surface mx-auto flex h-12 w-12 items-center justify-center rounded-full">
                <MapPinIcon size={20} />
              </span>
              <p className="mt-3 text-[13px] font-semibold text-foreground/68">{t("draft.mapPreviewUnavailable", lang)}</p>
              <button
                type="button"
                onClick={handleRetryAddressMap}
                className="media-overlay-control mt-3 inline-flex min-h-9 items-center justify-center rounded-full px-4 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("common.tryAgain", lang)}
              </button>
            </div>
          </div>
        ) : null}
        {!failed && isAddressOnly && !addressMapRequested ? (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <div className="max-w-[21rem]">
              <span className="media-overlay-surface mx-auto flex h-12 w-12 items-center justify-center rounded-full">
                <MapPinIcon size={20} />
              </span>
              <p className="mt-3 text-[13px] font-semibold text-foreground/68">{t("draft.mapAddressPrompt", lang)}</p>
              <button
                type="button"
                onClick={handleShowAddressMap}
                className="media-overlay-control mt-3 inline-flex min-h-9 items-center justify-center rounded-full px-4 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("draft.showMap", lang)}
              </button>
            </div>
          </div>
        ) : null}
        {!failed && isAddressOnly && addressMapRequested && addressMapStatus === "loading" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" role="status" aria-label={t("common.loading", lang)}>
            <span className="media-overlay-surface inline-flex min-h-11 items-center gap-2.5 rounded-full px-4 text-[11px] font-semibold">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border border-foreground/15 border-t-foreground/55 motion-reduce:animate-none" aria-hidden="true" />
              {t("common.loading", lang)}
            </span>
          </div>
        ) : null}
        {!failed && !isAddressOnly && loading ? (
          <div className="absolute inset-0 flex items-center justify-center" role="status" aria-label={t("common.loading", lang)}>
            <span className="media-overlay-surface inline-flex min-h-11 items-center gap-2.5 rounded-full px-4 text-[11px] font-semibold">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border border-foreground/15 border-t-foreground/55 motion-reduce:animate-none" aria-hidden="true" />
              {t("common.loading", lang)}
            </span>
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/[0.08] via-transparent to-black/[0.24]" />
        <div className="media-overlay-surface absolute left-3 top-3 flex max-w-[calc(100%-7rem)] items-center gap-2 rounded-full px-3 py-2 text-[11px] font-semibold sm:left-4 sm:top-4">
          <LockIcon size={13} className="shrink-0" />
          <span className="truncate">{t("draft.location", lang)} · {t("draft.editor.private", lang)}</span>
        </div>
        {!isAddressOnly || (addressMapRequested && addressMapStatus === "ready") ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label={t("draft.location", lang)}
            title={t("draft.location", lang)}
            className="media-overlay-control absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-4 sm:top-4"
          >
            <LayoutIcon size={15} />
          </button>
        ) : null}
        {normalizedAddress ? (
          <p className="media-overlay-surface absolute bottom-10 left-3 right-3 line-clamp-2 rounded-[1rem] px-3 py-2.5 text-[11px] font-medium leading-relaxed sm:left-4 sm:right-auto sm:max-w-[min(75%,34rem)] sm:rounded-full sm:px-4 sm:py-2">
            {normalizedAddress}
          </p>
        ) : null}
      </section>

      {expanded && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/25 p-3 backdrop-blur-md sm:p-6" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-label={t("draft.location", lang)}
            className="flex h-[min(90dvh,56rem)] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-border/60 bg-card shadow-elevated"
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
              {mapConfig && !failed && !isAddressOnly && provider === "mapbox" && mapConfig.mapboxToken ? (
                <MapboxCanvas
                  token={mapConfig.mapboxToken}
                  center={mapConfig.center}
                  language={lang.slice(0, 2).toLowerCase()}
                  zoom={target.lat != null ? 15 : 14}
                  interactive
                  onError={handleMapboxError}
                />
              ) : null}
              {mapConfig && !failed && !isAddressOnly && provider === "google" && mapConfig.apiKey ? (
                <GoogleMapCanvas
                  apiKey={mapConfig.apiKey}
                  center={mapConfig.center}
                  language={lang.slice(0, 2).toLowerCase()}
                  zoom={target.lat != null ? 15 : 14}
                  interactive
                  onError={handleMapError}
                />
              ) : null}
              {failed && !isAddressOnly ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-foreground/55">
                  <MapPinIcon size={28} />
                  <p className="text-[13px] font-semibold">{t("draft.mapPreviewUnavailable", lang)}</p>
                  <button type="button" onClick={handleRetry} className="rounded-full border border-border bg-card px-4 py-2 text-[11px] font-semibold transition-colors hover:bg-surface-subtle">{t("common.tryAgain", lang)}</button>
                </div>
              ) : null}
              {isAddressOnly && addressMapRequested && addressMapStatus !== "failed" && addressProvider === "mapbox" && addressMapbox ? (
                <MapboxCanvas
                  key={`expanded-mapbox-${target.key}-${addressMapNonce}`}
                  token={addressMapbox.token}
                  center={addressMapbox.center}
                  language={lang.slice(0, 2).toLowerCase()}
                  zoom={15}
                  interactive
                  onError={addressFallbackToGoogle}
                />
              ) : null}
              {isAddressOnly && addressMapRequested && addressMapStatus !== "failed" && addressProvider === "google" ? (
                <GoogleAddressMapFrame
                  address={target.address}
                  lang={lang}
                  instance={`expanded-${target.key}-${addressMapNonce}`}
                  onLoad={() => setAddressMapStatus("ready")}
                  onError={() => setAddressMapStatus("failed")}
                />
              ) : null}
              {isAddressOnly && addressMapStatus === "failed" ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-foreground/55">
                  <MapPinIcon size={28} />
                  <p className="text-[13px] font-semibold">{t("draft.mapPreviewUnavailable", lang)}</p>
                  <button type="button" onClick={handleRetryAddressMap} className="rounded-full border border-border bg-card px-4 py-2 text-[11px] font-semibold transition-colors hover:bg-surface-subtle">{t("common.tryAgain", lang)}</button>
                </div>
              ) : null}
              {isAddressOnly && !addressMapRequested ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-foreground/55">
                  <MapPinIcon size={28} />
                  <button type="button" onClick={handleShowAddressMap} className="rounded-full border border-border bg-card px-4 py-2 text-[11px] font-semibold transition-colors hover:bg-surface-subtle">{t("draft.showMap", lang)}</button>
                </div>
              ) : null}
              {!isAddressOnly && !mapConfig && !failed ? (
                <div className="flex h-full items-center justify-center text-foreground/45"><span className="h-5 w-5 animate-spin rounded-full border-2 border-foreground/15 border-t-foreground/55 motion-reduce:animate-none" /></div>
              ) : null}
            </div>
            {normalizedAddress ? (
              <p className="px-5 py-4 text-[13px] font-medium text-foreground/72 sm:px-7">{normalizedAddress}</p>
            ) : null}
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
