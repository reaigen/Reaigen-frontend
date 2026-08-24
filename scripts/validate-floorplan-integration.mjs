/**
 * Regression test for the @reaigen/floorplan-solver integration on REAL
 * captured scenes (fixtures/floorplan/*.json — the exact solver input captured
 * from the browser). Guards the defects we hit on draft 11949:
 *   - inferred fallback-room edges must never act as measured support walls;
 *   - placed storage/appliances must be axis-aligned (flush to walls);
 *   - the solve must be strict-valid and deterministic.
 *
 * Run: npm run validate-floorplan-integration
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { solveLegacyFloorplan } from "@reaigen/floorplan-solver";
import { conditionWallSegmentsForPresentation } from "../app/lib/floorplan-wall-conditioning.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures", "floorplan");

function solve(d, rooms) {
  return solveLegacyFloorplan(
    {
      walls: d.walls, doors: d.doors, windows: d.windows, objects: d.objects,
      doorConfigs: d.doorConfigs, ...(rooms ? { roomPolygons: rooms } : {}),
    },
    { strict: true, runNavigationRepair: true }
  );
}

function solveWithAdapterLogic(d) {
  const genuine = (d.rooms ?? [])
    .map((room) => Array.isArray(room) ? room : room?.polygon)
    .filter((polygon) => Array.isArray(polygon) && polygon.length >= 3)
    .map((polygon, i) => ({ id: `floor-${i}`, polygon }));
  const walls = conditionWallSegmentsForPresentation(
    d.walls,
    d.interior ?? [0, 0],
    d.floorPolys ?? [],
  );
  return { result: solve({ ...d, walls }, genuine.length ? genuine : null), walls };
}

const yawDeg = (o) => (Math.atan2(o.axisW[1], o.axisW[0]) * 180) / Math.PI;
const offCardinal = (deg) => Math.abs(((((deg % 90) + 135) % 90) - 45)); // dist to nearest 90°
const AXIAL_KINDS = new Set(["storage", "refrigerator", "stove", "oven", "dishwasher", "washerDryer", "sink", "toilet", "bathtub", "television"]);
const WALL_SUPPORT_COS = Math.cos((15 * Math.PI) / 180);

function hasObservedWallSupport(object, walls) {
  const axes = [
    { along: object.axisW, normal: object.axisD, halfAlong: object.halfW, halfDepth: object.halfD },
    { along: object.axisD, normal: object.axisW, halfAlong: object.halfD, halfDepth: object.halfW },
  ];
  return walls.some(([a, b]) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    if (length < 0.15) return false;
    const wallDir = [dx / length, dz / length];
    return axes.some((axis) => {
      if (Math.abs(axis.along[0] * wallDir[0] + axis.along[1] * wallDir[1]) < WALL_SUPPORT_COS) return false;
      return [-1, 1].some((side) => {
        const edge = [object.center[0] + axis.normal[0] * axis.halfDepth * side, object.center[1] + axis.normal[1] * axis.halfDepth * side];
        const rx = edge[0] - a[0], rz = edge[1] - a[1];
        const t = rx * wallDir[0] + rz * wallDir[1];
        const closest = [a[0] + wallDir[0] * t, a[1] + wallDir[1] * t];
        const perpendicular = Math.hypot(edge[0] - closest[0], edge[1] - closest[1]);
        const overlap = Math.max(0, Math.min(length, t + axis.halfAlong) - Math.max(0, t - axis.halfAlong));
        return perpendicular <= 0.26 && overlap >= Math.min(length, 2 * axis.halfAlong) * 0.35;
      });
    });
  });
}

const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));
assert.ok(files.length > 0, "no floorplan fixtures found");

for (const file of files) {
  const d = JSON.parse(readFileSync(join(fixturesDir, file), "utf8"));

  test(`${file}: strict-valid or explicitly incomplete without furniture`, () => {
    const { result: r, walls } = solveWithAdapterLogic(d);
    if (r.diagnostics.roomSource === "fallback-hull") {
      const accepted = r.objects.filter((object) => !["rejected", "merged"].includes(object.status));
      const illegal = accepted.filter((object) => {
        const lowBuiltIn = object.category === "storage" && (object.height ?? 0) <= 1.2;
        const evidenceLimit = lowBuiltIn ? 0.16 : 0.12;
        return object.candidateSource === "wall"
          || object.candidateSource === "storage-wall-run"
          || (object.category !== "chair" && object.displacement > evidenceLimit);
      });
      assert.equal(illegal.length, 0, `partial topology invented placements: ${illegal.map((object) => object.id).join(", ")}`);
      assert.match(r.diagnostics.warnings.join(" "), /containment-only/i);
      return;
    }
    if (r.diagnostics.roomSource === "none") {
      const accepted = r.objects.filter((object) => !["rejected", "merged"].includes(object.status));
      assert.equal(accepted.length, 0, `incomplete topology retained furniture: ${accepted.map((object) => object.id).join(", ")}`);
      assert.match(r.diagnostics.warnings.join(" "), /no valid room|convex-hull fallback rejected/i);
      return;
    }
    assert.equal(r.validation.valid, true, "solve is not strict-valid");
    const unsupported = r.objects.filter(
      (o) => o.status !== "rejected" && o.status !== "merged" &&
        (o.candidateSource === "wall" || o.candidateSource === "storage-wall-run") &&
        !hasObservedWallSupport(o, walls)
    );
    assert.equal(unsupported.length, 0, `placements backed only by inferred room edges: ${unsupported.map((o) => o.id).join(", ")}`);
  });

  test(`${file}: placed storage/appliances are axis-aligned`, () => {
    const { result: r } = solveWithAdapterLogic(d);
    const bad = r.objects
      .filter((o) => o.status !== "rejected" && o.status !== "merged" && AXIAL_KINDS.has(o.category))
      .filter((o) => offCardinal(yawDeg(o)) > 6);
    assert.equal(bad.length, 0, `tilted wall furniture: ${bad.map((o) => `${o.category}@${offCardinal(yawDeg(o)).toFixed(0)}°`).join(", ")}`);
  });

  test(`${file}: deterministic`, () => {
    const key = (r) => JSON.stringify(r.objects.map((o) => [o.id, o.center[0].toFixed(4), o.center[1].toFixed(4), o.status]));
    assert.equal(key(solveWithAdapterLogic(d).result), key(solveWithAdapterLogic(d).result));
  });
}
