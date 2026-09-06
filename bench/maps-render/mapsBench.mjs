#!/usr/bin/env node
/**
 * `/maps` render benchmark — cost AND fidelity, on a deterministic replay.
 *
 * Modeled on asciiQuake's `test/perf/glyphBench.mjs`: that project renders this
 * same glyphcss package at 2560x1440 / 20,916 cells and is fast, while /maps is
 * slow at 160x64 / ~10,240 cells, so the two harnesses have to be comparable.
 *
 * Why it reports two independent numbers: every "optimization" to an ASCII
 * renderer can be faked by rendering less. The cost number should go DOWN; the
 * fidelity digest must NOT change.
 *
 * REPLAY — CONTINUOUS MOTION ONLY (deterministic, no wall-clock, no randomness).
 * Discrete step-and-settle jumps hide exactly the per-frame costs being hunted
 * (shade-cache survival, tile churn, renders per displayed frame all behave
 * differently under sustained motion), so every scenario runs many consecutive
 * moving frames:
 *   `orbit`   a smooth globe rotation, one camera advance per rAF for N frames.
 *   `drag`    a smooth pointer drag along a continuous arc, then RELEASE —
 *             the tail measures whatever glide/inertia the build has.
 *   `wheel`   a continuous zoom in-and-out sweep.
 *   `flyto`   centre AND span moving together over a long arc, so tile LOD
 *             changes repeatedly mid-flight. Driven through `map.flyTo` when
 *             the build has it, and otherwise through the per-frame
 *             `setView({ center, span })` a caller has to write today — the
 *             same path, so before/after stay comparable.
 *
 * INPUT IS SYNTHESIZED IN-PAGE, NOT THROUGH CDP. A real trackpad emits 60-120
 * pointer/wheel events per second in bursts, each arriving in its OWN task, and
 * that is the whole point of the measurement — every task drains a microtask
 * checkpoint, so every task can buy a full render. Driving through Playwright's
 * `mouse.move` + await instead delivers roughly one event every two or three
 * frames and measured renders/frame at 0.34, which says nothing about the real
 * burst behaviour. `EVENTS_PER_FRAME` separate `setTimeout(…, 0)` tasks per
 * displayed frame reproduce it exactly and deterministically.
 *
 * Each scenario is measured in its OWN window, back to back with no idle
 * between drive events: idle rAF ticks are free frames and would dilute
 * renders/frame toward zero.
 *
 * GRID SHAPE IS A GATE, NOT A NOTE. Cost may only fall by doing less work per
 * cell, never by producing fewer cells: every scenario asserts the grid is
 * exactly `--expect-grid` (default 140x63, the shape the page renders at this
 * viewport) and the run FAILS otherwise. Lowering cols/rows, raising the cell
 * size or engaging `interactiveDownscale` would all "hit 60fps" while
 * delivering a visibly coarser map.
 *
 * VSYNC IS ON DELIBERATELY. asciiQuake ran with `--disable-frame-rate-limit`
 * because its replay drove one camera move per rAF at any rate; here two of the
 * three scenarios are input-driven, and an uncapped rAF turns their think-time
 * into thousands of phantom "displayed frames" (measured: 990 fps, renders/f
 * 0.03, meaningless). A displayed frame has to mean a displayed frame.
 *
 * FIDELITY DIGEST: pauses at fixed waypoints, settles, and hashes the `<pre>`'s
 * innerHTML (glyphs AND colours). RUN IT IN SPANS MODE. Under the default
 * `atlas` encoding a cell is a PUA code point encoding (glyph, palette-slot),
 * and the palette is median-cut over whatever grids the quantizer trained on —
 * so changing HOW MANY renders happen per frame permutes slot indices and two
 * builds painting identical colours get different digests. asciiQuake measured
 * exactly this: 85% of atlas cells "differing" on a byte-identical render.
 * `--encoding spans` (the default here) makes colours literal `#rrggbb`.
 *
 * NON-BLANK GUARD: an all-blank grid is fast and worthless. Every waypoint
 * asserts a non-blank cell ratio before any number counts.
 *
 * STAGE ATTRIBUTION: every marker of one render fires inside one synchronous
 * block, so the gap to the next marker is real work. Bursts are grouped from
 * `base-validate`, and the burst is closed by a microtask queued at that same
 * marker — which runs the instant `doRender()` returns, since `doRender` is
 * itself microtask-scheduled. Closing on the next rAF instead attributes idle
 * time to whichever stage happened to be last (asciiQuake method note #3).
 *
 * Usage:
 *   node bench/maps-render/mapsBench.mjs --url http://localhost:4323 [options]
 *
 *   --url <origin>       dev/preview server origin (required)
 *   --viewport WxH       default 1440x900
 *   --encoding <name>    spans | atlas                (default spans)
 *   --expect-grid CxR    required grid shape          (default 140x63)
 *   --scenario <name>    orbit | drag | wheel | flyto | all   (default all)
 *   --label <name>       row label
 *   --json <file>        write the full result as JSON
 *   --headed             real GPU. Headless software-renders and inflates
 *                        raster/paint; paint questions need --headed.
 *   --fidelity-only      digest only, skip the timing window
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path, { dirname } from "node:path";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? true);
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const URL_BASE = arg("url");
if (!URL_BASE) {
  console.error("mapsBench: --url is required (e.g. --url http://localhost:4323)");
  process.exit(2);
}
const [VW, VH] = String(arg("viewport", "1440x900")).split("x").map(Number);
const ENCODING = String(arg("encoding", "spans"));
const EXPECT_GRID = String(arg("expect-grid", "140x63"));
const SCENARIO = String(arg("scenario", "all"));
const LABEL = arg("label", "run");
/** Extra query string appended to `/maps/?bench=1`, e.g. `m=p1m2` (the page's
 *  own URL-state param) — the only way to drive page state the harness has no
 *  scenario for, such as a layer's own render mode. */
