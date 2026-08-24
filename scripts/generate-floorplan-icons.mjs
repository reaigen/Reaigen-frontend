// Emit public/floorplan-icons/*.svg from app/lib/floorplan-icon-shapes.ts.
// Every file shares one physical stroke width (2 cm at metre scale), so the
// whole set keeps the same line. Run: node scripts/generate-floorplan-icons.mjs
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const STROKE_W = 0.02; // metres
const MARGIN = 0.04; // metres of breathing room around the footprint

const work = mkdtempSync(join(tmpdir(), "fp-icons-"));
writeFileSync(join(work, "shapes.ts"), readFileSync(join(repo, "app/lib/floorplan-icon-shapes.ts"), "utf8"));
execSync(`${join(repo, "node_modules/.bin/tsc")} --target es2022 --module es2022 --moduleResolution bundler shapes.ts`, { cwd: work });
const { FURNITURE_ICONS } = await import(join(work, "shapes.js"));
rmSync(work, { recursive: true, force: true });

const num = (v) => Number(v.toFixed(4));
const attr = (o) => Object.entries(o)
  .map(([k, v]) => `${k}="${typeof v === "number" ? num(v) : v}"`)
  .join(" ");

function shapeSvg(s) {
  const fill = s.fill ? { fill: "white" } : {};
  switch (s.t) {
    case "rect":
      return `<rect ${attr({ x: s.x, y: s.y, width: s.w, height: s.h, ...(s.rx ? { rx: s.rx } : {}), ...fill })}/>`;
    case "circle":
      return `<circle ${attr({ cx: s.cx, cy: s.cy, r: s.r, ...fill })}/>`;
    case "ellipse":
      return `<ellipse ${attr({ cx: s.cx, cy: s.cy, rx: s.rx, ry: s.ry, ...fill })}/>`;
    case "line":
      return `<line ${attr({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 })}/>`;
    case "path":
      return `<path ${attr({ d: s.d, ...fill })}/>`;
  }
}

const outDir = join(repo, "public/floorplan-icons");
mkdirSync(outDir, { recursive: true });
for (const [name, icon] of Object.entries(FURNITURE_ICONS)) {
  const hw = icon.w / 2 + MARGIN;
  const hd = icon.d / 2 + MARGIN;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(-hw)} ${num(-hd)} ${num(2 * hw)} ${num(2 * hd)}" ` +
      `fill="none" stroke="#111111" stroke-width="${STROKE_W}" stroke-linecap="round" stroke-linejoin="round">`,
    ...icon.shapes.map(shapeSvg),
    `</svg>`,
    ``,
  ].join("\n");
  writeFileSync(join(outDir, `${name}.svg`), svg);
  console.log(`${name}.svg  (${icon.w} × ${icon.d} m)`);
}
