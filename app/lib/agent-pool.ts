"use client";

/**
 * The Agent window's working pool.
 *
 * Anything editable in the workspace can be dragged into the Agent panel and
 * kept there: a photo, or a single property parameter. The pool persists across
 * turns, so a conversation is held *about* a concrete set of things rather than
 * re-described in prose every message.
 *
 * Items are parked in sessionStorage beside the transcript, under the same
 * `reaigen:agent:` prefix, so they survive the per-page remount of the shell and
 * are dropped by the auth-boundary purge in `private-client-state`.
 */

/**
 * A private drag type. Using our own MIME keeps workspace drags from being
 * mistaken for text or file drops, and lets a drop zone tell them apart during
 * `dragover`, where only `types` is readable.
 */
export const AGENT_POOL_MIME = "application/x-reaigen-agent-item";

const POOL_PREFIX = "reaigen:agent:pool:";

/** Bounds the working set so a long session cannot exhaust the quota. */
export const MAX_POOL_ITEMS = 12;

export type AgentPoolImage = {
  kind: "image";
  uploadId: number;
  url: string;
  label: string;
};

export type AgentPoolField = {
  kind: "field";
  /** Canonical dotted path, e.g. "specs.layout.bedrooms" — what the agent acts on. */
  path: string;
  label: string;
  value: string;
};

export type AgentPoolItem = AgentPoolImage | AgentPoolField;

export function poolItemKey(item: AgentPoolItem): string {
  return item.kind === "image" ? `image:${item.uploadId}` : `field:${item.path}`;
}

function isPoolItem(value: unknown): value is AgentPoolItem {
  if (!value || typeof value !== "object") return false;
  // Intersecting the two members would make `kind` never, so read the shape
  // loosely and narrow on the discriminant by hand.
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "image") {
    return typeof candidate.uploadId === "number" && typeof candidate.url === "string";
  }
  if (candidate.kind === "field") {
    return typeof candidate.path === "string" && candidate.path.length > 0;
  }
  return false;
}

export function writeDragItem(dataTransfer: DataTransfer, item: AgentPoolItem): void {
  dataTransfer.setData(AGENT_POOL_MIME, JSON.stringify(item));
  // A readable fallback for drops outside the app; never read back by us.
  dataTransfer.setData("text/plain", item.label);
  dataTransfer.effectAllowed = "copy";
}

export function readDragItem(dataTransfer: DataTransfer): AgentPoolItem | null {
  try {
    const raw = dataTransfer.getData(AGENT_POOL_MIME);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPoolItem(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Readable during `dragover`, where the payload itself is not. */
export function dragHasPoolItem(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(AGENT_POOL_MIME);
}

export function dragHasFiles(dataTransfer: DataTransfer): boolean {
  if (Array.from(dataTransfer.types).includes("Files")) return true;
  return Array.from(dataTransfer.items ?? []).some((item) => item.kind === "file");
}

/** Adds without duplicating, keeping the most recent drop last. */
export function addPoolItem(items: AgentPoolItem[], next: AgentPoolItem): AgentPoolItem[] {
  const key = poolItemKey(next);
  const without = items.filter((item) => poolItemKey(item) !== key);
  return [...without, next].slice(-MAX_POOL_ITEMS);
}

export function removePoolItem(items: AgentPoolItem[], key: string): AgentPoolItem[] {
  return items.filter((item) => poolItemKey(item) !== key);
}

/**
 * The pool is bucketed exactly like the transcript: a photo dragged in while
 * working on one creation should not follow you onto another, where its upload
 * id is not editable.
 */
export function agentPoolKey(
  workspaceContext: string,
  draftId?: number | string | null,
): string {
  return `${POOL_PREFIX}${workspaceContext}:${draftId ?? "none"}`;
}

export function readAgentPool(key: string): AgentPoolItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPoolItem) : [];
  } catch {
    return [];
  }
}

export function writeAgentPool(key: string, items: AgentPoolItem[]): void {
  if (typeof window === "undefined") return;
  try {
    if (items.length === 0) {
      window.sessionStorage.removeItem(key);
      return;
    }
    window.sessionStorage.setItem(key, JSON.stringify(items.slice(-MAX_POOL_ITEMS)));
  } catch {
    // A full quota must never block dropping or sending.
  }
}

export function clearAgentPools(): void {
  if (typeof window === "undefined") return;
  try {
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key && key.startsWith(POOL_PREFIX)) window.sessionStorage.removeItem(key);
    }
  } catch {
    // The auth-boundary purge is the backstop.
  }
}

/** The wire shape sent to Django; labels stay client-side. */
export function poolItemsForRequest(items: AgentPoolItem[]) {
  return items.map((item) =>
    item.kind === "image"
      ? { kind: "image" as const, upload_id: item.uploadId }
      : { kind: "field" as const, path: item.path },
  );
}
