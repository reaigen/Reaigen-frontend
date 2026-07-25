# Reaigen design language

This document is the visual source of truth for the production Reaigen web frontend. It captures the
direction established by the responsive UI polish pass and turns it into repeatable decisions for new
pages and components.

This is a working baseline, not a frozen theme. New work may improve it, but should not casually
reintroduce patterns that were deliberately removed.

## Design thesis

Reaigen is **quiet editorial utility around emotional property media**.

The interface should feel precise, mature, calm, and tactile. The management shell stays cool-white,
neutral, and low-noise so photography, video, floor plans, and 3D tours can provide the atmosphere.
Emotion comes from the work being presented, not from colorful dashboard decoration.

Five principles govern every surface:

1. **Media carries the emotion.** Give the best available property image visual priority.
2. **Subtract chrome.** Add a container, label, statistic, or divider only when it improves orientation
   or action.
3. **Round by role.** Actions are capsules, icon actions are circles, fields and structural surfaces
   have their own softer rectangular geometry.
4. **Use contrast deliberately.** Black establishes hierarchy, true white establishes surface, and
   cool greys establish separation. Avoid washed-out sameness.
5. **Adapt instead of shrinking.** Mobile, tablet, and desktop share a language but use different
   compositions.

## Reference synthesis

Reaigen is not a copy of one product. Each reference has a narrow responsibility:

- **X:** management architecture, persistent navigation, content-first streams, hairline separators,
  direct interaction, and strong black/white hierarchy.
- **ReaUI:** component proportions, coherent control sizing, restrained surfaces, accessible states,
  and a shared grammar across routes.
- **Instagram:** image-first portfolio rhythm, confident crops, compact metadata, and mobile media
  browsing that feels natural rather than administrative.
- **Runway:** canvas-first creative workspaces, contextual tools, visible output history, and darker
  studio materials that keep media dominant.
- **Krea:** a low-friction Agent entry point, compact prompt surfaces, and contextual controls that do
  not become another dashboard.
- **Early Reaigen UI studies:** the editorial property cards, useful search treatment, real-estate
  facts, portfolio state, and the strongest image-led compositions.

RunPod is not a visual or product reference for this frontend.

Reference boundaries matter. Runway does not make the management portal dark. Instagram does not
introduce social metrics or decorative gradients. Krea does not justify floating every control.
X does not require the product to become stark or emotionally empty.

## Brand expression

- Use the complete **Reaigen** wordmark whenever the available width supports it.
- The compact desktop rail may use the small unboxed **Re** wordmark. Never use a giant letter `R`,
  a boxed app tile, or a substitute badge as the primary brand.
- The brand wordmark is the only regular serif expression. Product UI, headings, labels, and data use
  the system sans-serif stack.
- Agent uses the unboxed monochrome wand/sparkle mark. Never place it in a blue tile and never assign
  it a separate blue sub-brand.
- Avatars use real profile imagery where available. Initials are a fallback, not a decorative logo.

## Color and white balance

The management UI uses true-white surfaces over a very light cool-grey canvas. Its white balance is
neutral; if a tint is perceptible, it must lean cool rather than warm.

| Role | Token | Current value | Use |
|---|---|---:|---|
| Canvas | `--background` | `220 12% 97%` | Page background and quiet workspace areas |
| Primary surface | `--card`, `--surface` | `0 0% 100%` | Cards, menus, panels, and raised controls |
| Primary text/action | `--foreground`, `--primary` | `0 0% 9%` | Headlines, active navigation, primary buttons |
| Muted surface | `--muted`, `--secondary` | `220 10% 93%` | Inactive controls and grouped regions |
| Subtle surface | `--surface-subtle` | `220 10% 94%` | Quiet rows and secondary information |
| Border | `--border` | `220 8% 84%` | Surface separation and field outlines |
| Input border | `--input` | `220 8% 82%` | Form control definition |

Color rules:

- Do not introduce cream, ivory, beige, warm grey, or yellow-white surfaces.
- Do not use a blue accent as generic evidence of modernity or intelligence.
- Keep large areas neutral. Semantic green, amber, and red belong to small status dots, concise
  feedback, and warnings.
- Never communicate state through color alone; pair it with text, shape, or an icon.
- In the studio, translucent black and white controls are allowed because they sit over media. They
  must remain readable against both bright and dark imagery.

