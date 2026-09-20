import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { canApplyDirectEdit } from "./agent-direct-edit.ts";
import { markSourceImportAttempt, monitorSourceImportProgress, reviewedSourceImageFile, reviewedSourceImport, sourceImageCandidates, unattemptedSourceImports } from "./agent-document-import.ts";

registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); } catch (error) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });
const client = await import("./api/client.ts");

const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9]);
const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((part) => part.toString(16).padStart(2, "0")).join("");
const image = { id: "p1-image-1", page: 1, pages: [1, 2], width: 640, height: 480, mime_type: "image/jpeg", byte_size: bytes.length, sha256, preview_data_url: `data:image/jpeg;base64,${btoa(String.fromCharCode(...bytes))}`, requires_review: true };

test("drop followed by chat maps new source tokens once; ambiguous failures require explicit retry", () => {
  const attempted = new Set();
  assert.deepEqual(unattemptedSourceImports(["pdf", "pdf"], attempted), ["pdf"]);
  markSourceImportAttempt(["pdf"], attempted);
  assert.deepEqual(unattemptedSourceImports(["pdf"], attempted), [], "record before the request, even if its response is lost");
  assert.deepEqual(unattemptedSourceImports(["pdf", "new-pdf"], attempted), ["new-pdf"]);
  assert.deepEqual(unattemptedSourceImports(["pdf"], attempted, 8), ["pdf"], "target scope is explicit");
});

test("source mapping stays a review even if a response accidentally carries a direct-edit flag", () => {
  const answer = reviewedSourceImport({
    reply: "Mapped", source_import: { status: "mapped", mappings: [] },
    direct_edit: true, direct_edit_draft_id: 8, execution_mode: "deterministic",
    selected_creation_ids: [8], proposed_changes: { price: 290000 }, proposal_token: "signed-review",
    client_action: { confirmation_required: false }, settings_changes: { preferred_language: "de" }, navigation_path: "/draft/8",
  });
  assert.equal(canApplyDirectEdit(answer, { draftId: 8, userId: 2, generation: 0, consented: true }), false);
  assert.equal(answer.proposal_token, "signed-review", "normal Apply review remains available");
  assert.equal(answer.client_action, null);
  assert.equal(answer.settings_changes, undefined);
  assert.equal(answer.navigation_path, null);
  const question = reviewedSourceImport({ ...answer, source_import: { status: "mapped", requires_input: true, mappings: [{ field: "price", value: 290000 }] }, action_token: "old-create-token" });
  assert.equal(question.proposal_token, null, "partial mappings remain non-executable until clarification");
  assert.equal(question.action_token, null);
});

test("only bounded review-required JPEG previews are accepted; external URLs and active formats are rejected", () => {
  assert.deepEqual(sourceImageCandidates([image]), [image]);
  for (const change of [
    { requires_review: false }, { mime_type: "image/svg+xml" }, { preview_data_url: "https://example.com/image.jpg" },
    { preview_data_url: "data:image/svg+xml;base64,AAAA" }, { byte_size: 180001 }, { width: 1281 },
    { page: 0 }, { page: 41 }, { id: "../../picture" }, { sha256: "unverified" }, { preview_data_url: `data:image/jpeg;base64,${"A".repeat(240001)}` },
  ]) assert.deepEqual(sourceImageCandidates([{ ...image, ...change }]), [], JSON.stringify(change).slice(0, 120));
  assert.equal(sourceImageCandidates(Array.from({ length: 20 }, (_, index) => ({ ...image, id: `p1-image-${index + 1}` }))).length, 12);
});

test("image review and explicit selection never upload; a selected File retains verified bytes", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("Unexpected upload"); };
  try {
    const candidates = sourceImageCandidates([image]);
    assert.equal(calls, 0, "displaying candidates does not publish them");
    const file = await reviewedSourceImageFile(candidates[0], "Brochure.pdf");
    assert.ok(file instanceof File);
    assert.equal(file.name, "Brochure-p1-image-1.jpg");
    assert.equal(file.type, "image/jpeg");
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
    assert.equal(calls, 0, "selection stages locally; the reviewed Create/Add action owns uploading");
    await assert.rejects(reviewedSourceImageFile({ ...image, sha256: "0".repeat(64) }, "Brochure.pdf"));
    await assert.rejects(reviewedSourceImageFile({ ...image, byte_size: bytes.length + 1 }, "Brochure.pdf"));
  } finally { globalThis.fetch = original; }
});

test("source import sends only signed sources and conversation context, never PDF or image bytes or an apply request", async () => {
  const original = globalThis.fetch;
  const requests = [];
  client.resetPrivateApiState();
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      reply: "Review", source_import: { status: "mapped", mappings: [{ field: "title", value: "Garden apartment", source_name: "Brochure.pdf", page: 2, excerpt: "Garden apartment" }] },
      action_code: "create_listing", action_token: "signed-create-review", proposal_token: null,
      listing_draft: { fields: { title: "Garden apartment", description: "Document description" }, specs: {}, ready: true, missing: [] },
    }), { status: 200 });
  };
  try {
    const answer = await client.importReaiSources({ sourceTokens: ["signed-source", "signed-source"], message: "import this brochure", creationContextToken: "signed-facts", conversation: [{ role: "user", content: "Use EUR" }], language: "sk" });
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /workspace\/source-import\/$/);
    assert.deepEqual(requests[0].body, { source_tokens: ["signed-source"], message: "import this brochure", creation_context_token: "signed-facts", conversation: [{ role: "user", content: "Use EUR" }], language: "sk" });
    assert.equal(answer.listing_draft.fields.description, "Document description");
    assert.equal(answer.source_import.mappings[0].page, 2);
    assert.equal(answer.action_token, "signed-create-review", "creation remains a separate explicit review action");
  } finally { globalThis.fetch = original; client.resetPrivateApiState(); }
});

