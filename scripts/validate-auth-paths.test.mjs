import assert from "node:assert/strict";
import test from "node:test";

import { authPathCarriesSession } from "../app/lib/server/auth-paths.ts";

/**
 * The auth proxy used to forward no credentials at all, so every authenticated
 * endpoint under /api/v1/core/auth/ answered 401 — and the web client reads any
 * 401 as a dead session, so opening Settings signed people out of the whole app.
 */
test("endpoints that need a session are sent one", () => {
  for (const path of [
    "totp/status",
    "totp/setup",
    "totp/confirm",
    "totp/disable",
    "linked-accounts",
    "change-password",
    "link/phone/request-otp",
    "link/phone/verify-otp",
  ]) {
    assert.equal(authPathCarriesSession(path), true, path);
  }
});

/**
 * The mirror risk: DRF authenticates before it checks permissions, so a stale
 * bearer token turns an AllowAny view into a 401. Sending one to `login` would
 * lock out the person trying to recover a broken session.
 */
test("the flows that establish a session are sent bare", () => {
  for (const path of [
    "login",
    "register",
    "logout",
    "refresh",
    "token/refresh",
    "verify-email",
    "resend-verification",
    "password-reset/request",
    "password-reset/validate",
    "password-reset/confirm",
    "password-reset/sms/request",
    "password-reset/sms/confirm",
  ]) {
    assert.equal(authPathCarriesSession(path), false, path);
  }
});

test("trailing and leading slashes do not change the verdict", () => {
  assert.equal(authPathCarriesSession("login/"), false);
  assert.equal(authPathCarriesSession("/login"), false);
  assert.equal(authPathCarriesSession("/login/"), false);
  assert.equal(authPathCarriesSession("totp/status/"), true);
});

test("an unrecognised endpoint defaults to carrying the session", () => {
  // Failing this way round is the recoverable one: a new authenticated endpoint
  // works, whereas a missed one returned 401 and logged the user out.
  assert.equal(authPathCarriesSession("some/new/account-endpoint"), true);
});
