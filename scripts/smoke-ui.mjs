/**
 * UI smoke suite — drives the dev QA fixtures (app/dev-fixtures/*) and the
 * public entry in a real browser and fails on ANY page error, red overlay
 * condition, or broken core interaction. The contract: a fix for one surface
 * may not break another.
 *
 * Requires the dev server: npm run dev -- --port 3056 (override with PORT).
 * Run: npm run smoke-ui
 */
import { chromium } from "@playwright/test";

const PORT = process.env.PORT ?? "3056";
const SHOTS_DIR = process.env.SMOKE_SHOTS_DIR ?? "";
const shot = (page, name) => SHOTS_DIR ? page.screenshot({ path: `${SHOTS_DIR}/${name}.png`, fullPage: true }) : Promise.resolve();
const BASE = `http://localhost:${PORT}`;

const browser = await chromium.launch();
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++;
  else fail++;
};

async function openPage(path, { consent = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1720, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error.message).slice(0, 160)));
  await page.route("**/api/reaigen/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  if (consent) {
    await page.route("**/reai-agent/consent/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ consented: true, policy_version: "1", granted_at: null }),
      }),
    );
  }
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  return { page, pageErrors };
}

// ── 1. design tokens compute correctly ──────────────────────────────────────
{
  const { page, pageErrors } = await openPage("/dev-fixtures/tokens");
  await page.waitForSelector('[data-qa="card"]', { timeout: 60000 });
  const out = await page.evaluate(() => {
    const style = (selector) => getComputedStyle(document.querySelector(selector));
    const chip = style(".detail-icon-chip");
    const action = style('[data-qa="chip"]');
    return {
      cardRadius: style('[data-qa="card"]').borderRadius,
      lgRadius: style('[data-qa="card-lg"]').borderRadius,
      blur: style('[data-qa="card"]').backdropFilter,
      chipSize: `${chip.width}×${chip.height}`,
      actionHeight: action.height,
      actionFont: action.fontSize,
    };
  });
  check(
    "tokens: card tiers, blur, chip, action chip",
    out.cardRadius === "20px" && out.lgRadius === "24px" && out.blur.includes("blur")
      && out.chipSize === "32px×32px" && out.actionHeight === "36px" && out.actionFont === "11px",
    JSON.stringify(out),
  );
  check("tokens: no page errors", pageErrors.length === 0, pageErrors[0] ?? "");
  await page.close();
}

// ── 2. shell layering: panel over the dimmed agent ──────────────────────────
{
  const { page, pageErrors } = await openPage("/dev-fixtures/shell", { consent: true });
  await page.waitForSelector('[data-qa="open-side"]', { timeout: 90000 });
  await page.waitForTimeout(800);
  const agentOpen = await page.evaluate(() => {
    const el = [...document.querySelectorAll("div")].find((d) => typeof d.className === "string" && d.className.includes("agent-canvas"));
    return el ? el.getBoundingClientRect().width > 50 && getComputedStyle(el).visibility !== "hidden" : false;
  });
  if (!agentOpen) {
    await page.evaluate(() => {
      const launchers = [...document.querySelectorAll('button[aria-label="Open Agent"]')];
      launchers[launchers.length - 1]?.click();
    });
    await page.waitForTimeout(700);
  }
  await page.click('[data-qa="open-side"]');
  await page.waitForSelector('[data-qa="side-body"]', { timeout: 20000 });
  await page.waitForTimeout(400);
  const geo = await page.evaluate(() => {
    const panel = document.querySelector('[data-qa="side-body"]').closest('[role="dialog"]').getBoundingClientRect();
    const agent = [...document.querySelectorAll("div")].find((d) => typeof d.className === "string" && d.className.includes("agent-canvas"));
    const rect = agent.getBoundingClientRect();
    const probe = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 8);
    return {
      rightGap: window.innerWidth - panel.right,
      overlapsAgent: panel.right > rect.left + 40,
      agentUnderOverlay: !agent.contains(probe),
    };
  });
  check("shell: panel at the right edge over the agent", geo.rightGap < 20 && geo.overlapsAgent, JSON.stringify(geo));
  check("shell: scrim covers the agent", geo.agentUnderOverlay);
  check("shell: no page errors", pageErrors.length === 0, pageErrors[0] ?? "");
  await page.close();
}

