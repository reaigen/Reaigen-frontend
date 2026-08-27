import type { ObjectXZ, V2 } from "./floorplan-geometry";

type Wall = [V2, V2];

type WallMotion = {
  wallIndex: number;
  p1: V2;
  p2: V2;
  delta: V2;
};

type MotionGroup = {
  delta: V2;
  walls: WallMotion[];
  objectIndices: number[];
};

const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const mul = (a: V2, scalar: number): V2 => [a[0] * scalar, a[1] * scalar];
const dot = (a: V2, b: V2): number => a[0] * b[0] + a[1] * b[1];
const lengthSquared = (a: V2): number => dot(a, a);
const length = (a: V2): number => Math.hypot(a[0], a[1]);
const normalized = (a: V2, fallback: V2): V2 => {
  const value = length(a);
  return value > 1e-8 ? mul(a, 1 / value) : fallback;
};

function wallDifference(baseline: Wall[], edited: Wall[]): number {
  if (!baseline.length || baseline.length > edited.length) return Number.POSITIVE_INFINITY;
  return baseline.reduce((total, old, index) => {
    const next = edited[index];
    const same = lengthSquared(sub(old[0], next[0])) + lengthSquared(sub(old[1], next[1]));
    const reversed = lengthSquared(sub(old[0], next[1])) + lengthSquared(sub(old[1], next[0]));
    return total + Math.min(same, reversed);
  }, 0);
}

/** Exact web port of iOS FloorplanFurnitureWallAttachment.closestBaseline. */
export function closestFurnitureWallBaseline(rawWalls: Wall[], weldedWalls: Wall[], editedWalls: Wall[]): Wall[] {
  const candidates = [rawWalls, weldedWalls].filter(
    (walls) => walls.length > 0 && walls.length <= editedWalls.length,
  );
  if (!candidates.length) return rawWalls;
  return candidates.reduce((best, walls) =>
    wallDifference(walls, editedWalls) < wallDifference(best, editedWalls) ? walls : best,
  );
}

function rigidWallMotions(baseline: Wall[], edited: Wall[]): WallMotion[] {
  const motions: WallMotion[] = [];
  baseline.forEach((old, index) => {
    const candidate = edited[index];
    if (!candidate) return;
    const oldVector = sub(old[1], old[0]);
    const oldLength = length(oldVector);
    if (oldLength <= 0.08) return;
    const oldDirection = mul(oldVector, 1 / oldLength);

    const rawNewVector = sub(candidate[1], candidate[0]);
    const rawNewLength = length(rawNewVector);
    if (rawNewLength <= 0.08) return;
    const sameOrientation = dot(oldDirection, mul(rawNewVector, 1 / rawNewLength)) >= 0;
    const newP1 = sameOrientation ? candidate[0] : candidate[1];
    const newP2 = sameOrientation ? candidate[1] : candidate[0];
    const newVector = sub(newP2, newP1);
    const newLength = length(newVector);
    if (
      Math.abs(dot(oldDirection, mul(newVector, 1 / newLength))) < 0.998
      || Math.abs(oldLength - newLength) > Math.max(0.035, oldLength * 0.012)
    ) return;

    const firstDelta = sub(newP1, old[0]);
    const secondDelta = sub(newP2, old[1]);
    if (length(sub(firstDelta, secondDelta)) > 0.035) return;

    const average = mul(add(firstDelta, secondDelta), 0.5);
    const normal: V2 = [-oldDirection[1], oldDirection[0]];
    const normalDistance = dot(average, normal);
    const alongDistance = dot(average, oldDirection);
    if (Math.abs(normalDistance) < 0.018 || Math.abs(alongDistance) > 0.035) return;

    motions.push({ wallIndex: index, p1: old[0], p2: old[1], delta: mul(normal, normalDistance) });
  });
  return motions;
}

function groupedMotions(motions: WallMotion[]): MotionGroup[] {
  const groups: MotionGroup[] = [];
  for (const motion of [...motions].sort((a, b) => a.wallIndex - b.wallIndex)) {
    const group = groups.find((candidate) => length(sub(candidate.delta, motion.delta)) <= 0.008);
    if (group) group.walls.push(motion);
    else groups.push({ delta: motion.delta, walls: [motion], objectIndices: [] });
  }
  return groups;
}

