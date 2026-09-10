"use client";

// Dev QA fixture: the guided account setup and the dashboard reminder with a
// known, incomplete account — used by the UI smoke suite, which answers the
// profile, seller, billing and Agent endpoints itself and checks that each
// step saves, advances, and reports progress.

import { notFound, useSearchParams } from "next/navigation";
import * as React from "react";
import { AccountSetupFlow, AccountSetupReminder } from "../../components/account-setup-flow";
import { useAccountSetup } from "../../components/hooks/use-account-setup";
import { getProfile, type UserProfile } from "../../lib/api/client";

const BASE_USER = {
  id: 7,
  email: "qa.setup@reaigen.test",
  username: "qa_setup",
  first_name: "QA",
  last_name: "Setup",
  full_name: "QA Setup",
  localization: { language: "en" },
  email_verified: true,
  has_password: true,
  has_totp: false,
  social_providers: [],
  phone_verified: false,
  last_login: null,
  date_joined: "2026-09-01T00:00:00Z",
  gdpr: { has_given_consent: true, consent_date: null, consent_version: "1", marketing_consent: false, data_processing_consent: true },
  profile: null,
  personalized_data: { onboarding_completed: false, onboarding_skipped: false, onboarding_step: 0, preferences: {} },
  billing_account: {
    id: 1,
    subscription_tier_detail: { code: "FREE", name: "Free", max_posts: 3, max_storage_gb: 0, can_use_ai_processing: false, can_use_3d_processing: false },
    subscription_status: "active",
    billing_cycle: "monthly",
    is_trial: false,
    is_active: true,
    has_reached_post_limit: false,
    has_reached_storage_limit: false,
    days_until_expiry: null,
    current_storage_gb: "0",
    current_posts_count: 0,
    payment_provider: "",
    billing_name: "",
    billing_email: "",
    billing_address: "",
    billing_city: "",
    billing_postal_code: "",
    billing_country: "",
    vat_number: "",
  },
} as unknown as UserProfile;

function ReminderFixture({ user }: { user: UserProfile }) {
  const { status } = useAccountSetup(user);
  return <AccountSetupReminder user={user} lang="en" status={status} />;
}

function AccountSetupFixtureBody() {
  const params = useSearchParams();
  const [user, setUser] = React.useState<UserProfile>(BASE_USER);
  // The suite serves /users/me/ with whatever the steps saved so far.
  const onSaved = React.useCallback(async () => {
    const next = await getProfile();
    setUser(next);
    return next;
  }, []);
  if (params.get("reminder") === "1") return <div className="p-10"><ReminderFixture user={user} /></div>;
  return (
    <div className="p-6 sm:p-10">
      <AccountSetupFlow user={user} lang="en" onSaved={onSaved} />
    </div>
  );
}

export default function AccountSetupFixture() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <React.Suspense fallback={null}>
      <AccountSetupFixtureBody />
    </React.Suspense>
  );
}
