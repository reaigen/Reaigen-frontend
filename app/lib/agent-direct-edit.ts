import type { ReaiAgentResponse } from "./api/client";

export type AgentEditContext = {
  draftId?: number;
  userId?: number;
  generation: number;
  consented: boolean;
};

export type AgentEditUndo = { draftId: number; revisionId: number; expectedRevisionId: number };

/**
 * The server proves every proposed value came from the current typed message.
 * Attached sources do not cancel that intent; source-derived suggestions lack
 * this trusted flag and still require confirmation.
 */
export function canApplyDirectEdit(answer: ReaiAgentResponse, context: AgentEditContext): boolean {
  return context.consented && Number.isInteger(context.draftId) && (context.draftId ?? 0) > 0
    && Number.isInteger(context.userId) && (context.userId ?? 0) > 0
    && answer.direct_edit === true
    && answer.direct_edit_draft_id === context.draftId && answer.execution_mode === "deterministic"
    && answer.selected_creation_ids?.length === 1 && answer.selected_creation_ids[0] === context.draftId
    && typeof answer.proposal_token === "string" && answer.proposal_token.length > 0
    && Object.keys(answer.proposed_changes).length > 0
    && !answer.action_token && !answer.client_action && !answer.plan && !answer.plan_token;
}

/** An ask may finish after navigation, reset, revocation or an account switch. */
export function isCurrentEditContext(expected: AgentEditContext, current: AgentEditContext): boolean {
  return current.consented && expected.consented
    && expected.draftId === current.draftId && expected.userId === current.userId
    && expected.generation === current.generation;
}

/** Undo is tied to the exact applied revision; the server rejects later edits. */
export function proposalUndo(result: {
  applied_draft_ids: number[];
  undo_revision_id?: number | null;
  applied_revision_id?: number | null;
}, draftId?: number): AgentEditUndo | undefined {
  if (!draftId || result.applied_draft_ids.length !== 1 || result.applied_draft_ids[0] !== draftId
    || !Number.isInteger(result.undo_revision_id) || (result.undo_revision_id ?? 0) <= 0
    || !Number.isInteger(result.applied_revision_id) || (result.applied_revision_id ?? 0) <= 0
    || result.undo_revision_id === result.applied_revision_id) return undefined;
  return { draftId, revisionId: result.undo_revision_id!, expectedRevisionId: result.applied_revision_id! };
}
