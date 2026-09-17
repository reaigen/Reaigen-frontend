"use client";

import {
  applyReaiCreationAction,
  applyReaiDescriptionAction,
  applyReaiMediaAction,
  applyReaiTranslationAction,
  applyReaiWorkspaceAction,
} from "./api/client";

/**
 * One confirmed Agent action, executed without touching any UI state.
 *
 * The chat card used to hold these calls inline, each branch updating its own
 * turn and returning nothing, so a caller could not tell success from failure.
 * An action plan needs exactly that distinction: it runs the same confirmed
 * actions through the same apply endpoints and decides what happens next from
 * the typed result, or stops on the thrown `ApiError`. Keeping one executor for
 * both paths means a plan step and a tapped card can never diverge on which
 * endpoint an action code reaches.
 */

export const AGENT_MEDIA_ACTION_CODES = [
  "grade_draft_images",
  "retouch_draft_image",
  "cleanplate_draft_images",
  "generative_hdr_draft_image",
  "organize_draft_images",
  "generate_draft_video",
] as const;

export type AgentActionResult =
  | { kind: "translate_description"; result: Awaited<ReturnType<typeof applyReaiTranslationAction>> }
  | { kind: "create_listing"; result: Awaited<ReturnType<typeof applyReaiCreationAction>> }
  | { kind: "generate_description"; result: Awaited<ReturnType<typeof applyReaiDescriptionAction>> }
  | { kind: "media"; result: Awaited<ReturnType<typeof applyReaiMediaAction>> }
  | { kind: "workspace"; result: Awaited<ReturnType<typeof applyReaiWorkspaceAction>> };

export function isAgentMediaActionCode(actionCode: string | null | undefined): boolean {
  return (AGENT_MEDIA_ACTION_CODES as readonly string[]).includes(actionCode || "");
}

/**
 * Apply a confirmed action token. Photo uploads, the follow-up turn and
 * navigation after `create_listing` stay with the caller: the chat card does
 * them for a tapped card, and a plan runs them as steps of its own.
 */
export async function executeAgentAction(
  actionCode: string | null | undefined,
  actionToken: string,
  improvementConversationId: string | null,
): Promise<AgentActionResult> {
  if (actionCode === "translate_description") {
    return { kind: "translate_description", result: await applyReaiTranslationAction(actionToken, improvementConversationId) };
  }
  if (actionCode === "create_listing") {
    return { kind: "create_listing", result: await applyReaiCreationAction(actionToken, improvementConversationId) };
  }
  if (actionCode === "generate_description") {
    return { kind: "generate_description", result: await applyReaiDescriptionAction(actionToken, improvementConversationId) };
  }
  if (isAgentMediaActionCode(actionCode)) {
    return { kind: "media", result: await applyReaiMediaAction(actionToken, improvementConversationId) };
  }
  // Everything else is a sharing action (create, manage or revoke links).
  return { kind: "workspace", result: await applyReaiWorkspaceAction(actionToken, improvementConversationId) };
}

/**
 * Tell the rest of the workspace what an applied action changed: the listing
 * grid, an open draft page and the sharing panel each refresh from these.
 */
export function announceAgentActionResult(outcome: AgentActionResult): void {
  if (typeof window === "undefined") return;
  if (outcome.kind === "translate_description") {
    window.dispatchEvent(new CustomEvent("reai-creations-updated", {
      detail: { draftIds: [outcome.result.draft_id], translationStatus: outcome.result.status },
    }));
    return;
  }
  if (outcome.kind === "create_listing" || outcome.kind === "generate_description") {
    window.dispatchEvent(new CustomEvent("reai-creations-updated", {
      detail: { draftIds: [outcome.result.draft_id] },
    }));
    return;
  }
  if (outcome.kind === "media") {
    const result = outcome.result;
    window.dispatchEvent(new CustomEvent("reai-media-updated", {
      detail: { draftId: result.draft_id, action: result.action, pending: result.status === "pending" },
    }));
    window.dispatchEvent(new CustomEvent("reai-creations-updated", { detail: { draftIds: [result.draft_id] } }));
    return;
  }
  const result = outcome.result;
  if (result.action === "revoke_all_shares" || result.action === "manage_shares") {
    window.dispatchEvent(new CustomEvent("reai-shares-updated", {
      detail: {
        revokedCount: result.revoked_count,
        updatedCount: "updated_count" in result ? result.updated_count : result.revoked_count,
        operation: "operation" in result ? result.operation : "revoke",
      },
    }));
    return;
  }
  window.dispatchEvent(new CustomEvent("reai-shares-updated", {
    detail: { created: result.created, draftId: result.draft_id, shareId: result.share_id },
  }));
}
