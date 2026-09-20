import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { canApplyDirectEdit, isCurrentEditContext, proposalUndo } from "./agent-direct-edit.ts";

const context = { draftId: 12, userId: 8, generation: 2, consented: true };
const answer = {
  direct_edit: true, direct_edit_draft_id: 12, execution_mode: "deterministic",
  selected_creation_ids: [12], proposal_token: "signed", proposed_changes: { price: 240000 },
};

test("only server-verified deterministic typed values for the current single draft save directly", () => {
  assert.equal(canApplyDirectEdit(answer, context), true);
  for (const change of [
    { direct_edit: undefined }, { direct_edit: false }, { direct_edit: "true" },
    { direct_edit_draft_id: 13 }, { execution_mode: "standard" }, { execution_mode: "reasoning" },
    { selected_creation_ids: [12, 13] }, { selected_creation_ids: [13] }, { selected_creation_ids: [] },
    { proposal_token: null }, { proposal_token: "" }, { proposed_changes: {} },
    { action_token: "paid" }, { client_action: {} }, { plan: {} }, { plan_token: "signed-plan" },
  ]) assert.equal(canApplyDirectEdit({ ...answer, ...change }, context), false, JSON.stringify(change));
  for (const change of [{ draftId: undefined }, { draftId: 0 }, { userId: undefined }, { consented: false }]) {
    assert.equal(canApplyDirectEdit(answer, { ...context, ...change }), false);
  }
});

test("late draft replies cannot auto-apply after navigation, account change, reset or revocation", async () => {
  assert.equal(isCurrentEditContext(context, { ...context }), true);
  for (const change of [{ draftId: 13 }, { userId: 9 }, { generation: 3 }, { consented: false }]) {
    let current = context;
    let writes = 0;
    const pending = Promise.resolve(answer).then((response) => {
      if (isCurrentEditContext(context, current) && canApplyDirectEdit(response, context)) writes += 1;
    });
    current = { ...context, ...change };
    await pending;
    assert.equal(writes, 0);
  }
});

test("undo needs the exact server-returned revision pair for this draft, never guessed history", () => {
  const result = { applied_draft_ids: [12], undo_revision_id: 20, applied_revision_id: 21 };
  assert.deepEqual(proposalUndo(result, 12), { draftId: 12, revisionId: 20, expectedRevisionId: 21 });
  for (const change of [
    { applied_draft_ids: [13] }, { applied_draft_ids: [12, 13] }, { undo_revision_id: undefined },
    { applied_revision_id: undefined }, { undo_revision_id: 21 }, { undo_revision_id: -1 },
  ]) assert.equal(proposalUndo({ ...result, ...change }, 12), undefined);
  assert.equal(proposalUndo(result), undefined);
});

test("apply retains authoritative undo revisions; Undo sends the expected revision and never retries a stale restore", async () => {
  registerHooks({ resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); } catch (error) {
      if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  } });
  const client = await import("./api/client.ts");
  const original = globalThis.fetch;
  const requests = [];
  const applied = { applied: ["price"], applied_draft_ids: [12], current_draft: { id: 12 }, undo_revision_id: 20, applied_revision_id: 21 };
  client.resetPrivateApiState();
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return String(url).endsWith("apply/")
      ? new Response(JSON.stringify(applied), { status: 200 })
      : new Response(JSON.stringify({ detail: "The listing changed after this edit." }), { status: 409 });
  };
  try {
    const result = await client.applyReaiWorkspaceProposal("signed", 12, "conversation");
    assert.deepEqual(proposalUndo(result, 12), { draftId: 12, revisionId: 20, expectedRevisionId: 21 });
    assert.equal(requests[0].body.proposal_token, "signed");
    assert.equal(requests[0].body.current_draft_id, 12);
    await assert.rejects(client.restoreAgentCreationRevision(12, 20, 21), (error) => error.status === 409);
    assert.deepEqual(requests[1].body, { confirmed: true, expected_revision_id: 21 });
    assert.match(requests[1].url, /drafts\/12\/history\/20\/restore\/$/);
    assert.equal(requests.length, 2, "a stale Undo is never replayed");
    await assert.rejects(client.restoreAgentCreationRevision(12, 20));
    assert.deepEqual(requests[2].body, { confirmed: true }, "manual history restore keeps its separate explicit confirmation flow");
  } finally {
    globalThis.fetch = original;
    client.resetPrivateApiState();
  }
});
