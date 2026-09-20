import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { resolveUnit } from "./unit-catalog.ts";

registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); } catch (error) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });
const { proposalFieldUnit } = await import("./agent-proposal.ts");
const units = [
  { id: 718, code: "M2", symbol: "m²", name: "Square metre", category_code: "AREA", is_base: true },
  { id: 451, code: "SQ_FT", symbol: "ft²", name: "Square foot", category_code: "AREA" },
  { id: 902, code: "EUR", symbol: "€", name: "Euro", category_code: "CURRENCY", is_base: true },
  { id: 987, code: "CZK", symbol: "Kč", name: "Czech koruna", category_code: "CURRENCY" },
];

test("lookup IDs are catalog supplied and must match the requested category", () => {
  assert.equal(resolveUnit(units, 451, "AREA"), units[1]);
  assert.equal(resolveUnit(units, "987", "CURRENCY"), units[3]);
  assert.equal(resolveUnit(units, 987, "AREA"), null);
  assert.equal(resolveUnit(units, "SQ_FT", "CURRENCY"), null);
  assert.equal(resolveUnit(units, "CZK", ["AREA", "CURRENCY"]), units[3]);
});

test("proposal previews use new units rather than the listing's previous currency or measurements", () => {
  const current = { currency: "EUR", area_unit: 718, lot_size_unit: 718, floorplan_measurements: { total_floor_area_m2: 60 } };
  assert.equal(proposalFieldUnit("price", { currency: "CZK" }, current, units), units[3]);
  assert.equal(proposalFieldUnit("area", { area_unit: 451 }, current, units), units[1]);
  assert.equal(proposalFieldUnit("lot_size", { lot_size_unit: 451 }, current, units), units[1]);
  assert.equal(proposalFieldUnit("price", {}, current, units), units[2]);
  assert.equal(proposalFieldUnit("area", {}, current, units), units[0]);
});

test("missing or invalid proposed lookups never inherit a misleading unit label", () => {
  assert.equal(proposalFieldUnit("price", { currency: "unknown" }, { currency: "EUR" }, units), null);
  assert.equal(proposalFieldUnit("area", { area_unit: null }, { area_unit: 718 }, units), null);
  assert.equal(proposalFieldUnit("area", { area_unit: 987 }, undefined, units), null);
});
