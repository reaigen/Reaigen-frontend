/** Dashboard filter state and the drafts-list query parameters it maps to (reaigen/draft_search.py). */
export type DraftFilters = {
  property_type?: "apartment" | "house" | "land";
  offer_type?: "sale" | "rent";
  price_min?: string;
  price_max?: string;
  missing?: Array<"photos" | "description" | "price" | "address">;
};

export function activeFilterCount(filters: DraftFilters) {
  return (filters.property_type ? 1 : 0) + (filters.offer_type ? 1 : 0)
    + (filters.price_min || filters.price_max ? 1 : 0) + (filters.missing?.length ?? 0);
}

/** The query string the drafts list reads; empty values are left out. */
export function draftFilterParams(filters: DraftFilters | undefined): string {
  if (!filters) return "";
  const params = new URLSearchParams();
  if (filters.property_type) params.set("property_type", filters.property_type);
  if (filters.offer_type) params.set("offer_type", filters.offer_type);
  const digits = (value?: string) => (value ?? "").replace(/[^\d]/g, "");
  if (digits(filters.price_min)) params.set("price_min", digits(filters.price_min));
  if (digits(filters.price_max)) params.set("price_max", digits(filters.price_max));
  if (filters.missing?.length) params.set("missing", filters.missing.join(","));
  const query = params.toString();
  return query ? `&${query}` : "";
}