test("saved evidence is explicitly listed and re-read by draft/upload IDs without copying bytes or fetching a file URL", async () => {
  const original = globalThis.fetch;
  const requests = [];
  client.resetPrivateApiState();
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), ...init });
    return new Response(JSON.stringify(String(url).includes("uploads/?")
      ? { results: [{ id: 42, role: "evidence", file_url: "https://private.example/not-fetched.pdf", file_name: "brochure.pdf" }] }
      : { source_token: "fresh-signed-source", evidence_upload_id: 42, draft_id: 8, image_candidates: [image] }), { status: 200 });
  };
  try {
    const files = await client.listDraftUploads(8, { role: "evidence", fresh: true });
    assert.equal(new URL(requests[0].url, "https://app.example").searchParams.get("role"), "evidence");
    const result = await client.intakeSavedReaiEvidence(8, files[0].id);
    assert.match(requests[1].url, /workspace\/drafts\/8\/sources\/42\/intake\/$/);
    assert.equal(requests[1].method, "POST");
    assert.deepEqual(JSON.parse(requests[1].body), {});
    assert.equal(result.evidence_upload_id, 42);
    assert.equal(requests.length, 2, "no storage upload, presign or external source URL request");
  } finally { globalThis.fetch = original; client.resetPrivateApiState(); }
});

test("import progress reflects only observed server stages and never executes an action", async () => {
  const stages = ["reading", "searching", "mapping", "validating", "ready"];
  const observed = [];
  let now = 0;
  await monitorSourceImportProgress({
    getStatus: async () => { const stage = stages.shift(); return { stage, terminal: stage === "ready", updated_at: "2026-09-20T00:00:00Z" }; },
    onProgress: (progress) => observed.push(progress?.stage ?? null),
    now: () => now, sleep: async (ms) => { assert.equal(ms, 4000); now += ms; }, signal: new AbortController().signal,
  });
  assert.deepEqual(observed, ["reading", "searching", "mapping", "validating", "ready"]);
});

test("missing or failed status stays generic, then deadline stops reads without claiming completion", async () => {
  const observed = [];
  let now = 0;
  let reads = 0;
  await monitorSourceImportProgress({
    getStatus: async () => { reads += 1; throw new Error("404 or offline"); },
    onProgress: (progress) => observed.push(progress),
    now: () => now, sleep: async (ms) => { now += ms; }, signal: new AbortController().signal, budgetMs: 9000,
  });
  assert.equal(reads, 3);
  assert.equal(now, 9000);
  assert.deepEqual(observed, [null, null, null, null]);
});

test("revocation or clearing the conversation ignores a late status and stops further reads", async () => {
  const controller = new AbortController();
  let reads = 0;
  const observed = [];
  await monitorSourceImportProgress({
    getStatus: async () => { reads += 1; controller.abort(); return { stage: "ready", terminal: true }; },
    onProgress: (progress) => observed.push(progress),
    now: () => 0, sleep: async () => { throw new Error("must not poll again"); }, signal: controller.signal,
  });
  assert.equal(reads, 1);
  assert.deepEqual(observed, []);
});

test("a status authorization refusal stops polling immediately without completing the import", async () => {
  let reads = 0;
  const observed = [];
  await monitorSourceImportProgress({
    getStatus: async () => { reads += 1; throw { status: 403 }; },
    onProgress: (progress) => observed.push(progress),
    now: () => 0, sleep: async () => { throw new Error("authorization refusal must stop reads"); }, signal: new AbortController().signal,
  });
  assert.equal(reads, 1);
  assert.deepEqual(observed, [null]);
});

test("progress GETs bypass cache and share only the attempt UUID with the import POST", async () => {
  const original = globalThis.fetch;
  const requests = [];
  const id = "508c1539-370f-4a7c-bfdd-e28880a82540";
  client.resetPrivateApiState();
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), ...init });
    return new Response(JSON.stringify({ stage: "mapping", terminal: false, updated_at: "2026-09-20T00:00:00Z" }), { status: 200 });
  };
  try {
    await client.importReaiSources({ sourceTokens: ["signed"], message: "import", importRequestId: id });
    assert.equal(JSON.parse(requests[0].body).import_request_id, id);
    await client.getReaiSourceImportProgress(id);
    await client.getReaiSourceImportProgress(id);
    assert.equal(requests.length, 3, "each status read is fresh; no extra import POST");
    assert.match(requests[1].url, new RegExp(`/source-import/${id}/status/$`));
    assert.equal(requests[1].cache, "no-store");
    assert.equal(requests[1].body, undefined);
  } finally { globalThis.fetch = original; client.resetPrivateApiState(); }
});
