import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentPlanRunner,
  classifyPlanError,
  createPlanSnapshot,
  openPlanQuestions,
  planApprovalDigests,
} from "./agent-plan-runner.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────

const PLAN_ID = "9f1c0000000000000000000000000032";

function step(stepId, kind, overrides = {}) {
  return {
    step_id: stepId,
    kind,
    tool_code: kind === "share_listing" ? "sharing" : kind === "translate_description" ? "translation" : "creation_edit",
    label: kind,
    quote: kind,
    confirmation: kind === "share_listing" ? "step" : kind === "attach_photos" ? "none" : "plan",
    confirmation_reason: kind === "share_listing" ? "publishes_link" : null,
    spends: [],
    depends_on: stepId === "s1" ? [] : ["s1"],
    soft_after: [],
    status: "ready",
    question: null,
    preview: null,
    blocked: null,
    result: null,
    digest: `digest-${stepId}`,
    ...overrides,
  };
}

function plan(overrides = {}) {
  return {
    plan_id: PLAN_ID,
    version: "action-plan-v1",
    language: "en",
    status: "awaiting_approval",
    target: { kind: "new_listing" },
    draft_id: null,
    approval: null,
    approval_options: ["all", "step"],
    steps: [
      step("s1", "create_listing"),
      step("s2", "attach_photos"),
      step("s3", "generate_description"),
      step("s4", "translate_description"),
      step("s5", "share_listing"),
    ],
    declined: [],
    not_included: [],
    notes: [],
    ...overrides,
  };
}

function stepResponse(actionCode, token) {
  return {
    reply: actionCode,
    proposed_changes: {},
    suggested_actions: [],
    proposal_token: null,
    action_code: actionCode,
    action_token: token,
  };
}

let tokenCounter = 0;
function reply(next, planOverrides = {}) {
  tokenCounter += 1;
  return { plan: plan(planOverrides), plan_token: `token-${tokenCounter}`, reply: "", next };
}

class HttpError extends Error {
  constructor(status, body) {
    super(`API Error ${status}`);
    this.status = status;
    this.body = typeof body === "string" ? body : JSON.stringify(body);
  }
}

/**
 * A fake API that answers advance calls from a script and records every call.
 * A script entry is a response, an Error to throw, or a function of the body.
 */
function harness({ advanceScript = [], execute, uploadPhotos, getService, clock } = {}) {
  const calls = { advance: [], execute: [], upload: [], getService: [], navigate: [], transcript: [], confirm: [], ask: [], done: [], draftChanged: [] };
  const snapshots = [];
  const script = [...advanceScript];
  let now = 1_000_000;
  const fakeClock = clock ?? {
    now: () => now,
    sleep: async (ms) => { now += ms; },
  };
  const deps = {
    advance: async (planToken, body) => {
      calls.advance.push({ planToken, body });
      const entry = script.shift();
      if (entry === undefined) throw new Error(`unexpected advance: ${body.intent}`);
      const value = typeof entry === "function" ? entry(body) : entry;
      if (value instanceof Error) throw value;
      return value;
    },
    execute: async (actionCode, actionToken) => {
      calls.execute.push({ actionCode, actionToken });
      if (execute) return execute(actionCode, actionToken);
      // Deliberately a different id than the server's: the runner must ignore it.
      return { draft_id: 999 };
    },
    uploadPhotos: async (draftId, expectedCount, startIndex) => {
      calls.upload.push({ draftId, expectedCount, startIndex });
      if (uploadPhotos) return uploadPhotos(draftId, expectedCount, startIndex);
      return { uploadedUploadIds: [11, 12, 13, 14, 15, 16], failedCount: 0, attemptedCount: 6 };
    },
    getService: async (serviceId) => {
      calls.getService.push(serviceId);
      return getService ? getService(serviceId) : { status: "completed" };
    },
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onConfirm: (stepId, response) => calls.confirm.push({ stepId, response }),
    onAsk: (stepId, question) => calls.ask.push({ stepId, question }),
    onNavigate: (draftId) => calls.navigate.push({ draftId, afterTranscripts: calls.transcript.length }),
    writeTranscript: (snapshot) => calls.transcript.push(snapshot),
    onDraftChanged: (draftIds) => calls.draftChanged.push(draftIds),
    onDone: (summary) => calls.done.push(summary),
    pendingPhotoCount: () => 6,
    conversationId: () => null,
    clock: fakeClock,
  };
  const runner = new AgentPlanRunner(deps);
  const initial = createPlanSnapshot(7, plan(), "token-initial", "Here is the plan", fakeClock.now());
  return { runner, calls, snapshots, initial, advanceTo: (ms) => { now = ms; }, now: () => now };
}

