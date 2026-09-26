import assert from "node:assert/strict";
import test from "node:test";

import {
  matchesCollectionQuery,
  normalizeCollectionQuery,
} from "./collection-search.ts";

test("collection queries normalize case, whitespace, and diacritics", () => {
  assert.equal(normalizeCollectionQuery("  ŠTRBSKÉ   Pleso "), "strbske pleso");
});

test("collection search can match terms across separate card fields", () => {
  assert.equal(
    matchesCollectionQuery("bratislava apartment", "Riverside apartment", "Bratislava", "Slovakia"),
    true,
  );
  assert.equal(
    matchesCollectionQuery("bratislava house", "Riverside apartment", "Bratislava", "Slovakia"),
    false,
  );
});

test("the dashboard's instant match reads the street and leaves number filters to the server (2026-09-26)", async () => {
  const { readFileSync } = await import("node:fs");
  const dashboard = readFileSync(new URL("../dashboard/page.tsx", import.meta.url), "utf8");
  // "bajkalska" finds "Bajkalská 9": the private address is part of the match.
  assert.match(dashboard, /draft\.address,\s*draft\.display_address,/);
  assert.equal(matchesCollectionQuery("bajkalska 9", "Byt", null, "Bajkalská 9, Bratislava"), true);
  // "byty pod 200000" is a filter the server reads; no local "no results" flash.
  assert.match(dashboard, /if \(\/\\d\/\.test\(normalizedSearchInput\)\) return drafts;/);
});

test("dashboard filters map to the drafts list parameters", async () => {
  const { draftFilterParams, activeFilterCount } = await import("./draft-filters.ts");
  assert.equal(draftFilterParams({}), "");
  assert.equal(
    draftFilterParams({ property_type: "apartment", offer_type: "rent", price_min: "150 000", price_max: "300000 €", missing: ["photos", "description"] }),
    "&property_type=apartment&offer_type=rent&price_min=150000&price_max=300000&missing=photos%2Cdescription",
  );
  assert.equal(activeFilterCount({ property_type: "house", price_max: "1", missing: ["price"] }), 3);
  const { readFileSync } = await import("node:fs");
  const dashboard = readFileSync(new URL("../dashboard/page.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /listDrafts\(page, DASHBOARD_PAGE_SIZE, searchQuery, controller\.signal, filterQuery\)/);
  assert.match(dashboard, /!searchQuery && !filterQuery && user\?\.id/, "a filtered page is never cached as the whole list");
  assert.match(dashboard, /<DraftFilterBar value=\{filters\}/);
});
