#!/usr/bin/env node
// Analyze household furniture layouts and extract lightweight placement priors from raw
// JSON/JSONL data. The script is deliberately conservative: it supports multiple
// schema shapes (ProcTHOR-like rooms, ARKitScenes-like annotations, and several
// generic aliases) so it can run against real-world and synthetic datasets.

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const flags = new Map();
const inputs = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--")) {
    inputs.push(a);
    continue;
  }
  const key = a.slice(2);
  const next = argv[i + 1];
  if (!next || next.startsWith("--")) {
    flags.set(key, "true");
  } else {
    flags.set(key, next);
    i++;
  }
}

if (inputs.length === 0) {
  console.error("Usage: node scripts/analyze-floorplan-patterns.mjs <dataset-path> [--format auto|procthor|arkitscenes] [--out-json file] [--suggest-priors]");
  process.exit(1);
}

const datasetFormat = String(flags.get("format") || "auto").toLowerCase();
const outPath = flags.get("out-json");
const suggest = flags.get("suggest-priors") === "true";

const normNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function canonicalCategory(raw) {
  if (!raw) return "generic";
  const key = String(raw).toLowerCase().replace(/_var.*$|[\s_-]|\d+$/g, "").trim();
  switch (key) {
    case "sofa":
    case "couch":
      return "sofa";
    case "chair":
    case "stool":
      return "chair";
    case "table":
    case "desk":
    case "diningtable":
      return "table";
    case "storage":
    case "wardrobe":
    case "closet":
    case "cabinet":
    case "shelf":
      return "storage";
    case "refrigerator":
    case "fridge":
      return "refrigerator";
    case "stove":
    case "cooktop":
      return "stove";
    case "oven":
      return "oven";
    case "dishwasher":
      return "dishwasher";
    case "washerdryer":
    case "washer":
    case "dryer":
      return "washerDryer";
    case "sink":
      return "sink";
    case "toilet":
    case "wc":
      return "toilet";
    case "bathtub":
    case "tub":
    case "shower":
      return "bathtub";
    case "fireplace":
      return "fireplace";
    case "television":
    case "tv":
      return "television";
    case "bed":
      return "bed";
    case "stairs":
    case "stair":
      return "stairs";
    default:
      return "generic";
  }
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.min(sorted.length - 1, lo + 1);
  const w = i - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function angleFromYaw(rawYaw) {
  if (!Number.isFinite(rawYaw)) return null;
  if (Math.abs(rawYaw) > 2 * Math.PI) return rawYaw * (Math.PI / 180);
  let a = rawYaw;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function extractYaw(raw) {
  const candidates = [];
  if (raw == null) return null;
  if (raw.yaw !== undefined) candidates.push(raw.yaw);
  if (raw.rotation !== undefined) candidates.push(raw.rotation);
  if (raw.rotation_y !== undefined) candidates.push(raw.rotation_y);
  if (raw.rotation?.y !== undefined) candidates.push(raw.rotation.y);
  if (raw.rotation?.yaw !== undefined) candidates.push(raw.rotation.yaw);
  if (raw.orientation_y !== undefined) candidates.push(raw.orientation_y);
  if (raw.orientation?.yaw !== undefined) candidates.push(raw.orientation.yaw);
  if (raw.yRotation !== undefined) candidates.push(raw.yRotation);
  if (raw.transform && raw.transform.length >= 16) {
    // Apple/AR-style matrix: [.. xz in 0,2 / 8,10]
    const ax = [raw.transform[8], raw.transform[10]];
    if (Number.isFinite(ax[0]) && Number.isFinite(ax[1])) {
      return Math.atan2(ax[1], ax[0]) + Math.PI / 2;
    }
  }
  if (raw.q !== undefined) {
    // Quaternion stored as [x,y,z,w] or {x,y,z,w}
    const q = Array.isArray(raw.q)
      ? { x: raw.q[0], y: raw.q[1], z: raw.q[2], w: raw.q[3] }
      : raw.q;
    const yawFromQ = normNum(q.w) !== null && normNum(q.y) !== null && normNum(q.x) !== null && normNum(q.z) !== null
      ? Math.atan2(2 * (q.w * q.y + q.z * q.x), 1 - 2 * (q.y * q.y + q.x * q.x))
      : null;
    if (yawFromQ !== null) return yawFromQ;
  }
  if (raw.quaternion) {
    const q = raw.quaternion;
    const yawFromQ = normNum(q.w) !== null && normNum(q.y) !== null && normNum(q.x) !== null && normNum(q.z) !== null
      ? Math.atan2(2 * (q.w * q.y + q.z * q.x), 1 - 2 * (q.y * q.y + q.x * q.x))
      : null;
    if (yawFromQ !== null) return yawFromQ;
  }
  for (const y of candidates) {
    const n = normNum(y);
    if (n === null) continue;
    const a = angleFromYaw(n);
    if (a !== null) return a;
  }
  return null;
}

function extractCenter(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (Array.isArray(raw.center) && raw.center.length >= 3) {
    const x = normNum(raw.center[0]);
    const z = normNum(raw.center[2]);
    if (x !== null && z !== null) return [x, z];
  }
  if (Array.isArray(raw.position) && raw.position.length >= 3) {
    const x = normNum(raw.position[0]);
    const z = normNum(raw.position[2]);
    if (x !== null && z !== null) return [x, z];
  }
  if (raw.translation && Array.isArray(raw.translation) && raw.translation.length >= 3) {
    const x = normNum(raw.translation[0]);
    const z = normNum(raw.translation[2]);
    if (x !== null && z !== null) return [x, z];
  }
  if (raw.translation && typeof raw.translation === "object") {
    const x = normNum(raw.translation.x ?? raw.translation[0]);
    const z = normNum(raw.translation.z ?? raw.translation[2]);
    if (x !== null && z !== null) return [x, z];
  }
  if (raw.location && Array.isArray(raw.location) && raw.location.length >= 3) {
    const x = normNum(raw.location[0]);
    const z = normNum(raw.location[2]);
    if (x !== null && z !== null) return [x, z];
  }
  if (raw.location && typeof raw.location === "object") {
    const x = normNum(raw.location.x ?? raw.location[0]);
    const z = normNum(raw.location.z ?? raw.location[2]);
    if (x !== null && z !== null) return [x, z];
  }
  if (raw.bbox && Array.isArray(raw.bbox) && raw.bbox.length >= 6) {
    const minX = normNum(raw.bbox[0]);
    const minZ = normNum(raw.bbox[2]);
    const maxX = normNum(raw.bbox[3]);
    const maxZ = normNum(raw.bbox[5]);
    if ([minX, minZ, maxX, maxZ].some((v) => v === null)) return null;
    return [(minX + maxX) / 2, (minZ + maxZ) / 2];
  }
  if (raw.bounding_box && Array.isArray(raw.bounding_box) && raw.bounding_box.length >= 6) {
    const minX = normNum(raw.bounding_box[0]);
    const minZ = normNum(raw.bounding_box[2]);
    const maxX = normNum(raw.bounding_box[3]);
    const maxZ = normNum(raw.bounding_box[5]);
    if ([minX, minZ, maxX, maxZ].some((v) => v === null)) return null;
    return [(minX + maxX) / 2, (minZ + maxZ) / 2];
  }
  return null;
}

function extractHalfSize(raw) {
  if (!raw || typeof raw !== "object") return [0.3, 0.3];
  const pick = (s) => {
    if (!s) return null;
    const x = normNum(s[0] ?? s.x ?? s.w ?? s.width);
    const z = normNum(s[2] ?? s.z ?? s.depth ?? s.d);
    if (x === null || z === null) return null;
    return [x / 2, z / 2];
  };
  const d = normNum(raw.size ?? raw.dimensions?.[0]);
  if (d !== null) return [d / 2, d / 2];
  const candidates = [];
  if (raw.dimensions && Array.isArray(raw.dimensions) && raw.dimensions.length >= 3) {
    candidates.push(pick(raw.dimensions));
  }
  if (raw.size && typeof raw.size === "object") {
    candidates.push(pick(raw.size));
  }
  if (raw.box_size && Array.isArray(raw.box_size) && raw.box_size.length >= 3) {
    candidates.push(pick(raw.box_size));
  }
  if (raw.sizes && typeof raw.sizes === "object") {
    candidates.push(pick(raw.sizes));
  }
  if (raw.boxSize && typeof raw.boxSize === "object") {
    candidates.push(pick(raw.boxSize));
  }
  if (raw.bbox && Array.isArray(raw.bbox) && raw.bbox.length >= 6) {
    const minX = normNum(raw.bbox[0]);
    const minZ = normNum(raw.bbox[2]);
    const maxX = normNum(raw.bbox[3]);
    const maxZ = normNum(raw.bbox[5]);
    if ([minX, minZ, maxX, maxZ].every((v) => v !== null)) {
      candidates.push([(maxX - minX) / 2, (maxZ - minZ) / 2]);
    }
  }
  for (const cand of candidates) {
    if (cand) return cand;
  }
  return [0.3, 0.3];
}

function extractCategory(raw) {
  return (
    raw?.category ??
    raw?.label ??
    raw?.type ??
    raw?.class ??
    raw?.objectType ??
    raw?.name ??
    ""
  );
}

function normalizeObject(raw) {
  const center = extractCenter(raw);
  if (!center) return null;
  const category = canonicalCategory(extractCategory(raw));
  const yaw = extractYaw(raw);
  const [halfW, halfD] = extractHalfSize(raw);
  const n = normNum(raw.id);
  return {
    id: n ?? raw.id,
    category,
    center,
    halfW,
    halfD,
    yaw,
  };
}

function collectScenesFromRecord(record) {
  const scenes = [];
  if (!record || typeof record !== "object") return scenes;

  const pushScene = (objects, roomId = "global") => {
    if (Array.isArray(objects) && objects.length > 0) {
      const normed = [];
      for (const o of objects) {
        const n = normalizeObject(o);
        if (n) n.roomId = roomId;
        if (n) normed.push(n);
      }
      if (normed.length > 0) scenes.push(normed);
    }
  };

  if (Array.isArray(record.rooms)) {
    for (let i = 0; i < record.rooms.length; i++) {
      const room = record.rooms[i] || {};
      const rid = room.room_id || room.id || String(i);
      if (Array.isArray(room.objects)) pushScene(room.objects, rid);
      else if (Array.isArray(room.furniture)) pushScene(room.furniture, rid);
    }
  }
  if (Array.isArray(record.objects) && scenes.length === 0) pushScene(record.objects);
  if (Array.isArray(record.furniture) && scenes.length === 0) pushScene(record.furniture);
  if (Array.isArray(record.annotations) && scenes.length === 0) pushScene(record.annotations);
  if (Array.isArray(record.instances) && scenes.length === 0) pushScene(record.instances);
  if (scenes.length === 0 && record.scene && Array.isArray(record.scene.objects)) {
    pushScene(record.scene.objects);
  }
  if (scenes.length === 0 && Array.isArray(record.objects) && Array.isArray(record.walls)) {
    pushScene(record.objects);
  }
  return scenes;
}

function collectFiles(entry, out = []) {
  const st = statSync(entry);
  if (st.isDirectory()) {
    const children = readdirSync(entry).filter((name) => !name.startsWith("."));
    for (const child of children) collectFiles(path.join(entry, child), out);
    return out;
  }
  const lower = entry.toLowerCase();
  if (lower.endsWith(".json") || lower.endsWith(".jsonl")) out.push(entry);
  return out;
}

function parseLines(filePath, text) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".jsonl")) {
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      try {
        out.push(JSON.parse(t));
      } catch {
        // ignore invalid lines
      }
    }
    return out;
  }
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    return [parsed];
  } catch {
    return [];
  }
}

