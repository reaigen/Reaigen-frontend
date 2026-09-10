/**
 * HTTP statuses for which a bounded automatic GET retry is safe and useful.
 *
 * 429 is deliberately absent. A rate-limit response is an explicit server
 * instruction to stop; retrying it immediately consumes more allowance on
 * sliding-window throttles and can extend an account-specific lockout.
 */
const RETRYABLE_GET_HTTP_STATUSES = new Set([
  408,
  425,
  502,
  503,
  504,
  520,
  521,
  522,
  523,
  524,
]);

export function isRetryableGetHttpStatus(status: number): boolean {
  return RETRYABLE_GET_HTTP_STATUSES.has(status);
}
