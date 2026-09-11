/** Small, deterministic validators shared by setup and Settings forms. */

export function isEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Accept a human-friendly web address and return the canonical value sent to
 * Django. A missing scheme becomes HTTPS; malformed or non-web schemes fail.
 */
export function normalizeWebAddress(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    const hostname = parsed.hostname.toLowerCase();
    const isLocal = hostname === "localhost";
    const isIpAddress = hostname.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
    const isDomain = hostname.includes(".") && !hostname.startsWith(".") && !hostname.endsWith(".");
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      || (!isDomain && !isIpAddress && !isLocal)
      || parsed.username
      || parsed.password
    ) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

export function isValidOptionalWebAddress(value: string): boolean {
  return normalizeWebAddress(value) !== null;
}

export function countFormIssues(issues: Array<boolean | null | undefined>): number {
  return issues.filter(Boolean).length;
}
