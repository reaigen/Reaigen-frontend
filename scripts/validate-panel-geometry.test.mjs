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
const tourPage = read("app/tour/[id]/page.tsx");
const tourLoading = read("app/components/tour-workspace-loading.tsx");
const detailLayoutStore = read("app/lib/detail-layout.ts");
const detailLayoutToggle = read("app/components/detail-layout-toggle.tsx");
const draftSkeletonFixture = read("app/dev-fixtures/draft-skeleton/page.tsx");
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

test("value and unit editing uses one capsule and one internal divider", () => {
  assert.match(editor, /editor-control-capsule h-11 overflow-hidden rounded-full border/);
  assert.match(editor, /!h-full !min-h-full[^\n]*rounded-none border-0/);
  assert.match(editor, /flex shrink-0 border-l border-border\/65/);
  assert.match(editor, /unitControl && "!h-full rounded-none border-0 !bg-transparent/);
  assert.doesNotMatch(editor, /unitControl && "gap-2"/);
  assert.doesNotMatch(editor, /editor-control-capsule pen-touch-target/);
});

test("the clear action stays inside the value field without another edge", () => {
  assert.match(editor, /absolute inset-y-0 right-1 flex items-center/);
  assert.match(editor, /pen-touch-target flex h-9 w-9[^\n]*rounded-full/);
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

test("tour navigation stays white while draft navigation keeps its light-surface colour", () => {
  assert.match(tourPage, /viewer-top-control-icon[^\n]*!text-white[\s\S]{0,220}<ArrowLeftIcon size=\{18\} color="#fff"/);
  // Route loading is a white surface now: dark chrome only appears once the
  // viewer has a frame, so its back control uses the app's light styling.
  assert.match(tourLoading, /bg-background text-foreground/);
  assert.match(tourLoading, /viewer-top-control-icon[^\n]*text-foreground[\s\S]{0,400}<ArrowLeftIcon size=\{18\} \/>/);
  assert.doesNotMatch(tourLoading, /bg-\[#121214\]|text-white|tone="dark"/);
  assert.match(draftPage, /floating-capsule[^\n]*text-foreground\/65[\s\S]{0,500}<ArrowLeftIcon size=\{17\} \/>/);
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
  // Facts are one spec strip whose columns come from CSS variables; the
  // silhouette sets the same variables so it lays out exactly like the page.
  assert.match(draftPage, /className="draft-facts-grid[^"]*"[\s\S]{0,240}"--facts-cols"/);
  assert.match(draftSkeleton, /className="draft-facts-grid[^"]*"[\s\S]{0,240}"--facts-cols"/);
  assert.match(globals, /\.draft-facts-grid \{[\s\S]*?grid-template-columns: repeat\(var\(--facts-cols-compact, 3\)/);
  assert.match(draftSkeleton, /data-testid="draft-detail-skeleton-shell"/);
  assert.match(globals, /\.draft-skeleton-shape \{[\s\S]*?animation: shimmer 1\.65s/);
});

test("draft silhouette follows the saved viewing mode and the workspace width", () => {
  // One store feeds the page, both loading states and the silhouette, so the
  // skeleton opens at the width and column count the listing settles into.
  assert.match(detailLayoutStore, /useSyncExternalStore/);
  assert.match(detailLayoutStore, /"reaigen:detailLayout"/);
  assert.match(draftPage, /const detailLayout = useDetailLayout\(\)/);
  assert.doesNotMatch(draftPage, /localStorage\.(getItem|setItem)\("reaigen:detailLayout"/);
  assert.match(draftSkeleton, /const detailLayout = useDetailLayout\(\)/);
  // The mode is an attribute on the root and one CSS rule, never a class
  // choice a second component could get wrong.
  assert.match(draftPage, /data-detail-layout=\{detailLayout\}/);
  assert.match(draftSkeleton, /data-detail-layout=\{detailLayout\}/);
  assert.doesNotMatch(draftPage + draftSkeleton, /max-w-\[920px\]/);
  assert.match(globals, /\.draft-detail-page\[data-detail-layout="1"\] \{\s*max-width: 920px;/);
  assert.match(globals, /\.draft-detail-page\[data-detail-layout="1"\] \.draft-support-grid \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(globals, /\.draft-detail-page\[data-detail-layout="1"\] \.draft-support-grid section \{\s*grid-column: auto;/);
  // Server HTML cannot know the saved mode: the silhouette stamps it before
  // paint, so a cold load never opens wide and slides down.
  assert.match(detailLayoutStore, /DETAIL_LAYOUT_PRE_HYDRATION_HTML/);
  assert.match(detailLayoutStore, /document\.currentScript\.parentElement\.setAttribute\("data-detail-layout","1"\)/);
  assert.match(draftSkeleton, /suppressHydrationWarning[\s\S]{0,400}<script dangerouslySetInnerHTML=\{DETAIL_LAYOUT_PRE_HYDRATION_HTML\} \/>/);
  // The script exists only in server HTML and its hydration pass. A client-
  // created <script> never runs and React logs "Encountered a script tag
  // while rendering React component" on every in-app navigation.
  assert.match(detailLayoutStore, /export function useEmitsPreHydrationScript\(\): boolean \{\s*return useSyncExternalStore\(subscribeNever, \(\) => false, \(\) => true\);/);
  assert.match(draftSkeleton, /\{emitPreHydrationScript \? <script dangerouslySetInnerHTML=\{DETAIL_LAYOUT_PRE_HYDRATION_HTML\} \/> : null\}/);
  assert.doesNotMatch(draftSkeleton, /^\s*<script dangerouslySetInnerHTML/m);
  // The workspace container query collapses the listing beside a docked Agent
  // by these class names; the silhouette must carry them too.
  assert.match(draftSkeleton, /draft-support-grid[^"]*lg:grid-cols-2/);
  assert.match(draftSkeleton, /draft-facts-grid/);
  assert.match(draftSkeletonFixture, /app-workspace/);
  // The mode toggle is live while loading, so neither loading state pops it in.
  assert.match(detailLayoutToggle, /data-testid="detail-layout-toggle"/);
  assert.match(draftLoading, /headerTitleLoading\s+headerAction=\{<DetailLayoutToggle lang=\{lang\} \/>\}/);
  assert.match(draftPage, /headerTitleLoading\s+headerAction=\{<DetailLayoutToggle lang=\{lang\} \/>\}/);
  assert.match(draftPage, /headerAction=\{<DetailLayoutToggle lang=\{lang\} \/>\}\s+onReaiDraftUpdated/);
});

// Bench 07 (2026-09-26): one editing contract across the panels.
const confirmDialog = read("app/lib/ui/confirm-dialog.tsx");
const welcomeDialog = read("app/components/subscription-welcome-card.tsx");
const mediaManager = read("app/components/draft-media-manager.tsx");
const imageEditor = read("app/components/draft-image-editor.tsx");
const fieldRegistry = read("app/lib/property-field-registry.ts");
const editorLocales = ["en", "sk", "cs", "de"].map((code) => read(`app/lib/locales/${code}.ts`));

test("every app dialog is modal in what it announces and hands focus back on close", () => {
  // B07-F05: Radix focused a Dialog.Trigger none of them renders — <body>.
  for (const [name, source] of [["side panel", sidePanel], ["bottom sheet", bottomSheet], ["confirm", confirmDialog], ["welcome", welcomeDialog]]) {
    assert.match(source, /aria-modal="true"/, name);
    assert.match(source, /useDialogFocusReturn\(\)/, name);
    assert.match(source, /focusReturn\.remember\(\)/, name);
    assert.match(source, /focusReturn\.restore/, name);
  }
});

test("a blank title says why Save is off, tied to the field", () => {
  // B07-F06: the disabled Save also meant "no changes".
  assert.match(editor, /errorMessage=\{titleTouched && !values\.title\.trim\(\) \? t\("draft\.editor\.titleRequired", lang\) : null\}/);
  assert.match(editor, /aria-describedby=\{errorMessage \? `\$\{id\}-error` : undefined\}/);
  assert.match(editor, /<p id=\{`\$\{id\}-error`\} aria-live="polite"/);
  assert.match(editor, /onBlur=\{\(\) => setTitleTouched\(true\)\}/);
  for (const locale of editorLocales) assert.match(locale, /"draft\.editor\.titleRequired":/);
});

test("the description toolbar names its shortcuts in the platform's notation", () => {
  // B07-F07: "⌘B · ⌘I · ⌘↵" on Windows.
  assert.doesNotMatch(editor, /⌘B · ⌘I · ⌘↵/);
  assert.match(editor, /shortcutLabel\(key, applePlatform\)/);
  assert.match(editor, /\(event\.metaKey \|\| event\.ctrlKey\) && event\.key\.toLowerCase\(\) === "b"/, "Ctrl works as ⌘ does");
});

test("total rooms is a Basic field beside bedrooms, one fact in one place", () => {
  // UI06: Slovak and Czech creators count "izby".
  assert.match(fieldRegistry, /\{ key: "rooms", labelKey: "draft\.rooms", kind: "number", min: 0, max: 30, visibleFor: residential, core: true \}/);
  assert.match(editor, /<NumericStepper id="draft-rooms" label=\{t\("draft\.rooms", lang\)\} value=\{stringValue\(specs\.layout\?\.rooms\)\} onChange=\{\(value\) => setSpecValue\("layout", "rooms", value\)\}/);
  assert.match(editor, /numberMeetsConstraints\(stringValue\(specs\.layout\?\.rooms\), plainNumberContext, \{ integer: true, min: 0, max: 30, step: 1 \}\)/);
  assert.match(editor, /rooms: roomsNumber\(currentLayout\.rooms\)/, "saved as a whole number, cleared when emptied");
});

test("photo edits are kept or given up deliberately, like the text editors'", () => {
  // B07-F02: Back after a rotation lost it without a word.
  assert.match(imageEditor, /onDirtyChange\?\.\(hasChanges\)/);
  assert.match(imageEditor, /React\.useImperativeHandle\(controlRef/);
  assert.match(mediaManager, /onBack=\{view === "gallery" \? undefined : \(\) => \(view === "editor" \? leaveImageEditor\("back"\) : switchView\("gallery"\)\)\}/);
  assert.match(mediaManager, /else leaveImageEditor\("close"\)/, "Escape and Close ask too");
  assert.match(mediaManager, /footer=\{pendingEditorExit \?/);
  assert.match(mediaManager, /t\("draft\.editor\.discardPrompt", lang\)/);
  assert.match(mediaManager, /imageEditorRef\.current\?\.save\(\)/, "Save version from the question");
  assert.match(mediaManager, /onClick=\{\(\) => setPendingEditorExit\(null\)\}/, "Cancel keeps editing and saves nothing");
});
