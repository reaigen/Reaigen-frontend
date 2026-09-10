import assert from "node:assert/strict";
import test from "node:test";

import { isRetryableGetHttpStatus } from "./retry-policy.ts";

test("429 stops immediately instead of extending a user throttle lockout", () => {
  assert.equal(isRetryableGetHttpStatus(429), false);
});

test("temporary gateway failures remain bounded retry candidates", () => {
  for (const status of [408, 425, 502, 503, 504, 520, 521, 522, 523, 524]) {
    assert.equal(isRetryableGetHttpStatus(status), true, String(status));
  }
});

test("authentication, authorization, validation, and conflict responses never retry", () => {
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert.equal(isRetryableGetHttpStatus(status), false, String(status));
  }
});
