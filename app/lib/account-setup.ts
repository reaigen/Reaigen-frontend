import type { ReaiAgentConsent, ReaiToolPermissions, UserCapabilities, UserProfile } from "./api/client";

/**
 * Account setup — what a signed-in creator still has to fill in before the
 * workspace is genuinely usable, computed from the same records the backend
 * authorises against.
 *
 * The backend owns the hard rules (`/users/permissions/` → `creator_posting`:
 * verified email, verified phone, Django-declared seller fields, Reaigen access), and
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
  /** True only when Django explicitly grants the optional Agent product. */
  agentEntitled: boolean;
}

export interface AccountSetupInput {
  user: UserProfile;
  /** `null` while unknown; `"blocked"` when the endpoint refused the account. */
  consent: ReaiAgentConsent | "blocked" | null;
  toolPermissions?: ReaiToolPermissions | null;
  capabilities?: UserCapabilities | null;
}

/**
 * Completing the four editable sections does not override a backend refusal.
 * Keep this distinction explicit anywhere the UI says an account is ready.
 */
export function isAccountReady(status: AccountSetupStatus | null | undefined): boolean {
  return Boolean(status?.complete && status.blockers.length === 0);
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
  const serverMissingFields = new Set(posting?.seller_profile_missing_fields ?? []);
  const serverRequiredFields = Array.isArray(posting?.seller_profile_required_fields)
    ? new Set(posting.seller_profile_required_fields)
    : null;
  const serverMarksMissing = (field: "first_name" | "last_name" | "bio") => (
    serverMissingFields.has(field)
    && (serverRequiredFields === null || serverRequiredFields.has(field))
  );

  const profileMissing: SetupMissingKey[] = [];
  if (posting ? serverMarksMissing("first_name") : !filled(user.first_name)) profileMissing.push("first_name");
  if (posting ? serverMarksMissing("last_name") : !filled(user.last_name)) profileMissing.push("last_name");
  if (!filled(user.username)) profileMissing.push("username");

  const sellerMissing: SetupMissingKey[] = [];
  const phonePresent = posting?.phone_present ?? filled(profile?.phone);
  if (!phonePresent) sellerMissing.push("phone");
  // Once loaded, Django's verdict is authoritative. Profile mirrors are only
  // a bootstrap fallback while capabilities are not available yet.
  const phoneVerified = phonePresent && (
    posting?.phone_verified ?? Boolean(user.phone_verified || profile?.phone_verified)
  );
  if (phonePresent && !phoneVerified) sellerMissing.push("phone_verified");
  if (posting ? serverMarksMissing("bio") : !filled(profile?.bio)) sellerMissing.push("bio");

  const billingMissing: SetupMissingKey[] = [];
  if (!filled(billing?.billing_name)) billingMissing.push("billing_name");
  if (!filled(billing?.billing_email)) billingMissing.push("billing_email");
  if (!filled(billing?.billing_address)) billingMissing.push("billing_address");
  if (!filled(billing?.billing_city)) billingMissing.push("billing_city");
  if (!filled(billing?.billing_postal_code)) billingMissing.push("billing_postal_code");
  if (!filled(billing?.billing_country)) billingMissing.push("billing_country");

  const permissionsMissing: SetupMissingKey[] = [];
  // Agent is optional and must stay undiscoverable unless Django explicitly
  // grants both the product and feature capabilities. Unknown fails closed.
  const agentEntitled = capabilities?.apps?.reaigen === true
    && capabilities.features?.agent_access === true;
  const consented = consent !== null && consent !== "blocked" && consent.consented;
  if (agentEntitled && !consented) permissionsMissing.push("agent_consent");
  if (agentEntitled && consented && toolPermissions) {
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
    agentEntitled,
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
 * Whether any automatic surface should open or advertise the guided flow.
 * Finished or deliberately dismissed flows never re-prompt; their fields
 * remain editable in the ordinary Settings sections.
 */
export function shouldPromptAccountSetup(status: AccountSetupStatus): boolean {
  return !status.complete && !status.onboardingCompleted && !status.onboardingSkipped;
}

/**
 * Whether the dashboard's quiet setup reminder shows. Unlike the automatic
 * prompts it survives Skip and a "Finish setup" with open steps: it is the
 * route back the done screen promises, and it goes once every step is done.
 */
export function shouldShowSetupReminder(status: AccountSetupStatus | null): status is AccountSetupStatus {
  return status !== null && !status.complete;
}
