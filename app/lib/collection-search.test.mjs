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
