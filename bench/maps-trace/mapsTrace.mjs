#!/usr/bin/env node
/**
 * `/maps` CHROME TRACE harness — where a frame actually goes, per frame group.
 *
 * `bench/maps-render` answers "how many milliseconds, and did a pixel move".
 * It cannot answer "is the DOM the limit", because every number it reports is
 * taken from inside the page's own script: `base-raster` is glyphcss's probe,
 * `commit-write` is the gap between two of its own markers, and NEITHER can
 * see Style, Layout, PrePaint, Paint, raster, the compositor, or the GPU. A
 * frame that spends 9 ms in script and 20 ms in Paint reports as "9 ms of
 * base-raster, 99% of the frame" there and is wrong by a factor of three.
 *
 * This harness answers that question the only way it can be answered: CDP
 * `Tracing`, a `requestAnimationFrame` sampler, `performance.mark()` windows,
 * and per-frame attribution across Scripting / Style / Layout / PrePaint /
 * Paint / compositor-main / compositor-impl / raster / GPU. Method and event
 * groups are lifted from the `chrome-trace` skill
 * (`polycss/.agents/skills/chrome-trace`), which exists for exactly this
 * question; the runners there are polycss-specific, so the driving half is
 * `bench/maps-render`'s instead.
 *
 * **DO NOT DRAW CONCLUSIONS FROM FPS.** FPS is the symptom. The trace groups
 * are the explanation, and the whole point of this harness is that the two
 * disagree.
 *
 * Three things it adds on top of the skill's method, because the question is
 * about a polygon renderer and not about a CSS animation:
 *
 *  1. **glyphcss's own probes, inside the same window** — `__glyphPerf`
 *     (`raster` / `dom` / `polys` per base render), `__glyphPerfDetail`
 *     (`loop` = project+shade+scan-fill, `string` = the join), and the render
 *     STAGE markers `__glyphRenderStage` (`base-project` … `commit-write`,
 *     `detail-*`). Those are the script half; the trace groups are the rest.
 *     Reported side by side, never added together.
 *
 *  2. **A geometry CENSUS.** `scene.add` is wrapped as soon as the widget
 *     exists, so every mounted mesh is held with its polygon count and its
 *     transform. `census()` then re-runs, in page, the EXACT tests the solid
 *     rasterizer's own triangle loop runs (`render/rasterize.ts`): fan
 *     triangulation, the near-plane NaN count, the off-grid screen-box test,
 *     and the `area2 > 0` back-face test. That gives the triangle census —
 *     submitted / behind / off-grid / back-facing / drawn — for the LIVE
 *     camera, which is the only way to price what glyphcss's pre-projection
 *     back-face run rejection would have been worth in walk mode, where it
 *     DISABLES ITSELF because the camera is not affine.
 *
 *     The back-face and near-plane halves of that census are EXACT without
 *     knowing the projection metrics: `area2`'s sign is invariant under the
 *     positive per-axis scale and the translation that `cellWidth`,
 *     `cellHeight`, `centerCol` and `centerRow` apply. The off-grid half is
 *     not, so the metrics are reconstructed from the DOM the way
 *     `createGlyphScene`'s own `baseProjectionGrid()` builds them, and the
 *     reconstruction is checked against the camera target's projected cell
 *     before any number counts.
 *
 *  3. **A CPU profile pass** (`--profile`), through CDP `Profiler`, over the
 *     same motion. Self-time per function is what decomposes `base-raster`
 *     from the outside — `docs/design/performance.md` did it by
 *     short-circuiting the rasterizer at three points and rebuilding, which
 *     cannot be done without editing shipped render code. Run it against a
 *     DEV server (`pnpm dev:website`), where Vite serves unminified sources
 *     and the frames carry real function names; against `astro preview` the
 *     names are mangled and the pass reports so instead of guessing.
 *
 * GATES, inherited from `bench/maps-render` and for the same reasons:
 *   - the rendered grid must equal `--expect-grid` or the run FAILS (cost may
 *     only fall by doing less per cell, never by producing fewer cells);
 *   - a non-blank guard, skipped for walk scenes only (a street-level frame
 *     legitimately has sky in it, and sky is blank cells);
 *   - vsync stays ON, so 16.7 ms is the floor and every multiple is a drop.
 *
 * Usage:
 *   pnpm build:website && (cd website && pnpm exec astro preview --port 4399) &
 *   node bench/maps-trace/mapsTrace.mjs --url http://localhost:4399 --headed --scene walk-city
 *   node bench/maps-trace/mapsTrace.mjs --url http://localhost:4399 --headed --scene all --markdown-out bench/maps-trace/results/trace.md
 *
 *   --url <origin>        required
 *   --scene <id|all>      default `walk-city`; see `scenes.mjs`
 *   --encoding spans|atlas   default `spans` (the page's own default is atlas)
 *   --headed              REQUIRED for any paint/GPU claim. Headless
 *                         software-renders and inflates raster/paint.
 *   --frame-details       keep the slowest frames' own group attribution
 *   --gpu-details [light|full]   extra viz categories; `full` is forensic and perturbs timing
 *   --trace-out <dir>     keep the raw Chrome traces (openable in DevTools)
 *   --json <file>         full result
 *   --markdown-out <file> the frame-decomposition table
 *   --profile             also take a CDP CPU profile over the same motion
 *   --settle <ms>         per-step tile settle, default 6000
 *   --no-census           skip the geometry census (it costs a few seconds)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path, { dirname, resolve as resolvePath } from "node:path";

// ── Args ───────────────────────────────────────────────────────────────────
function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next === undefined || next.startsWith("--") ? true : next;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const URL_BASE = arg("url");
if (!URL_BASE) {
  console.error("mapsTrace: --url is required (e.g. --url http://localhost:4399)");
  process.exit(2);
}
const SCENE_ARG = String(arg("scene", "walk-city"));
const ENCODING = String(arg("encoding", "spans"));
const HEADED = hasFlag("headed");
const FRAME_DETAILS = hasFlag("frame-details");
const PROFILE = hasFlag("profile");
const CENSUS = !hasFlag("no-census");
const SETTLE_MS = Number(arg("settle", 6000));
const TRACE_OUT_DIR = arg("trace-out", null);
const JSON_OUT = arg("json", null);
const MARKDOWN_OUT = arg("markdown-out", null);
const GPU_DETAILS = (() => {
  const raw = arg("gpu-details", null);
  if (raw === null) return "off";
  if (raw === true || raw === "light") return "light";
  if (raw === "full" || raw === "deep") return "full";
  return "off";
})();

const MIN_NONBLANK_RATIO = 0.2;
const MARK_START = "__maps_trace_start__";
const MARK_END = "__maps_trace_end__";

// ── Trace categories and event groups — the `chrome-trace` skill's own ──────
const BASE_TRACE_CATEGORIES = [
  "devtools.timeline", "disabled-by-default-devtools.timeline", "benchmark",
  "blink", "blink.console", "blink.user_timing", "cc", "gpu", "viz",
  "v8.console", "renderer.scheduler",
];
const GPU_DETAIL_TRACE_CATEGORIES = ["disabled-by-default-viz.gpu_composite_time"];
const DEEP_GPU_TRACE_CATEGORIES = [
  ...GPU_DETAIL_TRACE_CATEGORIES,
  "disabled-by-default-devtools.timeline.picture",
  "disabled-by-default-cc.debug", "disabled-by-default-cc.debug.display_items",
  "disabled-by-default-cc.debug.picture", "disabled-by-default-gpu.debug",
  "disabled-by-default-skia", "disabled-by-default-skia.gpu",
  "disabled-by-default-viz.debug.overlay_planes", "disabled-by-default-viz.overdraw",
  "disabled-by-default-viz.quads", "disabled-by-default-viz.triangles",
];
const TRACE_CATEGORIES = [
  ...BASE_TRACE_CATEGORIES,
  ...(GPU_DETAILS === "light" ? GPU_DETAIL_TRACE_CATEGORIES : []),
  ...(GPU_DETAILS === "full" ? DEEP_GPU_TRACE_CATEGORIES : []),
].join(",");

const EVENT_GROUPS = {
  script: ["FunctionCall", "EvaluateScript", "EventDispatch", "TimerFire", "FireAnimationFrame", "v8.run", "V8.Execute", "RunMicrotasks"],
  style: ["UpdateLayoutTree", "RecalculateStyles", "ScheduleStyleRecalculation", "InvalidateLayout"],
  layout: ["Layout", "UpdateLayoutTree.Layout", "LayoutShift"],
  prePaint: ["PrePaint"],
  paint: ["Paint", "PaintImage", "UpdateLayer", "UpdateLayerTree"],
  raster: ["RasterTask", "ImageDecodeTask", "Decode Image", "RasterizerTaskImpl::RunOnWorkerThread"],
  parseHtml: ["ParseHTML"],
  gc: ["MinorGC", "MajorGC", "BlinkGC.AtomicPhase", "V8.GCScavenger", "V8.GCIncrementalMarking", "V8.GCFinalizeMC", "ThreadState::performIdleLazySweep"],
  compositorMain: [
    "ProxyMain::BeginMainFrame", "WebFrameWidgetImpl::UpdateLifecycle",
    "PaintArtifactCompositor::Update", "Layerize", "Commit", "ProxyImpl::ReadyToCommit",
  ],
  compositorImpl: [
    "LayerTreeImpl::UpdateDrawProperties",
    "LayerTreeImpl::UpdateDrawProperties::CalculateDrawProperties",
    "draw_property_utils::ComputeDrawPropertiesOfVisibleLayers",
    "LayerTreeHostImpl::PrepareToDraw", "MainFrame.Draw", "SubmitCompositorFrame",
  ],
  gpuViz: [
    "Graphics.Pipeline", "DisplayScheduler::OnBeginFrameDeadline",
    "DisplayScheduler::DrawAndSwap", "Display::DrawAndSwap",
    "DirectRenderer::DrawFrame", "DirectRenderer::DrawRenderPass",
    "SoftwareRenderer::DoDrawQuad", "SkiaOutputSurfaceImplOnGpu::SwapBuffers",
  ],
};
/** The two the report leans on: main-thread total, and everything that is not script. */
const MAIN_THREAD_TASK = "RunTask";

