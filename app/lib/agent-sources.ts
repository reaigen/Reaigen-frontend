import type { AgentPoolItem } from "./agent-pool";

export function discardAgentSourceTokens<T>(sources: Map<T, string>, sent: readonly string[]): void {
  for (const [file, token] of sources) {
    if (sent.includes(token)) sources.delete(file);
  }
}

/** A new signed listing context already contains the accepted source facts. */
export function consumeAcceptedAgentSources<T>(sources: Map<T, string>, sent: readonly string[], contextToken?: string | null): void {
  if (!contextToken) return;
  discardAgentSourceTokens(sources, sent);
}

/** Forget expiring extraction authority while retaining the saved evidence. */
export function discardPoolSourceTokens(pool: readonly AgentPoolItem[], sent: readonly string[]): AgentPoolItem[] {
  return pool.map((item) => item.kind === "document" && item.sourceToken && sent.includes(item.sourceToken)
    ? { ...item, sourceToken: undefined }
    : item);
}

/** Dropped files can return a creation review; displaying it executes nothing. */
export function isAgentAttachmentResponse(actionCode: string | null | undefined, requestSequence = 0, currentSequence = 0): boolean {
  return requestSequence === currentSequence
    && ["attachment_options", "create_listing", "clarify_new_listing", "discuss_new_listing", "tool_unavailable"].includes(actionCode ?? "");
}
