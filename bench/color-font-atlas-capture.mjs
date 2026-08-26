// Capture real per-cell (glyph, colour) buffers from the live site's SPANS
// render, for three scenes, as JSON — the input the quantization quality gate
// (`color-font-atlas-quantize.mjs`) measures. Nothing here quantizes; it only
// records what the shipped span encoder actually put on screen, so the gate is
// comparing against real renders rather than synthesized ramps.
//
// Runs HEADED against the user's real Chrome (`channel: "chrome"`; the bundled
// chromium is not installed), closes stray pages, and closes the browser on
// every exit path — same discipline as `bench/color-font-atlas.md`'s drivers.
//
// Needs the website dev server up:
//   pnpm --filter @glyphcss/website dev        # http://localhost:4323
//   node bench/color-font-atlas-capture.mjs bench/color-font-atlas-frames.json
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
import { writeFileSync } from "node:fs";

const BASE = "http://localhost:4323";
const OUT = process.argv[2] ?? "frames.json";
const IMAGE = new URL("../website/public/layoutit-terra.png", import.meta.url).pathname;

const EXTRACT = `(() => {
  const pre = document.querySelector("pre.glyph-output") || document.querySelector("pre");
  if (!pre) return null;
  const lines = [[]];
  let row = lines[0];
  const rgbToHex = (c) => {
    const m = /^rgb\\((\\d+),\\s*(\\d+),\\s*(\\d+)\\)$/.exec(c);
    if (!m) return c.startsWith("#") ? c.toLowerCase() : null;
    const h = (n) => Number(n).toString(16).padStart(2, "0");
    return "#" + h(m[1]) + h(m[2]) + h(m[3]);
  };
  const visit = (node, color) => {
    if (node.nodeType === 3) {
      for (const ch of (node.nodeValue ?? "")) {
        if (ch === "\\n") { row = []; lines.push(row); } else row.push([ch, color]);
      }
      return;
    }
    if (node.nodeType === 1) {
      const next = node.style && node.style.color ? rgbToHex(node.style.color) : color;
      node.childNodes.forEach((c) => visit(c, next));
    }
  };
  pre.childNodes.forEach((c) => visit(c, null));
  let cols = 0;
  for (const r of lines) if (r.length > cols) cols = r.length;
  const rows = lines.length;
  if (!cols || !rows) return null;
  const chars = [];
  const colors = [];
  for (const r of lines) {
    for (let c = 0; c < cols; c++) {
      const cell = r[c];
      const ch = cell ? cell[0] : " ";
      chars.push(ch);
      colors.push(ch === " " ? null : (cell[1] ?? null));
    }
  }
  return { cols, rows, chars: chars.join(""), colors, spans: pre.querySelectorAll("span").length };
})()`;

async function capture(page, count, gapMs) {
  const frames = [];
  for (let i = 0; i < count; i++) {
    const f = await page.evaluate(EXTRACT);
    if (f) frames.push(f);
    await page.waitForTimeout(gapMs);
  }
  return frames;
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: false });
  let ctx, page;
  try {
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await ctx.newPage();
    ctx.on("page", (pg) => { if (pg !== page) pg.close().catch(() => {}); });

    const out = {};

    // 1. Lambert-shaded 3D — the Parthenon example (continuous stone shading).
    await page.goto(`${BASE}/examples/parthenon/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(4000);
    out.parthenon = await capture(page, 20, 150);

    // 2. Photo — the image example, real photo dropped through its own input.
    await page.goto(`${BASE}/examples/image/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.setInputFiles('input[type="file"]', IMAGE);
    await page.waitForTimeout(4000);
    out.image = await capture(page, 20, 150);

    // 3. Field-synth — /synth's default patch, effect clock running.
    await page.goto(`${BASE}/synth/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(4000);
    out.synth = await capture(page, 20, 150);

    writeFileSync(OUT, JSON.stringify(out));
    for (const [k, v] of Object.entries(out)) {
      const f = v[0];
      console.log(k, "frames:", v.length, f ? `${f.cols}x${f.rows} spans=${f.spans} distinct=${new Set(f.colors.filter(Boolean)).size}` : "EMPTY");
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
