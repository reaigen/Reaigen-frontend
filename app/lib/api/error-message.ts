import { ApiError } from "./client";
import { t, type LocaleKey } from "../i18n";

const HTML_FRAGMENT_RE = /<\/?[a-z][\s\S]*>/i;
const NETWORK_FAILURE_RE = /failed to fetch|load failed|networkerror|network request failed/i;
const TECHNICAL_ERROR_RE =
  /(api error|backend unreachable|bad gateway|nginx\/|traceback|segmentation fault|improperlyconfigured|secret_key|connection refused|aws secret|endpoint url)/i;

function flattenValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenValue).filter(Boolean).join(", ");
  if (value && typeof value === "object") return Object.values(value).map(flattenValue).filter(Boolean).join(", ");
  return "";
}

function isSafeForUser(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (HTML_FRAGMENT_RE.test(trimmed)) return false;
  if (TECHNICAL_ERROR_RE.test(trimmed)) return false;
  return true;
}

export function getApiErrorJson(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof ApiError)) return null;
  try {
    const parsed = JSON.parse(error.body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function getApiErrorCode(error: unknown): string | null {
  const code = getApiErrorJson(error)?.code;
  return typeof code === "string" && code.trim()
    ? code.trim().toLowerCase()
    : null;
}

export function isInsufficientComputeCredits(error: unknown) {
  return error instanceof ApiError
    && error.status === 403
    && getApiErrorCode(error) === "insufficient_compute_credits";
}

export function isApiNotFound(error: unknown) {
  if (error instanceof ApiError && error.status === 404) return true;
  const payload = getApiErrorJson(error);
  const text = flattenValue(payload ?? (error instanceof ApiError ? error.body : error instanceof Error ? error.message : ""));
  return text.toLowerCase().includes("not found");
}

/**
 * The backend writes its refusals in English ("Email verification required
 * before you can sign in.", "Invalid credentials."). Shown as they are, a
 * Slovak sign-in screen carried an English sentence in a red box. Each known
 * refusal maps to a locale key; anything unknown still passes through the
 * safety check above, so a new backend message is never hidden.
 */
export type ApiErrorKind = "verification" | "credentials" | "throttled" | "disabled" | "conflict" | "validation";

const KNOWN_ERROR_CODES: Record<string, { key: LocaleKey; kind: ApiErrorKind }> = {
  email_not_verified: { key: "auth.error.emailVerification", kind: "verification" },
  email_verification_required: { key: "auth.error.emailVerification", kind: "verification" },
  invalid_credentials: { key: "auth.error.invalidCredentials", kind: "credentials" },
  throttled: { key: "auth.error.throttled", kind: "throttled" },
  account_disabled: { key: "auth.session.accountDisabled", kind: "disabled" },
};

const KNOWN_ERROR_MESSAGES: Array<[RegExp, LocaleKey, ApiErrorKind]> = [
  [/^email verification required\b/i, "auth.error.emailVerification", "verification"],
  [/^invalid credentials\b/i, "auth.error.invalidCredentials", "credentials"],
  [/^too many (?:requests|attempts)\b/i, "auth.error.throttled", "throttled"],
  [/^request was throttled\b/i, "auth.error.throttled", "throttled"],
  [/^user account (?:is disabled|has been deleted)\b/i, "auth.session.accountDisabled", "disabled"],
  [/^a user with this email already exists\b/i, "auth.error.emailTaken", "conflict"],
  [/^this phone number is already registered\b/i, "auth.error.phoneTaken", "conflict"],
  [/^code must contain 6 digits\b/i, "auth.error.codeSixDigits", "validation"],
  [/^(?:code|otp) must be numeric\b/i, "auth.error.codeNumeric", "validation"],
  [/^code must be at least 6 characters\b/i, "auth.error.codeSixDigits", "validation"],
];

function apiErrorDetail(error: ApiError): string {
  const payload = getApiErrorJson(error);
  return payload
    ? flattenValue(payload.detail ?? payload.error ?? payload.message ?? payload.non_field_errors ?? payload)
    : error.body;
}

export function classifyApiError(error: unknown): { key: LocaleKey; kind: ApiErrorKind } | null {
  if (!(error instanceof ApiError)) return null;
  const code = getApiErrorCode(error);
  if (code && KNOWN_ERROR_CODES[code]) return KNOWN_ERROR_CODES[code];
  if (error.status === 429) return KNOWN_ERROR_CODES.throttled;
  const detail = apiErrorDetail(error).trim();
  for (const [pattern, key, kind] of KNOWN_ERROR_MESSAGES) {
    if (pattern.test(detail)) return { key, kind };
  }
  return null;
}

export function isEmailVerificationError(error: unknown) {
  return classifyApiError(error)?.kind === "verification";
}

export function getSafeApiErrorMessage(
  error: unknown,
  lang: string,
  fallbackKey: LocaleKey = "common.somethingWentWrongTryAgain",
) {
  if (error instanceof ApiError) {
    const known = classifyApiError(error);
    if (known) return t(known.key, lang);
    if (error.status >= 500) return t("common.serviceTemporarilyUnavailable", lang);

    const detail = apiErrorDetail(error);
    return isSafeForUser(detail) ? detail.trim().slice(0, 240) : t(fallbackKey, lang);
  }

  // fetch() rejects with a TypeError whose text is the browser's own
  // ("Failed to fetch", "Load failed"); it is never a sentence for the page.
  if (error instanceof TypeError && NETWORK_FAILURE_RE.test(error.message)) {
    return t("common.networkError", lang);
  }

  if (error instanceof Error && isSafeForUser(error.message)) {
    return error.message.slice(0, 240);
  }

  return t(fallbackKey, lang);
}
