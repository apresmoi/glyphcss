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
 *   node scripts/perf-bench.mjs --chromium-arg "--enable-blink-features=CSSBorderShape"
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
const optAll = (name) => {
  const values = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === `--${name}` && argv[i + 1]) {
      values.push(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith(`--${name}=`)) {
      values.push(arg.slice(name.length + 3));
    }
  }
  return values;
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
const TRACE = hasFlag("trace");
const BROWSER_EXECUTABLE = optStr("browser-executable");
const CHROMIUM_ARGS = [
  ...optAll("chromium-arg"),
  ...optAll("chromium-args").flatMap((value) => value.split(/\s+/).filter(Boolean)),
];
// Filter renderer paths via --renderer html,vanilla,react,vue (default: all).
const RENDERERS = optStr("renderer", "html,vanilla,react,vue").split(",").map((s) => s.trim()).filter(Boolean);
// Filter scenarios via --scenario dynamic.camera_rotate,baked.camera_rotate
// (default: all five base scenarios).
const SCENARIO_FILTER = new Set(
  optStr("scenario")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

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
  BASE_SCENARIOS
    .filter((s) => SCENARIO_FILTER.size === 0 || SCENARIO_FILTER.has(s.key))
    .map((s) => ({ ...s, renderer, key: `${renderer}.${s.key}` })),
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

function metricMap(metrics) {
  const out = new Map();
  for (const metric of metrics?.metrics ?? []) out.set(metric.name, metric.value);
  return out;
}

function diffPerformanceMetrics(before, after) {
  const a = metricMap(before);
  const b = metricMap(after);
  const keys = [
    "Timestamp",
    "Documents",
    "Frames",
    "JSEventListeners",
    "Nodes",
    "LayoutCount",
    "RecalcStyleCount",
    "LayoutDuration",
    "RecalcStyleDuration",
    "ScriptDuration",
    "TaskDuration",
    "JSHeapUsedSize",
    "JSHeapTotalSize",
  ];
  const out = {};
  for (const key of keys) {
    const beforeValue = a.get(key);
    const afterValue = b.get(key);
    if (beforeValue === undefined || afterValue === undefined) continue;
    const value = key === "Timestamp" || key === "Documents" || key === "Frames" ||
      key === "JSEventListeners" || key === "Nodes" ||
      key === "JSHeapUsedSize" || key === "JSHeapTotalSize"
      ? afterValue
      : afterValue - beforeValue;
    out[key] = Number(value.toFixed(key.endsWith("Duration") ? 6 : 3));
  }
  return out;
}

function summarizeTraceEvents(events) {
  const byName = new Map();
  let completeEventCount = 0;
  let totalDurationUs = 0;
  for (const event of events) {
    if (event?.ph !== "X" || typeof event.dur !== "number") continue;
    completeEventCount += 1;
    totalDurationUs += event.dur;
    const prev = byName.get(event.name) ?? { count: 0, durationUs: 0 };
    prev.count += 1;
    prev.durationUs += event.dur;
    byName.set(event.name, prev);
  }

  const get = (...names) => {
    let count = 0;
    let durationUs = 0;
    for (const name of names) {
      const entry = byName.get(name);
      if (!entry) continue;
      count += entry.count;
      durationUs += entry.durationUs;
    }
    return { count, duration_ms: +(durationUs / 1000).toFixed(3) };
  };

  const topEvents = [...byName.entries()]
    .sort((a, b) => b[1].durationUs - a[1].durationUs)
    .slice(0, 16)
    .map(([name, entry]) => ({
      name,
      count: entry.count,
      duration_ms: +(entry.durationUs / 1000).toFixed(3),
    }));

  return {
    eventCount: events.length,
    completeEventCount,
    totalCompleteDurationMs: +(totalDurationUs / 1000).toFixed(3),
    groups: {
      style: get("UpdateLayoutTree", "RecalculateStyles"),
      layout: get("Layout"),
      prePaint: get("PrePaint"),
      paint: get("Paint"),
      composite: get("CompositeLayers", "Layerize", "UpdateLayerTree", "Commit", "ActivateLayerTree"),
      raster: get("RasterTask", "ImageDecodeTask", "Decode Image"),
      script: get("FunctionCall", "EvaluateScript", "EventDispatch", "TimerFire", "FireAnimationFrame"),
    },
    topEvents,
  };
}

async function startTrace(cdp) {
  const events = [];
  cdp.on("Tracing.dataCollected", (payload) => {
    if (Array.isArray(payload.value)) events.push(...payload.value);
  });
  await cdp.send("Performance.enable");
  await cdp.send("Tracing.start", {
    transferMode: "ReportEvents",
    categories: [
      "devtools.timeline",
      "disabled-by-default-devtools.timeline",
      "blink",
      "cc",
      "gpu",
      "renderer.scheduler",
    ].join(","),
  });
  return events;
}

async function stopTrace(cdp, events) {
  const done = new Promise((resolve) => {
    cdp.once("Tracing.tracingComplete", resolve);
  });
  await cdp.send("Tracing.end");
  await done;
  return summarizeTraceEvents(events);
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
  const launchOptions = { headless: !HEADED, args: CHROMIUM_ARGS };
  if (BROWSER_EXECUTABLE) launchOptions.executablePath = BROWSER_EXECUTABLE;
  const browser = await chromium.launch(launchOptions);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const url = `http://127.0.0.1:${port}/perf-${scenario.renderer}.html?mesh=${MESH}&mode=${scenario.mode}&motion=${scenario.motion}`;

    await page.goto(url, { waitUntil: "load" });
    // Wait for the perf page to mount the scene + flag itself ready.
    await page.waitForFunction(() => window.__perf__?.ready === true, null, { timeout: 30000 });

    // Warmup: let the renderer settle and atlas blob URLs resolve.
    await page.waitForTimeout(WARMUP_MS);
    const cdp = TRACE ? await ctx.newCDPSession(page) : null;
    let traceEvents = null;
    let metricsBefore = null;
    if (cdp) {
      traceEvents = await startTrace(cdp);
      metricsBefore = await cdp.send("Performance.getMetrics");
    }

    // Snapshot sample-list length so we can take a delta after SAMPLE_MS.
    const startIdx = await page.evaluate(() => window.__perf__.samples.length);
    await page.waitForTimeout(SAMPLE_MS);
    const metricsAfter = cdp ? await cdp.send("Performance.getMetrics") : null;
    const trace = cdp ? await stopTrace(cdp, traceEvents) : null;
    const pageResult = await page.evaluate((from) => ({
      samples: window.__perf__.samples.slice(from),
      polyCount: window.__perf__.polyCount,
      renderStats: window.__perf__.renderStats ?? null,
    }), startIdx);

    await ctx.close();

    // Drop only genuine page-pause / tab-hidden events (≥2000 ms). A 200 ms
    // hard cutoff was silently destroying samples for scenarios that genuinely
    // run at 2–5 fps (e.g. camera_rotate, quantized animations). A 2000 ms
    // threshold still catches browser-tab-switch pauses (which always produce
    // ≥1000 ms gaps) while retaining all slow-but-valid frames.
    const rawDts = pageResult.samples.map((s) => s.dt).filter((dt) => dt > 0);
    const dts = rawDts.filter((dt) => dt < 2000);
    return {
      ...summarizeFrameTimes(dts, rawDts.length),
      polyCount: pageResult.polyCount,
      renderStats: pageResult.renderStats,
      trace,
      performanceMetrics: metricsBefore && metricsAfter
        ? diffPerformanceMetrics(metricsBefore, metricsAfter)
        : null,
    };
  } finally {
    await browser.close();
  }
}

