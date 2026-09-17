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
