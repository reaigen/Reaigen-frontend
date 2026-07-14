export class ApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`API Error ${status}`);
    this.status = status;
    this.body = body;
  }
}

// ─── In-memory GET cache + request deduplication ─────────────────────────

const inFlight = new Map<string, Promise<unknown>>();
const cache = new Map<string, { data: unknown; ts: number }>();

const CACHE_TTL = 30_000; // 30s default
const LONG_TTL = 300_000; // 5 min — profile / localization / preferences
const CONTENT_TTL = 600_000; // 10 min — legal / content documents

function ttlForPath(path: string): number {
  if (path.startsWith("/api/reaigen/users/") || path.startsWith("/api/reaigen/profiles/") || path.startsWith("/api/reaigen/personalized-data/") || path.startsWith("/api/reaigen/billing/")) return LONG_TTL;
  if (path.startsWith("/api/reaigen/content/")) return CONTENT_TTL;
  return CACHE_TTL;
}

/** Invalidate cache entries whose key starts with any of the given prefixes. */
function invalidateCache(path: string) {
  // Derive prefix: e.g. "/api/reaigen/users/me/" → "/api/reaigen/users/"
  const segments = path.split("/").slice(0, -1); // drop last segment
  const prefix = segments.length > 3 ? segments.slice(0, -1).join("/") + "/" : path;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

async function request(path: string, options: RequestInit = {}) {
  const isGet = !options.method || options.method === "GET";

  // GET deduplication + caching
  if (isGet) {
    const cached = cache.get(path);
    if (cached && Date.now() - cached.ts < ttlForPath(path)) {
      return cached.data;
    }

    const existing = inFlight.get(path);
    if (existing) return existing;

    const promise = (async () => {
      const res = await fetch(path, {
        ...options,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...options.headers },
      });
      if (!res.ok) {
        const body = await res.text();
        // 401 = session expired — flush entire cache so re-auth gets fresh data
        if (res.status === 401) cache.clear();
        throw new ApiError(res.status, body);
      }
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      cache.set(path, { data, ts: Date.now() });
      return data;
    })();

    inFlight.set(path, promise);
    promise.catch(() => {}).finally(() => inFlight.delete(path));
    return promise;
  }

  // Non-GET: invalidate related cache entries
  invalidateCache(path);

  const res = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    cache: "no-store" as const,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, body);
  }

  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

/** Abortable request — same as request() but respects AbortSignal. */
async function abortableRequest(path: string, signal?: AbortSignal) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    signal,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, body);
  }
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

// ─── Auth ─────────────────────────────────────────────────────────────────

