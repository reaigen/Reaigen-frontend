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

// Instant open (2026-09-26, operator): "the agent is loading UI slowly — we
// open the tab and the rest of the agent's UI comes after seconds".
const shell = fs.readFileSync(path.join(root, "app/components/app-shell.tsx"), "utf8");
const client = fs.readFileSync(path.join(root, "app/lib/api/client.ts"), "utf8");
const skeletonPath = path.join(root, "app/components/reai-agent-skeleton.tsx");

test("the panel body paints from the cached consent or the enabled hint, not a fresh read", () => {
  assert.match(card, /useState<ReaiAgentConsent \| null>\(\(\) => peekReaiAgentConsent\(\)\)/, "a cached consent answer is used at once");
  assert.match(card, /useState\(\(\) => readAgentEnabled\(\)\)/, "the shell's enabled hint is used at once");
  assert.match(card, /useState\(\(\) => peekReaiAgentConsent\(\) !== null\)/, "a cached answer counts as resolved");
  assert.match(card, /const agentConsented = consent \? consent\.consented : consentHint;/, "the server's answer wins over the hint");
  assert.match(card, /\{!consentResolved && !agentConsented \? \(\s*<div[^>]*>\s*<Working lang=\{lang\} \/>/, "the spinner only when nothing is known");
  assert.match(card, /\) : !consent && !agentConsented \? \(\s*<div role="alert"/, "an error only when there is no hint");
  assert.match(card, /\) : !agentConsented \? \(\s*<div[^>]*>\s*<p[^>]*>\{t\("reai\.enableInSettings", lang\)\}/, "a refusal still switches to enable-in-settings");
  assert.doesNotMatch(card, /consent\?\.consented/, "action guards use the derived boolean");
  assert.ok((card.match(/!agentConsented\) return/g) ?? []).length >= 8, "every action guard follows the optimistic state");
});

test("the consent read still runs in the background and a failure keeps an open panel", () => {
  const effect = card.slice(card.indexOf("    getReaiAgentConsent()\n"), card.indexOf("  }, [consentReloadKey, lang]);"));
  assert.match(effect, /if \(active\) setConsent\(value\);/);
  assert.match(effect, /if \(agentConsentedRef\.current\) \{\s*console\.warn\([^)]*\);\s*return;\s*\}\s*setConsent\(null\);\s*setError\(errorText\(err, lang\)\);/);
  assert.match(card, /agentConsentedRef\.current = false;\s*setConsentHint\(false\);/, "withdrawn consent drops the hint too");
  assert.match(card, /setConsentHint\(true\);\s*setConsent\(\(current\) => current \? \{ \.\.\.current, consented: true \} : current\);/);
});