const EXACT_EVENT_GROUPS = new Map();
for (const [group, names] of Object.entries(EVENT_GROUPS)) {
  for (const name of names) {
    const list = EXACT_EVENT_GROUPS.get(name) ?? [];
    list.push(group);
    EXACT_EVENT_GROUPS.set(name, list);
  }
}
const GROUP_NAMES = Object.keys(EVENT_GROUPS);

// ── Small helpers ──────────────────────────────────────────────────────────
const round = (n, d = 3) => (Number.isFinite(n) ? +n.toFixed(d) : null);
function quantile(values, q) {
  const s = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const i = (s.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// ── Main ───────────────────────────────────────────────────────────────────
const { SCENES, sceneById } = await import("./scenes.mjs");
const wanted = SCENE_ARG === "all" ? SCENES : SCENE_ARG.split(",").map((id) => sceneById(id.trim()));
const { chromium } = await import("playwright");

const results = [];
for (const scene of wanted) {
  // eslint-disable-next-line no-await-in-loop
  results.push(await traceScene(scene));
}

const out = {
  kind: "maps-trace",
  url: URL_BASE,
  encoding: ENCODING,
  headed: HEADED,
  gpuDetails: GPU_DETAILS,
  generated: new Date().toISOString(),
  scenes: results,
};
if (JSON_OUT) {
  mkdirSync(dirname(resolvePath(JSON_OUT)), { recursive: true });
  writeFileSync(resolvePath(JSON_OUT), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwrote ${resolvePath(JSON_OUT)}`);
}
if (MARKDOWN_OUT) {
  mkdirSync(dirname(resolvePath(MARKDOWN_OUT)), { recursive: true });
  writeFileSync(resolvePath(MARKDOWN_OUT), renderMarkdown(out));
  console.log(`wrote ${resolvePath(MARKDOWN_OUT)}`);
}

/** @param {import("./scenes.mjs").TraceScene} scene */
async function traceScene(scene) {
  const [VW, VH] = scene.viewport;
  const browser = await chromium.launch({
    headless: !HEADED,
    args: ["--enable-precise-memory-info"],
  });
  const context = await browser.newContext({ viewport: { width: VW, height: VH } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const diagnostics = [];
  page.on("pageerror", (e) => diagnostics.push(`[pageerror] ${e?.message ?? e}`));

  try {
    console.log(`\n── ${scene.id} — ${scene.what}`);
    await page.goto(`${URL_BASE}/maps/?bench=1`, { waitUntil: "load" });
    await page.waitForFunction(() => Boolean(window.__glyphMapsBench?.map()), null, { timeout: 60000 });
    // Both providers (terrain + vector) must land: the widget is REBUILT when
    // the second resolves, so anything installed before that is installed on a
    // doomed instance. `bench/maps-render` waits the same 6 s for the same reason.
    await page.waitForTimeout(SETTLE_MS);

    await installInstrumentation(page);
    if (CENSUS) await page.evaluate(() => window.__mapsTrace.wrapSceneAdd());

    await configureScene(page, scene);

    const grid = await page.evaluate(() => window.__mapsTrace.grid());
    const shape = `${grid.cols}x${grid.rows}`;
    if (shape !== scene.expectGrid) {
      throw new Error(`mapsTrace: grid gate FAILED for "${scene.id}" — rendered ${shape}, expected ${scene.expectGrid}.`
        + " Cost may only fall by doing less per cell, never by producing fewer cells.");
    }
    if (!scene.walk && grid.nonBlank / grid.cells < MIN_NONBLANK_RATIO) {
      throw new Error(`mapsTrace: non-blank guard FAILED for "${scene.id}" — ${(100 * grid.nonBlank / grid.cells).toFixed(1)}%.`);
    }

    const census = CENSUS ? await page.evaluate(() => window.__mapsTrace.census()) : null;

    // ── The traced window ─────────────────────────────────────────────────
    const traceEvents = [];
    cdp.on("Tracing.dataCollected", (p) => { if (Array.isArray(p.value)) traceEvents.push(...p.value); });
    await cdp.send("Performance.enable");
    await cdp.send("Tracing.start", { transferMode: "ReportEvents", categories: TRACE_CATEGORIES });

    await page.evaluate(() => window.__mapsTrace.reset());
    const startPerfNow = await mark(page, MARK_START);
    await runMotion(page, scene);
    const endPerfNow = await mark(page, MARK_END);
    const samples = await page.evaluate(() => window.__mapsTrace.stopSampler());
    const inPage = await page.evaluate(() => window.__mapsTrace.snapshot());

    const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
    await cdp.send("Tracing.end");
    await done;

    // ── The optional CPU profile, over the same motion ────────────────────
    let profile = null;
    if (PROFILE) profile = await cpuProfile(page, cdp, scene);

    const gridAfter = await page.evaluate(() => window.__mapsTrace.grid());
    if (`${gridAfter.cols}x${gridAfter.rows}` !== scene.expectGrid) {
      throw new Error(`mapsTrace: grid gate FAILED after motion for "${scene.id}" — ${gridAfter.cols}x${gridAfter.rows}.`);
    }

    const analysis = analyse(traceEvents, samples, startPerfNow, endPerfNow);

    if (TRACE_OUT_DIR) {
      const file = resolvePath(path.join(String(TRACE_OUT_DIR), `${scene.id}.trace.json`));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({
        traceEvents, displayTimeUnit: "ms",
        metadata: { source: "bench/maps-trace/mapsTrace.mjs", scene: scene.id, url: URL_BASE },
      }));
      analysis.traceFile = file;
      console.log(`   raw trace → ${file}`);
    }

    const result = {
      scene: scene.id,
      what: scene.what,
      viewport: `${VW}x${VH}`,
      grid: shape,
      cells: grid.cells,
      nonBlankCells: grid.nonBlank,
      config: {
        osm: scene.osm ?? null, demo: scene.demo ?? null, live: scene.live ?? null,
        shadows: !!scene.shadows, keyLight: scene.keyLight, walk: !!scene.walk,
        sky: scene.sky !== false, motion: scene.motion, frames: scene.frames ?? 260,
      },
      camera: inPage.camera,
      trace: analysis,
      page: inPage.page,
      census,
      profile,
      diagnostics,
    };
    printScene(result);
    return result;
  } finally {
    await browser.close();
  }
}

// ── Page configuration ─────────────────────────────────────────────────────
async function configureScene(page, scene) {
  await page.evaluate((enc) => window.__glyphMapsBench.setColorEncoding(enc), ENCODING);
  await page.waitForTimeout(1500);

  if (scene.at) {
    await page.evaluate(([lon, lat, span]) =>
      window.__glyphMapsBench.setView({ center: [lon, lat], span }), scene.at);
    await page.waitForTimeout(SETTLE_MS);
  }
  // ── Force the TERRAIN to remount, so the census sees it. ─────────────────
  // `scene.add` is wrapped only after the widget's second rebuild has settled
  // (the vector provider landing destroys the first instance), and the terrain
  // tiles for the view the page LOADED on were mounted before that. A scene
  // that moves somewhere else remounts them on the way and the census is
  // complete; a scene that sits where the page opened does not, and its census
  // silently missed 64,521 of 113,383 polygons. The terrain layer is removed
  // and re-added on any density CHANGE, so a 1.1-then-1 round trip remounts it
  // and lands back on the page's own default.
  if (CENSUS) {
    await page.evaluate(() => window.__glyphMapsBench.setTerrainDensity(1.1));
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.__glyphMapsBench.setTerrainDensity(1));
    await page.waitForTimeout(4000);
  }
  if (scene.demo?.length) {
    await page.evaluate((ids) => { for (const id of ids) window.__glyphMapsBench.setDemoLayer(id, true); }, scene.demo);
    await page.waitForTimeout(4000);
  }
  if (scene.live?.length) {
    await page.evaluate((ids) => {
      window.__glyphMapsBench.setLiveFeeds(ids);
      window.__glyphMapsBench.setLive(true);
    }, scene.live);
    await page.waitForTimeout(6000);
  }
  if (scene.osm) {
    await page.evaluate((ids) => {
      window.__glyphMapsBench.setOsmSublayers(ids);
      window.__glyphMapsBench.setOsm(ids.length > 0);
    }, scene.osm);
    await page.waitForTimeout(SETTLE_MS);
  }
  // Exactly what the page's own `[shadows]` effect does — see `scenes.mjs`.
  await page.evaluate(({ shadows, keyLight }) => {
    const map = window.__glyphMapsBench.map();
    map.setKeyLight(keyLight);
    map.setShadow(shadows ? {} : null);
  }, { shadows: !!scene.shadows, keyLight: scene.keyLight });
  await page.waitForTimeout(1200);

  if (scene.walk) {
    await page.evaluate(() => window.__glyphMapsBench.setWalk(true));
    await page.waitForTimeout(SETTLE_MS);
    if (scene.sky === false) {
      await page.evaluate(() => window.__glyphMapsBench.map().setWalk({ sky: false }));
      await page.waitForTimeout(SETTLE_MS);
    }
    const walking = await page.evaluate(() => window.__glyphMapsBench.getWalk());
    if (!walking) throw new Error(`mapsTrace: walk mode never engaged for "${scene.id}" — the gate refused.`);
  } else if (scene.tilt !== undefined) {
    await page.evaluate((t) => {
      const map = window.__glyphMapsBench.map();
      map.setTilt(t === "max" ? map.getMaxTilt() : t);
    }, scene.tilt);
    await page.waitForTimeout(2500);
  }
  // The shadow/keyLight write above is asserted rather than assumed: a silent
  // no-op here would make every shadow row in the report a lie.
  const live = await page.evaluate(() => {
    const map = window.__glyphMapsBench.map();
    return { shadow: map.getShadow(), keyLight: map.getKeyLight() };
  });
  if (!!scene.shadows !== (live.shadow !== null)) {
    throw new Error(`mapsTrace: shadow state did not take for "${scene.id}" (wanted ${!!scene.shadows}, got ${live.shadow !== null}).`);
  }
  if (live.keyLight !== scene.keyLight) {
    throw new Error(`mapsTrace: key light did not take for "${scene.id}" (wanted ${scene.keyLight}, got ${live.keyLight}).`);
  }
  await page.waitForTimeout(2000);
}

// ── The motions ────────────────────────────────────────────────────────────
async function runMotion(page, scene) {
  const frames = scene.frames ?? 260;
  if (scene.motion === "walk") {
    return page.evaluate((n) => window.__mapsTrace.walk(n), frames);
  }
  if (scene.motion === "pan") {
    // The walker's own ground speed, so the orthographic comparison differs in
    // CAMERA and not in how fast the world goes by. 6 m/s at 60 fps is 0.1 m
    // per displayed frame; degrees of latitude per metre is 1/111320.
    return page.evaluate((n) => window.__mapsTrace.pan(n, 6 / 60 / 111320), frames);
  }
  if (scene.motion === "orbit") {
    return page.evaluate((n) => window.__mapsTrace.orbit(n, 0.75), frames);
  }
  throw new Error(`mapsTrace: unknown motion "${scene.motion}"`);
}

async function mark(page, name) {
  return page.evaluate((m) => { performance.mark(m); console.timeStamp(m); return performance.now(); }, name);
}

// ── CPU profile ────────────────────────────────────────────────────────────
async function cpuProfile(page, cdp, scene) {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  await cdp.send("Profiler.start");
  await runMotion(page, scene);
  const { profile } = await cdp.send("Profiler.stop");
  await cdp.send("Profiler.disable");

  // Self time per (function, url:line). A node's self time is the number of
  // samples that landed IN it, times the sampling interval.
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const totalSamples = profile.samples?.length ?? 0;
  const spanMs = (profile.endTime - profile.startTime) / 1000;
  const msPerSample = totalSamples ? spanMs / totalSamples : 0;
  for (const id of profile.samples ?? []) {
    const n = byId.get(id);
    if (!n) continue;
    const f = n.callFrame;
    const key = `${f.functionName || "(anonymous)"} @ ${shortUrl(f.url)}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + msPerSample);
  }
  const top = [...self.entries()]
    .map(([name, ms]) => ({ name, self_ms: round(ms, 2), share: round(ms / spanMs, 4) }))
    .sort((a, b) => b.self_ms - a.self_ms)
    .slice(0, 40);
  // A minified bundle reports one-letter names; say so rather than guess.
  const named = top.filter((t) => /^[A-Za-z_$][A-Za-z0-9_$]{3,}/.test(t.name)).length;
  return {
    span_ms: round(spanMs, 1),
    samples: totalSamples,
    sampling_interval_us: 100,
    names_usable: named >= top.length / 2,
    note: named >= top.length / 2 ? null
      : "Most frames carry mangled names — this build is minified. Re-run against `pnpm dev:website` for function-level attribution.",
    topSelf: top,
  };
}
function shortUrl(url) {
  if (!url) return "(native)";
  try { return new URL(url).pathname.split("/").slice(-2).join("/"); } catch { return url; }
}

// ── Trace analysis ─────────────────────────────────────────────────────────
/**
 * THE HONEST DECOMPOSITION.
 *
 * Chrome trace durations are INCLUSIVE and deeply nested — a `RunTask` holds a
 * `FunctionCall` holds a `v8.run` holds a `RunMicrotasks` — so summing the
 * events that match a group double-counts, and "script 66 ms per frame" on a
 * 33 ms frame is that double-count, not a finding. Every number in `exclusive`
 * below is a SELF time: the event's own duration minus its children's, charged
 * to the nearest enclosing group. Those DO sum, per thread, to that thread's
 * busy time, and that is what makes "is the DOM the limit" answerable.
 *
 * The nesting is rebuilt per (process, thread) rather than globally, because a
 * renderer-main `Paint` and a compositor-impl `PrepareToDraw` overlap in wall
 * time and neither contains the other. Threads are classed by their own
 * `thread_name` metadata — never by guessing from the event name.
 */
function analyse(traceEvents, samples, fallbackStart, fallbackEnd) {
  const startMark = findMark(traceEvents, MARK_START);
  const endMark = findMark(traceEvents, MARK_END);
  const aligned = Boolean(startMark?.args?.data?.startTime && endMark?.args?.data?.startTime);
  const offset = aligned ? (startMark.ts / 1000) - startMark.args.data.startTime : 0;
  const t0 = aligned ? startMark.args.data.startTime : fallbackStart;
  const t1 = aligned ? endMark.args.data.startTime : fallbackEnd;

  const frames = samples
    .filter((s) => Number.isFinite(s.dt) && s.dt > 0 && s.dt < 2000)
    .filter((s) => s.t - s.dt >= t0 && s.t <= t1)
    .map((s, index) => ({ index, start: s.t - s.dt, end: s.t, dt: s.dt, groups: new Map(), events: new Map() }));
  const n = frames.length || 1;

  // ── Thread classes, from the trace's own metadata. ───────────────────────
  const threadName = new Map();
  for (const e of traceEvents) {
    if (e?.ph === "M" && e.name === "thread_name") threadName.set(`${e.pid}:${e.tid}`, e.args?.name ?? "");
  }
  const classOf = (key) => {
    const name = threadName.get(key) ?? "";
    if (name === "CrRendererMain") return "rendererMain";
    if (name === "Compositor") return "compositor";
    if (/^CompositorTileWorker/.test(name) || /Foreground Worker/.test(name)) return "rasterThread";
    if (name === "VizCompositorThread" || name === "CrGpuMain" || /GpuMemory/.test(name)) return "gpu";
    return "other";
  };

  // ── Self times, per thread, charged to the nearest enclosing group. ──────
  const byThread = new Map();
  for (const e of traceEvents) {
    if (e?.ph !== "X" || typeof e.dur !== "number" || !Number.isFinite(e.ts)) continue;
    const key = `${e.pid}:${e.tid}`;
    (byThread.get(key) ?? byThread.set(key, []).get(key)).push(e);
  }

  /** group -> ms, and per-frame the same. */
  const exclusive = {};
  const exclusiveOther = new Map();
  const threadBusy = {};
  const inclusiveGroups = new Map();
  const eventTotals = new Map();

  for (const [key, events] of byThread) {
    const cls = classOf(key);
    walkSelf(events, (event, selfMs, ancestors) => {
      const at = ((event.ts + (event.dur ?? 0) / 2) / 1000) - offset;
      if (at < t0 || at > t1) return;
      threadBusy[cls] = (threadBusy[cls] ?? 0) + selfMs;
      if (selfMs <= 0) return;
      // The nearest enclosing group, self first then up the ancestor chain.
      let group = groupsOf(event.name)[0] ?? null;
      for (let i = ancestors.length - 1; group === null && i >= 0; i--) group = groupsOf(ancestors[i].name)[0] ?? null;
      if (group === null) {
        // Everything off the renderer main thread that carries no group of its
        // own is that thread's own work, and the thread class names it.
        if (cls === "compositor") group = "compositorImpl";
        else if (cls === "rasterThread") group = "raster";
        else if (cls === "gpu") group = "gpuViz";
      }
      const bucket = group ?? `other:${cls}`;
      exclusive[bucket] = (exclusive[bucket] ?? 0) + selfMs;
      if (group === null) add(exclusiveOther, `${event.name} [${cls}]`, selfMs);
      const fi = frameAt(frames, at);
      if (fi >= 0) add(frames[fi].groups, bucket, selfMs);
    });
  }

  // The skill's own INCLUSIVE view, kept for comparability with its reports.
  for (const e of traceEvents) {
    if (e?.ph !== "X" || typeof e.dur !== "number" || !Number.isFinite(e.ts)) continue;
    const at = ((e.ts + e.dur / 2) / 1000) - offset;
    if (at < t0 || at > t1) continue;
    add(eventTotals, e.name, e.dur / 1000);
    for (const g of groupsOf(e.name)) add(inclusiveGroups, g, e.dur / 1000);
  }

  const dts = frames.map((f) => f.dt);
  const perFrame = (ms) => round((ms ?? 0) / n, 3);
  return {
    aligned,
    window_ms: round(t1 - t0, 1),
    frames: {
      count: frames.length,
      fps_p50: round(1000 / (quantile(dts, 0.5) || 1), 1),
      frame_ms_p50: round(quantile(dts, 0.5), 2),
      frame_ms_p95: round(quantile(dts, 0.95), 2),
      frame_ms_p99: round(quantile(dts, 0.99), 2),
      frame_ms_max: round(Math.max(...dts, 0), 2),
      dropped: dts.filter((d) => d > 20).length,
    },
    /** Self time per DISPLAYED frame. These sum, per thread, to that thread's busy time. */
    exclusive: Object.fromEntries(Object.entries(exclusive)
      .map(([k, v]) => [k, perFrame(v)]).sort((a, b) => b[1] - a[1])),
    threadBusy_ms_per_frame: Object.fromEntries(Object.entries(threadBusy).map(([k, v]) => [k, perFrame(v)])),
    /** What landed in no group at all, so the `other:` rows are never a shrug. */
    ungrouped: [...exclusiveOther.entries()].map(([name, t]) => ({ name, ms_per_frame: perFrame(t.ms) }))
      .sort((a, b) => b.ms_per_frame - a.ms_per_frame).slice(0, 15),
    inclusive: Object.fromEntries(GROUP_NAMES.map((g) => [g, perFrame(inclusiveGroups.get(g)?.ms)])),
    topEvents: [...eventTotals.entries()]
      .map(([name, t]) => ({ name, count: t.count, ms_per_frame: perFrame(t.ms) }))
      .sort((a, b) => b.ms_per_frame - a.ms_per_frame).slice(0, 25),
    slowestFrames: FRAME_DETAILS
      ? frames.slice().sort((a, b) => b.dt - a.dt).slice(0, 10).map((f) => ({
        dt_ms: round(f.dt, 2),
        exclusive: Object.fromEntries([...f.groups.entries()]
          .map(([k, t]) => [k, round(t.ms, 3)]).sort((a, b) => b[1] - a[1])),
      }))
      : null,
  };
}

/**
 * Walk one thread's complete (`ph: "X"`) events as a nesting tree and report
 * each one's SELF time plus its ancestor chain. Chrome emits them in a valid
 * nesting, so a stack keyed on `ts + dur` reconstructs it exactly.
 */
function walkSelf(events, onSelf) {
  const sorted = events.slice().sort((a, b) => (a.ts - b.ts) || ((b.dur ?? 0) - (a.dur ?? 0)));
  const stack = [];
  const flush = (until) => {
    while (stack.length && stack[stack.length - 1].end <= until) {
      const f = stack.pop();
      onSelf(f.e, Math.max(0, ((f.e.dur ?? 0) - f.childDur) / 1000), stack.map((s) => s.e));
    }
  };
  for (const e of sorted) {
    flush(e.ts);
    if (stack.length) stack[stack.length - 1].childDur += (e.dur ?? 0);
    stack.push({ e, end: e.ts + (e.dur ?? 0), childDur: 0 });
  }
  flush(Infinity);
}

function add(map, key, ms) {
  const e = map.get(key) ?? { count: 0, ms: 0 };
  e.count += 1; e.ms += ms; map.set(key, e);
}
function groupsOf(name) {
  return EXACT_EVENT_GROUPS.get(name) ?? [];
}
function findMark(events, name) {
  return events.find((e) => e?.name === name && Number.isFinite(e?.args?.data?.startTime))
    ?? events.find((e) => e?.name === "TimeStamp" && e?.args?.data?.message === name);
}
function frameAt(frames, at) {
  let lo = 0, hi = frames.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (at < frames[mid].start) hi = mid - 1;
    else if (at > frames[mid].end) lo = mid + 1;
    else return mid;
  }
  return -1;
}
// ── Console report ─────────────────────────────────────────────────────────
function printScene(r) {
  const x = r.trace.exclusive;
  const f = r.trace.frames;
  const b = r.trace.threadBusy_ms_per_frame;
  console.log(`   grid ${r.grid} (${r.cells} cells, ${r.nonBlankCells} non-blank)  camera ${r.camera?.kind ?? "?"}`);
  console.log(`   fps p50 ${f.fps_p50}   frame ms p50/p95/p99/max ${f.frame_ms_p50}/${f.frame_ms_p95}/${f.frame_ms_p99}/${f.frame_ms_max}   dropped ${f.dropped}/${f.count}`);
  console.log(`   thread busy ms/frame: ${Object.entries(b).map(([k, v]) => `${k} ${v}`).join("  ")}`);
  console.log(`   SELF ms/frame: ${Object.entries(x).slice(0, 10).map(([k, v]) => `${k} ${v}`).join("  ")}`);
  const p = r.page;
  console.log(`   in-page: renders/frame ${p.rendersPerFrame}  base-raster ${p.baseRasterMs} ms  base-dom ${p.baseDomMs} ms  polys ${p.basePolys}`);
  console.log(`            rasterize calls/render ${p.rasterizeCallsPerRender}  loop ${p.loopMs} ms/call  string ${p.stringMs} ms/call`);
  if (p.stageMsPerRender) {
    const top = Object.entries(p.stageMsPerRender).sort((a, b2) => b2[1] - a[1]).slice(0, 6)
      .map(([k, v]) => `${k} ${v}`).join("  ");
    console.log(`   stages ms/render: ${top}`);
  }
  if (r.census) {
    const c = r.census;
    console.log(`   census: ${c.meshes} meshes, ${c.polygons} polygons, ${c.triangles} triangles (metrics ${c.metricsOk ? "ok" : "UNVERIFIED"})`);
    console.log(`           behind ${pctOf(c.behind, c.triangles)}  off-grid ${pctOf(c.offGrid, c.triangles)}`
      + `  back-facing ${pctOf(c.backFacing, c.triangles)}  drawn ${pctOf(c.drawn, c.triangles)}`);
    console.log(`           polygons per non-blank cell ${round(c.polygons / Math.max(1, r.nonBlankCells), 2)}`);
    const k = c.chunkStats;
    console.log(`           cull runs: ${k.chunks} total — rejected ${pctOf(k.rejected, k.chunks)}`
      + `  accepted on-grid ${pctOf(k.acceptedOnGrid, k.chunks)}  accepted on NaN ${pctOf(k.acceptedNaN, k.chunks)}`
      + ` (of which wholly behind the eye ${k.whollyBehind})  uncullable ${k.uncullable}`);
    console.log(`           triangles the cull cannot reach because a run straddles/sits behind the near plane: `
      + `${pctOf(k.trianglesAcceptedNaN, c.triangles)}, of which provably invisible ${pctOf(k.trianglesWhollyBehind, c.triangles)}`);
    for (const [k, v] of Object.entries(c.byClass).sort((a, b2) => b2[1].triangles - a[1].triangles)) {
      console.log(`           ${k.padEnd(22)} ${String(v.meshes).padStart(4)} meshes ${String(v.polygons).padStart(7)} polys`
        + `  back-facing ${pctOf(v.backFacing, v.triangles)}  off-grid ${pctOf(v.offGrid, v.triangles)}  drawn ${pctOf(v.drawn, v.triangles)}`);
    }
  }
  if (p.longTasks?.count) console.log(`   long tasks: ${p.longTasks.count}, worst ${p.longTasks.worst} ms`);
  if (r.trace.ungrouped?.length) {
    console.log(`   ungrouped self time: ${r.trace.ungrouped.slice(0, 5).map((u) => `${u.name} ${u.ms_per_frame}`).join("  ")}`);
  }
}
function pctOf(a, b) { return `${a} (${b ? round(100 * a / b, 1) : 0}%)`; }

