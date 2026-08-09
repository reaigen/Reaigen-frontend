import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CAMERA_FOV_DEGREES,
  DEFAULT_CAMERA_FOV_RADIANS,
  cameraFovDegrees,
  cameraFovRadians,
} from "./camera-coordinates.ts";

test("an unsaved viewport starts with the same natural 60 degree lens as camera authoring", () => {
  assert.equal(DEFAULT_CAMERA_FOV_DEGREES, 60);
  assert.equal(DEFAULT_CAMERA_FOV_RADIANS, Math.PI / 3);
  assert.ok(Math.abs(cameraFovDegrees(DEFAULT_CAMERA_FOV_RADIANS) - 60) < 1e-10);
  assert.equal(cameraFovRadians(DEFAULT_CAMERA_FOV_DEGREES), Math.PI / 3);
});

test("authored camera FOV values remain unchanged", () => {
  assert.equal(cameraFovRadians(0.66), 0.66);
  assert.equal(cameraFovRadians(72), 72 * Math.PI / 180);
});
