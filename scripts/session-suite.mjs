/**
 * End-to-end session checks against a running app.
 *
 * Not part of `npm run check`: it needs a live server, a browser and a real
 * user, none of which the unit suite has. Run it by hand after touching a proxy
 * or the 401 policy — every check here corresponds to a way people were being
 * signed out of an app they were still signed in to.
 *
 *   BASE=http://localhost:3056 UPLOAD=<id> CHROMIUM=<path to chromium> \
 *     node scripts/session-suite.mjs
 *
 * Expects a user matching USER below, and UPLOAD to be one of their photos.
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3056";
const USER = { username: "auth-probe", password: "UxCheck123!Temp" };
const HOST = new URL(BASE).hostname;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox"] });
let failures = 0;

function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (got ${actual}, want ${expected})`);
}

async function freshContext() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const login = await page.request.post(`${BASE}/api/auth/login`, { data: USER });
  return { context, page, loginStatus: login.status() };
}

async function cookieValue(context, name) {
  const cookies = await context.cookies(BASE);
  return cookies.find((c) => c.name === name)?.value ?? null;
}

// 1. Authenticated endpoints under /api/auth/ — the ones that used to 401.
{
  const { context, page, loginStatus } = await freshContext();
  check("login", loginStatus, 200);
  for (const path of ["/api/auth/totp/status/", "/api/auth/linked-accounts/"]) {
    const res = await page.request.get(`${BASE}${path}`);
    check(`authenticated ${path}`, res.status(), 200);
  }
  await context.close();
}

// 2. An unusable access token must be renewed silently, not treated as logout.
{
  const { context, page } = await freshContext();
  const refreshBefore = await cookieValue(context, "reaigen_refresh");
  await context.addCookies([{
    name: "reaigen_access", value: "not.a.valid.token", domain: HOST, path: "/", httpOnly: true,
  }]);
  const res = await page.request.get(`${BASE}/api/auth/totp/status/`);
  check("stale access token is refreshed, not rejected", res.status(), 200);
  const refreshAfter = await cookieValue(context, "reaigen_refresh");
  check("refresh token was rotated in the cookie", refreshAfter !== refreshBefore, true);
  // The rotated token must itself still work — this is the bug that logged
  // everyone out one access lifetime after their first silent refresh.
  await context.addCookies([{
    name: "reaigen_access", value: "not.a.valid.token", domain: HOST, path: "/", httpOnly: true,
  }]);
  const again = await page.request.get(`${BASE}/api/reaigen/users/me/`);
  check("the rotated refresh token still works next time", again.status(), 200);
  await context.close();
}

// 3. Several requests hitting a dead access token at once must not race each
//    other into a blacklisted refresh token.
{
  const { context, page } = await freshContext();
  await context.addCookies([{
    name: "reaigen_access", value: "not.a.valid.token", domain: HOST, path: "/", httpOnly: true,
  }]);
  const paths = [
    "/api/auth/totp/status/", "/api/auth/linked-accounts/", "/api/reaigen/users/me/",
    "/api/auth/totp/status/", "/api/reaigen/users/me/", "/api/auth/linked-accounts/",
  ];
  const statuses = await Promise.all(paths.map((p) => page.request.get(`${BASE}${p}`).then((r) => r.status())));
  console.log("   parallel statuses:", statuses.join(","));
  check("six concurrent requests all survive one refresh", statuses.every((s) => s === 200), true);
  await context.close();
}

// 4. Login must still work when the browser is carrying a dead session.
{
  const { context, page } = await freshContext();
  await context.addCookies([{
    name: "reaigen_access", value: "not.a.valid.token", domain: HOST, path: "/", httpOnly: true,
  }, {
    name: "reaigen_refresh", value: "not.a.valid.token", domain: HOST, path: "/", httpOnly: true,
  }]);
  const relogin = await page.request.post(`${BASE}/api/auth/login`, { data: USER });
  check("login with stale cookies present", relogin.status(), 200);
  const me = await page.request.get(`${BASE}/api/reaigen/users/me/`);
  check("session usable after re-login", me.status(), 200);
  await context.close();
}

// 5. A genuinely dead session still ends the session — no silent limbo.
{
  const { context, page } = await freshContext();
  await context.addCookies([{
    name: "reaigen_access", value: "not.a.valid.token", domain: HOST, path: "/", httpOnly: true,
  }, {
    name: "reaigen_refresh", value: "not.a.valid.token", domain: HOST, path: "/", httpOnly: true,
  }]);
  const res = await page.request.get(`${BASE}/api/reaigen/users/me/`);
  check("unrecoverable session still returns 401", res.status(), 401);
  await context.close();
}

// 6. Logout still clears the session.
{
  const { context, page } = await freshContext();
  const out = await page.request.post(`${BASE}/api/auth/logout`, { data: {} });
  check("logout", out.status(), 200);
  const after = await page.request.get(`${BASE}/api/reaigen/users/me/`);
  check("no session after logout", after.status(), 401);
  await context.close();
}

// 7. The expiry marker is a verdict, not a synonym for 401.
{
  const { context, page } = await freshContext();
  const ok = await page.request.get(`${BASE}/api/auth/totp/status/`);
  check("healthy request carries no expiry marker", ok.headers()["x-reaigen-session"] ?? "none", "none");

  const missing = await page.request.get(`${BASE}/api/reaigen/drafts/999999999/`);
  check("a refused resource carries no expiry marker", missing.headers()["x-reaigen-session"] ?? "none", "none");
  check("a refused resource is not reported as 401", missing.status() === 401, false);

  await context.addCookies([
    { name: "reaigen_access", value: "not.a.valid.token", domain: HOST, path: "/", httpOnly: true },
    { name: "reaigen_refresh", value: "not.a.valid.token", domain: HOST, path: "/", httpOnly: true },
  ]);
  const dead = await page.request.get(`${BASE}/api/reaigen/users/me/`);
  check("an unrecoverable session is marked expired", dead.headers()["x-reaigen-session"] ?? "none", "expired");
  await context.close();
}

// 8. The media proxy must renew too, not silently lose the editor's working copy.
{
  const { context, page } = await freshContext();
  await context.addCookies([{
    name: "reaigen_access", value: "not.a.valid.token", domain: HOST, path: "/", httpOnly: true,
  }]);
  const res = await page.request.get(`${BASE}/api/media-proxy?upload=${process.env.UPLOAD}&max=1400`);
  check("media proxy renews a stale access token", res.status(), 200);
  await context.close();
}

// 9. The whole chain, in a real page: a stale access token must not bounce the
//    user out of Settings.
{
  const { context, page } = await freshContext();
  await context.addCookies([{
    name: "reaigen_access", value: "not.a.valid.token", domain: HOST, path: "/", httpOnly: true,
  }]);
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);
  check("still on /settings after a stale access token", new URL(page.url()).pathname, "/settings");
  await context.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
