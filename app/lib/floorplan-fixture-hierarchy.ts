import type { ObjectXZ, V2 } from "./floorplan-geometry";

const normalizedObjectKind = (object: ObjectXZ): string =>
  String(object.category ?? "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

export const isFloorplanStorage = (object: ObjectXZ): boolean => {
  const kind = normalizedObjectKind(object);
  return kind.includes("storage") || kind.includes("cabinet");
};

export const isKitchenFixture = (object: ObjectXZ): boolean => {
  const kind = normalizedObjectKind(object);
  return (
    kind.includes("stove") ||
    kind.includes("cooktop") ||
    kind.includes("oven") ||
    kind.includes("sink") ||
    kind.includes("dishwasher")
  );
};

export const isFloorplanRefrigerator = (object: ObjectXZ): boolean =>
  normalizedObjectKind(object).includes("refrigerator");

const objectDot = (a: V2, b: V2): number => a[0] * b[0] + a[1] * b[1];

/**
 * Promote RoomPlan's geometric containment into an explicit editable hierarchy.
 * A cooktop/sink/oven/dishwasher is a fixture mounted in a cabinet run, not an
 * independent rigid body.
 */
export function attachFloorplanFixtureHierarchy(objects: ObjectXZ[]): ObjectXZ[] {
  const storages = objects.filter(isFloorplanStorage);
  if (storages.length === 0) return objects;

  return objects.map((object) => {
    if (!isKitchenFixture(object)) return object;
    let matched: ObjectXZ | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const storage of storages) {
      const delta: V2 = [
        object.center[0] - storage.center[0],
        object.center[1] - storage.center[1],
      ];
      const along = Math.abs(objectDot(delta, storage.axisW));
      const across = Math.abs(objectDot(delta, storage.axisD));
      const withinRun = along <= storage.halfW + 0.15;
      const withinCounterBand = across <= Math.max(0.45, storage.halfD + 0.2);
      const distance = along * along + across * across;
      if (withinRun && withinCounterBand && distance < bestDistance) {
        matched = storage;
        bestDistance = distance;
      }
    }

    return matched && object.parentId?.toLowerCase() !== matched.id.toLowerCase()
      ? { ...object, parentId: matched.id }
      : object;
  });
}

/** An oven below a co-located cooktop has no second top-down footprint. */
export function removeRedundantCountertopFixtures(objects: ObjectXZ[]): ObjectXZ[] {
  const hierarchical = attachFloorplanFixtureHierarchy(objects);
  return hierarchical.filter((object) => {
    if (normalizedObjectKind(object) !== "oven") return true;
    if (!object.parentId) return true;
    return !hierarchical.some((other) =>
      ["stove", "cooktop"].includes(normalizedObjectKind(other))
      && other.id !== object.id
      && other.parentId?.toLowerCase() === object.parentId?.toLowerCase()
      && Math.hypot(other.center[0] - object.center[0], other.center[1] - object.center[1]) <= 0.24
    );
  });
}
