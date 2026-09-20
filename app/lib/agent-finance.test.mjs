import assert from "node:assert/strict";
import test from "node:test";
import { rentalReturns } from "./agent-finance.ts";

test("missing costs permit gross yield but cannot invent a net return", () => {
  assert.deepEqual(rentalReturns(100000, 500), { grossYield: 6, capRate: null });
  assert.deepEqual(rentalReturns(100000, 500, 0), { grossYield: 6, capRate: 6 });
});

test("operating losses and explicit zero rent remain visible", () => {
  assert.deepEqual(rentalReturns(100000, 500, 10000), { grossYield: 6, capRate: -4 });
  assert.deepEqual(rentalReturns(100000, 0, 1000), { grossYield: 0, capRate: -1 });
  assert.deepEqual(rentalReturns(0, 500, 0), { grossYield: null, capRate: null });
});
