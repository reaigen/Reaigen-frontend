import assert from "node:assert/strict";
import test from "node:test";
import { pendingAgentTurn } from "./agent-conversation.ts";
import { isProposalConfirmation } from "./agent-plan-confirmation.ts";

test("typed mutation approval rejects refusal, questions and qualified commands", () => {
  for (const message of ["do not apply", "how do I save?", "save?", "apply but change the price", "don't confirm", "neulož to", "nicht speichern"]) {
    assert.equal(isProposalConfirmation(message, "en"), false, message);
  }
  for (const [message, lang] of [["Apply it, please!", "en"], ["ulož to", "sk"], ["použij to", "cs"], ["Speichern", "de"]]) {
    assert.equal(isProposalConfirmation(message, lang), true, message);
  }
});

test("a confirmation cannot search back to a stale proposal or finished action", () => {
  const proposal = { role: "assistant", response: { action_code: "edit_creation", proposal_token: "signed" } };
  assert.equal(pendingAgentTurn([proposal]), proposal);
  assert.equal(pendingAgentTurn([proposal, { role: "user" }, { role: "assistant", response: { action_code: "explain" } }]).response.action_code, "explain");
  assert.equal(pendingAgentTurn([proposal, { role: "assistant" }]), undefined);
  for (const status of ["applied", "dismissed", "pending", "failed"]) {
    assert.equal(pendingAgentTurn([{ ...proposal, actionStatus: status }]), undefined);
  }
  assert.equal(pendingAgentTurn([{ ...proposal, proposalStatus: "dismissed" }]), undefined);
  assert.equal(pendingAgentTurn([{ ...proposal, planId: "plan-1" }]), undefined);
});
