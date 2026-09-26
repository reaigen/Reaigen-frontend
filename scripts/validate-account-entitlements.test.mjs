import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { firstDraftStep } from "../app/lib/first-step.ts";

const root = process.cwd();
const settings = fs.readFileSync(
  path.join(root, "app/components/settings-form.tsx"),
  "utf8",
);
const setup = fs.readFileSync(
  path.join(root, "app/components/account-setup-flow.tsx"),
  "utf8",
);
const upgrade = fs.readFileSync(
  path.join(root, "app/components/billing-upgrade-flow.tsx"),
  "utf8",
);
const upgradePage = fs.readFileSync(
  path.join(root, "app/upgrade/page.tsx"),
  "utf8",
);
const api = fs.readFileSync(path.join(root, "app/lib/api/client.ts"), "utf8");
const appShell = fs.readFileSync(path.join(root, "app/components/app-shell.tsx"), "utf8");
const subscriptionWelcome = fs.readFileSync(
  path.join(root, "app/components/subscription-welcome-card.tsx"),
  "utf8",
);
const setupHook = fs.readFileSync(path.join(root, "app/components/hooks/use-account-setup.ts"), "utf8");
const authGate = fs.readFileSync(path.join(root, "app/components/auth-gate.tsx"), "utf8");
const tourEditor = fs.readFileSync(path.join(root, "app/create/tour/[id]/page.tsx"), "utf8");
const versionManager = fs.readFileSync(path.join(root, "app/components/draft-version-manager.tsx"), "utf8");
const apiErrors = fs.readFileSync(path.join(root, "app/lib/api/error-message.ts"), "utf8");
const trainingValidation = fs.readFileSync(path.join(root, "app/lib/training-quality.ts"), "utf8");
const english = fs.readFileSync(path.join(root, "app/lib/locales/en.ts"), "utf8");
const englishBilling = english.slice(
  english.indexOf("// Billing"),
  english.indexOf('"settings.security.title"'),
);

