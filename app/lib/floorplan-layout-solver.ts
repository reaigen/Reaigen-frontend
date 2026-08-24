/**
 * Candidate-based constrained floorplan layout solver.
 *
 * Replaces the continuous "nudge" relaxation with the architecture of a
 * scene-reconstruction engine: noisy RoomPlan furniture observations are
 * solved to the nearest physically valid, semantically plausible plan.
 *
 *  - Rooms are polygons (RoomPlan floor footprints; wall-bounds fallback),
 *    objects are assigned to the room with the largest footprint overlap.
 *  - Hard constraints are candidate VALIDITY, never post-hoc pushes:
 *    inside-room containment, SAT OBB non-overlap (walls, door reserves,
 *    other furniture), with explicit allowed-containment relations.
 *  - Each object gets a small set of discrete candidates (rectified raw,
 *    wall-flush placements, chair→table slots, sofa satellites, reject) and
 *    a greedy large-to-small selection minimizes energy = fidelity +
 *    prior terms. No valid candidate ⇒ the object is rejected (fail closed),
 *    never drawn somewhere illegal.
 *  - Every solved object carries status + human-readable reasons.
 *
 * Yaw rectification is category-gated (storage/appliances 12°, bed/sofa 10°,
 * table/chair 8°, generic none) — a correction threshold, not always-snap.
 */

import {
  distancePointToSegment,
  furnitureKind,
  objectCorners,
  WALL_THICKNESS,
  type FurnitureKind,
  type ObjectXZ,
  type V2,
} from "./floorplan-geometry";
import { KIND_PRIORS, LAYOUT_PRIORS } from "./floorplan-layout-priors";

export type SolveStatus = "unchanged" | "rectified" | "relocated" | "merged" | "rejected";

export interface SolvedObject extends ObjectXZ {
  status: SolveStatus;
  reasons: string[];
}

export interface DoorOpening {
  p1: V2;
  p2: V2;
}

export interface LayoutSolveInput {
  objects: ObjectXZ[];
  walls: [V2, V2][];
  /** Room floor polygons (world XZ). Empty ⇒ single implicit room from wall bounds. */
  rooms: V2[][];
  doors: DoorOpening[];
  interior: V2;
}

export interface LayoutSolveResult {
  placed: SolvedObject[];
  rejected: SolvedObject[];
}

// ── Category yaw-rectification thresholds (degrees) ──────────────────────────
const YAW_RECTIFY_DEG: Partial<Record<FurnitureKind, number>> = {
  storage: 12,
  refrigerator: 12,
  washerDryer: 12,
  dishwasher: 12,
  oven: 12,
  stove: 12,
  sink: 12,
  toilet: 12,
  bathtub: 12,
  television: 12,
  fireplace: 12,
  bed: 10,
  sofa: 10,
  table: 8,
  chair: 8,
  stairs: 12,
};

// ── Geometry primitives ──────────────────────────────────────────────────────

const dist = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

interface Obb {
  center: V2;
  axisW: V2;
  axisD: V2;
  halfW: number;
  halfD: number;
}

/** SAT overlap depth between two OBBs; 0 when separated. */
export function obbOverlapDepth(a: Obb, b: Obb): number {
  const axes = [a.axisW, a.axisD, b.axisW, b.axisD];
  const ca = objectCorners(a as ObjectXZ);
  const cb = objectCorners(b as ObjectXZ);
  let minPen = Infinity;
  for (const ax of axes) {
    let aMin = Infinity;
    let aMax = -Infinity;
    for (const p of ca) {
      const t = p[0] * ax[0] + p[1] * ax[1];
      aMin = Math.min(aMin, t);
      aMax = Math.max(aMax, t);
    }
    let bMin = Infinity;
    let bMax = -Infinity;
    for (const p of cb) {
      const t = p[0] * ax[0] + p[1] * ax[1];
      bMin = Math.min(bMin, t);
      bMax = Math.max(bMax, t);
    }
    const pen = Math.min(aMax, bMax) - Math.max(aMin, bMin);
    if (pen <= 0) return 0;
    minPen = Math.min(minPen, pen);
  }
  return minPen;
}