async function settle(predicate, label = "condition") {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`timed out waiting for ${label}`);
}

// ─── Tests ────────────────────────────────────────────────────────────────

test("a five step plan runs create, photos, description and translation, then stops at the share card", async () => {
  let descriptionPolls = 0;
  const { runner, calls, initial } = harness({
    advanceScript: [
      (body) => {
        assert.equal(body.intent, "approve");
        assert.equal(body.confirmed, true);
        assert.equal(body.approval, "all");
        assert.deepEqual(body.digests, planApprovalDigests(plan()));
        assert.deepEqual(body.client_state, { pending_photo_count: 6 });
        return reply({ mode: "execute", step_id: "s1", step_response: stepResponse("create_listing", "create-token") });
      },
      reply({ mode: "client", step_id: "s2", client: { kind: "upload_pending_photos", draft_id: 812, expected_count: 6 } }, { draft_id: 812 }),
      (body) => {
        assert.deepEqual(body.client_result, { step_id: "s2", uploaded_upload_ids: [11, 12, 13, 14, 15, 16], failed_count: 0 });
        return reply({ mode: "execute", step_id: "s3", step_response: stepResponse("generate_description", "describe-token") }, { draft_id: 812 });
      },
      reply({ mode: "wait", wait: { waiting_on: [{ step_id: "s3", service_id: 4410, service_name: "text_description" }], retry_after_ms: 2000, budget_ms: 360000 } }, { draft_id: 812 }),
      reply({ mode: "execute", step_id: "s4", step_response: stepResponse("translate_description", "translate-token") }, { draft_id: 812 }),
      reply({ mode: "wait", wait: { waiting_on: [{ step_id: "s4", service_id: 4411, service_name: "text_translation" }], retry_after_ms: 2000, budget_ms: 240000 } }, { draft_id: 812 }),
      reply({ mode: "confirm", step_id: "s5", step_response: stepResponse("create_draft_share", "share-token") }, { draft_id: 812 }),
      reply({ mode: "done", summary: { draft_id: 812, share_url: "https://example.test/s/1", completed: ["s1", "s2", "s3", "s4", "s5"], skipped: [], failed: [], follow_up: { reply: "What next?" } } }, { draft_id: 812, status: "done" }),
    ],
    getService: (serviceId) => {
      if (serviceId === 4410) {
        descriptionPolls += 1;
        return { status: descriptionPolls === 1 ? "processing" : "completed" };
      }
      return { status: "completed" };
    },
  });

  runner.start(7, initial);
  assert.equal(calls.advance.length, 0, "loading a plan sends nothing");

  await runner.approve("all", planApprovalDigests(plan()), 6);

  assert.deepEqual(calls.execute.map((call) => call.actionCode), ["create_listing", "generate_description", "translate_description"]);
  assert.deepEqual(calls.advance.map((call) => call.body.intent), ["approve", "continue", "continue", "continue", "continue", "continue", "continue"]);
  assert.deepEqual(calls.upload, [{ draftId: 812, expectedCount: 6, startIndex: 0 }]);
  assert.deepEqual(calls.getService, [4410, 4410, 4411]);
  assert.equal(runner.snapshot.phase, "confirming");
  assert.equal(runner.snapshot.stepId, "s5");
  assert.equal(calls.confirm.length, 1);
  assert.equal(calls.confirm[0].stepId, "s5");
  assert.equal(calls.navigate.length, 1);
  assert.equal(calls.navigate[0].draftId, 812);
  assert.equal(calls.navigate[0].afterTranscripts, 1, "the transcript is parked before navigating");

  const result = await runner.confirmStep("s5", calls.confirm[0].response);
  assert.deepEqual(result, { draft_id: 999 });
  await settle(() => runner.snapshot.phase === "done", "done");
  assert.equal(calls.execute.at(-1).actionCode, "create_draft_share");
  assert.equal(calls.done.length, 1);
  assert.equal(calls.done[0].follow_up.reply, "What next?");
  assert.equal(calls.navigate.length, 1, "the listing is opened only once");
});

