# Agent workspace UI contract

The web Agent is an optional creator workspace enabled through user settings. On desktop it owns a
right-hand layout column; it must not cover, blur, or disable the creation workspace. The top
capsule is labelled **Agent** and appears only when the server reports that the feature is enabled,
configured, and consented for the user.

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
- Improvement feedback controls appear only with separate improvement-storage consent.
- A deterministic workspace search updates the normal dashboard query and shows grounded creation
  cards; it does not create a second independent result universe.

## Tool permissions and action confirmation

Settings exposes an **Allow all tools** switch and, when disabled, one switch per backend-approved
tool. Turning off all-tools mode preserves the currently effective choices, so the user can then
disable individual tools without an accidental lockout. Settings are loaded from and persisted to
Django; this UI is a control surface, not the authorization boundary.

Destructive actions use a separate review card. Asking Agent to revoke every shared link produces
a count, an irreversible-action warning, and confirm/dismiss controls. Chat alone changes nothing.
Confirmation submits the signed action token to Django, and success refreshes the Shares screen
without deleting the conversation.

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
