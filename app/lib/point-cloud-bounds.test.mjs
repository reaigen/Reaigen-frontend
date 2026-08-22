import assert from "node:assert/strict";
import test from "node:test";

import { robustPointCloudBounds } from "./point-cloud-bounds.ts";

test("isolated reconstruction outliers do not hide the room", () => {
  const positions = new Float32Array(1_001 * 3);
  for (let index = 0; index < 1_000; index += 1) {
    positions[index * 3] = (index % 20) - 10;
    positions[index * 3 + 1] = (Math.floor(index / 20) % 10) - 5;
    positions[index * 3 + 2] = (index % 7) / 2;
  }
  positions[3_000] = 10_000;
  positions[3_001] = -10_000;
  positions[3_002] = 10_000;

  const bounds = robustPointCloudBounds(positions);

  assert.ok(bounds.radius < 20, `unexpected radius ${bounds.radius}`);
  assert.ok(Math.abs(bounds.center[0]) < 2);
  assert.ok(Math.abs(bounds.center[1]) < 2);
});