test("the draft id comes only from the server, never from an apply result", async () => {
  const { runner, calls, initial } = harness({
    advanceScript: [
      reply({ mode: "execute", step_id: "s1", step_response: stepResponse("create_listing", "create-token") }),
      reply({ mode: "client", step_id: "s2", client: { kind: "upload_pending_photos", draft_id: 812, expected_count: 6 } }, { draft_id: 812 }),
      reply({ mode: "awaiting_approval" }, { draft_id: 812 }),
    ],
  });
  runner.start(7, initial);
  assert.equal(runner.draftId, null);
  await runner.approve("all", planApprovalDigests(plan()), 6);
  assert.equal(runner.draftId, 812);
  assert.equal(calls.upload[0].draftId, 812);
  assert.equal(calls.navigate[0].draftId, 812);
});

test("a share the server marks execute is refused and shown as a confirm card", async () => {
  const { runner, calls, initial } = harness({
    advanceScript: [
      reply({ mode: "execute", step_id: "s5", step_response: stepResponse("create_draft_share", "share-token") }, { draft_id: 812 }),
    ],
  });
  runner.start(7, initial);
  await runner.approve("all", planApprovalDigests(plan()), 6);
  assert.equal(calls.execute.length, 0);
  assert.equal(calls.confirm.length, 1);
  assert.equal(runner.snapshot.phase, "confirming");
});

test("media and link-management codes are never executed under a plan approval", async () => {
  for (const code of ["manage_shares", "revoke_all_shares", "grade_draft_images", "generate_draft_video"]) {
    const { runner, calls, initial } = harness({
      advanceScript: [reply({ mode: "execute", step_id: "s3", step_response: stepResponse(code, "token") }, { draft_id: 812 })],
    });
    runner.start(7, initial);
    await runner.approve("all", planApprovalDigests(plan()), 6);
    assert.equal(calls.execute.length, 0, code);
    assert.equal(runner.snapshot.phase, "confirming", code);
  }
});

test("a quota refusal stops the plan and nothing else is sent", async () => {
  const { runner, calls, initial } = harness({
    advanceScript: [reply({ mode: "execute", step_id: "s1", step_response: stepResponse("create_listing", "create-token") })],
    execute: () => { throw new HttpError(403, { detail: "You have reached your listing limit." }); },
  });
  runner.start(7, initial);
  await runner.approve("all", planApprovalDigests(plan()), 6);
  assert.equal(runner.snapshot.phase, "failed");
  assert.equal(calls.advance.length, 1);
  assert.equal(calls.execute.length, 1);
  await runner.resume();
  assert.equal(calls.advance.length, 1, "a failed plan cannot be continued");
});

test("missing compute credits and a switched-off tool are hard stops", async () => {
  const cases = [
    [{ detail: "Not enough credits.", code: "insufficient_compute_credits" }, "credits"],
    [{ detail: "The Agent tool 'sharing' is turned off for this account." }, "tool_unavailable"],
    [{ detail: "Limit reached.", quota: { remaining: 0 } }, "quota"],
  ];
  for (const [body, kind] of cases) {
    const { runner, calls, initial } = harness({
      advanceScript: [reply({ mode: "execute", step_id: "s3", step_response: stepResponse("generate_description", "token") }, { draft_id: 812 })],
      execute: () => { throw new HttpError(403, body); },
    });
    runner.start(7, initial);
    await runner.approve("all", planApprovalDigests(plan()), 6);
    assert.equal(runner.snapshot.phase, "failed", kind);
    assert.equal(runner.snapshot.notice.kind, kind);
    assert.equal(calls.advance.length, 1, kind);
  }
});

