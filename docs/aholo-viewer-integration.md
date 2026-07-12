# Aholo Viewer Integration (Dev/Future)

## Overview

`@manycore/aholo-viewer` (MIT, v1.5.1) is installed as a prototype alternative to BabylonJS for rendering Gaussian Splats. It supports **chunked streaming LOD** — rendering partial data as it downloads without waiting for the full file.

## Why

- Streaming SOG/PLY/SPZ without full download (time-to-first-pixels in seconds)
- LOD memory management for large scenes
- Native SOG format support with VKGS ZIP detection

## Package

```bash
npm install @manycore/aholo-viewer
```

- ESM-only, WebGL2
- Worker files in `dist/`: `splat-worker.js`, `splat-sort-worker.js`, `transcoder-worker.js`
- Workers are copied to `public/aholo/` for standalone builds

## Component

`app/components/aholo-viewer.tsx` — drop-in viewer component.

```tsx
import { AholoViewer } from "../components/aholo-viewer";

<AholoViewer
  splatUrl="https://example.com/scene.sog"
  onReady={() => console.log("loaded")}
  onError={(msg) => console.error(msg)}
/>
```

## How to bring back the compare page

Create `app/tour/[id]/compare/page.tsx`:

```tsx
import dynamic from "next/dynamic";
import { AholoViewer } from "../../../components/aholo-viewer";

const SplatViewer = dynamic(() => import("../../../components/splat-viewer"), { ssr: false });

// Render both side by side at /tour/{id}/compare
// Left: BabylonJS (existing), Right: Aholo (streaming)
```

Layout: `h-dvh flex` with two `flex-1 min-w-0 relative` panels. Each viewer uses `absolute inset-0`.

## Key Integration Notes

1. **Render loop is mandatory:**
   ```ts
   const render = () => viewer.render();
   viewer.requestRenderHandler = () => requestAnimationFrame(render);
   requestAnimationFrame(render);
   ```

2. **Camera setup (Y-up):**
   ```ts
   camera.up.set(0, 1, 0);
   camera.position.set(-3, 2, -3);
   camera.lookAt(new Vector3(0, 0, 0));
   ```

3. **Pipeline config:**
   ```ts
   setViewerConfig(viewer, {
     pipeline: {
       Background: { background: { active: "basic", basic: { color: new Color(1,1,1) } }, ground: { enabled: false } },
       Splatting: { enabled: true },
       TAA: { enabled: false },
     },
   });
   ```

4. **SOG parsing:** `parseSplatData(SplatFileType.SOG, uint8Array)` — auto-detects ZIP.

5. **Worker files:** Must be accessible at runtime. Next.js standalone needs `outputFileTracingIncludes` in `next.config.ts`.

6. **Cleanup:** Cancel rAF, set `requestRenderHandler = undefined`, call `viewer.pause()`.

7. **Attach events to container, not canvas** — canvas is managed internally.

## Known Issues

- Worker `import.meta.url` resolution may fail in some bundlers — workers need to be served as static assets
- No built-in orbit/pan controls — must implement pointer event handlers on the container
- No documented `dispose()` method — use `pause()` + DOM removal

## Next Steps

- Implement orbit/pan/zoom controls (pointer events on container)
- Test streaming with `{ stream: resp.body, contentLength }` input
- Compare render quality and load times vs BabylonJS
- Consider replacing BabylonJS for SOG-only tours if quality matches