function analyzeFile(filePath, acc) {
  const rawText = readFileSync(filePath, "utf8");
  const records = parseLines(filePath, rawText);
  for (const record of records) {
    const scenes = collectScenesFromRecord(record);
    if (scenes.length === 0) {
      // fallback: treat top-level array entries as objects if present
      if (Array.isArray(record)) {
        const fallback = [];
        for (const o of record) {
          const n = normalizeObject(o);
          if (n) fallback.push(n);
        }
        if (fallback.length > 0) scenes.push(fallback);
      }
    }
    for (const scene of scenes) {
      acc.totalScenes += 1;
      acc.totalObjects += scene.length;
      const counts = acc.categoryCounts;
      for (const obj of scene) {
        counts[obj.category] = (counts[obj.category] || 0) + 1;
      }

      for (let i = 0; i < scene.length; i++) {
        for (let j = i + 1; j < scene.length; j++) {
          const a = scene[i];
          const b = scene[j];
          const dx = a.center[0] - b.center[0];
          const dz = a.center[1] - b.center[1];
          const d = Math.hypot(dx, dz);
          if (!Number.isFinite(d)) continue;

          const pair = [a.category, b.category].sort().join("|");
          if (!acc.pairCounts[pair]) acc.pairCounts[pair] = 0;
          acc.pairCounts[pair] += 1;

          if (!acc.pairDistances[pair]) acc.pairDistances[pair] = [];
          acc.pairDistances[pair].push(d);

          const ka = a.category;
          const kb = b.category;
          if ((ka === "chair" && kb === "table") || (ka === "table" && kb === "chair")) {
            const chair = ka === "chair" ? a : b;
            const table = ka === "table" ? a : b;
            if (!acc.chairTable) acc.chairTable = [];
            const dist = d;
            let face = null;
            if (chair.yaw !== null && table.center) {
              const cx = chair.center[0];
              const cz = chair.center[1];
              const tx = table.center[0];
              const tz = table.center[1];
              const vx = tx - cx;
              const vz = tz - cz;
              const l = Math.hypot(vx, vz);
              if (l > 1e-6) {
                const toTable = [vx / l, vz / l];
                const fc = Math.cos(chair.yaw) * toTable[0] + Math.sin(chair.yaw) * toTable[1];
                face = fc;
              }
            }
            acc.chairTable.push({ dist, face });
          }
          if ((ka === "television" && kb === "sofa") || (ka === "sofa" && kb === "television")) {
            const tv = ka === "television" ? a : b;
            const sofa = ka === "sofa" ? a : b;
            const dxs = sofa.center[0] - tv.center[0];
            const dzs = sofa.center[1] - tv.center[1];
            const l = Math.hypot(dxs, dzs);
            let face = null;
            if (tv.yaw !== null && l > 1e-6) {
              const tvf = [Math.cos(tv.yaw), Math.sin(tv.yaw)];
              const towardSofa = [dxs / l, dzs / l];
              face = tvf[0] * (-towardSofa[0]) + tvf[1] * (-towardSofa[1]);
            }
            acc.tvSofa.push({ dist: l, face });
          }
        }
      }
    }
  }
}

