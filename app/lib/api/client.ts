export class ApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`API Error ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request(path: string, options: RequestInit = {}) {
  const res = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    cache: "no-store",
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

// ─── Splat Viewer & Tour ──────────────────────────────────────────────────

import type { SplatViewerPayload, CameraData, TourViewerData, SplatListItem, ShareData } from "../tour-types";

export async function listSplats(page = 1, pageSize = 20): Promise<{ results: SplatListItem[]; count: number; next: string | null }> {
  return request(`/api/reaigen/splats/?page=${page}&page_size=${pageSize}`);
}

export async function listAllSplats(): Promise<SplatListItem[]> {
  const all: SplatListItem[] = [];
  let page = 1;
  while (true) {
    const data = await listSplats(page, 100);
    all.push(...(data.results ?? []));
    if (!data.next) break;
    page++;
  }
  return all;
}

export async function getSplatViewer(splatId: number): Promise<SplatViewerPayload> {
  return request(`/api/reaigen/splats/${splatId}/viewer/`);
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

export async function getSharedTourViewer(token: string, pinToken?: string): Promise<TourViewerData> {
  const qs = pinToken ? `?pin_token=${encodeURIComponent(pinToken)}` : "";
  return request(`/api/reaigen/shared/${encodeURIComponent(token)}/tour-viewer/${qs}`);
}

export async function verifySharePin(token: string, pin: string): Promise<{ verified: boolean; pin_token?: string }> {
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

export async function getSplatShare(splatId: number): Promise<ShareData | null> {
  try {
    return await request(`/api/reaigen/splats/${splatId}/share/`);
  } catch {
    return null;
  }
}

export async function createSplatShare(
  splatId: number,
  opts?: { share_type?: string; pin?: string; expires_in_hours?: number; max_access_count?: number },
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
