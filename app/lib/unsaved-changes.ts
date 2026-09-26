/**
 * Unsaved edits are kept or given up deliberately — never lost by moving on.
 *
 * Bench 07 (B07-F01): an unsaved Company in Settings → Seller profile was
 * gone after a look at another Settings section, with no question asked. The
 * sections now stay mounted once visited, so their drafts survive a tab
 * switch; leaving the page with unsaved edits — a link in the app, a reload,
 * closing the tab — asks first.
 */

export type SavedValue = string | boolean | number | null | undefined;

/** The names of the fields whose value differs from the saved one ("" and nothing are the same). */
export function changedFields(current: Record<string, SavedValue>, saved: Record<string, SavedValue>): string[] {
  const normalize = (value: SavedValue) => (value === null || value === undefined ? "" : value);
  return Object.keys(current).filter((key) => normalize(current[key]) !== normalize(saved[key]));
}

export interface ClickModifiers {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

export interface AnchorFacts {
  href: string;
  target: string;
  download: boolean;
}

/**
 * The in-app path a click on this link would open in this tab, or null when
 * the click stays on the page (a #section of Settings), opens elsewhere (a new
 * tab, another site, a download) or is not a plain click.
 */
export function leavingDestination(anchor: AnchorFacts, currentHref: string, click: ClickModifiers): string | null {
  if (click.defaultPrevented || click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  if (anchor.download || (anchor.target && anchor.target !== "_self")) return null;
  let destination: URL;
  let current: URL;
  try {
    current = new URL(currentHref);
    destination = new URL(anchor.href, current);
  } catch {
    return null;
  }
  if (destination.origin !== current.origin) return null;
  if (destination.pathname === current.pathname && destination.search === current.search) return null;
  return `${destination.pathname}${destination.search}${destination.hash}`;
}
