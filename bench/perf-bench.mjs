/**
 * Polycss perf bench — drives bench/perf.html via headless Chromium and
 * dumps FPS / frame-time stats for the scenario matrix in
 * OPTIMIZATION_PLAN.md.
 *
 * Usage:
 *   node scripts/perf-bench.mjs                 → run full matrix, print to stdout
 *   node scripts/perf-bench.mjs --label foo     → also write bench/results/foo.json
 *   node scripts/perf-bench.mjs --warmup 1500   → custom warmup ms (default 2000)
 *   node scripts/perf-bench.mjs --sample 5000   → sample window ms (default 5000)
 *   node scripts/perf-bench.mjs --mesh chicken  → swap mesh
 *   node scripts/perf-bench.mjs --headed        → open a real browser window
 *
 * Each invocation starts its own static server on an ephemeral OS-assigned
 * port so multiple instances can run in parallel without coordination.
 *
 * Output JSON shape — see OPTIMIZATION_PLAN.md "Bench script" section.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const benchDir = resolve(repoRoot, "bench");
const galleryDir = resolve(repoRoot, "website/public/gallery");

// ── argv ────────────────────────────────────────────────────────────────
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

const LABEL = optStr("label");
const WARMUP_MS = optNum("warmup", 2000);
const SAMPLE_MS = optNum("sample", 5000);
const MESH = optStr("mesh", "saucer");
const HEADED = hasFlag("headed");
// Filter renderer paths via --renderer html,vanilla,react,vue (default: all).
const RENDERERS = optStr("renderer", "html,vanilla,react,vue").split(",").map((s) => s.trim()).filter(Boolean);

// Scenario matrix. baked + light is intentionally excluded — atlas
// re-rasterizes every frame, no point measuring it. Five base scenarios
// (static floor + camera motion + light motion across both lighting modes)
// run for each renderer path → renderer × mode × motion = 5 × N rows.
const BASE_SCENARIOS = [
  { mode: "dynamic", motion: "none",  key: "dynamic.static" },
  { mode: "dynamic", motion: "light", key: "dynamic.light_rotate" },
  { mode: "dynamic", motion: "rot",   key: "dynamic.camera_rotate" },
  { mode: "baked",   motion: "none",  key: "baked.static" },
  { mode: "baked",   motion: "rot",   key: "baked.camera_rotate" },
];
const SCENARIOS = RENDERERS.flatMap((renderer) =>
  BASE_SCENARIOS.map((s) => ({ ...s, renderer, key: `${renderer}.${s.key}` })),
);

// ── tiny static server (mirrors scripts/perf-serve.mjs but on
//    ephemeral port, awaitable, awaitable shutdown) ─────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".obj":  "text/plain; charset=utf-8",
  ".mtl":  "text/plain; charset=utf-8",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gltf": "application/json; charset=utf-8",
  ".glb":  "model/gltf-binary",
};

function startServer() {
  return new Promise((resolveStart, rejectStart) => {
    const server = createServer(async (req, res) => {
      try {
        const u = new URL(req.url, `http://localhost`);
        const safe = u.pathname.replace(/\/+/g, "/");
        if (safe.includes("..")) { res.writeHead(403); return res.end(); }
        let abs;
        if (safe === "/" || safe === "") abs = resolve(benchDir, "perf.html");
        else if (safe.startsWith("/gallery/")) abs = resolve(galleryDir, safe.slice("/gallery/".length));
        else abs = resolve(benchDir, safe.slice(1));
        const data = await readFile(abs);
        res.writeHead(200, {
          "Content-Type": MIME[extname(abs).toLowerCase()] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        res.end(data);
      } catch (err) {
        res.writeHead(404);
        res.end(String(err?.message ?? err));
      }
    });
    server.on("error", rejectStart);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolveStart({ server, port: typeof addr === "object" ? addr.port : 0 });
    });
  });
}

function stopServer(server) {
  return new Promise((res) => server.close(() => res()));
}

// ── stats helpers ──────────────────────────────────────────────────────
function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function summarizeFrameTimes(dts, rawCount) {
  const sample_count_raw = rawCount ?? dts.length;
  if (dts.length === 0) return { fps_p50: 0, fps_p95: 0, frame_time_p50_ms: 0, frame_time_p95_ms: 0, frame_time_p99_ms: 0, sample_count: 0, sample_count_raw, sample_count_filtered: sample_count_raw, is_bimodal: false };
  const sorted = [...dts].sort((a, b) => a - b);
  const p50 = quantile(sorted, 0.5);
  const p95 = quantile(sorted, 0.95);
  const p99 = quantile(sorted, 0.99);
  // Bimodal flag: most frames fast (low p50) but a few very slow frames
  // dominate the tail (p99 ≥ 5× p50). Catches the iter-9 H24 / iter-13 H36
  // failure mode where p50=120fps masks ~150ms periodic stalls. Requires
  // p50 < 25 ms (fast median) AND p99 ≥ 5× p50 (long tail) — avoids false
  // positives on uniformly-slow scenarios where p50=p99=large.
  const is_bimodal = p50 < 25 && p99 >= p50 * 5;
  return {
    fps_p50: 1000 / p50,
    fps_p95: 1000 / p95,
    frame_time_p50_ms: p50,
    frame_time_p95_ms: p95,
    frame_time_p99_ms: p99,
    sample_count: dts.length,
    sample_count_raw,
    sample_count_filtered: sample_count_raw - dts.length,
    is_bimodal,
  };
}

// ── main ───────────────────────────────────────────────────────────────
// Each scenario gets a FRESH browser instance to prevent GPU/render-pipeline
// resource exhaustion from accumulating across scenarios. With a single shared
// browser, headless Chromium stops dispatching rAF callbacks after ~2–3
// intensive 4k-element animation sessions, causing the 7th scenario (auto) to
// always report 0 samples even though the code is correct. Launching a new
// browser per scenario adds ~1–2 s per scenario but eliminates false-zero
// sample counts (the bug that appeared as the H32 "auto-mode race").
async function runScenario(port, scenario) {
  const browser = await chromium.launch({ headless: !HEADED });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const url = `http://127.0.0.1:${port}/perf-${scenario.renderer}.html?mesh=${MESH}&mode=${scenario.mode}&motion=${scenario.motion}`;

    await page.goto(url, { waitUntil: "load" });
    // Wait for the perf page to mount the scene + flag itself ready.
    await page.waitForFunction(() => window.__perf__?.ready === true, null, { timeout: 30000 });

    // Warmup: let the renderer settle and atlas blob URLs resolve.
    await page.waitForTimeout(WARMUP_MS);

    // Snapshot sample-list length so we can take a delta after SAMPLE_MS.
    const startIdx = await page.evaluate(() => window.__perf__.samples.length);
    await page.waitForTimeout(SAMPLE_MS);
    const samples = await page.evaluate((from) => window.__perf__.samples.slice(from), startIdx);
    const polyCount = await page.evaluate(() => window.__perf__.polyCount);
    const domNodes = await page.evaluate(() => document.querySelectorAll(".polycss-scene i").length);

    await ctx.close();

    // Drop only genuine page-pause / tab-hidden events (≥2000 ms). A 200 ms
    // hard cutoff was silently destroying samples for scenarios that genuinely
    // run at 2–5 fps (e.g. camera_rotate, quantized animations). A 2000 ms
    // threshold still catches browser-tab-switch pauses (which always produce
    // ≥1000 ms gaps) while retaining all slow-but-valid frames.
    const rawDts = samples.map((s) => s.dt).filter((dt) => dt > 0);
    const dts = rawDts.filter((dt) => dt < 2000);
    return { ...summarizeFrameTimes(dts, rawDts.length), polyCount, domNodes };
  } finally {
    await browser.close();
  }
}

(async () => {
  console.log(`[bench] mesh=${MESH} warmup=${WARMUP_MS}ms sample=${SAMPLE_MS}ms`);

  const { server, port } = await startServer();
  console.log(`[bench] server :${port}`);

  try {
    const results = {};
    let polyCount = 0;
    let domNodes = 0;
    let lastRenderer = null;
    for (const sc of SCENARIOS) {
      if (sc.renderer !== lastRenderer) {
        if (lastRenderer !== null) process.stdout.write("\n");
        process.stdout.write(`── ${sc.renderer} ──\n`);
        lastRenderer = sc.renderer;
      }
      // Strip the renderer prefix from the displayed key so it lines up
      // (full key still goes into JSON for grep-ability).
      const displayKey = sc.key.slice(sc.renderer.length + 1);
      process.stdout.write(`  ${displayKey.padEnd(28)}`);
      const r = await runScenario(port, sc);
      polyCount = r.polyCount;
      domNodes = r.domNodes;
      // JSON nests as results[renderer][groupKey][leaf] for natural
      // per-renderer subtotals.
      const [, groupKey, leaf] = sc.key.split(".");
      results[sc.renderer] ??= {};
      results[sc.renderer][groupKey] ??= {};
      results[sc.renderer][groupKey][leaf] = {
        fps_p50: +r.fps_p50.toFixed(2),
        fps_p95: +r.fps_p95.toFixed(2),
        frame_time_p99_ms: +r.frame_time_p99_ms.toFixed(2),
        sample_count: r.sample_count,
        sample_count_raw: r.sample_count_raw,
        sample_count_filtered: r.sample_count_filtered,
        is_bimodal: r.is_bimodal,
      };
      const filterNote = r.sample_count_filtered > 0 ? ` [${r.sample_count_filtered} outliers dropped]` : "";
      const bimodalNote = r.is_bimodal ? `  ⚠ BIMODAL (p99 ${(r.frame_time_p99_ms / r.frame_time_p50_ms).toFixed(1)}× p50 — periodic stalls hiding behind a fast median)` : "";
      process.stdout.write(`p50=${r.fps_p50.toFixed(1).padStart(5)}fps  p95=${r.fps_p95.toFixed(1).padStart(5)}fps  p99=${r.frame_time_p99_ms.toFixed(1).padStart(5)}ms  (${r.sample_count}/${r.sample_count_raw} samples${filterNote})${bimodalNote}\n`);
    }
    const out = {
      mesh: MESH,
      polyCount, domNodes,
      warmup_ms: WARMUP_MS, sample_ms: SAMPLE_MS,
      ...results,
    };

    if (LABEL) {
      const dir = resolve(repoRoot, "bench/results");
      mkdirSync(dir, { recursive: true });
      const file = resolve(dir, `${LABEL}.json`);
      writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
      console.log(`[bench] wrote ${file}`);
    }
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await stopServer(server);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
