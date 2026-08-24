#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  collectErgonomics,
  readCredentials,
  signIn,
} from "./ux-audit.mjs";

const VIEWPORTS = [
  { name: "wide", width: 2048, height: 1152 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 390, height: 844 },
];

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.UX_AUDIT_BASE_URL || "http://127.0.0.1:3056",
    credentials: process.env.UX_AUDIT_CREDENTIALS_FILE || "",
    output: process.env.UX_AUDIT_OUTPUT_DIR || ".ux-audit/full-current",
    headed: false,
    scenarios: [],
    viewports: [],
    tourRoute: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--headed") {
      options.headed = true;
      continue;
    }
    if (!["--base-url", "--credentials", "--output", "--scenario", "--viewport", "--tour-route"].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    index += 1;
    if (argument === "--base-url") options.baseUrl = value;
    if (argument === "--credentials") options.credentials = value;
    if (argument === "--output") options.output = value;
    if (argument === "--scenario") options.scenarios = value.split(",").map((item) => item.trim()).filter(Boolean);
    if (argument === "--viewport") options.viewports = value.split(",").map((item) => item.trim()).filter(Boolean);
    if (argument === "--tour-route") options.tourRoute = value;
  }
  return options;
}

function relativeRoute(value, baseUrl) {
  const url = new URL(value, baseUrl);
  return `${url.pathname}${url.search}`;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return String(value).replace(/\?.*$/, "");
  }
}

function slug(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
}

async function settle(page, heavy = false, cdpOnly = false) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: heavy ? 12_000 : 6_000 }).catch(() => undefined);
  if (cdpOnly) {
    // Tour routes perform a same-URL navigation while the renderer boots in
    // development. Chromium keeps painting and CDP remains responsive, but
    // Playwright's high-level DOM world can remain attached to the replaced
    // execution context. Do not turn that tooling quirk into a product
    // failure; the dedicated CDP audit path below inspects the live document.
    await page.waitForTimeout(4_000);
    return;
  }
  // Full-screen viewer/editor routes are composed from fixed descendants. In
  // that layout the document body can have a zero geometry box even while the
  // WebGL canvas and controls visibly fill the viewport, so Playwright's
  // `visible` predicate produces a false timeout. Readiness here means the
  // document exists and has painted at least one frame; renderer readiness is
  // audited separately below through aria-busy and canvas diagnostics.
  await page.locator("body").waitFor({ state: "attached", timeout: 15_000 });
  await page.evaluate(() => new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  }));
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await Promise.race([
      Promise.all(Array.from(document.images).map((image) => {
        if (image.complete) return Promise.resolve();
        return new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        });
      })),
      new Promise((resolve) => window.setTimeout(resolve, 3_000)),
    ]);
  });
  await page.waitForTimeout(heavy ? 4_000 : 650);
  if (heavy) {
    // Network idle does not cover SOG decoding, GPU upload, or the first
    // stable Gaussian frame. The viewer exposes that state semantically.
    const activeViewerLoader = page.locator('[aria-busy="true"]').first();
    if (await activeViewerLoader.count()) {
      // Renderer readiness is an audited outcome, not a reason to block every
      // later workspace for two minutes. If the scene is still busy after the
      // grace period, capture it and report the busy region as a hard failure.
      await activeViewerLoader.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(500);
    }
  }
  await page.addStyleTag({
    content: "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }",
  }).catch(() => undefined);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cdpEvaluate(session, expression) {
  const result = await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "CDP evaluation failed");
  }
  return result.result.value;
}

async function cdpVisible(session, selector) {
  return Boolean(await cdpEvaluate(session, `(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden"
        && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    return [...document.querySelectorAll(${JSON.stringify(selector)})].some(visible);
  })()`));
}

async function cdpWaitForVisible(session, selector, timeout = 8_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await cdpVisible(session, selector)) return true;
    await delay(200);
  }
  return false;
}

