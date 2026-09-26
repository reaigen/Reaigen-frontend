import assert from "node:assert/strict";
import test from "node:test";
import { pendingAgentTurn } from "./agent-conversation.ts";
import { agentTurnContext, contextMarks, otherListingOf, stampTurnContexts } from "./agent-turn-context.ts";
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

// Bench 07 (B07-F04): one conversation follows the creator across listings.

test("each turn keeps the listing it was made in; the transcript marks where that changes", () => {
  const sale = agentTurnContext("draft", 12045, "B06 UX Predaj");
  const rental = agentTurnContext("draft", 12044, "B06 UX Prenájom");
  const workspace = agentTurnContext("creator", undefined, "Bez konceptu");
  assert.deepEqual(sale, { key: "draft:12045", label: "B06 UX Predaj", draftId: 12045 });
  assert.deepEqual(workspace, { key: "creator", label: "Bez konceptu" });

  const turns = [
    { id: 1, role: "user", context: sale },
    { id: 2, role: "assistant", context: sale },
    { id: 3, role: "user", context: rental },
    { id: 4, role: "assistant", context: rental },
  ];
  const onRental = contextMarks(turns, rental);
  assert.deepEqual([...onRental.before.keys()], [3], "a divider where the rental starts");
  assert.equal(onRental.trailing, null, "nothing after: the rental is open");

  // Back on the dashboard with the conversation still showing the rental.
  const onDashboard = contextMarks(turns, workspace);
  assert.deepEqual(onDashboard.trailing, workspace);

  // The bench's case: the sale's cards, then the rental opened, nothing sent yet.
  assert.deepEqual(contextMarks(turns.slice(0, 2), rental).trailing, rental);
  assert.equal(contextMarks([], rental).trailing, null, "an empty conversation needs no divider");

  // A transcript saved before contexts existed: the first recorded turn is marked.
  const legacy = [{ id: 1, role: "assistant", context: null }, { id: 2, role: "user", context: rental }];
  assert.deepEqual([...contextMarks(legacy, rental).before.keys()], [2]);
});

test("a turn is stamped once, with the context it was made in", () => {
  const sale = agentTurnContext("draft", 12045, "B06 UX Predaj");
  const rental = agentTurnContext("draft", 12044, "B06 UX Prenájom");
  const turns = [{ id: 1, role: "assistant", context: sale }, { id: 2, role: "assistant" }, { id: 3, role: "assistant", context: null }];
  const stamped = stampTurnContexts(turns, rental);
  assert.equal(stamped[0].context, sale, "an asked turn keeps the listing it was asked about");
  assert.equal(stamped[1].context, rental);
  assert.equal(stamped[2].context, null, "a restored legacy turn stays unknown");
  assert.equal(stampTurnContexts(stamped, sale), stamped, "nothing to stamp, same array (no render loop)");
});

test("a card made for another listing is labelled and cannot be confirmed from here", () => {
  const sale = agentTurnContext("draft", 12045, "B06 UX Predaj");
  const rental = agentTurnContext("draft", 12044, "B06 UX Prenájom");
  const workspace = agentTurnContext("creator", undefined, "Bez konceptu");
  const saleCard = { id: 7, role: "assistant", context: sale, response: { action_code: "edit_creation", proposal_token: "signed" } };
  assert.equal(otherListingOf(saleCard, rental), sale);
  assert.equal(otherListingOf(saleCard, sale), null);
  assert.equal(otherListingOf({ ...saleCard, context: workspace }, rental), null, "a workspace card is no listing's");
  assert.equal(otherListingOf({ id: 8, role: "user", context: sale }, rental), null);

  // "ulož to" on the rental must not apply the sale's card above it.
  assert.equal(pendingAgentTurn([saleCard], rental.key), undefined);
  assert.equal(pendingAgentTurn([saleCard], sale.key), saleCard);
  assert.equal(pendingAgentTurn([saleCard]), saleCard, "callers without a context keep the old rule");
  assert.equal(pendingAgentTurn([{ ...saleCard, context: workspace }], rental.key)?.id, 7, "a workspace card still answers");
});
