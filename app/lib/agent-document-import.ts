import type { ReaiAgentResponse, ReaiAgentSourceImageCandidate, ReaiSourceImportProgress } from "./api/client";

export const MAX_SOURCE_IMAGE_BYTES = 180_000;
export const MAX_SOURCE_IMAGE_PREVIEWS = 24;

/** Real server stages only. A missing status is not successful completion. */
export async function monitorSourceImportProgress(deps: {
  getStatus(): Promise<ReaiSourceImportProgress>;
  onProgress(progress: ReaiSourceImportProgress | null): void;
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  signal: AbortSignal;
  budgetMs?: number;
}): Promise<void> {
  const deadline = deps.now() + (deps.budgetMs ?? 90_000);
  const stages = new Set(["reading", "searching", "mapping", "validating", "ready", "needs_input", "failed"]);
  while (!deps.signal.aborted && deps.now() < deadline) {
    try {
      const progress = await deps.getStatus();
      if (deps.signal.aborted) return;
      if (stages.has(progress?.stage)) {
        deps.onProgress(progress);
        if (progress.terminal) return;
      } else deps.onProgress(null);
    } catch (error) {
      if (deps.signal.aborted) return;
      deps.onProgress(null);
      const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
      if (status === 401 || status === 403) return;
    }
    await deps.sleep(Math.min(4000, Math.max(0, deadline - deps.now())), deps.signal);
  }
  if (!deps.signal.aborted) deps.onProgress(null);
}

/** Attempted imports require an explicit retry; a later chat must not pay twice. */
export function unattemptedSourceImports(tokens: readonly string[], attempted: ReadonlySet<string>, draftId?: number): string[] {
  return [...new Set(tokens)].filter((token) => !attempted.has(`${draftId ?? "new"}:${token}`));
}

export function markSourceImportAttempt(tokens: readonly string[], attempted: Set<string>, draftId?: number): void {
  for (const token of tokens) attempted.add(`${draftId ?? "new"}:${token}`);
}

/** This endpoint returns candidates; even an accidental direct-edit flag is inert. */
export function reviewedSourceImport(response: ReaiAgentResponse): ReaiAgentResponse {
  return {
    ...response, direct_edit: false, direct_edit_draft_id: undefined,
    client_action: null, settings_changes: undefined, navigation_path: null,
    ...(response.source_import?.requires_input ? { proposal_token: null, action_token: null } : {}),
  };
}

/** Only the server's bounded, re-encoded JPEGs can enter the preview picker. */
export function sourceImageCandidates(candidates: readonly ReaiAgentSourceImageCandidate[] | undefined): ReaiAgentSourceImageCandidate[] {
  let total = 0;
  return (candidates ?? []).filter((candidate) => {
    if (!candidate || typeof candidate.id !== "string" || !/^p[1-9]\d*-image-[1-9]\d*$/.test(candidate.id) || candidate.id.length > 100
      || candidate.requires_review !== true || candidate.mime_type !== "image/jpeg"
      || !Number.isInteger(candidate.page) || candidate.page < 1 || candidate.page > 40
      || !Number.isInteger(candidate.width) || candidate.width < 1 || candidate.width > 1280
      || !Number.isInteger(candidate.height) || candidate.height < 1 || candidate.height > 1280
      || !Number.isInteger(candidate.byte_size) || candidate.byte_size < 4 || candidate.byte_size > MAX_SOURCE_IMAGE_BYTES
      || !/^[a-f0-9]{64}$/.test(candidate.sha256)
      || typeof candidate.preview_data_url !== "string"
      || candidate.preview_data_url.length > Math.ceil(MAX_SOURCE_IMAGE_BYTES / 3) * 4 + 23
      || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(candidate.preview_data_url)
      || total + candidate.byte_size > 1_500_000) return false;
    total += candidate.byte_size;
    return true;
  }).slice(0, 12);
}

/** Called only by a creator selection. Produces a local File, never an upload. */
export async function reviewedSourceImageFile(candidate: ReaiAgentSourceImageCandidate, sourceName: string): Promise<File> {
  if (sourceImageCandidates([candidate]).length !== 1) throw new Error("Invalid document image preview.");
  const raw = atob(candidate.preview_data_url.slice("data:image/jpeg;base64,".length));
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  if (bytes.length !== candidate.byte_size || bytes[0] !== 0xff || bytes[1] !== 0xd8
    || bytes[2] !== 0xff || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw new Error("Invalid document image preview.");
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((part) => part.toString(16).padStart(2, "0")).join("");
  if (digest !== candidate.sha256) throw new Error("Document image preview changed. Reattach the source.");
  const name = sourceName.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N} _-]/gu, "_").slice(0, 80) || "document";
  return new File([bytes], `${name}-${candidate.id}.jpg`, { type: "image/jpeg" });
}
