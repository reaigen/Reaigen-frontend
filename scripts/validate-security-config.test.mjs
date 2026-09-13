import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const nextConfig = readFileSync(
  new URL("../next.config.ts", import.meta.url),
  "utf8",
);
const mapsTest = readFileSync(
  new URL("../app/lib/google-maps-client.test.mjs", import.meta.url),
  "utf8",
);

test("reviewed framework and image-processing security releases stay pinned", () => {
  assert.equal(packageJson.dependencies.next, "16.3.5");
  assert.equal(packageJson.devDependencies["eslint-config-next"], "16.3.5");
  assert.equal(packageJson.overrides.next.sharp, "0.35.4");
  assert.equal(packageJson.overrides.next.postcss, "8.5.28");
});

test("the Next image optimizer remains disabled at the application boundary", () => {
  assert.match(nextConfig, /images:\s*\{\s*unoptimized:\s*true\s*\}/);
});

test("Google Maps tests do not contain secret-shaped API key fixtures", () => {
  assert.doesNotMatch(mapsTest, /AIza[0-9A-Za-z_-]{35}/);
});