test("consent is cached like the profile and survives ordinary agent POSTs", () => {
  assert.match(client, /const REAI_AGENT_CONSENT_PATH = "\/api\/reaigen\/reai-agent\/consent\/";/);
  assert.match(client, /if \(path === REAI_AGENT_CONSENT_PATH\) return LONG_TTL;/);
  assert.match(client, /const keepConsent = path !== REAI_AGENT_CONSENT_PATH;/);
  assert.match(client, /if \(keepConsent && key === REAI_AGENT_CONSENT_PATH\) continue;/);
  assert.match(client, /export function peekReaiAgentConsent\(\): ReaiAgentConsent \| null \{/);
});

test("the shell reads capabilities and consent in parallel once the agent is known to be on", () => {
  const refresh = shell.slice(shell.indexOf("    const refresh = () => {"), shell.indexOf("    const permissionChanged ="));
  assert.match(refresh, /const capabilitiesRequest = getUserCapabilities\(\);\s*const earlyConsent = readAgentEnabled\(\) \? getReaiAgentConsent\(\) : null;/, "both start together for a known-on agent");
  assert.match(refresh, /earlyConsent\s*\?\.then\(\(consent\) => \{\s*if \(active && !consent\.consented\) \{\s*setReaiEnabled\(false\);/, "a withdrawn consent closes it without waiting");
  assert.match(refresh, /if \(!entitled\) \{\s*setReaiEnabled\(false\);\s*clearAgentSession\(\);[\s\S]*?return earlyConsent \?\? getReaiAgentConsent\(\);/, "entitlement is still proven before a fresh consent read, and can withdraw it");
  assert.doesNotMatch(refresh, /setReaiEnabled\(true\)/, "nothing but Django's answers turns it on");
  assert.match(shell, /window\.addEventListener\("reai-consent-changed", permissionChanged\)/);
  const session = fs.readFileSync(path.join(root, "app/lib/agent-session.ts"), "utf8");
  const purge = fs.readFileSync(path.join(root, "app/lib/private-client-state.ts"), "utf8");
  assert.match(session, /const ENABLED_KEY = "reaigen:agent:enabled";/);
  assert.match(purge, /"reaigen:agent:",/, "the hint is dropped at the auth boundary with the transcript");
});

test("the agent chunk is warmed before the first open and the card mounts with the open", () => {
  assert.match(shell, /const loadReaiAgentCard = \(\) => import\("\.\/reai-agent-card"\);/);
  assert.match(shell, /dynamic\(\s*\(\) => loadReaiAgentCard\(\)\.then\(\(module\) => module\.ReaiAgentCard\)/, "the preload and the dynamic card share one chunk");
  assert.match(shell, /window\.requestIdleCallback\(warmReaiAgentCard/, "warmed on idle once enabled");
  assert.match(shell, /window\.setTimeout\(warmReaiAgentCard/, "with a timer where idle callbacks are missing");
  assert.match(shell, /\}, \[reaiEnabled\]\);/);
  assert.match(shell, /onPointerEnter=\{warmReaiAgentCard\}\s*onFocus=\{warmReaiAgentCard\}/, "and on launcher intent");
  assert.match(shell, /setReaiCardMounted\(true\);\s*setReaiOpen\(true\);\s*if \(!window\.matchMedia/, "the open handler mounts the card in the same commit");
  assert.match(shell, /if \(readAgentPanelOpen\(\)\) \{\s*setReaiCardMounted\(true\);\s*setReaiOpen\(true\);/, "a restored open panel mounts before paint");
  assert.doesNotMatch(shell, /if \(reaiOpen\) setReaiCardMounted\(true\)/, "no passive effect in between");
});

test("the loading fallback is the panel's own light silhouette", () => {
  assert.match(shell, /loading: \(\) => <ReaiAgentSkeleton \/>/);
  assert.ok(fs.existsSync(skeletonPath));
  const skeleton = fs.readFileSync(skeletonPath, "utf8");
  const imports = [...skeleton.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]);
  assert.deepEqual(imports, ["./icons"], "nothing heavy ships with the shell");
  assert.match(skeleton, /aria-busy="true"/);
  assert.equal((skeleton.match(/h-11 w-\d+ shrink-0 rounded-2xl/g) ?? []).length, 3, "three chip placeholders");
  assert.match(skeleton, /rounded-\[20px\] border border-border\/80 bg-card shadow-control/, "the composer's own material");
  assert.match(skeleton, /mt-4 flex min-h-0 flex-1 flex-col gap-3 max-md:mt-1 max-md:gap-2/, "the body spacing of the panel, compact below 768px");
});

test("what was dragged into the chat goes with one message and then leaves the pool", () => {
  assert.match(card, /const sentPoolKeys = new Set\(requestPool\.map\(\(item\) => poolItemKey\(item\)\)\);/);
  assert.match(card, /setPool\(\(current\) => current\.filter\(\(item\) => !sentPoolKeys\.has\(poolItemKey\(item\)\)\)\);/);
  assert.match(card, /attachments: requestPool\.map\(\(item\) => item\.label\)/, "the sent items are shown under the message");
});
