/**
 * TypeScript port of the iOS floorplan pipeline
 * (Reagen-ios-ap-dev: LocalFloorplanRenderer.swift), so the web renders the
 * SAME plan the iOS app draws from a draft's `captured_room_json` +
 * `wall_graph_json` + `floorplan_opening_edits_json` + `door_N_camera` fields.
 *
 * World space is RoomPlan XZ metres throughout; screen projection maps
 * world Z → screen Y directly (both Y-down after projection).
 */

import type { DraftDataEntry } from "./tour-types";

export type V2 = [number, number]; // [x, z] world metres

// iOS tuning constants (LocalFloorplanRenderer)
export const WALL_THICKNESS = 0.18;
export const OPENING_HOST_TOLERANCE = 0.3;
export const STROKE_COLOR = "#111111";
export const LABEL_FILL = "#4b5563";
export const STROKE_WIDTH = 2.2; // heavy: walls + jambs
export const DOOR_PANEL_WIDTH = 1.6; // medium: door leaf, window frame
export const DOOR_ARC_WIDTH = 1.0; // light: swing arc, glazing
export const DOOR_HINGE_RADIUS = 2.8;

// ── CapturedRoom JSON parsing ────────────────────────────────────────────────

export interface SurfaceXZ {
  id: string; // lowercased UUID
  p1: V2;
  p2: V2;
}

export interface ParsedCapturedRoom {
  walls: SurfaceXZ[];
  doors: SurfaceXZ[];
  windows: SurfaceXZ[];
  floors: { id: string; center: V2; area: number }[];
}

/** Floor-line endpoints of a vertical surface (iOS footprintEndpoints).
 * `transform` is Apple's column-major float4x4 (16 numbers). */
function footprintEndpoints(dims: number[], m: number[]): [V2, V2] {
  const hx = (dims[0] ?? 0) / 2;
  const hy = (dims[1] ?? 0) / 2;
  const world = (lx: number, ly: number): V2 => [
    m[0] * lx + m[4] * ly + m[12],
    m[2] * lx + m[6] * ly + m[14],
  ];
  return [world(-hx, -hy), world(hx, -hy)];
}

export function parseCapturedRoom(json: unknown): ParsedCapturedRoom | null {
  const room = json as Record<string, unknown> | null;
  if (!room || !Array.isArray(room.walls)) return null;
  const surfaces = (list: unknown): SurfaceXZ[] =>
    (Array.isArray(list) ? list : [])
      .map((s: any) => {
        if (!Array.isArray(s?.dimensions) || !Array.isArray(s?.transform)) return null;
        const [p1, p2] = footprintEndpoints(s.dimensions, s.transform);
        return { id: String(s.identifier ?? "").toLowerCase(), p1, p2 };
      })
      .filter((s): s is SurfaceXZ => s !== null);
  const floors = (Array.isArray(room.floors) ? room.floors : [])
    .map((f: any) => {
      if (!Array.isArray(f?.dimensions) || !Array.isArray(f?.transform)) return null;
      return {
        id: String(f.identifier ?? "").toLowerCase(),
        center: [f.transform[12], f.transform[14]] as V2,
        area: (f.dimensions[0] ?? 0) * (f.dimensions[2] ?? 0),
      };
    })
    .filter((f): f is { id: string; center: V2; area: number } => f !== null);
  return {
    walls: surfaces(room.walls),
    doors: surfaces(room.doors),
    windows: surfaces(room.windows),
    floors,
  };
}

// ── Manhattan snap (iOS manhattanAdjust) ─────────────────────────────────────

export interface AdjustedGeometry {
  walls: SurfaceXZ[];
  doors: SurfaceXZ[];
  windows: SurfaceXZ[];
  sceneRotation: number;
  interiorCentroid: V2;
  rawCentroid: V2;
  floorCentresByID: Record<string, V2>;
  floorCentresByIndex: Record<number, V2>;
}

const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const len2 = (a: V2) => Math.hypot(a[0], a[1]);
const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
const dist = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mid2 = (a: V2, b: V2): V2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

export function distancePointToSegment(p: V2, a: V2, b: V2): number {
  const ab = sub(b, a);
  const lenSq = dot(ab, ab);
  if (lenSq <= 1e-8) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / lenSq));
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]);
}

export function openingHasHostWall(mid: V2, segments: [V2, V2][], tolerance = OPENING_HOST_TOLERANCE): boolean {
  return segments.some(([a, b]) => distancePointToSegment(mid, a, b) <= tolerance);
}

/** iOS snapWallCorners: weld near perpendicular endpoints onto their axis
 * intersection. Three passes for transitive closure. */
