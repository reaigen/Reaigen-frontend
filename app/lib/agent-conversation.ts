type AgentTurn = {
  role: "user" | "assistant";
  proposalStatus?: string;
  actionStatus?: string;
  planId?: string;
  response?: { action_code?: string | null; creation_context_token?: string | null; thread_token?: string | null };
};

/** Only the most recent assistant card can receive a typed confirmation. */
export function pendingAgentTurn<T extends AgentTurn>(turns: readonly T[]): T | undefined {
  const latest = [...turns].reverse().find((turn) => turn.role === "assistant");
  if (!latest?.response || latest.proposalStatus || latest.actionStatus || latest.planId
    || latest.response.action_code === "action_plan") return undefined;
  return latest;
}

/** Stop carrying unsaved facts once that listing was created or dismissed. */
/** The newest signed conversation memory the server handed back, if any. */
export function latestThreadToken(turns: readonly AgentTurn[]): string | null {
  for (const turn of [...turns].reverse()) {
    if (turn.response?.thread_token) return turn.response.thread_token;
  }
  return null;
}

export function pendingCreationContextToken(turns: readonly AgentTurn[]): string | null {
  for (const turn of [...turns].reverse()) {
    if (turn.response?.action_code === "create_listing" && turn.actionStatus) return null;
    if (turn.response?.creation_context_token) return turn.response.creation_context_token;
  }
  return null;
}
