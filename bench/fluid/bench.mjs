// Real-time perf of the @glyphcss/fluid bench page — the spike's bench.mjs (feat/fluid,
// bench/fluid-spike) pointed at the package: same setups, scenarios and trace analysis.
// node bench.mjs <out.json> [--warm s] [--secs s] [--setups a,b] [--throttle 1,4]
//                [--fps 30|60] [--configs atlas,atlas+w] [--scenarios idle,stirred] [--moltys off]
//                [--face dots|universal]
// "atlas" = main-thread pipeline (?worker=0), "atlas+w" = worker pipeline.
// "stirred" holds the pointer down and drags it along a Lissajous path for the whole window.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const OUT = argv[0];
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const WARM = Number(opt("warm", 6)), SECS = Number(opt("secs", 8));
const SETUPS_ALL = {
  desktop: { viewport: { width: 1440, height: 900 }, dpr: 1 },
  desktop2x: { viewport: { width: 1440, height: 900 }, dpr: 2 },
  phone: { viewport: { width: 390, height: 844 }, dpr: 2, mobile: true },
};
const setups = opt("setups", "desktop,desktop2x,phone").split(",");
const configs = opt("configs", "atlas,atlas+w").split(",");
const scenarios = opt("scenarios", "idle").split(",");
const FPS = Number(opt("fps", 60));
const query = (c) => `fps=${FPS}&worker=${c.includes("+w") ? 1 : 0}`;
const throttles = opt("throttle", "1,4").split(",").map(Number);
const moltys = opt("moltys", "on");
const face = opt("face", "dots");

const MAIN_RENDER = new Set(["UpdateLayoutTree", "Layout", "PrePaint", "Paint", "Layerize", "Commit", "ParseHTML"]);
const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0);
const sum = (a) => a.reduce((x, y) => x + y, 0);

