"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  GoogleMapCenter,
  GoogleMapsFailureReason,
  GoogleMapMarker,
  REAIGEN_GOOGLE_MAP_STYLES,
  REAIGEN_GOOGLE_MAPS_VERSION,
  loadGoogleMaps,
  resetGoogleMapsFailure,
  subscribeGoogleMapsFailure,
} from "../lib/google-maps-client";
import { MAPBOX_READY_TIMEOUT_MS, MAPBOX_STYLE, geocodeAddress, isMapboxToken, loadMapbox } from "../lib/mapbox-client";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
import { CloseIcon, LayoutIcon, LockIcon, MapPinIcon } from "./icons";
import "mapbox-gl/dist/mapbox-gl.css";
import "./property-map.css";

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
  onMap,
}: {
  token: string;
  center: GoogleMapCenter;
  language: string;
  zoom: number;
  interactive: boolean;
  onReady?: () => void;
  onError?: () => void;
  onMap?: (map: ZoomableMap | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Callbacks are read through refs: a parent's inline handler must not tear
  // the map down and rebuild it on every render.
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const onMapRef = useRef(onMap);
  useEffect(() => {
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
    onMapRef.current = onMap;
  }, [onError, onMap, onReady]);

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
        // Only our own controls (operator: "remove this default map ui and
        // use only ours"): no Mapbox zoom buttons, no cooperative-gesture
        // overlay, no Mapbox attribution box — MapboxAttribution renders the
        // required text in our material. The wordmark stays (Mapbox terms).
        const instance = new mapboxgl.Map({
          container,
          style: MAPBOX_STYLE,
          center: [center.lng, center.lat],
          zoom,
          interactive,
          scrollZoom: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          attributionControl: false,
          logoPosition: "bottom-left",
          language,
        });
        map = instance;
        instance.touchZoomRotate?.disableRotation?.();
        new mapboxgl.Marker({ color: "#111111" }).setLngLat([center.lng, center.lat]).addTo(instance);
        onMapRef.current?.(instance);
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
      onMapRef.current?.(null);
      map?.remove();
      container.replaceChildren();
    };
  }, [token, center, interactive, language, zoom]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={cn("reaigen-mapbox absolute inset-0 h-full w-full", !interactive && "pointer-events-none")}
    />
  );
}

type ZoomableMap = { zoomIn(): unknown; zoomOut(): unknown };

// The map controls' words in the creator's language (2026-09-26: "navigation
// ui is in english and we have slovak preferences"). Kept here rather than in
// the locale files while those are being reworked in parallel; "© Mapbox" and
// "© OpenStreetMap" are names and stay as they are.
const MAP_CONTROL_TEXT = {
  en: { zoomIn: "Zoom in", zoomOut: "Zoom out", attribution: "Map data sources", improve: "Improve this map" },
  sk: { zoomIn: "Priblížiť", zoomOut: "Oddialiť", attribution: "Zdroje mapových údajov", improve: "Vylepšiť túto mapu" },
  cs: { zoomIn: "Přiblížit", zoomOut: "Oddálit", attribution: "Zdroje mapových dat", improve: "Vylepšit tuto mapu" },
  de: { zoomIn: "Vergrößern", zoomOut: "Verkleinern", attribution: "Quellen der Kartendaten", improve: "Diese Karte verbessern" },
} as const;

function mapControlText(lang: string) {
  const code = String(lang || "").slice(0, 2).toLowerCase();
  return MAP_CONTROL_TEXT[code as keyof typeof MAP_CONTROL_TEXT] ?? MAP_CONTROL_TEXT.en;
}

/** Zoom in our own round controls, in place of Mapbox's. */
function MapZoomControls({ map, lang, className }: { map: ZoomableMap | null; lang: string; className?: string }) {
  if (!map) return null;
  const text = mapControlText(lang);
  const button = "flex h-10 w-10 items-center justify-center text-[18px] font-medium leading-none transition-colors hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
  return (
    <div className={cn("media-overlay-surface flex flex-col overflow-hidden rounded-full", className)}>
      <button type="button" onClick={() => map.zoomIn()} aria-label={text.zoomIn} title={text.zoomIn} className={button}>+</button>
      <span aria-hidden="true" className="mx-2.5 h-px bg-foreground/10" />
      <button type="button" onClick={() => map.zoomOut()} aria-label={text.zoomOut} title={text.zoomOut} className={button}>−</button>
    </div>
  );
}

/**
 * The attribution Mapbox's terms require, in our material: a small (i) pill
 * that opens to "© Mapbox © OpenStreetMap Improve this map".
 */
