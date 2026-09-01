# Production Maps and UI runbook

This runbook records the production contract for property maps, editor control
geometry, collection delivery, and immersive tour loading. Use it when changing
or diagnosing these surfaces.

## Google Cloud and Vercel configuration

Production uses one browser key stored in Vercel as `GOOGLE_MAPS_KEY`.

The Google Cloud key must have:

- an active billing account on its project;
- **Maps JavaScript API** enabled;
- application restriction **Websites**;
- website rules for `https://reaigen.io/*` and
  `https://www.reaigen.io/*`;
- API restriction **Maps JavaScript API** only.

Do not enable or introduce OpenStreetMap, Leaflet, Nominatim, Mapbox, or a
silent fallback provider. Address-only drafts are not geocoded by this client.
The property map renders saved latitude and longitude, keeping exact location
inside the authenticated creator workspace.

After changing `GOOGLE_MAPS_KEY`, redeploy the production frontend. Never put
the key in a `NEXT_PUBLIC_*` variable, repository file, log, screenshot, or
documentation example.

## Map runtime contract

`PropertyMapCard` sends saved coordinates to the same-origin
`POST /api/maps/client` route. The route returns those validated coordinates
and the website-restricted browser key only to the authenticated workspace.

The browser runtime:

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
  then boots the current key. This prevents an obsolete “For development
  purposes only” state from surviving a deployment.

Google Maps cannot be safely unloaded and replaced inside one document. Do not
remove the stale-runtime reload guard or attempt to mutate Google's namespace.

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
2. Open an authenticated draft with saved coordinates and verify colored map
   tiles, the Google attribution, pan, zoom, expansion, and retry behavior.
3. Leave a tab open across a deployment, navigate back to the draft, and
   confirm it reloads at most once and then shows the current authorized map.
4. Confirm the console has no `RefererNotAllowedMapError`,
   `BillingNotEnabledMapError`, `InvalidKeyMapError`, or CSP violations.
5. Search the production source for disallowed map providers and confirm none
   are present.

An HTTP 200 from the page and Maps bootstrap does not prove that tiles rendered.
Final release sign-off requires a real signed-in browser session.
