import type { LocaleKey } from "./locales";

/**
 * The first step an empty Drafts page offers.
 *
 * "Create a listing from the app to get started" was the whole empty state,
 * with no action and no link, for every account (Bench 06 B06-F04). What a
 * creator can do from this page depends on the account: write to the Agent
 * when it is on, turn it on in Settings when the plan includes it, create on
 * the web when the server allows browser authoring, and otherwise capture in
 * the iPhone/iPad app — with the plan comparison one click away, because the
 * Free plan has neither the Agent nor web creation.
 */
export type FirstStepAction = "agent" | "agentSettings" | "webCreate" | "plans";

export interface FirstStep {
  hint: LocaleKey;
  actions: FirstStepAction[];
}

export function firstDraftStep(access: { agentReady: boolean; agentEntitled: boolean; webAuthoring: boolean }): FirstStep {
  const actions: FirstStepAction[] = [];
  if (access.agentReady) actions.push("agent");
  else if (access.agentEntitled) actions.push("agentSettings");
  if (access.webAuthoring) actions.push("webCreate");
  if (actions.length === 0) actions.push("plans");
  const hint: LocaleKey = access.agentReady
    ? "dashboard.empty.agentHint"
    : access.agentEntitled
      ? "dashboard.empty.agentOffHint"
      : access.webAuthoring
        ? "dashboard.empty.webHint"
        : "dashboard.empty.appHint";
  return { hint, actions };
}
