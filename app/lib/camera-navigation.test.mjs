import assert from "node:assert/strict";
import test from "node:test";

import {
  boundedAngularVelocity,
  cameraMovementFrameSeconds,
  cameraMovementTargetIsEditable,
  cameraMovementKey,
  cameraNavigationShouldRestorePointerControls,
  cameraRenderIsActive,
  cameraTouchPanDelta,
  cameraWalkDirection,
  savedCameraNavigationIsInstant,
  stableCameraPreviewPose,
  stableCameraReferenceUp,
  stableCameraUp,
} from "./camera-navigation.ts";
import { transformCanonicalDirection } from "./global-scene-transform.ts";

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

test("camera preview stays on the authored segment and lands exactly", () => {
  const fromPosition = [1, 2, 3];
  const toPosition = [9, 6, -5];
  const fromForward = [0, 0, 1];
  const toForward = [1, 0, 0];
  const midpoint = stableCameraPreviewPose(
    fromPosition,
    toPosition,
    fromForward,
    toForward,
    [0, 1, 0],
    [0, 1, 0],
    0.5,
  );
  closeTo(midpoint.position, [5, 4, -1]);
  assert.ok(midpoint.position.every((value, axis) => (
    value >= Math.min(fromPosition[axis], toPosition[axis])
    && value <= Math.max(fromPosition[axis], toPosition[axis])
  )));
  assert.ok(Math.abs(
    midpoint.forward[0] * midpoint.up[0]
    + midpoint.forward[1] * midpoint.up[1]
    + midpoint.forward[2] * midpoint.up[2]
  ) < 1e-9);

  const destination = stableCameraPreviewPose(
    fromPosition,
    toPosition,
    fromForward,
    toForward,
    [0, 1, 0],
    [0, 1, 0],
    1,
  );
  closeTo(destination.position, toPosition);
  closeTo(destination.forward, toForward);
  closeTo(destination.up, [0, 1, 0]);
});

test("camera preview crosses the yaw seam without a full spin", () => {
  const angle = 179 * Math.PI / 180;
  const pose = stableCameraPreviewPose(
    [0, 0, 0],
    [0, 0, 0],
    [Math.cos(angle), 0, Math.sin(angle)],
    [Math.cos(-angle), 0, Math.sin(-angle)],
    [0, 1, 0],
    [0, 1, 0],
    0.5,
  );
  assert.ok(pose.forward[0] < -0.999);
  assert.ok(Math.abs(pose.forward[2]) < 1e-9);
});

test("saved reference-up axes preserve pitch semantics instead of becoming roll", () => {
  const forward = [-0.6628051253128631, -0.05041730962092538, -0.7470926721294942];
  const referenceUp = [0.8455272099351238, -0.022288584508139295, -0.5334669214299502];
  const persistedUp = stableCameraReferenceUp(referenceUp);
  const referenceLength = Math.hypot(...referenceUp);
  closeTo(persistedUp, referenceUp.map((value) => value / referenceLength));
  assert.ok(Math.abs(
    forward[0] * persistedUp[0]
    + forward[1] * persistedUp[1]
    + forward[2] * persistedUp[2]
  ) > 0.1);

  // Projection remains available for calculations that need an orthonormal
  // basis, but it is deliberately not what gets persisted as camera upVector.
  const up = stableCameraUp(forward, persistedUp);
  assert.ok(Math.abs(
    forward[0] * up[0] + forward[1] * up[1] + forward[2] * up[2]
  ) < 1e-9);
  assert.ok(Math.abs(Math.hypot(...up) - 1) < 1e-9);

  const worldReferenceUp = transformCanonicalDirection(persistedUp, {
    translation: [0, 0, 0],
    rotationDeg: [147.76, 88.84, -88.49],
    scale: 1,
    scale3: [1, 1, 1],
  });
  assert.ok(Math.hypot(worldReferenceUp[0], worldReferenceUp[2]) < 1e-7);
  assert.ok(Math.abs(worldReferenceUp[1] - 1) < 1e-9);
  // Initialization and later preview recalls must compare up axes in the
  // same presentation space. Otherwise this canonical vector's small negative
  // Y component can incorrectly select the upside-down world hemisphere.
  const initializedWorldUp = stableCameraReferenceUp(worldReferenceUp);
  const recalledWorldUp = stableCameraReferenceUp(
    worldReferenceUp,
    initializedWorldUp,
  );
  closeTo(initializedWorldUp, worldReferenceUp);
  closeTo(recalledWorldUp, worldReferenceUp);
  assert.ok(recalledWorldUp[1] > 0.999999);
});

test("pitched Dr Johnson preview keeps a level Y-up horizon without roll", () => {
  const fromForward = [0.9830839934765457, -0.160746834558497, 0.08778563065576496];
  const toForward = [-0.9204352786692244, -0.30216543116480454, -0.24798175334103745];
  for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
    const pose = stableCameraPreviewPose(
      [0, 0, 0],
      [1, 2, 3],
      fromForward,
      toForward,
      [0, 1, 0],
      [0, 1, 0],
      progress,
    );
    closeTo(pose.up, [0, 1, 0]);
    closeTo(
      stableCameraUp(pose.forward, pose.up),
      stableCameraUp(pose.forward, [0, 1, 0]),
    );
  }
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

test("camera input ownership recovers after saved-shot navigation", () => {
  assert.equal(cameraNavigationShouldRestorePointerControls(false, false), true);
  assert.equal(cameraNavigationShouldRestorePointerControls(true, false), false);
  assert.equal(cameraNavigationShouldRestorePointerControls(false, true), false);
});

test("WASD stays in the ground plane and diagonal speed is normalized", () => {
  // Facing +z with +y up, the camera's right is -x: right is cross(forward, up),
  // matching SpinoffOrbitCamera.right ([-forward.z, 0, forward.x]) in the engine
  // that flies the Splatfiction viewport. This previously asserted +x, which is
  // cross(up, forward) — the opposite vector — so the suite agreed with the code
  // while both had D strafing left and A strafing right in the editor.
  closeTo(
    cameraWalkDirection([0, 0.8, 1], [0, 1, 0], new Set(["w", "d"])),
    [-Math.SQRT1_2, 0, Math.SQRT1_2],
  );
});

test("A and D strafe to opposite sides, D to the camera's right", () => {
  // Facing -z, the OpenGL/right-handed convention this scene uses, the right
  // hand side is +x. Asserted from a second facing so the pair cannot both be
  // flipped again without one of these failing.
  closeTo(cameraWalkDirection([0, 0, -1], [0, 1, 0], new Set(["d"])), [1, 0, 0]);
  closeTo(cameraWalkDirection([0, 0, -1], [0, 1, 0], new Set(["a"])), [-1, 0, 0]);
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
