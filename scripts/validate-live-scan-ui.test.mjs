import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const workspace = fs.readFileSync(
  path.join(root, "app/create/live-scan/[id]/page.tsx"),
  "utf8",
);
const start = fs.readFileSync(
  path.join(root, "app/create/live-scan/page.tsx"),
  "utf8",
);
const viewer = fs.readFileSync(
  path.join(root, "app/components/scanning-point-cloud-viewer.tsx"),
  "utf8",
);
const english = fs.readFileSync(
  path.join(root, "app/lib/locales/en.ts"),
  "utf8",
);

function numericConstant(source, name) {
  const match = source.match(new RegExp(`const ${name} = ([0-9_]+);`));
  assert.ok(match, `${name} must be declared as a numeric constant`);
  return Number(match[1].replaceAll("_", ""));
}

test("live scanning uses a standard colored point-cloud renderer", () => {
  assert.match(workspace, /ScanningPointCloudViewer/);
  assert.doesNotMatch(workspace, /<SplatViewer|gaussianRenderer|spark/);
  assert.match(viewer, /new THREE\.Points\(/);
  assert.match(viewer, /new THREE\.PointsMaterial\(/);
  assert.match(viewer, /byName\.get\("red"\)/);
  assert.doesNotMatch(viewer, /Gaussian|BoxGeometry|placeholder/i);
  assert.match(workspace, /gaugeRevision=\{preview\.gauge_revision \?\? 0\}/);
});

test("capture and status cadences do not recreate the old ten-second delay", () => {
  assert.equal(numericConstant(workspace, "CAPTURE_WIDTH"), 540);
  assert.equal(numericConstant(workspace, "CAPTURE_HEIGHT"), 960);
  assert.ok(numericConstant(workspace, "CAPTURE_INTERVAL_MS") <= 250);
  assert.ok(numericConstant(workspace, "STATUS_INTERVAL_MS") <= 500);
  assert.equal(numericConstant(workspace, "FIRST_PREVIEW_FRAME_COUNT"), 1);
  assert.ok(numericConstant(workspace, "MAX_PARALLEL_UPLOADS") >= 4);
  assert.ok(numericConstant(workspace, "MAX_PARALLEL_UPLOADS") <= 8);
  assert.match(workspace, /sourceWidth[\s\S]*sourceHeight[\s\S]*context\.drawImage/);
  assert.match(workspace, /CAPTURE_ACCEPTING_SESSION_STATES[\s\S]*"starting"[\s\S]*"capturing"/);
  assert.match(workspace, /current\.runtime\.active[\s\S]*CAPTURE_ACCEPTING_SESSION_STATES\.has\(current\.status\)/);
  assert.match(workspace, /allocationTailRef/);
  assert.match(workspace, /activeUploadsRef/);
  assert.match(workspace, /persistCapturedFrame/);
  assert.match(workspace, /MAX_CAPTURE_BACKLOG/);
  assert.match(workspace, /Promise\.all\(Array\.from\(activeUploadsRef\.current\)\)/);
  assert.doesNotMatch(workspace, /pendingFrameRef|queueLatestFrame/);
  assert.doesNotMatch(workspace, /setInterval\(/);
  assert.match(start, /output_format: "ply"/);
});

test("the scan workspace is one responsive viewport with a portrait camera inset", () => {
  assert.doesNotMatch(workspace, /lg:grid-cols-\[minmax\(0,1fr\)_320px\]/);
  assert.match(workspace, /aspect-\[9\/16\]/);
  assert.match(workspace, /sm:w-\[90px\]/);
  assert.match(workspace, /object-cover/);
  assert.doesNotMatch(workspace, /absolute inset-0 h-full w-full bg-black object-cover/);
  assert.match(workspace, /capturedFrameCount/);
  assert.match(workspace, /liveScan\.firstPreview/);
  assert.match(workspace, /liveScan\.captured/);
  assert.match(workspace, /liveScan\.saved/);
  assert.match(workspace, /session\.progress\.allocated_frames > session\.progress\.ready_frames \+ queuedFrameCount/);
  assert.match(workspace, /liveScan\.restart/);
  assert.match(start, /onClick=\{startSession\}/);
  assert.doesNotMatch(start, /listLiveSplatSessions|liveScan\.continue/);
  assert.match(workspace, /finishSession[\s\S]*beginCapture/);
  assert.doesNotMatch(workspace, /onClick=\{enableCamera\}|toggleCapture/);
  assert.match(start, /<details/);
  assert.match(start, /const LIVE_SCAN_PIPELINE_QUALITY = "fast" as const/);
  assert.match(start, /quality: LIVE_SCAN_PIPELINE_QUALITY/);
  assert.doesNotMatch(start, /setQuality|selection-capsule-track/);
  assert.ok(
    start.indexOf('t("liveScan.runtimeUnavailable", lang)')
      < start.indexOf("<details"),
    "runtime availability must be visible without opening options",
  );
  assert.match(english, /"liveScan\.pointCloudForming":\s+"Point cloud forming"/);
});

test("a rejected final refinement keeps the last cloud and explains data safety", () => {
  assert.match(workspace, /const refinementFailed = session\.status === "failed"/);
  assert.match(workspace, /liveScan\.refinementIncomplete/);
  assert.match(workspace, /liveScan\.pointCloudNeedsRefinement/);
  assert.match(workspace, /liveScan\.newScan/);
  assert.match(
    english,
    /"liveScan\.refinementIncomplete":\s+"Final quality checks did not pass\. Your source frames and last point cloud are safely retained\."/,
  );
});
