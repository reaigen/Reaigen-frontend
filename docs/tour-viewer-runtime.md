# Tour Viewer Runtime Contract

This note records the camera-space and delivery-performance invariants shared by
the owner tour editor and public shared viewer. Keep these rules intact when
changing `SplatViewer`, camera persistence, or shared delivery selection.

## Camera coordinate spaces

- Reconstruction geometry, cameras, trajectories, and RoomKit geometry are
  stored in canonical right-handed, Y-up metres.
- `scene_description.rootTransform` moves the complete canonical scene into
  presentation/world space. It can be non-identity.
- A saved camera is one basis: `position`, `forward`, and reference `up`. Apply
  the root transform to all three exactly once before viewing it.
- Editing and the initial placement recall a saved camera as one exact cut of
  position, basis, and FOV. Switching angles in preview and delivery flies
  along a centripetal Catmull-Rom spline through the poses and lands on the
  exact authored basis and FOV (`savedCameraNavigationIsInstant`,
  `densifySavedCameraPath`); the WebGPU backend renders the journey at full
  projection, so the old "never fly" rule no longer applies.
- `getCurrentCamera()` performs the inverse conversion before persistence.
- Horizon stabilization may only compare up vectors in the same coordinate
  space. Comparing canonical up with presentation up can select the opposite
  hemisphere and produce a 180-degree roll.
- Delivery bounds are canonical too. Convert the presentation-space camera
  through the inverse root before clamping, then transform the accepted point
  back once; never compare a world camera directly with canonical footprint,
  floor, or ceiling values.
- The Gaussian mesh is never mirrored independently of its cameras.

The Dr Johnson regression fixed on 2026-08-03 exposed this invariant: its
canonical camera up is mostly horizontal, while its root quaternion maps that
vector to presentation `+Y`. Initial placement now enters presentation space
before preview/tour stabilization runs. The regression is covered by
`app/lib/camera-navigation.test.mjs`.

## Web tour performance

- Prefer the published SOG representation. PLY is an error fallback only.
- Do not start a readiness timer while the tour overlay is closed. For Dr
  Johnson, that behavior replaced a 13.6 MB SOG with a 247 MB PLY after the
  recipient spent 15 seconds reading the property page.
- Warm the renderer code during browser idle time, but do not download the
  scene asset until the recipient opens the tour.
- Hide the still-mounted property document while WebGL is active. This retains
  React state without paying its layout/paint cost behind the full-screen tour.
- Owner playback and shared tours use the stable `balanced` performance
  profile. HTML controls remain native-resolution, while the WebGL backbuffer
  is bounded to 4.5 million desktop pixels (2.25 million on compact touch).
  Babylon-drawn delivery motion is capped at 60 fps; Spinoff receives camera
  poses at native display cadence because it owns its lower-cost motion path.
  The authoring editor retains its precision-oriented profile.
- Spinoff runs with `motionSmoothing: false`: the moving camera renders the
  same full projection as the settled one. The degraded moving-camera pass
  dropped every drag and flight to a subset that visibly "reloaded" on
  arrival; the WebGPU depth-bucket backend carries the full projection.
- Do not resize the WebGL backbuffer during camera travel. A session gets one
  stable pixel density so transforms and pointer interaction remain coherent.
- Delivery ignores sub-pixel camera jitter before requesting another Gaussian
  depth sort. Authoring keeps Babylon's exact default sort threshold.
- Babylon-rendered PLY, pruned, and composed tours retain their last coherent
  Gaussian ordering while the camera moves. After 120 ms of stillness they
  restore the normal threshold and request one exact final-pose worker sort.
  Applying a completed worker result from an older pose during motion makes
  the reconstruction appear to shake around a smooth camera.
- Never replace a compact SOG just because decoding crossed a wall-clock
  timeout. Fall back to PLY only after an actual SOG load or decode error.

The density and motion scheduler are covered by
`app/lib/viewer-performance.test.mjs`.

## Camera basis and the Gaussian engines (2026-09-25)

- Spinoff and Spark draw from Babylon's `onBeforeRenderObservable`, in the
  same frame as the camera moves — never from their own rAF loop, which drew
  last frame's pose.
