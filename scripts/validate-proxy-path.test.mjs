import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { deflateSync } from "node:zlib";

import { isSafeProxyPath, isSafeProxySegment } from "../app/lib/server/proxy-path.ts";
import { proxyBackendTimeoutMs } from "../app/lib/server/backend-fetch.ts";

test("agent composition outlives both model deadlines without slowing unrelated routes", () => {
  for (const path of ["reai-agent/workspace/source-import", "reai-agent/workspace/assist", "reai-agent/drafts/12/assist"]) {
    assert.ok(proxyBackendTimeoutMs(path) > 2 * 45_000 + 2 * 3050, path);
    assert.ok(proxyBackendTimeoutMs(path) < 120_000, path);
  }
  assert.equal(proxyBackendTimeoutMs("users/me"), 5_000);
  for (const path of ["reai-agent/workspace/source-import/id/status", "drafts", "reai-agent/workspace/apply"]) {
    assert.equal(proxyBackendTimeoutMs(path), undefined, path);
  }
});

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") return nextResolve("next/server.js", context);
  try { return nextResolve(specifier, context); } catch (error) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });

function compressedDocument() {
  const content = deflateSync(Buffer.from("BT /F1 12 Tf 40 740 Td (Apartment, 85 m2, 240000 EUR. Technical report.) Tj ET"));
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`), content, Buffer.from("\nendstream")]),
  ];
  const parts = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(parts.reduce((total, part) => total + part.length, 0));
    parts.push(Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n"));
  }
  const xref = parts.reduce((total, part) => total + part.length, 0);
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return Buffer.concat(parts);
}

test("real proxy forwards multipart document bytes unchanged, including after token refresh", async () => {
  const received = [];
  let refreshed = false;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (request.url === "/api/v1/core/auth/refresh/") {
      refreshed = true;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ access: "fixture-refreshed", refresh: "fixture-rotated" }));
      return;
    }
    const formRequest = new Request("http://fixture.invalid/", {
      method: "POST", headers: { "Content-Type": request.headers["content-type"] }, body: Buffer.concat(chunks),
    });
    const data = await formRequest.formData();
    const file = data.get("file");
    received.push({ bytes: Buffer.from(await file.arrayBuffer()), name: file.name, type: file.type });
    response.writeHead(request.headers.authorization === "Bearer fixture-expired" ? 401 : 200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "received" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const previous = process.env.REAIGEN_BACKEND_URL;
  process.env.REAIGEN_BACKEND_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const { NextRequest } = await import("next/server.js");
    const { POST } = await import("../app/api/reaigen/[...path]/route.ts");
    for (const token of ["fixture-valid", "fixture-expired"]) {
      const bytes = compressedDocument();
      const body = new FormData();
      body.set("file", new File([bytes], "technical-report.pdf", { type: "application/pdf" }));
      const request = new NextRequest("http://web.invalid/api/reaigen/reai-agent/workspace/intake/", {
        method: "POST", body,
        headers: { Cookie: `reaigen_access=${token}; reaigen_refresh=fixture-refresh` },
      });
      const result = await POST(request, { params: Promise.resolve({ path: ["reai-agent", "workspace", "intake"] }) });
      assert.equal(result.status, 200);
      assert.equal(received.at(-1).name, "technical-report.pdf");
      assert.equal(received.at(-1).type, "application/pdf");
      assert.deepEqual(received.at(-1).bytes, bytes, "compressed PDF must not be decoded and re-encoded as UTF-8");
    }
    assert.equal(refreshed, true);
    assert.equal(received.length, 3, "only a rejected authentication may replay the request body");
    assert.deepEqual(received[1].bytes, received[2].bytes);
  } finally {
    if (previous === undefined) delete process.env.REAIGEN_BACKEND_URL;
    else process.env.REAIGEN_BACKEND_URL = previous;
    await new Promise((resolve) => server.close(resolve));
  }
});

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
