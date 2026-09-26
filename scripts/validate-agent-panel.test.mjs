import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// The agent panel (2026-09-26, operator): "auto scroll to last message", and
// "we are building with agent but visually in app we don't see what is being
// formed".
const root = process.cwd();
const card = fs.readFileSync(path.join(root, "app/components/reai-agent-card.tsx"), "utf8");
const locales = ["en", "sk", "cs", "de"].map((code) => fs.readFileSync(path.join(root, `app/lib/locales/${code}.ts`), "utf8"));

test("the conversation follows its newest message unless the creator scrolled up", () => {
  assert.match(card, /ref=\{conversationRef\}/, "the message list carries the scroll ref");
  assert.match(card, /followConversationRef\.current = element\.scrollHeight - element\.scrollTop - element\.clientHeight < \d+/, "scrolling up stops following");
  assert.match(card, /role === "user"\) followConversationRef\.current = true/, "a sent message always brings the view down");
  assert.match(card, /element\.scrollTo\(\{ top: element\.scrollHeight/, "the list scrolls to its end");
  assert.match(card, /\}, \[turns, busy, sourceImportProgress\]\);/, "every new turn, streamed sentence and import step triggers it");
});

test("the listing being built is shown fact by fact", () => {
  assert.match(card, /function ListingDraftFacts\(/);
  assert.match(card, /answer\?\.action_code === "clarify_new_listing" && answer\.listing_draft && !answer\.source_import && turn\.id === lastAssistantTurnId/, "while facts are still being collected, on the latest turn");
  assert.match(card, /\{!answer\.source_import && <ListingDraftFacts answer=\{answer\}/, "on the create card");
  assert.doesNotMatch(card.slice(card.indexOf("function ListingDraftFacts("), card.indexOf("function proposalSpecEntries(")), /missing/, "nothing is listed as missing or unknown");
  for (const locale of locales) assert.match(locale, /"reai\.listingSoFar":/);
});

test("agent replies render their tables, lists and bold; the creator's own text stays plain", () => {
  assert.match(card, /function AgentReplyText\(\{ text \}: \{ text: string \}\)/);
  // The creator's own message stays plain text (with its sent attachments);
  // only agent replies go through the reply formatter.
  assert.match(card, /turn\.role === "user"\s*\?\s*\(\s*<>\s*<p className="whitespace-pre-line[^"]*">\{turn\.content\}<\/p>/);
  assert.match(card, /:\s*<AgentReplyText text=\{turn\.content\} \/>\}/);
  assert.match(card, /<div key=\{index\} className="overflow-x-auto rounded-xl/, "a wide table scrolls inside the bubble");
  assert.doesNotMatch(card, /dangerouslySetInnerHTML/, "no reply text is ever injected as HTML");
});

test("a cancelled card never keeps a live Apply or Create button (Bench 04 S01, S03)", () => {
  assert.match(card, /\(pendingProposal\?\.response\?\.proposal_token \|\| pendingProposal\?\.response\?\.action_token\)/, "a create card is cancellable too");
  assert.match(card, /else dismissAction\(pendingProposal\.id\);/);
  assert.match(card, /pending_proposal === "cancel"/, "a cancel the server heard withdraws open cards");
  assert.match(card, /function withdrawnCard\(turn: ChatTurn\): ChatTurn/);
  assert.match(card, /if \(!turn\.response \|\| turn\.planId\) return turn;/, "plan step cards stay with their plan");
});

test("a save in the editor withdraws the cards and suggestions it made stale (Bench 04 D05)", () => {
  const editor = fs.readFileSync(path.join(root, "app/components/draft-editor.tsx"), "utf8");
  assert.match(editor, /onSaved\(updated\);\s*\/\/[^\n]*\n[^\n]*\n\s*window\.dispatchEvent\(new CustomEvent\("reai-draft-saved", \{ detail: \{ draftId: draft\.id \} \}\)\)/);
  assert.match(card, /window\.addEventListener\("reai-draft-saved", onDraftSaved\)/);
  assert.match(card, /suggested_actions: \[\]/, "stale suggestions are dropped");
});

test("long unbroken text wraps inside the bubbles and table cells", () => {
  assert.match(card, /whitespace-pre-line break-words text-\[14px\] leading-6 text-background \[overflow-wrap:anywhere\]/);
  assert.match(card, /<td key=\{column\} className="[^"]*\[overflow-wrap:anywhere\]/);
});

test("TinyUI distances are shown in the creator's own unit from the server", () => {
  const tiny = fs.readFileSync(path.join(root, "app/components/agent-tiny-ui.tsx"), "utf8");
  assert.match(tiny, /const distance = block\.distance_label \|\|/);
  assert.match(tiny, /\{place\.distance_label \|\|/);
});

test("what was dragged into the chat goes with one message and then leaves the pool", () => {
  assert.match(card, /const sentPoolKeys = new Set\(requestPool\.map\(\(item\) => poolItemKey\(item\)\)\);/);
  assert.match(card, /setPool\(\(current\) => current\.filter\(\(item\) => !sentPoolKeys\.has\(poolItemKey\(item\)\)\)\);/);
  assert.match(card, /attachments: requestPool\.map\(\(item\) => item\.label\)/, "the sent items are shown under the message");
});
