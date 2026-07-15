# Reaigen Frontend — Architecture & Tour Sharing/Viewing

## Stack

- **Framework**: Next.js 16 (App Router, React 19, Turbopack)
- **3D Engine**: BabylonJS (Gaussian Splatting renderer)
- **UI**: Tailwind CSS + Radix UI primitives
- **Auth**: HTTP-only cookie JWT (proxied through Next.js API routes)
- **Deployment**: Standalone Docker build on port 3055, dev on port 3055
- **Public URL**: `https://app-reaigen.publicrouter.sk`

---

## Project Structure

```
app/
├── page.tsx                    # Landing / login (redirects to /dashboard if authed)
├── layout.tsx                  # Root layout (brand font, metadata)
├── globals.css                 # Design tokens, animations, utilities
├── dashboard/page.tsx          # Creation inventory and batched tour readiness
├── tours/page.tsx              # Virtual-tour asset inventory
├── draft/[id]/
│   ├── page.tsx                # Owner detail, editor, version manager
│   └── sharing/page.tsx        # Recipient preview and controlled-link composer
├── shares/page.tsx             # Global link inventory, analytics, creation picker
├── settings/page.tsx           # Account settings with responsive section navigation
├── tour/[id]/page.tsx          # Authenticated tour viewer + camera editor
├── shared/[token]/page.tsx     # Public shared tour viewer (PIN gate)
├── api/
│   ├── auth/[...path]/route.ts     # Proxy → Django /api/v1/core/auth/*
│   └── reaigen/[...path]/route.ts  # Proxy → Django /api/v1/reaigen/* & /api/v1/core/users/*
├── components/
│   ├── auth-gate.tsx           # Working email/password login and registration forms
│   ├── app-shell.tsx           # Desktop rail, mobile nav, and optional Agent column
│   ├── splat-viewer.tsx        # BabylonJS Gaussian Splat viewer (core)
│   ├── camera-editor.tsx       # Camera editor (capture, look through, reorder, save)
│   ├── draft-editor.tsx        # Ownership-checked draft PATCH side panel
│   ├── draft-version-manager.tsx # Tour pin plus listing/media history
│   ├── side-panel.tsx          # Accessible Radix Dialog drawer primitive
│   ├── sharing/                # Share scope, preview, creation, and link controls
│   ├── tour-controls.tsx       # Shot navigation pill (dots + arrows)
│   ├── floorplan-nav.tsx       # Floorplan overlay with room polygons
│   ├── tour-loading.tsx        # Loading spinner overlay
│   ├── settings-form.tsx       # Profile, seller, privacy, Agent, locale, notifications, billing, security
│   └── hooks/use-auth.ts       # Auth state hook (login, logout, refresh)
└── lib/
    ├── api/client.ts           # All API calls (typed, error handling)
    ├── tour-types.ts           # TypeScript types for tour/splat/share data
    ├── splat-cache.ts          # IndexedDB cache for splat files
    ├── i18n.ts                 # Translations (en, sk, cs, de)
    ├── utils.ts                # cn() utility
    ├── server/auth-cookies.ts  # JWT cookie management (server-side)
    └── ui/                     # Radix-based UI primitives
```

---

## Authentication Flow

1. User submits credentials on `/` (AuthGate component)
2. `POST /api/auth/login/` → Next.js proxy → Django `/api/v1/core/auth/login/`
3. Django returns `{ access, refresh, user }`
4. Proxy stores tokens in HTTP-only cookies (`reaigen_access`, `reaigen_refresh`)
5. Subsequent API calls: proxy reads cookie, adds `Authorization: Bearer` header
6. On 401: proxy auto-refreshes via `/api/v1/core/auth/token/refresh/`
7. On refresh failure: cookies cleared, user redirected to login

---

## Tour Viewer (`/tour/[id]`)

Authenticated page for the tour owner.

### Data Loading
1. `getSplatViewer(splatId)` → `GET /api/reaigen/splats/{id}/viewer/`
   - Returns: `{ url, tour_url, splat_id, format, signed_outputs }`
2. Cameras loaded from `GET /api/reaigen/splats/{id}/cameras/`
   - Returns: `{ cameras: [{position, forward, up}], fovY, sceneFov }`

### Viewer Initialization (SplatViewer component)
1. Load BabylonJS engine + create scene
2. Create FreeCamera (WASD movement, QE up/down)
3. Download `.splat`/`.ply` file (with progress bar)
4. Convert PLY → splat format, cache in IndexedDB
5. Create `GaussianSplattingMesh`
6. Use viewer-space camera coordinates directly; camera up vector is `(0, 1, 0)`
7. Place camera from COLMAP poses (first camera + back-off)
8. If `tour_url` exists → fetch tour JSON, place at shot 0

### Tour Playback
- Tour JSON defines: `positions[]`, `forwards[]`, `arcLens[]`, `shots[]`
- Each shot: `{ startIdx, fov, label, holdAfter, moveDuration }`
- Navigation: quintic-eased animation from current → target position
- After arrival: hold phase with slow pan + tilt
- Scroll: Steadicam-style path scrubbing (edit mode only)

### Camera Editor
- Capture current view as a camera (`position`, `forward`, `up`, `fov`)
- Reorder, update, delete cameras
- Look through a saved camera from the row or eye control
- Apply saved camera FOV during look-through and preview
- Mark the active/current camera while editing
- Save → `PATCH /api/reaigen/splats/{id}/cameras/`
- Preview mode: auto-loop through saved cameras

