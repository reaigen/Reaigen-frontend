export type QuotaPresentationKind =
  | "unknown"
  | "blocked"
  | "unavailable"
  | "unlimited"
  | "limited";

export interface QuotaPresentation {
  kind: QuotaPresentationKind;
  used: number;
  limit: number | null;
  percent: number;
}

/**
 * Convert the backend quota convention into a display-safe state.
 *
 * `-1` is unlimited and `0` is unavailable. Product access wins over a
 * positive numeric allowance, because an inactive app must never appear
 * usable merely because its tier keeps a future launch limit.
 */
export function resolveQuotaPresentation(
  quota: { used: number; limit: number } | null | undefined,
  productAllowed: boolean | null | undefined = true,
): QuotaPresentation {
  if (productAllowed === false) {
    return { kind: "blocked", used: 0, limit: null, percent: 0 };
  }
  if (!quota || productAllowed == null) {
    return { kind: "unknown", used: 0, limit: null, percent: 0 };
  }

  const used = Number.isFinite(quota.used) ? Math.max(0, quota.used) : 0;
  const limit = Number.isFinite(quota.limit) ? quota.limit : 0;
  if (limit === -1) {
    return { kind: "unlimited", used, limit, percent: 0 };
  }
  if (limit <= 0) {
    return { kind: "unavailable", used, limit, percent: 0 };
  }
  return {
    kind: "limited",
    used,
    limit,
    percent: Math.min(100, (used / limit) * 100),
  };
}

