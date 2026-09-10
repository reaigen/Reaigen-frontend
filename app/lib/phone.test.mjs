import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPhoneDisplay,
  getPhoneCountries,
  interpretPhoneInput,
  isValidInternationalPhone,
  phoneInputDisplay,
  resolvePhoneCountry,
} from "./phone.ts";

test("the phone catalogue covers every metadata-backed region and shared prefixes", () => {
  const countries = getPhoneCountries("en");
  assert.ok(countries.length >= 240);
  assert.equal(countries.find((country) => country.code === "SK")?.callingCode, "421");
  assert.equal(countries.find((country) => country.code === "US")?.callingCode, "1");
  assert.equal(countries.find((country) => country.code === "CA")?.callingCode, "1");
  assert.ok(countries.every((country) => country.name && country.flag && country.callingCode));
});

test("national input becomes the same E.164 shape Django validates", () => {
  const slovak = interpretPhoneInput("0900 123 456", "SK");
  assert.equal(slovak.country, "SK");
  assert.equal(slovak.display, "0900 123 456");
  assert.equal(slovak.e164, "+421900123456");
  assert.equal(isValidInternationalPhone(slovak.e164), true);

  const czech = interpretPhoneInput("601 234 567", "CZ");
  assert.equal(czech.e164, "+420601234567");
  assert.equal(isValidInternationalPhone(czech.e164), true);
});

test("international paste detects its country instead of retaining the old prefix", () => {
  const pasted = interpretPhoneInput("0044 7700 900123", "SK");
  assert.equal(pasted.country, "GB");
  assert.equal(pasted.e164, "+447700900123");
  assert.match(pasted.display, /^\+44/);
});

test("profile and locale defaults are deterministic for an empty input", () => {
  assert.equal(resolvePhoneCountry("", "CZ", "sk"), "CZ");
  assert.equal(resolvePhoneCountry("", null, "de-DE"), "DE");
  assert.equal(resolvePhoneCountry("+421900123456", "CZ", "cs"), "SK");
});

test("saved numbers render nationally for editing and internationally for summaries", () => {
  assert.equal(phoneInputDisplay("+421900123456", "SK"), "0900 123 456");
  assert.deepEqual(formatPhoneDisplay("+421900123456"), {
    display: "+421 900 123 456",
    flag: "🇸🇰",
  });
  assert.equal(isValidInternationalPhone("+42112"), false);
});
