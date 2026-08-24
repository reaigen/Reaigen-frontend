#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";

export const DEFAULT_VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 390, height: 844 },
];

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.UX_AUDIT_BASE_URL || "http://127.0.0.1:3056",
    credentials: process.env.UX_AUDIT_CREDENTIALS_FILE || "",
    output: process.env.UX_AUDIT_OUTPUT_DIR || ".ux-audit/current",
    compare: process.env.UX_AUDIT_COMPARE_DIR || "",
    route: process.env.UX_AUDIT_ROUTE || "/dashboard",
    headed: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--headed") {
      options.headed = true;
      continue;
    }
    const key = argument.startsWith("--") ? argument.slice(2) : "";
    if (!["base-url", "credentials", "output", "compare", "route"].includes(key)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    index += 1;
    options[key.replaceAll("-", "")] = value;
  }

  return {
    baseUrl: options.baseurl || options.baseUrl,
    credentials: options.credentials,
    output: options.output,
    compare: options.compare,
    route: options.route.startsWith("/") ? options.route : `/${options.route}`,
    headed: options.headed,
  };
}

export async function readCredentials(filePath) {
  if (!filePath) {
    throw new Error("Pass --credentials <path> or set UX_AUDIT_CREDENTIALS_FILE.");
  }

  const raw = (await fs.readFile(path.resolve(filePath), "utf8")).trim();
  let email = "";
  let password = "";

  if (raw.startsWith("{")) {
    const value = JSON.parse(raw);
    email = String(value.email || value.username || "").trim();
    password = String(value.password || "");
  } else {
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.every((line) => line.includes("="))) {
      const values = Object.fromEntries(lines.map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()];
      }));
      email = values.email || values.username || "";
      password = values.password || "";
    } else {
      [email = "", password = ""] = lines;
    }
  }

  if (!email || !password) {
    throw new Error("Credential file must contain email and password as two lines, JSON, or KEY=value pairs.");
  }
  return { email, password };
}

export async function signIn(browser, baseUrl, credentials, outputDir) {
  const context = await browser.newContext({
    viewport: DEFAULT_VIEWPORTS[0],
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  // Establish the first-party cookie in the same browser context without
  // coupling every visual run to React's post-submit redirect timing. The
  // login UI remains independently testable, while authenticated page audits
  // start from a deterministic state.
  const loginResponse = await context.request.post(
    new URL("/api/auth/login/", baseUrl).toString(),
    { data: credentials, timeout: 20_000 },
  );
  if (!loginResponse.ok()) {
    throw new Error(`Login request failed with HTTP ${loginResponse.status()}.`);
  }

  await page.goto(new URL("/dashboard", baseUrl).toString(), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  try {
    await page.waitForURL((url) => url.pathname.startsWith("/dashboard"), { timeout: 20_000 });
  } catch (error) {
    await fs.mkdir(outputDir, { recursive: true });
    await page.screenshot({ path: path.join(outputDir, "login-failed.png"), fullPage: true });
    throw new Error(`Login did not reach /dashboard. Inspect ${path.join(outputDir, "login-failed.png")}.`, { cause: error });
  }

  const storageState = await context.storageState();
  await context.close();
  return storageState;
}

export async function waitForStablePage(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  await page.locator("main").waitFor({ state: "visible", timeout: 15_000 });
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
      new Promise((resolve) => window.setTimeout(resolve, 5_000)),
    ]);
  });
  await page.addStyleTag({
    content: "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }",
  });
}

