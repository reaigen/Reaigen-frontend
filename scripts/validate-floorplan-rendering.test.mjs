import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { conditionWallSegmentsForPresentation } from "../app/lib/floorplan-wall-conditioning.ts";

const fixture = async (name) =>
  JSON.parse(
    await readFile(
      new URL("../fixtures/floorplan/" + name, import.meta.url),
      "utf8"
    )
  );

test("11913 closes only the evidence-supported exterior run", async () => {
  const input = await fixture("draft-11913-legacy-room.json");
  const output = conditionWallSegmentsForPresentation(
    input.walls,
    input.interior,
    input.floorPolys
  );
  const top = output.find(
    ([[, z1], [, z2]]) =>
      Math.abs(z1 - 2.224) < 0.03 && Math.abs(z2 - 2.224) < 0.03
  );
  assert.ok(top, "completed exterior run is missing");
  assert.ok(Math.min(top[0][0], top[1][0]) <= -1.5);
  assert.ok(Math.max(top[0][0], top[1][0]) >= 2.5);
  assert.ok(
    output.some(
      ([[x1, z1], [x2, z2]]) =>
        Math.abs(x1 + 1.519) < 0.03 &&
        Math.abs(x2 + 1.519) < 0.03 &&
        Math.min(z1, z2) <= -0.17 &&
        Math.max(z1, z2) >= 2.22
    ),
    "measured L-shaped return was lost"
  );
});

test("11949 does not invent an unsupported rectangular bottom wall", async () => {
  const input = await fixture("draft-11949-captured-input.json");
  const output = conditionWallSegmentsForPresentation(
    input.walls,
    input.interior,
    input.floorPolys
  );
  assert.equal(
    output.some(
      ([[x1, z1], [x2, z2]]) =>
        Math.abs(z1 + 2.506) < 0.03 &&
        Math.abs(z2 + 2.506) < 0.03 &&
        Math.min(x1, x2) < -1.8
    ),
    false
  );
});

test("captured floor polygons replace fragmented legacy walls", () => {
  const polygon = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ];
  const output = conditionWallSegmentsForPresentation(
    [[[0, 0], [0.4, 0]]],
    [2, 1.5],
    [polygon]
  );
  assert.equal(output.length, 4);
  assert.deepEqual(output[0], [[0, 0], [4, 0]]);
});

test("weak exterior evidence remains disconnected", () => {
  const walls = [
    [[0, 0], [0.3, 0]],
    [[3.7, 0], [4, 0]],
    [[0, 0], [0, 3]],
    [[4, 0], [4, 3]],
  ];
  const output = conditionWallSegmentsForPresentation(walls, [2, 1.5]);
  const horizontalRuns = output.filter(
    ([[, z1], [, z2]]) => Math.abs(z1) < 1e-6 && Math.abs(z2) < 1e-6
  );
  assert.equal(horizontalRuns.length, 2);
});
