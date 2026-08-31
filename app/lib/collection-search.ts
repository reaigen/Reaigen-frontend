/**
 * Normalize collection searches once so the instant client-side pass and the
 * settled server query compare the same text. Diacritic folding keeps names
 * such as "Štrbské" discoverable while someone is still typing "strbske".
 */
export function normalizeCollectionQuery(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Fast local feedback while the authoritative server search is in flight.
 * Every whitespace-delimited term must occur somewhere in the supplied card
 * fields, but the terms do not have to occur in the same field.
 */
export function matchesCollectionQuery(
  query: string,
  ...values: Array<unknown>
): boolean {
  const normalizedQuery = normalizeCollectionQuery(query);
  if (!normalizedQuery) return true;
  const haystack = normalizeCollectionQuery(values.filter(Boolean).join("\n"));
  return normalizedQuery.split(" ").every((term) => haystack.includes(term));
}
