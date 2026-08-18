# Reaigen interface ecosystem contract

This document keeps the web, iOS, and visionOS products recognisably related
without making them identical. It is based on the current web UI, iOS commit
`1c73946`, and visionOS commit `7239c64`.

## Shared visual grammar

- Reaigen is image-led. Property media gets the largest uninterrupted area;
  controls sit around it or on a restrained scrim, never as decorative clutter.
- The canvas is quiet and light. Elevated surfaces use translucent white or a
  very subtle warm wash, a fine dark hairline, and one soft shadow.
- A surface has one visible edge. Do not stack an outer stroke, inner highlight,
  and another bordered child merely to make it look more "glass".
- Continuous corners follow a small hierarchy rather than per-screen guesses:
  approximately 30 px for cards/panels, 20 px for rows, 18 px for controls,
  and 14–15 px for icon tiles. Capsules are reserved for status, segmented
  choices, and short actions.
- Interactive targets are at least 44 by 44 px. Their visible artwork may stay
  smaller when the interface needs to remain compact.
- Black identifies the current selection or the single primary action. Secondary
  actions remain light; destructive actions should not compete visually until
  they are relevant.
- Typography is compact and whole-numbered. One card does not mix arbitrary
  label scales; eyebrow text, title, metadata, and body copy each have one role.
- Empty and loading states are calm. Loading uses the Reaigen wordmark and a
  thin progress rail without a visible generic "Loading" label. Technical
  processing terms stay out of customer-facing UI.

## Platform responsibilities

### Web

The authoring workspace. It can show denser controls, side panels, comparison
states, history, editing, and delivery management. Large screens use their width
for a readable content column plus a stable inspector, not wider text or more
decorative chrome. The left navigation remains stable and does not auto-collapse.

### iOS

The capture and mobile-management surface. It uses full-width content on iPhone,
centred readable columns on iPad, native sheets, 44 pt controls, and compact
single-column task flows. Its 30/20/18/14 radius ladder is the baseline for
touch-oriented web layouts.

### visionOS

The focused presentation surface. It uses warm milk-glass windows, equal property
cards, small immersive controls, and one clear action per stage. Its spatial
window radii and amber glass strength are platform-specific and must not be
copied literally to the web canvas.

## Web review rules

1. Preserve the established two-card dashboard grid and image mosaic character.
2. Keep segmented controls as rounded glass tracks with a black active segment.
3. Keep side-panel shell, header, close/back placement, and scrolling behaviour
   consistent; vary only the task content and necessary width.
4. Prefer one primary action plus grouped secondary actions. Do not create two
   visually equal buttons for actions with different importance.
5. Use invisible hit-area expansion before making compact controls visibly heavy.
6. Check wide and mobile screenshots together. A correction is not complete if
   it only improves one breakpoint.
7. Every iteration runs the full-product audit for accessibility, 44 px targets,
   overflow, runtime errors, and dialog focus containment.
