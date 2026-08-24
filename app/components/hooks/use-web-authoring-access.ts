"use client";

import * as React from "react";
import { hasWebCreationAccess } from "../../lib/api/client";

/**
 * Whether this account may open the browser authoring tools.
 *
 * The scene editor is internal tooling rather than a customer feature, and the
 * backend already says so: every web-creation and web-tour endpoint sits behind
 * `CanAuthorWebScenes`, which admits staff and superusers outright and everyone
 * else only with the explicit `web_scene_authoring` feature. This asks that
 * same question through `/web-creation/access/` instead of restating the rule
 * on the client, so the two cannot drift — a locally-invented check would be
 * one more place to update when the entitlement changes, and would disagree
 * silently when it did.
 *
 * It follows that this is presentation only. The server is the boundary and
 * refuses the work regardless; the point here is to avoid offering an editor
 * that would fail on its first save, and to keep the tool out of the way of
 * agents who have no use for it.
 *
 * Fails closed: unauthenticated, still loading, or an outright error all report
 * `allowed: false`. `hasWebCreationAccess` already folds 401 and 403 into a
 * plain `false`, so only real faults surface here, and those should not open a
 * destructive editor either.
 */
export function useWebAuthoringAccess(isAuthenticated: boolean): {
  allowed: boolean;
  loading: boolean;
} {
  const [allowed, setAllowed] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    // Stay in the loading state while signed out rather than reporting a
    // decision: callers gate their own redirect on authentication, and a
    // premature `allowed: false` would race that and bounce the user somewhere
    // they did not ask to go.
    if (!isAuthenticated) return;

    let active = true;
    setLoading(true);
    hasWebCreationAccess()
      .then((value) => { if (active) setAllowed(value); })
      .catch(() => { if (active) setAllowed(false); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAuthenticated]);

  return { allowed, loading };
}
