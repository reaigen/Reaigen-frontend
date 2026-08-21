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

test("scanning renders reconstructed PLY points rather than placeholder geometry", () => {
  assert.match(workspace, /ScanningPointCloudViewer/);
  assert.doesNotMatch(workspace, /<SplatViewer/);
  assert.match(viewer, /f_dc_0/);
  assert.match(viewer, /new THREE\.Points\(/);
  assert.match(viewer, /gaugeChanged/);
  assert.match(workspace, /gaugeRevision=\{preview\.gauge_revision\}/);
  assert.doesNotMatch(viewer, /BoxGeometry|BoxHelper|placeholder/i);
});

test("scanning requests a point-cloud artifact and exposes final refinement", () => {
  assert.match(start, /output_format: "ply"/);
  assert.match(start, /liveScan\.dragonRefinement/);
  assert.match(english, /"liveScan\.dragonRefinement":\s+"Final refinement"/);
  assert.match(english, /"liveScan\.pointCloudForming":\s+"Point cloud forming"/);
  assert.doesNotMatch(
    english.match(/\/\/ ── Extra-user scanning[\s\S]*?"webCreate\.openEditor"/)?.[0] ?? "",
    /Otter|Dragon|GLOMAP|Modal|DA3/,
  );
});
