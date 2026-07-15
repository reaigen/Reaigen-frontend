# Reaigen portal product and UX system

This document is the working contract for the production Reaigen web portal. It describes what
each surface owns, how creation, tour, version, and share states connect, and what the UI must never
imply unless Django can enforce it.

## Product model

Reaigen starts in the capture app. The web portal is the review, refinement, presentation, and
distribution workspace for that captured content.

```
Capture in app
    → Creation (listing facts and media)
        → Tour versions (processed spatial assets)
            → Live tour pin
                → Controlled client links
```

The portal uses two deliberate visual modes:

- **Management mode** is light, quiet, and image-led. Creations, Tours, Shares, Settings, and draft
  detail use a neutral near-white canvas, white surfaces, restrained borders, and a single dark
  primary action. Semantic colour is reserved for small status indicators, not large tinted fills.
- **Studio mode** is cinematic. The 3D viewer is dark so the spatial content remains primary; its
  camera controls use one compact translucent material.

Do not mix these modes inside one control surface. In particular, camera preview and edit controls
must never alternate between an opaque black pill and a light panel.

## Information architecture

| Surface | Route | Primary job | Primary action |
|---|---|---|---|
| Creations | `/dashboard` | Review captured properties and listing readiness | Open a creation |
| Creation detail | `/draft/[id]` | Inspect and refine one listing, its media, and publishing state | Edit / view tour |
| Tours | `/tours` | See spatial assets independently from listing readiness | Open a ready tour |
| Tour studio | `/tour/[id]` | Review the 3D experience and manage saved cameras | Save cameras |
| Shares | `/shares` | Monitor every controlled link and its access | Create link |
| Share composer | `/draft/[id]/sharing` | Define exactly what recipients see and how access is protected | Create and copy link |
| Settings | `/settings` | Manage account, public profile, Agent, locale, notifications, billing, and security | Save the active section |
| Public presentation | `/shared/[token]` | Deliver the recipient experience | Enter / navigate |

Desktop navigation is persistent and compact. Mobile navigation contains only Creations, Tours,
and Shares; Settings remains reachable from the account control. Draft detail provides its own
mobile action bar so Edit, Share, and View Tour stay available without duplicating the global nav.
The workspace chrome must not repeat the current page title: route identity belongs to the page
header, while global chrome owns navigation, account, and Agent access.

## Creation detail contract

The creation page is the source of truth for the owner-facing listing preview.

- The active tour must be visible in the status row and available from the top action group.
- Edit opens an accessible, focus-trapped side panel. It persists through the ownership-checked
  Django `PATCH /drafts/{id}/` endpoint.
- Manual editing has Basic and Advanced modes. Basic owns the few high-frequency facts; Advanced is
  a data-driven mirror of the iOS `PropertyFieldRegistry`, filtered by property and offer type and
  persisted through canonical `specs` sections. Core facts are never repeated in both modes.
- Owner-only street address is marked private. Public screens use `display_address`, never the
  private `address` value.
- Leaving an editor with unsaved changes requires an explicit discard decision.
- Loading, missing, and failed requests have distinct states and a retry or safe back action.
- The page does not invent placeholder facts. Empty sections disappear rather than showing rows of
  dashes.

Direct draft edits update the current listing and Django activity log. They do **not** fabricate a
restorable Agent revision. Restorable listing and media histories are shown only when the backend
reports Agent consent and returns those version records.

## Media presentation contract

- Inventory-card thumbnails use a stable crop ratio so lists remain scannable.
- Creation and public-share galleries preserve every source aspect ratio inside a stable dark
  presentation frame; portrait, landscape, square, and panoramic media must not be silently cut.
- Owner and recipient views use the same gallery implementation: one carousel, one thumbnail rail,
  one counter, and one fullscreen viewer. A second grid must not repeat the same photos.
- Fullscreen supports swipe/scroll snapping, keyboard arrows, Home/End, Escape, native browser
  fullscreen, and a clear close action. The active image remains synchronized with Agent media tools.
- Video remains in its native 16:9 player unless source metadata provides a deliberate alternative.

## Version manager contract

The version manager separates three different streams because they have different guarantees.

### Tour versions

Tour versions are always available when multiple spatial outputs exist. One parent splat is the
live pin for the creation. Changing it requires confirmation because the live tour is consumed by
the owner page, mobile app, and existing public links. “Use newest” returns selection to the backend
policy; choosing a specific scan pins that scan.

Only completed, renderable outputs can become live. Processing and failed scans remain visible with
honest status, but never expose a non-working View Tour action.

### Listing history