const files = [];
for (const input of inputs) {
  try {
    collectFiles(input, files);
  } catch (err) {
    console.error(`Skipping ${input}: ${String(err?.message || err)}`);
  }
}

const uniqueFiles = [...new Set(files)];
console.log(`Analyzing ${uniqueFiles.length} candidate file(s)...`);

const acc = {
  totalScenes: 0,
  totalObjects: 0,
  categoryCounts: {},
  pairCounts: {},
  pairDistances: {},
  chairTable: [],
  tvSofa: [],
};

for (const filePath of uniqueFiles) {
  analyzeFile(filePath, acc);
}

const toSummaryDist = (arr) => {
  const sorted = [...arr].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0] ?? null,
    p10: quantile(sorted, 0.1),
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    max: sorted[sorted.length - 1] ?? null,
    mean: sorted.length ? sorted.reduce((s, v) => s + v, 0) / sorted.length : null,
  };
};

const pairTop = Object.entries(acc.pairCounts)
  .map(([pair, count]) => ({
    pair,
    count,
    d: toSummaryDist(acc.pairDistances[pair] || []),
  }))
  .sort((a, b) => b.count - a.count)
  .slice(0, 40);

const chairTableDist = acc.chairTable.map((x) => x.dist);
const ct = toSummaryDist(chairTableDist);
const tv = toSummaryDist(acc.tvSofa.map((x) => x.dist));
const ctFacing = acc.chairTable.filter((x) => x.face !== null).map((x) => x.face);
const tvFacing = acc.tvSofa.filter((x) => x.face !== null).map((x) => x.face);
const ctFacingShare = ctFacing.length ? ctFacing.filter((v) => v > 0.5).length / ctFacing.length : null;
const tvFacingShare = tvFacing.length ? tvFacing.filter((v) => v > 0.5).length / tvFacing.length : null;

