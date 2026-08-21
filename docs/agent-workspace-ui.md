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
