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
import { parseRoomPlanJSON, type RoomType } from "@reaigen/floorplan-solver";
import { LAYOUT_PRIORS } from "./floorplan-layout-priors";
import { solveLayout } from "./floorplan-layout-solver";

export type V2 = [number, number]; // [x, z] world metres

// iOS tuning constants (LocalFloorplanRenderer)
// Presentation thickness, not a claim about the scanned construction build-up.
// 115 mm keeps wall hierarchy clear without overwhelming small-room plans.
export const WALL_THICKNESS = 0.115;
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
  parentId?: string;
  wallId?: string;
  roomIds?: string[];
}

/** RoomPlan CapturedRoom.Object footprint: an oriented box in world XZ.
 * `axisW`/`axisD` are the unit local X/Z axes; footprint corners are
 * center ± axisW·halfW ± axisD·halfD. */
export interface ObjectXZ {
  id: string; // lowercased UUID
  category: string; // RoomPlan category key, e.g. "sofa", "washerDryer"
  center: V2;
  axisW: V2;
  axisD: V2;
  halfW: number;
  halfD: number;
  height?: number;
  centerY?: number;
  confidence?: number;
  parentId?: string;
  attributes?: string[];
  sourceRoomId?: string;
}

export interface SolverRoomXZ {
  id: string;
  polygon: V2[];
  type?: RoomType;
}

interface CapturedFloorXZ extends SolverRoomXZ {
  roomId: string;
  center: V2;
  area: number;
  rect: V2[];
}

export interface ParsedCapturedRoom {
  walls: SurfaceXZ[];
  doors: SurfaceXZ[];
  windows: SurfaceXZ[];
  openings: SurfaceXZ[];
  floors: CapturedFloorXZ[];
  objects: ObjectXZ[];
}

export function parseCapturedRoom(json: unknown): ParsedCapturedRoom | null {
  try {
    const scene = parseRoomPlanJSON(json);
    if (!scene.walls.length) return null;
    const sceneRooms = scene.rooms ?? [];
    const sceneOpenings = scene.openings ?? [];
    const surface = (value: {
      id: string;
      p1: V2;
      p2: V2;
      parentId?: string;
      wallId?: string;
      roomIds?: string[];
    }): SurfaceXZ => ({
      id: value.id,
      p1: [value.p1[0], value.p1[1]],
      p2: [value.p2[0], value.p2[1]],
      ...(value.parentId ? { parentId: value.parentId } : {}),
      ...(value.wallId ? { wallId: value.wallId } : {}),
      ...(value.roomIds ? { roomIds: [...value.roomIds] } : {}),
    });
    const floors: CapturedFloorXZ[] = sceneRooms.map((room) => {
      const polygon = room.polygon.map((point) => [point[0], point[1]] as V2);
      let area2 = 0;
      let cx = 0;
      let cz = 0;
      for (let i = 0; i < polygon.length; i += 1) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        const cross = a[0] * b[1] - b[0] * a[1];
        area2 += cross;
        cx += (a[0] + b[0]) * cross;
        cz += (a[1] + b[1]) * cross;
      }
      const center: V2 =
        Math.abs(area2) > 1e-6
          ? [cx / (3 * area2), cz / (3 * area2)]
          : [
              polygon.reduce((sum, point) => sum + point[0], 0) / polygon.length,
              polygon.reduce((sum, point) => sum + point[1], 0) / polygon.length,
            ];
      return {
        id: room.floorId ?? room.id,
        roomId: room.id,
        type: room.type,
        center,
        area: Math.abs(area2) / 2,
        polygon,
        rect: polygon.map((point) => [point[0], point[1]] as V2),
      };
    });
    const objects: ObjectXZ[] = scene.objects.map((object) => ({
      id: object.id,
      category: object.category,
      center: [object.center[0], object.center[1]],
      axisW: [object.axisW[0], object.axisW[1]],
      axisD: [object.axisD[0], object.axisD[1]],
      halfW: object.halfW,
      halfD: object.halfD,
      ...(object.height != null ? { height: object.height } : {}),
      ...(object.centerY != null ? { centerY: object.centerY } : {}),
      ...(object.confidence != null ? { confidence: object.confidence } : {}),
      ...(object.parentId ? { parentId: object.parentId } : {}),
      ...(object.attributes ? { attributes: [...object.attributes] } : {}),
      ...(object.sourceRoomId ? { sourceRoomId: object.sourceRoomId } : {}),
    }));
    return {
      walls: scene.walls.map(surface),
      doors: sceneOpenings.filter((opening) => opening.kind === "door").map(surface),
      windows: sceneOpenings.filter((opening) => opening.kind === "window").map(surface),
      openings: sceneOpenings.filter((opening) => opening.kind === "opening").map(surface),
      floors,
      objects,
    };
  } catch {
    return null;
  }
}

