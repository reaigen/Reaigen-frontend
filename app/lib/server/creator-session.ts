import { fetchBackend } from "./backend-fetch";
import { refreshSession } from "./token-refresh";
import type { SessionEndReason } from "../session-end";

const BACKEND_URL = process.env.REAIGEN_BACKEND_URL ?? "http://localhost:8000";

function backendCandidates(): string[] {
  const configured = BACKEND_URL.replace(/\/+$/, "");
  const candidates = [configured];

  try {
    const url = new URL(configured);
    const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (isLocalhost) {
      const currentPort = url.port || (url.protocol === "https:" ? "443" : "80");
      candidates.push(...[80, 8000]
        .filter((port) => String(port) !== currentPort)
        .map((port) => `${url.protocol}//${url.hostname}:${port}`));
    }
  } catch {
    // A malformed configured URL will fail closed as an unavailable backend.
  }

  return [...new Set(candidates)];
}

type AccessProbe = "valid" | "refused" | "unavailable";

async function probeAccessToken(accessToken: string, candidates: string[]): Promise<AccessProbe> {
  for (const baseUrl of candidates) {
    try {
      const response = await fetchBackend(`${baseUrl}/api/v1/core/users/me/`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Reaigen-Client": "web",
        },
        cache: "no-store",
      }, 5_000);

      if (response.ok) return "valid";
      if (response.status === 401 || response.status === 403) return "refused";
    } catch {
      // Try a configured local fallback before treating the backend as down.
    }
  }

  return "unavailable";
}

export type CreatorSessionVerification =
  | {
    ok: true;
    access: string;
    refresh: string | null;
    refreshed: boolean;
  }
  | {
    ok: false;
    refused: boolean;
    reason?: SessionEndReason;
  };

/**
 * Verify a creator session against Django before returning browser-only
 * credentials. Cookie presence is not authentication: both expired tokens and
 * attacker-supplied strings must fail closed, while a legitimate refresh token
 * still receives the same silent rotation used by the main API proxy.
 */
export async function verifyCreatorSession(
  accessToken: string | null,
  refreshToken: string | null,
): Promise<CreatorSessionVerification> {
  const candidates = backendCandidates();

  if (accessToken) {
    const accessProbe = await probeAccessToken(accessToken, candidates);
    if (accessProbe === "valid") {
      return { ok: true, access: accessToken, refresh: refreshToken, refreshed: false };
    }
    if (accessProbe === "unavailable") {
      return { ok: false, refused: false };
    }
  }

  if (!refreshToken) {
    return { ok: false, refused: true, reason: "expired" };
  }

  const refresh = await refreshSession(refreshToken, candidates);
  if (!refresh.ok) {
    return refresh.refused
      ? { ok: false, refused: true, reason: refresh.reason }
      : { ok: false, refused: false };
  }

  const refreshedAccessProbe = await probeAccessToken(refresh.tokens.access, candidates);
  if (refreshedAccessProbe === "valid") {
    return {
      ok: true,
      access: refresh.tokens.access,
      refresh: refresh.tokens.refresh ?? refreshToken,
      refreshed: true,
    };
  }

  return refreshedAccessProbe === "refused"
    ? { ok: false, refused: true, reason: "expired" }
    : { ok: false, refused: false };
}