export async function collectErgonomics(page, viewport) {
  return page.evaluate(({ width, height }) => {
    const isVisible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.closest('[aria-hidden="true"], [inert]')
        && !element.classList.contains("sr-only")
        && !(rect.width <= 1 && rect.height <= 1)
        && style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity) > 0
        && rect.width > 0
        && rect.height > 0;
    };
    const selectorFor = (element) => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const testId = element.getAttribute("data-testid");
      if (testId) return `[data-testid="${testId}"]`;
      const tag = element.tagName.toLowerCase();
      const label = element.getAttribute("aria-label") || element.getAttribute("title");
      return label ? `${tag}[label="${label.slice(0, 80)}"]` : tag;
    };
    const accessibleName = (element) => {
      const id = element.getAttribute("id");
      const explicitLabel = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : "";
      return element.getAttribute("aria-label")
        || element.getAttribute("aria-labelledby")
        || element.getAttribute("alt")
        || element.getAttribute("title")
        || explicitLabel
        || element.textContent
        || element.getAttribute("placeholder")
        || "";
    };

    const interactive = Array.from(document.querySelectorAll(
      'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])',
    )).filter(isVisible);
    const targetFloor = width < 600 ? 44 : 36;
    const smallTargets = interactive.flatMap((element) => {
      // Native label activation makes the whole label a valid hit target for
      // the nested control. Measuring only a switch's visible track reports a
      // false 28×16 failure even when the surrounding 300×48 row is clickable.
      const target = element.closest("label") || element;
      const rect = target.getBoundingClientRect();
      if (rect.width >= targetFloor && rect.height >= targetFloor) return [];
      return [{
        selector: selectorFor(element),
        label: accessibleName(element).trim().replace(/\s+/g, " ").slice(0, 100),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }];
    });
    const unnamedControls = interactive
      .filter((element) => !accessibleName(element).trim())
      .map(selectorFor);

    const allVisible = Array.from(document.body.querySelectorAll("*")).filter(isVisible);

    // A side panel should normally expose one clear vertical scrolling plane.
    // Nested overflow owners create the "scrollbar inside a scrollbar" trap:
    // wheel/touch input changes owner unexpectedly and content becomes hard to
    // reach. Keep this scoped to visible panels so the document scrollbar and
    // intentional page sections do not produce noise.
    const panelSelector = '[role="dialog"], [role="complementary"]';
    const panelRoots = Array.from(document.querySelectorAll(panelSelector)).filter(isVisible);
    const scrollPanels = panelRoots.map((root) => {
      const candidates = [root, ...root.querySelectorAll("*")].filter((element) => {
        if (!isVisible(element)) return false;
        if (element !== root && element.closest(panelSelector) !== root) return false;
        const style = getComputedStyle(element);
        return /^(auto|scroll)$/.test(style.overflowY)
          && element.scrollHeight > element.clientHeight + 2;
      });
      const owners = candidates.map((element) => ({
        element,
        selector: selectorFor(element),
        clientHeight: Math.round(element.clientHeight),
        scrollHeight: Math.round(element.scrollHeight),
      }));
      const nestedPairs = [];
      for (let outerIndex = 0; outerIndex < owners.length; outerIndex += 1) {
        for (let innerIndex = outerIndex + 1; innerIndex < owners.length; innerIndex += 1) {
          const outer = owners[outerIndex];
          const inner = owners[innerIndex];
          if (outer.element.contains(inner.element)) {
            nestedPairs.push({ outer: outer.selector, inner: inner.selector });
          } else if (inner.element.contains(outer.element)) {
            nestedPairs.push({ outer: inner.selector, inner: outer.selector });
          }
        }
      }
      return {
        root: selectorFor(root),
        owners: owners.map(({ element: _element, ...owner }) => owner),
        nestedPairs,
      };
    }).filter((panel) => panel.owners.length > 0);

    const overflowElements = allVisible.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.right <= width + 1 && rect.left >= -1) return [];
      return [{ selector: selectorFor(element), left: Math.round(rect.left), right: Math.round(rect.right) }];
    }).slice(0, 40);

    const clippedText = allVisible.flatMap((element) => {
      if (!element.textContent?.trim() || element.children.length > 0) return [];
      const style = getComputedStyle(element);
      const horizontal = element.scrollWidth > element.clientWidth + 1;
      const vertical = element.scrollHeight > element.clientHeight + 1;
      if (!horizontal && !vertical) return [];
      return [{
        selector: selectorFor(element),
        text: element.textContent.trim().replace(/\s+/g, " ").slice(0, 100),
        intentionalEllipsis: style.textOverflow === "ellipsis",
      }];
    }).slice(0, 40);

    const tinyText = allVisible.flatMap((element) => {
      if (!element.textContent?.trim() || element.children.length > 0) return [];
      const size = Number.parseFloat(getComputedStyle(element).fontSize);
      if (!Number.isFinite(size) || size >= 12) return [];
      return [{
        selector: selectorFor(element),
        text: element.textContent.trim().replace(/\s+/g, " ").slice(0, 100),
        fontSize: size,
      }];
    }).slice(0, 40);

    const cards = Array.from(document.querySelectorAll("article")).filter(isVisible);
    const visibleCards = cards.filter((card) => {
      const rect = card.getBoundingClientRect();
      return rect.top < height && rect.bottom > 0;
    }).length;

    return {
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - width),
      },
      interactiveCount: interactive.length,
      smallTargetFloor: targetFloor,
      smallTargets,
      unnamedControls,
      overflowElements,
      clippedText,
      tinyText,
      cards: { totalInDom: cards.length, visibleAboveFold: visibleCards },
      scrolling: {
        panels: scrollPanels,
        ownerCount: scrollPanels.reduce((count, panel) => count + panel.owners.length, 0),
        nestedPairs: scrollPanels.flatMap((panel) => panel.nestedPairs.map((pair) => ({
          panel: panel.root,
          ...pair,
        }))),
      },
    };
  }, viewport);
}