const QUERY = arg("query", null);
/** JSON `GlyphMapLayer` added through the page's own harness seam after load —
 *  the way to measure a layer shape no URL state reaches. Only a layer whose
 *  every field is JSON is expressible (`model` carries inline polygons; a
 *  `raster`/`fill` source is a live provider object and is not). */
const LAYER = arg("layer", null);
/** Comma-separated ids of the page's OWN demo layer cards to switch on before
 *  measuring (`fill`, `symbol`, `circle`, `heatmap`, `fill-extrusion`,
 *  `model`). Unlike `--layer`, this measures the layer AS THE PAGE SHIPS IT —
 *  real provider, real dataset, real defaults — which is the only honest way
 *  to price `symbol`/`circle`/`heatmap`/`fill`, whose `source` is a live
 *  provider object and therefore cannot be expressed as JSON. */
const DEMO_LAYERS = arg("demo-layer", null);
/** `id=dataset` pairs (comma-separated) selecting which baked point dataset a
 *  demo layer reads — e.g. `symbol=places`. Same seam, same reason. */
const DEMO_DATASETS = arg("demo-dataset", null);
/** The terrain raster layer's own per-mesh `density` (glyphcss detail
 *  resolution), set through the same seam. No URL state carries it, and at the
 *  default 1 every tile stays in the base grid — so this is the only way to
 *  price anything about detail-layer grouping. */
const TERRAIN_DENSITY = arg("terrain-density", null);
const JSON_OUT = arg("json", null);
const HEADED = hasFlag("headed");
const FIDELITY_ONLY = hasFlag("fidelity-only");

/** Fraction of cells that must be non-blank for a sample to count. */
const MIN_NONBLANK_RATIO = 0.2;

// ── The replay path. Fixed constants, no clock, no randomness. ─────────────
/** Displayed frames of continuous motion per scenario. */
const MOTION_FRAMES = 200;
/** Input events synthesized per displayed frame, each in its own task. */
const EVENTS_PER_FRAME = 2;
/** Globe rotation rate, degrees of longitude per displayed frame. */
const ORBIT_DEG_PER_FRAME = 0.75;
/** Drag arc: pixel offset from the stage centre at replay fraction `u`. */
const DRAG_RADIUS_PX = 260;
const DRAG_TURNS = 1.25;
/** Wheel sweep: deltaY per event, sign flipping every quarter of the run. */
const WHEEL_DELTA = 60;
/** Fly-to: from/to as [lon, lat, span]. A long cross-globe arc with a real
 *  span change at both ends, so tile LOD churns repeatedly mid-flight. */
const FLY_FROM = [0, 20, 140];
const FLY_TO = [8.2, 46.8, 6];
/** Waypoints the fidelity digest is captured at: [lon, lat, span]. */
const FIDELITY_STOPS = [
  [0, 20, 140], [90, 20, 140], [180, 20, 140], [-90, 20, 140],
  [8, 46.5, 40], [8, 46.5, 8], [8, 46.5, 2], [-70, -20, 200],
];

