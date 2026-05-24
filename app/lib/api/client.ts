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
  first_name?: string;
  last_name?: string;
}) {
  return request("/api/auth/register/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function logout() {
  return request("/api/auth/logout", { method: "POST" });
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
  return request("/api/auth/password/change/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ─── Splat Viewer & Tour ──────────────────────────────────────────────────

import type { SplatViewerPayload, CameraData, TourViewerData, SplatListItem } from "../tour-types";

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
  data: { cameras: { position: number[]; forward: number[]; up: number[] }[]; fovY?: number },
): Promise<CameraData> {
  return request(`/api/reaigen/splats/${splatId}/cameras/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function getSharedTourViewer(token: string): Promise<TourViewerData> {
  return request(`/api/reaigen/shared/${token}/tour-viewer/`);
}

export async function verifySharePin(token: string, pin: string) {
  return request(`/api/reaigen/shared/${token}/verify-pin/`, {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
}
