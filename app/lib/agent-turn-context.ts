/**
 * Which listing each Agent turn was about.
 *
 * One conversation follows the creator across listings. Bench 07 (B07-F04)
 * opened the rental with the Agent open: the header said "B06 UX Prenájom"
 * while the cards above were the sale's, with nothing to tell the two apart.
 * Every turn now records the listing (or workspace) it was made in; the
 * transcript marks where that changes, a card made for another listing says
 * so, and it cannot be confirmed from here.
 */

export interface AgentTurnContext {
  /** "draft:12044", or the workspace ("creator", "settings", …). */
  key: string;
  /** What the panel header showed: the listing's title, or the workspace's name. */
  label: string;
  draftId?: number;
}

/** A turn as far as its context goes. `null`: recorded before contexts were. */
export interface ContextualTurn {
  id: number;
  role: "user" | "assistant";
  context?: AgentTurnContext | null;
}

export function agentTurnContext(workspace: string, draftId: number | null | undefined, label: string): AgentTurnContext {
  return draftId != null
    ? { key: `draft:${draftId}`, label, draftId }
    : { key: workspace, label };
}

/** Turns made since the last render get the context they were made in; the rest are unchanged. */
export function stampTurnContexts<T extends ContextualTurn>(turns: T[], context: AgentTurnContext): T[] {
  if (!turns.some((turn) => turn.context === undefined)) return turns;
  return turns.map((turn) => (turn.context === undefined ? { ...turn, context } : turn));
}

export interface ContextMarks {
  /** A divider goes before these turns: the listing changed there. */
  before: Map<number, AgentTurnContext>;
  /** A divider after the last turn: the creator moved on since. */
  trailing: AgentTurnContext | null;
}

export function contextMarks(turns: readonly ContextualTurn[], current: AgentTurnContext): ContextMarks {
  const before = new Map<number, AgentTurnContext>();
  let last: AgentTurnContext | null = null;
  let unknownBefore = false;
  for (const turn of turns) {
    const context = turn.context;
    if (!context) {
      unknownBefore = true;
      continue;
    }
    if ((last && last.key !== context.key) || (!last && unknownBefore)) before.set(turn.id, context);
    last = context;
  }
  const trailing = turns.length > 0 && (!last || last.key !== current.key) ? current : null;
  return { before, trailing };
}

/**
 * The listing an assistant turn was made for, when it is not the one open now
 * — shown on its card. A workspace turn is not a listing's and never is.
 */
export function otherListingOf(turn: ContextualTurn, current: AgentTurnContext): AgentTurnContext | null {
  const context = turn.context;
  if (turn.role !== "assistant" || !context || context.draftId == null) return null;
  return context.key === current.key ? null : context;
}