async function compareImages(currentPath, baselinePath, diffPath) {
  try {
    await fs.access(baselinePath);
  } catch {
    return { status: "missing-baseline" };
  }

  const current = sharp(currentPath).ensureAlpha();
  const baseline = sharp(baselinePath).ensureAlpha();
  const [currentMeta, baselineMeta] = await Promise.all([current.metadata(), baseline.metadata()]);
  if (currentMeta.width !== baselineMeta.width || currentMeta.height !== baselineMeta.height) {
    return {
      status: "dimension-change",
      current: [currentMeta.width, currentMeta.height],
      baseline: [baselineMeta.width, baselineMeta.height],
    };
  }

  const [{ data: currentData, info }, { data: baselineData }] = await Promise.all([
    current.raw().toBuffer({ resolveWithObject: true }),
    baseline.raw().toBuffer({ resolveWithObject: true }),
  ]);
  const diff = Buffer.alloc(currentData.length);
  let changedPixels = 0;
  for (let index = 0; index < currentData.length; index += 4) {
    const difference = Math.max(
      Math.abs(currentData[index] - baselineData[index]),
      Math.abs(currentData[index + 1] - baselineData[index + 1]),
      Math.abs(currentData[index + 2] - baselineData[index + 2]),
    );
    if (difference > 20) changedPixels += 1;
    diff[index] = difference > 20 ? 236 : 255;
    diff[index + 1] = difference > 20 ? 72 : 255;
    diff[index + 2] = difference > 20 ? 153 : 255;
    diff[index + 3] = difference > 20 ? 255 : 42;
  }
  await sharp(diff, { raw: info }).png().toFile(diffPath);
  return {
    status: "compared",
    changedPixels,
    changedPercent: Number(((changedPixels / (info.width * info.height)) * 100).toFixed(3)),
    diff: path.basename(diffPath),
  };
}