(async () => {
  console.log(`[bench] mesh=${MESH} warmup=${WARMUP_MS}ms sample=${SAMPLE_MS}ms`);
  if (BROWSER_EXECUTABLE) console.log(`[bench] browser=${BROWSER_EXECUTABLE}`);
  if (CHROMIUM_ARGS.length > 0) console.log(`[bench] chromium args=${CHROMIUM_ARGS.join(" ")}`);
  if (SCENARIO_FILTER.size > 0) console.log(`[bench] scenarios=${[...SCENARIO_FILTER].join(",")}`);
  if (TRACE) console.log("[bench] trace=on");

  const { server, port } = await startServer();
  console.log(`[bench] server :${port}`);

  try {
    const results = {};
    let polyCount = 0;
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
        renderStats: r.renderStats,
        trace: r.trace,
        performanceMetrics: r.performanceMetrics,
      };
      const filterNote = r.sample_count_filtered > 0 ? ` [${r.sample_count_filtered} outliers dropped]` : "";
      const bimodalNote = r.is_bimodal ? `  ⚠ BIMODAL (p99 ${(r.frame_time_p99_ms / r.frame_time_p50_ms).toFixed(1)}× p50 — periodic stalls hiding behind a fast median)` : "";
      const tags = r.renderStats?.dom?.tags;
      const tagNote = tags ? `  tags b/i/s/u/q=${tags.b}/${tags.i}/${tags.s}/${tags.u}/${tags.q}` : "";
      const styleNote = typeof r.renderStats?.dom?.inlineStyleChars === "number"
        ? `  styles=${r.renderStats.dom.inlineStyleChars}`
        : "";
      const borderShape = r.renderStats?.support?.borderShape;
      const supportNote = typeof borderShape === "boolean" ? `  borderShape=${borderShape ? "yes" : "no"}` : "";
      const traceNote = r.trace?.groups
        ? `  trace style/layout/paint/comp=${r.trace.groups.style.duration_ms.toFixed(1)}/${r.trace.groups.layout.duration_ms.toFixed(1)}/${r.trace.groups.paint.duration_ms.toFixed(1)}/${r.trace.groups.composite.duration_ms.toFixed(1)}ms`
        : "";
      process.stdout.write(`p50=${r.fps_p50.toFixed(1).padStart(5)}fps  p95=${r.fps_p95.toFixed(1).padStart(5)}fps  p99=${r.frame_time_p99_ms.toFixed(1).padStart(5)}ms  (${r.sample_count}/${r.sample_count_raw} samples${filterNote})${tagNote}${styleNote}${supportNote}${traceNote}${bimodalNote}\n`);
    }
    const out = {
      mesh: MESH,
      polyCount,
      browserExecutable: BROWSER_EXECUTABLE || null,
      chromiumArgs: CHROMIUM_ARGS,
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
