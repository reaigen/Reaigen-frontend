# Reaigen Frontend

Next.js web application for the Reaigen creator platform — virtual tour viewer, sharing, and account management.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5.9 |
| React | React 19 |
| 3D Engine | BabylonJS (Gaussian Splatting) |
| Styling | Tailwind CSS 3 |
| UI Components | Radix UI |
| Animation | Framer Motion |
| Auth | HTTP-only cookie JWT (server-side proxy) |
| Deployment | Docker (standalone build) |

---

## Environment Variables

Copy `.env.local.example` to `.env.local`:

```bash
# Backend URL (Django API) — server-side only, not exposed to browser
REAIGEN_BACKEND_URL=http://localhost:80
```

In standalone frontend Docker, this is set to `http://host.docker.internal:80` so the container reaches backend Nginx on the host.

In the full Reaigen stack, the backend repo's `docker-compose.frontend.yml` sets this to `http://nginx:80`, so the frontend talks to the backend through Docker networking inside the same Compose project.

---

## Local Development

```bash
cd /Users/reaigen/Documents/Reaigen/Reaigen-stack/Reaigen-frontend
npm install
npm run dev
```

Runs on `http://localhost:3055` (bound to `0.0.0.0`).

Requires the backend running on port 80 via Nginx in this workspace. The proxy also falls back between `localhost:80` and `localhost:8000` for local development.

If port 3055 is already occupied, run the same frontend on a temporary local port:

```bash
npx next dev --hostname 0.0.0.0 --port 3057
```

Then open `http://localhost:3057`. This is only for local testing; Docker and public runtime still use port 3055.

---

## Production (Docker)

The public Dockerized frontend is not the Next.js dev server. It is a production standalone Next.js build created by the `Dockerfile`:

```dockerfile
RUN npm run build
CMD ["node", "server.js"]
```

### Standalone frontend container

```bash
docker compose up --build -d
```

Builds this repo as a multi-stage image (deps → build → standalone), runs on port **3055**, and expects backend Nginx at `http://host.docker.internal:80`.

### Full Reaigen stack

From the backend repo, include the frontend override:

```bash
cd ../Reaigen-backend
docker compose -f docker-compose.yml -f docker-compose.frontend.yml up -d --build
```

That Compose override builds the frontend from `../Reaigen-frontend` by default, runs container `reaigen_frontend`, publishes `3055:3055`, joins the `reaigen_network`, and sends server-side API traffic to `http://nginx:80`.

The app is reverse-proxied via publicrouter at `https://app-reaigen.publicrouter.sk`.

---

## Deployment

```bash
# Local — push to Gitea
git push origin main

# On server — pull and rebuild
git pull origin main
docker compose up -d --build
```

Or for dev mode on the server:

```bash
npm run dev
```

---

## Pages

| Route | Auth | Purpose |
|-------|------|---------|
| `/` | No | Login / register (redirects to dashboard if authed) |
| `/dashboard` | Yes | Image-led creation inventory with search and readiness state |
| `/tours` | Yes | First-class virtual tour inventory and processing status |
| `/draft/[id]` | Yes | Creation detail, owner editing, media, floorplan, and version manager |
| `/draft/[id]/sharing` | Yes | Sharing configuration (two-panel: preview + controls) |
| `/tour/[id]` | Yes | Full tour viewer + camera editor |
| `/shares` | Yes | Global controlled-link inventory, analytics, and creation picker |
| `/settings` | Yes | Profile, localization, security |
| `/shared/[token]` | No | Public shared tour viewer (PIN-gated) |

---

## Tour Camera Editor

The owner camera editor lives on `/tour/[id]` and is implemented mainly in:

- `app/components/camera-editor.tsx`
- `app/components/splat-viewer.tsx`

UX contract:

- Use camera wording in the UI, not shot wording.
- Keep the panel compact, quick, and usable over the 3D viewer.
- Preview and edit controls must feel like one unified translucent card surface.
- Do not mix a black preview pill with a white/light edit panel.
- Do not add instructional text blocks into the camera panel unless they are necessary for an empty/error state.
- The current camera must be visible while editing.
- Clicking a camera or the look-through icon must move the viewer to that saved camera.
- Saved camera FOV must be applied when looking through or previewing a camera.

