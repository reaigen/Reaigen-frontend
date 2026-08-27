import assert from "node:assert/strict";
import test from "node:test";

import { currencyDisplaySymbol } from "../app/lib/currency-display.ts";

test("currency details use the active backend currency mark", () => {
  assert.equal(currencyDisplaySymbol("EUR", "sk-SK"), "€");
  assert.equal(currencyDisplaySymbol("GBP", "en-GB"), "£");
  assert.equal(currencyDisplaySymbol("JPY", "ja-JP"), "￥");
});

test("the backend catalog symbol remains authoritative", () => {
  assert.equal(currencyDisplaySymbol("USD", "en-US", "US$"), "US$");
});