function renderMarkdown(out) {
  const COLS = ["script", "style", "layout", "prePaint", "paint", "gc", "compositorMain", "compositorImpl", "raster", "gpuViz"];
  const lines = [];
  lines.push("# `/maps` Chrome-trace frame decomposition", "");
  lines.push(`Captured ${out.generated} — ${out.url}, encoding \`${out.encoding}\`, headed ${out.headed}.`, "");
  lines.push("Every number is **self time in ms per displayed frame** — the event's own duration",
    "minus its children's, charged to the nearest enclosing group. Trace durations are inclusive",
    "and nest, so summing matching events (what a naive group total does) double-counts; these do not.",
    "`renderer busy` is the renderer main thread's total busy time per frame and is the number a",
    "\"is the main thread the limit\" question is actually about.", "");
  lines.push(`| scene | grid | fps p50 | frame p50/p95 | renderer busy | ${COLS.join(" | ")} |`);
  lines.push(`|---|---|---|---|---|${COLS.map(() => "---").join("|")}|`);
  for (const r of out.scenes) {
    const x = r.trace.exclusive, f = r.trace.frames;
    lines.push(`| \`${r.scene}\` | ${r.grid} | ${f.fps_p50} | ${f.frame_ms_p50}/${f.frame_ms_p95} `
      + `| ${r.trace.threadBusy_ms_per_frame.rendererMain ?? "—"} `
      + `| ${COLS.map((c) => x[c] ?? 0).join(" | ")} |`);
  }
  lines.push("");
  lines.push("| scene | renders/frame | base-raster | base-dom | rasterize calls/render | loop ms/call | string ms/call | polygons | tris drawn | polys per non-blank cell |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of out.scenes) {
    const p = r.page, c = r.census;
    lines.push(`| \`${r.scene}\` | ${p.rendersPerFrame} | ${p.baseRasterMs} | ${p.baseDomMs} | ${p.rasterizeCallsPerRender} | ${p.loopMs} | ${p.stringMs} `
      + `| ${c ? c.polygons : "—"} | ${c ? `${c.drawn} (${round(100 * c.drawn / Math.max(1, c.triangles), 1)}%)` : "—"} `
      + `| ${c ? round(c.polygons / Math.max(1, r.nonBlankCells), 2) : "—"} |`);
  }
  lines.push("");
  lines.push("## Triangle census, per scene", "");
  for (const r of out.scenes) {
    if (!r.census) continue;
    const c = r.census;
    lines.push(`### \`${r.scene}\` — ${c.polygons} polygons, ${c.triangles} fan triangles`, "");
    lines.push("| mesh class | meshes | polygons | behind | off-grid | back-facing | drawn |");
    lines.push("|---|---|---|---|---|---|---|");
    const row = (k, v) => `| ${k} | ${v.meshes} | ${v.polygons} | ${pctOf(v.behind, v.triangles)} | ${pctOf(v.offGrid, v.triangles)} | ${pctOf(v.backFacing, v.triangles)} | ${pctOf(v.drawn, v.triangles)} |`;
    for (const [k, v] of Object.entries(c.byClass).sort((a, b) => b[1].triangles - a[1].triangles)) lines.push(row(k, v));
    lines.push(row("**all**", c));
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

// ── In-page instrumentation ────────────────────────────────────────────────
async function installInstrumentation(page) {
  await page.evaluate(() => {
    const T = {};
    window.__mapsTrace = T;

    // glyphcss's own probes. Zero cost to the library when unset.
    globalThis.__glyphPerf = { raster: [], dom: [], polys: [] };
    globalThis.__glyphPerfDetail = { loop: [], string: [] };

    // ── Render stage markers, grouped into BURSTS exactly the way
    //    `bench/maps-render` groups them: one render's markers all fire inside
    //    one synchronous block, so the gap to the next marker is real work,
    //    and the burst is closed by a microtask queued at `base-validate`.
    const stageMs = {}; const stageCounts = {};
    let renders = 0, last = null, lastT = 0, closing = false;
    const closeBurst = () => {
      if (last === null) return;
      stageMs[last] = (stageMs[last] || 0) + (performance.now() - lastT);
      last = null; closing = false;
    };
    globalThis.__glyphRenderStage = (s) => {
      const t = performance.now();
      stageCounts[s] = (stageCounts[s] || 0) + 1;
      if (s === "base-validate") {
        closeBurst();
        renders++; last = s; lastT = t;
        if (!closing) { closing = true; queueMicrotask(closeBurst); }
        return;
      }
      if (last !== null) stageMs[last] = (stageMs[last] || 0) + (t - lastT);
      last = s; lastT = t;
    };

    // ── rAF sampler (the `chrome-trace` skill's own shape). ───────────────
    T.samples = [];
    let sampling = true, prev = performance.now();
    const tick = (now) => {
      T.samples.push({ t: now, dt: now - prev });
      prev = now;
      if (sampling) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    T.stopSampler = () => { sampling = false; return T.samples.slice(); };

    const longTasks = [];
    try {
      new PerformanceObserver((list) => { for (const e of list.getEntries()) longTasks.push(e.duration); })
        .observe({ entryTypes: ["longtask"] });
    } catch { /* Chromium-only; the frame gaps still carry the stall */ }

    T.reset = () => {
      T.samples.length = 0;
      longTasks.length = 0;
      renders = 0; last = null; closing = false;
      for (const k of Object.keys(stageMs)) delete stageMs[k];
      for (const k of Object.keys(stageCounts)) delete stageCounts[k];
      globalThis.__glyphPerf.raster.length = 0;
      globalThis.__glyphPerf.dom.length = 0;
      globalThis.__glyphPerf.polys.length = 0;
      globalThis.__glyphPerfDetail.loop.length = 0;
      globalThis.__glyphPerfDetail.string.length = 0;
    };

    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const r3 = (n) => +Number(n).toFixed(3);

    T.snapshot = () => {
      closeBurst();
      const frames = T.samples.length || 1;
      const perf = globalThis.__glyphPerf;
      const detail = globalThis.__glyphPerfDetail;
      const cam = window.__glyphMapsBench.map().scene.camera;
      return {
        camera: {
          kind: cam.perspective > 0 ? "perspective(css)" : (cam.eyeMode ? "perspective(eye)" : "orthographic"),
          perspective: cam.perspective, zoom: cam.zoom, rotX: cam.rotX, rotY: cam.rotY,
          fovScale: cam.fovScale, useMat: cam.useMat,
        },
        page: {
          displayedFrames: T.samples.length,
          renders,
          rendersPerFrame: r3(renders / frames),
          basePasses: perf.polys.length,
          basePolys: Math.round(avg(perf.polys)),
          baseRasterMs: r3(avg(perf.raster)),
          baseDomMs: r3(avg(perf.dom)),
          loopMs: r3(avg(detail.loop)),
          stringMs: r3(avg(detail.string)),
          // `__glyphPerfDetail` fires per `rasterize()` CALL, and a frame that
          // separates a mesh into a detail `<pre>` makes more than one, so the
          // averages above are per call and this is how many.
          rasterizeCalls: detail.loop.length,
          rasterizeCallsPerRender: r3(detail.loop.length / Math.max(1, renders)),
          loopMsPerRender: r3(detail.loop.reduce((a, b) => a + b, 0) / Math.max(1, renders)),
          stringMsPerRender: r3(detail.string.reduce((a, b) => a + b, 0) / Math.max(1, renders)),
          // ms per RENDER, not per frame — a stage is a property of a render.
          stageMsPerRender: Object.fromEntries(Object.entries(stageMs)
            .map(([k, v]) => [k, r3(v / Math.max(1, renders))]).sort((a, b) => b[1] - a[1])),
          stageCounts: { ...stageCounts },
          longTasks: {
            count: longTasks.length,
            total: r3(longTasks.reduce((a, b) => a + b, 0)),
            worst: r3(Math.max(0, ...longTasks)),
          },
          heapMB: performance.memory ? r3(performance.memory.usedJSHeapSize / 1048576) : null,
        },
      };
    };

    // ── The grid, and the cell metrics the census needs. ──────────────────
    T.grid = () => {
      const pre = window.__glyphMapsBench.output();
      const text = pre.textContent ?? "";
      const rows = text.split("\n");
      while (rows.length && rows[rows.length - 1] === "") rows.pop();
      const outs = [pre, ...Array.from(pre.parentElement?.querySelectorAll("pre.glyph-output--detail") ?? [])];
      let cells = 0, nonBlank = 0;
      for (const el of outs) {
        const t = el.textContent ?? "";
        cells += t.replace(/\n/g, "").length;
        nonBlank += t.replace(/\s/g, "").length;
      }
      return { cols: rows[0]?.length ?? 0, rows: rows.length, cells, nonBlank, outputs: outs.length };
    };

    // ── Geometry census. ─────────────────────────────────────────────────
    //  `scene.add` is wrapped so every mounted mesh is held with its polygon
    //  count and its transform; `dispose` unholds it. The classification then
    //  re-runs, in page, the SAME tests the solid rasterizer's triangle loop
    //  runs (`render/rasterize.ts`) against the LIVE camera.
    const meshes = new Map();
    T.wrapSceneAdd = () => {
      const scene = window.__glyphMapsBench.map().scene;
      if (scene.__mapsTraceWrapped) return;
      const realAdd = scene.add.bind(scene);
      scene.add = (polygons, transform) => {
        const handle = realAdd(polygons, transform);
        meshes.set(handle.id, { handle, transform: transform ?? {} });
        const realDispose = handle.dispose.bind(handle);
        handle.dispose = () => { meshes.delete(handle.id); realDispose(); };
        return handle;
      };
      scene.__mapsTraceWrapped = true;
    };

    T.census = () => {
      const map = window.__glyphMapsBench.map();
      const scene = map.scene;
      const opts = scene.getOptions();
      const cam = scene.camera;
      const cols = opts.cols, rows = opts.rows, cellAspect = opts.cellAspect;
      // Rebuild the projection metrics the way `createGlyphScene`'s own
      // `baseProjectionGrid()` builds them: a measured cell, plus the
      // autoSize centring term. Checked below before any number counts.
      const pre = scene.output;
      const probe = document.createElement("span");
      probe.textContent = "0".repeat(100);
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;";
      pre.appendChild(probe);
      const pr = probe.getBoundingClientRect();
      const cellW = pr.width / 100, cellH = pr.height;
      probe.remove();
      const host = scene.host.getBoundingClientRect();
      const metrics = {
        cellWidth: cellW, cellHeight: cellH,
        centerCol: cols * cam.center[0] + (host.width - cols * cellW) / (2 * cellW),
        centerRow: rows * cam.center[1] + (host.height - rows * cellH) / (2 * cellH),
      };
      // The check: the camera target must project to the middle of the grid.
      const tgt = cam.project(cam.target, cols, rows, cellAspect, metrics);
      const metricsOk = Number.isFinite(tgt[0]) && Number.isFinite(tgt[1])
        && Math.abs(tgt[0] - cols * cam.center[0]) < 2 && Math.abs(tgt[1] - rows * cam.center[1]) < 2;

      let polygons = 0, triangles = 0, behind = 0, offGrid = 0, backFacing = 0, drawn = 0, straddling = 0;
      const byClass = {};
      // ── The pre-projection CULL RUN simulation. ─────────────────────────
      //  `buildGlyphPolygonCullChunks` splits each mesh into contiguous runs of
      //  `GLYPH_CULL_CHUNK_POLYGONS = 48` polygons (a mesh under
      //  `GLYPH_CULL_CHUNK_MIN_POLYGONS = 256` gets none) and the solid
      //  rasterizer rejects a run whose world AABB projects entirely off the
      //  grid WITHOUT projecting one of its vertices. The rule that matters at
      //  street level is its FIRST one: a box that is not wholly in front of
      //  the near plane is ALWAYS accepted, and a perspective camera signals
      //  that by projecting such a corner to NaN. A run entirely BEHIND the eye
      //  therefore has eight NaN corners and is accepted, not rejected — so
      //  `chunksAcceptedNaN` is the work this mechanism cannot reach, and
      //  `chunksWhollyBehind` is the part of it that is provably invisible.
      const CHUNK = 48, CHUNK_MIN = 256;
      const chunkStats = { chunks: 0, rejected: 0, acceptedOnGrid: 0, acceptedNaN: 0, whollyBehind: 0, uncullable: 0,
        trianglesRejected: 0, trianglesAcceptedNaN: 0, trianglesWhollyBehind: 0, trianglesAcceptedOnGrid: 0, trianglesUncullable: 0 };
      const cullChunk = (polys, start, end) => {
        let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        let tris = 0, finite = true;
        for (let i = start; i < end; i++) {
          const vs = polys[i].vertices;
          if (vs.length >= 3) tris += vs.length - 2;
          for (const v of vs) {
            if (!Number.isFinite(v[0]) || !Number.isFinite(v[1]) || !Number.isFinite(v[2])) { finite = false; continue; }
            if (v[0] < minX) minX = v[0]; if (v[1] < minY) minY = v[1]; if (v[2] < minZ) minZ = v[2];
            if (v[0] > maxX) maxX = v[0]; if (v[1] > maxY) maxY = v[1]; if (v[2] > maxZ) maxZ = v[2];
          }
        }
        chunkStats.chunks++;
        if (!finite || minX > maxX) { chunkStats.uncullable++; chunkStats.trianglesUncullable += tris; return; }
        let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity, nan = 0;
        for (let c = 0; c < 8; c++) {
          const q = cam.project([(c & 1) ? maxX : minX, (c & 2) ? maxY : minY, (c & 4) ? maxZ : minZ],
            cols, rows, cellAspect, metrics);
          if (q[0] !== q[0] || q[1] !== q[1]) { nan++; continue; }
          if (q[0] < bMinX) bMinX = q[0]; if (q[0] > bMaxX) bMaxX = q[0];
          if (q[1] < bMinY) bMinY = q[1]; if (q[1] > bMaxY) bMaxY = q[1];
        }
        if (nan > 0) {
          chunkStats.acceptedNaN++; chunkStats.trianglesAcceptedNaN += tris;
          if (nan === 8) { chunkStats.whollyBehind++; chunkStats.trianglesWhollyBehind += tris; }
          return;
        }
        if (bMinX >= cols || bMaxX < 0 || bMinY >= rows || bMaxY < 0) {
          chunkStats.rejected++; chunkStats.trianglesRejected += tris;
          return;
        }
        chunkStats.acceptedOnGrid++; chunkStats.trianglesAcceptedOnGrid += tris;
      };
      for (const { handle, transform } of meshes.values()) {
        const polys0 = handle.polygons;
        if (polys0.length >= CHUNK_MIN) {
          for (let start = 0; start < polys0.length; start += CHUNK) cullChunk(polys0, start, Math.min(polys0.length, start + CHUNK));
        } else {
          let tris = 0;
          for (const poly of polys0) if ((poly.vertices?.length ?? 0) >= 3) tris += poly.vertices.length - 2;
          chunkStats.chunks++; chunkStats.uncullable++; chunkStats.trianglesUncullable += tris;
        }
      }
      for (const { handle, transform } of meshes.values()) {
        // A mesh separated into its own detail `<pre>` is a different pass; its
        // triangles are still submitted, so they are counted, and the key says
        // which bucket they came from. `castShadow`/`receiveShadow` are set
        // UNCONDITIONALLY at mount by `@glyphcss/maps`, so they identify the
        // LAYER TYPE even while shadows are off:
        //   cast+receive → fill-extrusion / model   (things that stand up)
        //   receive only → raster / fill / heatmap   (the ground)
        //   neither      → sky dome, and meshes for layers that stamp instead
        const key = `${transform.castShadow ? "cast" : "-"}/${transform.receiveShadow ? "recv" : "-"}`
          + `${transform.density && transform.density !== 1 ? `/d${transform.density}` : ""}`
          + `${transform.mode ? `/${transform.mode}` : ""}`
          + `${transform.transparent ? "/transparent" : ""}`;
        const bucket = byClass[key] ??= { meshes: 0, polygons: 0, triangles: 0, drawn: 0, backFacing: 0, offGrid: 0, behind: 0 };
        bucket.meshes++;
        const polys = handle.polygons;
        for (const poly of polys) {
          if (poly.hidden) continue;
          polygons++; bucket.polygons++;
          const verts = poly.vertices ?? poly.points ?? poly;
          const n = verts.length;
          if (n < 3) continue;
          const proj = new Array(n);
          for (let k = 0; k < n; k++) proj[k] = cam.project(verts[k], cols, rows, cellAspect, metrics);
          for (let fan = 1; fan < n - 1; fan++) {
            triangles++; bucket.triangles++;
            const pa = proj[0], pb = proj[fan], pc = proj[fan + 1];
            const nan = (pa[0] !== pa[0] ? 1 : 0) + (pb[0] !== pb[0] ? 1 : 0) + (pc[0] !== pc[0] ? 1 : 0);
            if (nan === 3) { behind++; bucket.behind++; continue; }
            if (nan > 0) { straddling++; drawn++; bucket.drawn++; continue; }
            if (Math.min(pa[0], pb[0], pc[0]) >= cols || Math.max(pa[0], pb[0], pc[0]) < 0
              || Math.min(pa[1], pb[1], pc[1]) >= rows || Math.max(pa[1], pb[1], pc[1]) < 0) {
              offGrid++; bucket.offGrid++; continue;
            }
            const area2 = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
            if (area2 > 0) { backFacing++; bucket.backFacing++; continue; }
            drawn++; bucket.drawn++;
          }
        }
      }
      return {
        metricsOk, metrics, cols, rows,
        meshes: meshes.size, polygons, triangles,
        behind, offGrid, backFacing, drawn, straddling,
        chunkStats,
        byClass,
      };
    };

    // ── Motions. ─────────────────────────────────────────────────────────
    // WALK is the keyboard: a held key is one event, and the widget's motion
    // loop integrates `dt` per rAF for as long as it is down. Exactly
    // `bench/maps-render`'s `walk` scenario, minus the look (any synthesized
    // heading goes through `setBearing`, which renders SYNCHRONOUSLY and would
    // measure the harness rather than the page).
    T.walk = (frames) => new Promise((resolve) => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true, cancelable: true }));
      let f = 0;
      const step = () => {
        if (++f >= frames) {
          document.dispatchEvent(new KeyboardEvent("keyup", { key: "w", bubbles: true }));
          setTimeout(resolve, 400);
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });

    T.pan = (frames, degPerFrame) => new Promise((resolve) => {
      const map = window.__glyphMapsBench.map();
      let f = 0, lat = map.getView().center[1];
      const lon = map.getView().center[0];
      const step = () => {
        lat += degPerFrame;
        map.setView({ center: [lon, lat] });
        if (++f >= frames) { setTimeout(resolve, 400); return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });

    T.orbit = (frames, degPerFrame) => new Promise((resolve) => {
      const map = window.__glyphMapsBench.map();
      let f = 0, lon = map.getView().center[0];
      const lat = map.getView().center[1];
      const step = () => {
        lon = ((lon + degPerFrame + 180) % 360) - 180;
        map.setView({ center: [lon, lat] });
        if (++f >= frames) { setTimeout(resolve, 400); return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  });
}
