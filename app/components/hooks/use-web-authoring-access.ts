"use client";

import * as React from "react";
import { getWebCreationAccess } from "../../lib/api/client";

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
 * `allowed: false`. Advanced editing is a separate backend verdict and stays
 * false unless the access response explicitly enables it.
 */
export function useWebAuthoringAccess(isAuthenticated: boolean): {
  allowed: boolean;
  advancedSplatEditor: boolean;
  loading: boolean;
} {
  const [allowed, setAllowed] = React.useState(false);
  const [advancedSplatEditor, setAdvancedSplatEditor] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    // Stay in the loading state while signed out rather than reporting a
    // decision: callers gate their own redirect on authentication, and a
    // premature `allowed: false` would race that and bounce the user somewhere
    // they did not ask to go.
    if (!isAuthenticated) {
      setAllowed(false);
      setAdvancedSplatEditor(false);
      return;
    }

    let active = true;
    setLoading(true);
    getWebCreationAccess()
      .then((access) => {
        if (!active) return;
        setAllowed(access.allowed === true);
        setAdvancedSplatEditor(
          access.capabilities?.advanced_splat_editor === true,
        );
      })
      .catch(() => {
        if (!active) return;
        setAllowed(false);
        setAdvancedSplatEditor(false);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAuthenticated]);

  return { allowed, advancedSplatEditor, loading };
}