test("a throttled apply pauses without retrying and shows the wait", async () => {
  const { runner, calls, initial } = harness({
    advanceScript: [
      reply({ mode: "execute", step_id: "s1", step_response: stepResponse("create_listing", "create-token") }),
      reply({ mode: "awaiting_approval" }),
    ],
    execute: () => { throw new HttpError(429, { detail: "Request was throttled. Expected available in 57 seconds." }); },
  });
  runner.start(7, initial);
  await runner.approve("all", planApprovalDigests(plan()), 6);
  assert.equal(runner.snapshot.phase, "paused");
  assert.equal(runner.snapshot.notice.kind, "throttled");
  assert.equal(runner.snapshot.notice.retryAfterSeconds, 57);
  assert.equal(calls.execute.length, 1);
  assert.equal(calls.advance.length, 1);
  await runner.resume();
  assert.equal(calls.advance.at(-1).body.intent, "continue", "Continue asks the server again instead of replaying the apply");
  assert.equal(calls.execute.length, 1);
});

test("network and server failures pause the plan and are never retried automatically", async () => {
  const { runner, calls, initial } = harness({
    advanceScript: [new TypeError("Failed to fetch")],
  });
  runner.start(7, initial);
  await runner.approve("all", planApprovalDigests(plan()), 6);
  assert.equal(runner.snapshot.phase, "paused");
  assert.equal(runner.snapshot.notice.kind, "network");
  assert.equal(calls.advance.length, 1);

  const second = harness({
    advanceScript: [reply({ mode: "execute", step_id: "s3", step_response: stepResponse("generate_description", "token") }, { draft_id: 812 })],
    execute: () => { throw new HttpError(503, "<html>bad gateway</html>"); },
  });
  second.runner.start(7, second.initial);
  await second.runner.approve("all", planApprovalDigests(plan()), 6);
  assert.equal(second.runner.snapshot.phase, "paused");
  assert.equal(second.runner.snapshot.notice.kind, "server");
  assert.equal(second.calls.execute.length, 1);
  assert.equal(second.calls.advance.length, 1);
});

test("stop ends polling at once and tells the server", async () => {
  let releaseSleep = null;
  let now = 5_000;
  const clock = {
    now: () => now,
    sleep: (ms, signal) => new Promise((resolve) => {
      releaseSleep = () => { now += ms; resolve(); };
      signal.addEventListener("abort", () => resolve(), { once: true });
    }),
  };
  const { runner, calls, initial } = harness({
    clock,
    advanceScript: [
      reply({ mode: "wait", wait: { waiting_on: [{ step_id: "s3", service_id: 4410, service_name: "text_description" }], retry_after_ms: 2000, budget_ms: 360000 } }, { draft_id: 812, target: { kind: "open_listing" } }),
      (body) => {
        assert.equal(body.intent, "cancel");
        return reply({ mode: "cancelled" }, { status: "cancelled", draft_id: 812, target: { kind: "open_listing" } });
      },
    ],
    getService: () => ({ status: "processing" }),
  });
  runner.start(7, initial);
  const approving = runner.approve("all", planApprovalDigests(plan()), 6);
  await settle(() => runner.snapshot.phase === "waiting" && releaseSleep !== null, "polling");
  await runner.stop();
  await approving;
  assert.equal(calls.getService.length, 0, "no status read after stop");
  assert.deepEqual(calls.advance.map((call) => call.body.intent), ["approve", "cancel"]);
  assert.equal(runner.snapshot.phase, "cancelled");
  releaseSleep();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.getService.length, 0);
  assert.equal(calls.advance.length, 2);
});

