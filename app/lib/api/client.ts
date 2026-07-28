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

/** Session expired (401): flush all cached data and signal the app to
 * re-authenticate. A single global event lets AuthProvider force a clean
 * logout + redirect to login, instead of leaving the user stranded on a
 * dead authenticated session (which is unsafe — stale data, failing actions). */
function notifyUnauthorized() {
  cache.clear();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("reai:unauthorized"));
  }
}

const CACHE_TTL = 30_000; // 30s default
const LONG_TTL = 300_000; // 5 min — profile / localization / preferences
const CONTENT_TTL = 600_000; // 10 min — legal / content documents
const PROFILE_REQUEST_TIMEOUT_MS = 8_000;
const GET_RETRY_DELAYS_MS = [350, 900] as const;

function isTransientGetError(error: unknown): boolean {
  if (error instanceof ApiError) return [408, 425, 429, 502, 503, 504].includes(error.status);
  return error instanceof TypeError;
}

function pause(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function fetchGetData(path: string, options: RequestInit): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= GET_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const res = await fetch(path, {
        ...options,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...options.headers },
      });
      if (!res.ok) {
        const body = await res.text();
        if (res.status === 401) notifyUnauthorized();
        throw new ApiError(res.status, body);
      }
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } catch (error) {
      lastError = error;
      if (!isTransientGetError(error) || attempt >= GET_RETRY_DELAYS_MS.length) throw error;
      await pause(GET_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

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
  // The profile response embeds personalized_data. A preference PATCH must
  // invalidate both views or a cross-platform setting can appear to revert
  // for up to five minutes even though the backend saved it correctly.
  if (path.startsWith("/api/reaigen/personalized-data/")) {
    for (const key of cache.keys()) {
      if (key.startsWith("/api/reaigen/users/")) cache.delete(key);
    }
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

    const promise = fetchGetData(path, options).then((data) => {
      cache.set(path, { data, ts: Date.now() });
      return data;
    });

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
    if (res.status === 401) notifyUnauthorized();
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
    if (res.status === 401) notifyUnauthorized();
    throw new ApiError(res.status, body);
  }
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

async function requestWithTimeout(path: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await abortableRequest(path, controller.signal);
  } finally {
    window.clearTimeout(timeout);
  }
}

/** Force a network GET and replace the matching in-memory cache entry. */
async function freshRequest(path: string) {
  cache.delete(path);
  inFlight.delete(path);
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401) notifyUnauthorized();
    throw new ApiError(res.status, body);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  cache.set(path, { data, ts: Date.now() });
  return data;
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
  notify_upload_landed: boolean;
  notification_sound: boolean;
  notification_quiet_hours_start: string | null;
  notification_quiet_hours_end: string | null;
  notification_timezone: string;
  preferences: Record<string, unknown>;
  onboarding_completed: boolean;
  onboarding_step: number;
}