async function applyActionViaCdp(session, action) {
  if (!action) return { status: "none", activation: "cdp" };
  if (action.steps) {
    const steps = [];
    for (const step of action.steps) steps.push(await applyActionViaCdp(session, step));
    return {
      status: steps.every((step) => step.status === "applied" || step.status === "already-open")
        ? "applied"
        : "unavailable",
      activation: "cdp",
      steps,
    };
  }
  if (action.alreadyOpen && await cdpVisible(session, action.alreadyOpen)) {
    return { status: "already-open", activation: "cdp" };
  }
  if (!action.testId) return { status: "unavailable", activation: "cdp", reason: "unsupported CDP action" };
  const clicked = await cdpEvaluate(session, `(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden"
        && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const element = [...document.querySelectorAll(${JSON.stringify(`[data-testid="${action.testId}"]`)})].find(visible);
    if (!(element instanceof HTMLElement) || element.matches(":disabled")) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) return { status: "unavailable", activation: "cdp", reason: `${action.testId} missing or disabled` };
  if (action.waitFor) await cdpWaitForVisible(session, action.waitFor, 8_000);
  await delay(800);
  return { status: "applied", activation: "cdp" };
}

async function collectCdpVisualAudit(session) {
  return cdpEvaluate(session, `(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden"
        && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const controls = [...document.querySelectorAll('button,a[href],input,select,textarea,[role="button"],[role="tab"]')]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          label: (element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "")
            .trim().replace(/\\s+/g, " ").slice(0, 90),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });
    return {
      headings: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((heading) => ({
        level: Number(heading.tagName.slice(1)),
        text: (heading.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 120),
      })),
      landmarks: {
        main: document.querySelectorAll('main,[role="main"]').length,
        nav: document.querySelectorAll('nav,[role="navigation"]').length,
        aside: document.querySelectorAll('aside,[role="complementary"]').length,
        dialog: document.querySelectorAll('[role="dialog"]').length,
      },
      canvases: document.querySelectorAll("canvas").length,
      renderers: [...document.querySelectorAll("canvas")].map((canvas) => ({
        label: canvas.getAttribute("aria-label") || "",
        renderProfile: canvas.dataset.renderProfile || "",
        spinoffStatus: canvas.dataset.spinoffStatus || "",
        spinoffError: canvas.dataset.spinoffError || "",
        sparkStatus: canvas.dataset.sparkStatus || "",
        sparkError: canvas.dataset.sparkError || "",
      })),
      busyRegions: [...document.querySelectorAll('[aria-busy="true"]')].filter(visible).map((element) => ({
        tag: element.tagName.toLowerCase(),
        testId: element.getAttribute("data-testid") || "",
        label: (element.getAttribute("aria-label") || element.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 120),
      })),
      smallTargets: controls.filter((control) => control.width < 40 || control.height < 40),
      horizontalOverflow: Math.max(0, Math.round(document.documentElement.scrollWidth - window.innerWidth)),
    };
  })()`);
}

async function captureViewport(page, context, screenshotPath, heavy) {
  if (!heavy) {
    await page.screenshot({ path: screenshotPath, animations: "disabled" });
    return;
  }

  // Playwright's compositor-stability screenshot path can time out while a
  // WebGL canvas is rendering continuously. CDP captures the live surface
  // directly and preserves the real rendered 3D state.
  const session = await context.newCDPSession(page);
  try {
    const screenshot = await session.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  } finally {
    await session.detach().catch(() => undefined);
  }
}

async function discoverApplication(browser, baseUrl, storageState) {
  const context = await browser.newContext({ viewport: VIEWPORTS[1], storageState, reducedMotion: "reduce" });
  const page = await context.newPage();
  const discovery = { drafts: [], tourRoute: "", tourEditorRoute: "", settingsTabs: [] };
  try {
    await page.goto(new URL("/dashboard", baseUrl).toString(), { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.locator('[data-testid="draft-card-link"]').first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
    discovery.drafts = [...new Set(await page.locator('[data-testid="draft-card-link"]').evaluateAll(
      (links) => links.slice(0, 4).map((link) => link.getAttribute("href")).filter(Boolean),
    ))].map((href) => relativeRoute(href, baseUrl)).slice(0, 2);

    // Prefer a detail-page tour link because it contains both the canonical
    // splat and tour workspace IDs needed to audit viewer and authoring UI.
    for (const draftRoute of discovery.drafts) {
      await page.goto(new URL(draftRoute, baseUrl).toString(), { waitUntil: "domcontentloaded" });
      await settle(page);
      const href = await page.locator('a[href^="/tour/"]').first().getAttribute("href").catch(() => null);
      if (href) {
        discovery.tourRoute = relativeRoute(href, baseUrl);
        break;
      }
    }

    if (!discovery.tourRoute) {
      await page.goto(new URL("/tours", baseUrl).toString(), { waitUntil: "domcontentloaded" });
      await settle(page);
      const href = await page.locator('[data-testid="tour-card-link"]').first().getAttribute("href").catch(() => null);
      if (href) discovery.tourRoute = relativeRoute(href, baseUrl);
    }

    if (discovery.tourRoute) {
      const tourUrl = new URL(discovery.tourRoute, baseUrl);
      let tourId = tourUrl.searchParams.get("tourId");
      if (!tourId) {
        await page.goto(tourUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
        await settle(page, true);
        tourId = new URL(page.url()).searchParams.get("tourId");
        discovery.tourRoute = relativeRoute(page.url(), baseUrl);
      }
      if (tourId && /^\d+$/.test(tourId)) discovery.tourEditorRoute = `/create/tour/${tourId}`;
    }

    await page.goto(new URL("/settings", baseUrl).toString(), { waitUntil: "domcontentloaded" });
    await settle(page);
    discovery.settingsTabs = (await page.locator('[role="tab"]').allTextContents())
      .map((label) => label.trim().replace(/\s+/g, " "))
      .filter(Boolean);
  } finally {
    await context.close();
  }
  return discovery;
}

function buildScenarios(discovery) {
  const scenarios = [
    { id: "dashboard", label: "Concepts collection", route: "/dashboard", fullPage: true },
    { id: "dashboard-single", label: "Concepts single-column view", route: "/dashboard", action: { testId: "layout-single" } },
    { id: "dashboard-agent", label: "Concepts with Agent panel", route: "/dashboard", action: { testId: "agent-launcher", waitFor: '[data-testid="agent-panel"][aria-hidden="false"]' } },
    { id: "dashboard-account", label: "Mobile account menu", route: "/dashboard", action: { testId: "mobile-account-open", waitFor: '[data-testid="mobile-account-menu"]' }, viewports: ["mobile"] },
    { id: "tours", label: "Virtual tours collection", route: "/tours", fullPage: true },
    { id: "create", label: "Web creation form", route: "/create", fullPage: true },
    { id: "settings", label: "Settings default", route: "/settings", fullPage: true },
  ];

  discovery.settingsTabs.forEach((label, index) => {
    if (index === 0) return;
    scenarios.push({
      id: `settings-${slug(label) || index}`,
      label: `Settings: ${label}`,
      route: "/settings",
      action: { tabLabel: label },
      fullPage: true,
    });
  });

  discovery.drafts.forEach((route, index) => {
    scenarios.push({
      id: `draft-${index + 1}`,
      label: `Draft detail ${index + 1}`,
      route,
      fullPage: true,
      heavy: true,
    });
  });

  const primaryDraft = discovery.drafts[0];
  if (primaryDraft) {
    scenarios.push(
      { id: "draft-sharing", label: "Draft sharing sidebar", route: `${primaryDraft}?sharing=1`, heavy: true },
      { id: "draft-mobile-actions", label: "Draft mobile action sheet", route: primaryDraft, action: { testId: "draft-mobile-more", waitFor: '[role="dialog"]' }, viewports: ["mobile"], heavy: true },
      {
        id: "draft-media",
        label: "Draft media sidebar",
        route: primaryDraft,
        action: { testId: "draft-media-open", waitFor: '[data-side-panel-scroll]' },
        mobileAction: { steps: [{ testId: "draft-mobile-more", waitFor: '[role="dialog"]' }, { testId: "draft-mobile-media-open", waitFor: '[data-side-panel-scroll]' }] },
        heavy: true,
      },
      {
        id: "draft-media-edit",
        label: "Draft photo editing workspace",
        route: primaryDraft,
        action: {
          steps: [
            { testId: "draft-media-open", waitFor: '[data-side-panel-scroll]' },
            { testId: "draft-media-edit-photo", waitFor: '[data-side-panel-scroll]' },
          ],
        },
        mobileAction: {
          steps: [
            { testId: "draft-mobile-more", waitFor: '[role="dialog"]' },
            { testId: "draft-mobile-media-open", waitFor: '[data-side-panel-scroll]' },
            { testId: "draft-media-edit-photo", waitFor: '[data-side-panel-scroll]' },
          ],
        },
        heavy: true,
      },
      {
        id: "draft-media-edit-crop",
        label: "Draft photo crop controls",
        route: primaryDraft,
        action: {
          steps: [
            { testId: "draft-media-open", waitFor: '[data-side-panel-scroll]' },
            { testId: "draft-media-edit-photo", waitFor: '[data-side-panel-scroll]' },
            { tabIndex: 2 },
          ],
        },
        mobileAction: {
          steps: [
            { testId: "draft-mobile-more", waitFor: '[role="dialog"]' },
            { testId: "draft-mobile-media-open", waitFor: '[data-side-panel-scroll]' },
            { testId: "draft-media-edit-photo", waitFor: '[data-side-panel-scroll]' },
            { tabIndex: 2 },
          ],
        },
        viewports: ["mobile"],
        heavy: true,
      },
      {
        id: "draft-editor",
        label: "Draft parameter editor",
        route: primaryDraft,
        action: { testId: "draft-editor-open", waitFor: '[data-side-panel-scroll]' },
        mobileAction: { steps: [{ testId: "draft-mobile-more", waitFor: '[role="dialog"]' }, { testId: "draft-mobile-editor-open", waitFor: '[data-side-panel-scroll]' }] },
        heavy: true,
      },
      {
        id: "draft-versions",
        label: "Draft version and tour sidebar",
        route: primaryDraft,
        action: { testId: "draft-versions-open", waitFor: '[data-side-panel-scroll]' },
        mobileAction: { steps: [{ testId: "draft-mobile-more", waitFor: '[role="dialog"]' }, { testId: "draft-mobile-versions-open", waitFor: '[data-side-panel-scroll]' }] },
        heavy: true,
      },
      { id: "draft-agent", label: "Draft with contextual Agent", route: primaryDraft, action: { testId: "agent-launcher", waitFor: '[data-testid="agent-panel"][aria-hidden="false"]' }, heavy: true },
      { id: "draft-tour-assets", label: "Draft tour delivery sidebar", route: primaryDraft, action: { testId: "draft-tour-assets-open", waitFor: '[data-side-panel-scroll]' }, heavy: true },
      { id: "draft-gallery-overview", label: "Draft fullscreen gallery overview", route: primaryDraft, action: { testId: "draft-gallery-overview-open", waitFor: '[role="dialog"]' }, viewports: ["wide", "desktop"], heavy: true },
      { id: "draft-gallery-icon-overview", label: "Draft gallery icon opens overview", route: primaryDraft, action: { testId: "draft-gallery-icon-overview-open", waitFor: '[role="dialog"]' }, viewports: ["mobile"], heavy: true },
    );
  }

  if (discovery.tourRoute) {
    scenarios.push(
      { id: "tour-viewer", label: "Virtual tour viewer and camera preview", route: discovery.tourRoute, heavy: true },
      {
        id: "tour-camera-editor",
        label: "Virtual tour saved-camera editor",
        route: discovery.tourRoute,
        action: {
          steps: [
            { testId: "camera-editor-edit", alreadyOpen: '[data-testid="camera-editor-collapsed"], [data-testid="camera-editor-expanded"]', waitFor: '[data-testid="camera-editor-collapsed"]' },
            { testId: "camera-editor-expand", alreadyOpen: '[data-testid="camera-editor-expanded"]', waitFor: '[data-testid="camera-editor-expanded"]' },
          ],
        },
        viewports: ["wide", "desktop", "tablet"],
        heavy: true,
      },
    );
  }

  if (discovery.tourEditorRoute) {
    scenarios.push(
      { id: "tour-editor", label: "Tour authoring workspace", route: discovery.tourEditorRoute, heavy: true },
      { id: "tour-editor-scene", label: "Tour editor scene graph", route: discovery.tourEditorRoute, action: { testId: "tour-editor-scene-open", alreadyOpen: '[data-testid="tour-editor-scene-panel"]' }, heavy: true },
      { id: "tour-editor-inspector", label: "Tour editor inspector", route: discovery.tourEditorRoute, action: { testId: "tour-editor-inspector-open", alreadyOpen: '[data-testid="tour-editor-inspector-panel"]' }, heavy: true },
      {
        id: "tour-editor-cameras",
        label: "Tour editor cameras",
        route: discovery.tourEditorRoute,
        action: {
          steps: [
            { testId: "tour-editor-camera-open", alreadyOpen: '[data-testid^="camera-editor-"]', waitFor: '[data-testid="camera-editor-preview"]' },
            { testId: "camera-editor-edit", alreadyOpen: '[data-testid="camera-editor-collapsed"], [data-testid="camera-editor-expanded"]', waitFor: '[data-testid="camera-editor-collapsed"]' },
            { testId: "camera-editor-expand", alreadyOpen: '[data-testid="camera-editor-expanded"]', waitFor: '[data-testid="camera-editor-expanded"]' },
          ],
        },
        heavy: true,
      },
      { id: "tour-editor-prune", label: "Tour editor splat editing", route: discovery.tourEditorRoute, action: { testId: "tour-editor-prune-open" }, viewports: ["wide", "desktop", "tablet"], heavy: true },
    );
  }

  return scenarios;
}

async function applyAction(page, action) {
  if (!action) return { status: "none" };
  if (action.steps) {
    const steps = [];
    for (const step of action.steps) steps.push(await applyAction(page, step));
    return { status: steps.every((step) => step.status === "applied" || step.status === "already-open") ? "applied" : "unavailable", steps };
  }
  if (action.tabLabel) {
    const tab = page.getByRole("tab", { name: action.tabLabel, exact: true });
    if (await tab.count() && await tab.first().isVisible()) {
      await tab.first().click({ timeout: 8_000 });
      await page.waitForTimeout(700);
      return { status: "applied" };
    }
    const select = page.locator("select:visible").first();
    if (!(await select.count())) return { status: "unavailable", reason: `settings control for ${action.tabLabel} missing` };
    await select.selectOption({ label: action.tabLabel });
    await page.waitForTimeout(700);
    return { status: "applied" };
  }
  if (Number.isInteger(action.tabIndex)) {
    const tab = page.locator('[role="tab"]:visible').nth(action.tabIndex);
    if (!(await tab.count())) return { status: "unavailable", reason: `tab ${action.tabIndex} missing` };
    await tab.click({ timeout: 8_000 });
    await page.waitForTimeout(700);
    return { status: "applied" };
  }

  if (action.alreadyOpen && await page.locator(`${action.alreadyOpen}:visible`).count()) {
    return { status: "already-open" };
  }
  if (action.hoverTestId) {
    const hoverTarget = page.locator(`[data-testid="${action.hoverTestId}"]:visible`).first();
    if (!(await hoverTarget.count())) return { status: "unavailable", reason: `${action.hoverTestId} missing` };
    await hoverTarget.hover({ timeout: 8_000 });
    await page.waitForTimeout(500);
    return { status: "applied", activation: "hover" };
  }
  const control = page.locator(`[data-testid="${action.testId}"]:visible`).first();
  if (!(await control.count())) return { status: "unavailable", reason: `${action.testId} missing` };
  if (await control.isDisabled().catch(() => false)) return { status: "unavailable", reason: `${action.testId} disabled` };
  let activation = "pointer";
  try {
    await control.click({ timeout: 8_000 });
  } catch (error) {
    if (error?.name !== "TimeoutError") throw error;
    // A continuously rendering WebGL surface can prevent Playwright's native
    // compositor-stability check from completing even after aria-busy=false.
    // Activate the already-visible, enabled control through the DOM and keep
    // the fallback visible in the machine-readable result.
    await control.click({ timeout: 8_000, force: true }).catch(async () => {
      await control.evaluate((element) => element.click(), undefined, { timeout: 8_000 });
    });
    activation = "dom-click-fallback";
  }
  if (action.waitFor) {
    await page.locator(`${action.waitFor}:visible`).first().waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
  }
  await page.waitForTimeout(800);
  return { status: "applied", activation };
}

async function keyboardAudit(page) {
  const seen = [];
  let escapedDialog = false;
  for (let index = 0; index < 24; index += 1) {
    await page.keyboard.press("Tab");
    const active = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement) || element === document.body) return null;
      const rect = element.getBoundingClientRect();
      const dialog = element.closest('[role="dialog"]');
      const visibleDialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((candidate) => {
        const style = getComputedStyle(candidate);
        const box = candidate.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0;
      });
      return {
        tag: element.tagName.toLowerCase(),
        label: (element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 90),
        visible: rect.width > 0 && rect.height > 0,
        insideDialog: Boolean(dialog),
        dialogOpen: Boolean(visibleDialog),
      };
    });
    if (!active) continue;
    if (active.dialogOpen && !active.insideDialog) escapedDialog = true;
    const key = `${active.tag}:${active.label}`;
    if (!seen.some((item) => item.key === key)) seen.push({ key, ...active });
  }
  return { uniqueStops: seen.length, invisibleStops: seen.filter((item) => !item.visible), escapedDialog, sample: seen.slice(0, 16) };
}

async function auditScenario(context, baseUrl, outputDir, scenario, viewport) {
  const page = await context.newPage();
  const runtime = { consoleErrors: [], pageErrors: [], failedRequests: [], abortedRequests: [], responseErrors: [] };
  page.on("console", (message) => {
    if (message.type() === "error") runtime.consoleErrors.push(message.text().replace(/https?:\/\/\S+/g, (url) => safeUrl(url)).slice(0, 600));
  });
  page.on("pageerror", (error) => runtime.pageErrors.push(error.message.slice(0, 600)));
  page.on("requestfailed", (request) => {
    const failure = { url: safeUrl(request.url()), error: request.failure()?.errorText || "failed" };
    // Browsers cancel an in-flight image request when the editor swaps
    // Original/Edited sources. Preserve it in the JSON for diagnostics, but
    // do not classify that expected cancellation as a runtime failure.
    if (failure.error === "net::ERR_ABORTED") runtime.abortedRequests.push(failure);
    else runtime.failedRequests.push(failure);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) runtime.responseErrors.push({ url: safeUrl(response.url()), status: response.status() });
  });

  const started = Date.now();
  try {
    await page.goto(new URL(scenario.route, baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 40_000 });
    const cdpOnly = scenario.id.startsWith("tour-");
    await settle(page, scenario.heavy, cdpOnly);
    const requestedAction = viewport.name === "mobile" && scenario.mobileAction ? scenario.mobileAction : scenario.action;

    if (cdpOnly) {
      const session = await context.newCDPSession(page);
      try {
        const action = await applyActionViaCdp(session, requestedAction);
        const busyDeadline = Date.now() + 15_000;
        let visual = await collectCdpVisualAudit(session);
        while (visual.busyRegions.length && Date.now() < busyDeadline) {
          await delay(250);
          visual = await collectCdpVisualAudit(session);
        }
        const name = `${scenario.id}-${viewport.name}.png`;
        await captureViewport(page, context, path.join(outputDir, name), true);
        const { smallTargets, horizontalOverflow, ...semantics } = visual;
        return {
          status: "ok",
          auditMode: "visual-renderer",
          scenario: scenario.id,
          label: scenario.label,
          route: scenario.route,
          finalUrl: relativeRoute(page.url(), baseUrl),
          viewport,
          durationMs: Date.now() - started,
          action,
          screenshots: { viewport: name, fullPage: null },
          accessibility: [],
          ergonomics: {
            smallTargets,
            document: { horizontalOverflow },
            scrolling: { nestedPairs: [] },
          },
          keyboard: { notAudited: true, uniqueStops: 0, invisibleStops: [], escapedDialog: false, sample: [] },
          semantics,
          runtime,
        };
      } finally {
        await session.detach().catch(() => undefined);
      }
    }

    const action = await applyAction(page, requestedAction);
    // Opening a panel can start its own data request after the page itself has
    // settled. Audit the usable state rather than accidentally grading a
    // well-shaped skeleton that is only visible for a moment.
    const activePanelBusy = page.locator('[role="dialog"] [aria-busy="true"]:visible, [role="complementary"] [aria-busy="true"]:visible').first();
    if (await activePanelBusy.count()) {
      await activePanelBusy.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(250);
    }
    const name = `${scenario.id}-${viewport.name}.png`;
    const screenshotPath = path.join(outputDir, name);
    await captureViewport(page, context, screenshotPath, scenario.heavy);
    let fullPage = null;
    if (scenario.fullPage) {
      fullPage = `${scenario.id}-${viewport.name}-full.png`;
      await page.screenshot({ path: path.join(outputDir, fullPage), fullPage: true, animations: "disabled" });
    }

    const axe = await new AxeBuilder({ page }).analyze();
    const accessibility = axe.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        html: node.html,
        failureSummary: node.failureSummary,
      })),
    }));
    const ergonomics = await collectErgonomics(page, viewport);
    const keyboard = await keyboardAudit(page);
    const semantics = await page.evaluate(() => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
      };
      return {
        headings: Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((heading) => ({
          level: Number(heading.tagName.slice(1)),
          text: heading.textContent?.trim().replace(/\s+/g, " ").slice(0, 120) || "",
        })),
        landmarks: {
          main: document.querySelectorAll('main,[role="main"]').length,
          nav: document.querySelectorAll('nav,[role="navigation"]').length,
          aside: document.querySelectorAll('aside,[role="complementary"]').length,
          dialog: document.querySelectorAll('[role="dialog"]').length,
        },
        canvases: document.querySelectorAll("canvas").length,
        renderers: Array.from(document.querySelectorAll("canvas")).map((canvas) => ({
          label: canvas.getAttribute("aria-label") || "",
          renderProfile: canvas.dataset.renderProfile || "",
          spinoffStatus: canvas.dataset.spinoffStatus || "",
          spinoffError: canvas.dataset.spinoffError || "",
          sparkStatus: canvas.dataset.sparkStatus || "",
          sparkError: canvas.dataset.sparkError || "",
        })),
        busyRegions: Array.from(document.querySelectorAll('[aria-busy="true"]'))
          .filter(visible)
          .map((element) => ({
            tag: element.tagName.toLowerCase(),
            testId: element.getAttribute("data-testid") || "",
            label: (element.getAttribute("aria-label") || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120),
          })),
      };
    });

    return {
      status: "ok",
      scenario: scenario.id,
      label: scenario.label,
      route: scenario.route,
      finalUrl: relativeRoute(page.url(), baseUrl),
      viewport,
      durationMs: Date.now() - started,
      action,
      screenshots: { viewport: name, fullPage },
      accessibility,
      ergonomics,
      keyboard,
      semantics,
      runtime,
    };
  } catch (error) {
    const failureName = `${scenario.id}-${viewport.name}-failed.png`;
    await captureViewport(page, context, path.join(outputDir, failureName), scenario.heavy).catch(() => undefined);
    return {
      status: "failed",
      scenario: scenario.id,
      label: scenario.label,
      route: scenario.route,
      viewport,
      durationMs: Date.now() - started,
      error: error.message,
      screenshot: failureName,
      runtime,
    };
  } finally {
    await page.close();
  }
}

function markdownReport(report) {
  const ok = report.results.filter((result) => result.status === "ok");
  const failed = report.results.filter((result) => result.status === "failed");
  const visualOnly = ok.filter((result) => result.auditMode === "visual-renderer");
  const domAudited = ok.filter((result) => result.auditMode !== "visual-renderer");
  const totals = ok.reduce((value, result) => ({
    axe: value.axe + result.accessibility.length,
    small: value.small + result.ergonomics.smallTargets.length,
    overflow: value.overflow + Number(result.ergonomics.document.horizontalOverflow > 0),
    runtime: value.runtime + result.runtime.consoleErrors.length + result.runtime.pageErrors.length + result.runtime.failedRequests.length + result.runtime.responseErrors.length,
    focus: value.focus + Number(result.keyboard.escapedDialog),
    nestedScroll: value.nestedScroll + result.ergonomics.scrolling.nestedPairs.length,
    busy: value.busy + result.semantics.busyRegions.length,
  }), { axe: 0, small: 0, overflow: 0, runtime: 0, focus: 0, nestedScroll: 0, busy: 0 });

  const issueCounts = new Map();
  for (const result of ok) {
    for (const violation of result.accessibility) {
      issueCounts.set(violation.id, (issueCounts.get(violation.id) || 0) + 1);
    }
  }

  const lines = [
    "# Reaigen full product UX audit",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Scenarios: **${report.scenarios.length}** · DOM-audited states: **${domAudited.length}** · Visual/renderer states: **${visualOnly.length}** · Failed states: **${failed.length}**`,
    "",
    `Axe violations in DOM-audited states: **${totals.axe}** · Small-target findings: **${totals.small}** · Overflowing states: **${totals.overflow}** · Nested panel scroll pairs: **${totals.nestedScroll}** · Runtime/network findings: **${totals.runtime}** · Stuck busy regions: **${totals.busy}** · Dialog focus escapes: **${totals.focus}**`,
    "",
    "## Discovered application data",
    "",
    `- Draft routes: ${report.discovery.drafts.length ? report.discovery.drafts.map((route) => `\`${route}\``).join(", ") : "none"}`,
    `- Tour viewer: ${report.discovery.tourRoute ? `\`${report.discovery.tourRoute}\`` : "not discovered"}`,
    `- Tour editor: ${report.discovery.tourEditorRoute ? `\`${report.discovery.tourEditorRoute}\`` : "not discovered"}`,
    `- Settings tabs: ${report.discovery.settingsTabs.length ? report.discovery.settingsTabs.join(", ") : "none"}`,
    "",
    "## Repeated accessibility clusters",
    "",
  ];
  if (!issueCounts.size) lines.push("No Axe violations were found.");
  for (const [id, count] of [...issueCounts.entries()].sort((left, right) => right[1] - left[1])) {
    lines.push(`- ${id}: ${count} audited states`);
  }

  lines.push(
    "",
    "## State matrix",
    "",
    "| Scenario | Viewport | Status | Axe | Small targets | Overflow | Nested scroll | Runtime | Busy | Focus escape | Duration | Screenshot |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |",
  );
  for (const result of report.results) {
    if (result.status === "failed") {
      lines.push(`| ${result.label} | ${result.viewport.name} | failed | — | — | — | — | ${result.runtime.consoleErrors.length + result.runtime.pageErrors.length + result.runtime.failedRequests.length + result.runtime.responseErrors.length} | — | — | ${(result.durationMs / 1000).toFixed(1)}s | [failure](${result.screenshot}) |`);
      continue;
    }
    const runtimeCount = result.runtime.consoleErrors.length + result.runtime.pageErrors.length + result.runtime.failedRequests.length + result.runtime.responseErrors.length;
    const visualAudit = result.auditMode === "visual-renderer";
    const state = result.action.status === "unavailable"
      ? "state unavailable"
      : result.semantics.busyRegions.length
        ? "busy"
        : visualAudit
          ? "visual"
          : "ok";
    lines.push(`| ${result.label} | ${result.viewport.name} | ${state} | ${visualAudit ? "—" : result.accessibility.length} | ${result.ergonomics.smallTargets.length} | ${result.ergonomics.document.horizontalOverflow}px | ${visualAudit ? "—" : result.ergonomics.scrolling.nestedPairs.length} | ${runtimeCount} | ${result.semantics.busyRegions.length} | ${visualAudit ? "—" : result.keyboard.escapedDialog ? "yes" : "no"} | ${(result.durationMs / 1000).toFixed(1)}s | [view](${result.screenshots.viewport}) |`);
  }

  const nestedScrollFindings = ok.flatMap((result) => result.ergonomics.scrolling.nestedPairs.map((pair) => ({
    label: result.label,
    viewport: result.viewport.name,
    ...pair,
  })));
  if (nestedScrollFindings.length) {
    lines.push("", "## Nested panel scroll findings", "");
    for (const finding of nestedScrollFindings) {
      lines.push(`- ${finding.label} / ${finding.viewport}: \`${finding.outer}\` contains \`${finding.inner}\` inside ${finding.panel}.`);
    }
  }

  if (failed.length) {
    lines.push("", "## Failed states", "");
    for (const result of failed) lines.push(`- ${result.label} / ${result.viewport.name}: ${result.error}`);
  }
  return `${lines.join("\n")}\n`;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const outputDir = path.resolve(options.output);
  await fs.mkdir(outputDir, { recursive: true });
  const credentials = await readCredentials(options.credentials);
  const browser = await chromium.launch({ headless: !options.headed });
  try {
    const storageState = await signIn(browser, options.baseUrl, credentials, outputDir);
    const discovery = await discoverApplication(browser, options.baseUrl, storageState);
    if (options.tourRoute) {
      discovery.tourRoute = relativeRoute(options.tourRoute, options.baseUrl);
      const tourId = new URL(discovery.tourRoute, options.baseUrl).searchParams.get("tourId");
      discovery.tourEditorRoute = tourId && /^\d+$/.test(tourId) ? `/create/tour/${tourId}` : "";
    }
    const availableScenarios = buildScenarios(discovery);
    const scenarios = options.scenarios.length
      ? availableScenarios.filter((scenario) => options.scenarios.includes(scenario.id))
      : availableScenarios;
    const viewports = options.viewports.length
      ? VIEWPORTS.filter((viewport) => options.viewports.includes(viewport.name))
      : VIEWPORTS;
    const unknownScenarios = options.scenarios.filter((id) => !availableScenarios.some((scenario) => scenario.id === id));
    const unknownViewports = options.viewports.filter((name) => !VIEWPORTS.some((viewport) => viewport.name === name));
    if (unknownScenarios.length) throw new Error(`Unknown scenario(s): ${unknownScenarios.join(", ")}`);
    if (unknownViewports.length) throw new Error(`Unknown viewport(s): ${unknownViewports.join(", ")}`);
    const results = [];
    const total = scenarios.reduce((count, scenario) => (
      count + viewports.filter((viewport) => !scenario.viewports || scenario.viewports.includes(viewport.name)).length
    ), 0);
    let completed = 0;
    process.stdout.write(`Discovered ${scenarios.length} scenarios (${total} viewport states).\n`);

    for (const scenario of scenarios) {
      for (const viewport of viewports) {
        if (scenario.viewports && !scenario.viewports.includes(viewport.name)) continue;
        // Each scenario gets a clean UI context. Reusing a context let the
        // single-column dashboard test persist its layout in localStorage and
        // silently change every later Tours and draft screenshot.
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          storageState,
          reducedMotion: "reduce",
        });
        const result = await auditScenario(context, options.baseUrl, outputDir, scenario, viewport)
          .finally(() => context.close().catch(() => undefined));
        results.push(result);
        completed += 1;
        process.stdout.write(`[${completed}/${total}] ${scenario.id} · ${viewport.name} · ${result.status}\n`);
      }
    }

    const report = { generatedAt: new Date().toISOString(), baseUrl: options.baseUrl, discovery, scenarios, results };
    await fs.writeFile(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    await fs.writeFile(path.join(outputDir, "report.md"), markdownReport(report));
    process.stdout.write(`Full UX audit complete: ${path.join(outputDir, "report.md")}\n`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
