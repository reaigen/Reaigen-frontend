"use client";

import * as React from "react";
import { getLiveSplatAccess, type LiveSplatAccess } from "../../lib/api/client";

/** Presentation mirror of the backend's strict extra-user live-splat gate. */
export function useLiveSplatAccess(isAuthenticated: boolean): {
  allowed: boolean;
  loading: boolean;
  access: LiveSplatAccess | null;
} {
  const [access, setAccess] = React.useState<LiveSplatAccess | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    setLoading(true);
    getLiveSplatAccess()
      .then((value) => { if (active) setAccess(value); })
      .catch(() => { if (active) setAccess(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAuthenticated]);

  return { allowed: access?.allowed === true, loading, access };
}
