/**
 * Canonical measurement metadata returned by Django's
 * `/api/v1/lookups/units/` endpoint.
 *
 * Conversion factors deliberately live in the backend. The web client only
 * consumes the lookup response so a unit correction or newly added unit does
 * not require a frontend release.
 */
export interface UnitLookup {
  id: number;
  code: string;
  name: string;
  symbol: string;
  plural_name?: string | null;
  category: number;
  category_name?: string | null;
  category_code: string;
  system: string;
  conversion_to_base: string | number;
  is_base?: boolean;
  symbol_position?: "BEFORE" | "AFTER" | string;
  thousands_separator?: string;
  decimal_separator?: string;
  symbol_space?: boolean;
  display_decimal_places?: number;
  is_active?: boolean;
  sort_order?: number;
}

export function normalizeUnitToken(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("en")
    .replace(/\^2/g, "2")
    .replace(/²/g, "2")
    .replace(/[._\-\s]/g, "");
}

function normalizedCategory(value: string) {
  return value.trim().toUpperCase();
}

export function unitCategory(unit: UnitLookup) {
  return normalizedCategory(unit.category_code || unit.category_name || "");
}

export function unitsForCategory(units: readonly UnitLookup[], category: string) {
  const wanted = normalizedCategory(category);
  return units
    .filter((unit) => unit.is_active !== false && unitCategory(unit) === wanted)
    .sort((left, right) => (
      (left.sort_order ?? 0) - (right.sort_order ?? 0)
      || left.name.localeCompare(right.name)
    ));
}

export function findUnitById(units: readonly UnitLookup[], id: number | string | null | undefined) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return null;
  return units.find((unit) => unit.id === numericId && unit.is_active !== false) ?? null;
}

export function resolveUnit(
  units: readonly UnitLookup[],
  value: number | string | null | undefined,
  categories?: string | readonly string[],
) {
  return findUnitById(units, value) ?? findUnit(units, value == null ? "" : String(value), categories);
}

/** A display label supplied by the unit lookup, never a client-side fallback. */
export function unitLabel(unit: UnitLookup | null | undefined) {
  return unit?.symbol?.trim() || unit?.code?.trim() || "";
}

export function findUnit(
  units: readonly UnitLookup[],
  token: string | null | undefined,
  categories?: string | readonly string[],
) {
  const normalized = normalizeUnitToken(token ?? "");
  if (!normalized) return null;
  const wantedCategories = categories == null
    ? null
    : new Set((Array.isArray(categories) ? categories : [categories]).map(normalizedCategory));
  const candidates = units.filter((unit) => (
    unit.is_active !== false
    && (!wantedCategories || wantedCategories.has(unitCategory(unit)))
  ));

  // Prefer stable backend codes before potentially ambiguous symbols such as
  // `$` or `ft`, then fall back to backend names/plurals for natural input.
  return candidates.find((unit) => normalizeUnitToken(unit.code) === normalized)
    ?? candidates.find((unit) => normalizeUnitToken(unit.symbol) === normalized)
    ?? candidates.find((unit) => normalizeUnitToken(unit.name) === normalized)
    ?? candidates.find((unit) => normalizeUnitToken(unit.plural_name ?? "") === normalized)
    ?? null;
}

export function baseUnitForCategory(units: readonly UnitLookup[], category: string) {
  const candidates = unitsForCategory(units, category);
  return candidates.find((unit) => unit.is_base) ?? null;
}

export function unitConversionFactor(unit: UnitLookup) {
  const factor = Number(unit.conversion_to_base);
  return Number.isFinite(factor) && factor > 0 ? factor : null;
}

/** Convert using factors supplied by the backend lookup catalog. */
export function convertUnitValue(value: number, from: UnitLookup, to: UnitLookup) {
  if (!Number.isFinite(value) || unitCategory(from) !== unitCategory(to)) return null;
  const fromFactor = unitConversionFactor(from);
  const toFactor = unitConversionFactor(to);
  if (fromFactor == null || toFactor == null) return null;
  const converted = value * fromFactor / toFactor;
  return Number.isFinite(converted) ? converted : null;
}