- Babylon's `getTarget()` returns the look-at point computed with the *last*
  view matrix. `Scene.render()` runs `camera.update()` and the observers
  before it computes this frame's view matrix, so a pose set this frame (a
  flight step, WASD, an inertial drag) has moved `position` and `rotation`
  but not that cached target. Every same-frame reader goes through
  `currentCameraTarget()` (`app/lib/spinoff-camera-sync.ts`), which asks for
  the view matrix first. Aiming this frame's position at last frame's target
  was the "aligning compensation" jitter and the up-and-down wobble on
  climbing paths; `app/lib/spinoff-camera-sync.test.mjs` pins the stale
  target against Babylon 9.10 with `NullEngine`.
- `camera.upVector` is the **reference** up: the horizon a pose is judged
  against, not the camera's oriented up. The walk plane, the two-pointer pan
  and the engine roll all read it that way. `levelReferenceUp` keeps it
  level and only straightens a look straight down, where the look-at would
  lose its right vector. Never hand `upVector` a forward-perpendicular up.

## Walking and point of view (2026-09-25)

- Every mode walks through the movement observer in the scene's ground plane
  (`cameraWalkDirection` with the transformed canonical up, the same
  gravity-locked axis `setImmersiveBase` uses on phones). Babylon's native
  FreeCamera key bindings are emptied: they walk along the camera's own axes,
  so W followed a pitched shot into the floor and A/D strafed in the tilted
  image plane — the "constrained local axis". The native mouse look stays.
- Flying between saved cameras presents each shot through its authored lens
  (0.66 rad by default, a photograph's 38° vertical). Taking the camera into
  your own hands — a movement key, a desktop drag past 4 px, a touch gesture
  — enters first person (`enterPov`): the lens eases to `povVerticalFov`
  (62° vertical in landscape; opened on portrait so about 40° of the room
  fits across, capped at 80°) and the horizon eases to the scene up, over
  480 ms (`firstPersonEase`). A flight cancels the ease and eases back to the
  shot's own lens. The editor (`spatialNavigation`) never enters it.

## Reveal (2026-09-25)

- "Loaded" is not "painted". The loading surface fades only after
  `waitForFirstContentFrame` (`app/lib/first-content-frame.ts`) has seen six
  consecutive frames whose stats report projected splats, no capacity
  overflow, and no change of selection probability (bounded at 2.5 s; Spark
  waits for three drawn frames). The WebGPU backend starts every scene at
  probability 1, overflows a phone's projected capacity and drops whole
  regions until the counter readbacks settle it — revealing on those frames
  was the black blink at the start of a tour.
- The engine canvas never cross-fades under the loading surface: a canvas
  fading in while the surface fades out lets the dark backdrop through at the
  midpoint. The surface fades; the canvas is simply opaque once ready.
- Spinoff's own `ResizeObserver` reallocates and clears its canvas on a layout
  change. A second observer on the same element (created later, so it runs
  after) draws again in the same task, before that frame is painted.
- The Babylon (PLY / composed) path reveals when the sorted frame is on
  screen (`splatIndexBufferSet` and the applied sort id) or after 1.5 s.

## Verification

Run before shipping camera or shared-viewer changes:

```bash
node --test app/lib/camera-navigation.test.mjs app/lib/camera-bounds.test.mjs app/lib/gaussian-sort-motion.test.mjs app/lib/viewer-performance.test.mjs app/lib/spinoff-camera-sync.test.mjs app/lib/first-content-frame.test.mjs
npx eslint app/components/splat-viewer.tsx app/shared/'[token]'/page.tsx app/tour/'[id]'/page.tsx
npx tsc --noEmit
npm run build
```

On a real phone and desktop, after any change to the camera, the engines or
the reveal: open a tour cold (no dark flash between the loader and the
room), play the trajectory and step through poses (no aim correction, no
up-and-down wobble on climbing paths), then take the camera by hand — WASD,
a drag, a touch — and confirm the walk stays on the floor, the horizon stays
level and the lens opens to the walking field. The operator's words for
regressions here have been "jitter", "wobbly", "offset", "constrained",
"black blink".

For production, verify both the authenticated tour and public shared route,
then check the deployed container logs. A successful HTTP response validates
routing and startup; interactive WebGL behavior still requires a real browser
session on the target device.
