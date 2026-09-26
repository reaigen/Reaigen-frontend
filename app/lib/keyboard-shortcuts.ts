/**
 * Keyboard shortcut labels in the platform's own notation.
 *
 * The description toolbar printed "⌘B · ⌘I · ⌘↵" on Windows (Bench 07,
 * B07-F07). The editor has always accepted Ctrl as well as ⌘; only the label
 * spoke Mac. Apple platforms keep the symbols, everything else reads Ctrl.
 */

export interface PlatformHints {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string } | null;
}

export function isApplePlatform(hints: PlatformHints | null | undefined): boolean {
  if (!hints) return false;
  const platform = hints.userAgentData?.platform || hints.platform || "";
  if (/mac|iphone|ipad|ipod/i.test(platform)) return true;
  return /Macintosh|Mac OS X|iPhone|iPad|iPod/.test(hints.userAgent ?? "");
}

const APPLE_KEYS: Record<string, string> = { Enter: "↵" };

/** "⌘B" on Apple platforms, "Ctrl+B" elsewhere. */
export function shortcutLabel(key: string, apple: boolean): string {
  return apple ? `⌘${APPLE_KEYS[key] ?? key}` : `Ctrl+${key}`;
}

/** The value for aria-keyshortcuts: both modifiers work everywhere. */
export function ariaShortcut(key: string): string {
  return `Control+${key} Meta+${key}`;
}