function snapWallCorners(walls: SurfaceXZ[], maxGap: number): void {
  if (walls.length < 2) return;
  const perpDotTolerance = 0.15;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < walls.length; i++) {
      const dirA = sub(walls[i].p2, walls[i].p1);
      const lenA = len2(dirA);
      if (lenA < 1e-4) continue;
      const unitA: V2 = [dirA[0] / lenA, dirA[1] / lenA];
      for (const aIsP1 of [true, false]) {
        const pA = aIsP1 ? walls[i].p1 : walls[i].p2;
        for (let j = 0; j < walls.length; j++) {
          if (j === i) continue;
          const dirB = sub(walls[j].p2, walls[j].p1);
          const lenB = len2(dirB);
          if (lenB < 1e-4) continue;
          const unitB: V2 = [dirB[0] / lenB, dirB[1] / lenB];
          if (Math.abs(dot(unitA, unitB)) > perpDotTolerance) continue;
          for (const bIsP1 of [true, false]) {
            const pB = bIsP1 ? walls[j].p1 : walls[j].p2;
            if (dist(pA, pB) > maxGap) continue;
            const intersect: V2 =
              Math.abs(unitA[1]) < Math.abs(unitA[0])
                ? [pB[0], pA[1]] // A horizontal, B vertical
                : [pA[0], pB[1]]; // A vertical, B horizontal
            if (aIsP1) walls[i] = { ...walls[i], p1: intersect };
            else walls[i] = { ...walls[i], p2: intersect };
            if (bIsP1) walls[j] = { ...walls[j], p1: intersect };
            else walls[j] = { ...walls[j], p2: intersect };
          }
        }
      }
    }
  }
}

export function manhattanAdjust(room: ParsedCapturedRoom): AdjustedGeometry {
  // Step 1: scene-wide residual tilt via Manhattan circular mean.
  let accReal = 0;
  let accImag = 0;
  for (const w of room.walls) {
    const dx = w.p2[0] - w.p1[0];
    const dz = w.p2[1] - w.p1[1];
    const length = Math.hypot(dx, dz);
    if (length < 0.05) continue;
    const theta = Math.atan2(dz, dx);
    accReal += length * Math.cos(4 * theta);
    accImag += length * Math.sin(4 * theta);
  }
  const accMag = Math.hypot(accReal, accImag);
  const residualTilt = accMag < 1e-6 ? 0 : Math.atan2(accImag, accReal) / 4;
  const rot = -residualTilt;

  const allPts: V2[] = [];
  for (const s of [...room.walls, ...room.doors, ...room.windows]) allPts.push(s.p1, s.p2);
  const centroid: V2 = allPts.length
    ? [
        allPts.reduce((s, p) => s + p[0], 0) / allPts.length,
        allPts.reduce((s, p) => s + p[1], 0) / allPts.length,
      ]
    : [0, 0];

  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const rotateAroundCentroid = (p: V2): V2 => {
    const dx = p[0] - centroid[0];
    const dy = p[1] - centroid[1];
    return [centroid[0] + dx * cosR - dy * sinR, centroid[1] + dx * sinR + dy * cosR];
  };

  // Step 2: per-wall cardinal snap around the segment midpoint.
  const quarter = Math.PI / 2;
  const snapSegment = (p1: V2, p2: V2): [V2, V2] => {
    const r1 = rotateAroundCentroid(p1);
    const r2 = rotateAroundCentroid(p2);
    const m = mid2(r1, r2);
    const d = sub(r2, r1);
    const l = len2(d);
    if (l < 1e-4) return [r1, r2];
    const theta = Math.atan2(d[1], d[0]);
    const snapped = Math.round(theta / quarter) * quarter;
    const dir: V2 = [Math.cos(snapped), Math.sin(snapped)];
    return [
      [m[0] - (dir[0] * l) / 2, m[1] - (dir[1] * l) / 2],
      [m[0] + (dir[0] * l) / 2, m[1] + (dir[1] * l) / 2],
    ];
  };

  const snappedWalls: SurfaceXZ[] = room.walls.map((w) => {
    const [p1, p2] = snapSegment(w.p1, w.p2);
    return { id: w.id, p1, p2 };
  });
  snapWallCorners(snappedWalls, 0.4);

  // Step 3: glue each opening onto its nearest wall, preserving length.
  const glueToWall = (rawP1: V2, rawP2: V2): [V2, V2] => {
    const r1 = rotateAroundCentroid(rawP1);
    const r2 = rotateAroundCentroid(rawP2);
    const m = mid2(r1, r2);
    const length = dist(r1, r2);
    if (length < 1e-4 || snappedWalls.length === 0) return [r1, r2];
    let best = snappedWalls[0];
    let bestDist = Infinity;
    for (const wall of snappedWalls) {
      const d = distancePointToSegment(m, wall.p1, wall.p2);
      if (d < bestDist) {
        bestDist = d;
        best = wall;
      }
    }
    const wallDir = sub(best.p2, best.p1);
    const wallLen = Math.max(len2(wallDir), 1e-4);
    const dir: V2 = [wallDir[0] / wallLen, wallDir[1] / wallLen];
    const t = dot(sub(m, best.p1), dir);
    const half = length / 2;
    const tClamped = Math.max(half + 0.01, Math.min(wallLen - half - 0.01, t));
    const projected: V2 = [best.p1[0] + dir[0] * tClamped, best.p1[1] + dir[1] * tClamped];
    return [
      [projected[0] - dir[0] * half, projected[1] - dir[1] * half],
      [projected[0] + dir[0] * half, projected[1] + dir[1] * half],
    ];
  };

  const glue = (s: SurfaceXZ): SurfaceXZ => {
    const [p1, p2] = glueToWall(s.p1, s.p2);
    return { id: s.id, p1, p2 };
  };
  const gluedDoors = room.doors.map(glue);
  const gluedWindows = room.windows.map(glue);

  // Interior reference for door swing direction.
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const w of snappedWalls) {
    sumX += w.p1[0] + w.p2[0];
    sumY += w.p1[1] + w.p2[1];
    count += 2;
  }
  const interior: V2 = count > 0 ? [sumX / count, sumY / count] : [0, 0];

  // Floor centres in the post-snap frame (same source-coordinate threshold as iOS).
  const centresByID: Record<string, V2> = {};
  const centresByIndex: Record<number, V2> = {};
  let keptIndex = 0;
  for (const floor of room.floors) {
    if (floor.area <= 0.1) continue;
    const centre = rotateAroundCentroid(floor.center);
    centresByID[floor.id] = centre;
    keptIndex += 1;
    centresByIndex[keptIndex] = centre;
  }

  return {
    walls: snappedWalls,
    doors: gluedDoors,
    windows: gluedWindows,
    sceneRotation: rot,
    interiorCentroid: interior,
    rawCentroid: centroid,
    floorCentresByID: centresByID,
    floorCentresByIndex: centresByIndex,
  };
}

