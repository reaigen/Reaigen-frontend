import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const editor = read("app/components/draft-editor.tsx");
const select = read("app/lib/ui/select.tsx");
const globals = read("app/globals.css");
const button = read("app/lib/ui/button.tsx");
const gallery = read("app/components/draft-image-gallery.tsx");
const sidePanel = read("app/components/side-panel.tsx");
const bottomSheet = read("app/lib/ui/bottom-sheet.tsx");
const contentDocuments = read("app/components/content-documents.tsx");
const auditedSurfaces = [
  "app/components/app-shell.tsx",
  "app/components/draft-editor.tsx",
  "app/components/draft-media-manager.tsx",
  "app/components/draft-image-editor.tsx",
  "app/components/draft-sharing-dock.tsx",
  "app/components/draft-version-manager.tsx",
  "app/components/draft-tour-assets-panel.tsx",
  "app/components/side-panel.tsx",
  "app/components/sharing/content-scope-selector.tsx",
  "app/components/sharing/privacy-level-selector.tsx",
  "app/components/sharing/share-preview.tsx",
  "app/components/shared-draft-view.tsx",
  "app/components/status-pill.tsx",
  "app/draft/[id]/page.tsx",
  "app/shared/[token]/page.tsx",
].map(read).join("\n");

test("value and unit editing uses two distinct controls", () => {
  assert.match(editor, /flex min-w-0 items-stretch[^\n]*unitControl && "gap-2"/);
  assert.match(editor, /editor-control-capsule pen-touch-target[^\n]*rounded-full border/);
  assert.match(editor, /<\/div>\s*\{unitControl\}\s*<\/div>/);
  assert.doesNotMatch(editor, /hasTrailingControl/);
  assert.doesNotMatch(editor, /!rounded-none !border-0/);
  assert.doesNotMatch(editor, /pr-\[(?:5|8)rem\]/);
});

test("the clear action stays inside the value field without another edge", () => {
  assert.match(editor, /absolute inset-y-0 right-1 flex items-center/);
  assert.match(editor, /pen-touch-target flex h-9 w-9[^\n]*rounded-full/);
  assert.doesNotMatch(editor, /border-l border-border\/60/);
});

test("select menus can grow beyond the trigger row", () => {
  assert.match(select, /min-h-\[var\(--radix-select-trigger-height\)\]/);
  assert.doesNotMatch(select, /position === "popper" && "h-\[var\(--radix-select-trigger-height\)\]/);
});

test("editor surfaces use a flat material without layered gloss", () => {
  assert.match(globals, /\.editor-control-capsule \{[\s\S]*?background: hsl\(var\(--card\)\);[\s\S]*?box-shadow: none;/);
  assert.match(globals, /\.editor-glass-control \{[\s\S]*?background: hsl\(var\(--card\)\);[\s\S]*?box-shadow: none;/);
  assert.doesNotMatch(auditedSurfaces, /glossy-(?:primary-|destructive-)?capsule|glass-chip/);
  assert.doesNotMatch(sidePanel, /bg-background\/82|bg-card\/85/);
});

test("external dialogs share the same solid edge geometry", () => {
  for (const source of [bottomSheet, contentDocuments]) {
    assert.match(source, /rounded-t-\[28px\]/);
    assert.match(source, /bg-card/);
    assert.match(source, /sm:rounded-\[var\(--floating-panel-radius/);
  }
});

test("shared buttons keep stable role colours", () => {
  assert.doesNotMatch(button, /glossy-(?:primary-|destructive-)?capsule/);
  assert.doesNotMatch(button, /hover:brightness|transition-all/);
  assert.match(editor, /variant="default"[\s\S]{0,220}disabled=\{!dirty/);
  assert.doesNotMatch(editor, /variant=\{dirty[\s\S]{0,100}"ghost"/);
});

test("gallery controls do not invert or scale on hover", () => {
  assert.match(gallery, /media-overlay-control/);
  assert.match(globals, /\.media-overlay-control:hover \{[\s\S]*?background: rgb\(245 245 245\);/);
  assert.doesNotMatch(gallery, /hover:bg-black hover:text-white/);
  assert.doesNotMatch(gallery, /hover:bg-foreground hover:text-background/);
  assert.doesNotMatch(gallery, /hover:scale-105/);
  assert.doesNotMatch(gallery, /floating-capsule|glass-chip|backdrop-blur/);
});
