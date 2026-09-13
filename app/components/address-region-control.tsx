"use client";

import * as React from "react";
import type { AdministrativeRegionLookup } from "../lib/api/client";
import {
  regionsForCountry,
  resolveAdministrativeRegion,
} from "../lib/address-region";
import { t } from "../lib/i18n";
import { Input } from "../lib/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../lib/ui/select";

const UNSET_REGION = "__unset_region__";

export function AddressRegionControl({
  id,
  value,
  onChange,
  country,
  city,
  postalCode,
  regions,
  loading,
  lang,
  ariaDescribedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string, source: "automatic" | "manual") => void;
  country: string;
  city: string;
  postalCode?: string;
  regions: readonly AdministrativeRegionLookup[];
  loading?: boolean;
  lang: string;
  ariaDescribedBy?: string;
}) {
  const countryRegions = React.useMemo(
    () => regionsForCountry(regions, country),
    [country, regions],
  );
  const resolved = React.useMemo(
    () => resolveAdministrativeRegion(regions, country, city, postalCode),
    [city, country, postalCode, regions],
  );
  const previousAutomaticName = React.useRef<string | null>(null);

  React.useEffect(() => {
    const previous = previousAutomaticName.current;
    if (resolved) {
      previousAutomaticName.current = resolved.name;
      if (value !== resolved.name) onChange(resolved.name, "automatic");
      return;
    }
    previousAutomaticName.current = null;
    if (previous && value === previous) onChange("", "automatic");
  }, [onChange, resolved, value]);

  if (/^[A-Z]{2}$/.test(country.trim().toUpperCase()) && loading && countryRegions.length === 0) {
    return (
      <Input
        id={id}
        value={value}
        readOnly
        aria-readonly="true"
        aria-describedby={ariaDescribedBy}
        autoComplete="address-level1"
        data-region-mode="loading"
        className="bg-muted/35"
      />
    );
  }

  if (countryRegions.length === 0) {
    return (
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value, "manual")}
        autoComplete="address-level1"
        aria-describedby={ariaDescribedBy}
        data-region-mode="text"
      />
    );
  }

  const selected = resolved ?? countryRegions.find(
    (region) => region.name.toLocaleLowerCase("en-US") === value.trim().toLocaleLowerCase("en-US"),
  );

  return (
    <Select
      value={selected?.code ?? UNSET_REGION}
      disabled={Boolean(resolved)}
      onValueChange={(code) => {
        if (code === UNSET_REGION) {
          onChange("", "manual");
          return;
        }
        const region = countryRegions.find((candidate) => candidate.code === code);
        if (region) onChange(region.name, "manual");
      }}
    >
      <SelectTrigger
        id={id}
        aria-describedby={ariaDescribedBy}
        aria-readonly={Boolean(resolved)}
        data-region-mode={resolved ? "automatic" : "select"}
        className="disabled:bg-muted/35 disabled:opacity-100"
      >
        <SelectValue placeholder={t("address.region.selectPlaceholder", lang)} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET_REGION}>{t("address.region.selectPlaceholder", lang)}</SelectItem>
        {countryRegions.map((region) => (
          <SelectItem key={region.code} value={region.code}>{region.display_name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
