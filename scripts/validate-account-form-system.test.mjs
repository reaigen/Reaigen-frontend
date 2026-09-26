import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isSupportedProfileImage,
  profileImageProblemFromResponse,
  profileImageType,
  scaledProfileImageSize,
} from "../app/lib/profile-image.ts";

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
  const registration = auth.slice(
    auth.indexOf("function RegistrationCard"),
    auth.indexOf("export function AuthGate"),
  );
  assert.match(auth, /id="register-first-name"[\s\S]*?error=\{firstNameError\}/);
  assert.match(auth, /id="register-email"[\s\S]*?error=\{emailError\}/);
  assert.match(auth, /id="register-password"[\s\S]*?error=\{passwordError\}/);
  assert.match(auth, /<FieldMessage id="register-terms-error">/);
  assert.match(field, /export function FieldMessage[\s\S]*?role="alert"/);
  assert.match(auth, /isEmailAddress\(email\)/);
  assert.doesNotMatch(registration, /placeholder=/);
});

test("required setup fields react after blur and explain rejected submits", () => {
  assert.match(setup, /onBlur=\{\(\) => touch\("firstName"\)\}/);
  assert.match(setup, /onBlur=\{\(\) => setPhoneTouched\(true\)\}/);
  assert.match(setup, /data-testid="setup-validation-status"/);
  assert.match(setup, /touchAll\(\["name", "email", "address", "city", "postal", "country"\]\)/);
  assert.ok((setup.match(/noValidate/g) ?? []).length >= 4);
});

test("country and phone fields use searchable pickers with server-owned billing choices", () => {
  assert.match(setup, /id="setup-country"[\s\S]*?<CountrySelect/);
  assert.match(setup, /id="setup-billing-country"[\s\S]*?<CountrySelect/);
  assert.match(settings, /id="seller-country"[\s\S]*?<CountrySelect/);
  assert.match(settings, /id="settings-billing-country"[\s\S]*?<CountrySelect/);
  assert.match(countrySelect, /<CountryPickerSheet/);
  assert.match(phoneInput, /<CountryPickerSheet/);
  assert.match(countryPicker, /getPhoneCountries\(lang\)/);
  assert.match(countryPicker, /<SearchField/);
  assert.match(setup, /id="setup-billing-country"[\s\S]*?options=\{billingCountries\}/);
  assert.match(settings, /id="settings-billing-country"[\s\S]*?options=\{billingCatalog\?\.countries \?\? \[\]\}/);
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
  assert.match(setup, /<CurrentStepIcon/);
  assert.doesNotMatch(setup, /var\(--font-brand\)|CheckIcon|(?:text|bg|border)-success/);
  assert.match(field, /items-center justify-between/);
  assert.match(field, /text-\[13px\] leading-5 text-foreground\/85/);
  assert.match(setup, /const StepIcon = STEPS\[index\]\.icon/);
  assert.match(setup, /<StepIcon size=/);
  assert.match(setup, /<ArrowLeftIcon[\s\S]*?<ArrowRightIcon/);
  assert.match(icons, /export const ProfileIcon/);
});

test("account setup disappears from Settings after completion or dismissal", () => {
  assert.match(settings, /function AccountSetupEntry/);
  assert.match(settings, /useAccountSetup\(user\)/);
  // The card is not rendered unless setup should be prompted; it eases open when it is.
  assert.match(settings, /const show = !loading && status !== null && shouldPromptAccountSetup\(status\)/);
  assert.match(settings, /\{show && status \? <AccountSetupEntryCard/);
  assert.match(setup, /const ready = isAccountReady\(status\)/);
  assert.match(setup, /if \(!shouldShowSetupReminder\(status\)\) return null;/);
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
  assert.match(settings, /SETTINGS_SETUP_STEPS[\s\S]*?ProfileIcon[\s\S]*?SellerIcon[\s\S]*?BillingIcon[\s\S]*?AgentIcon/);
  assert.match(settings, /settingsTabs[\s\S]*?icon: ProfileIcon[\s\S]*?icon: LockIcon/);
  assert.match(settings, /data-\[state=active\]:bg-surface-subtle data-\[state=active\]:font-semibold/);
  const setupEntry = settings.slice(
    settings.indexOf("export function AccountSetupEntry"),
    settings.indexOf("function formatAccountDate"),
  );
  assert.doesNotMatch(setupEntry, /var\(--font-brand\)|CheckIcon|(?:text|bg|border)-success/);
});

test("setup saves seller details without a phone and keeps typed input when leaving a step", () => {
  // Bench 06 B06-F01/F03: Skip dropped typed seller details, and the step
  // refused to save without a phone although Settings saves the same fields.
  assert.match(setup, /const phoneValid = phoneEmpty \|\| isValidInternationalPhone\(phone\)/);
  assert.match(setup, /id="setup-phone"\s+label=\{t\("settings\.seller\.phone", lang\)\}\s+optional/);
  assert.match(setup, /if \(!\(await keepTypedInput\(\)\)\) \{/);
  assert.match(setup, /onClick=\{\(\) => \{ void leaveTo\(step\.key\); \}\}/);
  assert.match(setup, /usePendingSave\(\s*registerPendingSave,\s*sellerDirty/);
  assert.match(setup, /usePendingSave\(\s*registerPendingSave,\s*Object\.keys\(typedChanges\)/);
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

test("profile photos go through the API with a localized, actionable refusal", () => {
  // Bench 06 B06-F02/EF04: the browser PUT to the presigned bucket URL was
  // refused (no CORS) and Settings showed the raw "Failed to fetch".
  assert.doesNotMatch(settings, /uploadPresigned|presigned_url/);
  assert.match(settings, /await uploadProfileImage\(uploadAvatar, file\)/);
  assert.match(settings, /await uploadProfileImage\(uploadCover, file\)/);
  assert.match(settings, /setError\(profileImageErrorMessage\(err, lang\)\)/);
  assert.match(settings, /accept=\{PROFILE_IMAGE_ACCEPT\}/);

  assert.equal(profileImageType({ name: "IMG_0001.HEIC", type: "" }), "image/heic");
  assert.equal(profileImageType({ name: "a.jpg", type: "image/jpg" }), "image/jpeg");
  assert.equal(isSupportedProfileImage({ name: "nina.png", type: "image/png" }), true);
  assert.equal(isSupportedProfileImage({ name: "scan.pdf", type: "application/pdf" }), false);
  assert.deepEqual(scaledProfileImageSize(4032, 3024), { width: 2048, height: 1536, scaled: true });
  assert.deepEqual(scaledProfileImageSize(1024, 1024), { width: 1024, height: 1024, scaled: false });
  assert.equal(profileImageProblemFromResponse(413, null), "image_too_large");
  assert.equal(profileImageProblemFromResponse(400, "image_unsupported"), "image_unsupported");
  assert.equal(profileImageProblemFromResponse(400, "something_else"), null);
});
