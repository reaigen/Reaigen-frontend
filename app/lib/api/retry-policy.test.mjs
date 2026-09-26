import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import { isRetryableGetHttpStatus } from "./retry-policy.ts";

// The API client imports its siblings without file extensions (bundler
// resolution). Resolve those to the .ts sources so the real client — not a
// copy of its logic — can be exercised against a stubbed fetch.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

test("429 stops immediately instead of extending a user throttle lockout", () => {
  assert.equal(isRetryableGetHttpStatus(429), false);
});

test("temporary gateway failures remain bounded retry candidates", () => {
  for (const status of [408, 425, 502, 503, 504, 520, 521, 522, 523, 524]) {
    assert.equal(isRetryableGetHttpStatus(status), true, String(status));
  }
});

test("authentication, authorization, validation, and conflict responses never retry", () => {
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert.equal(isRetryableGetHttpStatus(status), false, String(status));
  }
});

function stubFetch(respond) {
  const requests = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method ?? "GET", body: init.body });
    return respond(requests.length);
  };
  return { requests, restore: () => { globalThis.fetch = original; } };
}

test("an Agent plan advance is sent exactly once, whatever the failure", async () => {
  const client = await import("./client.ts");
  const failures = [
    ["gateway 502", () => new Response("bad gateway", { status: 502 })],
    ["unavailable 503", () => new Response("", { status: 503 })],
    ["gateway timeout 504", () => new Response("", { status: 504 })],
    ["edge 522", () => new Response("", { status: 522 })],
    ["throttled 429", () => new Response(JSON.stringify({ detail: "Request was throttled." }), { status: 429 })],
    ["network", () => { throw new TypeError("Failed to fetch"); }],
  ];
  for (const [label, respond] of failures) {
    const stub = stubFetch(respond);
    try {
      await assert.rejects(
        client.advanceReaiAgentPlan("signed-plan-token", { intent: "continue" }),
        undefined,
        label,
      );
      assert.equal(stub.requests.length, 1, label);
      assert.equal(stub.requests[0].method, "POST", label);
      assert.equal(stub.requests[0].url, client.REAI_AGENT_PLAN_ADVANCE_PATH, label);
      assert.deepEqual(JSON.parse(stub.requests[0].body), { intent: "continue", plan_token: "signed-plan-token" }, label);
    } finally {
      stub.restore();
    }
  }
});

test("the stubbed transport does see the bounded GET retry, so the single POST is meaningful", async () => {
  const client = await import("./client.ts");
  const stub = stubFetch((attempt) => (
    attempt < 3
      ? new Response("", { status: 503 })
      : new Response(JSON.stringify({ id: 4410, service_name: "text_description", status: "completed", error_message: null, output_data: null }), { status: 200 })
  ));
  try {
    const service = await client.getDraftService(4410);
    assert.equal(service.status, "completed");
    assert.equal(stub.requests.length, 3);
    assert.ok(stub.requests.every((request) => request.method === "GET"));
  } finally {
    stub.restore();
  }
});

// The agent panel paints from the cached consent answer (2026-09-26, operator:
// "we open the tab and the rest of the agent's UI comes after seconds"). This
// is the file that drives the real client against a stubbed fetch, so the
// consent cache contract is proven here rather than by reading source.
const CONSENT = { consented: true, policy_version: "v1", granted_at: null, privacy: {} };

async function withBrowserClock(run) {
  const client = await import("./client.ts");
  const hadWindow = "window" in globalThis;
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  // peekReaiAgentConsent is a browser-only first-paint hint.
  if (!hadWindow) globalThis.window = globalThis;
  client.resetPrivateApiState();
  const stub = stubFetch(() => new Response(JSON.stringify(CONSENT), { status: 200 }));
  try {
    await run(client, stub, (ms) => { now += ms; });
  } finally {
    stub.restore();
    client.resetPrivateApiState();
    Date.now = realNow;
    if (!hadWindow) delete globalThis.window;
  }
}

test("agent consent is cached for five minutes and peeked without a request", async () => {
  await withBrowserClock(async (client, stub, advance) => {
    assert.equal(client.peekReaiAgentConsent(), null, "nothing cached yet");
    await client.getReaiAgentConsent();
    assert.equal(stub.requests.length, 1);
    assert.deepEqual(client.peekReaiAgentConsent(), CONSENT);
    advance(4 * 60_000);
    await client.getReaiAgentConsent();
    assert.equal(stub.requests.length, 1, "still fresh after four minutes");
    assert.deepEqual(client.peekReaiAgentConsent(), CONSENT);
    advance(61_000);
    assert.equal(client.peekReaiAgentConsent(), null, "stale after five minutes");
    await client.getReaiAgentConsent();
    assert.equal(stub.requests.length, 2);
  });
});

test("ordinary agent POSTs keep the consent entry; consent writes drop it", async () => {
  await withBrowserClock(async (client, stub) => {
    await client.getReaiAgentConsent();
    await client.getReaiToolPermissions();
    // Feedback shares the bare /reai-agent/ prefix with consent, and a chat
    // turn is the most frequent agent POST of all.
    await client.saveReaiFeedback("conversation-1", true);
    await client.askReaiWorkspace("hello");
    assert.deepEqual(client.peekReaiAgentConsent(), CONSENT, "agent traffic keeps consent");
    await client.getReaiAgentConsent();
    await client.getReaiToolPermissions();
    const gets = stub.requests.filter((request) => request.method === "GET").map((request) => request.url);
    assert.deepEqual(gets, [
      "/api/reaigen/reai-agent/consent/",
      "/api/reaigen/reai-agent/tool-permissions/",
      "/api/reaigen/reai-agent/tool-permissions/",
    ], "the rest of /reai-agent/ is still invalidated as before");

    await client.revokeReaiAgentConsent();
    assert.equal(client.peekReaiAgentConsent(), null, "withdrawing consent drops it");
    await client.getReaiAgentConsent();
    await client.grantReaiAgentConsent("v1");
    assert.equal(client.peekReaiAgentConsent(), null, "granting consent drops it");
    await client.getReaiAgentConsent();
    const consentGets = stub.requests.filter((request) => request.method === "GET" && request.url === "/api/reaigen/reai-agent/consent/");
    assert.equal(consentGets.length, 3, "each consent write is followed by a fresh read");
  });
});
