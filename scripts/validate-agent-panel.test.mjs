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
