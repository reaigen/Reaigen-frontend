import { useSyncExternalStore } from "react";

/**
 * Detail viewing modes, mirroring the list page's grid toggle: a focused
 * single-column reading width with generous whitespace (1), or the wide
 * two-column workspace (2). Persisted separately from the list preference.
 *
 * One store serves the loaded listing, its loading states and the silhouette
 * drawn while data is in flight. The skeleton must open at the width and
 * column count the page will settle into, or every navigation ends with a
 * second layout jump when the real content lands.
 */
export type DetailLayout = 1 | 2;

const STORAGE_KEY = "reaigen:detailLayout";
const CHANGE_EVENT = "reaigen:detail-layout";
const DEFAULT_LAYOUT: DetailLayout = 2;

/**
 * Server HTML cannot know the saved mode, so a cold load (hard refresh, direct
 * link) would paint the wide silhouette and slide down to the focused one once
 * hydration reads storage. Rendered as the first child of a
 * `.draft-detail-page`, this runs while the HTML streams in and stamps the
 * saved mode on that root before anything below it paints. React never
 * executes inline scripts it renders on the client, so it costs nothing on an
 * in-app navigation, where the store already answers synchronously.
 * Memoised object: React 19 re-applies innerHTML on identity change.
 */
export const DETAIL_LAYOUT_PRE_HYDRATION_HTML = {
  __html:
    `try{if(localStorage.getItem("${STORAGE_KEY}")==="1")` +
    `document.currentScript.parentElement.setAttribute("data-detail-layout","1")}catch(e){}`,
};

// Storage can be unavailable (private mode, quota) — the chosen mode still has
// to hold for this page, so the last written value lives here as well.
let current: DetailLayout | null = null;

function readStored(): DetailLayout {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1" ? 1 : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function readDetailLayout(): DetailLayout {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  if (current === null) current = readStored();
  return current;
}

export function writeDetailLayout(layout: DetailLayout): void {
  current = layout;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(layout));
  } catch {
    // Kept in memory above; nothing else to do.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    current = null;
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function serverSnapshot(): DetailLayout {
  return DEFAULT_LAYOUT;
}

/** The saved detail mode, live across every component that renders it. */
export function useDetailLayout(): DetailLayout {
  return useSyncExternalStore(subscribe, readDetailLayout, serverSnapshot);
}