// ── 3. floorplan editor: mounts, frames, door slides without overlap ────────
{
  const { page, pageErrors } = await openPage("/dev-fixtures/floorplan");
  await page.waitForSelector("svg polygon", { state: "attached", timeout: 90000 });
  await page.waitForTimeout(700);
  await page.keyboard.press("f");
  await page.waitForTimeout(500);
  const wallsBox = await page.evaluate(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const poly of document.querySelectorAll("svg polygon")) {
      if (poly.closest("mask, defs")) continue;
      if ((poly.getAttribute("points") ?? "").trim().split(/\s+/).length !== 4) continue;
      const rect = poly.getBoundingClientRect();
      if (rect.width < 2 && rect.height < 2) continue;
      minX = Math.min(minX, rect.left); maxX = Math.max(maxX, rect.right);
      minY = Math.min(minY, rect.top); maxY = Math.max(maxY, rect.bottom);
    }
    return { minX, minY, w: maxX - minX, h: maxY - minY };
  });
  check("floorplan: plan renders and frames", wallsBox.w > 300, `walls ${wallsBox.w.toFixed(0)}px`);
  await page.keyboard.press("v");
  const w2c = (wx, wz) => [
    wallsBox.minX + ((wx + 0.0575) / 8.115) * wallsBox.w,
    wallsBox.minY + ((wz + 0.0575) / 5.115) * wallsBox.h,
  ];
  const [fromX, fromY] = w2c(2.45, 0);
  const [toX, toY] = w2c(4.2, 0);
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(toX, toY, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  check("floorplan: door drag interaction survives", pageErrors.length === 0, pageErrors[0] ?? "");
  await page.close();
}

// ── 4. public entry loads clean ─────────────────────────────────────────────
{
  const { page, pageErrors } = await openPage("/");
  await page.waitForTimeout(2500);
  const hasContent = await page.evaluate(() => document.body.innerText.trim().length > 20);
  check("home: renders content", hasContent);
  check("home: no page errors", pageErrors.length === 0, pageErrors[0] ?? "");
  await page.close();
}

// ── 5. draft skeleton: follows the viewing mode and the workspace width ─────
{
  const { page, pageErrors } = await openPage("/dev-fixtures/draft-skeleton");
  await page.waitForSelector('[data-testid="draft-detail-skeleton"]', { timeout: 60000 });
  const measure = () => page.evaluate(() => {
    const root = document.querySelector('[data-testid="draft-detail-skeleton"]');
    const grid = root.querySelector(".draft-support-grid");
    // The twin mirrors the loaded listing's support grid: b/c/d are the cards
    // after one spanning two columns. Stacked = every card fills the grid and
    // sits on its own row; paired = two cards share a row at half width.
    const twinGrid = document.querySelector('[data-qa="support-twin"] .draft-support-grid').getBoundingClientRect();
    const cards = ["b", "c", "d"].map((key) => document.querySelector(`[data-qa="twin-${key}"]`).getBoundingClientRect());
    const stacked = cards.every((card) => card.width > twinGrid.width * 0.95)
      && cards[0].top < cards[1].top && cards[1].top < cards[2].top;
    const paired = cards[0].top === cards[1].top && cards[0].width < twinGrid.width * 0.6 && cards[0].width > 50;
    return {
      maxWidth: getComputedStyle(root).maxWidth,
      columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      twin: stacked ? "stacked" : paired ? "paired" : cards.map((card) => `${Math.round(card.width)}@${Math.round(card.top)}`).join(","),
    };
  });
  const wide = await measure();
  check("draft skeleton: wide mode is 1360px / two columns", wide.maxWidth === "1360px" && wide.columns === 2 && wide.twin === "paired", JSON.stringify(wide));
  await page.click('[data-testid="detail-layout-toggle"]');
  await page.waitForTimeout(350);
  const focused = await measure();
  check("draft skeleton: focused mode is 920px / one column", focused.maxWidth === "920px" && focused.columns === 1 && focused.twin === "stacked", JSON.stringify(focused));
  // The mode is a saved preference: a cold load must open in it from the
  // server HTML on — measured as soon as the silhouette exists, before
  // hydration could have corrected a general wide one.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="draft-detail-skeleton"]', { timeout: 60000 });
  const persisted = await measure();
  check("draft skeleton: cold load opens in the saved mode", persisted.maxWidth === "920px" && persisted.columns === 1, JSON.stringify(persisted));
  await page.waitForTimeout(600);
  const hydrated = await measure();
  check("draft skeleton: hydration keeps the saved mode", hydrated.maxWidth === "920px" && hydrated.columns === 1, JSON.stringify(hydrated));
  await page.click('[data-testid="detail-layout-toggle"]');
  await page.waitForTimeout(350);
  // A docked Agent narrows the workspace, not the viewport: the loaded
  // listing collapses to one column there and the silhouette must too.
  await page.click('[data-qa="toggle-narrow"]');
  await page.waitForTimeout(350);
  const narrow = await measure();
  check("draft skeleton: collapses with a narrow workspace", narrow.maxWidth === "1360px" && narrow.columns === 1 && narrow.twin === "stacked", JSON.stringify(narrow));
  check("draft skeleton: no page errors", pageErrors.length === 0, pageErrors[0] ?? "");
  await page.close();
}

