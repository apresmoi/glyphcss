/**
 * `renderGlyphChart` — the public render entry (PLAN.md Phase 1 §"Public
 * render"; split into a model + exits by Packet F1, AGENTS.md's "Charts"
 * §4). Runs `spec → resolveScales → budget-first layout → paint → encode`
 * and returns `{ text, html?, build, meta, report }`.
 *
 * The MODEL step (`buildGlyphChart`) and the ENCODE step
 * (`encodeGlyphChart`) are now public on their own: a caller building a
 * texture, a decal, or a scene object (F2/F3/F4) needs the painted
 * `GlyphCanvas`es without paying for — or duplicating — the plain-text/HTML
 * string work. `renderGlyphChart` itself is exactly `buildGlyphChart` +
 * `encodeGlyphChart`, so its OWN behaviour is unchanged; only the shape of
 * its result changed (`grid` → `build`, Packet F1's public break).
 *
 * `text` is the ENCODED string for the call's own `color` setting — raw
 * (`encodeGlyphCanvasText`) when `color: "none"`, SGR (`encodeGlyphCanvasAnsi`)
 * for the three ANSI modes. This is deliberate, not an inconsistency: a
 * caller asking for `target: "terminal"` wants the string it can print
 * as-is, exactly like `@glyphcss/compile`'s own CLI conflates "the current
 * output string" with the chosen `--format` (`packages/compile/src/cli.ts`).
 *
 * `html` is populated for `color: "css"` on every `textScale`, AND for any
 * OTHER colour mode whenever `textScale > 1` (N2, CHARTS-RESEARCH
 * `REVIEW-batch4-fixes-opus.md`) — a `.glyph-text` scaled-text span is the
 * ONLY way a caller recovers Density's own text-scale reservation in HTML,
 * and gating that on `color === "css"` forced a `none`/ANSI caller through
 * a second `color: "css"` render plus a page-side strip/requantize just to
 * get the markup back, stripping colour also stripped the MONOCHROME series
 * encoding `paintGlyphChart` chose in its place (line/area-boundary dash
 * styles, `● × + ◆` dot glyphs — chosen from `colorEnabled`, which is
 * already false for `color: "none"`), so the re-rendered `css` html carried
 * neither the real colour nor the honest monochrome fallback. Painting is
 * unaffected either way — `colorEnabled` here is a function of the
 * ACTUALLY requested `color`, never forced to `"css"` — so this `html` is
 * simply the canvas that already exists, encoded a second way; `none`
 * reads it with no colour at all (the canvas already carries none), and
 * `ansi16`/`ansi256` recolour PER SPAN to the same palette
 * `encodeGlyphCanvasAnsi` itself downgrades to (`nearestAnsiCanvasColor`,
 * `glyphcss`) rather than the page re-deriving that quantization from
 * already-encoded HTML. `truecolor` needs no recolour: its `colorEnabled`
 * is identical to `css`'s own, so the two renders' canvases (and therefore
 * their `html`) are byte-identical without any extra step. The tier-safety
 * gate ("chat has no `\x1b`") holds because `chat`'s DEFAULT `color` is
 * `"none"`, which never touches the ANSI encoder at all.
 */

import {
  createGlyphCanvas, encodeGlyphCanvasAnsi, encodeGlyphCanvasHtml, encodeGlyphCanvasText, nearestAnsiCanvasColor,
} from "glyphcss";
import { layoutGlyphChart, resolveGlyphChartLegendOption, seriesNames } from "./layout";
import { chartLedgerEntryFromCanvasMessage, ledgerRegionFillSolidRefused } from "./ledger";
import { paintGlyphChart } from "./paint";
import { glyphChartColorEnabled, resolveGlyphChartRegionFill } from "./regionFill";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { normalizeGlyphChartInput } from "./spec";
import {
  validateGlyphChartLegendOption, validateGlyphChartRegionFill, validateGlyphChartRenderSize, validateGlyphChartSpec, validateGlyphChartTextScale,
} from "./validate";
import type {
  GlyphChartBuild,
  GlyphChartCharset,
  GlyphChartColorMode,
  GlyphChartDetail,
  GlyphChartInput,
  GlyphChartLedgerEntry,
  GlyphChartRegionFillResolution,
  GlyphChartRenderOptions,
  GlyphChartResult,
  GlyphChartTarget,
} from "./types";