## Contrast and depth

The UI should not be flat, but depth must stay restrained.

- Use background contrast first, a hairline border second, and shadow third.
- White is an elevation layer, not the background of every region.
- Cards use `shadow-card`; compact controls may use `shadow-control`; menus and major floating panels
  may use `shadow-elevated`.
- Avoid stacking border, large shadow, tinted fill, and glass on the same ordinary control.
- Hover elevation is subtle: a small border change, light shadow increase, and no more than a
  half-pixel visual lift.
- Glass is reserved for controls directly over photography or the 3D canvas. It is not a default
  material for navigation, settings, or forms.

## Shape system

Roundness is intentional and hierarchical.

| Element | Geometry | Notes |
|---|---|---|
| Text/action button | Full capsule | The default button language at every size |
| Icon-only action | Circle | Equal width and height; always has an accessible name |
| Search field | Full capsule on mobile | May become a quiet divider-based toolbar on wider screens |
| Segmented control | Capsule containing capsule segments | Active segment is dark; inactive segments stay quiet |
| Status/metadata chip | Capsule | Compact, never a substitute for a button |
| Input, select, textarea | `rounded-xl` | Soft rectangle preserves the visual meaning of a field |
| Collection card | 24px mobile, 20px wider screens | Mobile is intentionally rounder and more tactile |
| Panel/form section | 16–20px | Depends on scale and nesting |
| Navigation tile or row | Soft rectangle | Structural targets must not be stretched into pills |
| Thumbnail | 8–12px | The image crop remains dominant |

Do not make every object a capsule. Cards, fields, navigation tiles, expandable rows, and media
thumbnails need distinct silhouettes so users can recognize their roles quickly.

## Typography

- UI font: the native system stack defined by `--font-primary`.
- Brand font: the serif wordmark treatment only.
- Headings use strong weight, tight `-0.02em` tracking, and compact line height.
- Body copy is neutral and readable, generally 13–15px in dense management surfaces.
- Labels are 11–13px with medium or semibold weight. Use uppercase and wide tracking only for a short
  eyebrow, never for paragraphs or navigation.
- Numbers use tabular figures when values update or align in columns.
- Muted copy must remain readable. Prefer hierarchy through size and placement before reducing
  opacity further.
- Do not mix several decorative typefaces to manufacture personality. Photography and composition
  provide character.

## Icons

- Use the shared Radix-derived Reaigen icon vocabulary in `app/components/icons.tsx`.
- Default strokes are quiet but legible. Active navigation may increase stroke weight slightly.
- Typical sizes are 16px inside controls, 20–22px in primary navigation, and 24px only when the icon
  is the main empty-state cue.
- Pair consequential or unfamiliar actions with text. Familiar secondary actions may be icon-only.
- Never use emoji, mismatched icon families, arbitrary filled icons, or blue Agent symbols.
- Icon containers follow the shape system: action equals circle; informational tile may be a soft
  rectangle.

## Buttons and controls

The shared `Button` component is the default implementation.

- Primary: black capsule, white label, minimal shadow.
- Secondary: cool-grey capsule with dark label.
- Outline: white capsule with a clear cool-grey border.
- Ghost: no resting container; a subtle capsule appears on hover/focus.
- Destructive and success colors are reserved for actions whose meaning requires them.
- Disabled controls remain legible and visibly unavailable; loading controls keep their width.
- Keep at least a 44px touch target on mobile. Compact 28–36px visible controls are acceptable on
  desktop only when the surrounding target remains unambiguous.
- Focus rings must remain visible against both the canvas and white surfaces.

Fields remain rounded rectangles rather than pills, except search. This makes entering data feel
different from triggering an action.

## Value editing and units

Editing should feel closer to the iOS app than to an administrative form: the value stays directly
editable while compact capsule controls expose its unit or currency.

- Unit choices, codes, symbols, names, formatting metadata, and `conversion_to_base` factors come
  only from Django's `/api/v1/lookups/units/` catalogue. The client must consume every paginated
  result; it does not maintain a parallel measurement table.
- Draft `area_unit` and `lot_size_unit` values are backend unit IDs. Resolve them through the
  catalogue for display and send the selected catalogue ID back when saving.
- Changing an area or lot unit converts the current number and its related advanced values using
  the backend-provided factors. Mixed-unit expressions use the same runtime catalogue.