export async function login(email: string, password: string) {
  return request("/api/auth/login/", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function register(data: {
  email: string;
  username: string;
  password: string;
  password_confirm: string;
  first_name?: string;
  last_name?: string;
  accept_privacy_policy: boolean;
  accept_terms: boolean;
}) {
  return request("/api/auth/register/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function logout() {
  return request("/api/auth/logout", { method: "POST" });
}

export async function requestPasswordReset(email: string) {
  return request("/api/auth/password-reset/request/", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

// ─── Types (matches Django UserDetailSerializer) ──────────────────────────

export interface UserLocalization {
  currency: string;
  area_unit: string;
  distance_unit: string;
  language: string;
  timezone: string;
  address_format: string | null;
  date_format: string | null;
}

export interface UserProfileData {
  id: number;
  full_name: string;
  display_name: string;
  first_name: string;
  last_name: string;
  phone: string;
  company: string;
  website: string;
  bio: string;
  phone_verified: boolean;
  phone_verified_at: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
  avatar_thumbnail_url: string | null;
  address: string;
  city: string;
  state: string;
  country: string;
  postal_code: string;
  job_title: string;
  linkedin_url: string;
  twitter_handle: string;
  instagram_handle: string;
  is_real_estate_professional: boolean;
  license_number: string;
  agency_name: string;
  is_public: boolean;
  show_email: boolean;
  show_phone: boolean;
  allow_contact: boolean;
  portfolio_slug: string | null;
  portfolio_visibility: string;
  portfolio_title: string;
  portfolio_headline: string;
  created_at: string;
  updated_at: string;
}

export interface PersonalizedData {
  id: number;
  theme: string;
  notifications_enabled: boolean;
  email_notifications: boolean;
  push_notifications: boolean;
  sms_notifications: boolean;
  notify_new_features: boolean;
  notify_system_updates: boolean;
  notify_billing: boolean;
  notify_processing_complete: boolean;
  notify_processing_failed: boolean;
  onboarding_completed: boolean;
  onboarding_step: number;
}

export interface BillingAccount {
  id: number;
  subscription_tier_detail: {
    code: string;
    name: string;
    max_posts: number;
    max_storage_gb: number;
    can_use_ai_processing: boolean;
    can_use_3d_processing: boolean;
  } | null;
  subscription_status: string;
  billing_cycle: string;
  is_trial: boolean;
  is_active: boolean;
  has_reached_post_limit: boolean;
  has_reached_storage_limit: boolean;
  days_until_expiry: number | null;
  current_storage_gb: string;
  current_posts_count: number;
  payment_provider: string;
  billing_name: string;
  billing_email: string;
  billing_address: string;
  billing_city: string;
  billing_postal_code: string;
  billing_country: string;
  vat_number: string;
}

export interface UserProfile {
  id: number;
  email: string;
  username: string;
  first_name: string;
  last_name: string;
  full_name: string;
  localization: UserLocalization;
  email_verified: boolean;
  has_password: boolean;
  has_totp: boolean;
  social_providers: string[];
  phone_verified: boolean;
  last_login: string | null;
  date_joined: string;
  gdpr?: {
    has_given_consent: boolean;
    consent_date: string | null;
    consent_version: string;
    marketing_consent: boolean;
    data_processing_consent: boolean;
  };
  profile: UserProfileData | null;
  personalized_data: PersonalizedData | null;
  billing_account: BillingAccount | null;
}

// ─── API calls ────────────────────────────────────────────────────────────

export async function getProfile(): Promise<UserProfile> {
  return request("/api/reaigen/users/me/");
}

export async function updateProfile(data: Partial<{
  first_name: string;
  last_name: string;
  username: string;
}>) {
  return request("/api/reaigen/users/me/", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function updateSellerProfile(data: Partial<{
  phone: string;
  company: string;
  website: string;
  bio: string;
  job_title: string;
  linkedin_url: string;
  twitter_handle: string;
  instagram_handle: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postal_code: string;
  is_real_estate_professional: boolean;
  license_number: string;
  agency_name: string;
  is_public: boolean;
  show_email: boolean;
  show_phone: boolean;
  allow_contact: boolean;
  portfolio_visibility: string;
  portfolio_slug: string;
  portfolio_title: string;
  portfolio_headline: string;
}>): Promise<UserProfileData> {
  return request("/api/reaigen/profiles/me/", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function getPersonalizedData(): Promise<PersonalizedData> {
  return request("/api/reaigen/personalized-data/me/");
}

export async function updatePersonalizedData(data: Partial<{
  theme: string;
  notifications_enabled: boolean;
  email_notifications: boolean;
  push_notifications: boolean;
  sms_notifications: boolean;
  notify_new_features: boolean;
  notify_system_updates: boolean;
  notify_billing: boolean;
  notify_processing_complete: boolean;
  notify_processing_failed: boolean;
}>): Promise<PersonalizedData> {
  return request("/api/reaigen/personalized-data/me/", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function getBilling(): Promise<BillingAccount> {
  return request("/api/reaigen/billing/me/");
}

export async function updateBilling(data: Partial<{
  billing_name: string;
  billing_email: string;
  billing_address: string;
  billing_city: string;
  billing_postal_code: string;
  billing_country: string;
  vat_number: string;
}>): Promise<BillingAccount> {
  return request("/api/reaigen/billing/me/", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function updateLocalization(data: Partial<{
  preferred_language: string;
  preferred_currency: string;
  preferred_area_unit: string;
  preferred_distance_unit: string;
  preferred_timezone: string;
  preferred_address_format_code: string;
  preferred_date_format_code: string;
}>) {
  return request("/api/reaigen/users/update_localization/", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export interface PreferenceOption {
  code: string;
  name: string;
  symbol?: string;
}

export interface GroupedUnits {
  METRIC: PreferenceOption[];
  IMPERIAL: PreferenceOption[];
}

export interface AvailablePreferences {
  languages: PreferenceOption[];
  currencies: PreferenceOption[];
  area_units: GroupedUnits;
  distance_units: GroupedUnits;
  address_formats: { code: string; name: string; description?: string }[];
  date_formats: { code: string; name: string; description?: string }[];
  countries: { code: string; name: string; currency: string; area_unit: string; distance_unit: string }[];
  timezones: PreferenceOption[];
}

export async function getAvailablePreferences(): Promise<AvailablePreferences> {
  return request("/api/reaigen/users/available_preferences/");
}

export async function changePassword(data: {
  current_password: string;
  new_password: string;
}) {
  return request("/api/auth/change-password/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ─── TOTP / 2FA ──────────────────────────────────────────────────────────

export interface TotpStatus {
  enabled: boolean;
  pending_setup: boolean;
  name: string;
  last_used_at: string | null;
  backup_codes_remaining: number;
}

export interface TotpSetupResponse {
  secret: string;
  provisioning_uri: string;
}

export async function getTotpStatus(): Promise<TotpStatus> {
  return request("/api/auth/totp/status/");
}

export async function setupTotp(): Promise<TotpSetupResponse> {
  return request("/api/auth/totp/setup/", { method: "POST" });
}

export async function confirmTotp(code: string): Promise<{ backup_codes?: string[] }> {
  return request("/api/auth/totp/confirm/", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function disableTotp(code: string) {
  return request("/api/auth/totp/disable/", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

// ─── Social / Linked Accounts ────────────────────────────────────────────

export interface SocialAccount {
  id: number;
  provider: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface LinkedAccountsResponse {
  social_accounts: SocialAccount[];
  phone: string | null;
  has_password: boolean;
}

export async function getLinkedAccounts(): Promise<LinkedAccountsResponse> {
  return request("/api/auth/linked-accounts/");
}

export async function unlinkSocialAccount(provider: string) {
  return request(`/api/auth/unlink/social/${encodeURIComponent(provider)}/`, {
    method: "DELETE",
  });
}

// ─── Email Verification ──────────────────────────────────────────────────

export async function resendVerification(email: string) {
  return request("/api/auth/resend-verification/", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

// ─── Phone Linking ───────────────────────────────────────────────────────

export async function requestPhoneLinkOtp(phone: string) {
  return request("/api/auth/link/phone/request-otp/", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export async function verifyPhoneLinkOtp(data: { phone: string; code: string }) {
  return request("/api/auth/link/phone/verify-otp/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ─── Profile Images ──────────────────────────────────────────────────────

export interface PresignResponse {
  upload_key: string;
  presigned_url: string;
  expires_in: number;
}

export async function presignAvatar(data: { filename: string; content_type: string }): Promise<PresignResponse> {
  return request("/api/reaigen/profiles/presign-avatar/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function confirmAvatar(key: string) {
  return request("/api/reaigen/profiles/confirm-avatar/", {
    method: "POST",
    body: JSON.stringify({ upload_key: key }),
  });
}

export async function presignCover(data: { filename: string; content_type: string }): Promise<PresignResponse> {
  return request("/api/reaigen/profiles/presign-cover/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function confirmCover(key: string) {
  return request("/api/reaigen/profiles/confirm-cover/", {
    method: "POST",
    body: JSON.stringify({ upload_key: key }),
  });
}

// ─── App Content / Legal Documents ───────────────────────────────────────

export type AppContentDocumentType = "terms" | "privacy" | "gdpr" | "license" | "message" | "text" | "cookie";
export type AppContentPlatform = "all" | "web" | "ios" | "android";
export type AppContentScope = "all" | "reaigen" | "reailist";
export type AppContentAudience = "all" | "guest" | "authenticated" | "creator" | "admin";
export type AppContentBodyFormat = "markdown" | "plain" | "html";

export interface AppContentDocument {
  id: number;
  key: string;
  document_type: AppContentDocumentType;
  document_type_display: string;
  app_scope: AppContentScope;
  app_scope_display: string;
  platform: AppContentPlatform;
  platform_display: string;
  audience: AppContentAudience;
  audience_display: string;
  language: string;
  country_code: string;
  region_code: string;
  version: string;
  title: string;
  summary: string;
  body: string;
  body_format: AppContentBodyFormat;
  requires_acceptance: boolean;
  is_effective: boolean;
  sort_order: number;
  effective_from: string;
  expires_at: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
}

export interface UserContentAcceptance {
  id: number;
  document: number;
  key: string;
  document_type: string;
  app_scope: string;
  platform: string;
  language: string;
  country_code: string;
  region_code: string;
  version: string;
  accepted_at: string;
  metadata: Record<string, unknown>;
}

type AppContentQuery = Partial<{
  keys: string[];
  document_type: AppContentDocumentType;
  language: string;
  country_code: string;
  region_code: string;
  platform: AppContentPlatform;
  app_scope: AppContentScope;
  audience: AppContentAudience;
}>;

function appContentQuery(params: AppContentQuery = {}) {
  const qs = new URLSearchParams();
  if (params.keys?.length) qs.set("keys", params.keys.join(","));
  if (params.document_type) qs.set("document_type", params.document_type);
  if (params.language) qs.set("language", params.language);
  if (params.country_code) qs.set("country_code", params.country_code);
  if (params.region_code) qs.set("region_code", params.region_code);
  if (params.platform) qs.set("platform", params.platform);
  if (params.app_scope) qs.set("app_scope", params.app_scope);
  if (params.audience) qs.set("audience", params.audience);
  const query = qs.toString();
  return query ? `?${query}` : "";
}

export async function listAppContentDocuments(params: AppContentQuery = {}): Promise<AppContentDocument[]> {
  return request(`/api/reaigen/content/documents/${appContentQuery(params)}`);
}

export async function getAppContentDocument(
  key: string,
  params: Omit<AppContentQuery, "keys"> & { version?: string } = {},
): Promise<AppContentDocument> {
  const qs = new URLSearchParams();
  if (params.document_type) qs.set("document_type", params.document_type);
  if (params.language) qs.set("language", params.language);
  if (params.country_code) qs.set("country_code", params.country_code);
  if (params.region_code) qs.set("region_code", params.region_code);
  if (params.platform) qs.set("platform", params.platform);
  if (params.app_scope) qs.set("app_scope", params.app_scope);
  if (params.audience) qs.set("audience", params.audience);
  if (params.version) qs.set("version", params.version);
  const query = qs.toString();
  return request(`/api/reaigen/content/documents/${encodeURIComponent(key)}/${query ? `?${query}` : ""}`);
}

export async function acceptAppContentDocument(data: {
  document_id?: number;
  key?: string;
  version?: string;
  language?: string;
  country_code?: string;
  region_code?: string;
  platform?: AppContentPlatform;
  app_scope?: AppContentScope;
  accepted?: boolean;
  marketing_consent?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<UserContentAcceptance> {
  return request("/api/reaigen/content/documents/accept/", {
    method: "POST",
    body: JSON.stringify({ accepted: true, ...data }),
  });
}

// ─── Splat Viewer & Tour ──────────────────────────────────────────────────

import type { SplatViewerPayload, CameraData, TourViewerData, SplatListItem, ShareData, SharedDraftData, SplatsByDraftPayload, DraftListingItem, DraftDetailItem } from "../tour-types";

export async function listSplats(page = 1, pageSize = 20, search = ""): Promise<{ results: SplatListItem[]; count: number; next: string | null }> {
  const q = search ? `&search=${encodeURIComponent(search)}` : "";
  return request(`/api/reaigen/splats/?page=${page}&page_size=${pageSize}${q}`);
}

export async function listDrafts(page = 1, pageSize = 100, search = ""): Promise<{ results: DraftListingItem[]; count: number; next: string | null }> {
  const q = search ? `&search=${encodeURIComponent(search)}` : "";
  return request(`/api/reaigen/drafts/?page=${page}&page_size=${pageSize}${q}`);
}

export async function getDraft(draftId: number): Promise<DraftDetailItem> {
  return request(`/api/reaigen/drafts/${draftId}/`);
}

export interface ReaiAgentConsent {
  consented: boolean;
  policy_version: string;
  granted_at: string | null;
  privacy: {
    purpose: string;
    sent_to_model: string;
    never_sent: string[];
    conversation_storage: boolean | string;
    model_hosting: string;
    media_processing: string;
  };
}

export interface ReaiAgentResponse {
  reply: string;
  execution_mode?: "deterministic" | "fast" | "standard" | "reasoning";
  reasoning_effort?: "none" | "minimal" | "low" | "high";
  latency_ms?: number;
  proposed_changes: Record<string, unknown>;
  suggested_actions: string[];
  proposal_token: string | null;
  action_code?: "revoke_all_shares" | "create_draft_share";
  action_token?: string | null;
  action_count?: number;
  share_id?: number | null;
  share_url?: string | null;
  operation?: "none" | "list" | "compare" | "bulk_edit";
  search_query?: string | null;
  matched_creation_count?: number;
  selected_creation_ids?: number[];
  draft_results?: Array<{
    id: number;
    is_complete: boolean;
    updated_at: string | null;
    semantic_summary?: string;
    creation_data: {
      title?: string;
      description?: string;
      price?: string | number;
      currency?: string;
      area?: string | number;
      area_unit?: string;
      [key: string]: unknown;
    };
  }>;
  improvement_conversation_id?: string | null;
  knowledge_sources?: Array<{
    title: string;
    source: string;
    version: string;
    sha256: string;
  }>;
  privacy?: {
    stored: boolean;
    training: boolean;
    inference_gateway: string;
    zero_data_retention: boolean;
    provider_data_collection: string;
    model: string;
    prompt_version: string;
  };
}

export type ReaiToolCode =
  | "creation_search"
  | "creation_compare"
  | "creation_edit"
  | "bulk_edit"
  | "floorplan"
  | "image"
  | "sharing";

export interface ReaiToolPermissions {
  allow_all_tools: boolean;
  tools: Record<ReaiToolCode, boolean>;
  overrides: Record<ReaiToolCode, boolean>;
  available_tools: ReaiToolCode[];
  confirmation_required_for_writes: true;
  updated_at: string;
}

export interface ReaiImprovementConsent {
  consented: boolean;
  policy_version: string;
  granted_at: string | null;
  retention_days: number;
  optional: true;
  stored: string[];
  never_stored: string[];
  automatic_training: false;
  erased?: boolean;
}

export interface AgentCreationRevision {
  id: number;
  sequence: number;
  source: "initial" | "checkpoint" | "agent_edit" | "restore";
  changed_fields: string[];
  before_values: Record<string, unknown>;
  after_values: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  created_at: string;
  restored_from_id: number | null;
}

export async function getReaiAgentConsent(): Promise<ReaiAgentConsent> {
  return request("/api/reaigen/reai-agent/consent/");
}

export async function grantReaiAgentConsent(policyVersion: string): Promise<ReaiAgentConsent> {
  return request("/api/reaigen/reai-agent/consent/", {
    method: "POST",
    body: JSON.stringify({ accepted: true, policy_version: policyVersion }),
  });
}

export async function revokeReaiAgentConsent(): Promise<ReaiAgentConsent> {
  return request("/api/reaigen/reai-agent/consent/", { method: "DELETE" });
}

export async function getReaiToolPermissions(): Promise<ReaiToolPermissions> {
  return request("/api/reaigen/reai-agent/tool-permissions/");
}

export async function updateReaiToolPermissions(payload: {
  allow_all_tools?: boolean;
  tools?: Partial<Record<ReaiToolCode, boolean>>;
}): Promise<ReaiToolPermissions> {
  return request("/api/reaigen/reai-agent/tool-permissions/", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function getReaiImprovementConsent(): Promise<ReaiImprovementConsent> {
  return request("/api/reaigen/reai-agent/improvement-consent/");
}

export async function grantReaiImprovementConsent(policyVersion: string): Promise<ReaiImprovementConsent> {
  return request("/api/reaigen/reai-agent/improvement-consent/", {
    method: "POST",
    body: JSON.stringify({ accepted: true, policy_version: policyVersion }),
  });
}

export async function revokeReaiImprovementConsent(): Promise<ReaiImprovementConsent> {
  return request("/api/reaigen/reai-agent/improvement-consent/", { method: "DELETE" });
}

export async function askReaiAgent(
  draftId: number,
  message: string,
  conversation: Array<{ role: "user" | "assistant"; content: string }> = [],
  improvementConversationId: string | null = null,
  language?: string,
): Promise<ReaiAgentResponse> {
  return request(`/api/reaigen/reai-agent/drafts/${draftId}/assist/`, {
    method: "POST",
    body: JSON.stringify({ message, conversation: conversation.slice(-4), improvement_conversation_id: improvementConversationId, language }),
  });
}

export async function applyReaiAgentProposal(
  draftId: number,
  proposalToken: string,
  improvementConversationId: string | null = null,
): Promise<{ applied: string[]; draft: DraftDetailItem }> {
  return request(`/api/reaigen/reai-agent/drafts/${draftId}/apply/`, {
    method: "POST",
    body: JSON.stringify({ proposal_token: proposalToken, confirmed: true, improvement_conversation_id: improvementConversationId }),
  });
}

export async function askReaiWorkspace(
  message: string,
  currentDraftId?: number,
  conversation: Array<{ role: "user" | "assistant"; content: string }> = [],
  improvementConversationId: string | null = null,
  language?: string,
): Promise<ReaiAgentResponse> {
  return request("/api/reaigen/reai-agent/workspace/assist/", {
    method: "POST",
    body: JSON.stringify({
      message,
      current_draft_id: currentDraftId,
      conversation: conversation.slice(-4),
      improvement_conversation_id: improvementConversationId,
      language,
    }),
  });
}

export async function applyReaiWorkspaceProposal(
  proposalToken: string,
  currentDraftId?: number,
  improvementConversationId: string | null = null,
): Promise<{ applied: string[]; applied_draft_ids: number[]; current_draft: DraftDetailItem | null }> {
  return request("/api/reaigen/reai-agent/workspace/apply/", {
    method: "POST",
    body: JSON.stringify({
      proposal_token: proposalToken,
      current_draft_id: currentDraftId,
      confirmed: true,
      improvement_conversation_id: improvementConversationId,
    }),
  });
}

export async function applyReaiWorkspaceAction(
  actionToken: string,
  improvementConversationId: string | null = null,
): Promise<
  | { action: "revoke_all_shares"; revoked_count: number; execution_mode: "deterministic" }
  | {
      action: "create_draft_share";
      created: boolean;
      draft_id: number;
      share_id: number;
      share_url: string;
      execution_mode: "deterministic";
    }
> {
  return request("/api/reaigen/reai-agent/workspace/actions/apply/", {
    method: "POST",
    body: JSON.stringify({
      action_token: actionToken,
      confirmed: true,
      improvement_conversation_id: improvementConversationId,
    }),
  });
}

export async function getAgentCreationHistory(
  draftId: number,
): Promise<{ draft_id: number; revisions: AgentCreationRevision[] }> {
  return request(`/api/reaigen/reai-agent/workspace/drafts/${draftId}/history/`);
}

export async function restoreAgentCreationRevision(
  draftId: number,
  revisionId: number,
): Promise<{ restored: boolean; revision_id: number | null; draft: DraftDetailItem }> {
  return request(`/api/reaigen/reai-agent/workspace/drafts/${draftId}/history/${revisionId}/restore/`, {
    method: "POST",
    body: JSON.stringify({ confirmed: true }),
  });
}

export async function saveReaiFeedback(conversationId: string, helpful: boolean): Promise<{ saved: boolean; feedback_id: number }> {
  return request("/api/reaigen/reai-agent/improvement-conversations/", {
    method: "POST",
    body: JSON.stringify({ conversation_id: conversationId, helpful }),
  });
}

export interface FloorplanDetail {
  id: number;
  source_draft: number;
  status: string;
  composite_url: string | null;
  signed_render_passes: Record<string, string> | null;
  signed_outputs: Record<string, string> | null;
  geometry_ready: boolean;
  has_composite: boolean;
  has_render_passes: boolean;
  has_outputs: boolean;
  created_at: string;
  updated_at: string;
}

export async function getFloorplan(floorplanId: number): Promise<FloorplanDetail> {
  return request(`/api/reaigen/floorplans/${floorplanId}/`);
}

// ─── Floorplan Rendering ──────────────────────────────────────────────

export interface GeometryMesh {
  id: string;
  points: number[][];
  faces: number[][];
  hinge_xz?: number[];
}

export interface GeometryLayer {
  available: boolean;
  meshes: GeometryMesh[];
}

export interface FloorplanRoom {
  id: number;
  label: string;
  room_number: number | null;
  center: number[];
  floor_area: number | null;
  boundary_points: number[][];
  room_type_code: string | null;
  label_offset_x: number;
  label_offset_z: number;
}

export interface FloorplanRenderingData {
  composite: { url: string };
  geometry: {
    layers: {
      walls: GeometryLayer;
      doors: GeometryLayer;
      windows: GeometryLayer;
    };
  };
  rooms: FloorplanRoom[];
  passes: {
    passes: Record<string, string>;
  };
}

export async function getFloorplanRendering(floorplanId: number, signal?: AbortSignal): Promise<FloorplanRenderingData> {
  return abortableRequest(`/api/reaigen/floorplans/${floorplanId}/rendering/`, signal);
}

export interface TranslateDescriptionResponse {
  translation?: string;
  lang: string;
  status: "ready" | "pending";
  cached?: boolean;
}

export async function translateDraftDescription(
  draftId: number,
  targetLang?: string,
): Promise<TranslateDescriptionResponse> {
  return request(`/api/reaigen/drafts/${draftId}/translate-description/`, {
    method: "POST",
    body: JSON.stringify(targetLang ? { target_lang: targetLang } : {}),
  });
}

export async function listAllDrafts(): Promise<DraftListingItem[]> {
  const pageSize = 500;
  const first = await listDrafts(1, pageSize);
  const all = [...(first.results ?? [])];
  if (!first.next) return all;
  const totalPages = Math.ceil((first.count ?? all.length) / pageSize);
  const remaining = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, i) => listDrafts(i + 2, pageSize))
  );
  for (const page of remaining) all.push(...(page.results ?? []));
  return all;
}

export async function listAllSplats(): Promise<SplatListItem[]> {
  const pageSize = 500;
  const first = await listSplats(1, pageSize);
  const all = [...(first.results ?? [])];
  if (!first.next) return all;
  const totalPages = Math.ceil((first.count ?? all.length) / pageSize);
  const remaining = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, i) => listSplats(i + 2, pageSize))
  );
  for (const page of remaining) all.push(...(page.results ?? []));
  return all;
}

/** Fast initial loader: fetches first page quickly, loads remaining pages only if needed. */
export async function listSplatsProgressive(onFirst: (splats: SplatListItem[], drafts: DraftListingItem[]) => void): Promise<{ splats: SplatListItem[]; drafts: DraftListingItem[] }> {
  // Small first page for instant UI
  const firstPageSize = 50;
  const [firstSplats, firstDrafts] = await Promise.all([
    listSplats(1, firstPageSize),
    listDrafts(1, firstPageSize),
  ]);
  const splats = [...(firstSplats.results ?? [])];
  const drafts = [...(firstDrafts.results ?? [])];
  onFirst(splats, drafts);
  // Only fetch remaining pages (skip page 1 — already have it)
  const promises: Promise<void>[] = [];
  if (firstSplats.count > firstPageSize) {
    const remainingPages = Math.ceil((firstSplats.count - firstPageSize) / firstPageSize);
    promises.push(
      Promise.all(Array.from({ length: remainingPages }, (_, i) => listSplats(i + 2, firstPageSize)))
        .then((pages) => { for (const p of pages) splats.push(...(p.results ?? [])); })
    );
  }
  if (firstDrafts.count > firstPageSize) {
    const remainingPages = Math.ceil((firstDrafts.count - firstPageSize) / firstPageSize);
    promises.push(
      Promise.all(Array.from({ length: remainingPages }, (_, i) => listDrafts(i + 2, firstPageSize)))
        .then((pages) => { for (const p of pages) drafts.push(...(p.results ?? [])); })
    );
  }
  await Promise.all(promises);
  return { splats, drafts };
}

/** Server-side search — fast, cancellable, no need to load all data first. */
export async function searchSplats(query: string, signal?: AbortSignal): Promise<{ results: SplatListItem[]; count: number; next: string | null }> {
  const q = encodeURIComponent(query);
  return abortableRequest(`/api/reaigen/splats/?page=1&page_size=50&search=${q}`, signal);
}

export async function searchDrafts(query: string, signal?: AbortSignal): Promise<{ results: DraftListingItem[]; count: number; next: string | null }> {
  const q = encodeURIComponent(query);
  return abortableRequest(`/api/reaigen/drafts/?page=1&page_size=50&search=${q}`, signal);
}

export async function getSplatViewer(splatId: number): Promise<SplatViewerPayload> {
  return request(`/api/reaigen/splats/${splatId}/viewer/`);
}

export async function getSplatsByDraft(draftId: number): Promise<SplatsByDraftPayload> {
  return request(`/api/reaigen/splats/by-draft/${draftId}/?all=true`);
}

export async function getCameras(splatId: number): Promise<CameraData> {
  return request(`/api/reaigen/splats/${splatId}/cameras/`);
}

export async function saveCameras(
  splatId: number,
  data: { cameras: { position: number[]; forward: number[]; up: number[]; fov?: number }[]; fovY?: number; sceneFov?: number },
): Promise<CameraData> {
  return request(`/api/reaigen/splats/${splatId}/cameras/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function getSharedTourViewer(token: string): Promise<TourViewerData> {
  return request(`/api/reaigen/shared/${encodeURIComponent(token)}/tour-viewer/`);
}

export async function getSharedDraftData(token: string): Promise<SharedDraftData | null> {
  // Errors propagate so callers can react to gating responses
  // (requires_pin / requires_auth / expired / paused).
  const raw = await request(`/api/reaigen/shared/${encodeURIComponent(token)}/`);
  if (!raw) return null;
  // Map backend response to frontend SharedDraftData format
  // Backend uses: raw_uploads[].file_url, draft_data[].data_key/data_value, area_unit_display
  const uploads = (raw.raw_uploads ?? raw.uploads ?? [])
    .map((u: Record<string, unknown>) => ({
      url: (u.file_url ?? u.url ?? "") as string,
      name: (u.file_name ?? u.name ?? "") as string,
      mime_type: (u.mime_type ?? "") as string,
    }))
    .filter((u: { url: string }) => u.url);
  const data = (raw.draft_data ?? raw.data ?? [])
    .map((e: Record<string, unknown>) => ({
      key: (e.data_key ?? e.key ?? "") as string,
      value: (e.data_value ?? e.value ?? "") as string,
    }))
    .filter((e: { key: string }) => e.key);
  return {
    title: raw.title,
    description: raw.description,
    display_address: raw.display_address,
    price: raw.price,
    currency: raw.currency,
    bedrooms: raw.bedrooms,
    bathrooms: raw.bathrooms,
    area: raw.area,
    area_unit: raw.area_unit_display ?? raw.area_unit,
    lot_size: raw.lot_size,
    lot_size_unit: raw.lot_size_unit_display ?? raw.lot_size_unit,
    year_built: raw.year_built,
    city: raw.city,
    state: raw.state,
    country: raw.country,
    uploads,
    data: data.length ? data : undefined,
    floorplan: raw.floorplan ?? null,
  };
}

export async function verifySharePin(token: string, pin: string): Promise<{ verified: boolean }> {
  return request(`/api/reaigen/shared/${encodeURIComponent(token)}/verify-pin/`, {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
}

// ─── Share Management ─────────────────────────────────────────────────────

export async function listShares(): Promise<ShareData[]> {
  const data = await request("/api/reaigen/shares/");
  return data.results ?? data ?? [];
}

export async function createDraftShare(
  draftId: number,
  opts?: { share_type?: string; pin?: string; expires_in_hours?: number; max_access_count?: number; field_names?: string[]; data_features?: string[] | null },
): Promise<ShareData> {
  return request("/api/reaigen/shares/", {
    method: "POST",
    body: JSON.stringify({ draft: draftId, ...opts }),
  });
}

export async function getDraftShare(draftId: number): Promise<ShareData | null> {
  try {
    const all = await listShares();
    return all.find((s) => s.draft === draftId && s.status !== "revoked") ?? null;
  } catch {
    return null;
  }
}

export async function createSplatShare(
  splatId: number,
  opts?: { share_type?: string; pin?: string; expires_in_hours?: number; max_access_count?: number; field_names?: string[]; data_features?: string[] | null },
): Promise<ShareData> {
  return request(`/api/reaigen/splats/${splatId}/share/`, {
    method: "POST",
    body: JSON.stringify(opts ?? {}),
  });
}

export async function updateShare(shareId: number, data: Partial<{
  title: string;
  share_type: string;
  pin: string;
  expires_in_hours: number;
  max_access_count: number | null;
  field_names: string[];
  data_features: string[] | null;
}>): Promise<ShareData> {
  return request(`/api/reaigen/shares/${shareId}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function pauseShare(shareId: number): Promise<{ message: string; share: ShareData }> {
  return request(`/api/reaigen/shares/${shareId}/pause/`, { method: "POST" });
}

export async function resumeShare(shareId: number): Promise<{ message: string; share: ShareData }> {
  return request(`/api/reaigen/shares/${shareId}/resume/`, { method: "POST" });
}

export async function revokeShare(shareId: number): Promise<{ message: string }> {
  return request(`/api/reaigen/shares/${shareId}/revoke/`, { method: "POST" });
}

export async function getShareAnalytics(shareId: number): Promise<{
  share: ShareData;
  stats: { total_accesses: number; unique_ips: number; authenticated_accesses: number; failed_pin_attempts: number };
}> {
  return request(`/api/reaigen/shares/${shareId}/analytics/`);
}
