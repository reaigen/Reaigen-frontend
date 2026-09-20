import type { AgentActionResult } from "./agent-actions";

export type AgentJobState = {
  draftId: number;
  serviceIds: number[];
  status: "pending" | "completed" | "failed" | "paused";
};

export function agentJobFromAction(outcome: AgentActionResult): AgentJobState | null {
  if (!["generate_description", "translate_description", "media"].includes(outcome.kind)) return null;
  if (outcome.kind === "workspace" || outcome.kind === "create_listing") return null;
  const result = outcome.result;
  const serviceIds = [...new Set([
    ...(result.service_id ? [result.service_id] : []),
    ...(outcome.kind === "media" ? outcome.result.service_ids ?? [] : []),
  ])].filter((id) => Number.isSafeInteger(id) && id > 0);
  const rawStatus = String(result.status ?? "").toLowerCase();
  const failed = ["failed", "error", "timeout", "cancelled"].includes(rawStatus)
    || (outcome.kind === "media" && (outcome.result.failed_count ?? 0) > 0);
  const completed = ["completed", "ready", "success"].includes(rawStatus)
    || (outcome.kind === "media" && outcome.result.action === "organize_draft_images" && rawStatus !== "pending");
  return { draftId: result.draft_id, serviceIds, status: failed ? "failed" : completed ? "completed" : serviceIds.length ? "pending" : "paused" };
}

/** Poll existing jobs only. Neither errors nor timeout ever repeat a paid action. */
export async function monitorAgentJob(
  job: AgentJobState,
  deps: {
    getService(id: number): Promise<{ status: string; output_data?: unknown }>;
    now(): number;
    sleep(ms: number, signal: AbortSignal): Promise<void>;
    signal: AbortSignal;
    budgetMs?: number;
  },
): Promise<AgentJobState["status"] | null> {
  if (!job.serviceIds.length) return "paused";
  const deadline = deps.now() + (deps.budgetMs ?? 360_000);
  const pending = new Set(job.serviceIds);
  while (!deps.signal.aborted && deps.now() < deadline) {
    for (const id of pending) {
      if (deps.signal.aborted) return null;
      let service: { status: string; output_data?: unknown };
      try { service = await deps.getService(id); } catch { return deps.signal.aborted ? null : "paused"; }
      if (deps.signal.aborted) return null;
      if (service.output_data && typeof service.output_data === "object" && !Array.isArray(service.output_data)
        && "requires_reconciliation" in service.output_data && service.output_data.requires_reconciliation === true) return "paused";
      const status = String(service.status).toLowerCase();
      if (["failed", "timeout", "error", "cancelled"].includes(status)) return "failed";
      if (status === "completed") pending.delete(id);
    }
    if (!pending.size) return "completed";
    await deps.sleep(Math.min(2500, Math.max(0, deadline - deps.now())), deps.signal);
  }
  return deps.signal.aborted ? null : "paused";
}