- Currency choices come from the catalogue, but exchange conversion requires the separate real
  exchange-rate source and is never guessed from unit metadata.
- Expression syntax never invents unit aliases or numeric multipliers. A suffix is valid only when
  it resolves to an active backend lookup record; fields without a backend unit remain unitless.
- Floorplan area labels begin with the backend-designated base area unit. A requested display unit
  is applied only when both units and both conversion factors resolve through the catalogue.
- If the catalogue is unavailable, preserve stored IDs and numeric values, pause unit changes and
  conversions, and withhold the unit label. Never silently assume a regional default.

## Cards and imagery

`CollectionCard` and `SearchField` are protected patterns. A system cleanup must not replace them
with generic form cards.

- Lead inventory cards with real property media whenever available.
- Use a stable crop so feeds scan cleanly; the default editorial crop is 16:10.
- Place status and sharing actions over media only when they remain readable and do not obscure the
  subject.
- Use a controlled bottom gradient when white titles sit over imagery.
- Keep card metadata compact. The image, title, location, status, and next action should be understood
  before secondary facts.
- Do not add a dashboard statistics strip when counts already exist in filters, status labels, or the
  cards themselves.
- Do not manufacture emotion with decorative illustrations, oversized colored tiles, or gradients
  when authentic listing media is available.

## Media manager

The media manager is a creative ordering surface, not a file-table utility. It follows the iOS
asset model and groups physical uploads into logical media assets so processed results remain
versions of one photograph instead of appearing as duplicate gallery items.

- Mobile leads with a three-column square grid. Selection and gallery actions stay in a persistent
  bottom action area, so choosing a cover, hiding, restoring, or moving an item never depends on a
  tiny tile menu.
- Tablet keeps the touch-first grid and adds columns only while thumbnails remain comfortably
  selectable.
- Desktop pairs the grid with a sticky selected-media preview and concise provenance. It does not
  scale a phone sheet into an oversized empty side panel.
- The gallery, hidden state, cover state, video type, selection, and version count use distinct
  monochrome icons or labels. No generic blue media tiles are used.
- Uploads appear in the grid immediately with their real queued/uploading/failed state. Feedback is
  tied to the actual presign, object-storage PUT, and Django confirmation steps; there is no simulated
  progress timer.
- Cover and ordering changes are optimistic but must reconcile with Django. Desktop supports drag
  ordering; every viewport retains labeled or accessible earlier/later controls.
- Hide is reversible and version-aware. It never maps to physical deletion. Originals and processed
  siblings remain available through the version manager, and consequential hide actions are
  confirmed in-product rather than through a native browser alert.
- Text actions are capsules, icon-only ordering actions are circles, and thumbnails remain rounded
  structural squares. The surrounding canvas stays neutral/cool white so the property media carries
  the visual temperature.

## Layout and responsive behavior

Mobile is the primary interaction baseline, not a compressed desktop fallback.

### Mobile

- Use the full wordmark in the top bar and an opaque bottom navigation with visible icon labels for
  the three core areas.
- Keep 16px page gutters unless media intentionally reaches the edge.
- Prefer one image-first card per row, rounder 24px card corners, a capsule search field, and controls
  that can be reached comfortably by touch.
- Keep page introductions short. Do not place analytics or summary furniture between the title and
  the content.
- Agent and edit workflows become focused sheets or full-height panels with safe-area padding.
- Dense settings categories use one native section picker rather than a partially visible horizontal
  strip of tabs.

### Tablet

- Recompose rather than merely scale. Use wider cards or a small grid when the media still has useful
  size.
- In landscape, bound the inline creation-detail hero to roughly 52% of usable viewport height while
  retaining its 16:10 crop. Full-viewport media belongs only to the explicit fullscreen viewer.
- Keep touch sizing and avoid dense desktop sidebars before there is enough room for them.
- Context panels may overlay the workspace, but must leave the current subject understandable and
  provide an obvious close action.

### Desktop

- Keep the 88px compact navigation rail through ordinary laptop and 1600px desktop widths. Expand to
  the 260px labeled rail only at 1728px and above.
