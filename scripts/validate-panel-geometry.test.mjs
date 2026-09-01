import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const editor = read("app/components/draft-editor.tsx");
const select = read("app/lib/ui/select.tsx");
const privacy = read("app/components/sharing/privacy-level-selector.tsx");
const sidePanel = read("app/components/side-panel.tsx");
const mediaManager = read("app/components/draft-media-manager.tsx");
const contentDocuments = read("app/components/content-documents.tsx");

test("value and unit editing uses one rounded-rectangle edge", () => {
  assert.match(editor, /const fieldClass = "[^"]*rounded-xl/);
  assert.doesNotMatch(editor, /const fieldClass = "[^"]*rounded-full/);
  assert.match(editor, /hasTrailingControl[\s\S]*overflow-hidden rounded-xl border/);
  assert.match(editor, /!h-full !min-h-0[^"]*!rounded-none !border-0/);
  assert.match(editor, /!h-full !w-0 min-w-0 flex-1 !rounded-none !border-0/);
  assert.doesNotMatch(editor, /pr-\[(?:5|8)rem\]/);
});

test("field-shaped controls stay distinct from action capsules", () => {
  assert.match(editor, /flex h-11 items-center overflow-hidden rounded-xl border/);
  assert.match(privacy, /editor-control-capsule h-11 rounded-xl/);
  assert.doesNotMatch(privacy, /editor-control-capsule h-11 rounded-full/);
});

test("select menus can grow beyond the trigger row", () => {
  assert.match(select, /min-h-\[var\(--radix-select-trigger-height\)\]/);
  assert.doesNotMatch(select, /position === "popper" && "h-\[var\(--radix-select-trigger-height\)\]/);
});

test("side, gallery, and external panels use shared edge geometry", () => {
  assert.match(sidePanel, /border-t border-border\/55/);
  assert.match(mediaManager, /media-manager-selection[^"]*rounded-\[1\.25rem\]/);
  assert.match(contentDocuments, /rounded-t-\[28px\][^"]*shadow-elevated[^"]*sm:rounded-\[var\(--floating-panel-radius\)\]/);
});
