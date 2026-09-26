# Agent workspace UI contract

The web Agent is an optional creator workspace enabled through user settings. On desktop it owns a
right-hand layout column; it must not cover, blur, or disable the creation workspace. The top
capsule is labelled **Agent** and appears only when the server reports that the feature is enabled,
configured, and consented for the user.

## Backend ownership and transport

The canonical Agent runtime is the Django `reaiagent` app in the
`Reaigen-backend` repository. The frontend owns presentation and typed transport
only. It does not own consent, tool authorization, model routing, proposals,
knowledge policy, audit history, or Agent persistence.

The browser calls `/api/reaigen/reai-agent/*`. The Next.js wildcard BFF maps
that prefix to Django `/api/v1/reai-agent/*`, forwards the HTTP-only access
cookie as a bearer token, refreshes expired access tokens, and returns private,
no-store responses. The browser must never call Django, AWS RDS, OpenRouter, or
private media services directly.

The sibling `Reaigen-agent` repository is an optional stateless stdio MCP
adapter and is not the web Agent backend. The production architecture and
operator checks are defined in the backend repository at
`docs/REAI_AGENT_PRODUCTION_RUNBOOK.md`.

At 768–1439px, the supporting pane is a 400px modeless right drawer: it overlays the right edge
without resizing, dimming, or locking the workspace. It docks from 1440px and consumes 360–400px in
normal layout. The global navigation stays in its 88px compact form until 1728px, where it may
expand to 260px. Pointer type does not override this width contract. Phones keep Agent modal.

## Context and language

- On the dashboard, Agent works across all Django-authorized creations.
- On a creation route, Agent is focused on that creation and does not show global quick actions.
- User-visible copy uses the account `preferred_language`; message spelling never overrides it.
- Internal JSON keys such as `property_type` are never displayed directly.
- Reply language and content target language are separate. Agent replies stay in the account
  language, while an explicitly requested title/description translation uses its chosen target.
- Description translation review shows localized `Content`, `From`, and `To` rows. The source is
  auto-detected; raw API parameters such as `target_lang` are never shown to the creator.
- A request that changes several creation fields produces one review card containing every
  requested field. Confirmation applies the complete signed proposal in one transaction; Agent
  must not describe a change that is absent from the card.

## Reasoning and safe fallback

- Exact field edits and bounded tools use deterministic execution without a language-model call.
- Copy composition uses the standard lane; only genuine comparison, planning, ambiguity, or
  multi-step composition uses the reasoning lane. Incidental substrings such as `floorplan` do
  not trigger deep reasoning.
- Model output is accepted only when its operation, authorized targets, proposal fields, and
  values form one consistent reviewable action. Invalid or partial output is retried with a
  reviewed fallback model.
- If reviewed responses still fail validation, the UI receives a localized `safe_fallback`
  response with no proposal token and no possible write.
- Model-backed responses may include the effective Django-managed release bundle and runtime
  settings revision. These are operational provenance fields; they do not authorize an action or
  replace proposal confirmation.

## Fact-first proposal hierarchy

When a request contains property facts, the review card renders changes in this order:

1. **Property attributes** (`specs`), localized as individual label/value rows.
2. **Description**, shown as normal-weight, full-width readable text.
3. Other scalar fields such as area or price, shown as compact key/value rows.

Examples of localized Slovak rows are `Typ nehnuteľnosti → Komerčný priestor`,
`Typ priestoru → Kancelária`, `Počet miestností → 1`, `WC → 1`, and
`Chladenie → Klimatizácia`. The card is a proposal only. `Použiť zmenu` submits the signed token
with explicit confirmation; `Zrušiť` keeps the conversation but marks the proposal dismissed.

Long text must never be placed in the compact right-aligned scalar layout. Descriptions use
left-aligned, normal-weight text with natural wrapping.

## Conversation behavior

- Applying or dismissing a proposal must not delete or replace prior messages.
- The proposal remains visible with an applied/dismissed state marker.
- Closing and reopening the Agent panel preserves the active conversation and selected view. The
  same tab-scoped transcript also follows application-relative navigation into a creation, new-post
  flow, settings, or tour editor; the destination page supplies fresh resource IDs and permissions.
- Every prompt offered by Agent's own BasicUI must map to an executable deterministic path. Short
  greetings, create/open navigation, and a unique conservative title-typo match do not wait for a
  model call. Ambiguous title matches stay put and ask the user to choose.
