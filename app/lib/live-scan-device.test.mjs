import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isLiveScanCaptureDevice } from "./live-scan-device.ts";

test("desktop identities never qualify for live capture", () => {
  assert.equal(isLiveScanCaptureDevice({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    platform: "MacIntel",
    maxTouchPoints: 0,
  }), false);
  assert.equal(isLiveScanCaptureDevice({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    platform: "Linux x86_64",
    maxTouchPoints: 0,
  }), false);
});

test("phone and Android tablet identities qualify", () => {
  assert.equal(isLiveScanCaptureDevice({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) Mobile/15E148",
    platform: "iPhone",
    maxTouchPoints: 5,
  }), true);
  assert.equal(isLiveScanCaptureDevice({
    userAgent: "Mozilla/5.0 (Linux; Android 16; Pixel Tablet) AppleWebKit Mobile",
    platform: "Linux armv8l",
    maxTouchPoints: 10,
  }), true);
});

test("desktop-identity iPad is distinguished from a Mac", () => {
  assert.equal(isLiveScanCaptureDevice({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
    platform: "MacIntel",
    maxTouchPoints: 5,
  }), true);
});

test("production permits only same-origin camera and opens it only on explicit action", () => {
  const nextConfig = readFileSync(new URL("../../next.config.ts", import.meta.url), "utf8");
  const workspace = readFileSync(
    new URL("../create/live-scan/[id]/page.tsx", import.meta.url),
    "utf8",
  );
  const startPage = readFileSync(
    new URL("../create/live-scan/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(nextConfig, /camera=\(self\)/);
  assert.doesNotMatch(nextConfig, /camera=\(\)/);
  assert.equal(workspace.match(/getUserMedia\(/g)?.length, 1);
  assert.ok(workspace.indexOf("getUserMedia(") > workspace.indexOf("const enableCamera = async"));
  assert.doesNotMatch(startPage, /getUserMedia\(/);
});
