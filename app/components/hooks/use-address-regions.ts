"use client";

import * as React from "react";
import {
  getAdministrativeRegions,
  type AdministrativeRegionLookup,
} from "../../lib/api/client";

export function useAddressRegions(countryCode: string, language?: string) {
  const country = countryCode.trim().toUpperCase();
  const validCountry = /^[A-Z]{2}$/.test(country);
  const lookupKey = validCountry ? `${country}:${language ?? ""}` : "";
  const [snapshot, setSnapshot] = React.useState<{
    key: string;
    regions: AdministrativeRegionLookup[];
  }>({ key: "", regions: [] });

  React.useEffect(() => {
    let active = true;
    if (!validCountry) {
      return () => {
        active = false;
      };
    }
    void getAdministrativeRegions(country, language)
      .then((rows) => {
        if (active) setSnapshot({ key: lookupKey, regions: rows });
      })
      .catch(() => {
        // Region assistance is progressive enhancement. Django still applies
        // an authoritative match on save if this read-only lookup request
        // happens to fail.
        if (active) setSnapshot({ key: lookupKey, regions: [] });
      });
    return () => {
      active = false;
    };
  }, [country, language, lookupKey, validCountry]);

  return {
    regions: snapshot.key === lookupKey ? snapshot.regions : [],
    loading: validCountry && snapshot.key !== lookupKey,
  };
}