function markdownReport(report) {
  const lines = [
    "# Reaigen UX audit",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Route: \`${report.route}\``,
    "",
    "| Viewport | Cards above fold | Small targets | Unnamed controls | Horizontal overflow | Axe violations | Runtime errors |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const result of report.results) {
    lines.push(`| ${result.viewport.name} (${result.viewport.width}×${result.viewport.height}) | ${result.ergonomics.cards.visibleAboveFold} | ${result.ergonomics.smallTargets.length} | ${result.ergonomics.unnamedControls.length} | ${result.ergonomics.document.horizontalOverflow}px | ${result.accessibility.length} | ${result.runtime.consoleErrors.length + result.runtime.pageErrors.length + result.runtime.failedRequests.length} |`);
  }

  for (const result of report.results) {
    lines.push("", `## ${result.viewport.name}`, "");
    lines.push(`- Screenshot: \`${result.screenshots.viewport}\``);
    lines.push(`- Full page: \`${result.screenshots.fullPage}\``);
    if (result.visualComparison) {
      lines.push(`- Visual comparison: ${result.visualComparison.status}${result.visualComparison.changedPercent == null ? "" : ` (${result.visualComparison.changedPercent}% changed)`}`);
    }
    if (result.accessibility.length) {
      lines.push("", "Accessibility findings:", "");
      for (const violation of result.accessibility) {
        lines.push(`- **${violation.impact || "unknown"}** ${violation.id}: ${violation.help} (${violation.nodes.length})`);
      }
    }
    if (result.ergonomics.smallTargets.length) {
      lines.push("", `Small targets below ${result.ergonomics.smallTargetFloor}px (first 12):`, "");
      for (const target of result.ergonomics.smallTargets.slice(0, 12)) {
        lines.push(`- \`${target.selector}\` ${target.width}×${target.height}${target.label ? ` — ${target.label}` : ""}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const outputDir = path.resolve(options.output);
  const compareDir = options.compare ? path.resolve(options.compare) : "";
  await fs.mkdir(outputDir, { recursive: true });
  const credentials = await readCredentials(options.credentials);
  const browser = await chromium.launch({ headless: !options.headed });

  try {
    const storageState = await signIn(browser, options.baseUrl, credentials, outputDir);
    const results = [];
    for (const viewport of DEFAULT_VIEWPORTS) {
      const context = await browser.newContext({ viewport, storageState, reducedMotion: "reduce" });
      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      const failedRequests = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500));
      });
      page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 500)));
      page.on("requestfailed", (request) => failedRequests.push({
        url: request.url(),
        error: request.failure()?.errorText || "failed",
      }));

      const url = new URL(options.route, options.baseUrl).toString();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await waitForStablePage(page);

      const viewportScreenshot = `${options.route.replaceAll("/", "-").replace(/^-/, "") || "home"}-${viewport.name}.png`;
      const fullScreenshot = `${options.route.replaceAll("/", "-").replace(/^-/, "") || "home"}-${viewport.name}-full.png`;
      await page.screenshot({ path: path.join(outputDir, viewportScreenshot), animations: "disabled" });
      await page.screenshot({ path: path.join(outputDir, fullScreenshot), fullPage: true, animations: "disabled" });

      const axe = await new AxeBuilder({ page }).analyze();
      const accessibility = axe.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        helpUrl: violation.helpUrl,
        nodes: violation.nodes.map((node) => node.target),
      }));
      const ergonomics = await collectErgonomics(page, viewport);
      const visualComparison = compareDir
        ? await compareImages(
          path.join(outputDir, viewportScreenshot),
          path.join(compareDir, viewportScreenshot),
          path.join(outputDir, `${viewport.name}-diff.png`),
        )
        : null;

      results.push({
        viewport,
        title: await page.title(),
        url: page.url(),
        screenshots: { viewport: viewportScreenshot, fullPage: fullScreenshot },
        accessibility,
        ergonomics,
        runtime: { consoleErrors, pageErrors, failedRequests },
        visualComparison,
      });
      await context.close();
    }

    const report = {
      generatedAt: new Date().toISOString(),
      baseUrl: options.baseUrl,
      route: options.route,
      results,
    };
    await fs.writeFile(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    await fs.writeFile(path.join(outputDir, "report.md"), markdownReport(report));
    process.stdout.write(`UX audit complete: ${path.join(outputDir, "report.md")}\n`);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
