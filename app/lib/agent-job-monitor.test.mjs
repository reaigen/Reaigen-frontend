import assert from "node:assert/strict";
import test from "node:test";
import { agentJobFromAction, monitorAgentJob } from "./agent-job-monitor.ts";

test("queued description and translation are pending, not completed", () => {
  for (const kind of ["generate_description", "translate_description"]) {
    assert.equal(agentJobFromAction({ kind, result: { draft_id: 8, service_id: 19, status: "pending" } }).status, "pending");
    assert.equal(agentJobFromAction({ kind, result: { draft_id: 8, status: "pending" } }).status, "paused");
  }
  assert.equal(agentJobFromAction({ kind: "media", result: { draft_id: 8, status: "completed", failed_count: 1 } }).status, "failed");
});

function fixture(read, budgetMs = 5000) {
  let clock = 0;
  const controller = new AbortController();
  return { controller, deps: { getService: read, now: () => clock, sleep: async (ms) => { clock += ms; }, signal: controller.signal, budgetMs } };
}
const job = { draftId: 8, serviceIds: [11, 12], status: "pending" };

test("a stack finishes only when every job completes", async () => {
  const calls = [];
  let secondReads = 0;
  const { deps } = fixture(async (id) => { calls.push(id); return { status: id === 11 || secondReads++ > 0 ? "completed" : "processing" }; });
  assert.equal(await monitorAgentJob(job, deps), "completed");
  assert.deepEqual(calls, [11, 12, 12]);
});

test("unverified completion pauses for reconciliation without repeating work", async () => {
  for (const status of ["completed", "failed", "processing"]) {
    const { deps } = fixture(async () => ({ status, output_data: { requires_reconciliation: true } }));
    assert.equal(await monitorAgentJob(job, deps), "paused");
  }
});

test("failures, status errors and timeout never report completion or replay a mutation", async () => {
  for (const status of ["failed", "timeout", "error", "cancelled"]) {
    assert.equal(await monitorAgentJob(job, fixture(async () => ({ status })).deps), "failed");
  }
  assert.equal(await monitorAgentJob(job, fixture(async () => { throw new Error("offline"); }).deps), "paused");
  assert.equal(await monitorAgentJob(job, fixture(async () => ({ status: "processing" })).deps), "paused");
});

test("leaving the conversation ignores late completions and starts no further reads", async () => {
  let reads = 0;
  const { deps, controller } = fixture(async () => { reads += 1; controller.abort(); return { status: "completed" }; });
  assert.equal(await monitorAgentJob(job, deps), null);
  assert.equal(reads, 1);
});
