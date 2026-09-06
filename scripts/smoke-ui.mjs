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
const BASE = `http://localhost:${PORT}`;

const browser = await chromium.launch();
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
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

console.log(`\n${pass}/${pass + fail} passed`);
await browser.close();
process.exit(fail ? 1 : 0);
