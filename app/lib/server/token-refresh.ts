import { fetchBackend } from "./backend-fetch";

/**
 * Silent token refresh, shared by every proxy that carries the session.
 *
 * Django runs SimpleJWT with `ROTATE_REFRESH_TOKENS` and
 * `BLACKLIST_AFTER_ROTATION`, which makes two things true that a naive
 * refresh gets wrong, and both of them log people out:
 *
 *  - A refresh answers with a *new* refresh token and revokes the one that
 *    was presented. Storing only the new access token leaves the browser
 *    holding a revoked refresh token, so the next silent refresh — one access
 *    lifetime later — fails and the session is thrown away.
 *  - Two refreshes with the same token cannot both win. A page that fires
 *    several requests at once gets several 401s at once; the first refresh
 *    revokes the token and the rest come back 401. Hence the in-flight map:
 *    concurrent callers share one refresh and one result.
 *
 * The map is per-process, so it does not serialise across replicas. That is
 * fine — it closes the window that a single page load opens, which is the one
 * that was actually firing.
 */

export interface RefreshedTokens {
  access: string;
  /** Null when the server chose not to rotate; keep using the presented one. */
  refresh: string | null;
}

const inFlight = new Map<string, Promise<RefreshedTokens | null>>();

async function requestRefresh(
  refreshToken: string,
  backendCandidates: string[],
): Promise<RefreshedTokens | null> {
  for (const baseUrl of backendCandidates) {
    try {
      const res = await fetchBackend(`${baseUrl}/api/v1/core/auth/refresh/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: refreshToken }),
        cache: "no-store",
      }, 5_000);
      // A 401 here is a verdict, not a transport problem: the token is revoked
      // or expired, and asking a different candidate origin cannot change that.
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) continue;
      const data = (await res.json()) as { access?: string; refresh?: string };
      if (!data.access) continue;
      return { access: data.access, refresh: data.refresh ?? null };
    } catch {
      continue;
    }
  }
  return null;
}

export function refreshSession(
  refreshToken: string,
  backendCandidates: string[],
): Promise<RefreshedTokens | null> {
  const pending = inFlight.get(refreshToken);
  if (pending) return pending;

  const attempt = requestRefresh(refreshToken, backendCandidates)
    .finally(() => {
      inFlight.delete(refreshToken);
    });
  inFlight.set(refreshToken, attempt);
  return attempt;
}
