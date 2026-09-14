import type { DraftDetailItem } from "./tour-types";

function hasValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 && normalized !== "null" && normalized !== "n/a";
  }
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).some(hasValue);
  // Zero and false are valid field values.
  return true;
}

/**
 * Fields the current draft can actually render on a public share. Django
 * performs the same intersection on write/read; this keeps unavailable
 * choices out of the UI before submission.
 */
export function availableDraftShareFields(
  draft: DraftDetailItem,
  capabilities: { tour: boolean; photos: boolean; floorplan: boolean },
): Set<string> {
  if (Array.isArray(draft.available_share_fields)) {
    const fields = new Set(draft.available_share_fields);
    if (!capabilities.tour) fields.delete("tour");
    if (!capabilities.photos) fields.delete("uploads");
    if (!capabilities.floorplan) fields.delete("floorplan");
    return fields;
  }

  // Transitional fallback for a mixed-version rollout. Django still applies
  // the authoritative intersection to every create/update and public read.
  const fields = new Set<string>();
  const add = (name: string, value: unknown) => {
    if (hasValue(value)) fields.add(name);
  };

  add("title", draft.title);
  add("description", draft.description);
  add("display_address", draft.display_address);
  add("city", draft.city);
  add("state", draft.state);
  add("country", draft.country);
  add("price", draft.price);
  if (hasValue(draft.price)) add("currency", draft.currency);

  const processedData = (draft.draft_data ?? []).filter((row) => (
    row.status === undefined || row.status === "processed"
  ));
  const dataValue = (key: string) => processedData
    .filter((row) => row.data_key.trim().toLowerCase() === key)
    .at(-1)?.data_value;
  add("bedrooms", draft.specs?.layout?.bedrooms ?? dataValue("bedrooms"));
  add("bathrooms", draft.specs?.layout?.bathrooms ?? dataValue("bathrooms"));
  add("area", draft.area);
  if (hasValue(draft.area)) add("area_unit", draft.area_unit);
  add("lot_size", draft.lot_size);
  if (hasValue(draft.lot_size)) add("lot_size_unit", draft.lot_size_unit);
  add("year_built", draft.year_built);

  if (processedData.some((row) => hasValue(row.data_value))) fields.add("data");
  const pipeline = (draft as DraftDetailItem & { pipeline?: unknown }).pipeline;
  add("pipeline", pipeline);
  if (capabilities.photos) fields.add("uploads");
  if (capabilities.floorplan) fields.add("floorplan");
  if (capabilities.tour) fields.add("tour");
  return fields;
}
