import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const settings = fs.readFileSync(
  path.join(root, "app/components/settings-form.tsx"),
  "utf8",
);
const setup = fs.readFileSync(
  path.join(root, "app/components/account-setup-flow.tsx"),
  "utf8",
);
const api = fs.readFileSync(path.join(root, "app/lib/api/client.ts"), "utf8");
const apiErrors = fs.readFileSync(path.join(root, "app/lib/api/error-message.ts"), "utf8");
const trainingValidation = fs.readFileSync(path.join(root, "app/lib/training-quality.ts"), "utf8");
const english = fs.readFileSync(path.join(root, "app/lib/locales/en.ts"), "utf8");

test("settings refreshes every billing and entitlement fact from the backend", () => {
  const refreshBlock = settings.slice(
    settings.indexOf("const refreshAccountState"),
    settings.indexOf("React.useEffect(() =>", settings.indexOf("const refreshAccountState")),
  );
  for (const request of [
    "getBilling()",
    "getUserCapabilities()",
    "getBillingCatalog()",
    "getBillingPayments()",
  ]) {
    assert.ok(refreshBlock.includes(request), `${request} must be part of the account refresh`);
  }
  assert.match(refreshBlock, /Promise\.allSettled\(\[/);
  assert.match(
    api,
    /getUserCapabilities[\s\S]{0,220}freshRequest\("\/api\/reaigen\/users\/permissions\/"\)/,
  );
  assert.match(
    api,
    /getBilling[\s\S]{0,140}freshRequest\("\/api\/reaigen\/billing\/me\/"\)/,
  );
  assert.match(
    api,
    /getBillingCatalog[\s\S]{0,160}freshRequest\("\/api\/reaigen\/billing\/catalog\/"\)/,
  );
  assert.match(
    api,
    /getBillingPayments[\s\S]{0,180}"\/api\/reaigen\/billing\/payments\/"/,
  );
  const paymentsClient = api.slice(
    api.indexOf("export async function getBillingPayments"),
    api.indexOf("export async function createCreditCheckout"),
  );
  assert.match(paymentsClient, /Array\.isArray\(payload\)/);
  assert.match(paymentsClient, /throw new Error\("Invalid billing payments response"\)/);
  assert.doesNotMatch(paymentsClient, /results \?\? \[\]/);
});

test("settings never treats the deprecated tier post mirror as permission", () => {
  const billingTab = settings.slice(
    settings.indexOf("function BillingTab"),
    settings.indexOf("/* ── Security Tab"),
  );
  assert.doesNotMatch(billingTab, /tier\?\.max_posts/);
  assert.match(billingTab, /data-testid="reailist-access"/);
  assert.match(billingTab, /productAllowed=\{reailistAllowed\}/);
});

test("credits and plan functions remain visible while live data loads", () => {
  assert.match(settings, /data-testid="compute-credits"/);
  assert.match(settings, /data-testid="plan-functions"/);
  assert.doesNotMatch(settings, /\{credits && \(/);
});

test("payment actions require the precise capabilities reported by Django", () => {
  assert.match(settings, /providerStatus\?\.configured === true[\s\S]*?providerStatus\.enabled[\s\S]*?providerStatus\.supports_checkout/);
  assert.match(settings, /providerStatus\?\.configured === true[\s\S]*?providerStatus\.enabled[\s\S]*?providerStatus\.supports_payment_methods/);
  assert.match(settings, /providerStatus\?\.configured === true[\s\S]*?providerStatus\.enabled[\s\S]*?providerStatus\.supports_portal/);
});

test("trial state and payment-history errors are backend facts, not UI guesses", () => {
  const billingTab = settings.slice(
    settings.indexOf("function BillingTab"),
    settings.indexOf("/* ── Security Tab"),
  );
  assert.match(billingTab, /const trialActive = ba\?\.is_trial === true/);
  assert.match(billingTab, /ba\?\.days_until_expiry \?\? null/);
  assert.doesNotMatch(billingTab, /new Date\(ba\?\.(?:trial|subscription)/);
  assert.match(billingTab, /paymentsLoadError && payments == null[\s\S]*?historyLoadError/);
  assert.match(billingTab, /payments\.length === 0[\s\S]*?historyEmpty/);
  assert.doesNotMatch(english, /Manage billing to change or cancel/);
});

test("billing country choices come from the Django billing catalog", () => {
  assert.match(api, /export interface BillingCatalog[\s\S]*?countries: BillingCatalogCountry\[\]/);
  assert.match(setup, /const billingCountries = billingCatalog\?\.countries \?\? \[\]/);
  assert.match(setup, /id="setup-billing-country"[\s\S]*?options=\{billingCountries\}/);
  assert.match(settings, /id="settings-billing-country"[\s\S]*?options=\{billingCatalog\?\.countries \?\? \[\]\}/);
});

test("training profiles, resolution choices, and numeric limits come from Django", () => {
  const trainingTab = settings.slice(
    settings.indexOf("function TrainingTab"),
    settings.indexOf("function LocalizationTab"),
  );
  for (const field of [
    "training_catalog",
    "default_resolution_code",
    "default_iterations",
    "minimum_iterations",
    "maximum_iterations",
    "iteration_step",
  ]) assert.ok(trainingTab.includes(field), `${field} must drive the training UI`);
  assert.match(trainingTab, /training_quality: selectedProfile\.code/);
  assert.match(api, /export interface PipelinePreferences[\s\S]*?alignment_backend: string/);
  assert.doesNotMatch(trainingTab, /TRAINING_PROFILE_DEFAULTS|"(?:fast|balanced|quality|res1|res2)"|5350|15000|30000|60000/);
  assert.match(trainingValidation, /if \(!policy\) return null/);
  assert.doesNotMatch(trainingValidation, /5350|15000|30000|60000|\b1000\b/);
});

test("insufficient-credit handling uses the structured API code", () => {
  const predicate = apiErrors.slice(
    apiErrors.indexOf("export function isInsufficientComputeCredits"),
    apiErrors.indexOf("export function isApiNotFound"),
  );
  assert.match(predicate, /error\.status === 403/);
  assert.match(predicate, /getApiErrorCode\(error\) === "insufficient_compute_credits"/);
  assert.doesNotMatch(predicate, /includes\(|detail|error\.body/);
  assert.doesNotMatch(english, /top-up or upgrade your plan/i);
});
