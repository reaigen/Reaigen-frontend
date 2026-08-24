import assert from "node:assert/strict";
import test from "node:test";

import {
  nextViewerMotionFrameTimestamp,
  viewerRenderDpr,
  viewerSortUpdateThreshold,
} from "./viewer-performance.ts";

test("balanced shared tours bound a Retina MacBook backbuffer", () => {
  const quality = viewerRenderDpr(2, 1512, 982, false, false, "quality");
  const balanced = viewerRenderDpr(2, 1512, 982, false, false, "balanced");

  assert.equal(quality, 2);
  assert.ok(balanced > 1.7 && balanced < 1.75);
  assert.ok(1512 * 982 * balanced * balanced <= 4_500_001);
});

test("balanced touch delivery stays crisp without using phone DPR 3", () => {
  const balanced = viewerRenderDpr(3, 393, 852, true, false, "balanced");
  assert.equal(balanced, 1.75);
});

test("authoring keeps its precision budget regardless of delivery profile", () => {
  const quality = viewerRenderDpr(2, 1512, 982, false, true, "quality");
  const balanced = viewerRenderDpr(2, 1512, 982, false, true, "balanced");
  assert.equal(quality, balanced);
  assert.equal(quality, 2);
});

test("balanced motion renders at sixty frames on a 120 Hz display", () => {
  let clock = null;
  let rendered = 0;
  for (let frame = 0; frame < 120; frame += 1) {
    const next = nextViewerMotionFrameTimestamp(
      clock,
      frame * (1000 / 120),
      "balanced",
    );
    if (next != null) {
      clock = next;
      rendered += 1;
    }
  }
  assert.ok(rendered >= 59 && rendered <= 61);
});

test("quality motion remains uncapped and balanced recovers after a stall", () => {
  assert.equal(nextViewerMotionFrameTimestamp(10, 18, "quality"), 18);
  assert.equal(nextViewerMotionFrameTimestamp(10, 18, "balanced"), null);
  assert.equal(nextViewerMotionFrameTimestamp(10, 500, "balanced"), 500);
});

test("balanced playback ignores tiny sort jitter without weakening authoring", () => {
  assert.equal(viewerSortUpdateThreshold(false, "balanced"), 0.0025);
  assert.equal(viewerSortUpdateThreshold(false, "quality"), 0.0001);
  assert.equal(viewerSortUpdateThreshold(true, "balanced"), 0.0001);
});
