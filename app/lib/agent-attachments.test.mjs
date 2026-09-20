import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { describeAgentAttachment, pendingImageCount, remainingAgentAttachments } from "./agent-attachments.ts";
import { pendingCreationContextToken } from "./agent-conversation.ts";
import { canApplyDirectEdit } from "./agent-direct-edit.ts";
import { addPoolItem, poolItemsForRequest } from "./agent-pool.ts";

registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); } catch (error) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });
const client = await import("./api/client.ts");
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

async function withTransport(respond, run) {
  const original = globalThis.fetch;
  const requests = [];
  client.resetPrivateApiState();
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: String(url), ...init, json: typeof init.body === "string" ? JSON.parse(init.body) : null };
    requests.push(request);
    return respond(request, requests);
  };
  try { await run(requests); } finally { globalThis.fetch = original; client.resetPrivateApiState(); }
}

test("mixed files keep true image counts and reject unsupported or mismatched types", () => {
  const photo = new File(["image"], "photo.JPG", { type: "image/jpeg" });
  const pdf = new File(["%PDF-1.7"], "details.pdf", { type: "application/pdf" });
  const video = new File(["video"], "tour.mov", { type: "video/quicktime" });
  assert.equal(pendingImageCount([photo, pdf, video]), 1);
  assert.equal(describeAgentAttachment(pdf).kind, "document");
  assert.equal(describeAgentAttachment(new File(["plain"], "facts.txt", { type: "" })).content_type, "text/plain");
  assert.equal(describeAgentAttachment(new File(["x"], "script.svg", { type: "image/svg+xml" })), null);
  assert.equal(describeAgentAttachment(new File(["x"], "facts.pdf", { type: "text/html" })), null);
  for (const [name, type, expected] of [
    ["facts.docx", "application/zip", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["facts.xlsx", "", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["facts.pptx", "application/octet-stream", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["facts.csv", "application/vnd.ms-excel", "text/csv"],
  ]) assert.equal(describeAgentAttachment(new File(["evidence"], name, { type })).content_type, expected);
  assert.equal(describeAgentAttachment(new File(["x"], "macros.docm", { type: "application/zip" })), null);
  assert.equal(describeAgentAttachment({ name: "too-large.pdf", type: "application/pdf", size: 25 * 1024 ** 2 + 1 }), null);
  assert.deepEqual(remainingAgentAttachments([photo, pdf, video], [photo, pdf], [pdf]), [pdf, video]);
});

test("private evidence uses DOCUMENT and evidence on presign and confirmation", async () => {
  const file = new File(["%PDF-1.7"], "private.pdf", { type: "application/pdf" });
  await withTransport((request) => {
    if (request.url.includes("asset-types")) return json({ id: 7, code: "DOCUMENT" });
    if (request.url.endsWith("presign/")) return json({ upload_mode: "single", upload_key: "uploads/draft_8/private", presigned_url: "https://storage.example/file" });
    if (request.url.startsWith("https://storage.example")) return new Response("", { status: 200 });
    return json({ id: 31, role: "evidence", is_gallery_visible: false });
  }, async (requests) => {
    const result = await client.uploadDraftAttachment(8, file, 0);
    assert.equal(result.is_gallery_visible, false);
    assert.equal(requests.find((request) => request.url.includes("asset-types")).url.endsWith("code=DOCUMENT"), true);
    for (const endpoint of ["presign/", "confirm/"]) assert.equal(requests.find((request) => request.url.endsWith(endpoint)).json.role, "evidence");
    assert.equal(requests.find((request) => request.url.startsWith("https://storage.example")).credentials, "omit");
  });
});

test("confirmation retry reuses the uploaded bytes and upload key", async () => {
  const file = new File(["image"], "photo.jpg", { type: "image/jpeg" });
  let confirms = 0;
  await withTransport((request) => {
    if (request.url.includes("asset-types")) return json({ id: 1, code: "RAW_IMAGE" });
    if (request.url.endsWith("presign/")) return json({ upload_mode: "single", upload_key: "same-key", presigned_url: "https://storage.example/file" });
    if (request.url.startsWith("https://storage.example")) return new Response("", { status: 200 });
    return ++confirms === 1 ? json({ error: "temporary" }, 503) : json({ id: 31 });
  }, async (requests) => {
    await assert.rejects(client.uploadDraftPhoto(8, file, 0));
    await client.uploadDraftPhoto(8, file, 4);
    assert.equal(requests.filter((request) => request.url.endsWith("presign/")).length, 1);
    assert.equal(requests.filter((request) => request.method === "PUT").length, 1);
    assert.deepEqual(requests.filter((request) => request.url.endsWith("confirm/")).map((request) => request.json.sort_order), [0, 0]);
  });
});

test("multipart video retries only the failed part, then confirms every receipt", async () => {
  const file = new File(["12345678"], "tour.mp4", { type: "video/mp4" });
  let secondAttempts = 0;
  await withTransport((request) => {
    if (request.url.includes("asset-types")) return json({ id: 2, code: "VIDEO" });
    if (request.url.endsWith("presign/")) return json({ upload_mode: "multipart", upload_key: "video-key", multipart: { upload_id: "multipart-1", part_size: 4, parts: [{ part_number: 1, url: "https://storage.example/1" }, { part_number: 2, url: "https://storage.example/2" }] } });
    if (request.url.endsWith("/2") && secondAttempts++ === 0) return new Response("", { status: 503 });
    if (request.method === "PUT") return new Response("", { status: 200, headers: { ETag: `receipt-${request.url.at(-1)}` } });
    return json({ id: 44 });
  }, async (requests) => {
    await assert.rejects(client.uploadDraftAttachment(8, file, 0));
    await client.uploadDraftAttachment(8, file, 0);
    assert.equal(requests.filter((request) => request.url.endsWith("/1")).length, 1);
    const confirm = requests.find((request) => request.url.endsWith("confirm/")).json;
    assert.equal(confirm.role, "video");
    assert.equal(confirm.upload_id, "multipart-1");
    assert.deepEqual(confirm.parts, [{ part_number: 1, etag: "receipt-1" }, { part_number: 2, etag: "receipt-2" }]);
  });
});

test("an account boundary prevents a late storage upload from confirming as the next user", async () => {
  const file = new File(["image"], "photo.jpg", { type: "image/jpeg" });
  await withTransport((request) => {
    if (request.url.includes("asset-types")) return json({ id: 1 });
    if (request.url.endsWith("presign/")) return json({ upload_mode: "single", upload_key: "private-key", presigned_url: "https://storage.example/file" });
    client.resetPrivateApiState();
    return new Response("", { status: 200 });
  }, async (requests) => {
    await assert.rejects(client.uploadDraftPhoto(8, file, 0), (error) => error.status === 409);
    assert.equal(requests.some((request) => request.url.endsWith("confirm/")), false);
  });
});

test("document intake uses multipart without a JSON content type; context carries exact selection and signed facts", async () => {
  const file = new File(["facts"], "facts.txt", { type: "text/plain" });
  await withTransport(() => json({ source_token: "signed-source", reply: "Review" }), async (requests) => {
    await client.intakeReaiAttachment(file);
    assert.ok(requests[0].body instanceof FormData);
    assert.equal(requests[0].headers["Content-Type"], undefined);
    const selected = { kind: "field", path: "specs.layout.bedrooms", label: "Bedrooms", value: "3" };
    const pool = addPoolItem([{ kind: "document", uploadId: 31, label: "facts.txt" }], selected);
    await client.askReaiWorkspace("change this to 4", 8, [], null, undefined, undefined, "draft", undefined, poolItemsForRequest(pool), undefined, { sourceTokens: ["signed-source"], creationContextToken: "signed-facts", pendingAttachments: [describeAgentAttachment(file)] });
    assert.deepEqual(requests[1].json.attached_items, [{ kind: "document", upload_id: 31 }, { kind: "field", path: "specs.layout.bedrooms" }]);
    assert.equal(requests[1].json.creation_context_token, "signed-facts");
    assert.deepEqual(requests[1].json.source_tokens, ["signed-source"]);
    assert.equal(requests[1].json.pending_attachments[0].kind, "document");
  });
});

test("creation facts survive a longer conversation and stop after creation", () => {
  const turns = [{ role: "assistant", response: { action_code: "clarify_new_listing", creation_context_token: "first-facts" } }, ...Array.from({ length: 8 }, () => ({ role: "user" }))];
  assert.equal(pendingCreationContextToken(turns), "first-facts");
  turns.push({ role: "assistant", actionStatus: "applied", response: { action_code: "create_listing", creation_context_token: "old-facts" } });
  assert.equal(pendingCreationContextToken(turns), null);
});

for (const verified of [true, false]) {
  test(verified ? "a verified typed edit applies while a PDF remains attached" : "an unflagged sourced suggestion never applies directly", async () => {
    const response = {
      reply: "Prepared", execution_mode: "deterministic", selected_creation_ids: [8],
      proposed_changes: { price: 321000 }, proposal_token: "signed-proposal",
      ...(verified ? { direct_edit: true, direct_edit_draft_id: 8 } : {}),
    };
    await withTransport(() => json(response), async (requests) => {
      const answer = await client.askReaiWorkspace(
        verified ? "set price to 321000" : "use the price from the PDF", 8, [], null,
        undefined, undefined, "draft", undefined, [{ kind: "document", upload_id: 31 }], undefined,
        { sourceTokens: ["signed-pdf-source"] },
      );
      assert.deepEqual(requests[0].json.source_tokens, ["signed-pdf-source"]);
      assert.deepEqual(requests[0].json.attached_items, [{ kind: "document", upload_id: 31 }]);
      const eligible = canApplyDirectEdit(answer, { draftId: 8, userId: 2, generation: 0, consented: true });
      assert.equal(eligible, verified);
      if (eligible) await client.applyReaiWorkspaceProposal(answer.proposal_token, 8);
      assert.equal(requests.filter((request) => request.url.endsWith("workspace/apply/")).length, verified ? 1 : 0);
    });
  });
}
