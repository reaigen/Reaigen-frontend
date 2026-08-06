import test from "node:test";
import assert from "node:assert/strict";

import { isSafeProxyPath, isSafeProxySegment } from "../app/lib/server/proxy-path.ts";

/**
 * Every path template the API client actually builds, taken from
 * app/lib/api/client.ts. If a change to the validator rejects one of these,
 * a real product call has started 400ing.
 */
const LEGITIMATE_PATHS = [
  // core routes
  ["users", "me"],
  ["users", "available_preferences"],
  ["users", "update_localization"],
  ["profiles", "me"],
  ["profiles", "presign-avatar"],
  ["billing", "me"],
  ["notifications", "read-all"],
  ["notifications", "8231", "read"],
  ["notification-devices", "web-push-config"],
  ["personalized-data", "me"],
  // drafts and nested resources
  ["drafts"],
  ["drafts", "1421"],
  ["drafts", "1421", "tours"],
  ["drafts", "1421", "tours", "77"],
  ["drafts", "1421", "set-active-splat"],
  ["drafts", "1421", "translate-description"],
  ["draft-data", "9"],
  ["floorplans", "12", "rendering"],
  // uploads
  ["uploads", "presign"],
  ["uploads", "confirm"],
  ["uploads", "gallery"],
  // tours
  ["tours", "77", "assets", "3", "confirm"],
  ["tours", "77", "assets", "3", "abort"],
  ["tours", "77", "thumbnail"],
  // public share links — tokens are secrets.token_urlsafe(32): [A-Za-z0-9_-]
  ["shared", "kR3n-_QpZ8xW7vB2tL9sYdA4cE6gH1jM0oNfU5iP"],
  ["shared", "kR3n-_QpZ8xW7vB2tL9sYdA4cE6gH1jM0oNfU5iP", "verify-pin"],
  ["shared", "kR3n-_QpZ8xW7vB2tL9sYdA4cE6gH1jM0oNfU5iP", "tour-viewer"],
  // content documents — backend lookup_value_regex is [a-z0-9_.-]+, so a dot
  // *inside* a segment is legitimate and must not be confused with a dot-segment
  ["content", "documents", "terms"],
  ["content", "documents", "privacy.v2"],
  ["content", "documents", "gdpr-2026.01"],
  ["content", "documents", "accept"],
  // lookups + agent + web-creation
  ["lookups", "asset-types", "by_code"],
  ["reai-agent", "tool-permissions"],
  ["reai-agent", "workspace", "drafts", "1421", "history", "5", "restore"],
  ["web-creation", "drafts"],
  // auth proxy paths
  ["login"],
  ["logout"],
  ["register"],
  ["token", "refresh"],
  ["change-password"],
  ["totp", "confirm"],
  ["link", "phone", "request-otp"],
  ["password-reset", "sms", "confirm"],
  ["unlink", "social", "google"],
];

test("every path the API client builds is accepted", () => {
  for (const path of LEGITIMATE_PATHS) {
    assert.equal(
      isSafeProxyPath(path),
      true,
      `legitimate path rejected: ${path.join("/")}`,
    );
  }
});

test("a dot inside a segment stays legal — only whole dot-segments are not", () => {
  assert.equal(isSafeProxySegment("privacy.v2"), true);
  assert.equal(isSafeProxySegment("gdpr-2026.01"), true);
  assert.equal(isSafeProxySegment("..."), true);
  assert.equal(isSafeProxySegment(".hidden"), true);
  assert.equal(isSafeProxySegment("a..b"), true);
});

test("raw dot-segments are rejected", () => {
  for (const segment of [".", ".."]) {
    assert.equal(isSafeProxySegment(segment), false, `accepted ${segment}`);
  }
  assert.equal(isSafeProxyPath(["drafts", "..", "..", "admin"]), false);
  assert.equal(isSafeProxyPath(["..", "..", "admin"]), false);
  assert.equal(isSafeProxyPath(["shared", "tok", ".."]), false);
});

/**
 * This is the vector that actually reached the handler, confirmed against a
 * running dev server on 2026-08-06.
 *
 * Next.js normalizes *single*-encoded dot-segments itself, so `..` and `%2e%2e`
 * never arrive (they 404 at the router). A **double**-encoded request does
 * arrive: Next decodes `%252e%252e` exactly once and hands the handler the
 * literal segment `%2e%2e`, which the WHATWG URL parser inside `fetch` then
 * resolves as `..`. Observed end to end:
 *
 *   GET /api/reaigen/%252e%252e/%252e%252e/%252e%252e/admin/
 *     -> segments ["%2e%2e","%2e%2e","%2e%2e","admin"]
 *     -> target pathname "/admin/"   (Django admin, caller's bearer attached)
 *
 * So these assertions guard a reproduced escape, not a hypothetical one.
 */
test("percent-encoded dot-segments are rejected in every spelling", () => {
  const encoded = [
    "%2e",
    "%2E",
    "%2e%2e",
    "%2E%2E",
    "%2e%2E",
    ".%2e",
    "%2e.",
    ".%2E",
    "%2E.",
  ];
  for (const segment of encoded) {
    assert.equal(isSafeProxySegment(segment), false, `accepted ${segment}`);
  }
});

test("a smuggled separator inside one segment cannot hide a dot-segment", () => {
  // A decoded %2F leaves the router delivering one segment that still contains
  // a separator; the pieces on either side must be checked individually.
  assert.equal(isSafeProxySegment("drafts/../admin"), false);
  assert.equal(isSafeProxySegment("../admin"), false);
  assert.equal(isSafeProxySegment("drafts/.."), false);
  assert.equal(isSafeProxySegment("a/b/c"), true);
});

test("URL delimiters that re-open parsing are rejected", () => {
  assert.equal(isSafeProxySegment("drafts\\..\\admin"), false);
  assert.equal(isSafeProxySegment("me?x=1"), false);
  assert.equal(isSafeProxySegment("me#frag"), false);
  assert.equal(isSafeProxySegment("back\\slash"), false);
});

test("an empty path is rejected", () => {
  assert.equal(isSafeProxyPath([]), false);
});

/**
 * Pins the reason the validator exists. If these assertions ever fail, the
 * URL parser stopped normalizing dot-segments and the guard's rationale — not
 * just its implementation — needs revisiting.
 */
test("fetch's URL parser really does resolve dot-segments out of the prefix", () => {
  const base = "http://backend:8000";
  const target = (segments) =>
    new URL(`${base}/api/v1/reaigen/${segments.join("/")}/`).pathname;

  // Two levels escape /api/v1/reaigen/ into /api/ ...
  assert.equal(target(["..", "..", "admin"]), "/api/admin/");
  // ... and three land exactly on the Django admin route nginx publishes.
  assert.equal(target(["..", "..", "..", "admin"]), "/admin/");

  // The percent-encoded spellings normalize identically, which is why the
  // validator has to match them and not just the literal dots.
  assert.equal(target(["%2e%2e", "%2e%2e", "admin"]), "/api/admin/");
  assert.equal(target(["%2e%2e", "%2e%2e", "%2e%2e", "admin"]), "/admin/");

  // A backslash is a path separator for special schemes, so it traverses too.
  assert.equal(
    new URL(`${base}/api/v1/reaigen/..\\..\\admin`).pathname,
    "/api/admin",
  );

  // Control: a legitimate dotted document key does not move up a level.
  assert.equal(
    new URL(`${base}/api/v1/reaigen/content/documents/privacy.v2/`).pathname,
    "/api/v1/reaigen/content/documents/privacy.v2/",
  );
});
