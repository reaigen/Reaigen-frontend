# Reaigen Frontend

This is the **production Reaigen web frontend** (Next.js).

- Port: **3055** (dev and Docker)
- Backend: Django at `http://localhost:80` (via Nginx)
- Standalone Docker: `docker compose up -d --build`
- Full stack Docker: from `../Reaigen-backend`, run `docker compose -f docker-compose.yml -f docker-compose.frontend.yml up -d --build`

## Local Dev Server

Run frontend development from this directory:

```bash
cd /Users/reaigen/Documents/Reaigen/Reaigen-stack/Reaigen-frontend
npm run dev
```

Default local URL: `http://localhost:3055`.

If port 3055 is in use, run a temporary dev server on 3057:

```bash
npx next dev --hostname 0.0.0.0 --port 3057
```

Temporary local URL: `http://localhost:3057`.

## Docker / Public Runtime

The public Dockerized frontend is a production standalone Next.js build, not the Next.js dev server.

- `Dockerfile` runs `npm run build`, then starts `node server.js`
- Standalone frontend Compose builds from this directory and uses `REAIGEN_BACKEND_URL=http://host.docker.internal:80`
- Backend stack override (`../Reaigen-backend/docker-compose.frontend.yml`) builds from `../Reaigen-frontend`, runs container `reaigen_frontend`, joins `reaigen_network`, exposes `3055:3055`, and uses `REAIGEN_BACKEND_URL=http://nginx:80`

## NOT the Splat Training Dashboard

The `Reaigen-splat-web-tour-combined-system` in the same parent directory is an **internal R&D tool** (splat training pipeline dashboard, port 3035). It is NOT the Reaigen frontend.

## Camera Editor UX Contract

- Use camera wording in visible UI.
- Keep the camera panel compact, fast, and usable over the 3D viewer.
- Preview and edit states should use one unified translucent card material.
- Do not mix a black preview pill with a white/light edit panel.
- The active camera must be visible while editing.
- Clicking a camera or look-through control must move to that saved camera and apply its saved FOV.
- Avoid explanatory text inside the panel except for empty/error states.

## Coordinate Convention

- Scene pretransform: **identity** (no scaling, no flip)
- Backend PLY output is already Y-up
- Camera upVector: `(0, 1, 0)`
- Legacy saved cameras (from old `scaling(-1,1,1)` era): X is negated on load
- Matches iOS `scenePreTransform = matrix_identity_float4x4`
