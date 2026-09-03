# Floorplan workspace pass — 1–2 September 2026

## Scope

This pass took the floorplan editor from a canvas overlay to a full routed
workspace with a palette, an inspector, DCC-grade tooling, and rigid-body
collision everywhere, and unified room-label placement across every surface.
It also landed the AI description editor, in-place draft panels, and a set of
auth/navigation/loading fixes. Shipped as commits `b21d6fa..9387cac` on `main`.

## Shipped

### Platform and navigation

- `b21d6fa` — `randomUUID()` fallback via `crypto.getRandomValues` in
  `app/lib/uuid.ts`. The LAN dev origin (`http://100.115.47.42:3056`) is an
  insecure context where `crypto.randomUUID` does not exist; all five call
  sites now share the safe helper.
- `43353c5` — auth screen submit is never a grey dead button, capsule
  rounding on inputs, white loading surfaces (no black flashes), tour
  back-arrow returns to the tours list instead of the detail page, resize no
  longer reveals a white body background.
- `4b47767` — Edit, Sharing, and Versions open **in place** with slide
  transitions instead of triggering a route-level skeleton. Root cause: every
  `next/dynamic` import without a `loading` option suspends to the route
  fallback; all ten dynamic imports on the draft page now pass
  `{ loading: () => null }` and warm their chunks via `requestIdleCallback`.
  Version manager restyled to the theme. Gallery cards are pure photographs
  again; the cover-photo affordance is a text pill (no star, no flag icon).

### AI description editor

- `3daf310` — mirrors the iOS AI writing flow: keywords, size
  (short/standard/long), tone (fluent/descriptive/luxurious/selly/poet),
  custom instructions, bold toggle. `POST
  /api/reaigen/drafts/{id}/generate-description/` → poll `getDraftService`
  every 1.5 s (max 240 polls); result read from
  `output_data.result.description ?? output_data.description`; defaults from
  `GET /api/reaigen/creation-settings/me/`. Generation renders a skeleton
  overlay with cycling status lines and a restore-previous action. The
  contentEditable is seeded via `dangerouslySetInnerHTML` state so the
  mounted DOM always equals the seed (kills innerHTML timing bugs). The
  calculator input got an animated operator row with geometrically centred
  SVG glyphs.

### Floorplan editor workspace

- `8324884` — the big one:
  - **Routed editor** at `/draft/[id]/floorplan` (auth guard, mobile
    redirect, unit lookups, `AppShell` with the agent suppressed). The
    detail page links to it; no more overlay state.
  - **Left palette / right inspector** per the concept mockups: pictorial
    SVG glyphs (wall, door, sliding door, window, room), a combined
    2×2 door-opening picker (hinge side × swing direction) that writes the
    iOS `door_N_camera` contract, exact-value width/length/thickness fields,
    wall style (solid/outline) and plan-level wall thickness persisted as
    `floorplan_wall_thickness_mm` / `floorplan_wall_style`.
  - **Strict tool split** (Maya/Blender convention): select selects, only
    the move tool moves. Selection rings, corner handles, and gap labels
    with nearest-neighbour dimensions.
  - **Rigid-body collision everywhere**: furniture cannot pass through
    walls, rotation de-penetrates (MTV, ≤12 iterations), doors/windows
    slide on their host wall with the 1-D `solveWallSlide` solver —
    neighbouring openings shrink to a minimum then clamp rigidly; moving a
    wall pushes room label markers ahead of it.
  - **Rooms**: one-shot room tool with auto-select, rename, room-type
    picklist with translations, deletion via tombstones plus
    `deleteDraftDataEntry` fallback.
  - **Units**: every displayed dimension resolves through the backend unit
    lookups (`listUnits()` / `resolveUnit` / `convertUnitValue`), imperial
    detection included; scale ruler adapts its increment.
  - **Field-resilient persistence**: each draft-data key saves
    independently; failures are retained, merged into the next attempt, and
    a retry chip flushes them — a failed save is a pending save.
  - **Frames**: markers persist in the raw scan frame via
    `rotateFromSnappedFrame`, load via `rotateToSnappedFrame` — no
    double-rotation drift between editor, viewer, and reload.
  - Standards research applied (ISO 7519, IFC/IfcDoorTypeOperationEnum,
    CubiCasa5K symbol vocabulary): pictogram-first controls, type-exact
    values, closed symbol set.

### One room-label placement

- `0822ff0` — an authored marker is the room's single placement, exactly as
  furniture is placed once. `resolveLabelWorldPositions` is marker-first,
  and the viewer's two extra passes (polygon re-assignment, screen-space
  badge collision nudging) are bypassed for rooms with an authored marker.
  Editor, detail preview, and lightbox now agree to four decimal places
  (verified u=0.1303, v=0.2067 on both surfaces against the wall bbox).

