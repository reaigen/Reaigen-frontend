# Bug Fix Session — 2026-06-02

## 1. Splat Web Viewer (Reaigen-splat-web-tour-combined-system) — Docker 502

**Problem:** Web viewer at port 3055 returning 502.

**Root cause:** The Dockerfile was missing dependencies:
- `vendor/reaigen-library-0.1.0.tgz` not copied into the container (npm install failed)
- `eisdir-patch.cjs` not copied to the runner stage (start script crashed)
- `package.json` start script used port 3036, but container expected 3035

**Fix (deploy/splatbackend_1_02/Dockerfile):**
- Added `COPY Reaigen-splat-web-tour-combined-system/vendor/ ./vendor/` in deps stage
- Added `COPY --from=builder /app/eisdir-patch.cjs ./eisdir-patch.cjs` in runner stage
- Changed CMD to explicit: `CMD ["node", "-r", "./eisdir-patch.cjs", "./node_modules/next/dist/bin/next", "start", "-p", "3035", "-H", "0.0.0.0"]`

**Port:** Splat viewer runs on **3035**.

---

## 2. SOG Pretransform (Reaigen-splat-web-tour-combined-system)

**Problem:** `.sog` files displayed with incorrect orientation.

**Root cause:** The official Babylon.js `splatFileLoader` applies `scaling.y *= -1` after parsing SOG data. The custom viewer skipped this.

**Fix (components/SplatViewer.tsx):**
```typescript
// After gs.updateData(parsed.data, ...)
gs.scaling.set(1, -1, -1);
gs.computeWorldMatrix(true);
```

---

## 3. Reaigen Frontend — Docker Setup

**Problem:** Frontend not running in Docker.

**Root cause:** 
- Import path `@babylonjs/loaders/splat/sog` wrong case — Linux filesystem is case-sensitive, correct path is `@babylonjs/loaders/SPLAT/sog`
- Container failed to start with `getaddrinfo EAI_AGAIN` — missing `HOSTNAME=0.0.0.0` environment variable

**Fix:**
- Fixed import: `@babylonjs/loaders/splat/sog` → `@babylonjs/loaders/SPLAT/sog`
- Added `HOSTNAME=0.0.0.0` to docker-compose.yml environment
- Port: **3055**

---

## 4. Tour Viewer — Scene Pretransform & Camera Convention

**Problem:** Scene displayed upside-down or mirrored depending on pretransform settings. Saved cameras appeared in wrong positions.

**Root cause:** Confusion between multiple coordinate conventions:
- iOS uses `matrix_identity_float4x4` (no pretransform) — backend PLY is already Y-up
- The old web viewer code applied `scaling(-1, 1, 1)` to PLY meshes
- Cameras were saved while that old `(-1, 1, 1)` scaling was active

**Final correct convention:**
- **Mesh scaling:** Identity (no scaling applied)
- **Camera upVector:** `(0, 1, 0)` — standard Y-up
- **Scene pretransform:** Identity — matches iOS `scenePreTransform = matrix_identity_float4x4`
- **Legacy camera correction:** Saved cameras (from the old `-1,1,1` era) need X negated on load

**Fix (app/components/splat-viewer.tsx):**

```typescript
// No mesh scaling — identity
gs.alwaysSelectAsActiveMesh = true;
// (no gs.scaling line)

// Camera up is standard Y-up
camera.upVector = new BABYLON.Vector3(0, 1, 0);

// Loading saved cameras: negate X (legacy correction)
positions.push([-pos[0], pos[1], pos[2]]);
forwards.push([-forward[0], forward[1], forward[2]]);

// COLMAP initial placement: also negate X
const fx = -Number(c.forward?.[0] ?? 0);
const px = -c.position[0] - nx * BACK_OFF;

// getCurrentCamera: returns identity-space positions (no transform)
// New saves will be in correct space going forward
```

**Note:** Once all cameras are re-saved from the new viewer, the legacy X-negate can be removed. Detect via `source: "edited"` + presence of `up` field in camera data.

---

## Files Modified

### Reaigen-splat-web-tour-combined-system
- `deploy/splatbackend_1_02/Dockerfile` — fixed deps, eisdir-patch, port
- `deploy/splatbackend_1_02/docker-compose.yml` — port 3035, healthcheck
- `components/SplatViewer.tsx` — SOG pretransform `(1, -1, -1)`

### Reaigen-frontend
- `app/components/splat-viewer.tsx` — identity pretransform, legacy camera X-negate
- `docker-compose.yml` — port 3055, HOSTNAME env
- `Dockerfile` — port 3055

---

## Current Running Services

| Service | Port | Container |
|---------|------|-----------|
| Reaigen Frontend | 3055 | reaigen-frontend-reaigen-frontend-1 |
| Splat Viewer | 3035 | splat-backend-web |
| Django Backend | 80 (nginx) | reaigen_nginx → reaigen_web |
