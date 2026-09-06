import { chromium } from "@playwright/test";
const browser = await chromium.launch({ args: ["--use-gl=angle"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 160)));
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text().slice(0, 160)); });
await page.goto("http://localhost:3056/shared/-HkdxP030PKasLFN7PyDw-BsXrYffAlQVQLhijncJMw", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(4000);
// find the tour open affordance if the share shows a landing first
const bodyText = (await page.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\n/g, " | ");
console.log("BODY:", bodyText);
// look for the spinoff canvas
const status = await page.evaluate(() => {
  const canvases = [...document.querySelectorAll("canvas")];
  return canvases.map((c) => ({ w: c.width, h: c.height, status: c.dataset.spinoffStatus, backend: c.dataset.spinoffBackend, frame: c.dataset.spinoffFrame, splats: c.dataset.spinoffSplats }));
});
console.log("CANVASES:", JSON.stringify(status));
console.log("ERRORS so far:", JSON.stringify(errors.slice(0, 6)));
await browser.close();
