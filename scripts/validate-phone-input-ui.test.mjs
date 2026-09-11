import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const setup = await readFile(new URL("../app/components/account-setup-flow.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("../app/components/settings-form.tsx", import.meta.url), "utf8");
const recovery = await readFile(new URL("../app/components/account-email-flow.tsx", import.meta.url), "utf8");
const control = await readFile(new URL("../app/components/international-phone-input.tsx", import.meta.url), "utf8");
const picker = await readFile(new URL("../app/components/country-picker-sheet.tsx", import.meta.url), "utf8");

test("every editable account phone uses the shared international control", () => {
  assert.match(setup, /<Field[\s\S]*?id="setup-phone"[\s\S]*?<InternationalPhoneInput/);
  assert.match(settings, /<FormField id="seller-phone"[\s\S]*?<InternationalPhoneInput/);
  assert.match(settings, /<FormField id="seller-secondary-phone"[\s\S]*?<InternationalPhoneInput/);
  assert.match(recovery, /<InternationalPhoneInput/);
});

test("the picker is searchable, accessible, and accepts international paste", () => {
  assert.match(control, /aria-expanded=\{pickerOpen\}/);
  assert.match(control, /onPaste=/);
  assert.match(control, /getPhoneCountries\(lang\)/);
  assert.match(control, /<CountryPickerSheet/);
  assert.match(picker, /<SearchField/);
  assert.match(picker, /<ul/);
  assert.match(picker, /aria-pressed=\{active\}/);
  assert.match(picker, /getPhoneCountries\(lang\)/);
});

test("the calling-code control has a real, stateful dropdown affordance", () => {
  assert.match(control, /import \{ ChevronDownIcon \} from "\.\/icons"/);
  assert.match(control, /<ChevronDownIcon[\s\S]*?pickerOpen && "rotate-180"/);
  assert.match(control, /aria-haspopup="dialog"/);
  assert.doesNotMatch(control, /▾/);
});

test("SMS recovery has valid label and error relationships", () => {
  assert.match(recovery, /label htmlFor="recovery-phone"/);
  assert.match(recovery, /id="recovery-phone"/);
  assert.match(recovery, /id="recovery-phone-error" role="alert"/);
  assert.match(recovery, /recovery-phone-error recovery-phone-hint/);
});

test("OTP and recovery actions require metadata-backed validation", () => {
  assert.match(setup, /const phoneValid = isValidInternationalPhone\(phone\)/);
  assert.match(recovery, /const phoneValid = isValidInternationalPhone\(phone\)/);
  assert.match(recovery, /disabled=\{loading \|\|[\s\S]*!phoneValid/);
});
