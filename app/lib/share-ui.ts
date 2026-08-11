import { t, type LocaleKey } from "./i18n";
import { SHARE_BUNDLES, type ShareBundleName, type ShareData } from "./tour-types";

/** Shared helpers for the share-link UI (shares list, sharing page, link cards). */

export type ShareStats = {
  total_accesses: number;
  unique_ips: number;
  authenticated_accesses: number;
  failed_pin_attempts: number;
};

/**
 * Copy text, falling back to the legacy path when the async Clipboard API is
 * unavailable.
 *
 * `navigator.clipboard` only exists in a *secure context*, so on any plain-HTTP
 * origin — a LAN dev server, an internal deployment reached by IP — it is
 * simply `undefined` and every copy failed, dropping the user into the
 * "your browser blocked the clipboard, copy it by hand" panel. `execCommand`
 * is deprecated but carries no such requirement and is still honoured
 * everywhere, so it covers exactly the case the modern API cannot.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  const asyncApiUsable =
    typeof window !== "undefined"
    && window.isSecureContext
    && typeof navigator !== "undefined"
    && typeof navigator.clipboard?.writeText === "function";

  /*
   * Order matters, and this is the subtle part. Outside a secure context the
   * async API is either missing or rejects — but `await`ing it to find that out
   * *spends the user gesture*, and `execCommand` only works while that gesture
   * is still live. Trying the modern API first and falling back afterwards
   * therefore fails twice over on plain HTTP. When we already know the API
   * cannot work, go straight to the synchronous path instead.
   */
  if (!asyncApiUsable) return legacyCopy(text);

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Secure context but refused — a non-focused document, or a permissions
    // policy. Worth one synchronous attempt even with the gesture spent.
    return legacyCopy(text);
  }
}

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;

  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  // Not `display:none`, `visibility:hidden`, or `opacity:0` — none of them can
  // reliably hold a selection, so the copy silently fails. Off-screen but fully
  // rendered is the one state that stays invisible and stays selectable.
  // `position: fixed` keeps focusing it from scrolling the page, and the 16px
  // font size stops iOS zooming toward it.
  Object.assign(field.style, {
    position: "fixed",
    top: "0",
    left: "-9999px",
    width: "1px",
    height: "1px",
    padding: "0",
    margin: "0",
    border: "none",
    outline: "none",
    boxShadow: "none",
    background: "transparent",
    fontSize: "16px",
  } satisfies Partial<CSSStyleDeclaration>);

  document.body.appendChild(field);

  // Restore whatever the user had selected; hijacking it is a visible side
  // effect of pressing a copy button.
  const selection = document.getSelection();
  const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  try {
    field.select();
    field.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
    if (previousRange && selection) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }
  }
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
