import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const shell = fs.readFileSync(path.join(root, "app/components/app-shell.tsx"), "utf8");
const createPage = fs.readFileSync(path.join(root, "app/create/page.tsx"), "utf8");
const createAction = fs.readFileSync(path.join(root, "app/components/web-create-action.tsx"), "utf8");
const accessHook = fs.readFileSync(path.join(root, "app/components/hooks/use-web-authoring-access.ts"), "utf8");
const tourEditor = fs.readFileSync(path.join(root, "app/create/tour/[id]/page.tsx"), "utf8");
const apiClient = fs.readFileSync(path.join(root, "app/lib/api/client.ts"), "utf8");

test("every browser authoring entry fails closed behind the server verdict", () => {
  assert.match(shell, /useWebAuthoringAccess\(true\)/);
  assert.match(shell, /\{webAuthoringAllowed \? \(\s*<button[\s\S]{0,240}data-testid="web-create-menu-trigger"/);
  assert.match(shell, /!immersive && webAuthoringAllowed && createOpen/);
  assert.match(shell, /if \(!webAuthoringAllowed\) setCreateOpen\(false\)/);
  assert.match(createPage, /useWebAuthoringAccess\(isAuthenticated\)/);
  assert.match(createPage, /if \(!allowed\)/);
  assert.match(createAction, /if \(!allowed\)/);
});

test("the shell never infers authoring permission from the user payload", () => {
  assert.doesNotMatch(shell, /user\.(?:role|is_staff|is_superuser|permissions|features)/);
});

test("advanced splat controls fail closed behind Django's explicit capability", () => {
  assert.match(apiClient, /capabilities:[\s\S]{0,260}advanced_splat_editor: boolean/);
  assert.match(accessHook, /getWebCreationAccess\(\)/);
  assert.match(
    accessHook,
    /access\.capabilities\?\.advanced_splat_editor === true/,
  );
  assert.doesNotMatch(
    accessHook,
    /(?:role|is_staff|is_superuser|tier|extrauser)/,
  );
  assert.match(tourEditor, /allowed,\s*advancedSplatEditor,\s*loading: accessLoading/);
  assert.match(
    tourEditor,
    /advancedSplatEditor && selectedRenderable \? \(\s*<nav\s*data-testid="advanced-splat-controls"/,
  );
  assert.match(
    tourEditor,
    /advancedSplatEditor && selected[\s\S]{0,180}data-testid="tour-editor-inspector-panel"/,
  );
  assert.match(
    tourEditor,
    /advancedSplatEditor && pruneEditorOpen && selected/,
  );
  assert.match(
    tourEditor,
    /onSpatialTransformStart=\{advancedSplatEditor \? pushTransformHistory : undefined\}/,
  );
  assert.match(
    tourEditor,
    /splatSelectionTool=\{advancedSplatEditor && pruneEditorOpen/,
  );
  const advancedRail = tourEditor.slice(
    tourEditor.indexOf('data-testid="advanced-splat-controls"'),
    tourEditor.indexOf("{selectedRenderable ? (", tourEditor.indexOf('data-testid="advanced-splat-controls"')),
  );
  assert.match(advancedRail, /undoTransform/);
  assert.match(advancedRail, /redoTransform/);
  assert.match(advancedRail, /tour-editor-prune-open/);
});

test("the web collection explicitly requests the same complete draft history as mobile", () => {
  assert.match(
    apiClient,
    /\/api\/reaigen\/drafts\/\?page=\$\{page\}&page_size=\$\{pageSize\}&include_transferred=true/,
  );
});