- Center reading-width content while allowing media grids and studio canvases to expand.
- Search may change from a floating capsule into a slim toolbar with a bottom divider.
- Contextual filters can move into a quiet left column. Do not repeat the same filters above the grid.
- From 768–1439px, Agent uses a 400px modeless right drawer. It does not resize, dim, or lock the
  visible workspace. From 1440px, Agent owns a 360–400px right layout column and reflows the active
  creation. Composition follows usable width rather than pointer type, because touchscreen laptops
  and remote browsers can report a coarse pointer at desktop widths.

## Tours and studio mode

Tour inventory and the tour studio are different surfaces.

- Mobile tour inventory behaves like a visual feed: single-column, image-led, generous touch targets.
- Tablet may use a compact grid with controls above it.
- Desktop may use a filter rail plus a denser media inventory.
- The tour studio is canvas-first and dark. Management chrome recedes once the user enters it.
- Camera preview and edit states use one coherent translucent dark material.
- The active camera remains visible while editing. Look-through controls apply the saved camera and
  its field of view.
- Do not place a light management card and an unrelated opaque black pill in the same camera control.

## Agent

- Agent is a contextual creative workspace, not a blue chatbot widget.
- The launcher is a neutral capsule with the monochrome wand/sparkle mark and the label `Agent`.
- Empty states should invite a useful first action and avoid a large blank waiting simulator.
- Conversation, media history, and revision history share one visual system.
- User requests do not mutate data until a grounded proposal is reviewed and confirmed.
- On mobile Agent is focused and touch-first; on wide desktop it may remain alongside the active work.

## Motion

- Standard transitions are about 200–220ms using the shared smooth easing.
- Route/content reveal may use one short fade or fade-up. Do not stack entrance animations on the
  shell, page, section, and every card.
- Hover movement stays subtle enough that image grids do not feel unstable.
- Loading indicators show real progress or activity; they must not trap the user in an indefinite
  branded waiting screen.
- Respect `prefers-reduced-motion` for every non-essential transition.

## Accessibility and interaction

- Maintain WCAG-readable contrast for text and controls.
- Every icon-only action has an accessible name.
- Keyboard focus is visible and consistent.
- Status uses text plus a dot/shape, not color alone.
- Sheets and dialogs trap focus, close with Escape, restore focus, and protect unsaved work.
- Mobile controls respect safe areas and keep critical actions clear of browser and system chrome.
- Loading, empty, filtered-empty, error, and unavailable states are distinct and provide the narrowest
  useful next action.

## What to subtract

Before adding a new UI element, check whether it repeats something already visible.

Avoid:

- dashboard statistic strips with no immediate action;
- giant brand initials or boxed `R` marks;
- blue Agent icons or generic AI gradients;
- warm/off-white canvases;
- sharp rounded-rectangle buttons when the action should be a capsule;
- flat white-on-white layouts with weak borders and no hierarchy;
- decorative glass away from media;
- duplicate search, filter, status, or navigation controls;
- native-looking controls left unstyled beside refined custom components;
- desktop layouts squeezed into a phone viewport;
- simulators that wait without making a real backend request or offering recovery.

## Component ownership

Use shared components before creating route-specific variants:

| Need | Owner |
|---|---|
| Action | `app/lib/ui/button.tsx` |
| Search | `app/components/search-field.tsx` |
| Filter/mode choice | `app/components/segmented-control.tsx` |
| Inventory surface | `app/components/collection-card.tsx` |
| Status | `app/components/status-pill.tsx` |
| Empty/error collection state | `app/components/collection-state.tsx` |
| Property fact | `app/components/property-fact-tile.tsx` |
| Operational analytics | `app/components/analytics-grid.tsx` |
| Global responsive shell | `app/components/app-shell.tsx` |

If a route needs to override one of these, first decide whether the shared component is missing a
real product variant. Prefer improving the owner over accumulating local class strings.

## Review test

Before merging a visual change, ask:

1. Is the property, tour, or task still the focal point?
2. Is this element new information or duplicated dashboard furniture?
3. Does its shape communicate its role?
4. Is the white balance neutral or cool?
5. Are active, inactive, hover, focus, loading, empty, and error states clear?
6. Does mobile feel intentionally composed rather than reduced?
7. Does desktop use the available space without inflating controls?
8. Is Agent neutral and contextual rather than a separate blue product?
9. Does the action perform real work and recover honestly when the backend is unavailable?
10. Could one container, label, statistic, or effect be removed without losing meaning?

If the answer to the last question is yes, subtract it.
