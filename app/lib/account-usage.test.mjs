import assert from "node:assert/strict";
import test from "node:test";

import { resolveQuotaPresentation } from "./account-usage.ts";

test("zero is unavailable and only minus one is unlimited", () => {
  assert.equal(
    resolveQuotaPresentation({ used: 0, limit: 0 }, true).kind,
    "unavailable",
  );
  assert.equal(
    resolveQuotaPresentation({ used: 17, limit: -1 }, true).kind,
    "unlimited",
  );
});

test("a product block wins over a positive future quota", () => {
  assert.deepEqual(
    resolveQuotaPresentation({ used: 0, limit: 5 }, false),
    { kind: "blocked", used: 0, limit: null, percent: 0 },
  );
});

test("limited usage is clamped without changing the server values", () => {
  assert.deepEqual(
    resolveQuotaPresentation({ used: 7, limit: 5 }, true),
    { kind: "limited", used: 7, limit: 5, percent: 100 },
  );
});

test("missing access or quota stays unknown instead of inventing permission", () => {
  assert.equal(resolveQuotaPresentation(null, true).kind, "unknown");
  assert.equal(
    resolveQuotaPresentation({ used: 0, limit: 3 }, null).kind,
    "unknown",
  );
});

