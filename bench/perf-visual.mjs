/**
 * Polycss visual-parity check — renders bench/perf-vanilla.html at 3 fixed
 * light azimuths, screenshots each frame, and compares against baselines in
 * `bench/baselines/`. Vanilla is the reference path; the html / react / vue
 * pages render through the same polycss core so a renderer-side bug shows
 * up here too.
 *
 * First run (no baseline yet): use --record to capture baselines.
 *   node scripts/perf-visual.mjs --record
 *
 * Normal run (after baseline exists):
 *   node scripts/perf-visual.mjs            → exit 0 if pass, 1 if fail
 *   node scripts/perf-visual.mjs --tolerance 0.005  → mean abs RGB delta cutoff
 *
 * Comparison metric: mean absolute per-channel difference across all
 * pixels, normalized to [0,1]. 0 = identical, ~0.05 = visible drift.
 * Default tolerance is 0.01 (≈ 1% mean drift, generous enough for
 * compositing differences but tight enough to catch real regressions).
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const benchDir = resolve(repoRoot, "bench");
const galleryDir = resolve(repoRoot, "website/public/gallery");
const baselinesDir = resolve(repoRoot, "bench/baselines");

const argv = process.argv.slice(2);
const flag = (name) => argv.indexOf(`--${name}`);
const optStr = (name, dflt = "") => {
  const i = flag(name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const optNum = (name, dflt) => {
  const v = optStr(name);
  return v ? Number(v) : dflt;
};
const hasFlag = (name) => flag(name) >= 0;

const RECORD = hasFlag("record");
const TOLERANCE = optNum("tolerance", 0.01);
const MODE = optStr("mode", "dynamic");
const HEADED = hasFlag("headed");
// Two meshes that exercise different render paths:
//   chicken — flat-color MTL materials (no map_Kd) → polygon path with
//             cascade-driven CSS colors
//   rock1   — UV-textured MTL (map_Kd rock1-surface.jpg) → atlas path
//             with bitmap-clipped <i> backgrounds
// Both are small (~hundreds of polys) so the headless run stays fast.
// Override with `--mesh <id>` to record/check a single mesh.
const MESHES = optStr("mesh") ? [optStr("mesh")] : ["chicken", "rock1"];
const FRAMES = [
  { name: "az0",   az: 0   },
  { name: "az120", az: 120 },
  { name: "az240", az: 240 },
];

// ── tiny static server (same as perf-bench.mjs) ─────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".obj":  "text/plain; charset=utf-8",
  ".mtl":  "text/plain; charset=utf-8",
  ".png":  "image/png",
  ".gltf": "application/json; charset=utf-8",
  ".glb":  "model/gltf-binary",
};
function startServer() {
  return new Promise((res) => {
    const server = createServer(async (req, response) => {
      try {
        const u = new URL(req.url, "http://localhost");
        const safe = u.pathname.replace(/\/+/g, "/");
        if (safe.includes("..")) { response.writeHead(403); return response.end(); }
        let abs;
        if (safe === "/" || safe === "") abs = resolve(benchDir, "perf-vanilla.html");
        else if (safe.startsWith("/gallery/")) abs = resolve(galleryDir, safe.slice("/gallery/".length));
        else abs = resolve(benchDir, safe.slice(1));
        const data = await readFile(abs);
        response.writeHead(200, { "Content-Type": MIME[extname(abs).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
        response.end(data);
      } catch (err) {
        response.writeHead(404); response.end(String(err?.message ?? err));
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      res({ server, port: typeof addr === "object" ? addr.port : 0 });
    });
  });
}

// ── PNG decoding via OffscreenCanvas in the headless browser is one
//    option; we go simpler — use Node's built-in `node:zlib` + minimal
//    PNG IDAT parsing. To keep this script dep-free we shell out the
//    pixel comparison to the browser context: load both PNGs as data URLs
//    on a hidden canvas and compute the mean abs RGB delta there. ──────
async function meanAbsDelta(page, baselinePath, candidateBuf) {
  const baselineBuf = readFileSync(baselinePath);
  const baselineB64 = baselineBuf.toString("base64");
  const candidateB64 = candidateBuf.toString("base64");
  return await page.evaluate(async ({ a, b }) => {
    async function load(b64) {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const cv = document.createElement("canvas");
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const ctx = cv.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, cv.width, cv.height);
    }
    const [imgA, imgB] = await Promise.all([load(a), load(b)]);
    if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
      return { ok: false, reason: "size", a: [imgA.width, imgA.height], b: [imgB.width, imgB.height] };
    }
    const dataA = imgA.data;
    const dataB = imgB.data;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < dataA.length; i += 4) {
      sum += Math.abs(dataA[i]   - dataB[i]);
      sum += Math.abs(dataA[i+1] - dataB[i+1]);
      sum += Math.abs(dataA[i+2] - dataB[i+2]);
      count += 3;
    }
    return { ok: true, mean_delta: (sum / count) / 255 };
  }, { a: baselineB64, b: candidateB64 });
}

(async () => {
  const { server, port } = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: !HEADED });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();

    if (RECORD) mkdirSync(baselinesDir, { recursive: true });

    let allPass = true;
    const report = [];
    for (const mesh of MESHES) for (const f of FRAMES) {
      const url = `http://127.0.0.1:${port}/?mesh=${mesh}&mode=${MODE}&motion=none&az=${f.az}&el=45`;
      await page.goto(url, { waitUntil: "load" });
      await page.waitForFunction(() => window.__perf__?.ready === true, null, { timeout: 30000 });
      // Wait until the atlas blob URLs are actually applied — scene.add()
      // is sync but atlas building is async (canvas → blob URL). Polygons
      // stay opacity:0 with no background-image until the atlas is ready;
      // screenshotting before then captures an empty viewport even though
      // __perf__.ready is true (this is the bug that produced the empty
      // az120 baseline previously). Some polys may be display:none (cull)
      // and never get a backgroundImage, so we just check that at least
      // one is set — atlas pages share the same blob URL across all polys
      // assigned to the same page, so a single set means the atlas is up.
      await page.waitForFunction(() => {
        const polys = document.querySelectorAll(".polycss-scene i");
        if (polys.length === 0) return false;
        for (const el of polys) {
          if (el.style.backgroundImage) return true;
        }
        return false;
      }, null, { timeout: 5000 });
      // Tiny settle so the first paint after backgroundImage assignment
      // has actually composed.
      await page.waitForTimeout(150);
      const screenshot = await page.screenshot({ fullPage: false });

      const baselinePath = resolve(baselinesDir, `${mesh}-${MODE}-${f.name}.png`);
      if (RECORD) {
        writeFileSync(baselinePath, screenshot);
        report.push({ mesh, frame: f.name, recorded: baselinePath });
        continue;
      }
      if (!existsSync(baselinePath)) {
        report.push({ mesh, frame: f.name, ok: false, reason: "missing baseline; run with --record" });
        allPass = false;
        continue;
      }
      const cmp = await meanAbsDelta(page, baselinePath, screenshot);
      if (!cmp.ok) {
        report.push({ mesh, frame: f.name, ok: false, reason: cmp.reason });
        allPass = false;
        continue;
      }
      const pass = cmp.mean_delta <= TOLERANCE;
      report.push({ mesh, frame: f.name, ok: pass, mean_delta: +cmp.mean_delta.toFixed(5) });
      if (!pass) allPass = false;
    }

    await ctx.close();
    console.log(JSON.stringify({ tolerance: TOLERANCE, pass: allPass, frames: report }, null, 2));
    process.exit(allPass || RECORD ? 0 : 1);
  } finally {
    if (browser) await browser.close();
    await new Promise((r) => server.close(() => r()));
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
