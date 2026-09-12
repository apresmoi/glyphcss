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
import { layoutGlyphChart, seriesNames } from "./layout";
import { paintGlyphChart } from "./paint";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { normalizeGlyphChartInput } from "./spec";
import { validateGlyphChartRenderSize, validateGlyphChartSpec } from "./validate";
import type {
  GlyphChartCharset,
  GlyphChartColorMode,
  GlyphChartDetail,
  GlyphChartInput,
  GlyphChartRenderOptions,
  GlyphChartResult,
  GlyphChartTarget,
} from "./types";

interface GlyphChartTargetDefaults {
  readonly width: number;
  readonly height: number;
  readonly charset: GlyphChartCharset;
  readonly color: GlyphChartColorMode;
}

/**
 * `chat`: 72x24, `box`, no colour — Slack/Discord fonts break braille and
 * junctions sometimes, and ANSI never survives a paste.
 * `terminal`: `braille` — `GLYPH_CANVAS_TIERS.braille` reuses `box`'s own
 * junction/arrow glyphs (`tiers.ts`) so routes and rule marks need no
 * second tier, but `line`/`dot`/an area's boundary rasterise at genuinely
 * finer, sub-cell (dot) resolution here than under `box` (`canvas.ts`'s
 * `paintSubcellLine`) — "braille" is a real resolution upgrade for those
 * marks, not merely a fill-only cosmetic swap.
 * `web`: `braille` for the same sub-cell resolution upgrade, with
 * `color: "css"` for the `html` exit — a web font can render the dot
 * patterns, unlike Slack/Discord's.
 */
export const GLYPH_CHART_TARGET_DEFAULTS: Readonly<Record<GlyphChartTarget, GlyphChartTargetDefaults>> = {
  chat: { width: 72, height: 24, charset: "box", color: "none" },
  terminal: { width: 80, height: 24, charset: "braille", color: "truecolor" },
  web: { width: 96, height: 32, charset: "braille", color: "css" },
};

function ansiColorMode(mode: GlyphChartColorMode): "16" | "256" | "truecolor" {
  if (mode === "ansi16") return "16";
  if (mode === "ansi256") return "256";
  return "truecolor";
}

export function renderGlyphChart(input: GlyphChartInput, options: GlyphChartRenderOptions = {}): GlyphChartResult {
  const spec = validateGlyphChartSpec(normalizeGlyphChartInput(input));

  const target: GlyphChartTarget = options.target ?? "chat";
  const defaults = GLYPH_CHART_TARGET_DEFAULTS[target];
  const width = options.width ?? defaults.width;
  const height = options.height ?? defaults.height;
  validateGlyphChartRenderSize(width, height);
  const charset: GlyphChartCharset = options.charset ?? defaults.charset;
  const color: GlyphChartColorMode = options.color ?? defaults.color;
  const detail: GlyphChartDetail = options.detail ?? "auto";

  const marks = resolveGlyphChartSpec(spec);
  const scales = resolveGlyphChartScales(marks, spec.scales);

  const ledger: string[] = [];
  const layout = layoutGlyphChart(spec, marks, scales, width, height, detail, ledger, charset, options.legend ?? true);

  const canvas = createGlyphCanvas({ cols: width, rows: height, tier: charset });
  // The ANSI encoder's non-empty env flags also determine whether colour
  // can carry series identity; suppressed colour needs monochrome styles.
  const ansi = color !== "none" && color !== "css";
  const noColor = Boolean(options.env?.NO_COLOR) && !options.env?.FORCE_COLOR;
  const colorEnabled = color !== "none" && !(ansi && noColor);
  paintGlyphChart(canvas, spec, marks, scales, layout, { colorEnabled }, ledger);

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
      title: spec.title ?? null,
      series,
      values,
      description: spec.description ?? null,
    },
    report: {
      ledger: [...ledger, ...canvas.report.ledger],
      unsupportedGlyphs: canvas.report.unsupportedGlyphs.slice(),
    },
  };
}
