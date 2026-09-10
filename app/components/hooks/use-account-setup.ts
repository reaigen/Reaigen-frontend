"use client";

import * as React from "react";
import {
  ApiError,
  getReaiAgentConsent,
  getReaiToolPermissions,
  getUserCapabilities,
  type ReaiAgentConsent,
  type ReaiToolPermissions,
  type UserCapabilities,
  type UserProfile,
} from "../../lib/api/client";
import { computeAccountSetupStatus, type AccountSetupStatus } from "../../lib/account-setup";

interface SetupSignals {
  consent: ReaiAgentConsent | "blocked" | null;
  toolPermissions: ReaiToolPermissions | null;
  capabilities: UserCapabilities | null;
}

/**
 * Account setup status for the signed-in user.
 *
 * Profile, seller and billing gaps come straight from the profile payload
 * and are known on the first render. Agent consent, tool permissions and the
 * backend's access verdict need their own requests; until they answer the
 * status is reported with \`loading\` so callers can hold a decision (the
 * sign-in redirect) without rendering a guess.
 */
export function useAccountSetup(user: UserProfile | null) {
  const [signals, setSignals] = React.useState<SetupSignals | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const userId = user?.id ?? null;

  React.useEffect(() => {
    if (userId === null) {
      setSignals(null);
      return;
    }
    let active = true;
    (async () => {
      const [consentResult, capabilitiesResult] = await Promise.allSettled([
        getReaiAgentConsent(),
        getUserCapabilities(),
      ]);
      // A 403 here is the backend refusing the account, not a missing
      // preference — the status surfaces it as a blocker instead of a gap.
      const consent: SetupSignals["consent"] = consentResult.status === "fulfilled"
        ? consentResult.value
        : consentResult.reason instanceof ApiError && consentResult.reason.status === 403
          ? "blocked"
          : null;
      let toolPermissions: ReaiToolPermissions | null = null;
      if (consent !== null && consent !== "blocked" && consent.consented) {
        try {
          toolPermissions = await getReaiToolPermissions();
        } catch {
          toolPermissions = null;
        }
      }
      if (!active) return;
      setSignals({
        consent,
        toolPermissions,
        capabilities: capabilitiesResult.status === "fulfilled" ? capabilitiesResult.value : null,
      });
    })();
    return () => {
      active = false;
    };
    // `user` (not just its id) on purpose: every profile refresh re-reads the
    // verdicts, which the API client serves from cache unless a write to the
    // profile, billing or phone endpoints invalidated them.
  }, [userId, user, nonce]);

  // Settings and the guided flow announce consent changes on this event.
  React.useEffect(() => {
    const refresh = () => setNonce((value) => value + 1);
    window.addEventListener("reai-consent-changed", refresh);
    return () => window.removeEventListener("reai-consent-changed", refresh);
  }, []);

  const refresh = React.useCallback(() => setNonce((value) => value + 1), []);

  const status: AccountSetupStatus | null = React.useMemo(() => {
    if (!user) return null;
    return computeAccountSetupStatus({
      user,
      consent: signals?.consent ?? null,
      toolPermissions: signals?.toolPermissions ?? null,
      capabilities: signals?.capabilities ?? null,
    });
  }, [user, signals]);

  return { status, loading: user !== null && signals === null, signals, refresh };
}