Behavior contract:

- `CameraEditor` captures canonical `position`, `forward`, `up`, and `fov` from `SplatViewerHandle.getCurrentCamera()`.
- Look-through and preview navigation pass the complete saved basis to `SplatViewerHandle.navigateToCamera(...)`; edit recall is instant and preview recall may animate.
- `SplatViewer` applies the scene root transform to the complete camera basis exactly once for presentation, then inverses it on capture.
- Save persists ordered cameras through the owning tour workspace when available, with the splat camera endpoint retained for compatible surfaces.
- Camera order is meaningful because shared playback follows the saved order.

See [`docs/tour-viewer-runtime.md`](docs/tour-viewer-runtime.md) for the camera-space and shared-delivery performance invariants.

---

## API Proxy

The browser never calls Django directly. All API requests go through Next.js server routes:

```
/api/auth/*     → Django /api/v1/core/auth/*
/api/reaigen/*  → Django /api/v1/reaigen/*  (or /api/v1/core/users/*)
/api/reaigen/reai-agent/* → Django /api/v1/reai-agent/*
```

This handles:
- JWT storage in HTTP-only cookies
- Automatic token refresh on 401
- Backend URL hidden from client
- Private, no-store access to the canonical Django creator Agent

---

## Production Posture

The frontend follows the research notes in `docs/frontend-production-research.md`:

- authenticated and tokenized app routes are marked non-indexable
- global security headers and CSP are configured in `next.config.ts`
- API proxy responses are private and no-store
- managed HTML content is sanitized before rendering
- the login route keeps a server-rendered shell and lazy-loads the auth panel
- Core Web Vitals can be reported with `NEXT_PUBLIC_WEB_VITALS_ENDPOINT`

```bash
NEXT_PUBLIC_WEB_VITALS_ENDPOINT=/api/analytics/web-vitals
```

If the endpoint is not set, metrics are only logged in development.

---

## Key Features

### Dashboard & Drafts
- Creation inventory with server-side search, infinite scroll, grid/list toggle, and batched tour availability
- Owner draft editor with private-address handling and unsaved-change protection
- Draft detail with property specs, photo/video gallery, floorplan, and explicit listing/tour readiness
- Version manager for live tour selection plus Agent-backed listing and media history

### Virtual Tour Inventory
- Dedicated Tours route with ready, processing, and attention filters
- Renderability-aware actions: incomplete assets never expose a broken viewer link
- Live tour pinning controls which processed scan is consumed by existing app and share surfaces

### Virtual Tour Viewer
- BabylonJS Gaussian Splatting renderer (SOG/SPZ/PLY formats)
- Tour playback with camera-based navigation
- Camera editor (capture, reorder, save preview angles)
- Floorplan overlay with room navigation
- IndexedDB caching for splat files (14-day TTL, 1.5 GB budget, LRU eviction)

### Sharing & Share Management
- Full-page sharing config with live preview
- PIN protection (4–10 digits, rate-limited)
- Auto-expire (1h / 24h / 7d / 30d), view limits
- Pause / resume / revoke
- Shares dashboard for managing all links and starting a new controlled link from any creation
- Analytics (views, unique IPs)

### Shared Tour Viewer (Public)
- No auth required
- PIN gate with lockout protection
- Property info card with photo gallery and lightbox
- Read-only viewer (no keyboard movement)
- On-screen dot navigation
- Floorplan room navigation
- Brand watermark

---

## Scripts

```bash
npm run dev      # Development server (port 3055)
npm run build    # Production build
npm run start    # Start production server (port 3055)
npm run lint     # ESLint
npm run typecheck # TypeScript without emitting files
npm run check    # Lint + typecheck + production build
```

---

## Documentation

| File | Contents |
|------|----------|
| `doc/ARCHITECTURE.md` | Technical architecture — auth flow, viewer internals, sharing, caching |
| `docs/product-ux-system.md` | Product model, information architecture, editing/version/share guarantees, responsive and release contracts |
| `docs/agent-workspace-ui.md` | Agent context, proposal, confirmation, permission, and history contracts |

---

## License

Copyright (c) 2026 Tomas Sikora, Reaigen s.r.o.  
All rights reserved. Proprietary software — see backend repo for full license text.
