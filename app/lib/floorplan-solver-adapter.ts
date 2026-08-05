/**
 * Bridge from the Reaigen web geometry model (floorplan-geometry.ts) to the
 * constrained @reaigen/floorplan-solver engine (beam search, room polygons,
 * door/window keep-outs, navigation repair, fail-closed validation).
 *
 * Replaces the interim heuristic `solveFurnitureLayout` path. Solve in the
 * pre-display-rotation frame; apply floorplan_rotation only afterwards, exactly
 * as walls/openings are rotated for rendering.
 */
import {
  furnitureKindFromRoomPlan,
  solveFloorplan,
  type FurnitureObservation,
  type RoomType,
  type SolveResult,
  type SolverOptions,
} from "@reaigen/floorplan-solver";
import type { DoorConfig, ObjectXZ, SolverRoomXZ, SurfaceXZ, V2 } from "./floorplan-geometry";

export interface ReaigenSolveInput {
  walls: [V2, V2][];
  doors?: { id?: string; p1: V2; p2: V2 }[];
  windows?: { id?: string; p1: V2; p2: V2 }[];
  openings?: SurfaceXZ[];
  objects: ObjectXZ[];
  doorConfigs?: Record<string, DoorConfig>;
  /** Per-room floor polygons (world XZ) in the same frame as walls/objects.
   * Empty ⇒ the solver polygonizes closed wall loops (wall-face rooms). */
  rooms?: Array<V2[] | SolverRoomXZ>;
  options?: SolverOptions;
}

export interface ReaigenSolveOutput {
  /** Objects safe to render (rejected + merged omitted), in the input frame. */
  objects: ObjectXZ[];
  result: SolveResult;
  rejectedIds: Set<string>;
  mergedIds: Set<string>;
}

const DEFAULT_OPTIONS: SolverOptions = { strict: true, runNavigationRepair: true };

