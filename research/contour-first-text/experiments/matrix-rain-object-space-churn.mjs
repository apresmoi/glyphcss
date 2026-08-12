// Browser proof for the matrix-rain `space:"object"` lane-boundary flicker
// fix (packages/effects/src/stock.ts, objectVolumetricAlongLane/edgeFade).
// Drives the REAL /wordart page (dev server on :4323, already running) with
// the paused (`fxp=1`) repro URL, drags the orbit control in small
// increments, and measures how much the rendered <pre> markup churns per
// step — with the fix live (HMR from packages/effects/src/stock.ts) and
// then with OBJECT_LANE_EDGE_MARGIN patched to 0 in place (simulating the
// pre-fix hard lane bucket), restoring the file afterward.
//
// Not a committed test — ad hoc measurement script, run manually:
//   node research/contour-first-text/experiments/matrix-rain-object-space-churn.mjs
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const REPRO_URL =
  "http://localhost:4323/wordart?text=Glyph%0ACSS&profile=flat&depth=10&color=%231d6b3a&side=%230f3a20&back=%230f3a20&curve=4&density=2.6&hl=hide&fx=matrix-rain&fxp=1&fxs=5.25&fxx=%7B%22glyphs%22%3A%22GLYPH01%22%2C%22space%22%3A%22object%22%2C%22speedMin%22%3A28.75%2C%22speedMax%22%3A36.25%2C%22trail%22%3A46%2C%22density%22%3A0.95%2C%22colorMode%22%3A%22monochrome%22%2C%22color%22%3A%22%231aa34a%22%2C%22headColor%22%3A%22%23baffd6%22%7D";

const STOCK_PATH = new URL(
  "../../../packages/effects/src/stock.ts",
  import.meta.url,
).pathname;

function cellSignature(html) {
  // Parse (glyph, color) pairs out of the rendered <pre> markup: colored runs
  // are `<span style="color:#rrggbb">text</span>`, uncolored runs are plain
  // text. Returns an array of per-character (char, color) tuples in document
  // order — a coarse but robust proxy for "what does each cell show".
  const out = [];
  const spanRe = /<span style="color:(#[0-9a-f]{6})">([^<]*)<\/span>|([^<]+)/gi;
  let m;
  while ((m = spanRe.exec(html))) {
    const color = m[1] ?? null;
    const text = m[2] ?? m[3] ?? "";
    for (const ch of text) {
      if (ch === "\n") continue;
      out.push(color ? `${ch}|${color}` : ch);
    }
  }
  return out;
}

function churnBetween(a, b) {
  const n = Math.min(a.length, b.length);
  let changed = 0;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) changed++;
  return { changed, total: n };
}

async function measureSweep(page, steps, dragPerStep) {
  const box = await page.locator("pre").first().boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const frames = [];
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  frames.push(cellSignature(await page.locator("pre").first().innerHTML()));
  for (let s = 0; s < steps; s++) {
    await page.mouse.move(cx + dragPerStep * (s + 1), cy, { steps: 4 });
    await page.waitForTimeout(60);
    frames.push(cellSignature(await page.locator("pre").first().innerHTML()));
  }
  await page.mouse.up();

  const perStep = [];
  for (let s = 1; s < frames.length; s++) {
    perStep.push(churnBetween(frames[s - 1], frames[s]));
  }
  return perStep;
}

async function run(label) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(REPRO_URL, { waitUntil: "networkidle" });
  await page.waitForSelector("pre");
  await page.waitForTimeout(500); // let HMR-applied source settle into a render

  const perStep = await measureSweep(page, 8, 3); // small drags: a few tenths of a degree per step
  const changedCounts = perStep.map((p) => p.changed);
  const mean = changedCounts.reduce((a, b) => a + b, 0) / changedCounts.length;
  console.log(`[${label}] per-step changed-char counts:`, changedCounts.join(","));
  console.log(`[${label}] mean changed chars/step:`, mean.toFixed(1), "of", perStep[0]?.total, "total chars");

  await browser.close();
  return { changedCounts, mean };
}

async function main() {
  console.log("=== AFTER (fix live) ===");
  const after = await run("after-fix");

  const original = readFileSync(STOCK_PATH, "utf8");
  const patched = original.replace(
    "const OBJECT_LANE_EDGE_MARGIN = 0.18;",
    "const OBJECT_LANE_EDGE_MARGIN = 0.0;",
  );
  if (patched === original) {
    console.error("Could not find OBJECT_LANE_EDGE_MARGIN = 0.18 to patch — aborting before-measurement.");
    process.exit(1);
  }
  writeFileSync(STOCK_PATH, patched);
  await new Promise((r) => setTimeout(r, 1500)); // let Vite HMR pick up the edit

  try {
    console.log("=== BEFORE (margin patched to 0, simulating pre-fix hard bucket) ===");
    await run("before-fix");
  } finally {
    writeFileSync(STOCK_PATH, original);
    await new Promise((r) => setTimeout(r, 1500)); // let HMR restore the real fix before exiting
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