interface GlyphChartTargetDefaults {
  readonly width: number;
  readonly height: number;
  readonly charset: GlyphChartCharset;
  readonly color: GlyphChartColorMode;
  /**
   * Column-width / row-height ratio for THIS target's own monospace grid —
   * fed to `createGlyphCanvas({ cellAspect })`, which only `arcRadii` reads
   * (`paint.ts`'s "Arc shape and callouts" doc); no other painter, tier
   * table, junction resolver or encoder consults it (grepped, and pinned by
   * `render.byteIdentity.test.ts`'s per-target non-arc fixtures). `web`:
   * `0.5859375` = 1200/2048 em, Glyph Mono's OWN measured advance
   * (`fontTools` on `website/public/fonts/glyph-mono.woff2`) at the chart
   * `<pre>`'s `line-height: 1` (AGENTS.md's "Charts" font-atlas paragraph
   * — the override is load-bearing, so `line-height: normal`'s 0.5042 is
   * NOT the right constant here). `terminal`: `0.5`, a typical terminal
   * cell's own ratio. `chat`: `0.5` too, but only as a documented GUESS —
   * a chat client's fenced-code-block font is outside this package's
   * control (see `GLYPH_CHART_TARGET_DEFAULTS`'s own `chat` doc below), so
   * there is no real measurement to cite for it.
   */
  readonly cellAspect: number;
}

/**
 * `chat`: 72x24, `box`, no colour — REVERTED from braille: a chat client's
 * fenced code block renders in whatever monospace font its own CSS picks
 * (SF Mono, Menlo, Consolas, ...), a stack this package cannot control and
 * none of which carries the braille block (U+2800-28FF), so a braille chart
 * pasted into chat misaligns instead of merely losing junction glyphs. `box`
 * degrades no data — it is `line`/`dot`/an area's whole-cell fallback tier,
 * not a second rendering. ANSI also never survives a paste, hence `none`.
 * `terminal`: `braille` — `GLYPH_CANVAS_TIERS.braille` reuses `box`'s own
 * junction/arrow glyphs (`tiers.ts`) so routes and rule marks need no
 * second tier, but `line`/`dot`/an area's boundary rasterise at genuinely
 * finer, sub-cell (dot) resolution here than under `box` (`canvas.ts`'s
 * `paintSubcellLine`) — "braille" is a real resolution upgrade for those
 * marks, not merely a fill-only cosmetic swap. A real terminal's font is the
 * user's own choice, made once for the whole terminal, and terminal fonts
 * overwhelmingly do carry the braille block (it is why `tmux`/`vim`
 * status-line braille spinners work) — the opposite bet from `chat`'s.
 * `web`: `braille` for the same sub-cell resolution upgrade, with
 * `color: "css"` for the `html` exit — the website ships its own font
 * (`Glyph Mono`, see AGENTS.md's "Charts" font-atlas paragraph) with full
 * braille/box coverage, so nothing here depends on the visitor's system font.
 */
export const GLYPH_CHART_TARGET_DEFAULTS: Readonly<Record<GlyphChartTarget, GlyphChartTargetDefaults>> = {
  chat: { width: 72, height: 24, charset: "box", color: "none", cellAspect: 0.5 },
  terminal: { width: 80, height: 24, charset: "braille", color: "truecolor", cellAspect: 0.5 },
  web: { width: 96, height: 32, charset: "braille", color: "css", cellAspect: 0.5859375 },
};

function ansiColorMode(mode: GlyphChartColorMode): "16" | "256" | "truecolor" {
  if (mode === "ansi16") return "16";
  if (mode === "ansi256") return "256";
  return "truecolor";
}

/**
 * The region fill `renderGlyphChart` would paint for these exact inputs,
 * and why — the SAME resolver the render calls, so a UI (the `/charts`
 * Dock's Textures row) can state the reason without re-deriving the rule.
 * Reads only the options that decide it (`target`, `color`, `env`,
 * `regionFill`); throws the same tagged errors the render would.
 */
