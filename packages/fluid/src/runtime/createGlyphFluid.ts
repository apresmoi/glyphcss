// The standalone fluid surface: one <pre>, one textContent write per drawn frame. DOM
// targets are measured on layout changes only; each frame composes them into a packed
// target frame and hands it, with the queued sim ops, to a pipeline (worker or main).
import { ensureGlyphAtlasFontFaceStyles, GLYPH_FONT_ATLAS } from "glyphcss";
import type { GlyphFluidTuning } from "../sim/sim";
import type { GlyphFluidOp, GlyphFluidStepParams, RGB } from "../sim/ops";
import { glyphFluidPaletteCss, type GlyphFluidEncoding, type GlyphFluidFrame } from "../cells/encode";
import { createGlyphFluidTargetFrame } from "../targets/frame";
import { measureGlyphFluidZone, writeGlyphFluidZones, type GlyphFluidZoneBox, type GlyphFluidZoneOptions } from "../targets/zones";
import { parseHexColor, type GlyphFluidLayout, type GlyphFluidTargetImpl, type GlyphFluidTargetSpec } from "../targets/types";
import { GlyphFluidMainPipeline, GlyphFluidWorkerPipeline, type GlyphFluidPipeline } from "./pipeline";
import type { GlyphFluidCoreInit } from "./core";
import { createGlyphFluidFpsGovernor } from "./fps";

export interface GlyphFluidGridOptions {
  /** Cell height / width. Default 1.6. */
  cellAspect?: number;
  /** Columns the grid aims for. Default 144. */
  targetCols?: number;
  /** Cell width bounds in CSS px. Default 5.4 / 10. */
  minCellPx?: number;
  maxCellPx?: number;
  /** Column cap. Default 176. */
  maxCols?: number;
}

export interface GlyphFluidOptions {
  grid?: GlyphFluidGridOptions;
  /** Default `"atlas"`. */
  encoding?: Exclude<GlyphFluidEncoding, "plain">;
  /** Frame cap. Default 60; drops to 30 for the session when frames keep missing. */
  fps?: 60 | 30;
  /** Allow the automatic 60 → 30 drop. Default true. */
  fpsFallback?: boolean;
  /**
   * Where the sim runs. `"auto"` (default) starts the package's worker and falls back to
   * the main thread if it cannot; `false` = main thread; a function supplies your own
   * Worker running `@glyphcss/fluid/worker` (bundlers that cannot resolve the default).
   */
  worker?: "auto" | false | (() => Worker);
  /** `"auto"` (default) runs on requestAnimationFrame; `"manual"` draws only on `step(dt)`. */
  clock?: "auto" | "manual";
  /** The dim field: colour (`#rrggbb`, default `#6f8f82`) and floor level (default 0.18). */
  field?: { color?: string; level?: number };
  /** Sim tunables over molty's defaults. */
  tuning?: Partial<GlyphFluidTuning>;
  /**
   * `"host"` (default): the grid fills the host box. `"document"`: the host is a fixed,
   * viewport-sized layer and the fluid is glued to the document, scrolling by whole rows.
   */
  glue?: "host" | "document";
  /** Under `prefers-reduced-motion`: `"settle"` (default) draws still, settled frames; `"animate"` ignores it. */
  reducedMotion?: "settle" | "animate";
  /** Pointer stirring: `"host"` (default), `"window"` or `"none"`. */
  pointer?: "host" | "window" | "none";
  /** Dither shimmer amplitude. Default 0.12. */
  shimmer?: number;
  /**
   * `"rect"` (default) fills the host. `"circle"`: molty's round device screen, the disc
   * inscribed in the grid (a circle in a square host); cells outside it stay blank.
   */
  shape?: "rect" | "circle";
}

/** A live target: toggles condense (flow in) / melt (flow out); each change kicks the fluid. */
export interface GlyphFluidTarget {
  readonly enabled: boolean;
  condense(): void;
  melt(): void;
  remove(): void;
}

export interface GlyphFluidZone {
  remove(): void;
}

