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
