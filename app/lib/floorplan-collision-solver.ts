import type { ObjectXZ, V2 } from "./floorplan-geometry";

export interface EditableWallGraph {
  vertices: V2[];
  edges: { a: number; b: number }[];
}

export interface FloorplanFurnitureEdits {
  deletedSourceObjectIDs: string[];
  objectCenterOverrides: Record<string, V2>;
}

export interface FurnitureMoveResult {
  objects: ObjectXZ[];
  movedID: string | null;
  delta: V2;
  blocked: boolean;
}

export interface WallPushResult {
  wallDelta: V2;
  objects: ObjectXZ[];
  blocked: boolean;
}

interface Segment {
  a: V2;
  b: V2;
}

interface SweepHit {
  distance: number;
  normal: V2;
}

interface Penetration {
  depth: number;
  normal: V2;
}

const COLLISION_SKIN = 0.03;
const COLLISION_EPSILON = 0.00001;
const COLLISION_GUARD = 0.00025;
const WALL_THICKNESS = 0.115;

const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const mul = (a: V2, scalar: number): V2 => [a[0] * scalar, a[1] * scalar];
const dot = (a: V2, b: V2): number => a[0] * b[0] + a[1] * b[1];
const length = (a: V2): number => Math.hypot(a[0], a[1]);
const normalize = (a: V2, fallback: V2 = [1, 0]): V2 => {
  const magnitude = length(a);
  return magnitude > 1e-8 ? [a[0] / magnitude, a[1] / magnitude] : fallback;
};
const segmentMidpoint = (segment: Segment): V2 => mul(add(segment.a, segment.b), 0.5);
const segmentLength = (segment: Segment): number => length(sub(segment.b, segment.a));

export const emptyFurnitureEdits = (): FloorplanFurnitureEdits => ({
  deletedSourceObjectIDs: [],
  objectCenterOverrides: {},
});

export function cloneFurnitureEdits(edits: FloorplanFurnitureEdits): FloorplanFurnitureEdits {
  return {
    deletedSourceObjectIDs: [...edits.deletedSourceObjectIDs],
    objectCenterOverrides: Object.fromEntries(
      Object.entries(edits.objectCenterOverrides).map(([id, center]) => [id, [...center] as V2]),
    ),
  };
}

export function parseFurnitureEdits(textData: Record<string, string>): FloorplanFurnitureEdits {
  const raw = textData.floorplan_furniture_edits_json;
  if (!raw) return emptyFurnitureEdits();
  try {
    const parsed = JSON.parse(raw) as {
      deletedSourceObjectIDs?: unknown;
      objectCenterOverrides?: unknown;
    };
    const deletedSourceObjectIDs = Array.isArray(parsed.deletedSourceObjectIDs)
      ? [...new Set(parsed.deletedSourceObjectIDs.filter((id): id is string => typeof id === "string").map((id) => id.toLowerCase()))]
      : [];
    const objectCenterOverrides: Record<string, V2> = {};
    if (parsed.objectCenterOverrides && typeof parsed.objectCenterOverrides === "object") {
      for (const [id, value] of Object.entries(parsed.objectCenterOverrides as Record<string, unknown>)) {
        if (!Array.isArray(value) || value.length < 2) continue;
        const x = Number(value[0]);
        const z = Number(value[1]);
        if (Number.isFinite(x) && Number.isFinite(z)) objectCenterOverrides[id.toLowerCase()] = [x, z];
      }
    }
    return { deletedSourceObjectIDs, objectCenterOverrides };
  } catch {
    return emptyFurnitureEdits();
  }
}

/** Apply authored absolute centres only after the deterministic solve. */
export function applyFurnitureEdits(
  objects: ObjectXZ[],
  edits: FloorplanFurnitureEdits,
): ObjectXZ[] {
  const deleted = new Set(edits.deletedSourceObjectIDs.map((id) => id.toLowerCase()));
  return objects
    .filter((object) => !deleted.has(object.id.toLowerCase()))
    .map((object) => {
      const center = edits.objectCenterOverrides[object.id.toLowerCase()];
      return center ? { ...object, center: [...center] as V2 } : object;
    });
}

