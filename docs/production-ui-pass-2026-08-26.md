# Production UI pass — 26 August 2026

## Scope

This pass matures the authenticated Reaigen frontend and its public shared-content
surfaces as one visual system. It aligns the desktop experience with the iOS app
without copying mobile navigation patterns that do not scale on larger screens.

The production application is deployed to **reagen.io**. **reagen.com is a separate
landing-page property and must not be changed or aliased by this deployment.**

## Visual system decisions

- Use restrained glossy and translucent materials for navigation, panels, segmented
  controls, and secondary actions. Solid black is reserved for the primary action or
  the circular Agent launcher.
- Preserve Reaigen's rounded capsule language. Controls use true pill geometry,
  consistent internal padding, a quiet border, and one visual elevation layer.
- Keep the Agent launcher as an unlabeled black circle at the lower-right edge.
- Use one fixed header baseline and one desktop rail edge. Header, rail, content, and
  docked Agent panel share the same safe-area and border coordinates.
- Avoid cards nested inside visually identical cards. Group related controls with
  spacing, dividers, or a tonal surface before adding another border.
- Empty states must read as intentional actions, not loading skeletons.
- Destructive actions use the muted Reaigen destructive palette, never browser-red or
  an unrelated saturated red.

## Navigation and settings

- Desktop navigation remains a compact scalable rail because more product areas will
  be added. Active destinations use a glossy icon capsule rather than a large black
  navigation block.
- Mobile navigation provides Concepts, Tours, and Settings in the bottom safe area.
- Settings use a white/glass navigation surface, a visible active state, aligned
  content cards, and responsive layouts that do not require horizontal scrolling.
- Field controls, units, selectors, counters, and parameter icons use the same capsule
  and icon system as the concept editor.

## Concept detail and editing

- The detail page has a clear information hierarchy: identity and status, actions,
  media, description/details, virtual tours, and supporting assets.
- Property parameters render as icon-led fact tiles rather than a low-contrast table.
- Description text renders stored Markdown as real bold, italic, paragraph, and list
  formatting. Formatting markers such as `**` are never shown to users.
- The manual description experience is a desktop rich-text editor with bold, italic,
  list, spell-check, keyboard shortcuts, save/discard handling, and a direct entry
  point from the description section.
- Description history is reached through Versions. Agent-assisted editing stays in
  the separate Agent workspace instead of covering the manual editor.
- Numeric fields use a stable inline calculation strip. Opening the operator strip
  must not resize or shift surrounding cards.

## Media, galleries, and video

- Media thumbnails appear in place; they do not slide in horizontally while loading.
- Selected-media actions use a compact responsive toolbar instead of a large inspector
  card or an overcrowded single row.
- Upload targets are clear glass drop zones with one centered action and stable bounds.
- Gallery lightboxes use a safe-area-aware top capsule containing close, position, and
  grid controls. The rail stays within the viewport for portrait and landscape media.
- Duplicate counters and duplicate gallery buttons are removed.
- Video uses the Reaigen player, not native browser controls. Playback controls are
  low-profile, responsive, and overlay the media without introducing a second heavy
  capsule. Media uses contain behavior so resizing never crops the video.
- Generated video remains a separate Video view and is not inserted beneath the photo
  collage as if it were another gallery image.

## Panels, sharing, and public delivery

- Side panels use one consistent header: back for a nested workflow, close for a
  dismissible overlay, and the primary action on the opposite edge. No isolated X is
  placed directly on top of content.
- Sharing uses a lighter glossy selection system with enough selected-state contrast
  and without large black sections.
- Existing links, access controls, expiry, analytics, and destructive link management
  are visually separated into clear sections.
- Shared property pages use Reaigen typography, logo treatment, image collage, custom
  player, formatted description, parameter icons, mobile-safe spacing, and a branded
  attribution capsule.
- Expired, denied, and invalid links use the same public theme rather than a generic
  error page.
- Floorplan lightboxes use a bounded glass frame and explicit safe areas. The plan is
  centered at a useful scale with its room summary attached to the viewer.

## Responsive contract

- The authenticated shell, settings, detail cards, editor panels, galleries, and
  shared pages must remain usable at narrow desktop split widths as well as phones.
- Safe areas are applied at the top, bottom, and horizontal edges of fullscreen and
  fixed UI.
- Text and action rows wrap before they truncate essential content or collapse fields
  into one-character columns.
- Hover and active states must not change card dimensions or add a second competing
  outline.

## Local and production verification

- Fast-feedback frontend server: `http://0.0.0.0:3056`
- The local server uses the production backend origin configured for this workspace.
- Required checks before deployment: TypeScript, ESLint, repository validation tests,
  production build, and `git diff --check`.
- Deploy the linked Vercel project `reaigen-frontend` to production, verify
  `https://reagen.io`, and confirm that no `reagen.com` alias is created or changed.

