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
REAIGEN_BACKEND_URL=http://localhost:8000
```

In Docker production, this is set to `http://host.docker.internal:80` (reaches Nginx on the host).

---

## Development

```bash
npm install
npm run dev
```

Runs on `http://localhost:3055` (bound to `0.0.0.0`).

Requires the backend running on port 8000 (or 80 via Nginx).

---

## Production (Docker)

```bash
docker compose up --build
```

Builds a multi-stage image (deps → build → standalone) and runs on port **3050**.

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
| `/dashboard` | Yes | Splat list, share actions, tour links |
| `/tour/[id]` | Yes | Full tour viewer + camera editor |
| `/settings` | Yes | Profile, localization, security |
| `/shared/[token]` | No | Public shared tour viewer (PIN-gated) |

---

## API Proxy

The browser never calls Django directly. All API requests go through Next.js server routes:

```
/api/auth/*     → Django /api/v1/core/auth/*
/api/reaigen/*  → Django /api/v1/reaigen/*  (or /api/v1/core/users/*)
```

This handles:
- JWT storage in HTTP-only cookies
- Automatic token refresh on 401
- Backend URL hidden from client

---

## Key Features

### Virtual Tour Viewer
- BabylonJS Gaussian Splatting renderer
- Tour playback with shot-based navigation
- Camera editor (capture, reorder, save preview angles)
- Floorplan overlay with room navigation
- IndexedDB caching for splat files

### Sharing
- One-click share link creation
- PIN protection (4–10 digits, rate-limited)
- Auto-expire (1h / 24h / 7d / 30d)
- View limits
- Pause / resume / revoke
- Analytics (views, unique IPs)

### Shared Tour Viewer (Public)
- No auth required
- PIN gate with lockout protection
- Read-only viewer (no keyboard movement)
- On-screen dot navigation
- Floorplan room navigation
- Brand watermark

---

## Scripts

```bash
npm run dev      # Development server (port 3055)
npm run build    # Production build
npm run start    # Start production server (port 3050)
npm run lint     # ESLint
```

---

## Documentation

| File | Contents |
|------|----------|
| `ARCHITECTURE.md` | Full technical architecture — auth flow, viewer internals, sharing, caching, design system |

---

## License

Copyright (c) 2026 Tomas Sikora, Reaigen s.r.o.  
All rights reserved. Proprietary software — see backend repo for full license text.