export interface NotificationDevice {
  id: number;
  platform: "ios" | "web";
  app_id: string;
  environment: "production" | "sandbox";
  enabled: boolean;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface WebPushConfig {
  enabled: boolean;
  public_key: string;
}

export interface NotificationMessage {
  id: number;
  event_type: string;
  collapse_key: string;
  title: string;
  body: string;
  data: Record<string, string | number | boolean | null>;
  status: string;
  read_at: string | null;
  sent_at: string | null;
  created_at: string;
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
  return requestWithTimeout("/api/reaigen/users/me/", PROFILE_REQUEST_TIMEOUT_MS);
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
  notify_upload_landed: boolean;
  notification_sound: boolean;
  notification_quiet_hours_start: string | null;
  notification_quiet_hours_end: string | null;
  notification_timezone: string;
  preferences: Record<string, unknown>;
}>): Promise<PersonalizedData> {
  return request("/api/reaigen/personalized-data/me/", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function getWebPushConfig(): Promise<WebPushConfig> {
  return request(
    "/api/reaigen/notification-devices/web-push-config/",
  );
}

export async function registerWebPushDevice(data: {
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<NotificationDevice> {
  return request("/api/reaigen/notification-devices/", {
    method: "POST",
    body: JSON.stringify({
      platform: "web",
      app_id: "reaigen-web",
      environment: "production",
      ...data,
    }),
  });
}

export async function deleteNotificationDevice(deviceId: number): Promise<void> {
  await request(
    `/api/reaigen/notification-devices/${encodeURIComponent(deviceId)}/`,
    { method: "DELETE" },
  );
}

export async function getNotificationMessages(): Promise<{
  count: number;
  results: NotificationMessage[];
}> {
  return freshRequest("/api/reaigen/notifications/");
}

export async function markNotificationRead(
  notificationId: number,
): Promise<NotificationMessage> {
  return request(
    `/api/reaigen/notifications/${encodeURIComponent(notificationId)}/read/`,
    { method: "POST" },
  );
}

export async function markAllNotificationsRead(): Promise<{
  marked_read: number;
}> {
  return request("/api/reaigen/notifications/read-all/", {
    method: "POST",
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

export type { UnitLookup } from "../unit-catalog";
import type { UnitLookup } from "../unit-catalog";

interface UnitLookupPage {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results?: UnitLookup[];
}

/**
 * Read every page of the canonical backend unit catalogue. The endpoint owns
 * codes, symbols, categories, display metadata, and conversion factors.
 */
export async function listUnits(category?: string): Promise<UnitLookup[]> {
  const requestPage = async (page: number) => {
    const query = new URLSearchParams({ page: String(page), page_size: "500" });
    if (category) query.set("category", category.trim().toUpperCase());
    return request(`/api/reaigen/lookups/units/?${query.toString()}`) as Promise<UnitLookupPage | UnitLookup[]>;
  };

  const first = await requestPage(1);
  if (Array.isArray(first)) return first.filter((unit) => unit.is_active !== false);

  const firstPage = first.results ?? [];
  const pageCount = first.next && firstPage.length > 0
    ? Math.min(50, Math.ceil((first.count ?? firstPage.length) / firstPage.length))
    : 1;
  const remainingPages = pageCount > 1
    ? await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => requestPage(index + 2)))
    : [];
  const allUnits = [
    ...firstPage,
    ...remainingPages.flatMap((page) => Array.isArray(page) ? page : page.results ?? []),
  ];
  return [...new Map(allUnits.map((unit) => [unit.id, unit])).values()]
    .filter((unit) => unit.is_active !== false);
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

import type { SplatViewerPayload, SplatPackagePayload, SplatSceneResponse, SceneDeliveryResolution, SceneDeliverySummary, SceneDeliveryTargetProfile, SceneRefinementSummary, VirtualTourViewerPayload, CameraData, GlobalSceneTransform, UsdStageTransformEditResponse, TourViewerData, SplatListItem, ShareData, SharedDraftData, SplatsByDraftPayload, DraftListingItem, DraftDetailItem, DraftUpload, DraftTourAssetsPayload, DraftTourPublicationSelection } from "../tour-types";

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

/** Bypass the short detail cache after an editor or media mutation. */
export async function refreshDraft(draftId: number): Promise<DraftDetailItem> {
  return freshRequest(`/api/reaigen/drafts/${draftId}/`);
}

interface DraftUploadPage {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results?: DraftUpload[];
}

export async function listDraftUploads(
  draftId: number,
  options: { includeDeleted?: boolean; fresh?: boolean } = {},
): Promise<DraftUpload[]> {
  const query = new URLSearchParams({
    draft_post: String(draftId),
    page_size: "500",
    ordering: "sort_order,uploaded_at",
  });
  if (options.includeDeleted) query.set("include_deleted", "true");
  const path = `/api/reaigen/uploads/?${query.toString()}`;
  const payload = options.fresh ? await freshRequest(path) : await request(path);
  return (payload as DraftUploadPage)?.results ?? (Array.isArray(payload) ? payload : []);
}

export async function updateDraftUpload(
  uploadId: number,
  data: Partial<Pick<DraftUpload, "sort_order" | "role" | "asset_type">>,
): Promise<DraftUpload> {
  return request(`/api/reaigen/uploads/${uploadId}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/** Persist the gallery order using the same 0-based sort_order contract as iOS. */
export async function reorderDraftUploads(uploadIds: number[]): Promise<DraftUpload[]> {
  return Promise.all(uploadIds.map((uploadId, sortOrder) => updateDraftUpload(uploadId, { sort_order: sortOrder })));
}

export interface DraftGalleryUpdate {
  logical_asset_id: string;
  sort_order?: number;
  visible?: boolean;
}

export interface DraftGalleryUpdateResult {
  draft_id: number;
  items: Array<{
    logical_asset_id: string;
    sort_order: number;
    visible: boolean;
    current_upload_id: number | null;
  }>;
}

/**
 * Persist presentation state for logical media assets. The backend applies
 * every change to all physical versions so version promotion cannot undo it.
 */
export async function updateDraftGallery(
  draftId: number,
  items: DraftGalleryUpdate[],
): Promise<DraftGalleryUpdateResult> {
  return request("/api/reaigen/uploads/gallery/", {
    method: "PATCH",
    body: JSON.stringify({ draft_post: draftId, items }),
  });
}

interface AssetTypeLookup {
  id: number;
  code: string;
  name: string;
}

async function getAssetTypeByCode(code: string): Promise<AssetTypeLookup> {
  return request(`/api/reaigen/lookups/asset-types/by_code/?code=${encodeURIComponent(code)}`);
}

interface DraftMediaPresignResponse {
  upload_mode: "single" | "multipart";
  upload_key: string;
  presigned_url?: string;
}

interface DraftPhotoUploadSession {
  assetType: AssetTypeLookup;
  presign: DraftMediaPresignResponse & { presigned_url: string };
  contentType: string;
  sortOrder: number;
  putComplete: boolean;
  createdAt: number;
}

const draftPhotoUploadSessions = new Map<string, DraftPhotoUploadSession>();

/**
 * Upload one owner-selected photo through Django's production direct-upload flow.
 * The caller intentionally owns retry UI: creating a new presign on an opaque
 * network timeout could duplicate the file, while confirm itself is idempotent.
 */
export async function uploadDraftPhoto(
  draftId: number,
  file: File,
  sortOrder: number,
): Promise<DraftUpload> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const inferredTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
    tif: "image/tiff",
    tiff: "image/tiff",
    bmp: "image/bmp",
  };
  const contentType = file.type || inferredTypes[extension] || "application/octet-stream";
  const sessionKey = `${draftId}:${file.name}:${file.size}:${file.lastModified}`;
  let uploadSession = draftPhotoUploadSessions.get(sessionKey);
  if (uploadSession && Date.now() - uploadSession.createdAt > 5 * 60 * 60 * 1000) {
    draftPhotoUploadSessions.delete(sessionKey);
    uploadSession = undefined;
  }

  if (!uploadSession) {
    const [assetType, presign] = await Promise.all([
      getAssetTypeByCode("RAW_IMAGE"),
      request("/api/reaigen/uploads/presign/", {
        method: "POST",
        body: JSON.stringify({
          draft_post: draftId,
          filename: file.name,
          content_type: contentType,
          file_size: file.size,
        }),
      }) as Promise<DraftMediaPresignResponse>,
    ]);

    if (presign.upload_mode !== "single" || !presign.presigned_url) {
      throw new Error("This photo is too large for the browser uploader.");
    }
    uploadSession = {
      assetType,
      presign: { ...presign, presigned_url: presign.presigned_url },
      contentType,
      sortOrder,
      putComplete: false,
      createdAt: Date.now(),
    };
    draftPhotoUploadSessions.set(sessionKey, uploadSession);
  }

  if (!uploadSession.putComplete) {
    const storageResponse = await fetch(uploadSession.presign.presigned_url, {
      method: "PUT",
      headers: { "Content-Type": uploadSession.contentType },
      body: file,
      credentials: "omit",
    });
    if (!storageResponse.ok) {
      throw new ApiError(storageResponse.status, await storageResponse.text());
    }
    uploadSession.putComplete = true;
  }

  const confirmed = await request("/api/reaigen/uploads/confirm/", {
    method: "POST",
    body: JSON.stringify({
      upload_key: uploadSession.presign.upload_key,
      draft_post: draftId,
      asset_type: uploadSession.assetType.id,
      file_name: file.name,
      file_size: file.size,
      content_type: uploadSession.contentType,
      sort_order: uploadSession.sortOrder,
      role: "photo",
    }),
  });
  draftPhotoUploadSessions.delete(sessionKey);
  cache.delete(`/api/reaigen/drafts/${draftId}/`);
  inFlight.delete(`/api/reaigen/drafts/${draftId}/`);
  return confirmed as DraftUpload;
}

export type DraftUpdatePayload = Partial<{
  title: string;
  description: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postal_code: string;
  price: string | number | null;
  currency: string;
  area: string | number | null;
  area_unit: number | null;
  lot_size: string | number | null;
  lot_size_unit: number | null;
  year_built: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  specs: Record<string, unknown>;
  is_complete: boolean;
}>;

/** Persist owner edits through Django's ownership-checked draft endpoint. */
export async function updateDraft(
  draftId: number,
  data: DraftUpdatePayload,
): Promise<DraftDetailItem> {
  return request(`/api/reaigen/drafts/${draftId}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
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

export interface ReaiAgentDraftResult {
  id: number;
  is_complete: boolean;
  updated_at: string | null;
  semantic_summary?: string;
  creation_data: {
    title?: string | null;
    description?: string | null;
    price?: string | number | null;
    currency?: string | number | null;
    area?: string | number | null;
    area_unit?: string | number | null;
    [key: string]: unknown;
  };
}

export type ReaiAgentUiBlock =
  | {
      kind: "summary";
      title: string;
      description?: string;
      items: Array<{
        label: string;
        value: string;
        hint?: string;
        tone?: "neutral" | "success" | "warning";
      }>;
    }
  | {
      kind: "actions";
      title?: string;
      actions: Array<{
        label: string;
        prompt: string;
        description?: string;
      }>;
    }
  | {
      kind: "progress";
      title: string;
      label: string;
      value?: number;
      detail?: string;
      tone?: "neutral" | "success" | "warning";
    };

export interface ReaiAgentResponse {
  reply: string;
  execution_mode?: "deterministic" | "fast" | "standard" | "reasoning" | "safe_fallback";
  reasoning_effort?: "none" | "minimal" | "low" | "high";
  latency_ms?: number;
  settings_revision?: number;
  release_bundle?: {
    id: number;
    name: string;
    execution_lane: "fast" | "standard" | "reasoning";
    status: "active" | "canary_5" | "canary_25";
    content_hash: string;
    generation_profile: string;
    generation_profile_version: number;
  } | null;
  proposed_changes: Record<string, unknown>;
  suggested_actions: string[];
  /** Optional bounded generative-UI blocks. Text is rendered as content and actions only re-prompt Agent. */
  ui_blocks?: ReaiAgentUiBlock[];
  proposal_token: string | null;
  action_code?: "revoke_all_shares" | "manage_shares" | "share_inventory" | "share_status" | "current_creation_overview" | "settings_navigation" | "settings_update" | "select_share_fields" | "create_draft_share" | "translate_description" | "grade_draft_images" | "retouch_draft_image" | "cleanplate_draft_images" | "generative_hdr_draft_image" | "organize_draft_images" | "generate_draft_video";
  action_token?: string | null;
  action_count?: number;
  share_action?: "list" | "pause" | "resume" | "revoke";
  action_scope?: "active" | "paused" | "active_and_paused";
  share_results?: Array<{
    id: number;
    title: string;
    status: string;
    access_count: number;
    visible_field_count: number;
    share_path: string;
  }>;
  share_id?: number | null;
  share_status?: "active" | "paused" | "expired" | "revoked" | "not_shared";
  share_url?: string | null;
  share_path?: string | null;
  available_share_fields?: string[];
  selected_share_fields?: string[];
  settings_section?: "profile" | "seller" | "privacy" | "reai" | "localization" | "notifications" | "billing" | "security" | null;
  navigation_path?: string | null;
  settings_changes?: {
    preferred_language?: "en" | "sk" | "cs" | "de";
  };
  translation_action?: {
    field: "description";
    source_language: "auto";
    target_language: string;
    status: "awaiting_confirmation" | "pending" | "ready" | "unavailable";
    cached: boolean;
    translated_text?: string | null;
  };
  media_action?: {
    mode: "grade" | "retouch" | "cleanplate" | "generative_hdr" | "organize" | "video";
    scope: "selected" | "room" | "draft";
    upload_ids: number[];
    operations: Record<string, string | number | boolean>;
    originals_preserved: true;
    requires_version_review: boolean;
    cloud_image_processor: boolean;
    authenticity_boundary?: boolean;
  };
  operation?: "none" | "list" | "compare" | "bulk_edit";
  search_query?: string | null;
  matched_creation_count?: number;
  selected_creation_ids?: number[];
  draft_results?: ReaiAgentDraftResult[];
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
  | "translation"
  | "image"
  | "cleanplate"
  | "retouch"
  | "generative_image"
  | "media_organize"
  | "video_generation"
  | "sharing"
  | "settings_navigation"
  | "settings_localization";

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
): Promise<ReaiAgentResponse> {
  return request(`/api/reaigen/reai-agent/drafts/${draftId}/assist/`, {
    method: "POST",
    body: JSON.stringify({ message, conversation: conversation.slice(-4), improvement_conversation_id: improvementConversationId }),
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
  shareFieldNames?: string[],
  pendingActionCode?: ReaiAgentResponse["action_code"],
  workspaceContext?: "creator" | "draft" | "settings",
  currentUploadId?: number,
): Promise<ReaiAgentResponse> {
  return request("/api/reaigen/reai-agent/workspace/assist/", {
    method: "POST",
    body: JSON.stringify({
      message,
      current_draft_id: currentDraftId,
      conversation: conversation.slice(-4),
      improvement_conversation_id: improvementConversationId,
      share_field_names: shareFieldNames,
      pending_action_code: pendingActionCode,
      workspace_context: workspaceContext,
      current_upload_id: currentUploadId,
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

export async function applyReaiTranslationAction(
  actionToken: string,
  improvementConversationId: string | null = null,
): Promise<{
  action: "translate_description";
  draft_id: number;
  field: "description";
  source_language: "auto";
  target_language: string;
  status: "pending" | "ready";
  cached: boolean;
  translated_text: string | null;
  execution_mode: "translation_service";
}> {
  return request("/api/reaigen/reai-agent/workspace/translations/apply/", {
    method: "POST",
    body: JSON.stringify({
      action_token: actionToken,
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
      action: "manage_shares";
      operation: "pause" | "resume" | "revoke";
      target_status: "active" | "paused" | "revoked";
      updated_count: number;
      revoked_count: number;
      execution_mode: "deterministic";
    }
  | {
      action: "create_draft_share";
      created: boolean;
      draft_id: number;
      share_id: number;
      share_url: string;
      share_path: string;
      selected_share_fields: string[];
      execution_mode: "deterministic";
    }
> {
  const result = await request("/api/reaigen/reai-agent/workspace/actions/apply/", {
    method: "POST",
    body: JSON.stringify({
      action_token: actionToken,
      confirmed: true,
      improvement_conversation_id: improvementConversationId,
    }),
  });
  // Agent sharing actions use a different API prefix, so the generic mutation
  // invalidator cannot infer that the sharing collection is now stale.
  cache.delete("/api/reaigen/shares/");
  inFlight.delete("/api/reaigen/shares/");
  return result;
}

export async function applyReaiMediaAction(
  actionToken: string,
  improvementConversationId: string | null = null,
): Promise<{
  action: "grade_draft_images" | "retouch_draft_image" | "cleanplate_draft_images" | "generative_hdr_draft_image" | "organize_draft_images" | "generate_draft_video";
  draft_id: number;
  selected_upload_ids: number[];
  service_ids?: number[];
  completed_count?: number;
  failed_count?: number;
  status?: string;
  service_id?: number;
  requires_version_review: boolean;
  /** Backend-reported media execution mode; provider details stay outside the frontend contract. */
  execution_mode: string;
}> {
  const result = await request("/api/reaigen/reai-agent/workspace/media-actions/apply/", {
    method: "POST",
    body: JSON.stringify({
      action_token: actionToken,
      confirmed: true,
      improvement_conversation_id: improvementConversationId,
    }),
  });
  cache.delete(`/api/reaigen/drafts/${result.draft_id}/`);
  inFlight.delete(`/api/reaigen/drafts/${result.draft_id}/`);
  return result;
}

export interface MediaVersion {
  id: number;
  logical_asset_id: string;
  version: number;
  is_master: boolean;
  is_deleted: boolean;
  status: string;
  file_name: string;
  file_url: string | null;
  uploaded_at: string;
  source_upload_id: number | null;
  supersedes_id: number | null;
  processor: string;
  operations: Record<string, number | boolean>;
  mode: string;
  authenticity_boundary: boolean;
}

export interface MediaVersionGroup {
  logical_asset_id: string;
  versions: MediaVersion[];
}

// Compatibility names for the Agent conversation UI. Product media controls
// use the neutral types and owner-scoped regular-tool endpoints below.
export type AgentMediaVersion = MediaVersion;
export type AgentMediaVersionGroup = MediaVersionGroup;

export async function getAgentMediaVersions(
  draftId: number,
): Promise<{ draft_id: number; groups: AgentMediaVersionGroup[]; physical_delete_available: false }> {
  return request(`/api/reaigen/reai-agent/workspace/drafts/${draftId}/media-versions/`);
}

export async function manageAgentMediaVersion(
  draftId: number,
  uploadId: number,
  action: "promote" | "hide" | "restore",
): Promise<{ action: string; draft_id: number; version: AgentMediaVersion; physical_delete: false }> {
  const result = await request(
    `/api/reaigen/reai-agent/workspace/drafts/${draftId}/media-versions/${uploadId}/action/`,
    { method: "POST", body: JSON.stringify({ action, confirmed: true }) },
  );
  cache.delete(`/api/reaigen/drafts/${draftId}/`);
  inFlight.delete(`/api/reaigen/drafts/${draftId}/`);
  return result;
}

export async function getMediaVersions(
  draftId: number,
): Promise<{ draft_id: number; groups: MediaVersionGroup[]; physical_delete_available: false }> {
  return request(`/api/reaigen/tools/drafts/${draftId}/media-versions/`);
}

export async function manageMediaVersion(
  draftId: number,
  uploadId: number,
  action: "promote" | "hide" | "restore",
): Promise<{ action: string; draft_id: number; version: MediaVersion; physical_delete: false }> {
  const result = await request(
    `/api/reaigen/tools/drafts/${draftId}/media-versions/${uploadId}/action/`,
    { method: "POST", body: JSON.stringify({ action, confirmed: true }) },
  );
  cache.delete(`/api/reaigen/drafts/${draftId}/`);
  inFlight.delete(`/api/reaigen/drafts/${draftId}/`);
  return result;
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

export interface ReaiImprovementConversation {
  id: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  messages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    created_at: string;
  }>;
  actions: Array<{
    tool: string;
    action: string;
    status: string;
    before: Record<string, unknown>;
    changes: Record<string, unknown>;
    after: Record<string, unknown>;
    created_at: string;
  }>;
}

export async function getReaiImprovementConversations(): Promise<{
  conversations: ReaiImprovementConversation[];
}> {
  return request("/api/reaigen/reai-agent/improvement-conversations/");
}

export async function deleteReaiImprovementConversation(
  conversationId: string,
): Promise<{ deleted: true }> {
  return request("/api/reaigen/reai-agent/improvement-conversations/", {
    method: "DELETE",
    body: JSON.stringify({ conversation_id: conversationId }),
  });
}

export async function saveReaiFeedback(
  conversationId: string,
  helpful: boolean,
  correction = "",
): Promise<{ saved: boolean; feedback_id: number }> {
  return request("/api/reaigen/reai-agent/improvement-conversations/", {
    method: "POST",
    body: JSON.stringify({ conversation_id: conversationId, helpful, correction }),
  });
}

export interface ReaiImageInsight {
  analysis_mode?: string;
  category?: string;
  subcategory?: string;
  confidence?: number;
  aesthetic_score?: number;
  quality_score?: number;
  technical_quality_score?: number;
  marketing_score?: number;
  duplicate_flag?: boolean;
  recommended_gallery_position?: number;
  keep_or_drop?: string;
  section?: string;
  processor: string;
}

export interface ReaiImageEditOperations {
  auto_enhance?: boolean;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  sharpness?: number;
  exposure_ev?: number;
  auto_white_balance?: boolean;
  normalize_color_profile?: boolean;
  temperature?: number;
  tint?: number;
  hue_degrees?: number;
  rotation?: 0 | 90 | 180 | 270;
  crop_aspect?: "original" | "1:1" | "4:3" | "3:2" | "16:9";
  crop_x?: number;
  crop_y?: number;
}

export interface ReaiImageSelection {
  scope: "selected" | "room" | "draft";
  upload_ids?: number[];
  room_id?: string;
  room_label?: string;
}

export type ReaiRetouchTarget = Partial<Record<
  | "target_reflection"
  | "target_display"
  | "region_top_right"
  | "region_top_left"
  | "region_bottom_right"
  | "region_bottom_left",
  true
>>;

export interface ReaiCloudImageResult {
  upload_id: number;
  generated_upload_id?: number;
  cleaned_upload_id?: number | null;
  mode?: string;
  target?: ReaiRetouchTarget;
  status: "completed" | "failed";
  detail?: string;
}

function invalidateReaiDraft(draftId: number) {
  cache.delete(`/api/reaigen/drafts/${draftId}/`);
  inFlight.delete(`/api/reaigen/drafts/${draftId}/`);
}

export async function analyzeDraftImage(
  draftId: number,
  uploadId: number,
  improvementConversationId: string | null = null,
): Promise<{
  upload_id: number;
  insights: ReaiImageInsight;
  execution_mode: "deterministic";
  raw_image_sent_to_language_model: false;
}> {
  const result = await request(
    `/api/reaigen/tools/drafts/${draftId}/images/${uploadId}/insights/`,
    {
      method: "POST",
      body: JSON.stringify({
        confirmed: true,
        improvement_conversation_id: improvementConversationId,
      }),
    },
  );
  invalidateReaiDraft(draftId);
  return result;
}

export async function editDraftImage(
  draftId: number,
  uploadId: number,
  operations: ReaiImageEditOperations,
  improvementConversationId: string | null = null,
): Promise<{
  service_id: number;
  status: "pending";
  execution_mode: "deterministic";
  requires_version_review: true;
}> {
  const result = await request(
    `/api/reaigen/tools/drafts/${draftId}/images/${uploadId}/edit/`,
    {
      method: "POST",
      body: JSON.stringify({
        operations,
        confirmed: true,
        improvement_conversation_id: improvementConversationId,
      }),
    },
  );
  invalidateReaiDraft(draftId);
  return result;
}

export async function editDraftImages(
  draftId: number,
  selection: ReaiImageSelection,
  operations: ReaiImageEditOperations,
  improvementConversationId: string | null = null,
): Promise<{
  action: "grade_draft_images";
  draft_id: number;
  selected_upload_ids: number[];
  service_ids: number[];
  status: "pending";
  execution_mode: "deterministic";
  raw_image_sent_to_language_model: false;
  requires_version_review: true;
}> {
  const result = await request(`/api/reaigen/tools/drafts/${draftId}/images/edit-batch/`, {
    method: "POST",
    body: JSON.stringify({
      ...selection,
      operations,
      confirmed: true,
      improvement_conversation_id: improvementConversationId,
    }),
  });
  invalidateReaiDraft(draftId);
  return result;
}

export async function retouchDraftImage(
  draftId: number,
  uploadId: number,
  target: ReaiRetouchTarget,
  improvementConversationId: string | null = null,
): Promise<{
  action: "retouch_draft_image";
  draft_id: number;
  selected_upload_ids: number[];
  result: ReaiCloudImageResult;
  execution_mode: "bounded_vfx_retouch";
  raw_user_instruction_forwarded: false;
  requires_version_review: true;
}> {
  const result = await request(`/api/reaigen/tools/drafts/${draftId}/images/retouch/`, {
    method: "POST",
    body: JSON.stringify({
      scope: "selected",
      upload_ids: [uploadId],
      target,
      confirmed: true,
      improvement_conversation_id: improvementConversationId,
    }),
  });
  invalidateReaiDraft(draftId);
  return result;
}

export async function cleanplateDraftImages(
  draftId: number,
  selection: ReaiImageSelection,
  improvementConversationId: string | null = null,
): Promise<{
  action: "cleanplate_draft_images";
  draft_id: number;
  selected_upload_ids: number[];
  completed_count: number;
  failed_count: number;
  results: ReaiCloudImageResult[];
  execution_mode: "cloud_image_edit";
  raw_image_sent_to_language_model: false;
  requires_version_review: true;
}> {
  const result = await request(`/api/reaigen/tools/drafts/${draftId}/images/cleanplate/`, {
    method: "POST",
    body: JSON.stringify({
      ...selection,
      confirmed: true,
      improvement_conversation_id: improvementConversationId,
    }),
  });
  invalidateReaiDraft(draftId);
  return result;
}

export async function generateDraftImageHdr(
  draftId: number,
  uploadId: number,
  improvementConversationId: string | null = null,
): Promise<{
  action: "generative_hdr_draft_image";
  draft_id: number;
  selected_upload_ids: number[];
  result: ReaiCloudImageResult;
  execution_mode: "cloud_image_edit";
  requires_version_review: true;
}> {
  const result = await request(`/api/reaigen/tools/drafts/${draftId}/images/hdr/`, {
    method: "POST",
    body: JSON.stringify({
      scope: "selected",
      upload_ids: [uploadId],
      confirmed: true,
      improvement_conversation_id: improvementConversationId,
    }),
  });
  invalidateReaiDraft(draftId);
  return result;
}

export async function organizeDraftImages(
  draftId: number,
  improvementConversationId: string | null = null,
): Promise<{
  action: "organize_draft_images";
  draft_id: number;
  selected_upload_ids: number[];
  status: "completed";
  execution_mode: "deterministic";
}> {
  const result = await request(`/api/reaigen/tools/drafts/${draftId}/images/organize/`, {
    method: "POST",
    body: JSON.stringify({
      confirmed: true,
      improvement_conversation_id: improvementConversationId,
    }),
  });
  invalidateReaiDraft(draftId);
  return result;
}

export async function generateDraftVideoFromImage(
  draftId: number,
  sourceUploadId: number,
  motion: "slow_push" | "slow_pull_back" | "pan_left" | "pan_right" = "slow_push",
  improvementConversationId: string | null = null,
): Promise<{
  action: "generate_draft_video";
  draft_id: number;
  source_upload_id: number;
  service_id: number;
  status: "pending";
  execution_mode: "runpod_async";
}> {
  const result = await request(`/api/reaigen/tools/drafts/${draftId}/videos/generate/`, {
    method: "POST",
    body: JSON.stringify({
      source_upload_id: sourceUploadId,
      motion,
      confirmed: true,
      improvement_conversation_id: improvementConversationId,
    }),
  });
  invalidateReaiDraft(draftId);
  return result;
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

export async function getSplatViewer(
  splatId: number,
  options: { fresh?: boolean; tourId?: number } = {},
): Promise<SplatViewerPayload> {
  const query = new URLSearchParams({ targetProfile: "web" });
  if (options.tourId != null) query.set("tourId", String(options.tourId));
  const path = `/api/reaigen/splats/${splatId}/viewer/?${query.toString()}`;
  if (options.fresh) {
    cache.delete(path);
    const data = await fetchGetData(path, { cache: "no-store" });
    cache.set(path, { data, ts: Date.now() });
    return data as SplatViewerPayload;
  }
  return request(path);
}

export async function getSplatPackage(splatId: number): Promise<SplatPackagePayload> {
  return request(
    `/api/reaigen/splats/${splatId}/package/?targetProfile=web`,
  );
}

export async function getSplatScene(
  splatId: number,
  revision?: number,
): Promise<SplatSceneResponse> {
  const suffix = revision == null ? "" : `?revision=${encodeURIComponent(revision)}`;
  return request(`/api/reaigen/splats/${splatId}/scene/${suffix}`);
}

export async function getSplatSceneDeliveries(
  splatId: number,
  targetProfile?: SceneDeliveryTargetProfile,
): Promise<{
  profiles: Array<{
    id: SceneDeliveryTargetProfile;
    label: string;
    runtime: string;
    packageKind: string;
    portableUsdz: boolean;
  }>;
  deliveries: SceneDeliverySummary[];
}> {
  const suffix = targetProfile
    ? `?targetProfile=${encodeURIComponent(targetProfile)}`
    : "";
  return request(`/api/reaigen/splats/${splatId}/scene/deliveries/${suffix}`);
}

export async function createSplatSceneDeliveries(
  splatId: number,
  data: {
    sceneRevision?: number;
    sceneRevisionId?: number;
    sceneStageSha256?: string;
    reconstructionVersion?: number;
    reconstructionVersionId?: number;
    targetProfiles: SceneDeliveryTargetProfile[];
  },
): Promise<{
  promotionPolicy: "manual";
  deliveries: SceneDeliverySummary[];
}> {
  return request(`/api/reaigen/splats/${splatId}/scene/deliveries/`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function resolveSplatSceneDelivery(
  splatId: number,
  deliveryId: number,
): Promise<SceneDeliveryResolution> {
  return request(
    `/api/reaigen/splats/${splatId}/scene/deliveries/${deliveryId}/resolve/`,
  );
}

export async function resolveCurrentSplatSceneDelivery(
  splatId: number,
  targetProfile: SceneDeliveryTargetProfile,
): Promise<SceneDeliveryResolution & {
  representations: SceneDeliveryResolution["asset"][];
}> {
  return request(
    `/api/reaigen/splats/${splatId}/scene/deliveries/current/`
    + `?targetProfile=${encodeURIComponent(targetProfile)}`,
  );
}

export async function publishSplatSceneDelivery(
  splatId: number,
  deliveryId: number,
): Promise<{
  promotionPolicy: "explicit-target-publication";
  archivedDeliveryIds: number[];
  delivery: SceneDeliverySummary;
}> {
  return request(
    `/api/reaigen/splats/${splatId}/scene/deliveries/${deliveryId}/publish/`,
    { method: "POST" },
  );
}

export async function getSplatRefinements(
  splatId: number,
): Promise<{
  refinements: SceneRefinementSummary[];
  sceneDeliveries: SceneDeliverySummary[];
}> {
  return request(`/api/reaigen/splats/${splatId}/refinements/`);
}

export async function requestSplatRefinement(
  splatId: number,
  data: {
    baseSceneRevision?: number;
    sceneStageSha256?: string;
    baseReconstructionVersion?: number;
    iterations?: number;
    preset?: string;
    downsample?: 1 | 2 | 4 | 8;
    priority?: 0 | 1 | 2 | 3;
    trainingEngine?: "gsplat" | "splatfiction" | "3dgut";
    outputFormats?: Array<"ply" | "sog" | "splat">;
    targetProfiles: SceneDeliveryTargetProfile[];
    trainingOverrides?: Record<string, unknown>;
  },
): Promise<{
  refinement: SceneRefinementSummary;
  preservesApprovedScene: true;
  promotionPolicy: "manual";
}> {
  return request(`/api/reaigen/splats/${splatId}/refinements/`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function downloadSplatSceneDeliveryBundle(
  splatId: number,
  deliveryId: number,
): Promise<Blob> {
  const response = await fetch(
    `/api/reaigen/splats/${splatId}/scene/deliveries/${deliveryId}/usd/?bundle=1`,
    {
      credentials: "include",
      cache: "no-store",
    },
  );
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401) notifyUnauthorized();
    throw new ApiError(response.status, body);
  }
  return response.blob();
}

export async function getVirtualTourViewer(
  tourId: number,
  version?: number,
): Promise<VirtualTourViewerPayload> {
  const suffix = version == null ? "" : `?version=${encodeURIComponent(version)}`;
  return request(`/api/reaigen/tours/${tourId}/viewer/${suffix}`);
}

export async function getSplatsByDraft(draftId: number): Promise<SplatsByDraftPayload> {
  return request(`/api/reaigen/splats/by-draft/${draftId}/?all=true`);
}

export async function getDraftTourAssets(draftId: number): Promise<DraftTourAssetsPayload> {
  return request(`/api/reaigen/drafts/${draftId}/tours/`);
}

export async function reserveDraftTourAsset(
  draftId: number,
  data: {
    asset_id: string;
    name?: string;
    capture_reason: "initial" | "renovation" | "rescan" | "imported" | "other";
    renovation_of_id?: number | null;
  },
): Promise<DraftTourAssetsPayload & {
  reserved_tour_id: number;
  reserved_asset_id: string;
  created: boolean;
}> {
  return request(`/api/reaigen/drafts/${draftId}/tours/`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateDraftTourPublication(
  draftId: number,
  entries: DraftTourPublicationSelection[],
  applyToActiveShares = true,
): Promise<DraftTourAssetsPayload & {
  publication_created: boolean;
  active_shares_updated: boolean;
}> {
  return request(`/api/reaigen/drafts/${draftId}/tours/`, {
    method: "PUT",
    body: JSON.stringify({
      entries,
      apply_to_active_shares: applyToActiveShares,
    }),
  });
}

export async function renameDraftTourAsset(
  draftId: number,
  tourId: number,
  name: string,
): Promise<DraftTourAssetsPayload> {
  return request(`/api/reaigen/drafts/${draftId}/tours/`, {
    method: "PATCH",
    body: JSON.stringify({ tour_id: tourId, name }),
  });
}

export async function setActiveSplat(
  draftId: number,
  splatId: number | null,
): Promise<{
  draft_id: number;
  pinned_splat_id: number | null;
  active_splat_id: number | null;
  active_splat_status: string | null;
}> {
  const result = await request(`/api/reaigen/drafts/${draftId}/set-active-splat/`, {
    method: "POST",
    body: JSON.stringify({ splat_id: splatId }),
  });
  cache.delete(`/api/reaigen/splats/by-draft/${draftId}/?all=true`);
  inFlight.delete(`/api/reaigen/splats/by-draft/${draftId}/?all=true`);
  return result;
}

export async function getCameras(splatId: number): Promise<CameraData> {
  return request(`/api/reaigen/splats/${splatId}/cameras/`);
}

export async function downloadSplatUsdBundle(
  splatId: number,
  revision: number,
  tourVersion?: number,
): Promise<Blob> {
  const query = new URLSearchParams({
    revision: String(revision),
    bundle: "1",
  });
  if (tourVersion != null) query.set("tourVersion", String(tourVersion));
  const response = await fetch(
    `/api/reaigen/splats/${splatId}/scene/usd/?${query.toString()}`,
    {
      credentials: "include",
      cache: "no-store",
    },
  );
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401) notifyUnauthorized();
    throw new ApiError(response.status, body);
  }
  return response.blob();
}

export async function saveCameras(
  splatId: number,
  data: {
    cameras: {
      id?: string;
      position: number[];
      forward: number[];
      up?: number[];
      fov?: number;
      label?: string;
      kind?: string;
      role?: string;
      coordinate_space?: string;
    }[];
    fovY?: number;
    sceneFov?: number;
    baseRevision?: number;
  },
): Promise<CameraData> {
  return request(`/api/reaigen/splats/${splatId}/cameras/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function authorUsdSceneTransformOperation(
  splatId: number,
  delta: GlobalSceneTransform,
  baseRevision: number,
  baseStageSha256?: string,
): Promise<UsdStageTransformEditResponse> {
  return request(`/api/reaigen/splats/${splatId}/scene/edits/`, {
    method: "POST",
    body: JSON.stringify({
      baseRevision,
      ...(baseStageSha256 ? { baseStageSha256 } : {}),
      editTarget: {
        layer: "authoring.usda",
        primPath: "/Reaigen",
      },
      operation: {
        type: "transform",
        space: "world",
        delta,
      },
    }),
  });
}

export async function getSharedTourViewer(token: string, tourId?: number): Promise<TourViewerData> {
  const query = tourId == null ? "" : `?tour_id=${encodeURIComponent(tourId)}`;
  return request(`/api/reaigen/shared/${encodeURIComponent(token)}/tour-viewer/${query}`);
}

export async function getSharedDraftData(token: string): Promise<SharedDraftData | null> {
  // Errors propagate so callers can react to gating responses
  // (requires_pin / requires_auth / expired / paused).
  const raw = await request(`/api/reaigen/shared/${encodeURIComponent(token)}/`);
  if (!raw) return null;
  // Map backend response to frontend SharedDraftData format
  // Backend uses: raw_uploads[].file_url, draft_data[].data_key/data_value, area_unit_display
  const sharedUploadGroups = new Map<string, Record<string, unknown>[]>();
  for (const upload of (raw.raw_uploads ?? raw.uploads ?? []) as Record<string, unknown>[]) {
    const key = String(upload.logical_asset_id ?? upload.id ?? upload.file_url ?? upload.url ?? "");
    sharedUploadGroups.set(key, [...(sharedUploadGroups.get(key) ?? []), upload]);
  }
  const currentSharedUploads = [...sharedUploadGroups.values()].flatMap((versions) => {
    const current = versions.find((upload) => upload.is_master !== false && upload.is_deleted !== true);
    if (!current) return [];
    const authoritativeOriginalName = versions.find((upload) => (
      typeof upload.original_file_name === "string" && upload.original_file_name.trim()
    ))?.original_file_name as string | undefined;
    const original = [...versions].sort((left, right) => {
      const leftIsRoot = left.supersedes == null && left.source_upload_id == null ? 0 : 1;
      const rightIsRoot = right.supersedes == null && right.source_upload_id == null ? 0 : 1;
      if (leftIsRoot !== rightIsRoot) return leftIsRoot - rightIsRoot;

      const leftVersion = Number.isFinite(Number(left.version)) ? Number(left.version) : Number.POSITIVE_INFINITY;
      const rightVersion = Number.isFinite(Number(right.version)) ? Number(right.version) : Number.POSITIVE_INFINITY;
      if (leftVersion !== rightVersion) return leftVersion - rightVersion;

      const leftTimestamp = Date.parse(String(left.uploaded_at ?? ""));
      const rightTimestamp = Date.parse(String(right.uploaded_at ?? ""));
      return (Number.isFinite(leftTimestamp) ? leftTimestamp : Number.POSITIVE_INFINITY)
          - (Number.isFinite(rightTimestamp) ? rightTimestamp : Number.POSITIVE_INFINITY)
        || Number(left.id ?? 0) - Number(right.id ?? 0);
    })[0];
    const enriched: Record<string, unknown> = {
      ...current,
      original_file_name: authoritativeOriginalName
        ?? original?.file_name
        ?? original?.name
        ?? current.file_name
        ?? current.name,
    };
    return [enriched];
  });
  const uploads = currentSharedUploads
    .sort((left, right) => Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0))
    .map((u) => ({
      url: (u.file_url ?? u.url ?? "") as string,
      name: (u.original_file_name ?? u.file_name ?? u.name ?? "") as string,
      mime_type: (u.mime_type ?? "") as string,
    }))
    .filter((u: { url: string }) => u.url);
  const data = (raw.draft_data ?? raw.data ?? [])
    .map((e: Record<string, unknown>) => ({
      key: (e.data_key ?? e.key ?? "") as string,
      value: (e.data_value ?? e.value ?? "") as string,
    }))
    .filter((e: { key: string }) => e.key);
  const tours = (Array.isArray(raw.tours) ? raw.tours : [])
    .map((tour: Record<string, unknown>) => ({
      tour_id: Number(tour.tour_id),
      tour_asset_id: String(tour.tour_asset_id ?? ""),
      name: String(tour.name ?? ""),
      capture_reason: String(tour.capture_reason ?? "other"),
      captured_at: String(tour.captured_at ?? ""),
      is_primary: tour.is_primary === true,
      sort_order: Number(tour.sort_order ?? 0),
      targets: (Array.isArray(tour.targets) ? tour.targets : [])
        .filter((target): target is "web" | "ios" => target === "web" || target === "ios"),
    }))
    .filter((tour: { tour_id: number }) => (
      Number.isInteger(tour.tour_id) && tour.tour_id > 0
    ));
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
    tours,
  };
}

export async function verifySharePin(token: string, pin: string): Promise<{ verified: boolean }> {
  return request(`/api/reaigen/shared/${encodeURIComponent(token)}/verify-pin/`, {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
}

// ─── Share Management ─────────────────────────────────────────────────────

export async function listShares(options: { fresh?: boolean } = {}): Promise<ShareData[]> {
  const data = options.fresh
    ? await freshRequest("/api/reaigen/shares/")
    : await request("/api/reaigen/shares/");
  return data.results ?? data ?? [];
}

export async function createDraftShare(
  draftId: number,
  opts?: { share_type?: string; pin?: string; expires_in_hours?: number; max_access_count?: number; field_names?: string[]; data_features?: string[] | null },
): Promise<ShareData> {
  const created = await request("/api/reaigen/shares/", {
    method: "POST",
    body: JSON.stringify({ draft: draftId, ...opts }),
  }) as ShareData;

  // The generic Django create serializer stores an expiry only for a
  // temporary share. PIN shares support an expiry too, but need the same
  // positive-hour value applied once more through PATCH (the splat endpoint
  // already performs this compatibility step server-side).
  if (opts?.share_type === "pin" && (opts.expires_in_hours ?? 0) > 0) {
    return updateShare(created.id, { expires_in_hours: opts.expires_in_hours });
  }
  return created;
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
  status: string;
  pin: string;
  expires_at: string | null;
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
  try {
    return await request(`/api/reaigen/shares/${shareId}/resume/`, { method: "POST" });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 400) throw error;

    // Compatibility for backend versions whose resume action calls
    // is_accessible() while status is still "paused" (and therefore rejects
    // every valid paused link). Preserve its intended expiry/view-limit guard
    // before using the ordinary owner-authorized PATCH path.
    const current = (await listShares({ fresh: true })).find((share) => share.id === shareId);
    const expired = Boolean(current?.expires_at && new Date(current.expires_at).getTime() <= Date.now());
    const limit = current?.max_access_count ?? current?.max_accesses ?? null;
    const limitReached = limit != null && current != null && current.access_count >= limit;
    if (!current || current.status !== "paused" || expired || limitReached) throw error;

    const share = await updateShare(shareId, { status: "active" });
    return { message: "Share resumed successfully", share };
  }
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