Listing revisions are loaded from the Agent history endpoint after Agent consent. The UI presents a
newest-first timeline, marks the current version, and confirms restore. Restoring must keep the
replaced state recoverable on the backend.

### Media history

Media versions are grouped by logical asset. The UI distinguishes original/current/hidden versions
and confirms promote, hide, and restore operations. Media history is also Agent-consent dependent.

If Agent is unavailable, the listing and media tabs explain the requirement and link directly to
the Agent settings section. Tour versioning remains usable.

## Share manager contract

Shares are controlled distribution objects, not generic social-share buttons.

- `/shares` is a global inventory with live/paused/view totals, search, status filters, copy,
  analytics, pause/resume, edit, and irreversible revoke confirmation.
- Create Link opens a creation picker. Selection always continues to the full composer; it never
  creates an unrestricted link as a side effect.
- The composer keeps recipient preview and controls visible together on desktop. The preview must
  update with content scope and field permission choices.
- Link protection supports public-link or PIN access, lifetime, and optional view limits as allowed
  by Django.
- Copy feedback is explicit and temporary. Failed mutations remain visible as errors; they are not
  silently swallowed.
- Paused and expired links remain in history. Revocation is visually and behaviorally distinct from
  pause.

Public links are token routes and remain non-indexable. The browser stores successful PIN proof only
for the current tab session.

## Agent contract

Agent is an optional, consented workspace—not hidden authorization and not a replacement for normal
editing.

- The launcher appears only when Django reports consent.
- On desktop, the panel owns a right layout column instead of covering the active creation.
- Every proposed mutation has a review UI and explicit confirmation. Conversation text alone does
  not change data.
- Destructive share actions show scope and count before confirmation.
- Small UIs—field diffs, media choices, permission switches, link inventories, and history rows—must
  be grounded in typed backend data. Internal enum keys are localized before display.
- The current draft and selected upload are passed explicitly; Agent must not infer an asset from
  screen pixels or URL shape.

The detailed Agent interaction contract lives in `docs/agent-workspace-ui.md`.

## Visual and interaction rules

- Prioritize one dominant image or task per viewport. Controls support that focal point instead of
  competing with it.
- Use persistent labels for consequential actions. Icon-only buttons require accessible names and
  are reserved for familiar secondary actions.
- Status uses text plus shape/dot, never color alone.
- Side panels use Radix Dialog for focus trapping, Escape handling, overlay dismissal, and restored
  focus.
- Management pages cap reading width. Asset grids can expand; forms do not.
- Desktop Settings uses a stable vertical section rail. Mobile Settings uses one explicit section
  selector rather than a clipped eight-tab strip.
- Mobile bottom navigation is opaque over imagery so labels and touch targets never lose contrast.
- Respect `prefers-reduced-motion`; animation is short, interruptible, and never required to
  understand state.

## Camera and coordinate contract

- Scene pretransform is identity; backend PLY is already Y-up.
- Camera up vector is `(0, 1, 0)`.
- Legacy cameras from the old `scaling(-1, 1, 1)` period negate X on load only.
- A saved camera stores position, forward, up, and FOV.
- Clicking a camera or its look-through control navigates to that camera and applies its saved FOV.
- The active camera remains visibly identified while editing.
- Saved order is playback order and must be preserved by the camera PATCH request.

## Data-loading and state rules

- Browser requests stay same-origin through `/api/auth/*` and `/api/reaigen/*`; tokens remain in
  HTTP-only cookies.
- Collection screens batch related data. Creations loads the splat inventory once rather than one
  by-draft request per card.
- Each primary collection distinguishes loading skeleton, request failure with retry, truly empty
  account, and empty filtered results.
- Background metadata failures may degrade a subtitle or thumbnail, but must not erase successfully
  loaded primary data.
- Mutations disable only the affected control, surface a useful failure, and refresh the narrowest
  relevant state.

## Production acceptance checklist

Before release:

1. Run `npm run check` (ESLint, TypeScript, and a standalone-compatible Next production build).
2. Exercise authenticated Creations, Tours, Creation detail, Shares, Settings, and share composer at
   desktop and mobile widths.
3. Open Edit, Version Manager, and Create Link panels; verify focus, close, scroll, and unsaved-state
   behavior.
4. Verify a saved camera navigation applies its FOV and the active camera marker follows it.
5. Verify link create/copy, PIN, pause/resume, analytics, and revoke against the Django environment.
6. Verify the selected live tour is used by the owner tour route and an existing public link.
7. Confirm no public or tokenized route is indexable and no browser request exposes Django tokens.
