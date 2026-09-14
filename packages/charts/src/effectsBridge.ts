/**
 * `composeGlyphChartEffects` (AGENTS.md's "Charts" §8 "Effects on a 2D
 * chart", packet F3) — runs Glyph Effects over a chart's own painted
 * canvas, with no scene and no camera, through glyphcss's DOM-free
 * `composeGlyphEffects` (contract 4, "Retained Glyph Effects"). Returns a
 * NEW `GlyphChartBuild` whose `canvas`/`colorCanvas` carry the composed
 * grid — `encodeGlyphChart`/`renderGlyphChart`'s own text/HTML exits work
 * on it unchanged, since only the grid content changed, never its shape.
 *
 * What survives on a canvas grid (§8): `baseColor` (the canvas's own
 * `grid.color`, always present), `baseShade` (derived HERE from the
 * canvas's own INK coverage — a canvas has no Lambert shading, so "shaded"
 * means "painted"), and `uv0` (derived HERE as the PLOT-RECT-NORMALIZED
 * data position, so `scan`/`wipe` sweep along the chart's own data x axis;
 * `NaN` outside the plot rect — axis labels, the title, the legend carry no
 * data position). `depth`/`normal`/`worldPosition`/`objectPosition`/
 * `objectExit` are all missing — a chart has no camera, so
 * `composeGlyphEffects`'s own `hasDepth: false` default is exactly right,
 * and the other four are simply absent from a `createGlyphCanvas` grid
 * already, so a HARD requirement on any of them rejects with
 * `GLYPH_EFFECT_REQUIREMENT_UNAVAILABLE` (glyphcss's own guard — nothing
 * chart-specific needed).
 *
 * The `"surfaces"` target is the chart's own ink (a blank background cell
 * is never "on a surface"); `"viewport"` is the whole grid, exactly as a
 * scene's base layer's `isBase: true` already makes it — `composeGlyphEffects`
 * always composes a chart canvas as a single, base-like output, so this
 * needs no special case here either.
 */
import {
  composeGlyphEffects,
  type CellGrid,
  type GlyphCanvas,
  type GlyphEffectLayerOptions,
} from "glyphcss";
import type { GlyphChartBuild, GlyphChartPlotRect } from "./types";

export interface GlyphChartComposeEffectsOptions {
  /**
   * Ambient clock value merged into every DEFINITION-shaped layer's own
   * `params.time`, when that layer's schema declares a `time` parameter and
   * the caller didn't already set one — the page drives ONE `time` for
   * every mounted layer without repeating it per layer (AGENTS.md's
   * "Clock: the library owns none. The page drives `time` and only
   * recomposes"). A raw-program layer (no schema to introspect) is left
   * untouched; its own complete `params` object already carries whatever
   * `time` it needs.
   */
  readonly time?: number;
}

function inkCoverage(grid: CellGrid): Float32Array {
  const n = grid.cols * grid.rows;
  const coverage = new Float32Array(n);
  for (let i = 0; i < n; i++) coverage[i] = grid.char[i] === " " ? 0 : 1;
  return coverage;
}

/** Plot-rect-normalized data position per cell — `NaN` outside the plot rect (§8's "uv0" survival clause). */
function plotUv0(grid: CellGrid, plot: GlyphChartPlotRect): Float32Array {
  const n = grid.cols * grid.rows;
  const uv0 = new Float32Array(n * 2).fill(Number.NaN);
  const width = plot.x1 - plot.x0;
  const height = plot.y1 - plot.y0;
  for (let row = Math.max(0, plot.y0); row <= Math.min(grid.rows - 1, plot.y1); row++) {
    for (let col = Math.max(0, plot.x0); col <= Math.min(grid.cols - 1, plot.x1); col++) {
      const i = row * grid.cols + col;
      uv0[i * 2] = width > 0 ? (col - plot.x0) / width : 0;
      uv0[i * 2 + 1] = height > 0 ? (row - plot.y0) / height : 0;
    }
  }
  return uv0;
}

/**
 * A shallow clone of `grid` carrying the two derived buffers above —
 * shallow because `composeGlyphEffects` (via `retainGlyphEffectOutput`)
 * deep-copies every field into its own retained snapshot before this
 * function's caller's `canvas.grid` could ever be read again, so sharing
 * the untouched array references (`char`/`color`/`depth`/`screenX`/
 * `screenY`) here is safe — nothing downstream mutates them through this
 * wrapper.
 */
function chartComposeInputGrid(grid: CellGrid, plot: GlyphChartPlotRect): CellGrid {
  return { ...grid, shade: inkCoverage(grid), surfaceUv: plotUv0(grid, plot) };
}

