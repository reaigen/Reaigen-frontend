import type { DraftDetailItem, DraftListingItem } from "./tour-types";

// v2 clears entries that contained expired signed image URLs. Concept cards now
// render through stable, authenticated preview URLs keyed by upload id.
const CACHE_VERSION = "v2";
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_ENTRY_BYTES = 1_500_000;

type Envelope<T> = {
  ownerId: string;
  savedAt: number;
  data: T;
};

export type CachedDraftPage = {
  results: DraftListingItem[];
  count: number;
  next: string | null;
};

function read<T>(key: string, ownerId: string | number): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as Envelope<T>;
    if (envelope.ownerId !== String(ownerId) || Date.now() - envelope.savedAt > MAX_AGE_MS) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return envelope.data;
  } catch {
    return null;
  }
}

function write<T>(key: string, ownerId: string | number, data: T) {
  if (typeof window === "undefined") return;
  try {
    const serialized = JSON.stringify({ ownerId: String(ownerId), savedAt: Date.now(), data } satisfies Envelope<T>);
    if (serialized.length > MAX_ENTRY_BYTES) return;
    window.sessionStorage.setItem(key, serialized);
  } catch {
    // A cache write must never block the live experience (private mode/quota).
  }
}

function draftPageKey() {
  return `reaigen:concepts:${CACHE_VERSION}`;
}

function draftDetailKey(draftId: number) {
  return `reaigen:draft:${draftId}:${CACHE_VERSION}`;
}

export function readDraftPageCache(ownerId: string | number): CachedDraftPage | null {
  return read<CachedDraftPage>(draftPageKey(), ownerId);
}

export function writeDraftPageCache(ownerId: string | number, data: CachedDraftPage) {
  write(draftPageKey(), ownerId, data);
}

export function readDraftDetailCache(ownerId: string | number, draftId: number): DraftDetailItem | null {
  return read<DraftDetailItem>(draftDetailKey(draftId), ownerId);
}

export function writeDraftDetailCache(ownerId: string | number, draftId: number, data: DraftDetailItem) {
  write(draftDetailKey(draftId), ownerId, data);
}
