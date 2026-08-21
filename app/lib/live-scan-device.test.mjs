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

test("scanning UI hides implementation names and remains standalone", () => {
  const startPage = readFileSync(
    new URL("../create/live-scan/page.tsx", import.meta.url),
    "utf8",
  );
  const workspace = readFileSync(
    new URL("../create/live-scan/[id]/page.tsx", import.meta.url),
    "utf8",
  );
  const localeFiles = ["en", "de", "sk", "cs"].map((locale) => readFileSync(
    new URL(`../lib/locales/${locale}.ts`, import.meta.url),
    "utf8",
  ));
  const scanningCopy = localeFiles
    .flatMap((source) => source.split("\n"))
    .filter((line) => line.includes('"liveScan.'))
    .map((line) => line.slice(line.indexOf(":")))
    .join("\n");

  assert.doesNotMatch(scanningCopy, /\b(?:Otter|Dragon|GLOMAP|Modal|Wasabi|DA3|GPU|runtime|checkpoint|epoch)\b/i);
  assert.doesNotMatch(startPage, /draft_id|tour_id|listSplats/);
  assert.doesNotMatch(startPage, /access\.runtime\.(?:release|commit)/);
  assert.doesNotMatch(workspace, /session\.runtime\.(?:release|commit)/);
  assert.match(startPage, /access\?\.runtime\.profile === "preview"/);
  assert.match(startPage, /capabilities\.dragon_refinement !== true/);
  assert.match(workspace, /liveScan\.finishPreview/);
  assert.match(workspace, /splatUrl=\{preview\.splat_url\}/);
  assert.match(workspace, /readOnly/);
});