export function recordFurnitureCenters(
  edits: FloorplanFurnitureEdits,
  baseline: ObjectXZ[],
  result: ObjectXZ[],
): FloorplanFurnitureEdits {
  const baselineById = new Map(baseline.map((object) => [object.id.toLowerCase(), object]));
  const next = cloneFurnitureEdits(edits);
  for (const object of result) {
    const id = object.id.toLowerCase();
    const old = baselineById.get(id);
    if (!old || length(sub(object.center, old.center)) <= 0.0005) continue;
    next.objectCenterOverrides[id] = [...object.center] as V2;
  }
  return next;
}

export function pointInsideFurnitureDepth(point: V2, object: ObjectXZ): number {
  const delta = sub(point, object.center);
  const axisW = normalize(object.axisW);
  const axisD = normalize(object.axisD, [-axisW[1], axisW[0]]);
  return Math.min(object.halfW - Math.abs(dot(delta, axisW)), object.halfD - Math.abs(dot(delta, axisD)));
}

export function wallNormalTranslation(rawDelta: V2, edgeIndex: number, graph: EditableWallGraph): V2 {
  const edge = graph.edges[edgeIndex];
  if (!edge) return [0, 0];
  const a = graph.vertices[edge.a];
  const b = graph.vertices[edge.b];
  if (!a || !b) return [0, 0];
  const direction = normalize(sub(b, a));
  const normal: V2 = [-direction[1], direction[0]];
  return mul(normal, dot(rawDelta, normal));
}

export function collinearEdgeChain(
  graph: EditableWallGraph,
  seed: number,
  cosineThreshold = 0.985,
): Set<number> {
  const seedEdge = graph.edges[seed];
  if (!seedEdge) return new Set();
  const a = graph.vertices[seedEdge.a];
  const b = graph.vertices[seedEdge.b];
  if (!a || !b) return new Set();
  const seedVector = sub(b, a);
  if (length(seedVector) <= 1e-5) return new Set([seed]);
  const seedDirection = normalize(seedVector);
  const result = new Set<number>([seed]);
  const queue = [seed];
  while (queue.length) {
    const current = graph.edges[queue.pop()!];
    if (!current) continue;
    for (let index = 0; index < graph.edges.length; index++) {
      if (result.has(index)) continue;
      const candidate = graph.edges[index];
      if (![current.a, current.b].includes(candidate.a) && ![current.a, current.b].includes(candidate.b)) continue;
      const ca = graph.vertices[candidate.a];
      const cb = graph.vertices[candidate.b];
      if (!ca || !cb) continue;
      const vector = sub(cb, ca);
      if (length(vector) <= 1e-5 || Math.abs(dot(normalize(vector), seedDirection)) < cosineThreshold) continue;
      result.add(index);
      queue.push(index);
    }
  }
  return result;
}

export function translateWallChain(
  graph: EditableWallGraph,
  edgeIndex: number,
  delta: V2,
): EditableWallGraph {
  const next: EditableWallGraph = {
    vertices: graph.vertices.map((vertex) => [...vertex] as V2),
    edges: graph.edges.map((edge) => ({ ...edge })),
  };
  const vertices = new Set<number>();
  for (const index of collinearEdgeChain(graph, edgeIndex)) {
    const edge = graph.edges[index];
    if (edge) {
      vertices.add(edge.a);
      vertices.add(edge.b);
    }
  }
  for (const index of vertices) {
    const vertex = next.vertices[index];
    if (vertex) next.vertices[index] = add(vertex, delta);
  }
  return next;
}

function translated(object: ObjectXZ, delta: V2): ObjectXZ {
  return { ...object, center: add(object.center, delta) };
}