const { chromium } = await import("playwright");

const browser = await chromium.launch({ headless: !HEADED });
const page = await browser.newPage({ viewport: { width: VW, height: VH } });
const cdp = await page.context().newCDPSession(page);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));

await page.goto(`${URL_BASE}/maps/?bench=1${QUERY ? `&${QUERY}` : ""}`, { waitUntil: "load" });
await page.waitForFunction(() => Boolean(window.__glyphMapsBench?.map()), null, { timeout: 60000 });
// Both providers (terrain + borders) must land: the widget is REBUILT when the
// second resolves, so measuring before that measures a doomed instance.
await page.waitForTimeout(6000);
if (LAYER) {
  await page.evaluate((json) => window.__glyphMapsBench.map().addLayer(JSON.parse(json)), LAYER);
  await page.waitForTimeout(500);
}
if (DEMO_DATASETS) {
  await page.evaluate((pairs) => {
    for (const pair of pairs.split(",")) {
      const [id, dataset] = pair.split("=");
      window.__glyphMapsBench.setDemoDataset(id.trim(), dataset.trim());
    }
  }, DEMO_DATASETS);
}
if (DEMO_LAYERS) {
  await page.evaluate((ids) => {
    for (const id of ids.split(",")) window.__glyphMapsBench.setDemoLayer(id.trim(), true);
  }, DEMO_LAYERS);
  // A demo layer mounts its own provider tiles asynchronously (debounced 180ms
  // in the widget) and, for the mesh-backed ones, rebuilds geometry after —
  // long enough that a shorter wait would price an empty layer.
  await page.waitForTimeout(4000);
}
if (TERRAIN_DENSITY) {
  await page.evaluate((d) => window.__glyphMapsBench.setTerrainDensity(Number(d)), TERRAIN_DENSITY);
  // The layer is removed and re-added on a density change, then its tiles
  // remount — the same 4s settle a demo layer needs.
  await page.waitForTimeout(4000);
}
await page.evaluate((enc) => window.__glyphMapsBench.setColorEncoding(enc), ENCODING);
await page.waitForTimeout(1500);

// ── Instrumentation installed in-page ──────────────────────────────────────
await page.evaluate(() => {
  const B = { stageCounts: {}, stageMs: {}, frames: 0, renders: 0, renderMs: 0 };
  window.__bench = B;
  // glyphcss's own per-render probe (AGENTS.md / bench/README.md): `raster` =
  // project+shade+scan-fill+encode of the BASE pass, `dom` = its string stage,
  // `polys` = how many polygons that pass walked. Zero cost when unset.
  globalThis.__glyphPerf = { raster: [], dom: [], polys: [] };

  let last = null, lastT = 0, burstStart = 0, closing = false;
  const closeBurst = () => {
    if (last === null) return;
    const t = performance.now();
    B.stageMs[last] = (B.stageMs[last] || 0) + (t - lastT);
    B.renderMs += t - burstStart;
    last = null;
    closing = false;
  };
  globalThis.__glyphRenderStage = (s) => {
    const t = performance.now();
    B.stageCounts[s] = (B.stageCounts[s] || 0) + 1;
    if (s === "base-validate") {
      closeBurst();
      B.renders++;
      last = s; lastT = t; burstStart = t;
      if (!closing) { closing = true; queueMicrotask(closeBurst); }
      return;
    }
    if (last !== null) B.stageMs[last] = (B.stageMs[last] || 0) + (t - lastT);
    last = s; lastT = t;
  };
  B.closeBurst = closeBurst;

  const tick = () => { B.frames++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);

  window.__benchReset = () => {
    B.stageCounts = {}; B.stageMs = {}; B.frames = 0; B.renders = 0; B.renderMs = 0;
    globalThis.__glyphPerf.raster.length = 0;
    globalThis.__glyphPerf.dom.length = 0;
    globalThis.__glyphPerf.polys.length = 0;
  };
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  window.__benchSnapshot = () => ({ frames: B.frames, renders: B.renders, renderMs: B.renderMs,
    stages: { ...B.stageCounts }, stageMs: { ...B.stageMs },
    basePolys: Math.round(mean(globalThis.__glyphPerf.polys)),
    baseRasterMs: mean(globalThis.__glyphPerf.raster),
    baseDomMs: mean(globalThis.__glyphPerf.dom),
    basePasses: globalThis.__glyphPerf.polys.length });
  window.__benchGrid = () => {
    const pre = window.__glyphMapsBench.output();
    if (!pre) return null;
    // `text` stays the BASE grid alone — it is what the grid-shape gate
    // measures. Ink and the fidelity digest are taken over the base PLUS every
    // detail/overlay `<pre>` the scene produced: a layer mounted at
    // `density > 1` moves its geometry entirely out of the base grid, so a
    // base-only probe reads a blank map and a base-only digest would be blind
    // to every pixel that layer paints.
    const text = pre.textContent ?? "";
    const outs = [pre, ...pre.parentElement
      ? Array.from(pre.parentElement.querySelectorAll("pre.glyph-output--detail"))
      : []];
    let cells = 0, nonBlank = 0;
    const html = [];
    for (const el of outs) {
      const t = el.textContent ?? "";
      cells += t.replace(/\n/g, "").length;
      nonBlank += t.replace(/\s/g, "").length;
      html.push(el.style.transform, el.innerHTML);
    }
    return { text, html: html.join("\u0000"), cells, nonBlank };
  };
  window.__benchSetView = (lon, lat, span) =>
    window.__glyphMapsBench.setView(span === undefined ? { center: [lon, lat] } : { center: [lon, lat], span });
});

