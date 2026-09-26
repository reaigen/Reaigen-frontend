import assert from "node:assert/strict";
import test from "node:test";

import { parseAgentReply, parseInline } from "./agent-reply-format.ts";

test("a Markdown table becomes a table, not pipes (Bench 04 L01, L04)", () => {
  const blocks = parseAgentReply("ALPHA, latest:\n\n| Fact | ALPHA |\n|---|---|\n| Price | EUR 247,000 |\n| Floor | 3 of 6 |\n\nALPHA-END");
  assert.deepEqual(blocks.map((block) => block.kind), ["paragraph", "table", "paragraph"]);
  const table = blocks[1];
  assert.deepEqual(table.header.map((cell) => cell[0].text), ["Fact", "ALPHA"]);
  assert.deepEqual(table.rows.map((row) => row.map((cell) => cell[0].text)), [["Price", "EUR 247,000"], ["Floor", "3 of 6"]]);
  assert.equal(blocks[2].lines[0][0].text, "ALPHA-END");
});

test("lists, numbered steps and bold are read; the rest stays text", () => {
  const blocks = parseAgentReply("Hotovo:\n- cena 247 000 €\n- **poschodie** 3\n1. first\n2. second");
  assert.deepEqual(blocks.map((block) => [block.kind, block.ordered]), [["paragraph", undefined], ["list", false], ["list", true]]);
  assert.deepEqual(blocks[1].items[1], [{ text: "poschodie", strong: true }, { text: " 3" }]);
  assert.deepEqual(parseInline("a ** b"), [{ text: "a ** b" }], "an unmatched ** stays text");
});

test("a pipe inside a sentence is not a table, and nothing becomes markup", () => {
  const blocks = parseAgentReply("Title: Oak | 3 rooms | 290000 EUR\n<script>alert(1)</script>");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "paragraph");
  assert.equal(blocks[0].lines[1][0].text, "<script>alert(1)</script>", "kept as text for React to escape");
});

test("a streamed reply that has only the table header so far stays a paragraph", () => {
  assert.equal(parseAgentReply("| Fact | ALPHA |")[0].kind, "paragraph");
});
