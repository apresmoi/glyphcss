// Verify both export strategies render + animate in headless Chromium.
// Screenshots two frames ~1.5s apart, reports a frame-diff, and for Strategy B
// proves it renders+animates with ALL network blocked (offline).
//
// Screenshots are written next to this file under ./shots/.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(here, "out");
const OUT = resolve(here, "shots");
mkdirSync(OUT, { recursive: true });

// crude byte-level diff of two PNG buffers — enough to prove "the frame changed".
function pngDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let diff = 0;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) diff++;
  return diff / n + Math.abs(a.length - b.length) / Math.max(a.length, b.length);
}

async function shoot(page, file, tag, { offline = false, blockNet = false } = {}) {
  if (blockNet) {
    await page.route("**/*", (route) => {
      const u = route.request().url();
      if (u.startsWith("file://") || u === "about:blank") return route.continue();
      return route.abort();
    });
  }
  if (offline) await page.context().setOffline(true);
  const requests = [];
  page.on("request", (r) => { if (!r.url().startsWith("file://")) requests.push(r.url()); });
  await page.goto("file://" + resolve(DIR, file));
  await page.waitForTimeout(400);
  const s1 = await page.screenshot();
  writeFileSync(resolve(OUT, `${tag}-1.png`), s1);
  await page.waitForTimeout(1500);
  const s2 = await page.screenshot();
  writeFileSync(resolve(OUT, `${tag}-2.png`), s2);
  const glyphs = await page.evaluate(() => {
    const el = document.querySelector("#g, .glyph-output");
    const txt = (el?.textContent || "");
    return [...txt].filter((c) => c !== " " && c !== "\n").length;
  });
  const d = pngDiff(s1, s2);
  console.log(`[${tag}] glyphs=${glyphs}  frameDiff=${(d * 100).toFixed(2)}%  offRequests=${requests.length}`);
  return { glyphs, diff: d, requests };
}

const browser = await chromium.launch();
const view = { viewport: { width: 900, height: 500 } };

const pA = await browser.newPage(view);
const rA = await shoot(pA, "strategyA-24.html", "A");
await pA.close();

const pB = await browser.newPage(view);
const rB = await shoot(pB, "strategyB.html", "B");
await pB.close();

const pBoff = await browser.newPage(view);
const rBoff = await shoot(pBoff, "strategyB.html", "B-offline", { offline: true, blockNet: true });
await pBoff.close();

await browser.close();

console.log("\nVERDICT:", JSON.stringify({
  A_renders: rA.glyphs > 500,
  A_animates: rA.diff > 0.002,
  B_renders: rB.glyphs > 500,
  B_animates: rB.diff > 0.002,
  B_offline_renders: rBoff.glyphs > 500,
  B_offline_animates: rBoff.diff > 0.002,
  B_offline_zero_requests: rBoff.requests.length === 0,
}, null, 2));
