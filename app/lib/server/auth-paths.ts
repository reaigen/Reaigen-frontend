/**
 * Which endpoints under `/api/v1/core/auth/` may carry a session.
 *
 * DRF authenticates before it checks permissions, so a stale bearer token makes
 * even an `AllowAny` view answer 401 — attaching one to `login` would lock out
 * exactly the person trying to repair a broken session. Those flows are listed
 * here and are sent bare.
 *
 * Everything else is treated as authenticated and gets the access token. That
 * default is deliberate: the endpoints needing credentials outnumber these and
 * keep growing, and the proxy used to send none at all, so every one of them
 * answered 401 unconditionally. The web client reads any 401 as a dead session,
 * so a single such call signed the user out of the entire app — opening
 * Settings, which reads TOTP status and linked accounts, was enough.
 */
const CREDENTIAL_FREE_AUTH_PATHS = new Set([
  "login",
  "register",
  "logout",
  "refresh",
  "token/refresh",
  "verify-email",
  "resend-verification",
  "password-reset/request",
  "password-reset/validate",
  "password-reset/confirm",
  "password-reset/sms/request",
  "password-reset/sms/confirm",
  // Step-up completion happens exactly when the caller has no working
  // session yet; a stale bearer here would 401 the very flow that fixes it.
  "step-up/verify",
]);

/** True when the proxy should attach the caller's access token to `joined`. */
export function authPathCarriesSession(joined: string): boolean {
  return !CREDENTIAL_FREE_AUTH_PATHS.has(joined.replace(/^\/+|\/+$/g, ""));
}
