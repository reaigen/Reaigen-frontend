"use client";

/**
 * Keeps the Agent panel's visible state alive across navigation.
 *
 * The shell is mounted by each page rather than by a shared layout, so every
 * route change unmounts the panel and its transcript with it. Chatting, opening
 * a draft the agent just mentioned, and coming back used to land on an empty
 * panel. Parking the transcript in sessionStorage restores it on the remount.
 *
 * sessionStorage, not localStorage: the transcript is conversation content, so
 * it should die with the tab. The `reaigen:` prefix also enrolls these keys in
 * the auth-boundary purge in `private-client-state`, so logging out or changing
 * identity drops them along with the rest of the private state.
 */

import { clearAgentPools } from "./agent-pool";

const TRANSCRIPT_PREFIX = "reaigen:agent:transcript:";
const PANEL_OPEN_KEY = "reaigen:agent:panel-open";

/** Bounds one bucket so a long session cannot exhaust the storage quota. */
const MAX_STORED_TURNS = 30;

/**
 * Reai is one site-wide assistant, so its conversation follows navigation.
 * Resource context is still supplied afresh with every request and proposals
 * remain server-bound to their signed draft IDs. Only the visible transcript
 * is global; the drag/drop working pool remains scoped to the current surface.
 */
export function agentTranscriptKey(): string {
  return `${TRANSCRIPT_PREFIX}global`;
}

export function readAgentTranscript<T>(key: string): T[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

export function writeAgentTranscript<T>(key: string, turns: T[]): void {
  if (typeof window === "undefined") return;
  try {
    if (turns.length === 0) {
      window.sessionStorage.removeItem(key);
      return;
    }
    window.sessionStorage.setItem(
      key,
      JSON.stringify(turns.slice(-MAX_STORED_TURNS)),
    );
  } catch {
    // A full quota must never break sending a message; the transcript simply
    // stops surviving navigation until there is room again.
  }
}

export function readAgentPanelOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(PANEL_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeAgentPanelOpen(open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (open) window.sessionStorage.setItem(PANEL_OPEN_KEY, "1");
    else window.sessionStorage.removeItem(PANEL_OPEN_KEY);
  } catch {
    // Non-fatal: the panel just reverts to opening closed after a navigation.
  }
}

/** Drops every transcript, the working pool, and the panel state. */
export function clearAgentSession(): void {
  if (typeof window === "undefined") return;
  try {
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key && key.startsWith(TRANSCRIPT_PREFIX)) {
        window.sessionStorage.removeItem(key);
      }
    }
    window.sessionStorage.removeItem(PANEL_OPEN_KEY);
  } catch {
    // Nothing actionable; the auth-boundary purge is the backstop.
  }
  clearAgentPools();
}
