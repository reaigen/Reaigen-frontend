import assert from "node:assert/strict";
import test from "node:test";

const { waitForFirstContentFrame } = await import("./first-content-frame.ts");

function fakeEngine({ contentAfterDraws = 2, throwFirst = 0 } = {}) {
  const state = { frame: 0, draws: 0, projected: 0, clock: 0, frames: [], overflow: false, selection: 1 };
  const probe = {
    draw() {
      state.draws += 1;
      if (state.draws <= throwFirst) throw new Error("INVALID_OPERATION");
      state.frame += 1;
      if (state.frame >= contentAfterDraws) state.projected = 480_000;
    },
    stats: () => ({ frame: state.frame, projectedSplats: state.projected, overflow: state.overflow, selection: state.selection }),
    requestFrame: (callback) => { state.frames.push(callback); },
    now: () => state.clock,
  };
  const tick = (ms = 16) => {
    state.clock += ms;
    const pending = state.frames.splice(0);
    pending.forEach((callback) => callback());
  };
  return { probe, state, tick };
}

test("the reveal waits for consecutive frames that show Gaussians", async () => {
  const { probe, state, tick } = fakeEngine({ contentAfterDraws: 2 });
  let outcome = null;
  void waitForFirstContentFrame(probe, { contentFrames: 3 }).then((value) => { outcome = value; });
  await Promise.resolve();
  assert.equal(outcome, null, "the first draw shows nothing yet");
  tick(); // frame 2: first content frame
  tick(); // frame 3
  await Promise.resolve();
  assert.equal(outcome, null, "two content frames are not three");
  tick(); // frame 4
  await Promise.resolve();
  assert.equal(outcome, "painted");
  assert.equal(state.draws, 4);
});

test("frames that overflowed the capacity, and the frame after a resample, do not count", async () => {
  const { probe, state, tick } = fakeEngine({ contentAfterDraws: 1 });
  let outcome = null;
  void waitForFirstContentFrame(probe, { contentFrames: 3 }).then((value) => { outcome = value; });
  // The first frames project the whole scene into a capacity that cannot
  // hold it: splats are dropped, the picture has holes.
  state.overflow = true;
  tick(); tick(); tick(); tick();
  await Promise.resolve();
  assert.equal(outcome, null, "overflowing frames are not the picture");
  // The readback settles the selection; the accumulated image restarts.
  state.overflow = false;
  state.selection = 0.31;
  tick();
  tick();
  await Promise.resolve();
  assert.equal(outcome, null, "the resample frame and one more are not three");
  tick();
  tick();
  await Promise.resolve();
  assert.equal(outcome, "painted");
});

test("a draw the backend refuses is retried on the next frame instead of failing the reveal", async () => {
  const { probe, tick } = fakeEngine({ contentAfterDraws: 1, throwFirst: 2 });
  let outcome = null;
  void waitForFirstContentFrame(probe, { contentFrames: 1 }).then((value) => { outcome = value; });
  tick();
  tick();
  await Promise.resolve();
  assert.equal(outcome, "painted");
});

test("an engine that never reports content still reveals after the bounded wait", async () => {
  const { probe, state, tick } = fakeEngine({ contentAfterDraws: Number.POSITIVE_INFINITY });
  let outcome = null;
  void waitForFirstContentFrame(probe, { timeoutMs: 100 }).then((value) => { outcome = value; });
  for (let i = 0; i < 6; i += 1) tick(16);
  await Promise.resolve();
  assert.equal(outcome, null);
  tick(16);
  await Promise.resolve();
  assert.equal(outcome, "timeout");
  assert.ok(state.draws >= 7, "it kept drawing while it waited");
});

test("a viewer torn down mid-wait stops without revealing", async () => {
  const { probe, tick } = fakeEngine({ contentAfterDraws: Number.POSITIVE_INFINITY });
  let gone = false;
  let outcome = null;
  void waitForFirstContentFrame({ ...probe, aborted: () => gone }).then((value) => { outcome = value; });
  gone = true;
  tick();
  await Promise.resolve();
  assert.equal(outcome, "aborted");
});