export interface GlyphFluidStats {
  fps: 60 | 30;
  pipeline: "worker" | "main";
  encoding: GlyphFluidEncoding;
  cols: number;
  rows: number;
  /** Frames written since creation. */
  frames: number;
  /** Vsyncs skipped because the worker had not answered. */
  stalls: number;
  /** In-pipeline ms of the last step (sim + cells + encode). */
  stepMs: number;
  lit: number;
}

export interface GlyphFluid {
  /** Resolves once the font is loaded and the first layout is done. */
  readonly ready: Promise<void>;
  addTarget(spec: GlyphFluidTargetSpec): GlyphFluidTarget;
  addZone(zone: GlyphFluidZoneOptions): GlyphFluidZone;
  /** A ripple at client coordinates. */
  impulse(clientX: number, clientY: number, opts?: { strength?: number; radius?: number }): void;
  /** Push the flow at client coordinates by a CSS-px displacement (a pointer-move delta). */
  push(clientX: number, clientY: number, dx: number, dy: number, opts?: { radius?: number }): void;
  /** `clock: "manual"`: advance by `dt` seconds and draw. */
  step(dt: number): void;
  /** Re-measure the grid, targets and zones (call after layout changes the observers miss). */
  relayout(): void;
  stats(): GlyphFluidStats;
  destroy(): void;
}

const MARGIN = 4;
const DEFAULT_FIELD = "#6f8f82";
let instances = 0;

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

interface LiveTarget { impl: GlyphFluidTargetImpl; enabled: boolean; on: boolean }

