import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

const [setup, settings, auth, recovery, field, countrySelect, countryPicker, phoneInput, input, textarea, select, statusPill, globals, tailwind, icons] = await Promise.all([
  source("../app/components/account-setup-flow.tsx"),
  source("../app/components/settings-form.tsx"),
  source("../app/components/auth-gate.tsx"),
  source("../app/components/account-email-flow.tsx"),
  source("../app/lib/ui/form-field.tsx"),
  source("../app/components/country-select.tsx"),
  source("../app/components/country-picker-sheet.tsx"),
  source("../app/components/international-phone-input.tsx"),
  source("../app/lib/ui/input.tsx"),
  source("../app/lib/ui/textarea.tsx"),
  source("../app/lib/ui/select.tsx"),
  source("../app/components/status-pill.tsx"),
  source("../app/globals.css"),
  source("../tailwind.config.ts"),
  source("../app/components/icons.tsx"),
]);

test("registration, setup, and Settings share one accessible account-field contract", () => {
  assert.match(auth, /<FormField/);
  assert.match(setup, /<FormField|<Field/);
  assert.match(settings, /<FormField/);
  assert.match(field, /<Label htmlFor=\{id\}[\s>]/);
  assert.match(field, /"aria-invalid": error \? true : undefined/);
  assert.match(field, /"aria-describedby": describedBy/);
  assert.match(field, /id=\{errorId\} role="alert"/);
  assert.match(setup, /focusFirstInvalidField\(/);
  assert.match(settings, /focusFirstInvalidField\(/);
  assert.match(auth, /focusFirstInvalidField\(/);
});

test("registration validates each field without using labels as placeholders", () => {
  assert.match(auth, /id="register-first-name"[\s\S]*?error=\{firstNameError\}/);
  assert.match(auth, /id="register-email"[\s\S]*?error=\{emailError\}/);
  assert.match(auth, /id="register-password"[\s\S]*?error=\{passwordError\}/);
  assert.match(auth, /id="register-terms-error" role="alert"/);
  assert.match(auth, /isEmailAddress\(email\)/);
  assert.doesNotMatch(auth, /placeholder=\{t\("auth\.(?:login|register)\./);
});

test("required setup fields react after blur and explain rejected submits", () => {
  assert.match(setup, /onBlur=\{\(\) => touch\("firstName"\)\}/);
  assert.match(setup, /onBlur=\{\(\) => setPhoneTouched\(true\)\}/);
  assert.match(setup, /data-testid="setup-validation-status"/);
  assert.match(setup, /touchAll\(\["name", "email", "address", "city", "postal", "country"\]\)/);
  assert.ok((setup.match(/noValidate/g) ?? []).length >= 4);
});

test("country and phone fields use the same searchable metadata catalogue", () => {
  assert.match(setup, /id="setup-country"[\s\S]*?<CountrySelect/);
  assert.match(setup, /id="setup-billing-country"[\s\S]*?<CountrySelect/);
  assert.match(settings, /id="seller-country"[\s\S]*?<CountrySelect/);
  assert.match(settings, /id="settings-billing-country"[\s\S]*?<CountrySelect/);
  assert.match(countrySelect, /<CountryPickerSheet/);
  assert.match(phoneInput, /<CountryPickerSheet/);
  assert.match(countryPicker, /getPhoneCountries\(lang\)/);
  assert.match(countryPicker, /<SearchField/);
});

test("account forms have no fake identity, handle, domain, or country placeholders", () => {
  const accountForms = `${setup}\n${settings}`;
  assert.doesNotMatch(accountForms, /example\.com|your-name|yourhandle/i);
  assert.doesNotMatch(accountForms, /placeholder="SK"/);
});

test("account controls and recovery use semantic theme surfaces", () => {
  const themedSources = `${input}\n${textarea}\n${select}\n${countrySelect}\n${phoneInput}\n${recovery}`;
  assert.doesNotMatch(themedSources, /\bbg-white(?:\b|\/)/);
  assert.match(input, /bg-card/);
  assert.match(textarea, /bg-card/);
  assert.match(select, /bg-card/);
  assert.match(countrySelect, /bg-card/);
  assert.match(phoneInput, /bg-card/);
});

test("the setup wizard keeps indicators, labels, and headings on one visual system", () => {
  assert.match(setup, /grid grid-cols-4 rounded-\[24px\]/);
  assert.match(setup, /left-1\/2 top-\[22px\] h-px w-full/);
  assert.match(setup, /inline-flex shrink-0 items-center justify-center rounded-full border/);
  assert.match(setup, /<CurrentStepIcon[\s\S]*?var\(--font-brand\)/);
  assert.match(field, /items-center justify-between/);
  assert.match(field, /text-\[13px\] leading-5 text-foreground\/85/);
  assert.match(setup, /const StepIcon = STEPS\[index\]\.icon/);
  assert.match(setup, /<StepIcon size=/);
  assert.match(setup, /<ArrowLeftIcon[\s\S]*?<ArrowRightIcon/);
  assert.match(icons, /export const ProfileIcon/);
});

test("account setup is permanently discoverable in Settings with live backend state", () => {
  assert.match(settings, /function AccountSetupEntry/);
  assert.match(settings, /useAccountSetup\(user\)/);
  assert.match(settings, /isAccountReady\(status\)/);
  assert.match(setup, /const ready = isAccountReady\(status\)/);
  assert.match(setup, /setup\.done\.blockedSubtitle/);
  assert.match(settings, /href="\/setup"/);
  assert.match(settings, /data-testid="settings-account-setup"/);
  assert.match(settings, /data-blocked=\{blocked \? "true" : "false"\}/);
  assert.match(settings, /data-testid="settings-setup-steps"/);
  assert.match(settings, /data-testid=\{`settings-setup-step-\$\{step\.key\}`\}/);
  assert.match(settings, /grid-cols-2 gap-2 sm:grid-cols-4/);
  assert.match(settings, /status\?\.nextStep === step\.key/);
  assert.match(settings, /setup\.status\.next/);
  assert.match(settings, /setup\.status\.pending/);
  assert.match(settings, /SETTINGS_SETUP_STEPS[\s\S]*?ProfileIcon[\s\S]*?DeviceMobileIcon[\s\S]*?PriceIcon[\s\S]*?AgentIcon/);
  assert.match(settings, /settingsTabs[\s\S]*?icon: ProfileIcon[\s\S]*?icon: LockIcon/);
  assert.match(settings, /group-data-\[state=active\]:bg-primary/);
});

test("account elements use the Reaigen semantic palette instead of utility colors", () => {
  const accountSurfaces = `${setup}\n${settings}\n${statusPill}\n${countrySelect}\n${countryPicker}\n${phoneInput}`;
  assert.doesNotMatch(accountSurfaces, /(?:bg|text|border|ring)-(?:emerald|amber|red|green|yellow|blue|indigo|violet|purple|orange)-/);
  assert.doesNotMatch(settings, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  assert.match(globals, /--warning:\s+38 62% 36%/);
  assert.match(tailwind, /warning: \{ DEFAULT: "hsl\(var\(--warning\)\)"/);
  assert.match(statusPill, /success: "bg-success"/);
  assert.match(statusPill, /warning: "bg-warning"/);
  assert.match(statusPill, /danger: "bg-destructive"/);
});
