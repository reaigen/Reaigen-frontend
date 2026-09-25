import assert from "node:assert/strict";
import test from "node:test";
import { pendingAgentTurn } from "./agent-conversation.ts";
import { isProposalCancellation, isProposalConfirmation } from "./agent-plan-confirmation.ts";

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

test("the card's own proposal, named, is a confirmation; a qualified or unrelated apply is not", () => {
  for (const [message, lang] of [
    ["Apply the pending change.", "en"], ["Now apply the earlier proposal.", "en"], ["Apply that diff.", "en"], ["ok, apply it", "en"],
    ["použi tú zmenu", "sk"], ["aplikuj návrh", "sk"], ["übernimm den Vorschlag", "de"], ["potvrď změnu", "cs"],
  ]) {
    assert.equal(isProposalConfirmation(message, lang), true, message);
  }
  for (const message of ["apply the discount to the price", "apply for a permit", "apply but change the price", "should I apply the pending change?"]) {
    assert.equal(isProposalConfirmation(message, "en"), false, message);
  }
});

test("a whole-message cancel withdraws the card; a cancel of something else does not", () => {
  for (const [message, lang] of [
    ["Cancel the title change. Keep the saved title.", "en"], ["cancel that change", "en"], ["forget it", "en"], ["discard the proposal", "en"],
    ["zruš to", "sk"], ["zruš tú zmenu, nechaj pôvodný názov", "sk"], ["verwirf den Vorschlag", "de"],
  ]) {
    assert.equal(isProposalCancellation(message, lang), true, message);
  }
  for (const message of ["cancel the viewing on Friday", "can I cancel?", "cancel and set the price to 250000"]) {
    assert.equal(isProposalCancellation(message, "en"), false, message);
  }
});