// ── Manhattan snap (iOS manhattanAdjust) ─────────────────────────────────────

export interface AdjustedGeometry {
  walls: SurfaceXZ[];
  doors: SurfaceXZ[];
  windows: SurfaceXZ[];
  openings: SurfaceXZ[];
  objects: ObjectXZ[];
  sceneRotation: number;
  interiorCentroid: V2;
  rawCentroid: V2;
  floorCentresByID: Record<string, V2>;
  floorCentresByIndex: Record<number, V2>;
  /** Per-floor room polygons in the post-snap frame (world XZ), for the layout
   * solver's room-containment constraint. Empty when the capture has no floors. */
  rooms: V2[][];
  /** Same polygons with stable RoomPlan room IDs and section-derived types. */
  solverRooms: SolverRoomXZ[];
  /** Per-floor oriented dimensions rectangles (post-snap frame). Diagnostic /
   * candidate room source — the union of these approximates an L-shaped room. */
  floorPolys: V2[][];
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
  for (const s of [...room.walls, ...room.doors, ...room.windows, ...room.openings]) allPts.push(s.p1, s.p2);
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
    return { ...w, p1, p2 };
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
    return { ...s, p1, p2 };
  };
  const gluedDoors = room.doors.map(glue);
  const gluedWindows = room.windows.map(glue);
  const gluedOpenings = room.openings.map(glue);

  // Furniture: tilt-corrected only — objects keep their own orientation
  // instead of being cardinal-snapped like walls.
  const rotateAxis = (a: V2): V2 => [a[0] * cosR - a[1] * sinR, a[0] * sinR + a[1] * cosR];
  const adjustedObjects: ObjectXZ[] = room.objects.map((o) => ({
    ...o,
    center: rotateAroundCentroid(o.center),
    axisW: rotateAxis(o.axisW),
    axisD: rotateAxis(o.axisD),
  }));

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
  const rooms: V2[][] = [];
  const solverRooms: SolverRoomXZ[] = [];
  const floorPolys: V2[][] = [];
  let keptIndex = 0;
  for (const floor of room.floors) {
    if (floor.area <= 0.1) continue;
    const centre = rotateAroundCentroid(floor.center);
    centresByID[floor.id] = centre;
    keptIndex += 1;
    centresByIndex[keptIndex] = centre;
    if (floor.polygon.length >= 3) {
      const polygon = floor.polygon.map(rotateAroundCentroid);
      rooms.push(polygon);
      solverRooms.push({ id: floor.roomId, polygon, type: floor.type });
    }
    if (floor.rect.length >= 3) floorPolys.push(floor.rect.map(rotateAroundCentroid));
  }

  return {
    walls: snappedWalls,
    doors: gluedDoors,
    windows: gluedWindows,
    openings: gluedOpenings,
    objects: adjustedObjects,
    sceneRotation: rot,
    interiorCentroid: interior,
    rawCentroid: centroid,
    floorCentresByID: centresByID,
    floorCentresByIndex: centresByIndex,
    rooms,
    solverRooms,
    floorPolys,
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

// ── Furniture categories ─────────────────────────────────────────────────────

/** Canonical symbol set drawn by the plan renderer. */
export type FurnitureKind =
  | "bed"
  | "sofa"
  | "chair"
  | "table"
  | "storage"
  | "refrigerator"
  | "stove"
  | "oven"
  | "dishwasher"
  | "washerDryer"
  | "sink"
  | "toilet"
  | "bathtub"
  | "fireplace"
  | "television"
  | "stairs"
  | "generic";

/** Normalize a RoomPlan category key or backend furniture_type
 * ("sofa_var_26", "WasherDryer", "couch") to a symbol kind. */
export function furnitureKind(raw: string): FurnitureKind {
  const key = raw.toLowerCase().replace(/_var.*$|[\s_-]|\d+$/g, "");
  switch (key) {
    case "bed":
      return "bed";
    case "sofa":
    case "couch":
      return "sofa";
    case "chair":
    case "stool":
      return "chair";
    case "table":
    case "desk":
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
    case "washingmachine":
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
    case "stairs":
    case "staircase":
      return "stairs";
    default:
      return "generic";
  }
}

/** Real-world containment pairs, not double detection (ARKitScenes ground
 * truth: ~2.6 such pairs per scene): chairs tuck under tables; sinks, ovens,
 * stoves, dishwashers and TVs sit inside/on cabinetry; ovens under stoves. */
const CONTAINMENT_OK: [FurnitureKind, FurnitureKind][] = [
  ["chair", "table"],
  ["sink", "storage"],
  ["oven", "storage"],
  ["stove", "storage"],
  ["dishwasher", "storage"],
  ["television", "storage"],
  ["oven", "stove"],
];

function realContainmentPair(a: ObjectXZ, b: ObjectXZ): boolean {
  const ka = furnitureKind(a.category);
  const kb = furnitureKind(b.category);
  return CONTAINMENT_OK.some(([x, y]) => (ka === x && kb === y) || (ka === y && kb === x));
}

/** Kinds that cannot physically stand directly in front of / behind a
 * parallel twin — such a pair is always a fragment/double detection.
 * (Tables CAN butt front-to-back — two pushed together — and chairs form
 * rows, so both stay out of this rule.) */
const NO_STACK = new Set<FurnitureKind>([
  "sofa",
  "bed",
  "storage",
  "refrigerator",
  "washerDryer",
  "dishwasher",
  "oven",
  "stove",
  "sink",
  "toilet",
  "bathtub",
  "television",
  "fireplace",
]);

const objectArea = (o: ObjectXZ) => 4 * o.halfW * o.halfD;

/** Drop parallel same-kind twins stacked front-to-back or overlapping —
 * impossible arrangements that are always fragment detections. `slack` widens
 * the "touching" test so post-hug near-contact stacks also collapse. */
/** Indices to drop. Frame-agnostic: RoomPlan may report a fragment's box
 * rotated 90° from its twin (W/D swapped), so orientation is compared
 * mod 90° and the smaller box's extents are projected onto the larger's
 * frame before the side-by-side / stacked classification. */
function stackedTwinDrops(objects: ObjectXZ[], slack: number): Set<number> {
  const quarter = Math.PI / 2;
  const tol = (15 * Math.PI) / 180;
  const dropped = new Set<number>();
  for (let i = 0; i < objects.length; i++) {
    for (let j = i + 1; j < objects.length; j++) {
      if (dropped.has(i) || dropped.has(j)) continue;
      const kind = furnitureKind(objects[i].category);
      if (furnitureKind(objects[j].category) !== kind || !NO_STACK.has(kind)) continue;
      // Work in the larger object's frame.
      const [a, b] =
        objectArea(objects[i]) >= objectArea(objects[j])
          ? [objects[i], objects[j]]
          : [objects[j], objects[i]];
      const thA = Math.atan2(a.axisW[1], a.axisW[0]);
      const thB = Math.atan2(b.axisW[1], b.axisW[0]);
      let dTh = (thB - thA) % quarter;
      if (dTh > quarter / 2) dTh -= quarter;
      if (dTh < -quarter / 2) dTh += quarter;
      if (Math.abs(dTh) > tol) continue;
      const off: V2 = [b.center[0] - a.center[0], b.center[1] - a.center[1]];
      const latOff = Math.abs(off[0] * a.axisW[0] + off[1] * a.axisW[1]);
      const froOff = Math.abs(off[0] * a.axisD[0] + off[1] * a.axisD[1]);
      const bLat =
        Math.abs(a.axisW[0] * b.axisW[0] + a.axisW[1] * b.axisW[1]) * b.halfW +
        Math.abs(a.axisW[0] * b.axisD[0] + a.axisW[1] * b.axisD[1]) * b.halfD;
      const bFro =
        Math.abs(a.axisD[0] * b.axisW[0] + a.axisD[1] * b.axisW[1]) * b.halfW +
        Math.abs(a.axisD[0] * b.axisD[0] + a.axisD[1] * b.axisD[1]) * b.halfD;
      // Genuinely side by side (twin beds, wardrobe run, L-sectional) — keep.
      if (latOff >= (a.halfW + bLat) * 0.6) continue;
      // Stacked front-to-back within touching range (or overlapping): fragment.
      if (froOff > a.halfD + bFro + slack) continue;
      dropped.add(objectArea(objects[i]) <= objectArea(objects[j]) ? i : j);
    }
  }
  return dropped;
}

function collapseStackedTwins(objects: ObjectXZ[], slack = LAYOUT_PRIORS.stackSlackPre): ObjectXZ[] {
  const dropped = stackedTwinDrops(objects, slack);
  return dropped.size ? objects.filter((_, k) => !dropped.has(k)) : objects;
}

/** Condition raw RoomPlan objects for plan rendering:
 *
 * 1. Drop objects scanned outside the walls — RoomPlan sees through openings
 *    into neighbouring space, and a floating box outside the plan reads as a
 *    bug, not furniture.
 * 2. Snap near-cardinal boxes square. Detected boxes are routinely a few
 *    degrees crooked against the (already Manhattan-snapped) walls; genuinely
 *    angled furniture keeps its rotation.
 * 3. Collapse double detections: when two boxes of the same kind overlap
 *    almost entirely, keep the larger.
 * 4. Sort large footprints first so small pieces (chairs on tables) draw on
 *    top and occlude correctly.
 */
export function prepareObjects(
  objects: ObjectXZ[],
  wallBounds: Bounds | null,
  margin = LAYOUT_PRIORS.outOfBoundsMargin,
  snapDeg = LAYOUT_PRIORS.yawSnapDeg
): ObjectXZ[] {
  let out = objects;
  if (wallBounds) {
    out = out.filter(
      (o) =>
        o.center[0] >= wallBounds.minX - margin &&
        o.center[0] <= wallBounds.maxX + margin &&
        o.center[1] >= wallBounds.minZ - margin &&
        o.center[1] <= wallBounds.maxZ + margin
    );
  }
  const quarter = Math.PI / 2;
  const snapRad = (snapDeg * Math.PI) / 180;
  out = out.map((o) => {
    const theta = Math.atan2(o.axisW[1], o.axisW[0]);
    const snapped = Math.round(theta / quarter) * quarter;
    if (Math.abs(theta - snapped) > snapRad) return o;
    const c = Math.cos(snapped);
    const s = Math.sin(snapped);
    return { ...o, axisW: [c, s] as V2, axisD: [-s, c] as V2 };
  });
  // Double-detection collapse via AABB overlap of the two footprints.
  const aabb = (o: ObjectXZ): Bounds => {
    const ex = Math.abs(o.axisW[0]) * o.halfW + Math.abs(o.axisD[0]) * o.halfD;
    const ez = Math.abs(o.axisW[1]) * o.halfW + Math.abs(o.axisD[1]) * o.halfD;
    return { minX: o.center[0] - ex, maxX: o.center[0] + ex, minZ: o.center[1] - ez, maxZ: o.center[1] + ez };
  };
  const area = (o: ObjectXZ) => 4 * o.halfW * o.halfD;
  const dropped = new Set<number>();
  const tuckPair = realContainmentPair;
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      if (dropped.has(i) || dropped.has(j)) continue;
      if (tuckPair(out[i], out[j])) continue;
      const A = aabb(out[i]);
      const B = aabb(out[j]);
      const ix = Math.min(A.maxX, B.maxX) - Math.max(A.minX, B.minX);
      const iz = Math.min(A.maxZ, B.maxZ) - Math.max(A.minZ, B.minZ);
      if (ix <= 0 || iz <= 0) continue;
      const overlap = ix * iz;
      const smaller = area(out[i]) <= area(out[j]) ? i : j;
      // Same kind: duplicates collapse from 45% containment (RoomPlan double
      // detections rarely align exactly). Different kinds only when the
      // smaller is almost entirely inside the larger.
      const threshold =
        out[i].category === out[j].category
          ? LAYOUT_PRIORS.dedupeSameKind
          : LAYOUT_PRIORS.dedupeCrossKind;
      if (overlap >= threshold * area(out[smaller])) dropped.add(smaller);
    }
  }
  return collapseStackedTwins(
    out.filter((_, i) => !dropped.has(i)),
    LAYOUT_PRIORS.stackSlackPre
  )
    .slice()
    .sort((a, b) => area(b) - area(a));
}

