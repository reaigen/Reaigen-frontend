import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const shell = fs.readFileSync(path.join(root, "app/components/app-shell.tsx"), "utf8");
const createPage = fs.readFileSync(path.join(root, "app/create/page.tsx"), "utf8");
const createAction = fs.readFileSync(path.join(root, "app/components/web-create-action.tsx"), "utf8");
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

test("the web collection explicitly requests the same complete draft history as mobile", () => {
  assert.match(
    apiClient,
    /\/api\/reaigen\/drafts\/\?page=\$\{page\}&page_size=\$\{pageSize\}&include_transferred=true/,
  );
});
