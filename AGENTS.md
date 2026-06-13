# Reaigen Frontend

This is the **production Reaigen web frontend** (Next.js).

- Port: **3055** (dev and Docker)
- Backend: Django at `http://localhost:80` (via Nginx)
- Docker: `docker compose up -d --build`

## NOT the Splat Training Dashboard

The `Reaigen-splat-web-tour-combined-system` in the same parent directory is an **internal R&D tool** (splat training pipeline dashboard, port 3035). It is NOT the Reaigen frontend.

## Coordinate Convention

- Scene pretransform: **identity** (no scaling, no flip)
- Backend PLY output is already Y-up
- Camera upVector: `(0, 1, 0)`
- Legacy saved cameras (from old `scaling(-1,1,1)` era): X is negated on load
- Matches iOS `scenePreTransform = matrix_identity_float4x4`