function parentIndexFor(objects: ObjectXZ[], index: number): number | null {
  const category = String(objects[index]?.category ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  if (!["stove", "cooktop", "oven", "sink", "dishwasher"].includes(category)) return null;
  const parentId = objects[index]?.parentId?.toLowerCase();
  if (!parentId) return null;
  const parentIndex = objects.findIndex((object) => object.id.toLowerCase() === parentId);
  return parentIndex >= 0 && parentIndex !== index ? parentIndex : null;
}

function rootIndexFor(objects: ObjectXZ[], index: number): number {
  let current = index;
  const visited = new Set<number>();
  while (!visited.has(current)) {
    visited.add(current);
    const parent = parentIndexFor(objects, current);
    if (parent == null) return current;
    current = parent;
  }
  return index;
}

function familyIndicesFor(objects: ObjectXZ[], rootIndex: number): Set<number> {
  return new Set(
    objects.map((_, index) => index).filter((index) => rootIndexFor(objects, index) === rootIndex),
  );
}

function collisionBody(segment: Segment, id: string): ObjectXZ {
  const direction = normalize(sub(segment.b, segment.a));
  const normal: V2 = [-direction[1], direction[0]];
  return {
    id,
    category: "generic",
    center: segmentMidpoint(segment),
    axisW: direction,
    axisD: normal,
    halfW: (segmentLength(segment) + WALL_THICKNESS) / 2,
    halfD: WALL_THICKNESS / 2,
  };
}

function doorCollisionBodies(segment: Segment, id: string): ObjectXZ[] {
  const doorLength = segmentLength(segment);
  if (doorLength <= 0.08) return [];
  const direction = normalize(sub(segment.b, segment.a));
  const normal: V2 = [-direction[1], direction[0]];
  const threshold = collisionBody(segment, `${id}-threshold`);
  const half = doorLength / 2;
  const fan = Array.from({ length: 25 }, (_, step): ObjectXZ => {
    const radians = (Math.PI / 2) * step / 24;
    const leafDirection = normalize(add(mul(direction, Math.cos(radians)), mul(normal, Math.sin(radians))));
    return {
      id: `${id}-swing-${step}`,
      category: "generic",
      center: add(segment.a, mul(leafDirection, half)),
      axisW: leafDirection,
      axisD: [-leafDirection[1], leafDirection[0]],
      halfW: (doorLength + 0.04) / 2,
      halfD: 0.075 / 2,
    };
  });
  return [threshold, ...fan];
}

function penetration(first: ObjectXZ, second: ObjectXZ, margin = 0): Penetration | null {
  const firstW = normalize(first.axisW);
  const firstD = normalize(first.axisD, [-firstW[1], firstW[0]]);
  const secondW = normalize(second.axisW);
  const secondD = normalize(second.axisD, [-secondW[1], secondW[0]]);
  const delta = sub(second.center, first.center);
  let shallowest = Number.POSITIVE_INFINITY;
  let normal: V2 = [1, 0];
  for (const axis of [firstW, firstD, secondW, secondD]) {
    const signedDistance = dot(delta, axis);
    const firstRadius = Math.abs(dot(firstW, axis)) * first.halfW + Math.abs(dot(firstD, axis)) * first.halfD;
    const secondRadius = Math.abs(dot(secondW, axis)) * second.halfW + Math.abs(dot(secondD, axis)) * second.halfD;
    const depth = firstRadius + secondRadius + margin - Math.abs(signedDistance);
    if (depth <= COLLISION_EPSILON) return null;
    if (depth < shallowest) {
      shallowest = depth;
      normal = signedDistance >= 0 ? mul(axis, -1) : axis;
    }
  }
  return { depth: shallowest, normal };
}

function sweptCollision(
  moving: ObjectXZ,
  stationary: ObjectXZ,
  direction: V2,
  maximum: number,
): SweepHit | null {
  if (maximum < 0 || length(direction) <= COLLISION_EPSILON) return null;
  const initial = penetration(moving, stationary);
  if (initial && dot(direction, initial.normal) < -COLLISION_EPSILON) return { distance: 0, normal: initial.normal };
  const padded = penetration(moving, stationary, COLLISION_SKIN);
  if (padded && dot(direction, padded.normal) < -COLLISION_EPSILON) return { distance: 0, normal: padded.normal };

  const movingW = normalize(moving.axisW);
  const movingD = normalize(moving.axisD, [-movingW[1], movingW[0]]);
  const stationaryW = normalize(stationary.axisW);
  const stationaryD = normalize(stationary.axisD, [-stationaryW[1], stationaryW[0]]);
  const centerDelta = sub(stationary.center, moving.center);
  let entry = Number.NEGATIVE_INFINITY;
  let exit = maximum;
  let entryAxis = movingW;
  for (const axis of [movingW, movingD, stationaryW, stationaryD]) {
    const center = dot(centerDelta, axis);
    const radius = Math.abs(dot(movingW, axis)) * moving.halfW
      + Math.abs(dot(movingD, axis)) * moving.halfD
      + Math.abs(dot(stationaryW, axis)) * stationary.halfW
      + Math.abs(dot(stationaryD, axis)) * stationary.halfD
      + COLLISION_SKIN;
    const velocity = dot(direction, axis);
    if (Math.abs(velocity) <= 1e-7) {
      if (Math.abs(center) > radius + 1e-6) return null;
      continue;
    }
    const first = (center - radius) / velocity;
    const second = (center + radius) / velocity;
    const axisEntry = Math.min(first, second);
    if (axisEntry > entry) {
      entry = axisEntry;
      entryAxis = axis;
    }
    exit = Math.min(exit, Math.max(first, second));
    if (entry > exit + 1e-6) return null;
  }
  if (exit <= COLLISION_EPSILON || entry > maximum + COLLISION_EPSILON) return null;
  const contactDistance = Math.max(0, entry);
  const centerAtContact = dot(sub(centerDelta, mul(direction, contactDistance)), entryAxis);
  const outwardNormal = centerAtContact >= 0 ? mul(entryAxis, -1) : entryAxis;
  if (contactDistance <= COLLISION_EPSILON && dot(direction, outwardNormal) >= -COLLISION_EPSILON) return null;
  return { distance: Math.max(0, contactDistance - COLLISION_GUARD), normal: outwardNormal };
}

function slideBody(body: ObjectXZ, blockers: ObjectXZ[], requestedDelta: V2): { body: ObjectXZ; blocked: boolean } {
  let current = body;
  let remaining = requestedDelta;
  let blocked = false;
  for (let iteration = 0; iteration < 4; iteration++) {
    const distance = length(remaining);
    if (distance <= COLLISION_EPSILON) break;
    const direction = mul(remaining, 1 / distance);
    const hits = blockers
      .map((blocker) => sweptCollision(current, blocker, direction, distance))
      .filter((hit): hit is SweepHit => hit !== null);
    if (!hits.length) {
      current = translated(current, remaining);
      remaining = [0, 0];
      break;
    }
    const nearest = Math.min(...hits.map((hit) => hit.distance));
    blocked = true;
    const travel = Math.min(Math.max(nearest, 0), distance);
    if (travel > COLLISION_EPSILON) current = translated(current, mul(direction, travel));
    const residual = sub(remaining, mul(direction, travel));
    let slide = residual;
    for (const hit of hits.filter((candidate) => Math.abs(candidate.distance - nearest) <= COLLISION_SKIN + COLLISION_GUARD)) {
      const inward = dot(slide, hit.normal);
      if (inward < 0) slide = sub(slide, mul(hit.normal, inward));
    }
    if (length(slide) <= COLLISION_EPSILON
      || (travel <= COLLISION_EPSILON && length(sub(residual, slide)) <= COLLISION_EPSILON)) {
      remaining = [0, 0];
      break;
    }
    remaining = slide;
  }
  return { body: current, blocked: blocked || length(remaining) > COLLISION_EPSILON };
}

export function moveFurniture(
  objects: ObjectXZ[],
  movingID: string,
  graph: EditableWallGraph,
  requestedDelta: V2,
  doors: Array<[V2, V2]> = [],
): FurnitureMoveResult {
  const movingIndex = objects.findIndex((object) => object.id.toLowerCase() === movingID.toLowerCase());
  if (movingIndex < 0 || length(requestedDelta) <= COLLISION_EPSILON) {
    return { objects, movedID: movingIndex >= 0 ? objects[movingIndex].id : null, delta: [0, 0], blocked: false };
  }
  const moving = objects[movingIndex];

  const parentIndex = parentIndexFor(objects, movingIndex);
  if (parentIndex != null) {
    // Counter fixtures are mounted children, not rigid bodies on the floor.
    // They slide only along their parent's local run and remain centred on the
    // worktop in presentation; they never push or get pushed by the cabinet.
    const parent = objects[parentIndex];
    const parentAxis = normalize(parent.axisW);
    const movingW = normalize(moving.axisW);
    const movingD = normalize(moving.axisD, [-movingW[1], movingW[0]]);
    const childAlongExtent = Math.abs(dot(movingW, parentAxis)) * moving.halfW
      + Math.abs(dot(movingD, parentAxis)) * moving.halfD;
    const limit = Math.max(0, parent.halfW - childAlongExtent - 0.035);
    const currentAlong = dot(sub(moving.center, parent.center), parentAxis);
    const requestedAlong = dot(requestedDelta, parentAxis);
    const targetAlong = Math.max(-limit, Math.min(limit, currentAlong + requestedAlong));
    const delta = mul(parentAxis, targetAlong - currentAlong);
    const result = [...objects];
    result[movingIndex] = translated(moving, delta);
    return {
      objects: result,
      movedID: moving.id,
      delta,
      blocked: Math.abs(targetAlong - (currentAlong + requestedAlong)) > COLLISION_GUARD,
    };
  }

  const movingFamily = familyIndicesFor(objects, movingIndex);
  const blockers = objects.filter((_, index) => !movingFamily.has(index));
  blockers.push(...graph.edges.map((edge, index) => collisionBody({ a: graph.vertices[edge.a], b: graph.vertices[edge.b] }, `wall-${index}`)));
  blockers.push(...doors.flatMap(([a, b], index) => doorCollisionBodies({ a, b }, `door-${index}`)));
  const slide = slideBody(moving, blockers, requestedDelta);
  const result = [...objects];
  const appliedDelta = sub(slide.body.center, moving.center);
  for (const index of movingFamily) result[index] = translated(objects[index], appliedDelta);
  return {
    objects: result,
    movedID: moving.id,
    delta: appliedDelta,
    blocked: slide.blocked,
  };
}

function distanceToSegment(point: V2, a: V2, b: V2): number {
  const delta = sub(b, a);
  const denominator = dot(delta, delta);
  if (denominator <= 1e-12) return length(sub(point, a));
  const fraction = Math.min(1, Math.max(0, dot(sub(point, a), delta) / denominator));
  return length(sub(point, add(a, mul(delta, fraction))));
}

function projectedOverlap(first: Segment, second: Segment): number {
  const secondLength = segmentLength(second);
  if (segmentLength(first) <= 1e-6 || secondLength <= 1e-6) return 0;
  const direction = normalize(sub(second.b, second.a));
  const firstA = dot(sub(first.a, second.a), direction);
  const firstB = dot(sub(first.b, second.a), direction);
  return Math.min(secondLength, Math.max(firstA, firstB)) - Math.max(0, Math.min(firstA, firstB));
}

function contactGap(item: ObjectXZ, wall: Segment): number | null {
  const wallLength = segmentLength(wall);
  if (wallLength <= 0.08) return null;
  const direction = normalize(sub(wall.b, wall.a));
  const normal: V2 = [-direction[1], direction[0]];
  const axisW = normalize(item.axisW);
  const axisD = normalize(item.axisD, [-axisW[1], axisW[0]]);
  const alongCenter = dot(sub(item.center, wall.a), direction);
  const alongExtent = Math.abs(dot(axisW, direction)) * item.halfW + Math.abs(dot(axisD, direction)) * item.halfD;
  const overlap = Math.min(wallLength, alongCenter + alongExtent) - Math.max(0, alongCenter - alongExtent);
  if (overlap < 0.045) return null;
  const normalExtent = Math.abs(dot(axisW, normal)) * item.halfW + Math.abs(dot(axisD, normal)) * item.halfD;
  const gap = Math.abs(dot(sub(item.center, wall.a), normal)) - normalExtent;
  return gap >= -0.28 && gap <= 0.22 ? Math.abs(gap) : null;
}

export function moveWall(
  objects: ObjectXZ[],
  graph: EditableWallGraph,
  edgeIndex: number,
  requestedDelta: V2,
  doors: Array<[V2, V2]> = [],
): WallPushResult {
  const requestedDistance = length(requestedDelta);
  const chain = collinearEdgeChain(graph, edgeIndex);
  if (requestedDistance <= 1e-7 || !chain.size) return { wallDelta: [0, 0], objects, blocked: false };
  const direction = mul(requestedDelta, 1 / requestedDistance);
  const allSegments = graph.edges.map((edge) => ({ a: graph.vertices[edge.a], b: graph.vertices[edge.b] }));
  const movingWalls = [...chain].sort((a, b) => a - b).map((index) => allSegments[index]).filter(Boolean);
  const movingVertices = new Set<number>();
  for (const index of chain) {
    const edge = graph.edges[index];
    if (edge) {
      movingVertices.add(edge.a);
      movingVertices.add(edge.b);
    }
  }
  const stationaryEntries = allSegments.map((wall, index) => ({ wall, index })).filter(({ index }) => !chain.has(index));
  const movingWallBodies = movingWalls.map((wall, index) => collisionBody(wall, `moving-wall-${index}`));
  const stationaryWallBodies = stationaryEntries.map(({ wall }, index) => collisionBody(wall, `fixed-wall-${index}`));
  const wallStopBodies = stationaryEntries.flatMap(({ wall, index }) => {
    const edge = graph.edges[index];
    return edge && !movingVertices.has(edge.a) && !movingVertices.has(edge.b)
      ? [collisionBody(wall, `wall-stop-${index}`)]
      : [];
  });

  const doorSegments = doors.map(([a, b]) => ({ a, b }));
  const movingDoorIndices = new Set<number>();
  doorSegments.forEach((door, index) => {
    if (movingWalls.some((wall) => distanceToSegment(segmentMidpoint(door), wall.a, wall.b) <= 0.3
      && projectedOverlap(door, wall) >= Math.min(0.12, segmentLength(door) * 0.35))) movingDoorIndices.add(index);
  });
  const movingDoorBodies: ObjectXZ[] = [];
  const fixedDoorBodies: ObjectXZ[] = [];
  doorSegments.forEach((door, index) => {
    const target = movingDoorIndices.has(index) ? movingDoorBodies : fixedDoorBodies;
    target.push(...doorCollisionBodies(door, `${movingDoorIndices.has(index) ? "moving" : "fixed"}-door-${index}`));
  });

  const pushers = [...movingWallBodies, ...movingDoorBodies];
  const pusherStopBodies = [...wallStopBodies, ...fixedDoorBodies];
  const furnitureStopBodies = [...stationaryWallBodies, ...fixedDoorBodies];
  const activation = Array(objects.length).fill(Number.POSITIVE_INFINITY) as number[];
  const rootIndices = new Set(
    objects.map((_, index) => rootIndexFor(objects, index)),
  );
  objects.forEach((object, objectIndex) => {
    if (!rootIndices.has(objectIndex)) return;
    if (movingWalls.some((wall) => contactGap(object, wall) !== null)) activation[objectIndex] = 0;
    for (const pusher of pushers) {
      const hit = sweptCollision(pusher, object, direction, requestedDistance);
      if (hit) activation[objectIndex] = Math.min(activation[objectIndex], hit.distance);
    }
  });
  const visited = Array(objects.length).fill(false) as boolean[];
  for (let iteration = 0; iteration < objects.length; iteration++) {
    const current = objects
      .map((_, index) => index)
      .filter((index) => rootIndices.has(index) && !visited[index])
      .sort((a, b) => activation[a] - activation[b])[0];
    if (current == null || !Number.isFinite(activation[current]) || activation[current] > requestedDistance) break;
    visited[current] = true;
    for (let other = 0; other < objects.length; other++) {
      if (!rootIndices.has(other) || other === current || visited[other]) continue;
      const hit = sweptCollision(objects[current], objects[other], direction, requestedDistance);
      if (hit) activation[other] = Math.min(activation[other], activation[current] + hit.distance);
    }
  }

  let allowedDistance = requestedDistance;
  for (const pusher of pushers) {
    for (const blocker of pusherStopBodies) {
      const hit = sweptCollision(pusher, blocker, direction, allowedDistance);
      if (hit) allowedDistance = Math.min(allowedDistance, hit.distance);
    }
  }
  for (const index of rootIndices) {
    const startsAt = activation[index];
    if (!Number.isFinite(startsAt) || startsAt > allowedDistance) continue;
    for (const blocker of furnitureStopBodies) {
      const hit = sweptCollision(objects[index], blocker, direction, Math.max(0, allowedDistance - startsAt));
      if (hit) allowedDistance = Math.min(allowedDistance, startsAt + hit.distance);
    }
  }
  const rootDeltas = new Map<number, V2>();
  for (const index of rootIndices) {
    const startsAt = activation[index];
    rootDeltas.set(
      index,
      Number.isFinite(startsAt) && startsAt < allowedDistance
        ? mul(direction, allowedDistance - startsAt)
        : [0, 0],
    );
  }
  const movedObjects = objects.map((object, index) => {
    const delta = rootDeltas.get(rootIndexFor(objects, index)) ?? [0, 0];
    return length(delta) > COLLISION_EPSILON ? translated(object, delta) : object;
  });
  return {
    wallDelta: mul(direction, allowedDistance),
    objects: movedObjects,
    blocked: allowedDistance + COLLISION_GUARD < requestedDistance,
  };
}
