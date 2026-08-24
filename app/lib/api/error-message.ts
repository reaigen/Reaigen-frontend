import { ApiError } from "./client";
import { t, type LocaleKey } from "../i18n";

const HTML_FRAGMENT_RE = /<\/?[a-z][\s\S]*>/i;
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

export function isInsufficientComputeCredits(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 403) return false;
  const payload = getApiErrorJson(error);
  const text = flattenValue(
    payload?.detail ?? payload?.error ?? (error.body ?? ""),
  ).toLowerCase();
  return text.includes("compute credit");
}

export function isApiNotFound(error: unknown) {
  if (error instanceof ApiError && error.status === 404) return true;
  const payload = getApiErrorJson(error);
  const text = flattenValue(payload ?? (error instanceof ApiError ? error.body : error instanceof Error ? error.message : ""));
  return text.toLowerCase().includes("not found");
}

export function getSafeApiErrorMessage(
  error: unknown,
  lang: string,
  fallbackKey: LocaleKey = "common.somethingWentWrongTryAgain",
) {
  if (error instanceof ApiError) {
    if (error.status >= 500) return t("common.serviceTemporarilyUnavailable", lang);

    const payload = getApiErrorJson(error);
    const detail = payload
      ? flattenValue(payload.detail ?? payload.error ?? payload.message ?? payload.non_field_errors ?? payload)
      : error.body;

    return isSafeForUser(detail) ? detail.trim().slice(0, 240) : t(fallbackKey, lang);
  }

  if (error instanceof Error && isSafeForUser(error.message)) {
    return error.message.slice(0, 240);
  }

  return t(fallbackKey, lang);
}