function polygonContains(p: V2, poly: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function distToPolyBoundary(p: V2, poly: V2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    d = Math.min(d, distancePointToSegment(p, poly[i], poly[(i + 1) % poly.length]));
  }
  return d;
}

/** Footprint containment with tolerance: corners inside, or within tol of the
 * boundary (RoomPlan floors sit inside the wall centre-lines). */
function footprintInsidePolygon(o: Obb, poly: V2[], tol: number): boolean {
  for (const c of objectCorners(o as ObjectXZ)) {
    if (!polygonContains(c, poly) && distToPolyBoundary(c, poly) > tol) return false;
  }
  return true;
}

function polygonArea(poly: V2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    s += x1 * z2 - x2 * z1;
  }
  return Math.abs(s) / 2;
}

/** Coarse overlap area between an OBB footprint and a polygon (corner+centre sampling). */
function footprintRoomScore(o: ObjectXZ, poly: V2[]): number {
  let inside = 0;
  const samples: V2[] = [o.center, ...objectCorners(o)];
  for (const s of samples) if (polygonContains(s, poly)) inside++;
  return inside / samples.length;
}

// ── Door reserved regions ────────────────────────────────────────────────────

/** Door reserve OBBs: threshold strip through the opening on both sides plus
 * a swing square on each approach side (conservative union — unconfigured
 * doors must not silently assume Left/In). */
export function doorReserves(doors: DoorOpening[]): Obb[] {
  const out: Obb[] = [];
  for (const { p1, p2 } of doors) {
    const len = Math.max(dist(p1, p2), 0.6);
    const dx = p2[0] - p1[0];
    const dz = p2[1] - p1[1];
    const l = Math.max(Math.hypot(dx, dz), 1e-4);
    const u: V2 = [dx / l, dz / l];
    const n: V2 = [-u[1], u[0]];
    const m: V2 = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    for (const side of [1, -1]) {
      out.push({
        center: [m[0] + n[0] * side * (len / 2), m[1] + n[1] * side * (len / 2)],
        axisW: u,
        axisD: [n[0] * side, n[1] * side],
        halfW: len / 2,
        halfD: len / 2,
      });
    }
  }
  return out;
}

// ── Candidates ───────────────────────────────────────────────────────────────

interface Candidate {
  pose: Obb;
  kindOfMove: "raw" | "rectified" | "wall" | "slot" | "satellite";
  energy: number;
  reasons: string[];
}

const rot = (v: V2, r: number): V2 => [
  v[0] * Math.cos(r) - v[1] * Math.sin(r),
  v[0] * Math.sin(r) + v[1] * Math.cos(r),
];

function yawOf(o: Obb): number {
  return Math.atan2(o.axisW[1], o.axisW[0]);
}

/** Smallest |Δ| to align yaw with the frame of `wallTheta` (mod 90°). */
function frameDelta(yaw: number, wallTheta: number): number {
  const quarter = Math.PI / 2;
  let d = (yaw - wallTheta) % quarter;
  if (d > quarter / 2) d -= quarter;
  if (d < -quarter / 2) d += quarter;
  return d;
}

function withPose(o: ObjectXZ, pose: Partial<Obb>): Obb {
  return {
    center: pose.center ?? o.center,
    axisW: pose.axisW ?? o.axisW,
    axisD: pose.axisD ?? o.axisD,
    halfW: pose.halfW ?? o.halfW,
    halfD: pose.halfD ?? o.halfD,
  };
}

// ── Storage wall-run merge ───────────────────────────────────────────────────

/** RoomPlan splits a continuous cabinet/counter/wardrobe run into several
 * adjacent "storage" boxes. These are not separate furniture — they are one
 * built-in run. Merge collinear, co-planar, adjacent storage boxes into a
 * single box so the wall-run is packed as one interval (and never renders as
 * overlapping "storage storage" fragments). Conservative: storage-only, tight
 * yaw / depth / gap gates so genuinely separate cabinets stay separate. */