function contactGap(object: ObjectXZ, wall: WallMotion): number | null {
  const wallVector = sub(wall.p2, wall.p1);
  const wallLength = length(wallVector);
  if (wallLength <= 0.08) return null;
  const direction = mul(wallVector, 1 / wallLength);
  const normal: V2 = [-direction[1], direction[0]];
  const axisW = normalized(object.axisW, [1, 0]);
  const axisD = normalized(object.axisD, [-axisW[1], axisW[0]]);
  const alongCenter = dot(sub(object.center, wall.p1), direction);
  const alongExtent = Math.abs(dot(axisW, direction)) * object.halfW
    + Math.abs(dot(axisD, direction)) * object.halfD;
  const overlap = Math.min(wallLength, alongCenter + alongExtent)
    - Math.max(0, alongCenter - alongExtent);
  if (overlap < 0.045) return null;
  const normalExtent = Math.abs(dot(axisW, normal)) * object.halfW
    + Math.abs(dot(axisD, normal)) * object.halfD;
  const gap = Math.abs(dot(sub(object.center, wall.p1), normal)) - normalExtent;
  return gap >= -0.28 && gap <= 0.22 ? Math.abs(gap) : null;
}

function overlaps(lhs: ObjectXZ, rhs: ObjectXZ): boolean {
  const lhsW = normalized(lhs.axisW, [1, 0]);
  const lhsD = normalized(lhs.axisD, [-lhsW[1], lhsW[0]]);
  const rhsW = normalized(rhs.axisW, [1, 0]);
  const rhsD = normalized(rhs.axisD, [-rhsW[1], rhsW[0]]);
  const delta = sub(rhs.center, lhs.center);
  for (const axis of [lhsW, lhsD, rhsW, rhsD]) {
    const distance = Math.abs(dot(delta, axis));
    const lhsRadius = Math.abs(dot(lhsW, axis)) * lhs.halfW + Math.abs(dot(lhsD, axis)) * lhs.halfD;
    const rhsRadius = Math.abs(dot(rhsW, axis)) * rhs.halfW + Math.abs(dot(rhsD, axis)) * rhs.halfD;
    if (distance >= lhsRadius + rhsRadius - 1e-7) return false;
  }
  return true;
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

function maximumCollisionFreeFraction(indices: number[], delta: V2, objects: ObjectXZ[]): number {
  const moving = new Set(indices);
  if (!moving.size || length(delta) <= 1e-8) return 0;
  const introducesCollision = (fraction: number): boolean => indices.some((movingIndex) => {
    const candidate = { ...objects[movingIndex], center: add(objects[movingIndex].center, mul(delta, fraction)) };
    return objects.some((other, otherIndex) =>
      !moving.has(otherIndex)
      && !overlaps(objects[movingIndex], other)
      && overlaps(candidate, other),
    );
  });

  let previous = 0;
  for (let step = 1; step <= 64; step += 1) {
    const current = step / 64;
    if (!introducesCollision(current)) {
      previous = current;
      continue;
    }
    let low = previous;
    let high = current;
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const midpoint = (low + high) / 2;
      if (introducesCollision(midpoint)) high = midpoint;
      else low = midpoint;
    }
    return Math.max(0, low - 1e-5);
  }
  return 1;
}

/**
 * Exact web port of the iOS rigid wall-attachment pass. It never re-solves,
 * resizes, merges, or hides furniture while an edited wall is moving.
 */
export function applyFurnitureWallAttachment(
  objects: ObjectXZ[],
  baselineWalls: Wall[],
  editedWalls: Wall[],
): ObjectXZ[] {
  if (!objects.length || !baselineWalls.length || baselineWalls.length > editedWalls.length) return objects;
  const motions = rigidWallMotions(baselineWalls, editedWalls);
  if (!motions.length) return objects;
  const groups = groupedMotions(motions);
  objects.forEach((object, objectIndex) => {
    // Mounted fixtures follow their cabinet root; testing them against walls as
    // independent bodies makes the worktop hierarchy split during first paint.
    if (rootIndexFor(objects, objectIndex) !== objectIndex) return;
    let bestGroup = -1;
    let bestGap = Number.POSITIVE_INFINITY;
    groups.forEach((group, groupIndex) => group.walls.forEach((wall) => {
      const gap = contactGap(object, wall);
      if (gap != null && gap < bestGap) {
        bestGroup = groupIndex;
        bestGap = gap;
      }
    }));
    if (bestGroup >= 0) groups[bestGroup].objectIndices.push(objectIndex);
  });

  for (const group of groups) {
    const roots = new Set(group.objectIndices);
    group.objectIndices = objects
      .map((_, index) => index)
      .filter((index) => roots.has(rootIndexFor(objects, index)));
  }

  let result = objects.map((object) => ({ ...object, center: [...object.center] as V2 }));
  for (const group of groups) {
    if (!group.objectIndices.length) continue;
    const start = result;
    const fraction = maximumCollisionFreeFraction(group.objectIndices, group.delta, start);
    if (fraction <= 0) continue;
    result = result.map((object, index) => group.objectIndices.includes(index)
      ? { ...object, center: add(object.center, mul(group.delta, fraction)) }
      : object);
  }
  return result;
}
