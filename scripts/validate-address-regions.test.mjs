import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  normalizeAddressLocality,
  resolveAdministrativeRegion,
} from "../app/lib/address-region.ts";

const regions = [
  {
    id: 1,
    code: "SK_BA",
    name: "Bratislavský kraj",
    display_name: "Bratislava Region",
    description: "",
    is_active: true,
    sort_order: 10,
    country_code: "SK",
    locality_names: ["Bratislava", "Pezinok"],
    postal_code_prefixes: ["81"],
  },
  {
    id: 2,
    code: "SK_ZA",
    name: "Žilinský kraj",
    display_name: "Žilina Region",
    description: "",
    is_active: true,
    sort_order: 20,
    country_code: "SK",
    locality_names: ["Žilina", "Martin"],
    postal_code_prefixes: ["010"],
  },
];

test("address locality matching is deterministic across accents and case", () => {
  assert.equal(normalizeAddressLocality("  ŽILINA!!! "), "zilina");
  assert.equal(
    resolveAdministrativeRegion(regions, "sk", "zilina")?.code,
    "SK_ZA",
  );
  assert.equal(
    resolveAdministrativeRegion(regions, "SK", "BRATISLAVA")?.name,
    "Bratislavský kraj",
  );
});

test("unknown and ambiguous localities remain unresolved", () => {
  assert.equal(resolveAdministrativeRegion(regions, "SK", "Unknown"), null);
  const ambiguous = [
    ...regions,
    { ...regions[1], id: 3, code: "SK_TEST", locality_names: ["Bratislava"] },
  ];
  assert.equal(resolveAdministrativeRegion(ambiguous, "SK", "Bratislava"), null);
});

test("a precise postal match may resolve an otherwise unknown locality", () => {
  assert.equal(
    resolveAdministrativeRegion(regions, "SK", "", "010 01")?.code,
    "SK_ZA",
  );
  assert.equal(resolveAdministrativeRegion(regions, "CZ", "Žilina", "01001"), null);
});

test("seller and billing forms share the guarded Django lookup control", async () => {
  const [setup, settings, control, client, locales] = await Promise.all([
    readFile(new URL("../app/components/account-setup-flow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/settings-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/address-region-control.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/api/client.ts", import.meta.url), "utf8"),
    Promise.all(["en", "sk", "cs", "de"].map((language) => (
      readFile(new URL(`../app/lib/locales/${language}.ts`, import.meta.url), "utf8")
    ))),
  ]);
  assert.equal((setup.match(/<AddressRegionControl/g) ?? []).length, 2);
  assert.equal((settings.match(/<AddressRegionControl/g) ?? []).length, 2);
  assert.match(control, /disabled=\{Boolean\(resolved\)\}/);
  assert.match(control, /data-region-mode="loading"/);
  assert.match(control, /data-region-mode=\{resolved \? "automatic" : "select"\}/);
  assert.match(client, /lookups\/administrative-regions\/\?country_code=/);
  assert.match(client, /languageQuery/);
  for (const locale of locales) {
    assert.match(locale, /"address\.region\.automaticHint"/);
    assert.match(locale, /"address\.region\.selectPlaceholder"/);
  }
});
