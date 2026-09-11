import assert from "node:assert/strict";
import test from "node:test";

import {
  countFormIssues,
  isEmailAddress,
  isValidOptionalWebAddress,
  normalizeWebAddress,
} from "./form-validation.ts";

test("email validation accepts complete addresses and rejects partial input", () => {
  assert.equal(isEmailAddress("tomas3166@gmail.com"), true);
  assert.equal(isEmailAddress("  person+listing@reaigen.io  "), true);
  assert.equal(isEmailAddress("person@reaigen"), false);
  assert.equal(isEmailAddress("person reaigen.io"), false);
  assert.equal(isEmailAddress(""), false);
});

test("website fields accept a real domain without forcing people to type a scheme", () => {
  assert.equal(normalizeWebAddress("reaigen.io"), "https://reaigen.io");
  assert.equal(normalizeWebAddress("  www.reaigen.io/agents  "), "https://www.reaigen.io/agents");
  assert.equal(normalizeWebAddress("http://localhost:3055/setup"), "http://localhost:3055/setup");
  assert.equal(normalizeWebAddress(""), "");
  assert.equal(isValidOptionalWebAddress(""), true);
});

test("website fields reject unsafe schemes, credentials, and incomplete hostnames", () => {
  assert.equal(normalizeWebAddress("javascript://reaigen.io"), null);
  assert.equal(normalizeWebAddress("ftp://reaigen.io"), null);
  assert.equal(normalizeWebAddress("https://user:secret@reaigen.io"), null);
  assert.equal(normalizeWebAddress("reaigen"), null);
  assert.equal(normalizeWebAddress("https://"), null);
});

test("form issue counts ignore valid falsey checks", () => {
  assert.equal(countFormIssues([true, false, null, undefined, true]), 2);
  assert.equal(countFormIssues([]), 0);
});
