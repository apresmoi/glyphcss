/**
 * `renderGlyphChart` — the public render entry (PLAN.md Phase 1 §"Public
 * render"). Runs `spec → resolveScales → budget-first layout →
 * paint → encode` and returns `{ text, html?, grid, meta, report }`.
 *
 * `text` is the ENCODED string for the call's own `color` setting — raw
 * (`encodeGlyphCanvasText`) when `color: "none"`, SGR (`encodeGlyphCanvasAnsi`)
 * for the three ANSI modes. This is deliberate, not an inconsistency: a
 * caller asking for `target: "terminal"` wants the string it can print
 * as-is, exactly like `@glyphcss/compile`'s own CLI conflates "the current
 * output string" with the chosen `--format` (`packages/compile/src/cli.ts`).
 * `html` is populated only for `color: "css"`. The tier-safety gate ("chat
 * has no `\x1b`") holds because `chat`'s DEFAULT `color` is `"none"`, which
 * never touches the ANSI encoder at all.
 */

import { createGlyphCanvas, encodeGlyphCanvasAnsi, encodeGlyphCanvasHtml, encodeGlyphCanvasText } from "glyphcss";
import { layoutGlyphChart, resolveGlyphChartLegendOption, seriesNames } from "./layout";
import { chartLedgerEntryFromCanvasMessage } from "./ledger";
import { paintGlyphChart } from "./paint";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { normalizeGlyphChartInput } from "./spec";
import {
  validateGlyphChartLegendOption, validateGlyphChartRenderSize, validateGlyphChartSpec, validateGlyphChartTextScale,
} from "./validate";
import type {
  GlyphChartCharset,
  GlyphChartColorMode,
  GlyphChartDetail,
  GlyphChartInput,
  GlyphChartLedgerEntry,
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

export function renderGlyphChart(input: GlyphChartInput, options: GlyphChartRenderOptions = {}): GlyphChartResult {
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

  const marks = resolveGlyphChartSpec(spec);
  const scales = resolveGlyphChartScales(marks, spec.scales);

  const ledger: GlyphChartLedgerEntry[] = [];
  const legendOption = resolveGlyphChartLegendOption(spec.legend, options.legend);
  const layout = layoutGlyphChart(spec, marks, scales, width, height, detail, ledger, charset, legendOption, textScale);

  const canvas = createGlyphCanvas({ cols: width, rows: height, tier: charset, cellAspect });
  // The ANSI encoder's non-empty env flags also determine whether colour
  // can carry series identity; suppressed colour needs monochrome styles.
  const ansi = color !== "none" && color !== "css";
  const noColor = Boolean(options.env?.NO_COLOR) && !options.env?.FORCE_COLOR;
  const colorEnabled = color !== "none" && !(ansi && noColor);
  paintGlyphChart(canvas, spec, marks, scales, layout, { colorEnabled, textScale }, ledger);

  let text: string;
  let html: string | undefined;
  if (color === "none") {
    text = encodeGlyphCanvasText(canvas);
  } else if (color === "css") {
    text = encodeGlyphCanvasText(canvas);
    html = encodeGlyphCanvasHtml(canvas);
  } else {
    text = encodeGlyphCanvasAnsi(canvas, { colors: ansiColorMode(color), env: options.env });
  }

  const series = seriesNames(marks);
  const values = marks.reduce(
    (n, m) => n + (m.mark.type === "rule" ? (m.ruleValues?.length ?? 0) : m.rows.length),
    0,
  );

  return {
    text,
    ...(html !== undefined ? { html } : {}),
    grid: { cols: width, rows: height, char: canvas.grid.char.slice() },
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
  };
}
