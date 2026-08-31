import assert from "node:assert/strict";
import test from "node:test";

import {
  TRAINING_PROFILE_DEFAULTS,
  parseTrainingIterations,
} from "./training-quality.ts";

test("training profiles map speed and quality to explicit compute settings", () => {
  assert.deepEqual(TRAINING_PROFILE_DEFAULTS.fast, {
    resolution: "res2",
    iterations: 5350,
  });
  assert.deepEqual(TRAINING_PROFILE_DEFAULTS.balanced, {
    resolution: "res2",
    iterations: 15000,
  });
  assert.deepEqual(TRAINING_PROFILE_DEFAULTS.quality, {
    resolution: "res1",
    iterations: 30000,
  });
});

test("iteration validation accepts engine default and bounded whole numbers", () => {
  assert.equal(parseTrainingIterations("0"), 0);
  assert.equal(parseTrainingIterations("1000"), 1000);
  assert.equal(parseTrainingIterations(30000), 30000);
  assert.equal(parseTrainingIterations("60000"), 60000);
});

test("iteration validation rejects blanks, fractions, and unsafe bounds", () => {
  for (const value of ["", "   ", 999, 60001, "1000.5", "not-a-number", null, true]) {
    assert.equal(parseTrainingIterations(value), null, String(value));
  }
});
