/**
 * Why a session ended, carried from the proxy to the sign-in screen.
 *
 * The backend refuses to renew a session for reasons that are the user's to
 * fix (an email address that lost its verification) or an administrator's
 * (a disabled account). Both used to surface as a silent bounce to the login
 * form — the app "kicked people out" with no explanation and no way back.
 * The proxy maps the refusal to one of these keys; the client keeps it just
 * long enough for the sign-in screen to say what happened.
 */
export type SessionEndReason = "email_verification" | "account_disabled" | "expired";

export const SESSION_END_REASON_HEADER = "X-Reaigen-Session-Reason";
const STORAGE_KEY = "reaigen:session-ended";

/** Map the backend's refusal detail to a reason the UI can act on. */
export function sessionEndReasonFromDetail(detail: unknown): SessionEndReason {
  const text = typeof detail === "string" ? detail.toLowerCase() : "";
  if (text.includes("verification") || text.includes("verify")) return "email_verification";
  if (text.includes("disabled") || text.includes("deleted") || text.includes("suspended") || text.includes("banned")) return "account_disabled";
  return "expired";
}

export function isSessionEndReason(value: unknown): value is SessionEndReason {
  return value === "email_verification" || value === "account_disabled" || value === "expired";
}

export function rememberSessionEndReason(reason: SessionEndReason): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, reason);
  } catch {
    // Storage unavailable: the sign-in screen simply shows no notice.
  }
}

/** Read the pending reason once; it is cleared so a later visit starts clean. */
export function takeSessionEndReason(): SessionEndReason | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
    return isSessionEndReason(value) ? value : null;
  } catch {
    return null;
  }
}