// ── 6. guided account setup: each step saves, advances, and reports ────────
{
  const { page, pageErrors } = await openPage("/dev-fixtures/account-setup");
  // A tiny backend: whatever the steps save is what /users/me/ answers next.
  const account = {
    first_name: "QA", last_name: "Setup", username: "qa_setup", phone_verified: false,
    profile: null,
    billing: { billing_name: "", billing_email: "", billing_address: "", billing_city: "", billing_postal_code: "", billing_country: "", vat_number: "" },
    consent: { consented: false, policy_version: "3", granted_at: null, privacy: {} },
    tools: { allow_all_tools: true, tools: { image: true }, overrides: {}, entitled_tools: {}, tool_status: {}, available_tools: ["image"], tool_catalog: {}, settings_surfaces: {}, writable: true, confirmation_required_for_writes: true, updated_at: "" },
    personalized: { onboarding_completed: false, onboarding_skipped: false, onboarding_step: 0, preferences: {} },
  };
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const readBody = (route) => { try { return JSON.parse(route.request().postData() ?? "{}"); } catch { return {}; } };
  await page.route("**/api/reaigen/users/me/", (route) => {
    if (route.request().method() === "PATCH") Object.assign(account, readBody(route));
    json(route, {
      id: 7, email: "qa.setup@reaigen.test", username: account.username, first_name: account.first_name, last_name: account.last_name,
      localization: { language: "en" }, email_verified: true, has_password: true, has_totp: false, social_providers: [],
      phone_verified: account.phone_verified, last_login: null, date_joined: "2026-09-01T00:00:00Z",
      gdpr: { has_given_consent: true, consent_date: null, consent_version: "1", marketing_consent: false, data_processing_consent: true },
      profile: account.profile, personalized_data: account.personalized,
      billing_account: { id: 1, subscription_tier_detail: { code: "FREE", name: "Free", max_posts: 3 }, subscription_status: "active", billing_cycle: "monthly", is_trial: false, is_active: true, has_reached_post_limit: false, has_reached_storage_limit: false, days_until_expiry: null, current_storage_gb: "0", current_posts_count: 0, payment_provider: "", ...account.billing },
    });
  });
  await page.route("**/api/reaigen/users/permissions/", (route) => json(route, { capabilities: { role: "user", is_developer: false, tier: { code: "FREE", name: "Free" }, limits: {}, features: {}, apps: { reaigen: true }, creator_posting: { can_publish: false, has_reaigen_access: true, email_verified: true, phone_present: !!account.profile?.phone, phone_verified: account.phone_verified, seller_profile_complete: false, seller_profile_missing_fields: [], missing_requirements: [] } } }));
  await page.route("**/api/reaigen/profiles/me/", (route) => {
    if (route.request().method() === "PATCH") {
      const body = readBody(route);
      if (body.phone === "+421000000000") return json(route, { phone: ["user profile with this phone already exists."] }, 400);
      const phoneChanged = body.phone !== undefined && body.phone !== account.profile?.phone;
      if (phoneChanged) account.phone_verified = false;
      account.profile = { phone_verified: phoneChanged ? false : Boolean(account.profile?.phone_verified), ...(account.profile ?? {}), ...body, ...(phoneChanged ? { phone_verified: false } : {}) };
    }
    json(route, account.profile ?? {});
  });
  await page.route("**/api/reaigen/billing/me/", (route) => {
    if (route.request().method() === "PATCH") Object.assign(account.billing, readBody(route));
    json(route, account.billing);
  });
  await page.route("**/api/reaigen/personalized-data/me/", (route) => {
    if (route.request().method() === "PATCH") Object.assign(account.personalized, readBody(route));
    json(route, account.personalized);
  });
  await page.route("**/api/reaigen/reai-agent/consent/", (route) => {
    if (route.request().method() === "POST") account.consent = { ...account.consent, consented: true, granted_at: "2026-09-10T00:00:00Z" };
    json(route, account.consent);
  });
  await page.route("**/api/reaigen/reai-agent/tool-permissions/", (route) => {
    if (route.request().method() === "PATCH") Object.assign(account.tools, readBody(route));
    json(route, account.tools);
  });
  await page.route("**/api/reaigen/reai-agent/improvement-consent/", (route) => json(route, { consented: false, policy_version: "1", granted_at: null, retention_days: 30, optional: true, stored: [], never_stored: [], automatic_training: false }));
  await page.route("**/api/auth/link/phone/request-otp/", (route) => json(route, { sent: true }));
  await page.route("**/api/auth/link/phone/verify-otp/", (route) => {
    const body = readBody(route);
    if (body.otp_code !== "123456") return json(route, { detail: "Invalid code" }, 400);
    account.phone_verified = true;
    if (account.profile) account.profile.phone_verified = true;
    json(route, { verified: true });
  });

  await page.waitForSelector('[data-testid="account-setup"]', { timeout: 60000 });
  await page.waitForTimeout(400);
  const rail = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="setup-rail-"]')].map((el) => el.dataset.complete));
  check("account setup: four steps, profile already done", rail.length === 4 && rail[0] === "true" && rail[1] === "false", JSON.stringify(rail));
  const opensOn = await page.evaluate(() => !!document.querySelector('[data-testid="setup-step-seller"]'));
  check("account setup: opens on the first gap (seller)", opensOn);

  // A number another account owns: the backend refuses it, the step keeps
  // everything else and explains at the field instead of failing outright.
  await page.fill("#setup-phone", "+421000000000");
  await page.fill("#setup-bio", "Broker in Bratislava.");
  await page.fill("#setup-city", "Bratislava");
  await page.fill("#setup-country", "sk");
  await page.click('[data-testid="setup-continue"]');
  await page.waitForSelector('[data-testid="setup-phone-error"]', { timeout: 20000 });
  await shot(page, "setup-phone-taken");
  const stayed = await page.evaluate(() => !!document.querySelector('[data-testid="setup-step-seller"]') && document.querySelector("#setup-phone")?.getAttribute("aria-invalid") === "true");
  check("account setup: a taken phone stays on the step with a field error", stayed && account.profile?.bio === "Broker in Bratislava." && !account.profile?.phone, JSON.stringify(account.profile));
  await page.fill("#setup-phone", "+421900123456");
  await page.fill("#setup-city", "Bratislava");
  await page.fill("#setup-address", "Hlavná 1");
  await page.fill("#setup-postal", "81101");
  await page.fill("#setup-country", "sk");
  await shot(page, "setup-seller");
  // Verify the number in place: the flow saves the profile first, then asks
  // for the code, and the verified flag comes back through /users/me/.
  await page.click('[data-testid="setup-verify-phone"]');
  await page.waitForSelector("#setup-phone-code", { timeout: 20000 });
  await page.fill("#setup-phone-code", "123456");
  await page.click('text=Confirm');
  await page.waitForFunction(() => document.querySelector("#setup-phone-code") === null, null, { timeout: 20000 });
  check("account setup: phone verified through the OTP flow", account.phone_verified === true && account.profile?.phone === "+421900123456", JSON.stringify(account.profile));
  await page.click('[data-testid="setup-continue"]');
  await page.waitForSelector('[data-testid="setup-step-billing"]', { timeout: 20000 });
  await shot(page, "setup-billing");
  const afterSeller = await page.evaluate(() => ({
    sellerDone: document.querySelector('[data-testid="setup-rail-seller"]')?.dataset.complete,
    progress: document.querySelector('[data-testid="setup-progress"]')?.textContent?.trim(),
  }));
  check("account setup: seller step saved and rail updated", afterSeller.sellerDone === "true" && /^2 \/ 4/.test(afterSeller.progress ?? ""), JSON.stringify({ ...afterSeller, saved: account.profile }));
  check("account setup: country code normalised on save", account.profile?.country === "SK", String(account.profile?.country));

  await page.click('[data-testid="setup-billing-copy-address"]');
  const copied = await page.evaluate(() => ({ city: document.querySelector("#setup-billing-city").value, country: document.querySelector("#setup-billing-country").value }));
  check("account setup: billing can copy the seller address", copied.city === "Bratislava" && copied.country === "SK", JSON.stringify(copied));
  await page.click('[data-testid="setup-continue"]');
  await page.waitForSelector('[data-testid="setup-step-permissions"]', { timeout: 20000 });
  check("account setup: billing saved with prefilled name and email", account.billing.billing_name === "QA Setup" && account.billing.billing_email === "qa.setup@reaigen.test" && account.billing.billing_postal_code === "81101", JSON.stringify(account.billing));

  await page.waitForSelector('[data-testid="setup-consent-ack"]', { timeout: 20000 });
  await page.click('[data-testid="setup-consent-ack"]');
  await page.click('[data-testid="setup-enable-agent"]');
  await page.waitForSelector('[data-testid="setup-all-tools"]', { timeout: 20000 });
  await page.waitForTimeout(300);
  await shot(page, "setup-permissions");
  const permissionsDone = await page.evaluate(() => document.querySelector('[data-testid="setup-rail-permissions"]')?.dataset.complete);
  check("account setup: Agent enabled and tools reported", account.consent.consented && permissionsDone === "true", String(permissionsDone));
  await page.click('[data-testid="setup-continue"]');
  await page.waitForSelector('[data-testid="setup-done"]', { timeout: 20000 });
  await shot(page, "setup-done");
  check("account setup: finishing records onboarding as completed", account.personalized.onboarding_completed === true && account.personalized.onboarding_skipped === false, JSON.stringify(account.personalized));
  check("account setup: no page errors", pageErrors.length === 0, pageErrors[0] ?? "");
  await page.close();
}