const out = {
  datasetFormat: datasetFormat,
  fileCount: uniqueFiles.length,
  totalScenes: acc.totalScenes,
  totalObjects: acc.totalObjects,
  categoryCounts: acc.categoryCounts,
  topPairStats: pairTop,
  chairTable: {
    count: acc.chairTable.length,
    dist: ct,
    facing: {
      samples: ctFacing.length,
      p50: toSummaryDist(ctFacing).p50,
      shareFacingTowardsTable: ctFacingShare,
    },
  },
  tvSofa: {
    count: acc.tvSofa.length,
    dist: tv,
    facing: {
      samples: tvFacing.length,
      p50: toSummaryDist(tvFacing).p50,
      shareFacingTowardsSofa: tvFacingShare,
    },
  },
  suggestedPriors: suggest
    ? {
        chairTableSnap: ct.p50 ? Math.max(0.25, Math.min(1.2, ct.p50)) : null,
        tvSofaMaxDist: tv.p90 ? Math.max(tv.p90, 2.0) : null,
      }
    : null,
};

const top = pairTop.slice(0, 20);
console.log("===== floorplan pattern analysis =====");
console.log(`Scenes: ${acc.totalScenes}`);
console.log(`Objects: ${acc.totalObjects}`);
console.log(`Detected categories: ${Object.keys(acc.categoryCounts).length}`);
for (const row of top) {
  const { pair, count, d } = row;
  console.log(`${pair}: ${count} pairs, d_med=${d.p50?.toFixed(3) ?? "n/a"}, d_p10=${d.p10?.toFixed(3) ?? "n/a"}, d_p90=${d.p90?.toFixed(3) ?? "n/a"}`);
}
console.log("Chair↔Table samples:", ct.n);
console.log(`  chair-center to table-center median=${ct.p50?.toFixed(3) ?? "n/a"}, p90=${ct.p90?.toFixed(3) ?? "n/a"}`);
if (ctFacingShare !== null) console.log(`  facing toward table (cos > 0.5): ${(ctFacingShare * 100).toFixed(1)}%`);
if (acc.chairTable.length && suggest) {
  const ctSnap = out.suggestedPriors.chairTableSnap;
  console.log(`Suggested chairTableSnap = ${ctSnap?.toFixed(3) ?? "n/a"}`);
}
console.log("TV↔Sofa samples:", tv.n);
if (tvFacingShare !== null) console.log(`  facing sofa (cos > 0.5): ${(tvFacingShare * 100).toFixed(1)}%`);

if (outPath) {
  const outDir = path.dirname(outPath);
  if (outDir && outDir !== ".") mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Wrote JSON summary: ${outPath}`);
}
