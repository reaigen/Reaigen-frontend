"use client";

import { resetPrivateApiState } from "./api/client";
import { clearSplatCache } from "./splat-cache";

export const AUTH_BOUNDARY_STORAGE_KEY = "reaigen:auth-boundary";

const PRIVATE_SESSION_PREFIXES = [
  "reaigen:concepts:",
  "reaigen:draft:",
  // Agent transcripts and panel state, parked so they survive navigation.
  "reaigen:agent:",
];

/**
 * Purge data that belongs to an authenticated identity. UI-only preferences
 * stay intact; private API payloads and reconstruction buffers do not.
 */
export async function clearPrivateBrowserState(): Promise<void> {
  resetPrivateApiState();
  if (typeof window === "undefined") return;

  for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = window.sessionStorage.key(index);
    if (key && PRIVATE_SESSION_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      window.sessionStorage.removeItem(key);
    }
  }

  const cacheCleanup = "caches" in window
    ? window.caches.keys().then((names) => Promise.all(
        names
          .filter((name) => name.toLowerCase().includes("reaigen"))
          .map((name) => window.caches.delete(name)),
      )).then(() => undefined).catch(() => undefined)
    : Promise.resolve();

  await Promise.allSettled([
    clearSplatCache(),
    cacheCleanup,
  ]);
}

export function broadcastAuthBoundary(kind: "login" | "logout" | "expired") {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      AUTH_BOUNDARY_STORAGE_KEY,
      JSON.stringify({ kind, at: Date.now(), nonce: crypto.randomUUID() }),
    );
  } catch {
    // Storage may be disabled; the current tab is still cleared directly.
  }
}