### Camera Editor UX Contract
- Visible UI uses camera wording, not shot wording
- Panel stays compact and fast over the 3D viewer
- Preview and edit states share one translucent card/muted material
- Do not mix black preview pills with white/light edit panels
- Avoid explanatory text inside the panel except for empty/error states

### Keyboard Controls
| Key | Action |
|-----|--------|
| ← → ↑ ↓ | Switch between tour shots |
| W/A/S/D | Move camera in space (free mode) |
| Q/E | Move up/down |
| Escape | Exit tour, enter free camera |

---

## Sharing flow

Sharing is explicit and preview-first. Opening a manager or picker never creates a public link.

### Global manager (`/shares`)

1. Load the share inventory, creation metadata, and splat thumbnails in parallel.
2. Show active/paused/view totals plus search and status filters.
3. Expand a row to load analytics and expose pause, resume, edit, or revoke actions.
4. Create Link opens a creation picker and routes to that creation's composer.

### Composer (`/draft/[id]/sharing`)

1. Load the owner draft, available tour/floorplan/media, and existing draft links.
2. Initialize content scope only from assets that actually exist.
3. Keep recipient preview and controls together so field/content changes are visible before publish.
4. Create through the splat share endpoint when a tour is selected; otherwise use the draft share
   endpoint. Copy feedback appears only after the request succeeds.

### Protection and lifecycle

- **PIN protection**: 4–10 digit code, hashed server-side.
- **Auto-expire**: 1h / 24h / 7d / 30d presets or no expiry.
- **View limit**: optional maximum number of opens.
- **Pause**: `POST /api/reaigen/shares/{id}/pause/` — temporarily disables.
- **Resume**: `POST /api/reaigen/shares/{id}/resume/` — re-enables.
- **Revoke**: `POST /api/reaigen/shares/{id}/revoke/` — irreversible and confirmed.
- **Analytics**: `GET /api/reaigen/shares/{id}/analytics/` — total views, unique visitors,
  authenticated accesses, and failed PIN attempts when applicable.

---

## Shared Tour Viewer (`/shared/[token]`)

Public page — no authentication required.

### Flow
```
User opens link
    │
    ▼
GET /api/reaigen/shared/{token}/tour-viewer/
    │
    ├─ 200 → Load viewer
    ├─ 403 { requires_pin: true } → Show PIN gate
    ├─ 403 { error: "paused/expired/max views" } → Show error
    └─ 404 → Show "link unavailable"
```

### PIN Verification
1. User enters PIN → `POST /api/reaigen/shared/{token}/verify-pin/`
2. Success returns `{ pin_token: "hmac..." }`
3. Token stored in `sessionStorage` (survives page reload)
4. Passed as `?pin_token=` on subsequent tour-viewer requests
5. Rate limited: 5 attempts → 15min lockout

### Viewer Data (response)
```json
{
  "url": "https://cdn.../signed-splat.splat",
  "tour_url": "https://cdn.../signed-tour.json",
  "cameras": { "cameras": [...], "sceneFov": 65 },
  "draft_title": "Modern Apartment",
  "floorplan_url": "https://cdn.../floorplan.png",
  "rooms": [{ "id", "label", "boundary_points", "center_x", "center_z" }],
  "room_splats": [{ "id", "room_label", "splat_url" }]
}
```

### Viewer Behavior (readOnly mode)
- Camera starts at first tour shot (or COLMAP camera if no tour)
- Arrow keys disabled (keyboard nav off in readOnly)
- Scroll disabled (no accidental scrubbing)
- Touch/mouse drag: look around from current position
- Navigation: on-screen dot controls only (TourControls component)

### UI Overlays
- **Title badge** (top-left): draft title in glass pill
- **Brand** (top-right): "Reaigen" watermark
- **Tour controls** (bottom-center): dark glass pill with dots + arrows + shot label
- **Floorplan** (bottom-left): expandable room map, click room → fly to featured shot

---

## API Proxy Architecture

The frontend never calls Django directly from the browser. All requests go through Next.js API routes:

```
Browser → /api/auth/*     → Next.js proxy → Django /api/v1/core/auth/*
Browser → /api/reaigen/*  → Next.js proxy → Django /api/v1/reaigen/*
Browser → /api/reaigen/users/* → Next.js proxy → Django /api/v1/core/users/*
```

Benefits:
- JWT tokens stored in HTTP-only cookies (not accessible to JS)
- Automatic token refresh on 401
- Single origin (no CORS issues for browser → Next.js)
- Backend URL hidden from client

---

## Caching

### Splat Files (IndexedDB)
- Key: `splat:{id}:startup|full` with an optional output version suffix
- Stores converted splat ArrayBuffer
- Skips download + conversion on revisit
- 14-day TTL with a 1.5 GB LRU budget

### PIN Tokens (sessionStorage)
- Key: `reaigen_pin_{token}`
- HMAC token from successful PIN verification
- Survives page reload within same tab session

---

## Design System

- **Colors**: Neutral management surfaces; restrained semantic status colors; dark studio viewer.
- **Font**: System SF Pro stack + Noto Serif Display for brand wordmark
- **Radius**: 0.625rem (10px) base
- **Overlays on 3D**: Translucent surfaces with blur and restrained borders
- **Camera editor overlay**: Unified `card`/`muted` glass surface across preview and edit modes; no mixed black/white panel treatment
- **Animations**: `animate-fade-in`, `animate-fade-in-up` (custom keyframes)
- **Status indicators**: Foreground dot (active), amber dot (paused)
