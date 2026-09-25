import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const { NullEngine } = await import("@babylonjs/core/Engines/nullEngine.js");
const { Scene } = await import("@babylonjs/core/scene.js");
const { UniversalCamera } = await import("@babylonjs/core/Cameras/universalCamera.js");
const { Vector3 } = await import("@babylonjs/core/Maths/math.vector.js");
const { synchronizeSpinoffCamera, currentCameraTarget } = await import("./spinoff-camera-sync.ts");

function orbitCamera() {
  return {
    distance: 0, yawRadians: 0, pitchRadians: 0, rollRadians: 0, verticalFovRadians: 0,
    near: 0, far: 0, target: [0, 0, 0], published: 0,
    setTarget(next) { this.target = [...next]; this.published += 1; },
  };
}

function babylonCamera() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new UniversalCamera("viewer", new Vector3(0, 1, 0), scene);
  camera.setTarget(new Vector3(0, 1, 5));
  camera.getViewMatrix(); // the frame Babylon has already rendered
  return { camera, dispose: () => engine.dispose() };
}

test("Babylon's cached target lags a pose set this frame; the sync reads the current one", () => {
  const { camera, dispose } = babylonCamera();
  try {
    // A flight step: the camera climbs half a metre and keeps looking level.
    camera.position.set(0, 1.5, 1);
    camera.setTarget(new Vector3(0, 1.5, 6));
    const cached = camera.getTarget();
    assert.ok(Math.abs(cached.y - 1) < 1e-6, "getTarget() still answers with last frame's point");
    const fresh = currentCameraTarget(camera);
    assert.ok(Math.abs(fresh.y - 1.5) < 1e-6 && Math.abs(fresh.z - 6) < 1e-6);
  } finally {
    dispose();
  }
});

test("the Spinoff pose follows the pose set this frame, not last frame's target", () => {
  const { camera, dispose } = babylonCamera();
  try {
    camera.position.set(0, 1.5, 1);
    camera.setTarget(new Vector3(0, 1.5, 6));
    const spinoff = orbitCamera();
    synchronizeSpinoffCamera(spinoff, camera);
    // Aimed at last frame's target from this frame's position the pitch would
    // be about seven degrees down; the camera is level.
    assert.ok(Math.abs(spinoff.pitchRadians) < 1e-6, `pitch ${spinoff.pitchRadians}`);
    assert.ok(Math.abs(spinoff.rollRadians) < 1e-6, `roll ${spinoff.rollRadians}`);
    assert.ok(Math.abs(spinoff.target[1] - 1.5) < 1e-6 && Math.abs(spinoff.target[2] - 6) < 1e-6);
    assert.equal(spinoff.published, 1);
  } finally {
    dispose();
  }
});

test("a still camera is not re-published, so the renderer does not treat it as moving", () => {
  const { camera, dispose } = babylonCamera();
  try {
    const spinoff = orbitCamera();
    synchronizeSpinoffCamera(spinoff, camera);
    synchronizeSpinoffCamera(spinoff, camera);
    synchronizeSpinoffCamera(spinoff, camera);
    assert.equal(spinoff.published, 1);
  } finally {
    dispose();
  }
});
