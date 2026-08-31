import assert from "node:assert/strict";
import test from "node:test";

import { GaussianSortMotionController } from "./gaussian-sort-motion.ts";

function fakeMesh(threshold = 0.0025) {
  const calls = [];
  return {
    viewUpdateThreshold: threshold,
    _canPostToWorker: true,
    _sortIsDirty: false,
    _postToWorker(forced) {
      calls.push(forced);
    },
    calls,
  };
}

test("Gaussian sorting stays frozen for the complete camera movement", () => {
  const mesh = fakeMesh();
  const controller = new GaussianSortMotionController(120);

  controller.markMoving([mesh], 1_000);
  assert.equal(mesh.viewUpdateThreshold, Number.POSITIVE_INFINITY);
  assert.equal(controller.settle(1_119), false);

  // Another pose refreshes the lease instead of briefly releasing the worker.
  controller.markMoving([mesh], 1_100);
  assert.equal(controller.settle(1_219), false);
  assert.deepEqual(mesh.calls, []);
});

test("the settled pose restores the threshold and requests one exact sort", () => {
  const mesh = fakeMesh(0.0001);
  const controller = new GaussianSortMotionController(100);

  controller.markMoving([mesh], 20);
  assert.equal(controller.settle(120), true);
  assert.equal(mesh.viewUpdateThreshold, 0.0001);
  assert.equal(mesh._sortIsDirty, false);
  assert.deepEqual(mesh.calls, [true]);
  assert.equal(controller.settle(500), false);
  assert.deepEqual(mesh.calls, [true]);
});

test("an in-flight worker queues the final pose instead of losing it", () => {
  const mesh = fakeMesh();
  mesh._canPostToWorker = false;
  const controller = new GaussianSortMotionController(80);

  controller.markMoving([mesh], 0);
  assert.equal(controller.settle(80), true);
  assert.equal(mesh._sortIsDirty, true);
  assert.deepEqual(mesh.calls, [true]);
});

test("late meshes join an active motion lease and teardown is side-effect free", () => {
  const primary = fakeMesh(0.0025);
  const composition = fakeMesh(0.004);
  const controller = new GaussianSortMotionController();

  controller.markMoving([primary], 0);
  controller.markMoving([primary, composition], 16);
  assert.equal(composition.viewUpdateThreshold, Number.POSITIVE_INFINITY);

  controller.dispose();
  assert.equal(primary.viewUpdateThreshold, 0.0025);
  assert.equal(composition.viewUpdateThreshold, 0.004);
  assert.deepEqual(primary.calls, []);
  assert.deepEqual(composition.calls, []);
});