- The three workspace views have stable meanings: **Chat**, **Media versions**, and **Edit history**.
  Narrow panels may show the shorter **Media** and **Edits** labels, but retain the full accessible
  names. The current view is visibly selected and exposed to assistive technology.
- Improvement feedback controls appear only with separate improvement-storage consent.
- A deterministic workspace search updates the normal dashboard query and shows grounded creation
  cards; it does not create a second independent result universe.

## BasicUI and experimental TinyUI

Agent has two native, declarative response surfaces. Neither is a general-purpose HTML surface.

**BasicUI** is available to every Agent user. It renders bounded `summary`, `progress`, and
`actions` blocks, grounded creation results, and deterministic Settings navigation. Summary cards
contain at most four labelled facts and action cards contain at most three follow-up prompts.

**TinyUI** is experimental and available only when the backend reports the `tinyui` tool as both
subscription-entitled and user-enabled. The current entitlement is the `extrauser` feature set.
TinyUI may render a chart, form, comparison table, scorecard, nearby spatial preview, route
preview, or fixed property-finance calculator. It is useful when a relationship is easier to
understand or manipulate than to read: for example, bars appearing in distance order around an
estate, an estate-to-work route with traffic status, a property comparison, or adjustable yield
assumptions. Ordinary prose remains ordinary prose.

Both protocols are versioned and server-sanitized. The client renders no more than two explicit UI
blocks per reply. TinyUI is implemented as reviewed native React components, and each experimental
block has its own failure boundary so one malformed mini-app cannot remove the conversational
answer or another block. Route geometry and nearby positions are bounded, session-only previews.
Provider data must display the attribution and warning returned by Django; a relative SVG spatial
preview is not represented as a street map or official Walk Score.

UI actions submit a new Agent prompt; they never mutate a creation directly. The local calculator
uses fixed, visible formulas and user-entered assumptions. Existing signed proposal and
destructive-action confirmation still govern every write. Navigation accepts only
application-relative paths, and arbitrary markup, scripts, remote links, executable payloads, and
model-authored map coordinates are never rendered. The pattern is informed by the older Reailist
TinyApps R&D, but the production contract is this typed protocol rather than a dependency on the
prototype.

## Interaction and status feedback

- The composer is one 20 px rounded card. The full-width, labelled message area
  sits above the attachment/send toolbar; neither button takes space from typing.
  Its text grows from 64 px to 160 px, then scrolls. Clearing or sending shrinks it
  again. Enter sends, Shift+Enter adds a line, and IME confirmation never sends.
- A labelled **Add files** control opens the same guarded file intake used by
  drag-and-drop. A separate arrow sends the typed message. While work is running,
  both actions are disabled and the send control shows activity; typing the next
  message remains possible. These presentation controls grant no new permissions.
- Attached files, selected workspace context and the active question share a
  bounded, scrollable tray inside the composer. Document privacy and unread
  status appear separately from the filename. Add, send and remove targets are
  at least 44 x 44 px; selected values and long filenames cannot widen the panel.
- Cards, controls, buttons, inputs, and status markers use the same 20 px Agent corner radius.
- Interactive targets are at least 44 x 44 px on phones, including compact share links.
- Opening Agent below the docked breakpoint moves keyboard focus to its close control. On phones,
  Agent is announced as a modal dialog and Tab stays inside it; closing by button, backdrop, or
  Escape restores focus to the opener. The 768–1439px drawer remains modeless and does not trap
  focus away from the visible workspace.
- Consent loading is visible. A failed consent request renders an error with a retry action instead
  of an empty panel.
- Applied, queued, organized, ready, unavailable, and dismissed outcomes remain visible as labelled
  status badges after their action controls disappear.

## Tool permissions and action confirmation

Settings exposes an **Allow all tools** switch and, when disabled, one switch per backend-approved
tool. Turning off all-tools mode preserves the currently effective choices, so the user can then
disable individual tools without an accidental lockout. Settings are loaded from and persisted to
Django; this UI is a control surface, not the authorization boundary.

Floor-plan navigation, floor-plan measurement, virtual-tour navigation, location insights,
financial scenarios, and experimental TinyUI each have their own Agent switch and Privacy data
boundary. BasicUI is part of the core response renderer and is not separately switchable. Exact
coordinates may go only to the currently enabled route/location provider for the requested call;
viewer movement, measurements, route geometry, and TinyUI calculator state remain session-only.

Destructive actions use a separate review card. Asking Agent to revoke every shared link produces
a count, an irreversible-action warning, and confirm/dismiss controls. Chat alone changes nothing.
Confirmation submits the signed action token to Django, and success refreshes the Shares screen
without deleting the conversation.