function analyse(events, wallMs) {
  const threads = new Map(); // `${pid}:${tid}` -> name
  const procs = new Map();
  for (const e of events) {
    if (e.ph === "M" && e.name === "thread_name") threads.set(`${e.pid}:${e.tid}`, e.args.name);
    if (e.ph === "M" && e.name === "process_name") procs.set(e.pid, e.args.name);
  }
  // the page's renderer main thread = the CrRendererMain with the most FireAnimationFrame events
  const fafBy = new Map();
  for (const e of events) if (e.name === "FireAnimationFrame" && e.ph === "X") fafBy.set(`${e.pid}:${e.tid}`, (fafBy.get(`${e.pid}:${e.tid}`) ?? 0) + 1);
  const mainKey = [...fafBy.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const rendererPid = Number(mainKey?.split(":")[0]);
  const X = events.filter((e) => e.ph === "X" && typeof e.dur === "number");
  const main = X.filter((e) => `${e.pid}:${e.tid}` === mainKey).sort((a, b) => a.ts - b.ts);
  const by = (name) => sum(main.filter((e) => e.name === name).map((e) => e.dur)) / 1000;
  const cat = {
    rafScript: by("FireAnimationFrame"),
    style: by("UpdateLayoutTree"),
    layout: by("Layout"),
    prePaint: by("PrePaint"),
    paint: by("Paint"),
    layerize: by("Layerize"),
    commit: by("Commit"),
  };
  const mainBusy = sum(main.filter((e) => e.name === "ThreadControllerImpl::RunTask" || e.name === "RunTask").map((e) => e.dur)) / 1000;
  // raster workers in the renderer
  const raster = sum(X.filter((e) => e.pid === rendererPid && /CompositorTileWorker/.test(threads.get(`${e.pid}:${e.tid}`) ?? "") && e.name === "RasterTask").map((e) => e.dur)) / 1000;
  const compositor = sum(X.filter((e) => e.pid === rendererPid && (threads.get(`${e.pid}:${e.tid}`) ?? "") === "Compositor" && (e.name === "ThreadControllerImpl::RunTask" || e.name === "RunTask")).map((e) => e.dur)) / 1000;
  // GPU process: busy time of its top-level tasks (all threads)
  const gpuPid = [...procs.entries()].find(([, n]) => /GPU/i.test(n))?.[0];
  const gpu = sum(X.filter((e) => e.pid === gpuPid && (e.name === "ThreadControllerImpl::RunTask" || e.name === "RunTask")).map((e) => e.dur)) / 1000;
  // per drawn frame: rAF callback + the rendering update that follows it
  const fafs = main.filter((e) => e.name === "FireAnimationFrame");
  // drawing rAFs carry performance.mark("fluid-draw") (blink.user_timing; console.timeStamp
  // emitted nothing in this Chrome); bundles without it fall back to a duration cut
  const marks = events.filter((e) => e.name === "fluid-draw" && `${e.pid}:${e.tid}` === mainKey).map((e) => e.ts);
  const drew = (f) => (marks.length ? marks.some((t) => t >= f.ts && t <= f.ts + f.dur) : f.dur >= 300);
  const frameCost = [];
  // This page runs two rAF callbacks per frame (the fluid's and the page's Molty clock), so a
  // drawn frame spans from the fluid's callback to the end of the frame's Commit: every rAF
  // callback in that window plus the rendering update, not just up to the next callback.
  const commits = main.filter((e) => e.name === "Commit");
  for (let i = 0; i < fafs.length; i++) {
    const f = fafs[i];
    if (!drew(f)) continue; // a throttled rAF (or worker stall) that did not draw
    const commit = commits.find((e) => e.ts >= f.ts + f.dur);
    const end = commit ? commit.ts + commit.dur : (fafs[i + 1]?.ts ?? Infinity);
    let c = 0;
    for (const e of main) if (e.ts >= f.ts && e.ts < end && (e.name === "FireAnimationFrame" || MAIN_RENDER.has(e.name))) c += e.dur;
    frameCost.push(c / 1000);
  }
  // dedicated worker threads in the page's renderer (the ?worker=1 sim)
  const workerKeys = new Set([...threads.entries()].filter(([k, n]) => Number(k.split(":")[0]) === rendererPid && /DedicatedWorker/.test(n)).map(([k]) => k));
  // union of task intervals (RunTask and ThreadControllerImpl::RunTask nest, so a plain sum double-counts)
  const wt = X.filter((e) => workerKeys.has(`${e.pid}:${e.tid}`) && (e.name === "ThreadControllerImpl::RunTask" || e.name === "RunTask")).sort((a, b) => a.ts - b.ts);
  let workerBusy = 0, cur = -Infinity;
  for (const e of wt) {
    const a0 = Math.max(e.ts, cur), a1 = e.ts + e.dur;
    if (a1 > a0) workerBusy += a1 - a0;
    cur = Math.max(cur, a1);
  }
  workerBusy /= 1000;
  const perSec = (ms) => (ms / wallMs) * 1000;
  return {
    drawnFrames: frameCost.length,
    frameP50: pct(frameCost, 50), frameP95: pct(frameCost, 95), frameMax: Math.max(0, ...frameCost),
    mainBusyPct: (mainBusy / wallMs) * 100,
    perSecMs: Object.fromEntries(Object.entries({ ...cat, raster, compositor, gpu }).map(([k, v]) => [k, perSec(v)])),
    perFrameMs: Object.fromEntries(Object.entries({ ...cat, raster, gpu, worker: workerBusy }).map(([k, v]) => [k, frameCost.length ? v / frameCost.length : 0])),
    workerThreads: workerKeys.size,
    marks: marks.length, marksOutsideRaf: marks.filter((t) => !fafs.some((f) => t >= f.ts && t <= f.ts + f.dur)).length,
  };
}

const b = await chromium.launch({ channel: "chrome" });
const results = [];
for (const s of setups) {
  const S = SETUPS_ALL[s];
  for (const thr of throttles)
    for (const scenario of scenarios)
    for (const v of configs) {
      const ctx = await b.newContext({ viewport: S.viewport, deviceScaleFactor: S.dpr, isMobile: !!S.mobile, hasTouch: !!S.mobile });
      const p = await ctx.newPage();
      p.on("pageerror", (e) => console.error(v, "pageerror", e.message));
      const cdp = await ctx.newCDPSession(p);
      await cdp.send("Performance.enable");
      if (thr > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: thr });
      await p.goto(`http://127.0.0.1:${process.env.FLUID_BENCH_PORT ?? 4361}/?${query(v)}&hud=0&moltys=${moltys}&face=${face}`);
      await p.waitForFunction(() => window.__fluid, null, { timeout: 30000 });
      await p.waitForTimeout(WARM * 1000);
      const m0 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
      const events = [];
      cdp.on("Tracing.dataCollected", (d) => events.push(...d.value));
      await cdp.send("Tracing.start", {
        categories: "blink.user_timing,devtools.timeline,disabled-by-default-devtools.timeline,toplevel,cc,gpu,viz,blink",
        transferMode: "ReportEvents",
      });
      let stirring = null, moves = 0;
      if (scenario === "stirred") {
        const { width: W, height: H } = S.viewport;
        await p.mouse.move(W / 2, H / 2);
        await p.mouse.down();
        let stop = false;
        const s0 = Date.now();
        stirring = (async () => {
          while (!stop) {
            const t = (Date.now() - s0) / 1000; // path is a function of wall time: same speed whatever the input latency
            await p.mouse.move(W * (0.5 + 0.4 * Math.sin(t * 1.3)), H * (0.5 + 0.35 * Math.sin(t * 2.1)));
            moves++;
          }
          await p.mouse.up();
        })();
        stirring.stop = () => (stop = true);
        await p.waitForTimeout(500);
      }
      await p.evaluate(() => window.__fluid.reset());
      const w0 = Date.now();
      await p.waitForTimeout(SECS * 1000);
      const stats = await p.evaluate(() => window.__fluid.stats());
      const wall = Date.now() - w0;
      if (stirring) {
        stirring.stop();
        await stirring;
      }
      const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
      await cdp.send("Tracing.end");
      await done;
      const m1 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
      const dm = (k) => ((m1[k] - m0[k]) * 1000) / (m1.Timestamp - m0.Timestamp) / 1000; // s per s
      const trace = analyse(events, wall);
      const r = {
        setup: s, throttle: thr, variant: v, config: v, scenario, fps: FPS, moves, moltys, wallMs: wall, stats, trace,
        metrics: {
          taskPct: dm("TaskDuration") * 100, scriptPct: dm("ScriptDuration") * 100,
          stylePct: dm("RecalcStyleDuration") * 100, layoutPct: dm("LayoutDuration") * 100,
          jsHeapMB: m1.JSHeapUsedSize / 1048576, nodes: m1.Nodes,
        },
      };
      results.push(r);
      writeFileSync(OUT, JSON.stringify(results, null, 1));
      console.log(
        `${s} x${thr} ${scenario.padEnd(7)} ${v.padEnd(12)} ${stats.pipeline} dropped ${(stats.droppedPct ?? 0).toFixed(1)}% stalls ${stats.stalls ?? 0} step ${(stats.stepMs ?? 0).toFixed(2)}/${trace.perFrameMs.worker.toFixed(2)} moves ${moves} | frame p50 ${trace.frameP50.toFixed(1)} p95 ${trace.frameP95.toFixed(1)} | main ${r.metrics.taskPct.toFixed(0)}% | style ${trace.perFrameMs.style.toFixed(2)} layout ${trace.perFrameMs.layout.toFixed(2)} paint ${trace.perFrameMs.paint.toFixed(2)} raster ${trace.perFrameMs.raster.toFixed(2)} gpu ${trace.perFrameMs.gpu.toFixed(2)} | drawn ${trace.drawnFrames} iv95 ${stats.intervalP95.toFixed(0)} | heap ${r.metrics.jsHeapMB.toFixed(1)}MB nodes ${r.metrics.nodes}`,
      );
      await ctx.close();
    }
}
await b.close();