function runSolve(input: ReaigenSolveInput, rooms: SolverRoomXZ[]): SolveResult {
  const objects: FurnitureObservation[] = input.objects.map((object, index) => ({
    id: (object.id || `object-${index}`).toLowerCase(),
    category: object.category,
    kind: furnitureKindFromRoomPlan(object.category),
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
  return solveFloorplan(
    {
      rooms: rooms.map((room) => ({
        id: room.id,
        polygon: room.polygon,
        type: room.type ?? "unknown",
        source: "roomplan-floor" as const,
      })),
      walls: input.walls.map(([p1, p2], index) => ({ id: `wall-${index}`, p1, p2 })),
      openings: [
        ...(input.doors ?? []).map((door, index) => {
          const id = (door.id ?? `door-${index}`).toLowerCase();
          return {
            id,
            kind: "door" as const,
            p1: door.p1,
            p2: door.p2,
            configuration: input.doorConfigs?.[id],
          };
        }),
        ...(input.windows ?? []).map((window, index) => ({
          id: (window.id ?? `window-${index}`).toLowerCase(),
          kind: "window" as const,
          p1: window.p1,
          p2: window.p2,
        })),
        ...(input.openings ?? []).map((opening, index) => ({
          id: (opening.id || `opening-${index}`).toLowerCase(),
          kind: "opening" as const,
          p1: opening.p1,
          p2: opening.p2,
          ...(opening.parentId ? { parentId: opening.parentId } : {}),
          ...(opening.wallId ? { wallId: opening.wallId } : {}),
          ...(opening.roomIds ? { roomIds: opening.roomIds } : {}),
        })),
      ],
      objects,
      source: "canonical",
    },
    input.options ?? DEFAULT_OPTIONS
  );
}

const WALL_SUPPORT_COS = Math.cos((15 * Math.PI) / 180);
const WALL_SUPPORT_DISTANCE = 0.26;

/** A fallback room edge is containment evidence only. It must never become a
 * furniture-supporting wall unless a measured wall segment covers that edge. */
function hasObservedWallSupport(object: SolveResult["objects"][number], walls: [V2, V2][]): boolean {
  const axes = [
    { along: object.axisW, normal: object.axisD, halfAlong: object.halfW, halfDepth: object.halfD },
    { along: object.axisD, normal: object.axisW, halfAlong: object.halfD, halfDepth: object.halfW },
  ];
  for (const [a, b] of walls) {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    if (length < 0.15) continue;
    const wallDir: V2 = [dx / length, dz / length];
    for (const axis of axes) {
      if (Math.abs(axis.along[0] * wallDir[0] + axis.along[1] * wallDir[1]) < WALL_SUPPORT_COS) continue;
      for (const side of [-1, 1]) {
        const edgeCenter: V2 = [
          object.center[0] + axis.normal[0] * axis.halfDepth * side,
          object.center[1] + axis.normal[1] * axis.halfDepth * side,
        ];
        const rx = edgeCenter[0] - a[0];
        const rz = edgeCenter[1] - a[1];
        const t = rx * wallDir[0] + rz * wallDir[1];
        const closest: V2 = [a[0] + wallDir[0] * t, a[1] + wallDir[1] * t];
        const perpendicular = Math.hypot(edgeCenter[0] - closest[0], edgeCenter[1] - closest[1]);
        const overlap = Math.max(0, Math.min(length, t + axis.halfAlong) - Math.max(0, t - axis.halfAlong));
        const requiredOverlap = Math.min(length, 2 * axis.halfAlong) * 0.35;
        if (perpendicular <= WALL_SUPPORT_DISTANCE && overlap >= requiredOverlap) return true;
      }
    }
  }
  return false;
}

function failClosedOnInventedWalls(result: SolveResult, walls: [V2, V2][]): SolveResult {
  if (result.diagnostics.roomSource !== "fallback-hull") return result;
  let rejected = 0;
  const objects = result.objects.map((object) => {
    const wallPlaced = object.candidateSource === "wall" || object.candidateSource === "storage-wall-run";
    if (object.status === "rejected" || object.status === "merged" || !wallPlaced || hasObservedWallSupport(object, walls)) {
      return object;
    }
    rejected += 1;
    return {
      ...object,
      status: "rejected" as const,
      center: [object.sourcePose.center[0], object.sourcePose.center[1]] as V2,
      axisW: [object.sourcePose.axisW[0], object.sourcePose.axisW[1]] as V2,
      axisD: [object.sourcePose.axisD[0], object.sourcePose.axisD[1]] as V2,
      halfW: object.sourcePose.halfW,
      halfD: object.sourcePose.halfD,
      selectedCandidateId: null,
      candidateSource: "reject" as const,
      displacement: 0,
      yawDeltaDeg: 0,
      reasons: ["Rejected because the fallback room edge has no matching observed wall."],
    };
  });
  if (!rejected) return result;
  const acceptedObjectCount = objects.filter((object) => object.status !== "rejected" && object.status !== "merged").length;
  const rejectedObjectCount = objects.filter((object) => object.status === "rejected").length;
  return {
    ...result,
    objects,
    diagnostics: {
      ...result.diagnostics,
      acceptedObjectCount,
      rejectedObjectCount,
      warnings: [
        ...result.diagnostics.warnings,
        `${rejected} wall-based placement(s) rejected because an inferred room edge was not an observed wall.`,
      ],
    },
  };
}

export function solveReaigenFloorplan(input: ReaigenSolveInput): ReaigenSolveOutput {
  const roomPolygons = (input.rooms ?? [])
    .map((room, index): SolverRoomXZ | null =>
      Array.isArray(room)
        ? room.length >= 3
          ? { id: `floor-${index}`, polygon: room }
          : null
        : room.polygon.length >= 3
          ? { id: room.id || `floor-${index}`, polygon: room.polygon, type: room.type as RoomType | undefined }
          : null
    )
    .filter((room): room is SolverRoomXZ => room !== null);

  const result = failClosedOnInventedWalls(runSolve(input, roomPolygons), input.walls);

  const sourceById = new Map(input.objects.map((o) => [o.id.toLowerCase(), o]));
  const objects: ObjectXZ[] = [];
  const rejectedIds = new Set<string>();
  const mergedIds = new Set<string>();

  for (const solved of result.objects) {
    if (solved.status === "rejected") {
      rejectedIds.add(solved.id);
      continue;
    }
    if (solved.status === "merged") {
      mergedIds.add(solved.id);
      continue;
    }
    const source = sourceById.get(solved.id.toLowerCase());
    objects.push({
      ...(source ?? {}),
      id: solved.id,
      category: solved.category,
      center: [solved.center[0], solved.center[1]],
      axisW: [solved.axisW[0], solved.axisW[1]],
      axisD: [solved.axisD[0], solved.axisD[1]],
      halfW: solved.halfW,
      halfD: solved.halfD,
    });
  }

  return { objects, result, rejectedIds, mergedIds };
}

/** Feature flag for the constraint solver. Flip to false to fall back to the
 * legacy `solveFurnitureLayout` path for A/B comparison. */
export const USE_CONSTRAINT_SOLVER = true;

export type { SurfaceXZ };