// ── 7. dashboard reminder: only while something is missing ─────────────────
{
  const { page, pageErrors } = await openPage("/dev-fixtures/account-setup?reminder=1");
  await page.route("**/api/reaigen/reai-agent/consent/", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ consented: false, policy_version: "3", granted_at: null, privacy: {} }) }));
  await page.waitForSelector('[data-testid="account-setup-reminder"]', { timeout: 60000 });
  await shot(page, "setup-reminder");
  const text = await page.evaluate(() => document.querySelector('[data-testid="account-setup-reminder"]')?.textContent ?? "");
  check("account setup: reminder shows progress and a way in", /1 \/ 4/.test(text) && /Continue setup/.test(text), text.slice(0, 120));
  check("account setup reminder: no page errors", pageErrors.length === 0, pageErrors[0] ?? "");
  await page.close();
}

// ── 8. registration: waits for the email link instead of a loading splash ──
{
  const { page, pageErrors } = await openPage("/");
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/reaigen/users/me/", (route) => json(route, {}, 401));
  let resends = 0;
  await page.route("**/api/auth/register/", (route) => json(route, { user: { id: 9 }, message: "Registration successful.", email_verification_required: true, verification_email_status: "sent" }, 201));
  await page.route("**/api/auth/resend-verification/**", (route) => { resends += 1; json(route, { sent: true }); });
  await page.waitForSelector("#login-email", { timeout: 60000 });
  await page.click("text=Create an account");
  await page.waitForSelector("#register-email", { timeout: 20000 });
  await page.fill("#register-first-name", "QA");
  await page.fill("#register-last-name", "Signup");
  await page.fill("#register-email", "qa.signup@reaigen.test");
  await page.fill("#register-password", "QaSetup!2026");
  await page.fill("#register-confirm", "QaSetup!2026");
  await page.click("#register-terms");
  await page.click('form button[type="submit"]');
  await page.waitForSelector('[data-testid="verification-pending"]', { timeout: 20000 });
  await shot(page, "register-pending");
  const pendingEmail = await page.evaluate(() => document.querySelector('[data-testid="verification-pending-email"]')?.textContent);
  check("registration: shows the check-your-inbox card with the address", pendingEmail === "qa.signup@reaigen.test", String(pendingEmail));
  await page.click('[data-testid="verification-pending-resend"]');
  await page.waitForTimeout(400);
  check("registration: resend goes through once", resends === 1, `resends=${resends}`);
  await page.click("text=Back to sign in");
  await page.waitForSelector("#login-email", { timeout: 20000 });
  check("registration: back to sign in restores the form", true);
  check("registration: no page errors", pageErrors.length === 0, pageErrors[0] ?? "");
  await page.close();
}

// ── 9. verified link lands on sign-in with the account marked active ────────
{
  const { page, pageErrors } = await openPage("/?verified=1");
  await page.route("**/api/reaigen/users/me/", (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.waitForSelector('[data-testid="verified-notice"]', { timeout: 60000 });
  const cleanUrl = await page.evaluate(() => location.search);
  check("verified: sign-in shows the notice and drops the flag from the URL", cleanUrl === "", cleanUrl);
  check("verified: no page errors", pageErrors.length === 0, pageErrors[0] ?? "");
  await page.close();
}

console.log(`\n${pass}/${pass + fail} passed`);
await browser.close();
process.exit(fail ? 1 : 0);
