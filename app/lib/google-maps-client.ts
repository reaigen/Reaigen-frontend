"use client";

export type GoogleMapCenter = { lat: number; lng: number };

/**
 * A calm, full-colour roadmap palette inspired by the visual hierarchy of
 * Apple Maps while retaining Google's native data, controls, and attribution.
 */
export const REAIGEN_GOOGLE_MAP_STYLES = [
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#f5f3ee" }] },
  { featureType: "landscape.man_made", elementType: "geometry", stylers: [{ color: "#ece9e2" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#eeece6" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#cfe6c8" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#547d55" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#dedbd4" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#f5cf8d" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#e6b96c" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#fff8e7" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#666b70" }] },
  { featureType: "road", elementType: "labels.text.stroke", stylers: [{ color: "#ffffff" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#ddd9e8" }] },
  { featureType: "transit.station", elementType: "labels.text.fill", stylers: [{ color: "#6f6685" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#b9dff2" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#507b91" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#c9c5bc" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#4f555a" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#faf9f6" }] },
] as const;

export type GoogleMapInstance = {
  setCenter(center: GoogleMapCenter): void;
  setZoom(zoom: number): void;
  addListener?(eventName: string, listener: () => void): { remove(): void };
};

export type GoogleMapMarker = {
  setMap(map: GoogleMapInstance | null): void;
};

export type GoogleMapOverlay = {
  setMap(map: GoogleMapInstance | null): void;
};

export type GoogleMapsFailureReason =
  | "google-maps-auth-failed"
  | "google-maps-geocode-failed"
  | "google-maps-load-failed"
  | "google-maps-timeout"
  | "google-maps-unavailable";

type GoogleMapsGeocoder = {
  geocode(
    request: { address: string },
    callback: (
      results: Array<{
        geometry?: {
          location?: { lat(): number; lng(): number };
        };
      }> | null,
      status: string,
    ) => void,
  ): void;
};

export type GoogleMapsNamespace = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapInstance;
  Marker: new (options: {
    position: GoogleMapCenter;
    map: GoogleMapInstance;
    clickable: boolean;
    label?: string;
  }) => GoogleMapMarker;
  Polyline: new (options: {
    path: GoogleMapCenter[];
    map: GoogleMapInstance;
    clickable: boolean;
    geodesic: boolean;
    strokeColor: string;
    strokeOpacity: number;
    strokeWeight: number;
    icons?: Array<Record<string, unknown>>;
  }) => GoogleMapOverlay;
  Circle: new (options: {
    center: GoogleMapCenter;
    radius: number;
    map: GoogleMapInstance;
    clickable: boolean;
    fillColor: string;
    fillOpacity: number;
    strokeColor: string;
    strokeOpacity: number;
    strokeWeight: number;
  }) => GoogleMapOverlay;
  SymbolPath: {
    CIRCLE: unknown;
  };
  Geocoder?: new () => GoogleMapsGeocoder;
};

declare global {
  interface Window {
    google?: { maps?: GoogleMapsNamespace };
    __reaigenGoogleMapsReady?: () => void;
    gm_authFailure?: () => void;
  }
}

let googleMapsPromise: Promise<GoogleMapsNamespace> | null = null;
let googleMapsAuthFailed = false;
let authFailureHandlerInstalled = false;
const authFailureListeners = new Set<(reason: GoogleMapsFailureReason) => void>();
const geocodeCache = new Map<string, GoogleMapCenter>();

/**
 * Production deliberately follows a frozen Maps release. The moving weekly
 * channel changed underneath the deployed app in August 2026; a property page
 * should only take a Maps runtime upgrade as an intentional release.
 */
export const REAIGEN_GOOGLE_MAPS_VERSION = "3.65";

function installAuthFailureHandler() {
  if (authFailureHandlerInstalled) return;
  authFailureHandlerInstalled = true;
  const previousHandler = window.gm_authFailure;
  window.gm_authFailure = () => {
    googleMapsAuthFailed = true;
    googleMapsPromise = null;
    try {
      previousHandler?.();
    } finally {
      for (const listener of authFailureListeners) {
        listener("google-maps-auth-failed");
      }
    }
  };
}

/**
 * Google reports key, billing, and referrer authorization failures through a
 * global callback after its bootstrap script has loaded successfully. Without
 * this hook those failures look like a ready API followed by an empty canvas.
 */
export function subscribeGoogleMapsFailure(
  listener: (reason: GoogleMapsFailureReason) => void,
) {
  installAuthFailureHandler();
  authFailureListeners.add(listener);
  return () => authFailureListeners.delete(listener);
}

/**
 * Keep Google's default referrer authorization mode. The production key is
 * configured with website patterns such as `https://www.reaigen.io/*`; adding
 * `auth_referrer_policy=origin` would make Google discard the path and require
 * a different, domain-only restriction instead.
 */
export function googleMapsScriptUrl(
  apiKey: string,
  language: string,
  callbackName: string,
) {
  const url = new URL("https://maps.googleapis.com/maps/api/js");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("v", REAIGEN_GOOGLE_MAPS_VERSION);
  url.searchParams.set("loading", "async");
  url.searchParams.set("callback", callbackName);
  url.searchParams.set("language", language);
  return url.toString();
}

/** Clear the local failure latch so the visible retry action performs work. */
export function resetGoogleMapsFailure() {
  const reloadRequired = googleMapsAuthFailed && Boolean(window.google?.maps?.Map);
  googleMapsAuthFailed = false;
  googleMapsPromise = null;
  if (!window.google?.maps?.Map) {
    document.querySelector<HTMLScriptElement>("script[data-reaigen-google-maps]")?.remove();
  }
  return reloadRequired;
}

/**
 * Resolve legacy address-only drafts through Google's browser service. Drafts
 * with stored coordinates never call it. The Google Cloud key must therefore
 * allow the Geocoding API in addition to Maps JavaScript for those legacy
 * records; there is intentionally no alternate map or geocoder provider.
 */
export function geocodeGoogleMapsAddress(
  maps: GoogleMapsNamespace,
  address: string,
) {
  const normalized = address.replace(/\s+/g, " ").trim();
  const cacheKey = normalized.toLocaleLowerCase("en-US");
  const cached = geocodeCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  const Geocoder = maps.Geocoder;
  if (!Geocoder || normalized.length < 3) {
    return Promise.reject(new Error("google-maps-geocode-failed"));
  }

  return new Promise<GoogleMapCenter>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("google-maps-geocode-failed")),
      10_000,
    );
    const geocoder = new Geocoder();
    geocoder.geocode({ address: normalized }, (results, status) => {
      window.clearTimeout(timeout);
      const location = results?.[0]?.geometry?.location;
      const lat = location?.lat();
      const lng = location?.lng();
      if (
        status !== "OK"
        || !Number.isFinite(lat)
        || !Number.isFinite(lng)
      ) {
        reject(new Error("google-maps-geocode-failed"));
        return;
      }
      const center = { lat: lat!, lng: lng! };
      geocodeCache.set(cacheKey, center);
      resolve(center);
    });
  });
}

export function loadGoogleMaps(apiKey: string, language: string) {
  installAuthFailureHandler();
  if (googleMapsAuthFailed) {
    return Promise.reject(new Error("google-maps-auth-failed"));
  }
  const loadedMaps = window.google?.maps;
  if (loadedMaps?.Map) return Promise.resolve(loadedMaps);
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise<GoogleMapsNamespace>((resolve, reject) => {
    const callbackName = "__reaigenGoogleMapsReady";
    const existingScript = document.querySelector<HTMLScriptElement>("script[data-reaigen-google-maps]");
    existingScript?.remove();

    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      script.remove();
      delete window.__reaigenGoogleMapsReady;
      googleMapsPromise = null;
      reject(new Error("google-maps-timeout"));
    }, 12_000);

    window[callbackName] = () => {
      window.clearTimeout(timeout);
      delete window.__reaigenGoogleMapsReady;
      if (googleMapsAuthFailed) {
        googleMapsPromise = null;
        reject(new Error("google-maps-auth-failed"));
        return;
      }
      const maps = window.google?.maps;
      if (!maps?.Map) {
        googleMapsPromise = null;
        reject(new Error("google-maps-unavailable"));
        return;
      }
      resolve(maps);
    };

    script.src = googleMapsScriptUrl(apiKey, language, callbackName);
    script.async = true;
    script.defer = true;
    script.dataset.reaigenGoogleMaps = "true";
    script.onerror = () => {
      window.clearTimeout(timeout);
      script.remove();
      delete window.__reaigenGoogleMapsReady;
      googleMapsPromise = null;
      reject(new Error("google-maps-load-failed"));
    };
    document.head.appendChild(script);
  });

  return googleMapsPromise;
}
