import assert from "node:assert/strict";
import test from "node:test";

import {
  boundedAngularVelocity,
  cameraMovementKey,
  cameraTouchPanDelta,
  cameraWalkDirection,
} from "./camera-navigation.ts";

const closeTo = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9));
};

test("physical navigation keys win over the active keyboard layout", () => {
  assert.equal(cameraMovementKey({ code: "KeyW", key: "z" }), "w");
  assert.equal(cameraMovementKey({ code: "", key: "A" }), "a");
  assert.equal(cameraMovementKey({ code: "Digit1", key: "1" }), null);
});

test("WASD stays in the ground plane and diagonal speed is normalized", () => {
  closeTo(
    cameraWalkDirection([0, 0.8, 1], [0, 1, 0], new Set(["w", "d"])),
    [Math.SQRT1_2, 0, Math.SQRT1_2],
  );
});

test("Q and E follow a transformed scene up axis", () => {
  closeTo(cameraWalkDirection([0, 1, 0], [0, 0, 1], new Set(["e"])), [0, 0, 1]);
  closeTo(cameraWalkDirection([0, 1, 0], [0, 0, 1], new Set(["q"])), [0, 0, -1]);
});

test("opposing movement keys cancel without drift", () => {
  closeTo(
    cameraWalkDirection([0, 0, 1], [0, 1, 0], new Set(["w", "s", "a", "d", "q", "e"])),
    [0, 0, 0],
  );
});

test("two-pointer pan follows the camera plane without changing depth", () => {
  closeTo(
    cameraTouchPanDelta([0, 0, 1], [0, 1, 0], 20, -10, 0.01),
    [-0.2, -0.1, 0],
  );
});

test("optional coast velocity is bounded and rejects invalid timing", () => {
  assert.equal(boundedAngularVelocity(0.8, 0.01), 2.4);
  assert.equal(boundedAngularVelocity(-0.8, 0.01), -2.4);
  assert.equal(boundedAngularVelocity(0.2, 0), 0);
});