/**
 * `regionFill`'s own default. USER DECISION, verbatim: "I think I don't
 * want the region fill, I want to be faithful to glyphcss rendering, then
 * we can have it in the future, but not now".
 *
 * `"auto"` resolved to a SOLID fill on essentially every coloured web chart
 * ("colors-distinct"), and `paintSolidCellBackgrounds` then gave each `#`
 * cell a matching `background-color` to hide sub-pixel seams — so a bar
 * chart rendered as real filled rectangles and stopped reading as glyph
 * output at all. `"texture"` keeps every region mark on its own shade-family
 * glyph, which is what the plain-text exit has always shown. `"auto"` and
 * `"solid"` both remain reachable explicitly.
 */
export const GLYPH_CHART_DEFAULT_REGION_FILL = "texture" as const;

export function glyphChartRegionFill(input: GlyphChartInput, options: GlyphChartRenderOptions = {}): GlyphChartRegionFillResolution {
  const spec = validateGlyphChartSpec(normalizeGlyphChartInput(input));
  validateGlyphChartRegionFill(options.regionFill);
  const target: GlyphChartTarget = options.target ?? "web";
  const color: GlyphChartColorMode = options.color ?? GLYPH_CHART_TARGET_DEFAULTS[target].color;
  return resolveGlyphChartRegionFill(resolveGlyphChartSpec(spec), {
    requested: options.regionFill ?? GLYPH_CHART_DEFAULT_REGION_FILL, color, colorEnabled: glyphChartColorEnabled(color, options.env), target,
  });
}

/**
 * The MODEL step (AGENTS.md's "Charts" §4, Packet F1): validate → resolve →
 * scales → budget-first layout → paint, with no encoding. `encodeGlyphChart`
 * turns the result into a `text`/`html` string; `renderGlyphChart` is
 * exactly the two composed. A later bridge (`glyphChartTextureSampler`,
 * `glyphChartPlaneObject`, `composeGlyphChartEffects` — F2/F3/F4) starts
 * here too, so this is the one place the paint actually happens.
 */
export function buildGlyphChart(input: GlyphChartInput, options: GlyphChartRenderOptions = {}): GlyphChartBuild {
  const spec = validateGlyphChartSpec(normalizeGlyphChartInput(input));
  // `spec.title`/`spec.legend` are validated inside `validateGlyphChartSpec`
  // above; `options.legend` is a render-only override with the identical
  // shape, validated here since it never reaches the spec.
  validateGlyphChartLegendOption(options.legend);

  const target: GlyphChartTarget = options.target ?? "web";
  const defaults = GLYPH_CHART_TARGET_DEFAULTS[target];
  const width = options.width ?? defaults.width;
  const height = options.height ?? defaults.height;
  validateGlyphChartRenderSize(width, height);
  const charset: GlyphChartCharset = options.charset ?? defaults.charset;
  const color: GlyphChartColorMode = options.color ?? defaults.color;
  const detail: GlyphChartDetail = options.detail ?? "auto";
  const cellAspect = options.cellAspect ?? defaults.cellAspect;
  const textScale = options.textScale ?? 1;
  validateGlyphChartTextScale(textScale);
  validateGlyphChartRegionFill(options.regionFill);

  const marks = resolveGlyphChartSpec(spec);
  const scales = resolveGlyphChartScales(marks, spec.scales);

  const ledger: GlyphChartLedgerEntry[] = [];
  const legendOption = resolveGlyphChartLegendOption(spec.legend, options.legend);
  const layout = layoutGlyphChart(spec, marks, scales, width, height, detail, ledger, charset, legendOption, textScale);

  const canvas = createGlyphCanvas({ cols: width, rows: height, tier: charset, cellAspect });
  // The ANSI encoder's non-empty env flags also determine whether colour
  // can carry series identity; suppressed colour needs monochrome styles.
  const colorEnabled = glyphChartColorEnabled(color, options.env);
  const regionFill = resolveGlyphChartRegionFill(marks, { requested: options.regionFill ?? GLYPH_CHART_DEFAULT_REGION_FILL, color, colorEnabled, target });
  // `canvas` is ALWAYS the textured paint: it feeds every colour-free exit
  // (and a chart-as-texture, F2), so a coloured chart's plain text still
  // tells its series apart. A solid resolution paints a second canvas that
  // only the colour-carrying exits read; its ledger is the same paint's and
  // is discarded. A repaint, not a post-paint glyph swap: swapping needs a
  // per-cell record of which region painted each cell and what overwrote it.
  paintGlyphChart(canvas, spec, marks, scales, layout, { colorEnabled, textScale }, ledger);
  let colorCanvas = canvas;
  if (regionFill.fill === "solid") {
    colorCanvas = createGlyphCanvas({ cols: width, rows: height, tier: charset, cellAspect });
    paintGlyphChart(colorCanvas, spec, marks, scales, layout, { colorEnabled, textScale, regionFill: "solid" }, []);
  } else if (options.regionFill === "solid" && regionFill.reason !== "no-region-mark") {
    ledger.push(ledgerRegionFillSolidRefused({ reason: regionFill.reason, explanation: regionFill.message, ...(regionFill.colliding ? { colliding: regionFill.colliding } : {}) }));
  }

  const series = seriesNames(marks);
  const values = marks.reduce(
    (n, m) => n + (m.mark.type === "rule" ? (m.ruleValues?.length ?? 0) : m.rows.length),
    0,
  );

  return {
    canvas,
    colorCanvas,
    plot: layout.plot,
    meta: {
      title: spec.title === undefined ? null : typeof spec.title === "string" ? spec.title : spec.title.text,
      series,
      values,
      description: spec.description ?? null,
    },
    report: {
      ledger: [...ledger, ...canvas.report.ledger.map(chartLedgerEntryFromCanvasMessage)],
      unsupportedGlyphs: canvas.report.unsupportedGlyphs.slice(),
      routeConflicts: canvas.report.routeConflicts.slice(),
    },
    resolved: { target, charset, color, width, height, detail, cellAspect, textScale, env: options.env },
  };
}

