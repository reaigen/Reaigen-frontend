import assert from "node:assert/strict";
import test from "node:test";

import { parseTrainingIterations } from "./training-quality.ts";

const lookupPolicy = {
  minimum_iterations: 1200,
  maximum_iterations: 2400,
  iteration_step: 300,
};

test("iteration validation accepts values described by the Django lookup", () => {
  assert.equal(parseTrainingIterations("1200", lookupPolicy), 1200);
  assert.equal(parseTrainingIterations(1800, lookupPolicy), 1800);
  assert.equal(parseTrainingIterations("2400", lookupPolicy), 2400);
});

test("iteration validation rejects blanks, fractions, off-step values, and lookup bounds", () => {
  for (const value of ["", "   ", 0, 1199, 1350, 2401, "1200.5", "not-a-number", null, true]) {
    assert.equal(parseTrainingIterations(value, lookupPolicy), null, String(value));
  }
});

test("iteration validation fails closed without a valid lookup policy", () => {
  assert.equal(parseTrainingIterations("1200", null), null);
  assert.equal(parseTrainingIterations("1200", { ...lookupPolicy, iteration_step: 0 }), null);
  assert.equal(parseTrainingIterations("1200", { ...lookupPolicy, maximum_iterations: 1000 }), null);
});