function MapboxAttribution({ lang, className }: { lang: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const text = mapControlText(lang);
  return (
    <div className={cn("media-overlay-surface flex h-7 items-center rounded-full text-[10.5px] font-medium", open ? "gap-2 pl-3 pr-1" : "", className)}>
      {open ? (
        <>
          <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener noreferrer" className="hover:underline">© Mapbox</a>
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="hover:underline">© OpenStreetMap</a>
          <a href="https://www.mapbox.com/map-feedback/" target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline">{text.improve}</a>
        </>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={text.attribution}
        title={text.attribution}
        className="flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-semibold italic focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        i
      </button>
    </div>
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

/** An address the map could not place, said in the card's own words. */
function addressNotFoundText(lang: string) {
  const text = {
    en: "This address could not be found on the map. Check the street and town.",
    sk: "Túto adresu sa na mape nepodarilo nájsť. Skontrolujte ulicu a obec.",
    cs: "Tuto adresu se na mapě nepodařilo najít. Zkontrolujte ulici a obec.",
    de: "Diese Adresse wurde auf der Karte nicht gefunden. Prüfen Sie Straße und Ort.",
  } as const;
  return text[String(lang || "").slice(0, 2).toLowerCase() as keyof typeof text] ?? text.en;
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
  const [inlineMap, setInlineMap] = useState<ZoomableMap | null>(null);
  const [expandedMap, setExpandedMap] = useState<ZoomableMap | null>(null);
  // "not-found": Mapbox has no match for the address; "failed": the map
  // service itself did not answer.
  const [addressMiss, setAddressMiss] = useState<"not-found" | "failed" | null>(null);
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
      setAddressMiss(null);
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
    setAddressMiss(null);
    setAddressMapbox(null);
    setAddressMapStatus("loading");
  }, []);

  // No Google-hosted frame any more: it brought Google's own buttons and, for
  // an address it could not place, a map of the whole world (operator,
  // 2026-09-26: "those map ui things i dont like them"). A miss is said in
  // the card's own words instead.
  const addressMapMissed = useCallback((reason: "not-found" | "failed") => {
    setAddressMapbox(null);
    setAddressMiss(reason);
    setAddressMapStatus("failed");
  }, []);

  // An address-only draft draws its map as soon as the card is in view, like
  // one with coordinates (operator, 2026-09-26: "by default we want to load
  // map immediately, not to wait to click"). The click was a consent step
  // from when the address went to a Google frame; it now goes only to the
  // Mapbox geocoder, from the browser.
  useEffect(() => {
    if (!shouldLoad || !target || target.lat != null || addressMapRequested) return;
    setAddressMapRequested(true);
    setAddressMapStatus("loading");
  }, [addressMapRequested, shouldLoad, target]);

  // Once requested: ask the route for the Mapbox token (never sending
  // the address there), geocode in the browser, and draw the Mapbox map.
  useEffect(() => {
    if (!target || target.lat != null || !addressMapRequested || addressMiss || addressMapbox) return;
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
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        addressMapMissed(error instanceof Error && error.message === "map-address-not-found" ? "not-found" : "failed");
      });
    return () => controller.abort();
    // addressMapbox/addressMiss end the request; they are not re-run triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressMapMissed, addressMapNonce, addressMapRequested, lang, target]);

  if (!target) return null;
  const isAddressOnly = target.lat == null || target.lng == null;

  return (
    <>
      <section
        ref={cardRef}
        aria-label={t("draft.location", lang)}
        aria-busy={loading || addressMapStatus === "loading"}
        className={cn(
          // The explicit clip-path rounds a WebGL canvas that overflow alone
          // left square (2026-09-26: "we have to fix those roundings").
          "group relative isolate overflow-hidden rounded-[1.6rem] border border-border/65 bg-[#e9eae7] shadow-card [clip-path:inset(0_round_1.6rem)]",
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
            onMap={setInlineMap}
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
        {isAddressOnly && addressMapRequested && addressMapStatus !== "failed" && addressMapbox ? (
          <MapboxCanvas
            onMap={setInlineMap}
            key={`inline-mapbox-${target.key}-${addressMapNonce}`}
            token={addressMapbox.token}
            center={addressMapbox.center}
            language={lang.slice(0, 2).toLowerCase()}
            zoom={15}
            interactive
            onReady={() => setAddressMapStatus("ready")}
            onError={() => addressMapMissed("failed")}
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
              <p className="mt-3 text-[13px] font-semibold text-foreground/68">{addressMiss === "not-found" ? addressNotFoundText(lang) : t("draft.mapPreviewUnavailable", lang)}</p>
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
        {inlineMap ? (
          <>
            <MapZoomControls map={inlineMap} lang={lang} className="absolute bottom-12 right-3 sm:bottom-14 sm:right-4" />
            <MapboxAttribution lang={lang} className="absolute bottom-3 right-3 sm:bottom-4 sm:right-4" />
          </>
        ) : null}
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
              {expandedMap ? (
                <>
                  <MapZoomControls map={expandedMap} lang={lang} className="absolute right-4 top-4 z-10" />
                  <MapboxAttribution lang={lang} className="absolute bottom-4 right-4 z-10" />
                </>
              ) : null}
              {mapConfig && !failed && !isAddressOnly && provider === "mapbox" && mapConfig.mapboxToken ? (
                <MapboxCanvas
                  onMap={setExpandedMap}
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
              {isAddressOnly && addressMapRequested && addressMapStatus !== "failed" && addressMapbox ? (
                <MapboxCanvas
                  onMap={setExpandedMap}
                  key={`expanded-mapbox-${target.key}-${addressMapNonce}`}
                  token={addressMapbox.token}
                  center={addressMapbox.center}
                  language={lang.slice(0, 2).toLowerCase()}
                  zoom={15}
                  interactive
                  onError={() => addressMapMissed("failed")}
                />
              ) : null}
              {isAddressOnly && addressMapStatus === "failed" ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-foreground/55">
                  <MapPinIcon size={28} />
                  <p className="text-[13px] font-semibold">{addressMiss === "not-found" ? addressNotFoundText(lang) : t("draft.mapPreviewUnavailable", lang)}</p>
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