// ── Fidelity digest ────────────────────────────────────────────────────────
const domParts = [];
let minRatio = 1;
/**
 * Waits for QUIESCENCE, not for a fixed delay. A stop is only comparable once
 * its tiles have landed and the last render has committed, and a fixed timeout
 * is a race: two of the eight stops (the first, still warming, and the deepest
 * curated zoom) reported different digests run to run on renderer changes that
 * provably could not alter a pixel, purely because 700 ms sometimes was and
 * sometimes was not enough for the fetch behind them. Sampling until the
 * `<pre>` stops changing removes the timing variable instead of tuning it.
 */
async function settledGrid(label) {
  await page.evaluate(() => document.fonts.ready);
  let prev = null;
  for (let i = 0; i < 32; i++) {
    await page.waitForTimeout(250);
    const g = await page.evaluate(() => window.__benchGrid());
    if (!g || !g.cells) throw new Error(`mapsBench: no grid at ${label}`);
    if (prev !== null && g.html === prev.html) return g;
    prev = g;
  }
  throw new Error(`mapsBench: grid never settled at ${label} — a digest taken here would be a race, not a fidelity gate.`);
}

for (const [lon, lat, span] of FIDELITY_STOPS) {
  await page.evaluate(([a, b, c]) => window.__benchSetView(a, b, c), [lon, lat, span]);
  const g = await settledGrid(`stop ${lon},${lat},${span}`);
  minRatio = Math.min(minRatio, g.nonBlank / g.cells);
  domParts.push(createHash("sha256").update(g.html).digest("hex").slice(0, 16));
}
const fidelity = createHash("sha256").update(domParts.join("|")).digest("hex").slice(0, 24);

if (minRatio < MIN_NONBLANK_RATIO) {
  console.error(`mapsBench: FAILED non-blank guard — min ratio ${(minRatio * 100).toFixed(1)}%`
    + ` (< ${MIN_NONBLANK_RATIO * 100}%). Numbers would be meaningless.`);
  await browser.close();
  process.exit(1);
}

const result = { label: LABEL, encoding: ENCODING, viewport: `${VW}x${VH}`, headed: HEADED,
  fidelity, stopDigests: domParts, minNonBlankRatio: +minRatio.toFixed(4), scenarios: {} };

