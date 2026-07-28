# Reaigen portal product and UX system

This document is the working contract for the production Reaigen web portal. It describes what
each surface owns, how creation, tour, version, and share states connect, and what the UI must never
imply unless Django can enforce it.

The canonical visual rules live in [`docs/design-language.md`](design-language.md). This document
owns product behavior and information architecture; the design-language document owns color, shape,
typography, imagery, responsive composition, and component appearance.

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

### Reference hierarchy

- **X supplies the management architecture:** a light labeled navigation rail, content-first
  streams, hairline dividers, whole-item click targets, strong black/white hierarchy, and secondary
  actions that stay visually quiet.
- **ReaUI supplies the component grammar:** an 88px compact rail that expands to 260px labeled navigation
  only at 1728px and above,
  labeled compact navigation targets, 44–56px controls, capsule actions, rounded-xl fields,
  image-first collection cards, restrained surface shadows, Radix icons, and one shared proportion
  system across desktop and mobile.
- **Instagram supplies the media and portfolio rhythm:** centered content columns, photography-led
  presentation, gap-tight thumbnail grids, count-first profile statistics, bold active navigation
  without decorative containers, and complex publishing flows broken into a clear sequence.
- **Runway supplies the creative workspace:** media and canvas supremacy, compact tool rails,
  contextual side panels that preserve the active work, visible output history, and neutral dark
  layers in studio mode. It does not determine the management shell or its colour system.
- **Krea supplies the creative entry point:** a persistent floating prompt surface, optional tool
  modifiers expressed as light chips, minimal barriers before the first action, and controls that
  float over a canvas rather than compete with it in another permanent column.
- **Reaigen's early component studies supply the domain layer:** editorial property imagery,
  compact listing facts, portfolio visibility, and glass controls only when they sit directly over
  media. Their strongest patterns are promoted into ReaUI instead of becoming one-off page styles.

Runway's studio treatment does not make the management portal dark. Creations, Tours, Shares, and
Settings stay in the light X + ReaUI shell; the 3D viewer and media tools carry the darker studio
mode. Krea's floating chrome is likewise reserved for Agent and studio controls. Instagram informs
presentation structure, not social mechanics: Reaigen does not invent likes, followers, stories,
or decorative brand gradients. Runway and Krea are design references.

Reaigen has explicit exceptions to the upstream ReaUI showcase. The product uses the complete
`Reaigen` wordmark or the compact unboxed `Re` mark instead of a boxed single letter; Agent uses an
unboxed monochrome wand; the management rail stays light to preserve X's content hierarchy; and
capsules are the default action language. These are product decisions, not page-level variations.
RunPod is not a frontend design reference.

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
- On phones, Basic editing is divided into three explicit panels—Content, Facts, and Location—
  rather than one long form. The panel switcher remains visible, changing panels returns the
  editor scroll position to the top, and wider layouts show the same sections together. While a
  text field and software keyboard are active, the switchers collapse so they cannot cover the
  focused field; Save remains available in the panel header.
- Full-height phone editors track the visual viewport while the software keyboard is open. Their
  header, focused field, and applicable footer tools must remain inside the visible area.
- Description editing is a dedicated full-screen writing panel. The header action applies the
  draft, the back action protects unsaved text, and the keyboard toolbar uses a distinct keyboard
  dismissal control instead of a second ambiguous Done action.
- Text values are edited directly. Numeric fields accept direct replacement and arithmetic;
  count-like facts also provide stepper controls without hiding the editable value.
- Measurement fields display their storage unit and accept mixed compatible units in expressions.
  Results are previewed and normalized to the field's stored area or distance unit before saving.
  Options and conversion factors are read from every page of the backend unit lookup catalogue;
  the web client has no hardcoded unit conversion table. Cross-currency conversion is never
  inferred without a real exchange-rate source.
- The expression parser accepts unit suffixes only when they resolve through that catalogue. It
  provides no client-defined magnitude aliases, percentage multiplier, or regional fallback.
- Changing area or lot units converts the visible value and related canonical spec values before
  persisting the selected backend unit ID. If lookup data is unavailable, existing units remain
  untouched and conversion controls pause instead of falling back to a guessed regional unit.
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
- Creation and public-share pages use a stable 16:10 editorial crop on a white gallery surface so
  the surrounding page stays calm and predictable. Fullscreen preserves every source aspect ratio;
  portrait, landscape, square, and panoramic media must be visible there without cropping.
- On 768–1439px landscape layouts, the owner detail hero keeps that 16:10 crop but is bounded to
  roughly 52% of the usable viewport height, so listing identity and status remain visible. Only the
  explicit fullscreen viewer may consume the complete viewport.
- Owner and recipient views use the same gallery implementation: one page carousel and one
  fullscreen viewer. The thumbnail rail belongs to fullscreen, where it supports navigation; a
  second page grid or permanent dark filmstrip must not repeat the same photos.
- The viewer opens only from its explicit fullscreen control. It never opens from a general click on
  the image and never closes from an accidental click in the image margins.
- Fullscreen supports swipe/scroll snapping, keyboard arrows, Home/End, one-step Escape, a labeled
  Close action, focus containment, and focus restoration. The active image remains synchronized with
  Agent media tools.
- Video remains in its native 16:9 player unless source metadata provides a deliberate alternative.

## Version manager contract

The version manager separates three different streams because they have different guarantees.

### Tour versions

Tour captures are durable listing assets, not replacements for one mutable parent splat. An initial
capture, a post-renovation capture, an independent rescan, and an import each keep their own stable
asset UUID, exact reconstruction, delivery versions, and lineage.

