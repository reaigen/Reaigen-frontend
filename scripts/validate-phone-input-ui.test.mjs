import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const setup = await readFile(new URL("../app/components/account-setup-flow.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("../app/components/settings-form.tsx", import.meta.url), "utf8");
const recovery = await readFile(new URL("../app/components/account-email-flow.tsx", import.meta.url), "utf8");
const control = await readFile(new URL("../app/components/international-phone-input.tsx", import.meta.url), "utf8");

test("every editable account phone uses the shared international control", () => {
  assert.match(setup, /<InternationalPhoneInput[\s\S]*id="setup-phone"/);
  assert.match(settings, /<InternationalPhoneInput[\s\S]*id="seller-phone"/);
  assert.match(settings, /<InternationalPhoneInput[\s\S]*id="seller-secondary-phone"/);
  assert.match(recovery, /<InternationalPhoneInput/);
});

test("the picker is searchable, accessible, and accepts international paste", () => {
  assert.match(control, /aria-expanded=\{pickerOpen\}/);
  assert.match(control, /<ul/);
  assert.match(control, /aria-pressed=\{active\}/);
  assert.match(control, /onPaste=/);
  assert.match(control, /getPhoneCountries\(lang\)/);
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
