import type { AdministrativeRegionLookup } from "./api/client";

export function normalizeAddressLocality(value: string): string {
  return value
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .match(/[a-z0-9]+/g)
    ?.join(" ") ?? "";
}

function normalizePostalCode(value: string): string {
  return value.toLocaleLowerCase("en-US").match(/[a-z0-9]+/g)?.join("") ?? "";
}

export function regionsForCountry(
  regions: readonly AdministrativeRegionLookup[],
  countryCode: string,
): AdministrativeRegionLookup[] {
  const country = countryCode.trim().toUpperCase();
  return regions
    .filter((region) => region.is_active && region.country_code.toUpperCase() === country)
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));
}

export function resolveAdministrativeRegion(
  regions: readonly AdministrativeRegionLookup[],
  countryCode: string,
  city: string,
  postalCode = "",
): AdministrativeRegionLookup | null {
  const countryRegions = regionsForCountry(regions, countryCode);
  const locality = normalizeAddressLocality(city);
  const postal = normalizePostalCode(postalCode);
  const localityMatches = new Map<string, AdministrativeRegionLookup>();

  if (locality) {
    for (const region of countryRegions) {
      if (region.locality_names.some((alias) => normalizeAddressLocality(alias) === locality)) {
        localityMatches.set(region.code, region);
      }
    }
  }

  const postalCandidates: Array<{ prefixLength: number; region: AdministrativeRegionLookup }> = [];
  if (postal) {
    for (const region of countryRegions) {
      for (const prefix of region.postal_code_prefixes) {
        const normalizedPrefix = normalizePostalCode(prefix);
        if (normalizedPrefix && postal.startsWith(normalizedPrefix)) {
          postalCandidates.push({ prefixLength: normalizedPrefix.length, region });
        }
      }
    }
  }
  const longestPrefix = postalCandidates.reduce(
    (longest, candidate) => Math.max(longest, candidate.prefixLength),
    0,
  );
  const postalMatches = new Map<string, AdministrativeRegionLookup>();
  for (const candidate of postalCandidates) {
    if (candidate.prefixLength === longestPrefix) {
      postalMatches.set(candidate.region.code, candidate.region);
    }
  }

  if (localityMatches.size > 0 && postalMatches.size > 0) {
    const agreed = [...localityMatches.values()].filter((region) => postalMatches.has(region.code));
    return agreed.length === 1 ? agreed[0] : null;
  }
  if (localityMatches.size === 1) return [...localityMatches.values()][0];
  if (postalMatches.size === 1) return [...postalMatches.values()][0];
  return null;
}
