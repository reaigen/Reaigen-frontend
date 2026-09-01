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
const draftSkeleton = read("app/components/draft-detail-skeleton.tsx");
const draftLoading = read("app/draft/[id]/loading.tsx");
const draftPage = read("app/draft/[id]/page.tsx");
const dashboard = read("app/dashboard/page.tsx");
const tours = read("app/tours/page.tsx");
const collectionSkeleton = read("app/components/collection-card-skeleton.tsx");
const tourPage = read("app/tour/[id]/page.tsx");
const tourLoading = read("app/tour/[id]/loading.tsx");
const tourWorkspaceLoading = read("app/components/tour-workspace-loading.tsx");
const loadingMark = read("app/components/reaigen-loading-mark.tsx");
const splatViewer = read("app/components/splat-viewer.tsx");
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

test("value and unit editing shares one aligned edge", () => {
  assert.match(editor, /unitControl && "editor-composite-control h-11 overflow-hidden rounded-xl border/);
  assert.match(editor, /unitControl && "!h-full rounded-none border-0 !bg-transparent focus-visible:ring-0"/);
  assert.match(editor, /flex shrink-0 border-l border-border\/75/);
  assert.match(editor, /!h-full !min-h-full shrink-0 rounded-none border-0 !bg-transparent/);
  assert.doesNotMatch(editor, /unitControl && "gap-2"/);
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
  assert.match(globals, /\.editor-control-capsule \{[\s\S]*?background: hsl\(var\(--surface-subtle\) \/ 0\.62\);[\s\S]*?box-shadow: none;/);
  assert.match(globals, /\.editor-composite-control \{[\s\S]*?box-shadow: none;/);
  assert.match(globals, /\.editor-glass-control \{[\s\S]*?background: hsl\(var\(--card\)\);[\s\S]*?box-shadow: none;/);
  assert.doesNotMatch(auditedSurfaces, /glossy-(?:primary-|destructive-)?capsule|glass-chip/);
  assert.doesNotMatch(sidePanel, /bg-background\/82|bg-card\/85/);
});

test("infinite collections continue with card silhouettes instead of a loading button", () => {
  assert.match(collectionSkeleton, /data-testid="collection-card-skeletons"/);
  assert.match(collectionSkeleton, /aspect-\[16\/10\]/);
  assert.match(collectionSkeleton, /draft-skeleton-shape/);
  for (const source of [dashboard, tours]) {
    assert.match(source, /loadingMore \? Array\.from/);
    assert.match(source, /hasMore && !loadingMore/);
    assert.match(source, /<CollectionCardSkeleton/);
  }
});

test("tour loading remains one immersive workspace through scene readiness", () => {
  assert.match(tourLoading, /<TourWorkspaceLoading/);
  assert.match(tourWorkspaceLoading, /data-testid="tour-workspace-loading"/);
  assert.match(tourWorkspaceLoading, /bg-\[#121214\]/);
  assert.match(tourWorkspaceLoading, /ArrowLeftIcon size=\{18\} color="#fff"/);
  assert.match(tourPage, /return <TourWorkspaceLoading lang=\{lang\}/);
  assert.match(tourPage, /loadingTone="dark"/);
  assert.doesNotMatch(tourPage, /spatialAccessLoading/);
  assert.match(splatViewer, /tone=\{loadingTone\}/);
  assert.match(loadingMark, /tone === "dark" \? "text-white"/);
});

test("detail facts align to the same two-column rhythm without blur", () => {
  assert.match(draftPage, /draft-detail-grid grid grid-cols-1 gap-2\.5 sm:grid-cols-2/);
  assert.doesNotMatch(draftPage, /draft-detail-grid grid grid-cols-1 gap-2\.5">[\s\S]{0,1600}backdrop-blur-xl/);
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

test("draft route and data loading render geometry-matched silhouettes", () => {
  assert.match(draftLoading, /<DraftDetailSkeleton[^>]*standalone/);
  assert.match(draftLoading, /<DraftDetailSkeleton label=\{t\("common\.loading", lang\)\}/);
  assert.doesNotMatch(draftLoading, /CollectionLoading|PageLoading/);

  assert.match(draftPage, /if \(isLoading \|\| !user\)[\s\S]{0,180}<DraftDetailSkeleton[^>]*standalone/);
  assert.match(draftPage, /if \(!draft && !error\)[\s\S]{0,500}<DraftDetailSkeleton label=\{t\("common\.loading", lang\)\}/);
  assert.match(draftSkeleton, /data-testid="draft-detail-skeleton"/);
  assert.match(draftSkeleton, /draft-mobile-workspace/);
  assert.match(draftSkeleton, /detail-hero-gallery aspect-\[4\/3\]/);
  assert.match(draftSkeleton, /sm:grid sm:grid-cols-3/);
  assert.match(draftSkeleton, /data-testid="draft-detail-skeleton-shell"/);
  assert.match(globals, /\.draft-skeleton-shape \{[\s\S]*?animation: shimmer 1\.65s/);
});
