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
- `getCurrentCamera()` performs the inverse conversion before persistence.
- Horizon stabilization may only compare up vectors in the same coordinate
  space. Comparing canonical up with presentation up can select the opposite
  hemisphere and produce a 180-degree roll.
- The Gaussian mesh is never mirrored independently of its cameras.

The Dr Johnson regression fixed on 2026-08-03 exposed this invariant: its
canonical camera up is mostly horizontal, while its root quaternion maps that
vector to presentation `+Y`. Initial placement now enters presentation space
before preview/tour stabilization runs. The regression is covered by
`app/lib/camera-navigation.test.mjs`.

## Public shared-tour performance

- Prefer the published SOG representation. PLY is an error fallback only.
- Do not start a readiness timer while the tour overlay is closed. For Dr
  Johnson, that behavior replaced a 13.6 MB SOG with a 247 MB PLY after the
  recipient spent 15 seconds reading the property page.
- Warm the renderer code during browser idle time, but do not download the
  scene asset until the recipient opens the tour.
- Hide the still-mounted property document while WebGL is active. This retains
  React state without paying its layout/paint cost behind the full-screen tour.
- Shared tours use the stable `balanced` performance profile: HTML controls
  remain native-resolution, the WebGL backbuffer is bounded to 4.5 million
  desktop pixels (2.25 million on compact touch), and motion rendering is
  capped at 60 fps on high-refresh displays.
- Do not resize the WebGL backbuffer during camera travel. A session gets one
  stable pixel density so transforms and pointer interaction remain coherent.

The density and motion scheduler are covered by
`app/lib/viewer-performance.test.mjs`.

## Verification

Run before shipping camera or shared-viewer changes:

```bash
node --test app/lib/camera-navigation.test.mjs app/lib/viewer-performance.test.mjs
npx eslint app/components/splat-viewer.tsx app/shared/'[token]'/page.tsx
npx tsc --noEmit
npm run build
```

For production, verify both the authenticated tour and public shared route,
then check the deployed container logs. A successful HTTP response validates
routing and startup; interactive WebGL behavior still requires a real browser
session on the target device.
