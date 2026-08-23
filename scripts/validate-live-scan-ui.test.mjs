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
const shell = fs.readFileSync(
  path.join(root, "app/components/app-shell.tsx"),
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
  assert.match(workspace, /"image\/jpeg",\s*0\.90/);
  assert.ok(numericConstant(workspace, "CAPTURE_INTERVAL_MS") <= 250);
  assert.ok(numericConstant(workspace, "STATUS_INTERVAL_MS") <= 500);
  assert.ok(numericConstant(workspace, "MAX_PARALLEL_UPLOADS") >= 4);
  assert.ok(numericConstant(workspace, "MAX_PARALLEL_UPLOADS") <= 8);
  assert.ok(numericConstant(workspace, "FRAME_UPLOAD_ATTEMPTS") >= 6);
  assert.match(workspace, /context\.drawImage/);
  assert.match(workspace, /context\.rotate\(Math\.PI \/ 2\)/);
  assert.doesNotMatch(workspace, /sourceX|sourceY|sourceWidth|sourceHeight/);
  assert.match(workspace, /CAPTURE_ACCEPTING_SESSION_STATES[\s\S]*"capturing"/);
  assert.doesNotMatch(
    workspace,
    /CAPTURE_ACCEPTING_SESSION_STATES = new Set[\s\S]{0,120}"starting"/,
  );
  assert.match(workspace, /current\.runtime\.active[\s\S]*CAPTURE_ACCEPTING_SESSION_STATES\.has\(current\.status\)/);
  assert.doesNotMatch(workspace, /allocationTailRef/);
  assert.match(workspace, /persistenceSlotsRef/);
  assert.match(workspace, /activeUploadsRef/);
  assert.match(workspace, /persistCapturedFrame/);
  assert.match(workspace, /frame_id: frame\.frameId/);
  assert.match(workspace, /storeLiveScanFrame/);
  assert.match(workspace, /listLiveScanFrames/);
  assert.match(workspace, /MAX_CAPTURE_BACKLOG/);
  assert.match(workspace, /nextCaptureAt \+= CAPTURE_INTERVAL_MS/);
  assert.match(
    workspace,
    /finishSession[\s\S]*await recoverStoredFrames\(\);[\s\S]*while \(activeUploadsRef\.current\.size > 0\)/,
  );
  assert.match(workspace, /Promise\.all\(Array\.from\(activeUploadsRef\.current\)\)/);
  assert.doesNotMatch(
    workspace,
    /TERMINAL_SESSION_STATES\.has\(session\.status\)[\s\S]{0,240}removeLiveScanFrame/,
  );
  assert.doesNotMatch(workspace, /pendingFrameRef|queueLatestFrame/);
  assert.doesNotMatch(workspace, /setInterval\(/);
  assert.match(start, /createLiveSplatSession\(\)/);
  assert.doesNotMatch(start, /output_format:/);
});

test("the scan workspace is one responsive viewport with a portrait camera inset", () => {
  assert.doesNotMatch(workspace, /lg:grid-cols-\[minmax\(0,1fr\)_320px\]/);
  assert.match(workspace, /aspect-\[9\/16\]/);
  assert.match(workspace, /sm:w-\[90px\]/);
  assert.match(workspace, /object-contain/);
  assert.match(workspace, /<AppShell[^>]*immersive>/);
  assert.match(shell, /immersive\s*\?\s*"min-h-dvh p-0"/);
  assert.match(shell, /!immersive \? <header/);
  assert.match(shell, /!immersive \? <aside/);
  assert.doesNotMatch(workspace, /<header className=/);
  assert.match(workspace, /safe-area-inset-top/);
  assert.match(workspace, /safe-area-inset-bottom/);
  assert.doesNotMatch(workspace, /absolute inset-0 h-full w-full bg-black object-cover/);
  assert.match(workspace, /capturedFrameCount/);
  assert.doesNotMatch(workspace, /liveScan\.firstPreview/);
  assert.doesNotMatch(workspace, /liveScan\.captured/);
  assert.doesNotMatch(workspace, /liveScan\.saved[",]/);
  assert.doesNotMatch(workspace, /liveScan\.cameras/);
  assert.doesNotMatch(workspace, /liveScan\.previewQualified/);
  assert.doesNotMatch(workspace, /liveScan\.previewProvisional/);
  assert.doesNotMatch(workspace, /liveScan\.contractTest/);
  assert.match(workspace, /session\.progress\.allocated_frames > 0 \|\| queuedFrameCount > 0/);
  assert.match(workspace, /liveScan\.continue/);
  assert.doesNotMatch(workspace, /onClick=\{resumable[\s\S]{0,160}router\.push\("\/create\/live-scan"\)/);
  assert.doesNotMatch(start, /listLiveSplatSessions|liveScan\.continue/);
  assert.match(workspace, /finishSession[\s\S]*beginCapture/);
  assert.doesNotMatch(workspace, /onClick=\{enableCamera\}|toggleCapture/);
  assert.doesNotMatch(start, /<details|<Switch|liveScan\.options|liveScan\.dragonRefinement|liveScan\.floorPreview/);
  assert.doesNotMatch(start, /LIVE_SCAN_PIPELINE_QUALITY|quality:/);
  assert.match(
    start,
    /await startLiveSplatSession\(session\.id\)[\s\S]*router\.push\(`\/create\/live-scan\/\$\{session\.id\}`\)/,
  );
  assert.doesNotMatch(start, /setQuality|selection-capsule-track/);
  assert.match(start, /attemptedRef\.current = true;[\s\S]*void startSession\(\)/);
  assert.match(workspace, /beforeunload/);
  assert.match(workspace, /if \(!capturing && !savingFrame && !finishing\) return/);
  assert.match(viewer, /const needsFrame = !framedRef\.current \|\| gaugeChanged/);
  assert.doesNotMatch(viewer, /scaleChanged|targetDistance/);
  assert.match(english, /"liveScan\.pointCloudForming":\s+"Building room"/);
  assert.match(english, /"liveScan\.savingLatest":\s+"Saving…"/);
  assert.match(english, /"liveScan\.savedSafely":\s+"Saved"/);
  assert.match(english, /"liveScan\.pointCloudSaved":\s+"Saved"/);
  assert.match(workspace, /visualSaved[\s\S]*liveScan\.pointCloudSaved/);
  assert.doesNotMatch(workspace, /session\.status === "completed" \|\| preview\?\.refined/);
});

test("a rejected result stays simple while retaining the last cloud", () => {
  assert.match(workspace, /const refinementFailed = session\.status === "failed"/);
  assert.match(workspace, /liveScan\.pointCloudNeedsRefinement/);
  assert.match(workspace, /liveScan\.newScan/);
  assert.doesNotMatch(workspace, /liveScan\.refinementIncomplete/);
  assert.match(
    english,
    /"liveScan\.pointCloudNeedsRefinement":\s+"Saved — result incomplete"/,
  );
});