test("a job that outlasts its budget pauses the plan and nothing is dispatched again", async () => {
  const { runner, calls, initial } = harness({
    advanceScript: [
      reply({ mode: "execute", step_id: "s3", step_response: stepResponse("generate_description", "token") }, { draft_id: 812, target: { kind: "open_listing" } }),
      reply({ mode: "wait", wait: { waiting_on: [{ step_id: "s3", service_id: 4410, service_name: "text_description" }], retry_after_ms: 2000, budget_ms: 0 } }, { draft_id: 812, target: { kind: "open_listing" } }),
    ],
    getService: () => ({ status: "processing" }),
  });
  runner.start(7, initial);
  await runner.approve("all", planApprovalDigests(plan()), 6);
  assert.equal(runner.snapshot.phase, "paused");
  assert.equal(runner.snapshot.notice.kind, "wait_timeout");
  assert.equal(calls.execute.length, 1);
  assert.equal(calls.advance.length, 2);
  // 2 s polls for the first 30 s (15), then every 5 s until the 360 s description budget (66).
  assert.equal(calls.getService.length, 81);
});

test("a restored plan never runs on its own", async () => {
  const { runner, calls, initial } = harness({
    advanceScript: [reply({ mode: "confirm", step_id: "s5", step_response: stepResponse("create_draft_share", "share-token") }, { draft_id: 812 })],
  });
  const parked = { ...initial, phase: "waiting", draftId: 812, navigatedDraftId: 812 };
  runner.start(7, parked);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runner.snapshot.phase, "paused");
  assert.equal(runner.snapshot.notice.kind, "restored");
  assert.equal(calls.advance.length + calls.execute.length + calls.upload.length + calls.getService.length, 0);

  await runner.resume();
  assert.deepEqual(calls.advance.map((call) => call.body.intent), ["continue"]);
  assert.equal(calls.execute.length, 0);
  assert.equal(calls.navigate.length, 0, "a listing opened before the reload is not opened again");
});

test("an expired step token is re-minted once, then the plan stops", async () => {
  const expired = new HttpError(403, { detail: "This Agent description action is invalid or expired." });
  const { runner, calls, initial } = harness({
    advanceScript: [
      reply({ mode: "execute", step_id: "s3", step_response: stepResponse("generate_description", "token-a") }, { draft_id: 812 }),
      (body) => {
        assert.equal(body.intent, "refresh");
        return reply({ mode: "execute", step_id: "s3", step_response: stepResponse("generate_description", "token-b") }, { draft_id: 812 });
      },
    ],
    execute: () => { throw expired; },
  });
  runner.start(7, initial);
  await runner.approve("all", planApprovalDigests(plan()), 6);
  assert.deepEqual(calls.execute.map((call) => call.actionToken), ["token-a", "token-b"]);
  assert.equal(runner.snapshot.phase, "failed");
  assert.equal(calls.advance.length, 2);
});

test("a changed plan must be approved again", async () => {
  const changed = plan({ steps: plan().steps.map((item) => item.step_id === "s5" ? { ...item, digest: "digest-new" } : item) });
  const { runner, calls, initial } = harness({
    advanceScript: [new HttpError(409, { detail: "plan_changed", plan: changed, plan_token: "token-changed" })],
  });
  runner.start(7, initial);
  await runner.approve("all", planApprovalDigests(plan()), 6);
  assert.equal(runner.snapshot.phase, "awaiting_approval");
  assert.equal(runner.snapshot.notice.kind, "plan_changed");
  assert.equal(runner.planToken, "token-changed");
  assert.equal(runner.snapshot.plan.steps[4].digest, "digest-new");
  assert.equal(calls.execute.length, 0);
});

