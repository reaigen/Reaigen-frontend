/**
 * Path-segment validation for the same-origin backend proxies.
 *
 * The `[...path]` segments are interpolated straight into the upstream URL
 * (`${baseUrl}/api/v1/reaigen/${joined}`), and `fetch` resolves dot-segments
 * before the request leaves the process. An unchecked `..` therefore climbs
 * out of the intended `/api/v1/<app>/` prefix and reaches unrelated backend
 * paths while still carrying the caller's bearer token — and the Django origin
 * is not directly reachable from the internet, so the proxy is the only thing
 * standing in front of those paths.
 *
 * The backend already applies exactly this rule to its own internal service
 * URLs (`core/utils.py: validate_internal_service_url`); this keeps the web
 * tier consistent with it.
 *
 * Deliberately a narrow denylist rather than a character allowlist: legitimate
 * segments include share tokens (`secrets.token_urlsafe`), numeric ids, and
 * content-document keys, which the backend matches as `[a-z0-9_.-]+` — so dots
 * inside a segment are valid and only a *whole* segment of `.`/`..` is not.
 */

/**
 * WHATWG URL treats `.` and `..` and their percent-encoded spellings as
 * dot-segments, so `%2e%2e`, `.%2e` and `%2E.` all normalize exactly like `..`.
 * Matching the encoded forms matters because the router may hand us a segment
 * that is still encoded.
 */
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;

/**
 * Characters that re-open URL parsing after interpolation: `\` is a path
 * separator for special schemes, `?` starts the query and `#` the fragment.
 * None of them appear in any path this proxy legitimately forwards.
 */
const URL_DELIMITERS = /[\\?#]/;

/** True when a single routed segment is safe to interpolate into the target URL. */
export function isSafeProxySegment(segment: string): boolean {
  if (URL_DELIMITERS.test(segment)) return false;
  // A decoded `%2F` can smuggle a separator inside what the router delivered
  // as one segment, so re-split before testing for dot-segments.
  return segment.split("/").every((piece) => !DOT_SEGMENT.test(piece));
}

/**
 * True when every routed segment is safe. An empty path is rejected: the
 * catch-all route requires at least one segment, so it should never occur.
 */
export function isSafeProxyPath(segments: readonly string[]): boolean {
  return segments.length > 0 && segments.every(isSafeProxySegment);
}