/** iOS rotateToSnappedFrame: bring a raw ARKit XZ point (e.g. a phone-pose
 * marker) into the post-Manhattan-snap frame. */
export function rotateToSnappedFrame(raw: V2, geom: AdjustedGeometry): V2 {
  const cosR = Math.cos(geom.sceneRotation);
  const sinR = Math.sin(geom.sceneRotation);
  const dx = raw[0] - geom.rawCentroid[0];
  const dy = raw[1] - geom.rawCentroid[1];
  return [
    geom.rawCentroid[0] + dx * cosR - dy * sinR,
    geom.rawCentroid[1] + dx * sinR + dy * cosR,
  ];
}

// ── Quads / cuts / bounds ────────────────────────────────────────────────────

/** 18 cm thick wall rectangle with half-thickness overhang at each end. */
export function wallQuad(p1: V2, p2: V2): V2[] {
  const dx = p2[0] - p1[0];
  const dz = p2[1] - p1[1];
  const l = Math.max(Math.hypot(dx, dz), 1e-4);
  const nx = -dz / l;
  const nz = dx / l;
  const dirX = dx / l;
  const dirZ = dz / l;
  const t = WALL_THICKNESS / 2;
  const ax = p1[0] - dirX * t;
  const az = p1[1] - dirZ * t;
  const bx = p2[0] + dirX * t;
  const bz = p2[1] + dirZ * t;
  return [
    [ax + nx * t, az + nz * t],
    [bx + nx * t, bz + nz * t],
    [bx - nx * t, bz - nz * t],
    [ax - nx * t, az - nz * t],
  ];
}