Using a saved virtual-tour camera as the cover is also a persistent action. Agent first resolves
one camera from the server-owned authored list and shows a confirm/dismiss card. Confirmation is
exchanged for a separate short-lived write token; the tour editor then renders that exact camera
locally and submits the render to the existing tour-thumbnail endpoint. The card remains pending
until the editor reports success or failure, supports retry, and never treats a tour camera as a
listing-gallery upload.

## Edit history

History is a compact newest-first timeline, not a stack of large form cards. Each entry contains:

- source/version label and localized timestamp;
- a current-version marker on the newest revision;
- quiet restore action for older revisions;
- stacked localized `Before` and `After` values for long fields;
- two-column before/after values for short fields;
- localized structured attribute/value differences.

Restoring is always confirmed. The current state is checkpointed by the backend before restore, so
the replaced version remains recoverable.

## Composer verification — 2026-09-21

The full `npm run check` passed after the composer redesign: lint, TypeScript,
security and transport contracts, all 71 Agent checks, the other frontend
regression suites, and the production build. The new checks render the real
composer with React's server renderer and exercise its keyboard and sizing
helpers. They cover localized labels, disabled actions during work, editable
next-message text, the bounded context tray, the unchanged file accept list,
IME/newline handling and the existing guarded message/file-drop handlers.
Log: `/private/tmp/reaigen-agent-composer-check-20260921.log`.

These are not visual or signed-in end-to-end results. Browser discovery returned
no connected browser during this check, so actual layout and the authenticated
file-drop → conversation → draft flow remain unverified. The changes are local;
this work did not push to Gitea/GitHub or deploy to Vercel/AWS.

## Pending proposals and typed confirmations (2026-09-25, Bench 02)

- A typed message that names the card's own proposal is a confirmation and
  applies that card's token: "Apply the pending change.", "Now apply the
  earlier proposal.", "Apply that diff.", "použi tú zmenu", "übernimm den
  Vorschlag" (`isProposalConfirmation`). A qualified or unrelated "apply"
  ("apply the discount to the price", "apply for a permit") is not.
- A whole-message cancel withdraws the pending card here — the Apply button
  is gone and "Nothing was saved. The proposal is withdrawn." is shown
  (`isProposalCancellation`). A model turn that only *said* "cancelled" used
  to leave the button live.
- A pending card made for another listing (`selected_creation_ids` does not
  include the open draft) is never applied from this listing: "That proposal
  belongs to another listing. Open it to apply it, or tell me the change
  again here." Switching listings used to send the words to the backend,
  which minted the pending value for whatever was open.
- The backend answers the same words deterministically when no card is
  pending ("There is no pending change in this conversation to apply"), and
  refuses a stale proposal at apply with 409 when the listing changed since
  the card was made; the card shows that message as the error.

Tests: `app/lib/agent-conversation.test.mjs`.

## Following the conversation and seeing the listing take shape (2026-09-26)

- **Auto-scroll.** The message list scrolls to its newest message whenever a
  turn is added, a streamed sentence arrives or a document import advances.
  A message the creator sends always brings the view down; scrolling more
  than ~120 px up to reread stops the following until they return to the
  bottom (`conversationRef`, `followConversationRef` in
  `reai-agent-card.tsx`).
- **The listing so far.** Every creation turn carries `listing_draft`
  (title, fields, specs). While facts are still being collected
  (`clarify_new_listing`) the latest turn shows a "The listing so far" card,
  and the create card lists the same facts (`ListingDraftFacts`), formatted
  with the unit catalogue like proposals. Only what was said is shown —
  nothing is listed as missing or unknown.
- Guarded by `scripts/validate-agent-panel.test.mjs` (`npm run
  validate-agent-panel`, part of `npm run check`).

## Replies with tables and lists; cancelled cards (2026-09-26)

- **Formatted replies.** Agent replies are read by
  `app/lib/agent-reply-format.ts` into paragraphs, bullet and numbered
  lists, tables and **bold**; `AgentReplyText` renders them (a wide table
  scrolls inside the bubble). Nothing else is interpreted — no links, HTML or
  images — and every piece stays text for React to escape. Before, a
  comparison table arrived as rows of pipes (Bench 04 L01, L04). The
  creator's own messages stay plain text. Tests:
  `app/lib/agent-reply-format.test.mjs`.
- **Cancelled cards.** "Cancel this proposed change" withdraws the latest
  open card whether it proposes an edit or offers to create a listing (Bench
  04 S03 left "Create" clickable), and when the server recognises a cancel
  the panel did not (`pending_proposal: "cancel"`), every open card outside
  a plan is withdrawn.