export function mergeStorageRuns(objects: ObjectXZ[]): ObjectXZ[] {
  const MERGE_YAW = (10 * Math.PI) / 180;
  const DEPTH_TOL = 0.25; // perpendicular offset of the two run centres, metres
  const GAP_TOL = 0.35; // along-run edge-to-edge gap, metres
  const boxes = objects.slice();
  const isRun = (o: ObjectXZ) => furnitureKind(o.category) === "storage";

  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < boxes.length; i++) {
      if (!isRun(boxes[i])) continue;
      for (let j = i + 1; j < boxes.length; j++) {
        if (!isRun(boxes[j])) continue;
        const A = boxes[i];
        const B = boxes[j];
        if (Math.abs(frameDelta(yawOf(B), yawOf(A))) > MERGE_YAW) continue;
        // Work in A's frame: axisW = run direction, axisD = depth.
        const off: V2 = [B.center[0] - A.center[0], B.center[1] - A.center[1]];
        const alongOff = off[0] * A.axisW[0] + off[1] * A.axisW[1];
        const depthOff = off[0] * A.axisD[0] + off[1] * A.axisD[1];
        const eW = Math.abs(A.axisW[0] * B.axisW[0] + A.axisW[1] * B.axisW[1]) * B.halfW +
          Math.abs(A.axisW[0] * B.axisD[0] + A.axisW[1] * B.axisD[1]) * B.halfD;
        const eD = Math.abs(A.axisD[0] * B.axisW[0] + A.axisD[1] * B.axisW[1]) * B.halfW +
          Math.abs(A.axisD[0] * B.axisD[0] + A.axisD[1] * B.axisD[1]) * B.halfD;
        if (Math.abs(depthOff) > DEPTH_TOL) continue; // not co-planar (different wall/row)
        const gap = Math.abs(alongOff) - (A.halfW + eW);
        if (gap > GAP_TOL) continue; // not adjacent along the run
        // Union along-run extent; keep A's depth line (deeper of the two).
        const minW = Math.min(-A.halfW, alongOff - eW);
        const maxW = Math.max(A.halfW, alongOff + eW);
        const halfW = (maxW - minW) / 2;
        const shift = (minW + maxW) / 2;
        boxes[i] = {
          ...A,
          center: [A.center[0] + A.axisW[0] * shift, A.center[1] + A.axisW[1] * shift],
          halfW,
          halfD: Math.max(A.halfD, eD),
        };
        boxes.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return boxes;
}

// ── Solver ───────────────────────────────────────────────────────────────────

const CONTACT_EPS = 0.03; // permitted incidental OBB contact depth, metres

export function solveLayout(input: LayoutSolveInput): LayoutSolveResult {
  const { walls, doors, interior } = input;
  // Collapse fragmented cabinet/counter runs before placement.
  const objects = mergeStorageRuns(input.objects);

  // Rooms: floor polygons, else one implicit room spanned by the walls.
  let rooms = input.rooms.filter((r) => r.length >= 3 && polygonArea(r) > 1);
  if (!rooms.length) {
    const pts = walls.flat();
    if (pts.length) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const [x, z] of pts) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
      rooms = [[[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]]];
    }
  }

  // Wall solids as OBBs for hard non-penetration.
  const wallObbs: Obb[] = walls.map(([a, b]) => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.max(Math.hypot(dx, dz), 1e-4);
    const u: V2 = [dx / l, dz / l];
    return {
      center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      axisW: u,
      axisD: [-u[1], u[0]],
      halfW: l / 2,
      halfD: WALL_THICKNESS / 2,
    };
  });
  const reserves = doorReserves(doors);

  const roomOf = (o: ObjectXZ): { poly: V2[]; score: number } => {
    let best = rooms[0];
    let bestScore = -1;
    for (const r of rooms) {
      const s = footprintRoomScore(o, r);
      if (s > bestScore) {
        bestScore = s;
        best = r;
      }
    }
    return { poly: best, score: bestScore };
  };

  const containmentTol = WALL_THICKNESS / 2 + 0.12;

  const hardValid = (pose: Obb, roomPoly: V2[] | null, ignoreDoorReserve: boolean): string | null => {
    if (roomPoly && !footprintInsidePolygon(pose, roomPoly, containmentTol)) return "outside room";
    for (const w of wallObbs) {
      if (obbOverlapDepth(pose, w) > CONTACT_EPS + 0.03) return "intersects wall";
    }
    if (!ignoreDoorReserve) {
      for (const r of reserves) {
        if (obbOverlapDepth(pose, r) > CONTACT_EPS) return "intersects door swing";
      }
    }
    return null;
  };

  // Solve order: large first (anchors), then satellites/chairs.
  const order = objects
    .map((o, i) => ({ o, i }))
    .sort((a, b) => 4 * b.o.halfW * b.o.halfD - 4 * a.o.halfW * a.o.halfD);

  const placed: SolvedObject[] = [];
  const rejected: SolvedObject[] = [];
  const placedByKind = (k: FurnitureKind) => placed.filter((p) => furnitureKind(p.category) === k);

  const collidesPlaced = (pose: Obb, self: ObjectXZ): SolvedObject | null => {
    for (const p of placed) {
      const kinds = [furnitureKind(self.category), furnitureKind(p.category)];
      const allowed =
        (kinds[0] === "chair" && kinds[1] === "table") ||
        (kinds[0] === "table" && kinds[1] === "chair") ||
        (kinds.includes("storage") &&
          ["sink", "oven", "stove", "dishwasher", "television"].some((k) => kinds.includes(k as FurnitureKind)));
      if (allowed) continue;
      if (obbOverlapDepth(pose, p) > CONTACT_EPS) return p;
    }
    return null;
  };

  const NO_STACK: FurnitureKind[] = [
    "sofa", "bed", "storage", "refrigerator", "washerDryer", "dishwasher",
    "oven", "stove", "sink", "toilet", "bathtub", "television", "fireplace",
  ];
  const stackedBehindPlaced = (o: ObjectXZ): SolvedObject | null => {
    const kind = furnitureKind(o.category);
    if (!NO_STACK.includes(kind)) return null;
    for (const p of placed) {
      if (furnitureKind(p.category) !== kind) continue;
      const dTh = frameDelta(yawOf(o), yawOf(p));
      if (Math.abs(dTh) > (15 * Math.PI) / 180) continue;
      const off: V2 = [o.center[0] - p.center[0], o.center[1] - p.center[1]];
      const latOff = Math.abs(off[0] * p.axisW[0] + off[1] * p.axisW[1]);
      const froOff = Math.abs(off[0] * p.axisD[0] + off[1] * p.axisD[1]);
      const oLat =
        Math.abs(p.axisW[0] * o.axisW[0] + p.axisW[1] * o.axisW[1]) * o.halfW +
        Math.abs(p.axisW[0] * o.axisD[0] + p.axisW[1] * o.axisD[1]) * o.halfD;
      const oFro =
        Math.abs(p.axisD[0] * o.axisW[0] + p.axisD[1] * o.axisW[1]) * o.halfW +
        Math.abs(p.axisD[0] * o.axisD[0] + p.axisD[1] * o.axisD[1]) * o.halfD;
      if (latOff >= (p.halfW + oLat) * 0.6) continue; // genuinely side by side
      if (froOff > p.halfD + oFro + LAYOUT_PRIORS.stackSlackPost) continue;
      return p;
    }
    return null;
  };

  for (const { o } of order) {
    const kind = furnitureKind(o.category);
    const twin = stackedBehindPlaced(o);
    if (twin) {
      rejected.push({
        ...o,
        status: "merged",
        reasons: [`fragment of larger ${furnitureKind(twin.category)} detection`],
      });
      continue;
    }
    const { poly: roomPoly, score: roomScore } = rooms.length ? roomOf(o) : { poly: null as V2[] | null, score: 1 };
    const candidates: Candidate[] = [];
    const rawYaw = yawOf(o);

    // Nearest wall (for rectification frame + wall candidates).
    const wallsRanked = walls
      .map(([a, b]) => {
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const l = Math.max(Math.hypot(dx, dz), 1e-4);
        const u: V2 = [dx / l, dz / l];
        const n: V2 = [-u[1], u[0]];
        const t = Math.max(0, Math.min(l, (o.center[0] - a[0]) * u[0] + (o.center[1] - a[1]) * u[1]));
        const foot: V2 = [a[0] + u[0] * t, a[1] + u[1] * t];
        return { u, n, foot, len: l, d: dist(o.center, foot) };
      })
      .sort((x, y) => x.d - y.d);

    // C0: raw pose.
    candidates.push({ pose: withPose(o, {}), kindOfMove: "raw", energy: 0, reasons: [] });

    // C1: rectified raw (category-gated yaw correction to nearest wall frame).
    const gate = YAW_RECTIFY_DEG[kind];
    if (gate != null && wallsRanked.length) {
      const delta = frameDelta(rawYaw, Math.atan2(wallsRanked[0].u[1], wallsRanked[0].u[0]));
      const deltaDeg = Math.abs((delta * 180) / Math.PI);
      if (deltaDeg > 0.5 && deltaDeg <= gate) {
        candidates.push({
          pose: withPose(o, { axisW: rot(o.axisW, -delta), axisD: rot(o.axisD, -delta) }),
          kindOfMove: "rectified",
          energy: 0.1 + deltaDeg / 60,
          reasons: [`yaw corrected by ${deltaDeg.toFixed(1)}°`],
        });
      }
    }

    // C2: wall-flush placements on the two nearest walls (wall-affine kinds).
    const affinity = KIND_PRIORS[kind]?.wallAffinity ?? 0;
    if (affinity >= 0.5) {
      for (const w of wallsRanked.slice(0, 2)) {
        const inwardSign = (interior[0] - w.foot[0]) * w.n[0] + (interior[1] - w.foot[1]) * w.n[1] >= 0 ? 1 : -1;
        const inward: V2 = [w.n[0] * inwardSign, w.n[1] * inwardSign];
        // Keep the along-wall extent of the detected box.
        const wAlong = Math.abs(o.axisW[0] * w.u[0] + o.axisW[1] * w.u[1]);
        const dAlong = Math.abs(o.axisD[0] * w.u[0] + o.axisD[1] * w.u[1]);
        const swap = dAlong > wAlong;
        const halfW = swap ? o.halfD : o.halfW;
        const halfD = swap ? o.halfW : o.halfD;
        const gap = KIND_PRIORS[kind]?.backGap ?? 0.01;
        const along = (o.center[0] - w.foot[0]) * w.u[0] + (o.center[1] - w.foot[1]) * w.u[1];
        const target = WALL_THICKNESS / 2 + gap + halfD;
        const center: V2 = [
          w.foot[0] + w.u[0] * along + inward[0] * target,
          w.foot[1] + w.u[1] * along + inward[1] * target,
        ];
        const moveD = dist(center, o.center);
        if (moveD > LAYOUT_PRIORS.hugDistance + halfD) continue;
        candidates.push({
          pose: { center, axisW: [...w.u] as V2, axisD: inward, halfW, halfD },
          kindOfMove: "wall",
          energy: 0.05 + moveD * 0.8 - affinity * 0.4,
          reasons: ["placed flush against wall"],
        });
      }
    }

    // C3: chair slots at the nearest placed table.
    if (kind === "chair") {
      const tables = placedByKind("table");
      let tb: SolvedObject | null = null;
      let bestD = Infinity;
      for (const t of tables) {
        const d = dist(o.center, t.center);
        if (d < bestD) {
          bestD = d;
          tb = t;
        }
      }
      if (tb && bestD < Math.max(tb.halfW, tb.halfD) + 1.0) {
        for (const [axis, other, halfAxis, halfOther] of [
          [tb.axisW, tb.axisD, tb.halfW, tb.halfD],
          [tb.axisD, tb.axisW, tb.halfD, tb.halfW],
        ] as [V2, V2, number, number][]) {
          for (const sgn of [1, -1]) {
            const sideN: V2 = [axis[0] * sgn, axis[1] * sgn];
            const off: V2 = [o.center[0] - tb.center[0], o.center[1] - tb.center[1]];
            const alongRaw = off[0] * other[0] + off[1] * other[1];
            const along = Math.abs(alongRaw) < 0.3 ? 0 : Math.max(-halfOther + o.halfW, Math.min(halfOther - o.halfW, alongRaw));
            const outw = halfAxis + o.halfD - LAYOUT_PRIORS.chairTuck;
            const center: V2 = [
              tb.center[0] + sideN[0] * outw + other[0] * along,
              tb.center[1] + sideN[1] * outw + other[1] * along,
            ];
            const moveD = dist(center, o.center);
            if (moveD > LAYOUT_PRIORS.chairTableSnap + 0.3) continue;
            const axisD: V2 = [-sideN[0], -sideN[1]];
            candidates.push({
              pose: { center, axisW: [-axisD[1], axisD[0]], axisD, halfW: o.halfW, halfD: o.halfD },
              kindOfMove: "slot",
              energy: moveD * 0.5 - 0.35,
              reasons: ["seated at table"],
            });
          }
        }
      }
    }

    // C4: satellite slots for small tables near a placed sofa.
    if (kind === "table" && 2 * Math.max(o.halfW, o.halfD) <= LAYOUT_PRIORS.satelliteMaxLong) {
      const sofas = placedByKind("sofa");
      let anchor: SolvedObject | null = null;
      let bestD = Infinity;
      for (const s of sofas) {
        const d = dist(o.center, s.center);
        if (d < bestD) {
          bestD = d;
          anchor = s;
        }
      }
      if (anchor && bestD < Math.max(anchor.halfW, anchor.halfD) + LAYOUT_PRIORS.satelliteReach) {
        const long = Math.max(o.halfW, o.halfD);
        const short = Math.min(o.halfW, o.halfD);
        // coffee: centred in front
        const front = anchor.halfD + LAYOUT_PRIORS.coffeeTableGap + short;
        candidates.push({
          pose: {
            center: [anchor.center[0] + anchor.axisD[0] * front, anchor.center[1] + anchor.axisD[1] * front],
            axisW: [...anchor.axisW] as V2,
            axisD: [...anchor.axisD] as V2,
            halfW: long,
            halfD: short,
          },
          kindOfMove: "satellite",
          energy: Math.abs(bestD - front) * 0.4 - 0.25,
          reasons: ["composed as coffee table"],
        });
        // side: flush beside, back edges level
        for (const sgn of [1, -1]) {
          const outw = anchor.halfW + short + 0.02;
          const back = -anchor.halfD + long;
          candidates.push({
            pose: {
              center: [
                anchor.center[0] + anchor.axisW[0] * sgn * outw + anchor.axisD[0] * back,
                anchor.center[1] + anchor.axisW[1] * sgn * outw + anchor.axisD[1] * back,
              ],
              axisW: [...anchor.axisW] as V2,
              axisD: [...anchor.axisD] as V2,
              halfW: short,
              halfD: long,
            },
            kindOfMove: "satellite",
            energy: 0.3 - 0.25,
            reasons: ["composed as side table"],
          });
        }
      }
    }

    // Fidelity term + room prior on every candidate.
    for (const c of candidates) {
      const moveD = dist(c.pose.center, o.center);
      const dYaw = Math.abs(frameDelta(yawOf(c.pose), rawYaw));
      c.energy += moveD * moveD * 0.5 + dYaw * 0.3 + (1 - roomScore) * 0.5;
    }
    candidates.sort((a, b) => a.energy - b.energy);

    // Pick the first candidate that satisfies every hard constraint.
    let chosen: Candidate | null = null;
    let lastViolation = "no candidates";
    for (const c of candidates) {
      const chairSeated = c.kindOfMove === "slot";
      const violation = hardValid(c.pose, roomPoly, chairSeated);
      if (violation) {
        lastViolation = violation;
        continue;
      }
      const hit = collidesPlaced(c.pose, o);
      if (hit) {
        lastViolation = `overlaps ${furnitureKind(hit.category)}`;
        continue;
      }
      chosen = c;
      break;
    }

    if (!chosen) {
      rejected.push({
        ...o,
        status: "rejected",
        reasons: [`no legal placement (${lastViolation})`],
      });
      continue;
    }

    const moved = dist(chosen.pose.center, o.center) > 0.02;
    const turned = Math.abs(frameDelta(yawOf(chosen.pose), rawYaw)) > 0.01;
    placed.push({
      ...o,
      ...chosen.pose,
      status: chosen.kindOfMove === "raw" ? "unchanged" : moved ? "relocated" : turned ? "rectified" : "unchanged",
      reasons: chosen.reasons,
    });
  }

  return { placed, rejected };
}
