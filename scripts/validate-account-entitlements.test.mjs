import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const settings = fs.readFileSync(
  path.join(root, "app/components/settings-form.tsx"),
  "utf8",
);
const api = fs.readFileSync(path.join(root, "app/lib/api/client.ts"), "utf8");

test("settings refreshes billing and permissions from the backend", () => {
  assert.match(settings, /Promise\.allSettled\(\[getBilling\(\), getUserCapabilities\(\)\]\)/);
  assert.match(
    api,
    /getUserCapabilities[\s\S]{0,220}freshRequest\("\/api\/reaigen\/users\/permissions\/"\)/,
  );
  assert.match(
    api,
    /getBilling[\s\S]{0,140}freshRequest\("\/api\/reaigen\/billing\/me\/"\)/,
  );
});

test("settings never treats the deprecated tier post mirror as permission", () => {
  const billingTab = settings.slice(
    settings.indexOf("function BillingTab"),
    settings.indexOf("/* ── Security Tab"),
  );
  assert.doesNotMatch(billingTab, /tier\?\.max_posts/);
  assert.match(billingTab, /data-testid="reailist-access"/);
  assert.match(billingTab, /productAllowed=\{reailistAllowed\}/);
});

test("credits and plan functions remain visible while live data loads", () => {
  assert.match(settings, /data-testid="compute-credits"/);
  assert.match(settings, /data-testid="plan-functions"/);
  assert.doesNotMatch(settings, /\{credits && \(/);
});