- **Editor saves.** `draft-editor.tsx` announces a save with
  `reai-draft-saved` (`{ draftId }`); the panel withdraws that listing's open
  cards and drops the latest suggestions, which were made against the
  replaced values (Bench 04 D05). The server still refuses a stale proposal
  with 409.
- **Long words.** Bubbles and table cells wrap unbroken text (ids, URLs,
  run titles) with `overflow-wrap: anywhere` instead of spilling out.
- **Dragged items belong to the message that sends them.** Parameters,
  photos or files dragged into the chat travel with the next message, are
  shown as chips under it ("Sent with this message") and leave the pool once
  the answer arrives; a failed send keeps them for a retry. They used to stay
  as "pending" forever and ride along with every later message.

## Instant open (2026-09-26)

Operator: "we open the tab and the rest of the agent's UI comes after
seconds." Opening the panel no longer waits on the network for anything this
tab already knows. The server still enforces consent and entitlement on every
agent call; everything below is a first-paint decision only.

- **Body from what is known.** `ReaiAgentCard` starts from
  `peekReaiAgentConsent()` (the in-memory API cache, read synchronously) and
  from `readAgentEnabled()` (the shell's sessionStorage hint). If either says
  the agent is on, the intro, quick-action chips and composer render at once;
  the spinner appears only when nothing is known. Action guards use the
  derived `agentConsented`, so the optimistic body is usable.
- **Background confirmation.** The consent read still runs on mount, on a
  language change and on `reai-consent-changed`. "Not consented" switches to
  the enable-in-settings view; a failed read while the body is showing keeps
  the body and only logs (`[REAI] Agent consent refresh failed`). A failed
  read with no hint shows the error with Try again, as before.
- **Consent cache.** `/api/reaigen/reai-agent/consent/` is cached for five
  minutes (`LONG_TTL`). Ordinary `/reai-agent/*` POSTs (chat turns, applies,
  feedback) no longer drop it; only a write to the consent endpoint itself
  (grant or revoke) does, and those writes still dispatch
  `reai-consent-changed` for the shell, the card and the account setup.
- **Shell reads in parallel.** When the tab already knows the agent is on
  (`readAgentEnabled()`), `AppShell` starts `getUserCapabilities()` and
  `getReaiAgentConsent()` together on every navigation instead of one after
  the other, and the launcher and panel it restored wait on neither. A
  refused consent closes the agent as soon as it arrives; a missing
  entitlement still clears the agent session. Without the hint, entitlement
  is proven before consent is requested (fail closed, as
  `validate-account-entitlements` requires), and only Django's answers turn
  the agent on.
- **The hint is private state.** The enabled hint now lives under
  `reaigen:agent:enabled`, so the auth-boundary purge drops it with the
  transcript; it used to be `reai:agent-enabled`, which survived a sign-out
  and would have painted the next account's panel from the previous one's
  answer.
- **Warm chunk.** Once the agent is enabled, the card's chunk is imported on
  idle (`requestIdleCallback`, `setTimeout` fallback) and on launcher
  `pointerenter`/`focus`; the open handler and the restore of an open panel
  mount the card in the same commit that opens the drawer.
- **Silhouette, not a blank.** While the chunk loads, the panel shows
  `ReaiAgentSkeleton` (`app/components/reai-agent-skeleton.tsx`): intro
  lines, three chips and a composer in the panel's own padding and material,
  compact below 768px like the card, so nothing jumps when the card arrives.
  It imports only `./icons`, which the shell already ships.
- Guarded by `scripts/validate-agent-panel.test.mjs` (source contracts) and
  `app/lib/api/retry-policy.test.mjs` (the real client's consent cache
  against a stubbed fetch).

## Recommended actions and the composer (2026-09-26)

Operator: "better UI with recommended actions and this pool where we type".

- Recommended actions are full-width rows right above the field (icon in a
  soft circle, the action, a chevron), not scattered pills; the narrow panel
  keeps one scrollable row of pills. They are the same context-aware actions as
  before (dashboard: find, compare, bulk edit; listing: improve description,
  check missing fields, edit this listing; settings: agent, language, security).
- The composer is one calm field: 26 px radius, a soft lift instead of a hard
  outline, one line to start that grows with the text, a round (+) for files
  (its words kept for screen readers) and a round dark send button. Touch
  targets stay 44 px.
- The loading skeleton draws the same rows and field, so nothing moves when
  the panel fills in.