// ── Scenarios: every one is CONTINUOUS motion across MOTION_FRAMES displayed
//    frames, with input synthesized in-page at EVENTS_PER_FRAME separate tasks
//    per frame (see the header — this is what reproduces trackpad bursts). ───
await page.evaluate(({ frames, perFrame }) => {
  const host = window.__glyphMapsBench.map().host;
  const rect = () => host.getBoundingClientRect();
  const pointerEvt = (type, x, y) => new PointerEvent(type, {
    pointerId: 7, pointerType: "mouse", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1,
    clientX: x, clientY: y, bubbles: true, cancelable: true,
  });

  /** Run `onEvent(i, total)` for `perFrame` separate tasks on each of `frames`
   *  displayed frames, then resolve. Each event is its own task, so each drains
   *  its own microtask checkpoint — the real trackpad shape. */
  window.__benchDriveEvents = (onEvent) => new Promise((resolve) => {
    const total = frames * perFrame;
    let sent = 0, f = 0;
    const frame = () => {
      for (let k = 0; k < perFrame; k++) {
        const i = sent++;
        setTimeout(() => onEvent(i, total), 0);
      }
      if (++f >= frames) { setTimeout(resolve, 120); return; }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });

  window.__benchOrbit = (degPerFrame) => new Promise((resolve) => {
    let i = 0, lon = 0;
    const step = () => {
      lon = ((lon + degPerFrame + 180) % 360) - 180;
      window.__glyphMapsBench.setView({ center: [lon, 20] });
      if (++i >= frames) { resolve(); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  window.__benchDrag = (radius, turns) => {
    const r = rect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const at = (u) => {
      const a = u * turns * 2 * Math.PI;
      // An outward spiral: a continuous arc with no corner a coalescer could
      // hide behind, and it never returns to the same pose twice.
      const rad = radius * (0.25 + 0.75 * u);
      return [cx + rad * Math.cos(a), cy + rad * Math.sin(a) * 0.55];
    };
    const [x0, y0] = at(0);
    host.dispatchEvent(pointerEvt("pointerdown", x0, y0));
    return window.__benchDriveEvents((i, total) => {
      const [x, y] = at((i + 1) / total);
      host.dispatchEvent(pointerEvt("pointermove", x, y));
      if (i === total - 1) host.dispatchEvent(pointerEvt("pointerup", x, y));
    });
  };

  window.__benchWheel = (delta) => {
    const r = rect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return window.__benchDriveEvents((i, total) => {
      // In, out, in, out — a continuous sweep that stays inside the span clamps.
      const dir = Math.floor((4 * i) / total) % 2 === 0 ? -1 : 1;
      host.dispatchEvent(new WheelEvent("wheel", {
        deltaY: dir * delta, deltaMode: 0, clientX: cx, clientY: cy, bubbles: true, cancelable: true,
      }));
    });
  };

  // Fly-to. Uses the widget's own `flyTo` when the build has one; otherwise the
  // per-frame `setView({ center, span })` a caller has to write today. Same
  // path, same waypoints, so before/after stay comparable.
  window.__benchHasFlyTo = () => typeof window.__glyphMapsBench.map().flyTo === "function";
  window.__benchFlyTo = (from, to, durationMs) => {
    const map = window.__glyphMapsBench.map();
    map.setView({ center: [from[0], from[1]], span: from[2] });
    if (typeof map.flyTo === "function") {
      return map.flyTo({ center: [to[0], to[1]], span: to[2] }, { durationMs });
    }
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = () => {
        const u = Math.min(1, (performance.now() - t0) / durationMs);
        const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; // easeInOutQuad
        // Match `flyTo`'s own arc: ease centre, and bow the span outward at
        // mid-flight so a cross-globe move never skims at full detail.
        const bow = 1 + 3 * Math.sin(Math.PI * e);
        const span = Math.exp(Math.log(from[2]) + (Math.log(to[2]) - Math.log(from[2])) * e) * bow;
        map.setView({ center: [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e], span });
        if (u < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
  };
}, { frames: MOTION_FRAMES, perFrame: EVENTS_PER_FRAME });

const hasFlyTo = await page.evaluate(() => window.__benchHasFlyTo());

async function measure(name, run) {
  await page.evaluate(([lon, lat, span]) => window.__glyphMapsBench.setView({ center: [lon, lat], span }), FLY_FROM);
  await page.waitForTimeout(900);
  const m0 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
  await page.evaluate(() => window.__benchReset());
  const wall0 = Date.now();
  await run();
  const wall = (Date.now() - wall0) / 1000;
  const b = await page.evaluate(() => { window.__bench.closeBurst(); return window.__benchSnapshot(); });
  const m1 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));

  const guard = await page.evaluate(() => window.__benchGrid());
  if (guard.nonBlank / guard.cells < MIN_NONBLANK_RATIO) {
    console.error(`mapsBench: grid went blank during "${name}"; discarding.`);
    await browser.close();
    process.exit(1);
  }
  const grid = `${guard.text.split("\n")[0].length}x${guard.text.split("\n").length}`;
  // GATE, not a note: cost may only fall by doing less work per cell, never by
  // producing fewer cells.
  if (grid !== EXPECT_GRID) {
    console.error(`mapsBench: FAILED grid gate in "${name}" — rendered ${grid}, expected ${EXPECT_GRID}.`
      + ` A cheaper frame at a coarser grid is not an optimization.`);
    await browser.close();
    process.exit(1);
  }
  const per = (k) => ((m1[k] - m0[k]) * 1000) / b.frames;
  const task = per("TaskDuration"), script = per("ScriptDuration");
  const layout = per("LayoutDuration"), style = per("RecalcStyleDuration");
  const stageMsPerRender = Object.fromEntries(Object.entries(b.stageMs)
    .sort((x, y) => y[1] - x[1]).map(([k, v]) => [k, +(v / Math.max(1, b.renders)).toFixed(3)]));
  result.scenarios[name] = {
    wallSec: +wall.toFixed(2), frames: b.frames, renders: b.renders,
    fps: +(b.frames / wall).toFixed(1),
    msPerFrame: { task: +task.toFixed(3), script: +script.toFixed(3), layout: +layout.toFixed(3),
                  style: +style.toFixed(3), other: +(task - script - layout - style).toFixed(3) },
    // A full render pass starts at `base-validate`; >1 per displayed frame is
    // discarded work — every render but the last of a frame is never painted.
    rendersPerFrame: +(b.renders / Math.max(1, b.frames)).toFixed(2),
    writesPerFrame: +((b.stages["commit-write"] ?? 0) / Math.max(1, b.frames)).toFixed(2),
    msPerRender: +(b.renderMs / Math.max(1, b.renders)).toFixed(3),
    basePolys: b.basePolys, basePasses: b.basePasses,
    baseRasterMs: +b.baseRasterMs.toFixed(3), baseDomMs: +b.baseDomMs.toFixed(3),
    stageMsPerRender, stageCounts: b.stages,
    grid, cells: guard.cells,
  };
}

if (!FIDELITY_ONLY) {
  await cdp.send("Performance.enable");
  const want = (n) => SCENARIO === "all" || SCENARIO === n;
  if (want("orbit")) await measure("orbit", () => page.evaluate((d) => window.__benchOrbit(d), ORBIT_DEG_PER_FRAME));
  if (want("drag")) await measure("drag", () => page.evaluate(([r, t]) => window.__benchDrag(r, t), [DRAG_RADIUS_PX, DRAG_TURNS]));
  if (want("wheel")) await measure("wheel", () => page.evaluate((d) => window.__benchWheel(d), WHEEL_DELTA));
  if (want("flyto")) await measure("flyto", () => page.evaluate(([f, t]) => window.__benchFlyTo(f, t, 3000), [FLY_FROM, FLY_TO]));
}
result.flyToApi = hasFlyTo;

result.pageErrors = errors.slice(0, 5);
await browser.close();

console.log(`${LABEL}  (${ENCODING}, ${VW}x${VH}, ${HEADED ? "headed" : "headless"}, flyTo API ${hasFlyTo ? "yes" : "no — driven by per-frame setView"})  fidelity ${fidelity}`);
for (const [name, s] of Object.entries(result.scenarios)) {
  const m = s.msPerFrame;
  console.log(`  ${name.padEnd(6)} ${s.grid.padStart(8)}  fps ${String(s.fps).padStart(5)}  `
    + `task ${String(m.task).padStart(6)}  script ${String(m.script).padStart(6)}  layout ${String(m.layout).padStart(5)}  `
    + `other ${String(m.other).padStart(6)}  renders/f ${String(s.rendersPerFrame).padStart(5)}  ms/render ${String(s.msPerRender).padStart(6)}`);
  console.log(`         stage ms/render: ` + Object.entries(s.stageMsPerRender)
    .filter(([, v]) => v >= 0.02).map(([k, v]) => `${k} ${v}`).join("  "));
  console.log(`         base pass: polys ${s.basePolys}  raster ${s.baseRasterMs}ms  dom ${s.baseDomMs}ms  passes ${s.basePasses}`);
}
if (errors.length) console.log(`  page errors: ${errors.length} (first: ${errors[0]?.slice(0, 160)})`);
if (JSON_OUT) { mkdirSync(dirname(path.resolve(JSON_OUT)), { recursive: true }); writeFileSync(JSON_OUT, JSON.stringify(result, null, 2)); }
