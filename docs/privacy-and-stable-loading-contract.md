# Privacy and stable-loading contract

This contract covers authenticated property details, public shared pages, the
desktop application shell, and the tour viewer. Treat these rules as release
requirements rather than optional presentation details.

## Property-location privacy

- A property's exact street address, postal code, latitude, and longitude are
  private creator data. They may only be rendered inside an authenticated
  creator workspace.
- Public shared pages may show a coarse locality assembled from city, state or
  region, and localized country. They must never use `display_address` or fall
  back to a raw address payload.
- The frontend proxy sanitizes public shared-property responses as a second
  boundary. It removes exact address and coordinate fields from both the root
  response and nested property data before the response reaches browser code.
- The map image route requires creator authentication and returns only a
  privately cacheable, composed image. Google credentials, provider tile URLs,
  coordinates, and geocoding responses remain server-side. When a draft has an
  address but no saved coordinates, fallback geocoding is also performed only
  inside this authenticated route and cached server-side to minimize repeated
  disclosure. A public shared page must not request this route.
- Expanded maps remain inside Reaigen. Do not provide an external Google Maps
  deep link that could expose the address through a third-party URL or browser
  history.

## Stable async layout

- Shell navigation and the page-level back action render before property data
  resolves. The title occupies a fixed skeleton slot until its value is known.
- The desktop property action rail has a stable loading placeholder with the
  same outer geometry as the resolved action rail.
- Tour availability is resolved before choosing the primary action. The Edit
  action must not briefly become the dark primary button and then move when a
  tour is discovered.
- Loading states must not add or remove borders, padding, or height in a way
  that shifts neighbouring content.
- Motion-reduction preferences disable loading animation while preserving the
  placeholder geometry.

## Desktop creation and tour controls

- Desktop Create exposes concept and virtual-tour workflows. New spatial
  capture is an iPhone/iPad workflow and is not offered as a desktop action.
- The tour back control, playback toolbar, and camera editor use one translucent
  dark material: the same border opacity, surface opacity, shadow, and blur.
- The back control and camera toolbar share the same 56 px outside height,
  safe-area top baseline, and symmetric desktop edge inset. Opening,
  previewing, or collapsing camera editing must not move either control.

## Release verification

Before committing or deploying these surfaces:

1. Run lint, type checking, validation tests, and a production build.
2. Confirm an unauthenticated request to `/api/maps/static` is rejected.
3. Confirm the local app responds on the fast-feedback server at port 3056.
4. Test an authenticated property and a public shared link at desktop and phone
   widths. Verify that the public page source contains no exact location data.
5. Do not deploy to Vercel until the user explicitly approves deployment.
