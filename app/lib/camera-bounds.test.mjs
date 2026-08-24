import assert from "node:assert/strict";
import test from "node:test";

import { cameraBoundsFor, clampCameraPosition } from "./camera-bounds.ts";

/** A ~4x3m room, floor at 0, ceiling at 2.5m. */
const ROOM = {
  footprint: { minX: -2, maxX: 2, minZ: -1.5, maxZ: 1.5 },
  floorY: 0,
  ceilingY: 2.5,
  radius: 2.5,
};

test("a camera inside the room is left exactly where it is", () => {
  const result = clampCameraPosition({ x: 0.4, y: 1.55, z: -0.2 }, ROOM);
  assert.deepEqual(
    { x: result.x, y: result.y, z: result.z },
    { x: 0.4, y: 1.55, z: -0.2 },
  );
  assert.equal(result.clamped, false);
});

test("zooming out to the void is pulled back to the boundary", () => {
  // What the screenshot showed: far outside the volume, looking at floaters.
  const result = clampCameraPosition({ x: 0, y: 1.5, z: -40 }, ROOM);
  assert.equal(result.clamped, true);
  const bounds = cameraBoundsFor(ROOM);
  assert.equal(result.z, bounds.minZ);
  // Only the offending axis moves; the rest of the pose is preserved.
  assert.equal(result.x, 0);
  assert.equal(result.y, 1.5);
});

test("every axis is bounded, not just the one you flew along", () => {
  const bounds = cameraBoundsFor(ROOM);
  for (const [axis, far] of [["x", 900], ["y", 900], ["z", 900]]) {
    const high = clampCameraPosition({ x: 0, y: 1, z: 0, [axis]: far }, ROOM);
    const low = clampCameraPosition({ x: 0, y: 1, z: 0, [axis]: -far }, ROOM);
    assert.equal(high[axis], bounds[`max${axis.toUpperCase()}`], `${axis} high`);
    assert.equal(low[axis], bounds[`min${axis.toUpperCase()}`], `${axis} low`);
  }
});

test("there is enough slack to back against a wall and still frame it", () => {
  const bounds = cameraBoundsFor(ROOM);
  assert.ok(bounds.minX < ROOM.footprint.minX, "should allow passing the wall a little");
  assert.ok(
    ROOM.footprint.minX - bounds.minX < ROOM.radius,
    "but nowhere near far enough to leave the room",
  );
});

test("the floor and ceiling are not hard walls", () => {
  const bounds = cameraBoundsFor(ROOM);
  assert.ok(bounds.minY < ROOM.floorY);
  assert.ok(bounds.maxY > ROOM.ceilingY);
});

test("a floor and ceiling recorded the wrong way round still bound the camera", () => {
  const inverted = { ...ROOM, floorY: 2.5, ceilingY: 0 };
  const bounds = cameraBoundsFor(inverted);
  assert.ok(bounds.minY < bounds.maxY, "an inverted pair must not invert the box");
  assert.equal(clampCameraPosition({ x: 0, y: 500, z: 0 }, inverted).y, bounds.maxY);
});

test("a degenerate footprint still leaves room to move", () => {
  // One capture spot, or a half-failed reconstruction: without a floor on the
  // extents this collapses to a point and the camera cannot move at all.
  const pinhole = {
    footprint: { minX: 1, maxX: 1, minZ: 1, maxZ: 1 },
    floorY: 0,
    ceilingY: 0,
    radius: 0,
  };
  const bounds = cameraBoundsFor(pinhole);
  assert.ok(bounds.maxX - bounds.minX > 1, "needs a usable width");
  assert.ok(bounds.maxY - bounds.minY > 0.5, "needs usable height");
});

test("without a known volume the camera is left alone", () => {
  // Bounds are unknown until the splat is parsed; clamping to a guess would
  // trap the camera at the origin while the scene loads.
  const result = clampCameraPosition({ x: 99, y: 99, z: 99 }, null);
  assert.deepEqual(
    { x: result.x, y: result.y, z: result.z, clamped: result.clamped },
    { x: 99, y: 99, z: 99, clamped: false },
  );
});

test("clamping is idempotent", () => {
  const once = clampCameraPosition({ x: 0, y: 1.5, z: -40 }, ROOM);
  const twice = clampCameraPosition(once, ROOM);
  assert.deepEqual(
    { x: twice.x, y: twice.y, z: twice.z },
    { x: once.x, y: once.y, z: once.z },
  );
  assert.equal(twice.clamped, false, "a settled camera must not be written every frame");
});

test("slack scales with the room, so a large space is not clamped to a small one", () => {
  const hall = { ...ROOM, radius: 12 };
  assert.ok(cameraBoundsFor(hall).maxX > cameraBoundsFor(ROOM).maxX);
});