function readOnlyCanvasMethod(name: string): () => never {
  return () => {
    throw new Error(
      `glyphcss: a composed chart canvas is read-only — ${name}() cannot run after composeGlyphChartEffects (effects are the terminal step; build a new chart to paint further).`,
    );
  };
}

/**
 * A `GlyphCanvas`-shaped wrapper around a composed grid: every OTHER canvas
 * buffer (`bg`/`sub`/`textScale`/`textFiller`/`textFillerBelowOrigin`/
 * `report`) rides through UNCHANGED from the source canvas — effects only
 * ever replace glyph and colour (AGENTS.md "Retained Glyph Effects":
 * "effects replace glyph and colour only"), never the canvas's own
 * background or sub-cell occupancy. The painter methods are stubs that
 * throw: a composed canvas is a TERMINAL artifact for encoding, exactly
 * like a mounted effect layer's own retained output is never painted on
 * again by the scene that produced it.
 */
function composedCanvas(source: GlyphCanvas, grid: CellGrid): GlyphCanvas {
  return {
    cols: source.cols,
    rows: source.rows,
    cellAspect: source.cellAspect,
    tier: source.tier,
    grid,
    bg: source.bg,
    sub: source.sub,
    textScale: source.textScale,
    textFiller: source.textFiller,
    textFillerBelowOrigin: source.textFillerBelowOrigin,
    // The source's ink rides through like `bg`/`sub`: the texture sampler
    // (packet F2) derives its masks from `grid.char`, never this buffer, so
    // an effect that replaced glyphs cannot hand it stale coverage.
    ink: source.ink,
    report: source.report,
    setSurfaceUvRect: readOnlyCanvasMethod("setSurfaceUvRect"),
    fillRect: readOnlyCanvasMethod("fillRect"),
    line: readOnlyCanvasMethod("line"),
    text: readOnlyCanvasMethod("text"),
    arrowhead: readOnlyCanvasMethod("arrowhead"),
    edge: readOnlyCanvasMethod("edge"),
    route: readOnlyCanvasMethod("route"),
    resolveJunctions: readOnlyCanvasMethod("resolveJunctions"),
  };
}

function hasSchemaTimeParam(effect: unknown): boolean {
  if (!effect || typeof effect !== "object") return false;
  const schema = (effect as { parameterSchema?: Record<string, unknown> }).parameterSchema;
  return !!schema && Object.prototype.hasOwnProperty.call(schema, "time");
}

function withAmbientTime(layer: GlyphEffectLayerOptions, time: number): GlyphEffectLayerOptions {
  if (!hasSchemaTimeParam((layer as { effect?: unknown }).effect)) return layer;
  const params = (layer as { params?: Record<string, unknown> }).params;
  if (params && Object.prototype.hasOwnProperty.call(params, "time")) return layer;
  return { ...layer, params: { ...params, time } } as GlyphEffectLayerOptions;
}

/**
 * Runs `layers` over `build`'s own painted canvas(es) and returns a NEW
 * `GlyphChartBuild` — `build` itself is never mutated, so composing twice
 * from the same `build` (or composing, then `encodeGlyphChart(build, ...)`
 * for the UN-composed chart) both work. `meta`/`report`/`resolved`/`plot`
 * carry over unchanged (an effect changes what the chart LOOKS like, never
 * what it MEASURED). `canvas`/`colorCanvas` are composed independently only
 * when they are genuinely distinct objects (`regionFill` resolved solid);
 * otherwise one compose is reused for both, matching `buildGlyphChart`'s
 * own "never a second allocation when nothing distinguishes them" rule.
 */
export function composeGlyphChartEffects(
  build: GlyphChartBuild,
  layers: readonly GlyphEffectLayerOptions[],
  options: GlyphChartComposeEffectsOptions = {},
): GlyphChartBuild {
  const resolvedLayers = options.time === undefined
    ? layers
    : layers.map((layer) => withAmbientTime(layer, options.time!));
  const composeOne = (canvas: GlyphCanvas): GlyphCanvas => {
    const inputGrid = chartComposeInputGrid(canvas.grid, build.plot);
    const composed = composeGlyphEffects(inputGrid, resolvedLayers, {
      coverage: inkCoverage(canvas.grid),
      hasDepth: false,
    });
    return composedCanvas(canvas, composed);
  };
  const canvas = composeOne(build.canvas);
  const colorCanvas = build.colorCanvas === build.canvas ? canvas : composeOne(build.colorCanvas);
  return { ...build, canvas, colorCanvas };
}
