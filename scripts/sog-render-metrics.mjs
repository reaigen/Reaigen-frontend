#!/usr/bin/env node
/**
 * Report the render profile and framing a .sog will receive.
 *
 * Diagnosing an import previously meant loading it in a browser and comparing
 * screenshots, which is how a mis-sized Mip kernel and a camera placed inside
 * the point cloud both went unnoticed. This prints the same decisions the
 * viewer makes, from the file alone.
 *
 *   node --experimental-strip-types scripts/sog-render-metrics.mjs <file.sog|meta.json> [...]
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { execFileSync } from "node:child_process";

import {
  eyeFromSogViewer,
  isAntialiasedReconstruction,
  parseSogViewerHint,
  sogCameraIsInterior,
  resolveSplatRenderProfile,
} from "../app/lib/splat-render-profile.ts";

function readMeta(path) {
  if (path.endsWith(".json")) return JSON.parse(readFileSync(path, "utf8"));
  // A .sog is a zip; shell out rather than take a dependency for one read.
  return JSON.parse(execFileSync("unzip", ["-p", path, "meta.json"], { maxBuffer: 1 << 26 }));
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: sog-render-metrics.mjs <file.sog|meta.json> [...]");
  process.exit(2);
}

let problems = 0;

for (const path of files) {
  const meta = readMeta(path);
  const mins = meta.means?.mins ?? [0, 0, 0];
  const maxs = meta.means?.maxs ?? [0, 0, 0];
  const size = Math.max(...maxs.map((v, i) => v - mins[i]));
  const profile = resolveSplatRenderProfile(meta);
  const hint = parseSogViewerHint(meta);

  console.log(`\n${basename(path)}`);
  console.log(`  generator        ${meta.asset?.generator ?? "unknown"}`);
  console.log(`  splats           ${(meta.count ?? 0).toLocaleString()}`);
  console.log(`  scene extent     ${size.toFixed(2)} m`);
  console.log(`  antialias flag   ${isAntialiasedReconstruction(meta)}`);
  console.log(`  kernel size      ${profile.kernelSize}${profile.kernelSize === 0.3 ? "  (3DGS dilation)" : "  (legacy)"}`);
  console.log(`  compensation     ${profile.compensation}`);
  console.log(`  SH bands         ${meta.shN?.bands ?? "none"}`);

  if (!hint) {
    console.log(`  camera           derived from point cloud`);
    // The derived path clamps orbit radius to [1.5, 5] m, tuned for room-scale
    // interiors. A scene smaller than the floor cannot be framed from outside.
    if (size < 1.5) {
      console.log(`  ⚠ scene is smaller than the 1.5 m minimum orbit radius — camera will sit inside it`);
      problems += 1;
    }
    continue;
  }

  const eye = eyeFromSogViewer(hint);
  const interior = sogCameraIsInterior(meta);
  console.log(`  camera           derived from point cloud (interior walkthrough)`);
  console.log(`  authored camera  present, ${interior ? "interior" : "EXTERIOR orbit — not used for framing"}`);
  console.log(`    target         [${hint.target.map((v) => v.toFixed(2)).join(", ")}]`);
  console.log(`    eye            [${eye.map((v) => v.toFixed(2)).join(", ")}]`);
  console.log(`    distance       ${hint.distance.toFixed(2)} m  (${(hint.distance / size).toFixed(2)}x extent)`);
  console.log(`    inside room    ${interior}`);
}

console.log(
  problems === 0
    ? `\n${files.length} file(s) checked, no framing problems\n`
    : `\n${problems} framing problem(s) across ${files.length} file(s)\n`,
);
process.exit(problems === 0 ? 0 : 1);