// ── Apartment layout solver ──────────────────────────────────────────────────

/** @deprecated thin wrapper — use solveLayout (floorplan-layout-solver.ts).
 * Kept so existing call sites and test bundles keep working; rejected
 * observations are dropped from the returned list (fail closed). */
export function solveFurnitureLayout(
  objects: ObjectXZ[],
  walls: [V2, V2][],
  interior: V2,
  doorOpenings: { p1: V2; p2: V2 }[] = [],
  rooms: V2[][] = []
): ObjectXZ[] {
  return solveLayout({ objects, walls, rooms, doors: doorOpenings, interior }).placed;
}


/** Footprint corners of an object box (clockwise). */
export function objectCorners(o: ObjectXZ): V2[] {
  const { center, axisW, axisD, halfW, halfD } = o;
  const corner = (sw: number, sd: number): V2 => [
    center[0] + axisW[0] * halfW * sw + axisD[0] * halfD * sd,
    center[1] + axisW[1] * halfW * sw + axisD[1] * halfD * sd,
  ];
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
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

/** Conservative publication gate for a RoomPlan door observation. A single
 * swinging leaf wider than 1.35 m is more likely a merged opening or scan
 * fragment. Explicit sliding doors may legitimately span a wider opening. */
export function doorObservationUsable(p1: V2, p2: V2, cfg: DoorConfig | undefined): boolean {
  const width = dist(p1, p2);
  if (width < 0.45) return false;
  if (cfg?.doorType === "Moving") return width <= 4;
  return width <= 1.35;
}

/** Normalized door configuration for callers that have already checked
 * `doorSwingRenderable`. Missing hinge/swing evidence must not be rendered as
 * an invented Left/In leaf; the conservative solver handles that ambiguity. */
export function resolveDoorConfig(cfg: DoorConfig | undefined): DoorConfig {
  if (cfg?.doorType === "Moving") return cfg;
  return {
    doorType: "Swinging",
    hingeSide: cfg && cfg.hingeSide !== "Moving" ? cfg.hingeSide : "Left",
    swingDirection: cfg && cfg.swingDirection !== "Moving" ? cfg.swingDirection : "In",
  };
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

const INTEGRATED_APPLIANCE_KINDS = new Set(["stove", "oven", "sink", "dishwasher"]);

/**
 * Consumer-plan geometry for appliances contained by casework. The solver and
 * debug layers retain the measured OBB; only the presentation copy is aligned
 * and depth-fitted to its cabinet run so two complete boxes are not drawn on
 * top of one another.
 */
/**
 * Converts noisy RoomPlan service-fixture observations into readable plan
 * symbols without changing solver geometry. Kitchen base storage containing a
 * stove, sink, oven, or dishwasher is shown as a conventional 600 mm counter
 * run. Its measured wall-side edge remains fixed and all added depth goes into
 * the room.
 */
export function prepareFloorplanPresentationObjects(objects: ObjectXZ[]): ObjectXZ[] {
  const normalizedKind = (object: ObjectXZ): string =>
    String(object.category ?? "")
      .toLowerCase()
      .replace(/[\s_-]+/g, "");

  const isStorage = (object: ObjectXZ): boolean => {
    const kind = normalizedKind(object);
    return kind.includes("storage") || kind.includes("cabinet");
  };

  const isKitchenFixture = (object: ObjectXZ): boolean => {
    const kind = normalizedKind(object);
    return (
      kind.includes("stove") ||
      kind.includes("cooktop") ||
      kind.includes("oven") ||
      kind.includes("sink") ||
      kind.includes("dishwasher")
    );
  };

  const isRefrigerator = (object: ObjectXZ): boolean =>
    normalizedKind(object).includes("refrigerator");

  const dot = (a: V2, b: V2): number => a[0] * b[0] + a[1] * b[1];
  const storages = objects.filter(isStorage);
  const fixtures = objects.filter(isKitchenFixture);
  const overrides = new Map<ObjectXZ, ObjectXZ>();

  const fixturesByStorage = new Map<ObjectXZ, ObjectXZ[]>();
  for (const fixture of fixtures) {
    let matched: ObjectXZ | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const storage of storages) {
      const delta: V2 = [
        fixture.center[0] - storage.center[0],
        fixture.center[1] - storage.center[1],
      ];
      const along = Math.abs(dot(delta, storage.axisW));
      const across = Math.abs(dot(delta, storage.axisD));
      const withinRun = along <= storage.halfW + 0.15;
      const withinCounterBand = across <= Math.max(0.45, storage.halfD + 0.2);
      const distance = along * along + across * across;

      if (withinRun && withinCounterBand && distance < bestDistance) {
        matched = storage;
        bestDistance = distance;
      }
    }

    if (matched) {
      const group = fixturesByStorage.get(matched) ?? [];
      group.push(fixture);
      fixturesByStorage.set(matched, group);
    }
  }

  const referenceObjects = objects.filter(
    (object) => !isStorage(object) && !isKitchenFixture(object)
  );

  for (const [storage, groupedFixtures] of fixturesByStorage) {
    const storageRoomId = (storage as ObjectXZ & { roomId?: string }).roomId;
    const sameRoomReferences = storageRoomId
      ? referenceObjects.filter(
          (object) =>
            (object as ObjectXZ & { roomId?: string }).roomId === storageRoomId
        )
      : referenceObjects;
    const directionReferences =
      sameRoomReferences.length > 0 ? sameRoomReferences : referenceObjects;

    const referenceCenter: V2 =
      directionReferences.length > 0
        ? [
            directionReferences.reduce((sum, object) => sum + object.center[0], 0) /
              directionReferences.length,
            directionReferences.reduce((sum, object) => sum + object.center[1], 0) /
              directionReferences.length,
          ]
        : [
            storage.center[0] + storage.axisD[0],
            storage.center[1] + storage.axisD[1],
          ];

    const towardReference: V2 = [
      referenceCenter[0] - storage.center[0],
      referenceCenter[1] - storage.center[1],
    ];
    const inwardSign = dot(towardReference, storage.axisD) >= 0 ? 1 : -1;
    const inwardAxisD: V2 = [
      storage.axisD[0] * inwardSign,
      storage.axisD[1] * inwardSign,
    ];

    // A professional residential base counter is conventionally about 600 mm
    // deep. Preserve deeper measured casework, but never squash it below that.
    const counterHalfDepth = Math.max(storage.halfD, 0.3);
    const wallSideCenter: V2 = [
      storage.center[0] - inwardAxisD[0] * storage.halfD,
      storage.center[1] - inwardAxisD[1] * storage.halfD,
    ];
    const counterCenter: V2 = [
      wallSideCenter[0] + inwardAxisD[0] * counterHalfDepth,
      wallSideCenter[1] + inwardAxisD[1] * counterHalfDepth,
    ];

    overrides.set(storage, {
      ...storage,
      center: counterCenter,
      axisD: inwardAxisD,
      halfD: counterHalfDepth,
      presentationVariant: "kitchen-counter",
    } as ObjectXZ & { presentationVariant: "kitchen-counter" });

    const occupiedIntervals: Array<[number, number]> = [];
    for (const fixture of groupedFixtures) {
      const fixtureAlongStorage =
        Math.abs(dot(fixture.axisW, storage.axisW)) * fixture.halfW +
        Math.abs(dot(fixture.axisD, storage.axisW)) * fixture.halfD;
      const fixtureAcrossStorage =
        Math.abs(dot(fixture.axisW, inwardAxisD)) * fixture.halfW +
        Math.abs(dot(fixture.axisD, inwardAxisD)) * fixture.halfD;
      const fixtureHalfWidth = Math.min(
        Math.max(fixtureAlongStorage, 0.24),
        Math.max(0.24, storage.halfW - 0.04)
      );
      const fixtureHalfDepth = Math.min(
        counterHalfDepth - 0.035,
        Math.max(0.24, Math.min(fixtureAcrossStorage, 0.28))
      );
      const rawOffset: V2 = [
        fixture.center[0] - storage.center[0],
        fixture.center[1] - storage.center[1],
      ];
      const maximumAlongOffset = Math.max(
        0,
        storage.halfW - fixtureHalfWidth - 0.04
      );
      const alongOffset = Math.max(
        -maximumAlongOffset,
        Math.min(maximumAlongOffset, dot(rawOffset, storage.axisW))
      );
      occupiedIntervals.push([
        alongOffset - fixtureHalfWidth,
        alongOffset + fixtureHalfWidth,
      ]);
      const fixtureCenter: V2 = [
        counterCenter[0] + storage.axisW[0] * alongOffset,
        counterCenter[1] + storage.axisW[1] * alongOffset,
      ];

      overrides.set(fixture, {
        ...fixture,
        center: fixtureCenter,
        axisW: storage.axisW,
        axisD: inwardAxisD,
        halfW: fixtureHalfWidth,
        halfD: fixtureHalfDepth,
        presentationVariant: "counter-fixture",
      } as ObjectXZ & { presentationVariant: "counter-fixture" });
    }

    const counterSeams: number[] = [];
    const addModuleSeams = (start: number, end: number) => {
      const span = end - start;
      const modules = Math.max(1, Math.round(span / 0.6));
      for (let index = 1; index < modules; index += 1) {
        counterSeams.push(start + (span * index) / modules);
      }
    };
    const sortedIntervals = occupiedIntervals
      .map(([start, end]) => [
        Math.max(-storage.halfW, start),
        Math.min(storage.halfW, end),
      ] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    let freeStart = -storage.halfW;
    for (const [start, end] of sortedIntervals) {
      addModuleSeams(freeStart, start);
      counterSeams.push(start, end);
      freeStart = Math.max(freeStart, end);
    }
    addModuleSeams(freeStart, storage.halfW);

    const counter = overrides.get(storage) ?? storage;
    overrides.set(storage, {
      ...counter,
      counterSeams: [...new Set(counterSeams.map((value) => Math.round(value * 1000) / 1000))]
        .filter((value) => Math.abs(value) < storage.halfW - 0.04)
        .sort((a, b) => a - b),
    } as ObjectXZ & { counterSeams: number[] });
  }

  // Generic wall storage keeps its exact solved footprint. Only orient the
  // presentation front toward furnished space so cabinet lines do not flip
  // between otherwise identical wall placements.
  for (const storage of storages) {
    if (fixturesByStorage.has(storage)) continue;
    const storageRoomId = (storage as ObjectXZ & { roomId?: string }).roomId;
    const sameRoomReferences = storageRoomId
      ? referenceObjects.filter(
          (object) => (object as ObjectXZ & { roomId?: string }).roomId === storageRoomId
        )
      : referenceObjects;
    const directionReferences = sameRoomReferences.length > 0 ? sameRoomReferences : referenceObjects;
    if (directionReferences.length === 0) continue;
    const referenceCenter: V2 = [
      directionReferences.reduce((sum, object) => sum + object.center[0], 0) /
        directionReferences.length,
      directionReferences.reduce((sum, object) => sum + object.center[1], 0) /
        directionReferences.length,
    ];
    const towardRoom: V2 = [
      referenceCenter[0] - storage.center[0],
      referenceCenter[1] - storage.center[1],
    ];
    const inwardAxisD: V2 =
      dot(storage.axisD, towardRoom) >= 0
        ? storage.axisD
        : [-storage.axisD[0], -storage.axisD[1]];
    overrides.set(storage, {
      ...(overrides.get(storage) ?? storage),
      axisD: inwardAxisD,
    });
  }

  // A refrigerator is wall-facing casework. Orient its door line toward the
  // furnished room so the symbol remains readable instead of using an
  // abstract appliance asterisk.
  const refrigeratorReferences = referenceObjects.filter(
    (object) => !isRefrigerator(object)
  );
  if (refrigeratorReferences.length > 0) {
    const referenceCenter: V2 = [
      refrigeratorReferences.reduce((sum, object) => sum + object.center[0], 0) /
        refrigeratorReferences.length,
      refrigeratorReferences.reduce((sum, object) => sum + object.center[1], 0) /
        refrigeratorReferences.length,
    ];
    for (const refrigerator of objects.filter(isRefrigerator)) {
      const towardRoom: V2 = [
        referenceCenter[0] - refrigerator.center[0],
        referenceCenter[1] - refrigerator.center[1],
      ];
      const inwardAxisD: V2 =
        dot(refrigerator.axisD, towardRoom) >= 0
          ? refrigerator.axisD
          : [-refrigerator.axisD[0], -refrigerator.axisD[1]];
      overrides.set(refrigerator, {
        ...(overrides.get(refrigerator) ?? refrigerator),
        axisD: inwardAxisD,
      });
    }
  }

  return objects.map((object) => overrides.get(object) ?? object);
}

/**
 * Produces a readable wall topology without inventing unsupported room shapes.
 * Captured floor polygons are authoritative. Legacy wall-only captures may
 * bridge an exterior Manhattan run only when at least 45% of the completed run
 * was measured and perpendicular endpoints support its corners. Door/window
 * masks are applied later, so measured openings remain open.
 */
export { conditionWallSegmentsForPresentation } from "./floorplan-wall-conditioning";