The draft's **Tours & delivery** panel separates capture from publication:

- **New scan** reserves a new asset without removing the current tour.
- Web and iPhone/iPad visibility are independent switches.
- Any number of ready captures may be visible, while one visible capture is the default.
- Saving creates an immutable listing publication revision and a validated layered-USD listing
  graph.
- Updating existing share links is an explicit owner choice. When disabled, each existing link
  remains pinned to the exact publication it already exposed.
- Hiding every tour changes public visibility but keeps the owner's working capture available for
  reopening and later publication.

Only completed, renderable outputs can become live. Processing and failed scans remain visible with
honest status, but never expose a non-working View Tour action. Each tour row shows its available
thumbnail, scan provenance, completion date, target visibility, and default state before presenting
an activation action. Owner and shared viewer routes carry the selected tour ID and fail closed;
they never substitute a different capture. A public listing shows a simple selector only when more
than one Web tour is visible.

### Listing history

Listing revisions are loaded from the Agent history endpoint after Agent consent. The UI presents a
newest-first timeline, marks the current version, and confirms restore. Restoring must keep the
replaced state recoverable on the backend. Timeline entries stay compact until selected; expansion
shows field-level before/after values so restoration is an informed decision rather than a blind
rollback.

### Media history

Media versions are grouped by logical asset. The UI distinguishes original/current/hidden versions
and confirms promote, hide, and restore operations. Media is preview-first: the selected version
owns the card, sibling versions form a compact thumbnail rail, and processing operations remain
visible as provenance. Mobile uses one media card per row; wide panels may use a two-column review
grid. Media history is also Agent-consent dependent.

If Agent is unavailable, the listing and media tabs explain the requirement and link directly to
the Agent settings section. Tour versioning remains usable.

## Media manager contract

The owner media manager and media history are related but separate surfaces. The manager owns the
current gallery story: upload, selection, cover, visibility, and order. Media history owns physical
versions and provenance. Opening history from the manager must preserve this distinction rather than
nesting a second version browser inside every grid tile.

The web upload path is the production Django contract used by iOS: resolve the canonical raw-image
asset type, request a presigned upload, PUT the bytes directly to object storage, and confirm the
upload with its draft, role, and sort order. The UI reflects the actual state of those calls. Browser
photo uploads are capped below the backend multipart threshold; oversized files receive an honest
error rather than entering an unsupported pseudo-upload.

Physical uploads are grouped by `logical_asset_id`. The current non-deleted master supplies the
thumbnail and preview, while the version count indicates preserved siblings. Only current logical
assets appear on the creation detail gallery. Reordering persists 0-based `sort_order` values.
Choosing a cover moves that image to the first visible photo position.

Hiding a logical photograph is recoverable and must never call the physical-delete endpoint. The
existing confirmed media-version actions hide its retained versions; showing it restores and
promotes the selected version. If Agent image access is unavailable, upload and ordering remain
usable while hide/restore controls explain their dependency instead of pretending to succeed.

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
- Global navigation, headers, and mobile action bars use an opaque surface plus one hairline. They do
  not float inside decorative glass capsules or add shadows where a border already establishes depth.
- Respect `prefers-reduced-motion`; animation is short, interruptible, and never required to
  understand state.

### Management element contract

- Standard fields are 44px high and use `rounded-xl` geometry. Inventory search is 48px high and uses
  a full capsule on mobile; on wider management screens it may become a quiet divider-based toolbar.
  Segmented-control containers and their segments use the shared capsule geometry.
- Standard text buttons use full capsules, 200ms motion, and visible keyboard focus. Familiar
  icon-only controls are true circles. Cards, fields, navigation tiles, rows, and thumbnails retain
  their structural shapes rather than becoming pills.
- Touch layouts keep interactive targets at least 44px high even when the visible control becomes
  more compact at desktop breakpoints.
- Collection cards use a deliberately rounder 24px mobile radius and a tighter 20px radius on wider
  screens. Form sections, previews, and operational rows use the appropriate 16–20px structural
  surface. `CollectionCard` owns the shared inventory-card border, shadow, focus, hover, and reveal
  behavior. Its image-first composition and the shared search field are protected patterns and must
  not be replaced by generic form cards during a system cleanup.
- Filters and mode switches use `SegmentedControl`; they do not recreate local active-state or
  spacing rules. Radix tabs mirror the same outer and inner geometry when tab semantics are needed.
- Lifecycle state is rendered through `StatusPill`, with a text label and semantic dot. Pages do not
  build one-off status badges or duplicate a separate status dot beside the same label.
- Property facts use `PropertyFactTile` in both owner inventory cards and recipient previews so
  typography, density, units, and missing-value behavior remain aligned.
- Empty, filtered, and failed collection results use `CollectionState`; each state keeps the same
  spatial footprint and offers the narrowest useful recovery action.
- Operational analytics use `AnalyticsGrid`. Dense four-column summaries collapse to readable
  two-column rows on phones instead of shrinking labels below a useful size.
- Do not repeat summary cards when the same counts already appear in filters, statuses, or the
  collection itself. One clear filter row is preferable to a second dashboard above the content.
- Route changes animate once at the shell. Pages and cards do not stack duplicate entrance effects,
  and hover motion stays subtle enough that property imagery remains stable.
- Drawers lock the obscured page where appropriate, respect device safe areas, and keep actions
  wrapping rather than clipping on narrow screens.
- Studio controls remain a deliberate exception: camera and tour navigation use the unified dark
  translucent material defined by the camera UX contract.

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