### Navigation drift fix + DCC shortcuts

- `9387cac` — the actual source of "floating" labels: the wheel handler
  computed the anchored-zoom pan inside a nested state updater. React
  double-invokes updaters in dev, the pan applied twice, the zoom lost its
  cursor anchor — middle-mouse pan + wheel zoom jumped on the next pointer
  move, and a label dragged during a zoom teleported and **persisted** the
  garbage offset. All view changes now flow through one pure `applyView`
  (synchronous view ref, plain-value state sets). A live pan gesture is
  rebased after each wheel zoom; a second mouse button can neither hijack
  nor end a gesture it does not own; one-shot tools cannot fire from a
  phantom release.
  - **F** frames the selection, or the whole plan with nothing selected;
    the toolbar fit button now fits content instead of resetting.
  - **H** hides the selected door/window/furniture for the session
    (rendering, hit-testing, and collision all skip it; data and saves are
    untouched). **Shift+H** or the "Show hidden (n)" toolbar chip restores.

## Verification

Every interactive claim was verified in a real browser: temporary
`app/dev/*` harness pages mounting the component with a known fixture,
driven by Playwright with route-stubbed APIs capturing persisted payloads
(12/12 on the final navigation pass; placement parity measured numerically).
Harnesses are deleted after each run and never ship. Static suites
(`scripts/validate-floorplan-*`, `validate-panel-geometry`) stay green —
54 passes — plus `tsc --noEmit` and ESLint.

## Data-contract extensions (web-side; iOS not yet reading them)

- `objectRotationOverrides` inside `floorplan_furniture_edits_json`
- `floorplan_wall_thickness_mm`, `floorplan_wall_style`

## Known caveat

Markers and label offsets persisted **before** these fixes may hold stale
values (pre-`rotateFromSnappedFrame` frame, or a drift-era offset). One
corrective drag with the move tool heals the entry; there is no reliable
way to detect and auto-heal old garbage.

## Follow-up — 3 September 2026

- **F framing animates** as a 240 ms dolly (world centre lerped, zoom
  interpolated geometrically); wheel or pointer input cancels the flight.
  Honours `prefers-reduced-motion`.
- **Delete/Backspace removes the selection** (door, window, furniture,
  room) through the same actions as the inspector's remove buttons, so
  undo and persistence behave identically. Ignored while typing in a
  field.
- **Navigation render cost**: the plan subtree inside the pan/zoom
  transform group is memoised (`planContent`); a pan frame now updates a
  single SVG attribute instead of re-rendering ~380 lines of geometry
  JSX. Wall/cut quads are also memoised against plan changes.
- Move tool shows the `move` cursor.

## Follow-up 2 — interaction physics fixes (3 September 2026)

- **Chaired tables move freely.** Family membership now follows `parentId`
  for every category — a chair tucked under its table rides along instead
  of acting as a blocker overlapping its own parent, which had deflected
  every table drag sideways ("move vertically → snapped to horizontal").
  Dragging the chair alone pulls it away without moving the table; the
  stove/sink category gate now governs only the mounted child-slide.
  Regression-tested against the real draft-11949 captured fixture.
- **Doors keep their width when pushed.** `solveWallSlide` is kind-aware: a
  pressed window still shrinks first (its approved behaviour), but a
  pressed door translates rigidly at full width and wall-end overflow
  clamps the drag — no more doors collapsing into 0.2 m slivers between
  windows. A driven door also never shrinks when both wall ends overflow.
- Verified in-browser across five fixtures (16/16): door-into-window
  pushes, pre-overlapped openings escaping and resolving, tee-junction
  clamping, flush-corner windows pushing doors, and chained pushes
  shrinking windows while doors keep width.

## Backlog

Floorplan editor:

- Double, French, and pocket doors — needs an iOS `door_N_camera` contract
  extension first.
- Type-while-dragging: live numeric entry committing during a move gesture.
- Editable dimension strings on the canvas (click a measurement, type a new
  value, choose which wall moves).
- Marketing vs. technical render styles (graded simplification per ISO 7519).
- Room templates and trace-over-a-photo drawing mode.
- Unhide UX for single elements (currently Shift+H restores everything).

Cross-platform:

- iOS support for `objectRotationOverrides` and
  `floorplan_wall_thickness_mm` / `floorplan_wall_style`.
- Auto-heal pass for stale marker/offset entries once a detection heuristic
  exists.

Description editor:

- Streaming generation display instead of skeleton-and-poll, if the backend
  gains a streaming endpoint.