test("a partial photo upload pauses, and Continue reports what did upload", async () => {
  const { runner, calls, initial } = harness({
    advanceScript: [
      reply({ mode: "client", step_id: "s2", client: { kind: "upload_pending_photos", draft_id: 812, expected_count: 6 } }, { draft_id: 812 }),
      (body) => {
        assert.deepEqual(body.client_result, { step_id: "s2", uploaded_upload_ids: [11, 12, 13, 14], failed_count: 2 });
        return reply({ mode: "awaiting_approval" }, { draft_id: 812 });
      },
    ],
    uploadPhotos: () => ({ uploadedUploadIds: [11, 12, 13, 14], failedCount: 2, attemptedCount: 6 }),
  });
  runner.start(7, initial);
  await runner.approve("all", planApprovalDigests(plan()), 6);
  assert.equal(runner.snapshot.phase, "paused");
  assert.equal(runner.snapshot.notice.kind, "photos_failed");
  assert.equal(runner.snapshot.notice.count, 2);
  assert.equal(calls.advance.length, 1);
  await runner.resume();
  assert.equal(calls.advance.length, 2);
});

test("photos lost with the page turn the photo step into a question", async () => {
  const { runner, calls, initial } = harness({
    advanceScript: [
      reply({ mode: "client", step_id: "s2", client: { kind: "upload_pending_photos", draft_id: 812, expected_count: 6 } }, { draft_id: 812 }),
    ],
    uploadPhotos: () => ({ uploadedUploadIds: [], failedCount: 0, attemptedCount: 0 }),
  });
  runner.start(7, initial);
  await runner.approve("all", planApprovalDigests(plan()), 6);
  assert.equal(runner.snapshot.phase, "asking");
  assert.equal(runner.snapshot.question.kind, "photos");
  assert.equal(runner.snapshot.notice.kind, "photos_missing");
  assert.equal(calls.ask.length, 1);
  assert.equal(calls.advance.length, 1);
});

test("confirming a step card runs only that step and ignores a stale card", async () => {
  const { runner, calls, initial } = harness({
    advanceScript: [
      reply({ mode: "confirm", step_id: "s5", step_response: stepResponse("create_draft_share", "share-token") }, { draft_id: 812 }),
      reply({ mode: "done", summary: { draft_id: 812, completed: ["s5"], skipped: [], failed: [] } }, { draft_id: 812 }),
    ],
  });
  runner.start(7, initial);
  await runner.approve("step", planApprovalDigests(plan()), 0);
  assert.equal(await runner.confirmStep("s4", stepResponse("translate_description", "other")), null);
  assert.equal(calls.execute.length, 0);
  await runner.confirmStep("s5", calls.confirm[0].response);
  await settle(() => runner.snapshot.phase === "done");
  assert.deepEqual(calls.execute.map((call) => call.actionCode), ["create_draft_share"]);
});

test("up-front questions block approval, except photos once some are dropped", () => {
  const withQuestions = plan({
    status: "needs_input",
    steps: [
      step("s1", "create_listing"),
      step("s2", "attach_photos", { status: "needs_input", question: { kind: "photos", text: "", options: [], allows_text: false } }),
      step("s3", "translate_description", { status: "needs_input", question: { kind: "target_language", text: "Which language?", options: [], allows_text: true } }),
    ],
  });
  assert.deepEqual(openPlanQuestions(withQuestions, 0).map((item) => item.step_id), ["s2", "s3"]);
  assert.deepEqual(openPlanQuestions(withQuestions, 3).map((item) => item.step_id), ["s3"]);
});

test("errors are classified by status and body, without importing the API client", () => {
  assert.equal(classifyPlanError(new TypeError("Failed to fetch")).kind, "network");
  assert.equal(classifyPlanError(new HttpError(502, "")).kind, "server");
  assert.equal(classifyPlanError(new HttpError(409, { detail: "This creation has no description to translate." })).kind, "conflict");
  assert.equal(classifyPlanError(new HttpError(409, { detail: "plan_changed" })).kind, "plan_changed");
  assert.equal(classifyPlanError(new HttpError(403, { detail: "This Agent plan is invalid or expired." })).kind, "expired_token");
  assert.equal(classifyPlanError(new HttpError(403, { detail: "x", code: "processing_quota" })).kind, "quota");
});
