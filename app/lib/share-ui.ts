import { t, type LocaleKey } from "./i18n";
import { SHARE_BUNDLES, type ShareBundleName, type ShareData } from "./tour-types";

/** Shared helpers for the share-link UI (shares list, sharing page, link cards). */

export type ShareStats = {
  total_accesses: number;
  unique_ips: number;
  authenticated_accesses: number;
  failed_pin_attempts: number;
};

export async function copyToClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export function shareUrl(token: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/shared/${token}`;
}

export function detectBundleFromVisible(visible: string[]): ShareBundleName | null {
  const set = new Set(visible);
  for (const name of ["minimal", "less", "all"] as const) {
    const bundle = SHARE_BUNDLES[name];
    if (bundle.length === set.size && bundle.every((f) => set.has(f))) return name;
  }
  return null;
}

export function fieldSummaryLabel(share: ShareData, lang: string): string {
  if (share.fields?.length) {
    const visible = share.fields.filter((f) => f.is_visible).map((f) => f.field_name);
    const bundleName = detectBundleFromVisible(visible);
    if (bundleName) return t(`shareDialog.bundle.${bundleName}` as LocaleKey, lang);
    return `${visible.length} ${t("shareDialog.fieldSummary", lang)}`;
  }
  return t("shareDialog.bundle.less", lang);
}

export function expiryLabel(dateStr: string | null | undefined, lang: string): string | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  const days = Math.round(diff / 86400000);
  if (days < 0) return t("shares.expired", lang);
  if (days === 0) return t("shares.expirestoday", lang);
  if (days === 1) return t("shares.expirestomorrow", lang);
  return t("shares.daysShort", lang).replace("{n}", String(days));
}

export type ShareStatusTone = "neutral" | "success" | "warning" | "danger";

export const STATUS_CONFIG: Record<string, { tone: ShareStatusTone; labelKey: LocaleKey }> = {
  active:  { tone: "success", labelKey: "shares.statusActive" },
  paused:  { tone: "warning", labelKey: "shares.statusPaused" },
  expired: { tone: "neutral", labelKey: "shares.statusExpired" },
  revoked: { tone: "danger", labelKey: "shares.statusRevoked" },
};