/**
 * The ENCODE step (Packet F1): turns a `GlyphChartBuild` into a `text` or
 * `html` string, replaying exactly the exit rule this file's own header doc
 * states — `text` always reads the plain `canvas` under `none`/`css` and the
 * ANSI-encoded `colorCanvas` under an ANSI mode; `html` always reads
 * `colorCanvas` (which IS `canvas` whenever `regionFill` didn't resolve
 * solid, so `color: "none"`'s `html` is colourless without a special case),
 * recoloured per span for `ansi16`/`ansi256` to the exact palette
 * `encodeGlyphCanvasAnsi` itself downgrades to. `renderGlyphChart` decides
 * WHETHER to call this for `"html"` (its own `color === "css" ||
 * textScale > 1` rule); this function only decides HOW.
 */
export function encodeGlyphChart(build: GlyphChartBuild, exit: "text" | "html"): string {
  const { canvas, colorCanvas, resolved } = build;
  if (exit === "text") {
    if (resolved.color === "none" || resolved.color === "css") return encodeGlyphCanvasText(canvas);
    return encodeGlyphCanvasAnsi(colorCanvas, { colors: ansiColorMode(resolved.color), env: resolved.env });
  }
  if (resolved.color === "ansi16" || resolved.color === "ansi256") {
    const depth = resolved.color === "ansi16" ? "16" : "256";
    return encodeGlyphCanvasHtml(colorCanvas, { recolor: (hex: string) => nearestAnsiCanvasColor(hex, depth) });
  }
  // `none`: colourless already (`colorCanvas === canvas`, `colorEnabled`
  // false). `css`/`truecolor`: `colorCanvas` already carries the real
  // colour, so no recolour is needed either.
  return encodeGlyphCanvasHtml(colorCanvas);
}

export function renderGlyphChart(input: GlyphChartInput, options: GlyphChartRenderOptions = {}): GlyphChartResult {
  const build = buildGlyphChart(input, options);
  const text = encodeGlyphChart(build, "text");
  // `html` follows `buildGlyphChart`'s own doc: always present under
  // `color: "css"`; otherwise only once `textScale > 1` gives it something
  // to carry (the `.glyph-text` scaled-text markup, N2 in this file's
  // header doc).
  const html = build.resolved.color === "css" || build.resolved.textScale > 1
    ? encodeGlyphChart(build, "html")
    : undefined;
  return {
    text,
    ...(html !== undefined ? { html } : {}),
    build,
    meta: build.meta,
    report: build.report,
  };
}