test("settings refreshes every billing and entitlement fact from the backend", () => {
  const refreshBlock = settings.slice(
    settings.indexOf("const refreshAccountState"),
    settings.indexOf("React.useEffect(() =>", settings.indexOf("const refreshAccountState")),
  );
  for (const request of [
    "getBilling()",
    "getUserCapabilities()",
    "getBillingCatalog(lang)",
    "getBillingPayments(lang)",
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
    /getBillingCatalog[\s\S]{0,260}freshRequest\(`\/api\/reaigen\/billing\/catalog\/\$\{query\}`\)/,
  );
  assert.match(
    api,
    /getBillingPayments[\s\S]{0,260}`\/api\/reaigen\/billing\/payments\/\$\{query\}`/,
  );
  const paymentsClient = api.slice(
    api.indexOf("export async function getBillingPayments"),
    api.indexOf("export async function createCreditCheckout"),
  );
  assert.match(paymentsClient, /Array\.isArray\(payload\)/);
  assert.match(paymentsClient, /throw new Error\("Invalid billing payments response"\)/);
  assert.doesNotMatch(paymentsClient, /results \?\? \[\]/);
});

test("settings never exposes the internal publication product in billing", () => {
  const billingTab = settings.slice(
    settings.indexOf("function BillingTab"),
    settings.indexOf("/* ── Security Tab"),
  );
  assert.doesNotMatch(billingTab, /tier\?\.max_posts/);
  assert.doesNotMatch(billingTab, /reailist/i);
  assert.doesNotMatch(upgrade, /reailist/i);
  assert.doesNotMatch(englishBilling, /reailist/i);
});

test("billing presentation is neutral and requests the selected locale", () => {
  const billingTab = settings.slice(
    settings.indexOf("function BillingTab"),
    settings.indexOf("/* ── Security Tab"),
  );
  assert.doesNotMatch(billingTab, /(?:text|bg|border)-(?:success|green|emerald|lime)/);
  assert.doesNotMatch(upgrade, /(?:text|bg|border)-(?:success|green|emerald|lime)/);
  assert.match(api, /getBillingCatalog\(language\?: string\)/);
  assert.match(api, /language=\$\{encodeURIComponent\(language\)\}/);
  assert.match(billingTab, /getBillingCatalog\(lang\)/);
  assert.match(upgrade, /getBillingCatalog\(lang\)/);
  assert.match(billingTab, /billingCatalog\?\.account\?\.current_tier_name/);
  assert.match(billingTab, /currentCatalogTier\?\.limits\?\.find/);
  assert.doesNotMatch(englishBilling, /Django|billing server|server permission|backend verifies/i);
});

test("settings hides the plan chooser when Django reports no upgrades", () => {
  const billingTab = settings.slice(
    settings.indexOf("function BillingTab"),
    settings.indexOf("/* ── Security Tab"),
  );
  assert.match(billingTab, /billingCatalog\?\.upgrade_options \?\? \[\]/);
  assert.match(billingTab, /upgradeOptions\.length > 0/);
  assert.match(billingTab, /data-testid="no-plan-upgrades"/);
  assert.match(upgrade, /const upgradeOptions = catalog\.upgrade_options \?\? \[\]/);
  assert.match(upgrade, /upgradeOptions\.length > 0/);
});

test("credits and plan functions remain visible while live data loads", () => {
  assert.match(settings, /data-testid="compute-credits"/);
  assert.match(settings, /data-testid="plan-functions"/);
  assert.doesNotMatch(settings, /\{credits && \(/);
});

test("Agent surfaces fail closed from Django's Agent entitlement", () => {
  assert.match(appShell, /getUserCapabilities\(\)[\s\S]*?capabilities\.features\.agent_access === true[\s\S]*?getReaiAgentConsent\(\)/);
  assert.match(settings, /capabilities\.features\.agent_access === true/);
  assert.match(settings, /tab\.value !== "reai" \|\| agentAllowed/);
  assert.match(settings, /<PrivacyTab[^>]*agentAllowed=\{agentAllowed\}/);
  assert.match(settings, /agentAllowed \? \([\s\S]*?<ReaiTab lang=\{lang\}/);
  assert.match(setup, /signals\.capabilities\.features\.agent_access === true/);
  assert.match(setup, /agentEntitled === true \? \(/);
  assert.ok(
    setupHook.indexOf("getUserCapabilities()") < setupHook.indexOf("getReaiAgentConsent()"),
    "setup must resolve entitlement before requesting Agent consent",
  );
  assert.match(setupHook, /const \[consentResult\] = agentEntitled[\s\S]*?getReaiAgentConsent\(\)/);
  assert.doesNotMatch(setupHook, /capabilities == null\s*\|\|/);
  assert.match(setup, /agentEntitled === true \? \(/);
  assert.ok(
    tourEditor.indexOf("getUserCapabilities()") < tourEditor.indexOf("getReaiAgentConsent()"),
    "tour editor must prove entitlement before requesting Agent consent",
  );
  assert.match(tourEditor, /capabilities\.features\.agent_access === true/);
  assert.ok(
    versionManager.indexOf("getUserCapabilities()") < versionManager.indexOf("getReaiAgentConsent()"),
    "version manager must prove entitlement before requesting Agent data",
  );
  assert.match(versionManager, /if \(!entitled\) \{[\s\S]*?setActiveTab\("tour"\)/);
  assert.match(versionManager, /agentEntitled === true \? \([\s\S]*?<VersionTabTrigger value="listing"/);
});

test("all-tools mode hides redundant individual Agent controls", () => {
  assert.match(settings, /!toolPermissions\.allow_all_tools \? \([\s\S]*?toolPermissions\.available_tools\.map/);
  assert.match(settings, /!agentPrivacy\.tools\.allow_all_tools \? \([\s\S]*?agentPrivacy\.tools\.available_tools\.map/);
});

test("sign-in fields render their localized placeholders", () => {
  assert.match(authGate, /placeholder=\{t\("auth\.login\.emailPlaceholder", lang\)\}/);
  assert.match(authGate, /placeholder=\{t\("auth\.login\.passwordPlaceholder", lang\)\}/);
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

test("the authenticated upgrade view uses Django offers and server previews", () => {
  assert.match(upgradePage, /useAuth\(\)/);
  assert.match(upgradePage, /<BillingUpgradeFlow lang=\{lang\}/);
  assert.match(upgrade, /getBillingCatalog\(lang\)/);
  assert.match(api, /upgrade_options\?: BillingTierOption\[\]/);
  assert.match(upgrade, /const upgradeOptions = catalog\.upgrade_options \?\? \[\]/);
  assert.match(upgrade, /upgradeOptions\.map\(\(tier\)/);
  assert.match(upgrade, /data-testid="no-plan-upgrades"/);
  assert.match(upgrade, /tier\.prices\.find\(/);
  assert.match(upgrade, /tier\.actions\?\.find\(/);
  assert.match(upgrade, /tier\.limits\?\.find\(/);
  assert.match(upgrade, /tier\.features\?\.find\(/);
  assert.match(upgrade, /pack\.display_price/);
  assert.match(upgrade, /pack\.action/);
  assert.match(upgrade, /previewSubscriptionCheckout\(tier\.code, cycle, lang\)/);
  assert.match(upgrade, /previewCreditCheckout\(pack\.code, lang\)/);
  assert.match(upgrade, /disabled=\{!preview\.action\.can_checkout\}/);
  assert.match(upgrade, /confirmBillingCheckout\(sessionId, lang\)/);
});

test("the upgrade view contains no client-owned prices, tiers, limits, or credit costs", () => {
  assert.doesNotMatch(upgrade, /\b(?:FREE|STANDARD|PRO|ENTERPRISE)\b/);
  assert.doesNotMatch(upgrade, /[€$£]\s*\d|\d\s*[€$£]/);
  assert.doesNotMatch(upgrade, /price_(?:monthly|yearly)|max_processing_jobs|included_compute_credits_per_month/);
  assert.doesNotMatch(upgrade, /credits_cost\s*[?:=]\s*\d/);
  assert.doesNotMatch(upgrade, /paymentsReady|supports_checkout\s*&&|checkout_sales_enabled\s*&&/);
  assert.match(settings, /href="\/upgrade\?mode=plans"/);
  assert.match(settings, /href="\/upgrade\?mode=credits"/);
});

test("an upward subscription change is presented once from Django-owned data", () => {
  assert.match(appShell, /<SubscriptionWelcomeCard userId=\{user\.id\} language=\{lang\}/);
  assert.match(api, /export interface SubscriptionWelcomeNotice/);
  assert.match(
    api,
    /getSubscriptionWelcome[\s\S]*?freshRequest\([\s\S]*?\/api\/reaigen\/billing\/subscription-welcome\//,
  );
  assert.match(
    api,
    /acknowledgeSubscriptionWelcome[\s\S]*?method: "POST"[\s\S]*?notice_id: noticeId/,
  );
  assert.match(subscriptionWelcome, /getSubscriptionWelcome\(language\)/);
  assert.match(subscriptionWelcome, /acknowledgeSubscriptionWelcome\(notice\.id\)/);
  assert.match(subscriptionWelcome, /notice\.title/);
  assert.match(subscriptionWelcome, /notice\.section_title/);
  assert.match(subscriptionWelcome, /notice\.items\.map/);
  assert.match(subscriptionWelcome, /notice\.action_label/);
  assert.match(upgrade, /requestSubscriptionWelcomeRefresh\(\)/);
  assert.doesNotMatch(subscriptionWelcome, /localStorage|sessionStorage/);
});

test("the subscription welcome card is calm and owns no commercial copy", () => {
  assert.doesNotMatch(subscriptionWelcome, /\b(?:FREE|STANDARD|PRO|ENTERPRISE)\b/);
  assert.doesNotMatch(subscriptionWelcome, /[€$£]\s*\d|\d\s*[€$£]/);
  assert.doesNotMatch(subscriptionWelcome, /CheckIcon|CheckCircledIcon/);
  assert.doesNotMatch(
    subscriptionWelcome,
    /(?:text|bg|border)-(?:success|green|emerald|lime)/,
  );
  assert.doesNotMatch(
    subscriptionWelcome,
    /Welcome to|What you can do|Start creating|Free|Standard|Enterprise/,
  );
});

test("an empty Drafts page offers the first step this account can take", () => {
  // Bench 06 B06-F04: "Create a listing from the app" with no action at all.
  assert.deepEqual(firstDraftStep({ agentReady: false, agentEntitled: false, webAuthoring: false }), {
    hint: "dashboard.empty.appHint",
    actions: ["plans"],
  });
  assert.deepEqual(firstDraftStep({ agentReady: true, agentEntitled: true, webAuthoring: false }), {
    hint: "dashboard.empty.agentHint",
    actions: ["agent"],
  });
  assert.deepEqual(firstDraftStep({ agentReady: false, agentEntitled: true, webAuthoring: true }).actions, ["agentSettings", "webCreate"]);
  const dashboard = fs.readFileSync(path.join(root, "app/dashboard/page.tsx"), "utf8");
  assert.match(dashboard, /firstStep\.actions\.map\(\(action, index\) => firstStepAction\(action, index === 0\)\)/);
  assert.match(dashboard, /openReaiComposer\(t\("dashboard\.empty\.agentPrompt", lang\)\)/);
});

test("the plan welcome's action leads into creation; closing it only acknowledges", () => {
  // Bench 06 EF07: "Start creating" closed the dialog and left the creator on Settings.
  assert.match(subscriptionWelcome, /onClick=\{\(\) => onAcknowledge\(true\)\}/);
  assert.match(subscriptionWelcome, /if \(start\) onStart\?\.\(\);/);
  assert.match(subscriptionWelcome, /if \(!acknowledging\) onAcknowledge\(\);/);
  assert.match(appShell, /<SubscriptionWelcomeCard userId=\{user\.id\} language=\{lang\} onStart=\{startCreating\} \/>/);
  assert.match(appShell, /const startCreating = React\.useCallback\(\(\) => \{\s*if \(pathname !== "\/dashboard"\) router\.push\("\/dashboard"\);/);
});

test("an unavailable Agent tool names the backend's reason, not always the plan", () => {
  // Bench 06 EF06: on Enterprise, tools no plan includes yet read
  // "not part of your current plan".
  assert.match(settings, /t\(toolBlockerKey\(toolPermissions\.tool_status\?\.\[code\]\?\.blocker\), lang\)/);
  for (const [blocker, key] of [
    ["not_offered", "settings.reai.toolNotOffered"],
    ["early_access", "settings.reai.toolEarlyAccess"],
    ["subscription", "settings.reai.toolSubscription"],
    ["billing_hold", "settings.reai.toolBillingHold"],
    ["reaigen_access", "settings.reai.toolNoAccess"],
  ]) {
    assert.match(settings, new RegExp(`case "${blocker}":\\s*return "${key.replaceAll(".", "\\.")}";`));
  }
  assert.match(api, /blocker: "reaigen_access" \| "tier_feature" \| "not_offered" \| "early_access" \| "subscription" \| "billing_hold" \| "user_policy" \| null;/);
  assert.match(api, /\| "tier_feature"\s*\| "not_offered"\s*\| "early_access"/);
});

test("Agent consent leads with one plain paragraph and keeps the processing details one click away", () => {
  // Bench 06 EF09: providers, redaction, VFX and HDR led the enable decision.
  assert.match(settings, /\{t\("reai\.consentSummary", lang\)\}<\/p>\s*<details/);
  assert.match(settings, /<summary[^>]*>\s*\{t\("reai\.consentDetails", lang\)\}/);
  for (const key of ["reai.consentData", "reai.consentNoData", "reai.consentStorage", "reai.consentMedia"]) {
    assert.match(settings, new RegExp(`<p>\\{t\\("${key.replace(".", "\\.")}", lang\\)\\}</p>`));
  }
});
