# Production Maps and UI runbook

This runbook records the production contract for property maps, editor control
geometry, collection delivery, and immersive tour loading. Use it when changing
or diagnosing these surfaces.

## Providers (2026-09-26)

The property location map (listing detail, draft editor) uses **Mapbox GL as
the primary provider and Google Maps as the fallback** — operator: "use
mapbox as maps because google is not loading … we keep also google but now we
have primary mapbox". Agent (Reai panel) map and route blocks stay on Google:
Mapbox Product Terms §1.5(ii) bar using the service to operate AI technologies.
OpenStreetMap tiles, Leaflet and Nominatim are still not used.

## Vercel configuration

Two server-only variables (never `NEXT_PUBLIC_*`, a repository file, a log, a
screenshot or a documentation example):

- `MAPBOX_ACCESS_TOKEN` — the public `pk.` token (the same one the backend
  holds as `MAPBOX_KEY` in the Stockholm secret). Restrict it in the Mapbox
  account to the production URLs `https://reaigen.io` and
  `https://www.reaigen.io` (and the test-stack origin if maps are wanted
  there). Scopes: styles, tiles, fonts, geocoding.
- `GOOGLE_MAPS_KEY` — the Google fallback. The Google Cloud key must have an
  active billing account, **Maps JavaScript API** enabled, application
  restriction **Websites** (`https://reaigen.io/*`, `https://www.reaigen.io/*`)
  and API restriction **Maps JavaScript API** only.

Either variable alone draws the map; with neither, the card says the preview is
unavailable. Redeploy the frontend after changing them.

## Map runtime contract

`PropertyMapCard` sends saved coordinates to the same-origin
`POST /api/maps/client` route. The route validates the cookie token against
Django (cookie presence alone is not authentication; expired access tokens use
the shared silent-refresh path; forged or refused sessions get nothing) and
only then returns `{ apiKey, mapboxToken, latitude, longitude }`.

- **Mapbox first** (`app/lib/mapbox-client.ts`): the bundled `mapbox-gl`
  (pinned `3.31.0`, loaded only when a map is about to render), style
  `mapbox://styles/mapbox/streets-v12`, a marker. Only our own controls:
  round zoom buttons and an (i) attribution pill in the card's overlay
  material, worded in the creator's language (sk/cs/de/en); page scrolling is
  never captured (scroll zoom off; drag, pinch and double-click work). The
  Mapbox wordmark stays, inside the rounded corner, and the pill opens to the
  required "© Mapbox © OpenStreetMap Improve this map" — both are Mapbox
  terms. The card clips the WebGL canvas with a rounded `clip-path`, and
  `app/components/property-map.css` restores the absolute fill that
  `mapbox-gl.css` (`position: relative`) overrode. A map that fires `error` or
  does not reach `load` within 12 s falls back.
- **Google fallback**: when Mapbox has no token or fails and a Google key
  exists, the same card draws the Google canvas (the contract below). With no
  Google key, the card shows the unavailable state with Try again.
- **Address-only drafts** are never geocoded during page load. Only after the
  creator chooses **Show map**, the card asks the route for the Mapbox token
  (`{ purpose: "geocode" }` — the address is not sent to our route) and
  geocodes the address in the browser with Mapbox Geocoding v6 (one best
  match, temporary results, nothing stored). A trailing two-letter country
  code ("…, sk") becomes the `country` filter; when the whole address has no
  match, the part after the street (postal code, town) is tried. No match:
  the card says so in the creator's language ("Túto adresu sa na mape
  nepodarilo nájsť…") with Try again. There is no Google-hosted frame any
  more: it showed Google's own controls and, for an address it could not
  place, a map of the whole world (operator, 2026-09-26).

The Google runtime (fallback):

- loads Google Maps JavaScript `3.65` directly from
  `maps.googleapis.com`;
- uses the raster roadmap renderer so the Reaigen color palette remains
  deterministic;
- keeps distinct land, park, road, highway, and water colors;
- enables cooperative pan and zoom on both inline and expanded maps;
- treats Google's `gm_authFailure` callback as an authorization failure;
- waits for `tilesloaded`, with a non-destructive readiness fallback on slow
  connections—the canvas is not removed merely because tiles are late;
- stamps the loaded key/version on the current document. If a tab retained a
  Google namespace from an older deployment, it performs one clean reload and
  then boots the current key.

Google Maps cannot be safely unloaded and replaced inside one document. Do not
remove the stale-runtime reload guard or attempt to mutate Google's namespace.

## Content-Security-Policy

A CSP response header applies only on a full page load; Next.js client
navigation keeps the policy of the page the tab was opened on. Sign-in happens
on `/` and moves to `/dashboard` without a reload, so the strict policy that
`/` used to carry blocked every map for the rest of the session — the cause of
"google is not loading". Every app page (sign-in pages included) now carries
the map-capable policy (`next.config.ts`, Google script hosts plus the Mapbox
`connect-src` hosts); only the public `/shared` viewer, the API and the Apple
association files keep the strict default. Mapbox GL needs `worker-src blob:`
and `img-src data: blob:`, which both policies already have.

## UI geometry contract

- Value and unit editing is one `rounded-full` capsule with one internal
  divider. The input and unit trigger do not draw separate borders or nested
  corner radii.
- Capsule geometry is local to the relevant control. Do not change shared
  button, input, select, search, gallery, or dialog radii to fix one field.
- Editor and side-panel surfaces use one flat card material. Do not mix glossy
  white controls with transparent black controls inside one panel.
- The immersive tour back arrow is explicitly white. The draft-detail back
  arrow keeps its normal foreground color for the light surface.
- Draft loading uses geometry-matched silhouettes. Tour loading starts on the
  same dark immersive canvas used by the viewer.

## Collection and media delivery

- Dashboard and tour search show immediate local matches while a 200 ms,
  abortable server query settles.
- Infinite scrolling preloads the next bounded page and keeps a manual Load
  more control when idle.
- Initial and appended pages use card-shaped silhouettes instead of an empty
  white dialog.
- Offscreen cards use `content-visibility: auto` with a stable intrinsic size.
- Only above-the-fold thumbnails receive priority; later images remain lazy
  and decode asynchronously.

## Release verification

Run from the frontend repository:

```bash
npm run validate-google-maps
npm run validate-panel-geometry
npm run check
```

Then verify production:

1. Confirm `reaigen.io` redirects to `www.reaigen.io` and both aliases point to
   the intended Ready Vercel deployment.
2. Sign in on `/`, then open an authenticated draft with saved coordinates
   without reloading, and verify Mapbox tiles, the Mapbox attribution and logo,
   pan, zoom, expansion, and retry behavior.
3. Open an address-only draft, confirm no geocoding or map request occurs
   during page load, choose **Show map**, and verify the Mapbox map stays
   inside the location card and expanded dialog.
4. Submit a valid-coordinate request to `/api/maps/client` with no cookies and
   with a forged cookie. Both must return `401` without a key or token.
5. With `MAPBOX_ACCESS_TOKEN` unset (a preview), confirm the Google fallback
   draws the map.
6. Leave a tab open across a deployment, navigate back to the draft, and
   confirm it reloads at most once and then shows the current authorized map.
7. Confirm the console has no `RefererNotAllowedMapError`,
   `BillingNotEnabledMapError`, `InvalidKeyMapError`, or CSP violations.
8. Search the production source for OpenStreetMap, Leaflet or Nominatim and
   confirm none are present.

An HTTP 200 from the page and Maps bootstrap does not prove that tiles rendered.
Final release sign-off requires a real signed-in browser session.
