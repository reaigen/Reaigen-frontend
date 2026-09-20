import assert from "node:assert/strict";
import test from "node:test";
import { consumeAcceptedAgentSources, discardAgentSourceTokens, discardPoolSourceTokens, isAgentAttachmentResponse } from "./agent-sources.ts";

test("source tokens are consumed only after signed context accepts them; later files remain pending", () => {
  const first = new File(["facts"], "facts.txt");
  const second = new File(["new facts"], "new.txt");
  const queue = [first, second];
  const sources = new Map([[first, "original-source"], [second, "new-source"]]);
  consumeAcceptedAgentSources(sources, ["original-source"], null);
  assert.equal(sources.size, 2);
  consumeAcceptedAgentSources(sources, ["original-source"], "renewed-listing-context");
  assert.deepEqual([...sources.values()], ["new-source"]);
  assert.deepEqual(queue, [first, second], "consuming source authority does not remove files waiting to upload");
});

test("expired extraction tokens can be removed without deleting private evidence", () => {
  const pool = [{ kind: "document", uploadId: 91, label: "facts.pdf", sourceToken: "expired" }, { kind: "document", uploadId: 92, label: "new.pdf", sourceToken: "new" }, { kind: "image", uploadId: 93, label: "photo", url: "/photo" }];
  const next = discardPoolSourceTokens(pool, ["expired"]);
  assert.deepEqual(next[0], { kind: "document", uploadId: 91, label: "facts.pdf", sourceToken: undefined });
  assert.equal(next[1], pool[1]);
  assert.equal(next[2], pool[2]);
  const sources = new Map([["one", "expired"], ["two", "new"]]);
  discardAgentSourceTokens(sources, ["expired"]);
  assert.deepEqual([...sources.values()], ["new"]);
});

test("a mixed document drop renders its creation review or question instead of discarding it", () => {
  for (const code of ["create_listing", "clarify_new_listing", "discuss_new_listing", "attachment_options", "tool_unavailable"]) {
    assert.equal(isAgentAttachmentResponse(code), true, code);
  }
  for (const code of ["settings_update", "create_draft_share", "viewer_control", undefined]) {
    assert.equal(isAgentAttachmentResponse(code), false, code);
  }
  assert.equal(isAgentAttachmentResponse("create_listing", 1, 2), false, "a slow drop reaction must not replace newer typed listing facts");
});
