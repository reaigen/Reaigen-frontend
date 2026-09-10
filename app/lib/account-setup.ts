import type { ReaiAgentConsent, ReaiToolPermissions, UserCapabilities, UserProfile } from "./api/client";

/**
 * Account setup — what a signed-in creator still has to fill in before the
 * workspace is genuinely usable, computed from the same records the backend
 * authorises against.
 *
 * The backend owns the hard rules (`/users/permissions/` → `creator_posting`:
 * verified email, verified phone, first/last name, bio, Reaigen access), and
 * `PersonalizedData.onboarding_*` remembers whether the guided flow was
 * finished or skipped. This module only folds those into four steps the
 * guided flow and the dashboard reminder can render; nothing here grants
 * anything.
 */

export type SetupStepKey = "profile" | "seller" | "billing" | "permissions";

/** Field-level gaps, keyed for i18n (`setup.missing.<key>`). */
export type SetupMissingKey =
  | "first_name"
  | "last_name"
  | "username"
  | "phone"
  | "phone_verified"
  | "bio"
  | "city"
  | "country"
  | "billing_name"
  | "billing_email"
  | "billing_address"
  | "billing_city"
  | "billing_postal_code"
  | "billing_country"
  | "agent_consent"
  | "agent_tools";

/**
 * Reasons the backend refuses the account outright. The guided flow can only
 * explain these — verification is the user's, access and entitlement are an
 * administrator's.
 */
export type SetupBlockerKey = "email_verified" | "reaigen_access" | "account_disabled";

export interface SetupStep {
  key: SetupStepKey;
  complete: boolean;
  missing: SetupMissingKey[];
}

export interface AccountSetupStatus {
  steps: SetupStep[];
  /** Every step complete. */
  complete: boolean;
  /** The first incomplete step, where the guided flow opens. */
  nextStep: SetupStepKey | null;
  completedCount: number;
  blockers: SetupBlockerKey[];
  /** The guided flow was finished or dismissed before (backend flag). */
  onboardingCompleted: boolean;
  onboardingSkipped: boolean;
}

export interface AccountSetupInput {
  user: UserProfile;
  /** `null` while unknown; `"blocked"` when the endpoint refused the account. */
  consent: ReaiAgentConsent | "blocked" | null;
  toolPermissions?: ReaiToolPermissions | null;
  capabilities?: UserCapabilities | null;
}

const STEP_ORDER: SetupStepKey[] = ["profile", "seller", "billing", "permissions"];

function filled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function computeAccountSetupStatus(input: AccountSetupInput): AccountSetupStatus {
  const { user, consent, toolPermissions, capabilities } = input;
  const profile = user.profile;
  const billing = user.billing_account;
  const posting = capabilities?.creator_posting;

  const profileMissing: SetupMissingKey[] = [];
  if (!filled(user.first_name)) profileMissing.push("first_name");
  if (!filled(user.last_name)) profileMissing.push("last_name");
  if (!filled(user.username)) profileMissing.push("username");

  const sellerMissing: SetupMissingKey[] = [];
  const phonePresent = filled(profile?.phone);
  if (!phonePresent) sellerMissing.push("phone");
  // Verification is reported three ways (backend verdict, account flag,
  // profile mirror) and refreshes at different moments; any of them saying
  // "verified" for the saved number is enough.
  const phoneVerified = phonePresent && Boolean(posting?.phone_verified || user.phone_verified || profile?.phone_verified);
  if (phonePresent && !phoneVerified) sellerMissing.push("phone_verified");
  if (!filled(profile?.bio)) sellerMissing.push("bio");
  if (!filled(profile?.city)) sellerMissing.push("city");
  if (!filled(profile?.country)) sellerMissing.push("country");

  const billingMissing: SetupMissingKey[] = [];
  if (!filled(billing?.billing_name)) billingMissing.push("billing_name");
  if (!filled(billing?.billing_email)) billingMissing.push("billing_email");
  if (!filled(billing?.billing_address)) billingMissing.push("billing_address");
  if (!filled(billing?.billing_city)) billingMissing.push("billing_city");
  if (!filled(billing?.billing_postal_code)) billingMissing.push("billing_postal_code");
  if (!filled(billing?.billing_country)) billingMissing.push("billing_country");

  const permissionsMissing: SetupMissingKey[] = [];
  const consented = consent !== null && consent !== "blocked" && consent.consented;
  if (!consented) permissionsMissing.push("agent_consent");
  if (consented && toolPermissions) {
    const anyTool = toolPermissions.allow_all_tools || Object.values(toolPermissions.tools).some(Boolean);
    if (!anyTool) permissionsMissing.push("agent_tools");
  }

  const blockers: SetupBlockerKey[] = [];
  if (!user.email_verified) blockers.push("email_verified");
  if (posting) {
    if (posting.missing_requirements.includes("account_disabled")) blockers.push("account_disabled");
    else if (!posting.has_reaigen_access) blockers.push("reaigen_access");
  } else if (consent === "blocked") {
    blockers.push("reaigen_access");
  }

  const byKey: Record<SetupStepKey, SetupMissingKey[]> = {
    profile: profileMissing,
    seller: sellerMissing,
    billing: billingMissing,
    permissions: permissionsMissing,
  };
  const steps = STEP_ORDER.map((key) => ({ key, missing: byKey[key], complete: byKey[key].length === 0 }));
  const nextStep = steps.find((step) => !step.complete)?.key ?? null;
  const completedCount = steps.filter((step) => step.complete).length;

  return {
    steps,
    complete: nextStep === null,
    nextStep,
    completedCount,
    blockers,
    onboardingCompleted: Boolean(user.personalized_data?.onboarding_completed),
    onboardingSkipped: Boolean(user.personalized_data?.onboarding_skipped),
  };
}

/**
 * Steps that can be judged from the profile payload alone. The dashboard uses
 * this to show its reminder on the first frame, before the Agent consent
 * request has answered, so the list below it does not shift.
 */
export function hasSynchronousSetupGaps(user: UserProfile): boolean {
  const status = computeAccountSetupStatus({ user, consent: null });
  return status.steps.some((step) => step.key !== "permissions" && !step.complete);
}

/**
 * Whether sign-in should open the guided flow. Finished or dismissed flows
 * never re-prompt; the dashboard reminder covers the leftover gaps.
 */
export function shouldPromptAccountSetup(status: AccountSetupStatus): boolean {
  return !status.complete && !status.onboardingCompleted && !status.onboardingSkipped;
}
