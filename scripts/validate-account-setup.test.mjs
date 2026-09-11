import assert from "node:assert/strict";
import test from "node:test";

import {
  computeAccountSetupStatus,
  hasSynchronousSetupGaps,
  isAccountReady,
  shouldPromptAccountSetup,
} from "../app/lib/account-setup.ts";
import { sessionEndReasonFromDetail } from "../app/lib/session-end.ts";

function user(overrides = {}) {
  return {
    id: 1,
    email: "qa@reaigen.test",
    username: "qa",
    first_name: "QA",
    last_name: "Setup",
    full_name: "QA Setup",
    localization: { language: "en" },
    email_verified: true,
    has_password: true,
    has_totp: false,
    social_providers: [],
    phone_verified: true,
    last_login: null,
    date_joined: "2026-09-01T00:00:00Z",
    profile: {
      phone: "+421900123456",
      phone_verified: true,
      bio: "Broker in Bratislava.",
      city: "Bratislava",
      country: "SK",
    },
    billing_account: {
      billing_name: "QA Setup",
      billing_email: "qa@reaigen.test",
      billing_address: "Hlavná 1",
      billing_city: "Bratislava",
      billing_postal_code: "81101",
      billing_country: "SK",
    },
    personalized_data: { onboarding_completed: false, onboarding_skipped: false, onboarding_step: 0 },
    ...overrides,
  };
}

const consented = { consented: true, policy_version: "1", granted_at: null, privacy: {} };
const notConsented = { ...consented, consented: false };
const allTools = { allow_all_tools: true, tools: {} };

test("a fully set-up account has no gaps and never re-prompts", () => {
  const status = computeAccountSetupStatus({ user: user(), consent: consented, toolPermissions: allTools });
  assert.equal(status.complete, true);
  assert.equal(isAccountReady(status), true);
  assert.equal(status.nextStep, null);
  assert.equal(status.completedCount, 4);
  assert.deepEqual(status.blockers, []);
  assert.equal(shouldPromptAccountSetup(status), false);
});

test("a fresh registration opens on the seller step and prompts once", () => {
  const fresh = user({
    phone_verified: false,
    profile: { phone: "", phone_verified: false, bio: "", city: "", country: "" },
    billing_account: { billing_name: "", billing_email: "", billing_address: "", billing_city: "", billing_postal_code: "", billing_country: "" },
  });
  const status = computeAccountSetupStatus({ user: fresh, consent: notConsented });
  assert.equal(status.nextStep, "seller");
  assert.equal(status.completedCount, 1);
  assert.deepEqual(status.steps.find((step) => step.key === "seller").missing, ["phone", "bio", "city", "country"]);
  assert.equal(status.steps.find((step) => step.key === "billing").missing.length, 6);
  assert.deepEqual(status.steps.find((step) => step.key === "permissions").missing, ["agent_consent"]);
  assert.equal(shouldPromptAccountSetup(status), true);
  assert.equal(hasSynchronousSetupGaps(fresh), true);
});

test("a saved but unverified phone is its own gap", () => {
  const unverified = user({ phone_verified: false, profile: { ...user().profile, phone_verified: false } });
  const status = computeAccountSetupStatus({ user: unverified, consent: consented, toolPermissions: allTools });
  assert.deepEqual(status.steps.find((step) => step.key === "seller").missing, ["phone_verified"]);
  // The backend's verdict wins over the profile mirror.
  const verdict = computeAccountSetupStatus({
    user: unverified,
    consent: consented,
    toolPermissions: allTools,
    capabilities: { creator_posting: { phone_verified: true, has_reaigen_access: true, missing_requirements: [] } },
  });
  assert.equal(verdict.steps.find((step) => step.key === "seller").complete, true);
});

test("consent without any enabled tool is not finished", () => {
  const status = computeAccountSetupStatus({
    user: user(),
    consent: consented,
    toolPermissions: { allow_all_tools: false, tools: { image: false, translation: false } },
  });
  assert.deepEqual(status.steps.find((step) => step.key === "permissions").missing, ["agent_tools"]);
});

test("skipped or completed onboarding stops the sign-in prompt but keeps the reminder", () => {
  const skipped = user({
    personalized_data: { onboarding_completed: false, onboarding_skipped: true, onboarding_step: 2 },
    billing_account: null,
  });
  const status = computeAccountSetupStatus({ user: skipped, consent: consented, toolPermissions: allTools });
  assert.equal(status.complete, false);
  assert.equal(shouldPromptAccountSetup(status), false);
  // The permissions gap alone is not known from the profile payload.
  assert.equal(hasSynchronousSetupGaps(user()), false);
});

test("the backend's refusals surface as blockers, not as form gaps", () => {
  const blocked = computeAccountSetupStatus({ user: user({ email_verified: false }), consent: "blocked" });
  assert.deepEqual(blocked.blockers, ["email_verified", "reaigen_access"]);
  const disabled = computeAccountSetupStatus({
    user: user(),
    consent: null,
    capabilities: { creator_posting: { phone_verified: true, has_reaigen_access: false, missing_requirements: ["account_disabled"] } },
  });
  assert.deepEqual(disabled.blockers, ["account_disabled"]);
  const accessBlockedAfterSetup = computeAccountSetupStatus({
    user: user(),
    consent: consented,
    toolPermissions: allTools,
    capabilities: { creator_posting: { phone_verified: true, has_reaigen_access: false, missing_requirements: [] } },
  });
  assert.equal(accessBlockedAfterSetup.complete, true);
  assert.equal(isAccountReady(accessBlockedAfterSetup), false);
});

test("a refused session renewal maps to a reason the sign-in screen can explain", () => {
  assert.equal(sessionEndReasonFromDetail("Email verification required before using this account."), "email_verification");
  assert.equal(sessionEndReasonFromDetail("User account is disabled."), "account_disabled");
  assert.equal(sessionEndReasonFromDetail("User account has been deleted."), "account_disabled");
  assert.equal(sessionEndReasonFromDetail("Token is invalid, expired, or has already been revoked."), "expired");
  assert.equal(sessionEndReasonFromDetail(undefined), "expired");
});
