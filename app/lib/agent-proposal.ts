import { baseUnitForCategory, resolveUnit, type UnitLookup } from "./unit-catalog";

/** Label the values being approved with their proposed units, never old units. */
export function proposalFieldUnit(
  field: "price" | "area" | "lot_size",
  changes: Record<string, unknown>,
  current: Record<string, unknown> | undefined,
  units: readonly UnitLookup[],
) {
  const unitKey = field === "price" ? "currency" : field === "area" ? "area_unit" : "lot_size_unit";
  const category = field === "price" ? "CURRENCY" : "AREA";
  if (Object.hasOwn(changes, unitKey)) {
    const proposed = changes[unitKey];
    return resolveUnit(units, typeof proposed === "number" || typeof proposed === "string" ? proposed : null, category);
  }
  const measurements = current?.floorplan_measurements as { total_floor_area_m2?: number } | undefined;
  if (field === "area" && measurements?.total_floor_area_m2 != null) return baseUnitForCategory(units, "AREA");
  const stored = current?.[unitKey];
  return resolveUnit(units, typeof stored === "number" || typeof stored === "string" ? stored : null, category);
}