/** Opening cut rectangle: wall thickness deep, 2 cm long-axis buffer. */
export function openingCut(p1: V2, p2: V2): V2[] {
  const dx = p2[0] - p1[0];
  const dz = p2[1] - p1[1];
  const l = Math.max(Math.hypot(dx, dz), 1e-4);
  const nx = -dz / l;
  const nz = dx / l;
  const perp = WALL_THICKNESS / 2;
  const longBuf = 0.02;
  const dirX = dx / l;
  const dirZ = dz / l;
  return [
    [p1[0] - dirX * longBuf + nx * perp, p1[1] - dirZ * longBuf + nz * perp],
    [p2[0] + dirX * longBuf + nx * perp, p2[1] + dirZ * longBuf + nz * perp],
    [p2[0] + dirX * longBuf - nx * perp, p2[1] + dirZ * longBuf - nz * perp],
    [p1[0] - dirX * longBuf - nx * perp, p1[1] - dirZ * longBuf - nz * perp],
  ];
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function computeBounds(pts: V2[]): Bounds | null {
  if (!pts.length) return null;
  let minX = pts[0][0];
  let maxX = pts[0][0];
  let minZ = pts[0][1];
  let maxZ = pts[0][1];
  for (const p of pts) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  return { minX, maxX, minZ, maxZ };
}

// ── Label position resolution (iOS resolveLabelWorldPositions) ───────────────

export interface RoomLabelEntry {
  roomNumber: number;
  label: string;
  areaM2: number;
}

export function resolveLabelWorldPositions(
  roomNumbers: number[],
  boundsCentre: V2,
  centresByIndex: Record<number, V2>,
  allFloorCentres: V2[],
  markers: Record<number, V2>,
  offsets: Record<number, V2>
): Record<number, V2> {
  const preferMarkers = Object.keys(markers).length > allFloorCentres.length;
  const out: Record<number, V2> = {};
  for (const n of roomNumbers) {
    let base: V2;
    const marker = markers[n];
    if (preferMarkers && marker) {
      base = marker;
    } else if (centresByIndex[n]) {
      base = centresByIndex[n];
    } else if (marker) {
      let nearest: V2 | null = null;
      let bestD = Infinity;
      for (const c of allFloorCentres) {
        const d = dist(c, marker);
        if (d < bestD) {
          bestD = d;
          nearest = c;
        }
      }
      base = nearest ?? marker;
    } else {
      base = boundsCentre;
    }
    const off = offsets[n] ?? [0, 0];
    out[n] = [base[0] + off[0], base[1] + off[1]];
  }
  return out;
}

// ── Draft-data parsing (iOS FloorPlanView / DraftDetailView helpers) ─────────

/** Newest value per data_key (max id wins) — matches iOS fetchBackendDraftBundle. */
export function buildTextDataMap(entries: DraftDataEntry[]): Record<string, string> {
  const map: Record<string, string> = {};
  const idByKey: Record<string, number> = {};
  for (const e of entries) {
    const prev = idByKey[e.data_key];
    if (prev !== undefined && prev >= e.id) continue;
    idByKey[e.data_key] = e.id;
    map[e.data_key] = e.data_value;
  }
  return map;
}

function parseNum(v: string | undefined): number | null {
  if (v == null) return null;
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export interface WallGraphData {
  vertices: V2[];
  edges: { a: number; b: number }[];
}

export function parseWallGraph(map: Record<string, string>): [V2, V2][] | null {
  const raw = map["wall_graph_json"];
  if (!raw) return null;
  try {
    const g = JSON.parse(raw) as WallGraphData;
    if (!Array.isArray(g?.vertices) || !Array.isArray(g?.edges) || !g.edges.length) return null;
    const segs: [V2, V2][] = [];
    for (const e of g.edges) {
      const a = g.vertices[e.a];
      const b = g.vertices[e.b];
      if (a && b) segs.push([[a[0], a[1]], [b[0], b[1]]]);
    }
    return segs.length ? segs : null;
  } catch {
    return null;
  }
}

export interface CustomOpening {
  id: string; // lowercased UUID
  kind: "door" | "window";
  p1: V2;
  p2: V2;
}

export interface OpeningEdits {
  deletedSourceOpeningIDs: Set<string>;
  customOpenings: CustomOpening[];
}

export function parseOpeningEdits(map: Record<string, string>): OpeningEdits {
  const empty: OpeningEdits = { deletedSourceOpeningIDs: new Set(), customOpenings: [] };
  const raw = map["floorplan_opening_edits_json"];
  if (!raw) return empty;
  try {
    const j = JSON.parse(raw) as {
      deletedSourceOpeningIDs?: string[];
      customOpenings?: { id?: string; kind?: string; p1?: number[]; p2?: number[] }[];
    };
    const deleted = new Set((j.deletedSourceOpeningIDs ?? []).map((s) => String(s).toLowerCase()));
    const custom: CustomOpening[] = [];
    for (const op of j.customOpenings ?? []) {
      if (!Array.isArray(op.p1) || !Array.isArray(op.p2)) continue;
      custom.push({
        id: String(op.id ?? "").toLowerCase(),
        kind: op.kind === "window" ? "window" : "door",
        p1: [op.p1[0], op.p1[1]],
        p2: [op.p2[0], op.p2[1]],
      });
    }
    return { deletedSourceOpeningIDs: deleted, customOpenings: custom };
  } catch {
    return empty;
  }
}

export interface DoorConfig {
  doorType: string; // "Swinging" | "Moving"
  hingeSide: string; // "Left" | "Right" | "Moving"
  swingDirection: string; // "In" | "Out" | "Moving"
}

/** iOS derivedDoorConfigurations: door_<N>_camera fields keyed by door_id. */
export function parseDoorConfigs(map: Record<string, string>): Record<string, DoorConfig> {
  const out: Record<string, DoorConfig> = {};
  for (const [key, raw] of Object.entries(map)) {
    if (!key.startsWith("door_") || !key.endsWith("_camera")) continue;
    try {
      const dict = JSON.parse(raw) as Record<string, unknown>;
      const doorID = String(dict.door_id ?? "").toLowerCase();
      if (!doorID) continue;
      out[doorID] = {
        doorType: typeof dict.door_type === "string" ? dict.door_type : "Swinging",
        hingeSide: typeof dict.hinge_side === "string" ? dict.hinge_side : "Moving",
        swingDirection: typeof dict.swing_direction === "string" ? dict.swing_direction : "Moving",
      };
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

/** door renders its swing symbol only when fully user-configured (iOS gate). */
export function doorSwingRenderable(cfg: DoorConfig | undefined): boolean {
  return !!cfg && cfg.doorType === "Swinging" && cfg.hingeSide !== "Moving" && cfg.swingDirection !== "Moving";
}

function parseIndexedPairs(map: Record<string, string>, suffixX: string, suffixZ: string): Record<number, V2> {
  const out: Record<number, V2> = {};
  for (const key of Object.keys(map)) {
    if (!key.startsWith("room_") || !key.endsWith(suffixX)) continue;
    const middle = key.slice("room_".length, key.length - suffixX.length);
    const n = parseInt(middle, 10);
    if (!Number.isFinite(n)) continue;
    const x = parseNum(map[key]);
    const z = parseNum(map[`room_${n}${suffixZ}`]);
    if (x == null || z == null) continue;
    out[n] = [x, z];
  }
  return out;
}

export const parseLabelOffsets = (map: Record<string, string>) =>
  parseIndexedPairs(map, "_label_offset_x", "_label_offset_z");

export const parseRoomMarkers = (map: Record<string, string>) =>
  parseIndexedPairs(map, "_marker_x", "_marker_z");

export const parseRoomCenters = (map: Record<string, string>) =>
  parseIndexedPairs(map, "_center_x", "_center_z");

export function roomNumbersInTextData(map: Record<string, string>): number[] {
  const out = new Set<number>();
  for (const key of Object.keys(map)) {
    if (!key.startsWith("room_")) continue;
    const tail = key.slice("room_".length);
    const underscore = tail.indexOf("_");
    if (underscore <= 0) continue;
    const n = parseInt(tail.slice(0, underscore), 10);
    if (Number.isFinite(n)) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

export function parseRoomAreaOverrides(map: Record<string, string>): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [key, value] of Object.entries(map)) {
    if (!key.startsWith("room_") || !key.endsWith("_area")) continue;
    const n = parseInt(key.slice("room_".length, key.length - "_area".length), 10);
    if (!Number.isFinite(n)) continue;
    const area = parseNum(value);
    if (area != null && area > 0) out[n] = area;
  }
  return out;
}

export function totalFloorArea(map: Record<string, string>): number {
  return parseNum(map["floor_area"]) ?? parseNum(map["area"]) ?? 0;
}

export function floorplanRotationDegrees(map: Record<string, string>): number {
  const n = parseNum(map["floorplan_rotation_degrees"]) ?? 0;
  return ((Math.round(n) % 360) + 360) % 360;
}

/** Explicit room label, else room type code, else null (caller localizes "Room N").
 * Generic defaults in any app language ("Room 2", "Miestnosť 2", …) count as unset. */
export function rawRoomLabel(n: number, map: Record<string, string>): { label: string | null; typeCode: string | null } {
  const explicit = map[`room_${n}_label`]?.trim();
  const typeCode = map[`room_${n}_type`]?.trim() || null;
  const isGeneric =
    !explicit || new RegExp(`^(Room|Miestnosť|Místnost|Zimmer|Raum)\\s*${n}$`, "i").test(explicit);
  if (isGeneric) return { label: null, typeCode };
  return { label: explicit, typeCode };
}