export function createGlyphFluid(host: HTMLElement, options: GlyphFluidOptions = {}): GlyphFluid {
  const grid = { cellAspect: 1.6, targetCols: 144, minCellPx: 5.4, maxCellPx: 10, maxCols: 176, ...options.grid };
  const fieldHex = options.field?.color ?? DEFAULT_FIELD;
  const fieldColor = parseHexColor(fieldHex, "field.color") as RGB;
  const fieldLevel = options.field?.level ?? 0.18;
  const glue = options.glue ?? "host";
  const manual = options.clock === "manual";
  const shimmer = options.shimmer ?? 0.12;
  const reduced =
    (options.reducedMotion ?? "settle") === "settle" &&
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  let encoding: GlyphFluidEncoding = options.encoding ?? "atlas";
  const governor = createGlyphFluidFpsGovernor(options.fps ?? 60, options.fpsFallback ?? true);
  // The random part keeps names unique when the package is bundled twice (the `./reader`
  // entry carries its own copy of this module, and with it its own counter).
  const paletteName = `--glyph-fluid-${++instances}-${Math.random().toString(36).slice(2, 8)}`;

  // ---- DOM: host > stack > (style, pre) ----
  const restore: Array<() => void> = [];
  const hs = getComputedStyle(host);
  if (hs.position === "static" || hs.position === "") {
    host.style.position = "relative";
    restore.push(() => (host.style.position = ""));
  }
  if (hs.overflow !== "hidden") {
    const prev = host.style.overflow;
    host.style.overflow = "hidden";
    restore.push(() => (host.style.overflow = prev));
  }
  const stack = document.createElement("div");
  stack.style.cssText = "position:absolute;top:0;left:0;will-change:transform;pointer-events:none;";
  const style = document.createElement("style");
  const pre = document.createElement("pre");
  pre.setAttribute("aria-hidden", "true");
  pre.style.cssText =
    "margin:0;padding:0;overflow:visible;white-space:pre;font-kerning:none;font-variant-ligatures:none;letter-spacing:0;contain:strict;";
  stack.append(style, pre);
  host.append(stack);

  // ---- state ----
  let pipeline: GlyphFluidPipeline | null = null;
  let cols = 0, rows = 0, cw = 10, ch = 16, r0 = 0;
  let advance = 0.6;
  let originX = 0, originY = 0;
  const targets: LiveTarget[] = [];
  const zones: Array<{ opts: GlyphFluidZoneOptions; box: GlyphFluidZoneBox | null }> = [];
  let ops: GlyphFluidOp[] = [];
  let t = 0, breathPh = 0, lastEvent = 0, lastDraw = 0, last = 0;
  let frames = 0, stalls = 0, lit = 0, raf = 0, destroyed = false, started = false;
  let paletteGen = -1;
  let settleDirty = true;
  const pointer = { x: 0, y: 0, px: NaN, py: NaN, moved: false };
  const disposers: Array<() => void> = [];

  const layoutCtx = (): GlyphFluidLayout => ({ cw, ch, originX, originY });

  function readOrigin(): void {
    const r = host.getBoundingClientRect();
    originX = r.left;
    originY = glue === "document" ? -window.scrollY : r.top;
  }

  function coreInit(): GlyphFluidCoreInit {
    return { cols, rows, cellW: cw, cellH: ch, fieldColor, fieldLevel, tuning: options.tuning ?? {}, encoding, monoColor: fieldHex, shape: options.shape ?? "rect" };
  }

  function makePipeline(): GlyphFluidPipeline {
    if (reduced || options.worker === false || typeof Worker === "undefined") return new GlyphFluidMainPipeline();
    try {
      const w =
        typeof options.worker === "function"
          ? options.worker()
          : new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
      return new GlyphFluidWorkerPipeline(w, () => fallBackToMain());
    } catch {
      return new GlyphFluidMainPipeline();
    }
  }

  function fallBackToMain(): void {
    if (destroyed || pipeline?.kind === "main") return;
    pipeline?.dispose();
    pipeline = new GlyphFluidMainPipeline();
    if (cols) pipeline.init(coreInit());
    ops = [];
    // a new encoder counts palette generations from zero again
    paletteGen = -1;
  }

  function layout(): void {
    if (destroyed) return;
    const vw = host.clientWidth;
    const vh = glue === "document" ? window.innerHeight : host.clientHeight;
    if (vw <= 0 || vh <= 0) return;
    const nc = Math.max(4, Math.min(grid.maxCols, Math.round(vw / Math.max(grid.minCellPx, Math.min(grid.maxCellPx, vw / grid.targetCols)))));
    const ncw = vw / nc, nch = ncw * grid.cellAspect;
    const nr = glue === "document" ? Math.ceil(vh / nch) + 2 * MARGIN + 1 : Math.max(4, Math.ceil(vh / nch));
    if (nc !== cols || nr > rows || (glue === "host" && nr !== rows) || Math.abs(ncw - cw) > 0.01) {
      cols = nc; rows = nr; cw = ncw; ch = nch;
      r0 = glue === "document" ? Math.floor(window.scrollY / ch) - MARGIN : 0;
      pipeline ??= makePipeline();
      pipeline.init(coreInit());
      ops = [];
      pre.style.fontSize = `${cw / advance}px`;
      pre.style.lineHeight = `${ch}px`;
      pre.style.width = `${cols * cw}px`;
      pre.style.height = `${rows * ch}px`;
      paletteGen = -1;
    }
    measure();
    place();
  }

  function measure(): void {
    if (!cols) return;
    readOrigin();
    const ctx = layoutCtx();
    for (const lt of targets) lt.impl.measure(ctx);
    for (const z of zones) z.box = measureGlyphFluidZone(z.opts, ctx);
    settleDirty = true;
  }

  function place(): void {
    const y = glue === "document" ? r0 * ch - window.scrollY : 0;
    stack.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
  }

  function gridTop(): number {
    return glue === "document" ? r0 * ch - window.scrollY : host.getBoundingClientRect().top;
  }

  function toStage(cx: number, cy: number): [number, number] {
    const left = host.getBoundingClientRect().left;
    return [((cx - left) / (cols * cw)) * 2 - 1, ((cy - gridTop()) / (rows * ch)) * 2 - 1];
  }

  function cellToStage(i: number, j: number): [number, number] {
    return [((i + 0.5) / cols) * 2 - 1, ((j - r0 + 0.5) / rows) * 2 - 1];
  }

  function event(i: number, j: number, strength: number): void {
    lastEvent = t;
    settleDirty = true;
    if (reduced) return;
    ops.push(["kick", 1.2]);
    const [x, y] = cellToStage(i, j);
    ops.push(["impulse", x, y, strength, 0.06]);
  }

  function scrollRows(): void {
    if (glue !== "document") return;
    const want = Math.floor(window.scrollY / ch) - MARGIN, d = want - r0;
    if (!d) return;
    r0 = want;
    ops.push(["scroll", d]);
    settleDirty = true;
  }

  function inView(j0: number, h: number): boolean {
    const mid = originY + (j0 + h / 2) * ch;
    return mid > window.innerHeight * 0.07 && mid < window.innerHeight * 0.95;
  }

  function stir(dt: number): void {
    if (!pointer.moved || reduced) return;
    pointer.moved = false;
    const dx = pointer.x - pointer.px, dy = pointer.y - pointer.py;
    pointer.px = pointer.x;
    pointer.py = pointer.y;
    if (Number.isNaN(dx)) return;
    const speed = Math.hypot(dx, dy) / Math.max(dt, 1 / 60);
    if (speed < 20 || speed > 20000) return;
    const [x, y] = toStage(pointer.x, pointer.y);
    ops.push(["impulse", x, y, 0.35 * Math.min(1, speed / 1600), 0.03]);
    ops.push(["push", x, y, (dx / cw) * 0.5, (dy / cw) * 0.5, 0.05]);
  }

  function write(frame: GlyphFluidFrame): void {
    if (frame.paletteGeneration !== paletteGen && encoding !== "plain") {
      paletteGen = frame.paletteGeneration;
      style.textContent = glyphFluidPaletteCss(paletteName, frame.palette);
    }
    pre.textContent = frame.text;
    lit = frame.drawn;
    frames++;
  }

  /** One frame: targets → pipeline → write. */
  function drawFrame(dt: number): void {
    if (!pipeline || !cols) return;
    t += dt;
    breathPh += dt / 4;
    const breath = 0.5 - 0.5 * Math.cos(breathPh * Math.PI * 2), swell = 1 + 0.04 * (breath * 2 - 1);
    if (glue === "document") originY = -window.scrollY;
    else readOrigin();
    scrollRows();
    place();
    stir(dt);
    const frame = createGlyphFluidTargetFrame(cols, rows, pipeline.targetBuffer());
    frame.T.fill(0);
    frame.TF.fill(0);
    frame.TA.fill(0);
    for (const lt of targets) {
      const b = lt.impl.box();
      if (!b) continue;
      const o = lt.impl.options;
      const want = lt.enabled && t >= o.delay && (o.visibility === "always" || inView(b.j0, b.h));
      if (want !== lt.on) {
        lt.on = want;
        event(b.i0 + b.w / 2, b.j0 + b.h / 2, want ? lt.impl.strengthOn : lt.impl.strengthOff);
      }
      if (lt.impl.changed?.()) settleDirty = true;
      if (!lt.on) continue;
      lt.impl.update(dt);
      lt.impl.write(frame, r0, swell);
    }
    writeGlyphFluidZones(frame, zones.flatMap((z) => (z.box ? [z.box] : [])), r0);
    const params: GlyphFluidStepParams = { t, breath, dt, hold: smooth((t - lastEvent - 0.4) / 1.0) };
    const input = { ops, params, targets: frame.packed, shimmer };
    ops = [];
    if (reduced) {
      if (!settleDirty) return;
      settleDirty = false;
      write((pipeline as GlyphFluidMainPipeline).settle(input, 120));
      return;
    }
    const out = pipeline.submit(input);
    if (out) write(out);
  }

  function tick(now: number): void {
    raf = requestAnimationFrame(tick);
    // 3 ms of slack: rAF timestamps jitter around the vsync the cap is aiming for
    if (lastDraw && now - lastDraw < 1000 / governor.fps - 3) return;
    if (pipeline?.busy()) {
      stalls++;
      return;
    }
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / governor.fps;
    last = now;
    governor.drawn(now);
    lastDraw = now;
    drawFrame(dt);
  }

  function listen(): void {
    const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      disposers.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    let resizeTimer = 0;
    on(window, "resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(layout, 150);
    });
    disposers.push(() => clearTimeout(resizeTimer));
    if (glue === "document") on(window, "scroll", place, { passive: true });
    const pt = options.pointer ?? "host";
    if (pt !== "none") {
      const el = pt === "window" ? window : host;
      on(el, "pointermove", (e) => {
        pointer.x = e.clientX;
        pointer.y = e.clientY;
        pointer.moved = true;
      });
      on(el, "pointerdown", (e) => api.impulse(e.clientX, e.clientY));
    }
    if (typeof ResizeObserver !== "undefined") {
      // host glue: the host's size IS the grid, so a resize re-lays out; document glue: the
      // body changing size moves targets, the grid follows the viewport (window resize)
      const ro = new ResizeObserver(() => (glue === "host" || !cols ? layout() : measure()));
      ro.observe(glue === "document" ? document.body : host);
      disposers.push(() => ro.disconnect());
    }
  }

  async function boot(): Promise<void> {
    if (encoding !== "plain") {
      const ok = await ensureGlyphAtlasFontFaceStyles(document, GLYPH_FONT_ATLAS);
      if (!ok) encoding = "plain";
    }
    if (destroyed) return;
    pre.style.fontFamily = encoding === "plain" ? "monospace" : `"${GLYPH_FONT_ATLAS.family}"`;
    if (encoding !== "plain") pre.style.fontPalette = paletteName;
    else pre.style.color = fieldHex;
    advance = measureAdvance();
    layout();
    listen();
    document.fonts?.ready.then(() => !destroyed && measure());
    started = true;
    if (!manual) raf = requestAnimationFrame(tick);
  }

  /** The face's advance in em: font-size is set so one advance is exactly one cell. */
  function measureAdvance(): number {
    const probe = document.createElement("span");
    probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font-size:100px;font-family:${pre.style.fontFamily};letter-spacing:0;font-kerning:none;`;
    const ch1 = encoding === "plain" ? "⠀" : String.fromCodePoint(GLYPH_FONT_ATLAS.puaStart);
    probe.textContent = ch1.repeat(20);
    stack.append(probe);
    const w = probe.getBoundingClientRect().width / 20 / 100;
    probe.remove();
    return w > 0.1 ? w : 0.6;
  }

  const api: GlyphFluid = {
    ready: Promise.resolve(),
    addTarget(spec) {
      const impl = spec.create({ fieldColor: () => fieldColor });
      const lt: LiveTarget = { impl, enabled: true, on: false };
      targets.push(lt);
      if (cols) impl.measure(layoutCtx());
      return {
        get enabled() { return lt.enabled; },
        condense() { lt.enabled = true; },
        melt() { lt.enabled = false; },
        remove() {
          const i = targets.indexOf(lt);
          if (i < 0) return;
          targets.splice(i, 1);
          impl.dispose();
          settleDirty = true;
        },
      };
    },
    addZone(opts) {
      const z = { opts, box: cols ? measureGlyphFluidZone(opts, layoutCtx()) : null };
      zones.push(z);
      settleDirty = true;
      return {
        remove() {
          const i = zones.indexOf(z);
          if (i >= 0) zones.splice(i, 1);
          settleDirty = true;
        },
      };
    },
    impulse(clientX, clientY, o = {}) {
      if (!cols || reduced) return;
      const [x, y] = toStage(clientX, clientY);
      ops.push(["impulse", x, y, o.strength ?? 1.5, o.radius ?? 0.045]);
    },
    push(clientX, clientY, dx, dy, o = {}) {
      if (!cols || reduced) return;
      const [x, y] = toStage(clientX, clientY);
      ops.push(["push", x, y, (dx / cw) * 0.5, (dy / cw) * 0.5, o.radius ?? 0.05]);
    },
    step(dt) {
      if (!started || destroyed) return;
      if (pipeline?.busy()) {
        stalls++;
        return;
      }
      drawFrame(dt);
    },
    relayout() {
      if (started && !destroyed) layout();
    },
    stats() {
      return { fps: governor.fps, pipeline: pipeline?.kind ?? "main", encoding, cols, rows, frames, stalls, stepMs: pipeline?.lastMs() ?? 0, lit };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(raf);
      for (const d of disposers.splice(0)) d();
      for (const lt of targets.splice(0)) lt.impl.dispose();
      zones.length = 0;
      pipeline?.dispose();
      pipeline = null;
      stack.remove();
      for (const r of restore.splice(0)) r();
    },
  };
  (api as { ready: Promise<void> }).ready = boot();
  return api;
}
