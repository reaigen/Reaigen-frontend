import assert from "node:assert/strict";
import test from "node:test";

import {
  boundedAngularVelocity,
  cameraMovementFrameSeconds,
  cameraMovementTargetIsEditable,
  cameraMovementKey,
  cameraRenderIsActive,
  cameraTouchPanDelta,
  cameraWalkDirection,
  savedCameraNavigationIsInstant,
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

test("camera editing recalls exact poses while previews animate", () => {
  assert.equal(savedCameraNavigationIsInstant("edit"), true);
  assert.equal(savedCameraNavigationIsInstant("initial"), true);
  assert.equal(savedCameraNavigationIsInstant("preview"), false);
});

test("camera controls do not strand WASD focus while text fields keep their keys", () => {
  assert.equal(cameraMovementTargetIsEditable({ tagName: "INPUT", type: "range" }), false);
  assert.equal(cameraMovementTargetIsEditable({ tagName: "BUTTON" }), false);
  assert.equal(cameraMovementTargetIsEditable({ tagName: "INPUT", type: "text" }), true);
  assert.equal(cameraMovementTargetIsEditable({ tagName: "TEXTAREA" }), true);
  assert.equal(cameraMovementTargetIsEditable({ tagName: "DIV", isContentEditable: true }), true);
});

test("dense scenes preserve WASD pace without accepting background-tab jumps", () => {
  assert.equal(cameraMovementFrameSeconds(16), 0.016);
  assert.equal(cameraMovementFrameSeconds(80), 0.08);
  assert.equal(cameraMovementFrameSeconds(500), 0.1);
  assert.equal(cameraMovementFrameSeconds(Number.NaN), 1 / 60);
});

test("the spatial editor sleeps only while idle and wakes for input", () => {
  const idleEditor = {
    viewerInitializing: false,
    immersiveControls: false,
    spatialNavigation: true,
    animationActive: false,
    pointersActive: false,
    renderBurstActive: false,
    coastYaw: 0,
    coastPitch: 0,
  };
  assert.equal(cameraRenderIsActive(idleEditor), false);
  assert.equal(cameraRenderIsActive({ ...idleEditor, renderBurstActive: true }), true);
  assert.equal(cameraRenderIsActive({ ...idleEditor, animationActive: true }), true);
  assert.equal(
    cameraRenderIsActive({ ...idleEditor, spatialNavigation: false }),
    true,
  );
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
