import assert from "node:assert/strict";
import test from "node:test";

import {
  newestLiveSplatPreview,
  presentableLiveSplatPreview,
} from "./live-scan-preview.ts";

function preview(overrides = {}) {
  return {
    epoch: 1,
    trust: "provisional",
    authority: "provisional",
    floor_status: "pending",
    show_floor_grid: false,
    format: "ply",
    source_sequence: 4,
    point_count: 1_000,
    camera_count: 4,
    gauge_revision: 0,
    gauge_reset: false,
    stage: "forming",
    refined: false,
    splat_url: "https://example.invalid/first",
    expires_in: 300,
    ...overrides,
  };
}

test("a forming cloud advances inside the same epoch and gauge", () => {
  const current = preview();
  const incoming = preview({
    source_sequence: 12,
    point_count: 8_000,
    camera_count: 11,
    splat_url: "https://example.invalid/later",
  });

  assert.equal(newestLiveSplatPreview(current, incoming), incoming);
});

test("a stale publication cannot replace the visible cloud", () => {
  const current = preview({ epoch: 3, source_sequence: 24 });
  const stale = preview({ epoch: 2, source_sequence: 40 });

  assert.equal(newestLiveSplatPreview(current, stale), current);
});

test("a changed signature alone does not redownload unchanged geometry", () => {
  const current = preview();
  const resigned = preview({ splat_url: "https://example.invalid/resigned" });

  assert.equal(newestLiveSplatPreview(current, resigned), current);
});

test("a ready durable PLY upgrades its immediate inline preview", () => {
  const current = preview({
    splat_url: "",
    inline_ply_base64: "cGx5Cg==",
    inline_ply_sha256: "a".repeat(64),
    durable_ply_ready: false,
  });
  const durable = preview({
    splat_url: "https://example.invalid/full",
    inline_ply_base64: "cGx5Cg==",
    inline_ply_sha256: "a".repeat(64),
    durable_ply_ready: true,
  });

  assert.equal(newestLiveSplatPreview(current, durable), durable);
});

test("the terminal refined publication replaces its forming version", () => {
  const current = preview();
  const refined = preview({ stage: "refined", refined: true });

  assert.equal(newestLiveSplatPreview(current, refined), refined);
});

test("a qualified publication replaces the matching provisional geometry", () => {
  const current = preview();
  const qualified = preview({
    trust: "qualified",
    authority: "otter",
    floor_status: "locked",
    show_floor_grid: true,
    stage: "validated",
  });

  assert.equal(newestLiveSplatPreview(current, qualified), qualified);
});

test("Done never presents a provisional fragment as the room result", () => {
  const forming = preview();
  const qualified = preview({ trust: "qualified", authority: "otter" });

  assert.equal(presentableLiveSplatPreview(forming, false), forming);
  assert.equal(presentableLiveSplatPreview(forming, true), null);
  assert.equal(presentableLiveSplatPreview(qualified, true), qualified);
});
