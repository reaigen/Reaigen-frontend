import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { availableDraftShareFields } from "../app/lib/share-field-availability.ts";

function draft(overrides = {}) {
  return {
    id: 1,
    title: "Available title",
    description: "",
    display_address: null,
    city: "",
    state: "",
    country: "",
    postal_code: "",
    price: null,
    currency: "EUR",
    area: null,
    area_unit: 1,
    area_unit_display: "m²",
    area_display: null,
    area_preferred: null,
    area_preferred_unit: null,
    price_preferred: null,
    price_preferred_currency: null,
    is_complete: false,
    is_portfolio_visible: false,
    specs: { layout: {} },
    raw_uploads: [],
    draft_data: [],
    year_built: null,
    floorplan_id: null,
    splat_id: null,
    lot_size: null,
    lot_size_unit: 2,
    lot_size_preferred: null,
    latitude: null,
    longitude: null,
    created_at: "2026-09-14T00:00:00Z",
    updated_at: "2026-09-14T00:00:00Z",
    ...overrides,
  };
}

test("only fields with real draft values are selectable", () => {
  const fields = availableDraftShareFields(draft(), {
    tour: false,
    photos: false,
    floorplan: false,
  });

  assert.deepEqual([...fields], ["title"]);
  assert.equal(fields.has("currency"), false, "currency without price is not a field");
  assert.equal(fields.has("area_unit"), false, "unit without area is not a field");
  assert.equal(fields.has("lot_size_unit"), false, "unit without lot size is not a field");
});

test("zero, processed details, and real capabilities remain shareable", () => {
  const fields = availableDraftShareFields(draft({
    price: 0,
    currency: "EUR",
    specs: { layout: { bedrooms: 0, bathrooms: 1 } },
    draft_data: [
      { id: 1, data_key: "condition", data_value: "renovated", data_type: "text", sort_order: 0, status: "processed" },
      { id: 2, data_key: "ignored", data_value: "value", data_type: "text", sort_order: 1, status: "raw" },
    ],
    pipeline: { current_stage: 1, is_complete: false },
  }), {
    tour: true,
    photos: true,
    floorplan: true,
  });

  for (const field of ["price", "currency", "bedrooms", "bathrooms", "data", "pipeline", "tour", "uploads", "floorplan"]) {
    assert.equal(fields.has(field), true, `${field} should be available`);
  }
});

test("blank and null-like values never become share choices", () => {
  const fields = availableDraftShareFields(draft({
    description: "  ",
    display_address: "null",
    draft_data: [
      { id: 1, data_key: "condition", data_value: "N/A", data_type: "text", sort_order: 0, status: "processed" },
    ],
  }), { tour: false, photos: false, floorplan: false });

  assert.equal(fields.has("description"), false);
  assert.equal(fields.has("display_address"), false);
  assert.equal(fields.has("data"), false);
});

test("Django availability contract overrides locally populated placeholders", () => {
  const fields = availableDraftShareFields(draft({
    available_share_fields: ["title", "tour", "uploads"],
    description: "Local value that Django did not authorize",
  }), { tour: false, photos: true, floorplan: true });

  assert.deepEqual([...fields], ["title", "uploads"]);
  assert.equal(fields.has("description"), false);
  assert.equal(fields.has("tour"), false, "client capability may narrow Django");
});

test("share controls do not render unavailable cards or fields", () => {
  const selector = readFileSync(
    new URL("../app/components/sharing/content-scope-selector.tsx", import.meta.url),
    "utf8",
  );

  assert.match(selector, /cards\.filter\(\(card\) => card\.available\)\.map/);
  assert.match(selector, /group\.fields\.filter\(fieldAvailable\)/);
});
