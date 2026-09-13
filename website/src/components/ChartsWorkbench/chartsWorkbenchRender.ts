import {
  renderGlyphChart,
  type GlyphChartInput, type GlyphChartMeta, type GlyphChartRenderOptions, type GlyphChartSpec,
} from "@glyphcss/charts";
import { buildChartsWorkbenchSpec, chartsWorkbenchRenderOptions, type ChartsWorkbenchState } from "./chartsWorkbenchState";
import { CHARTS_AXIS_DEFAULT_COLOR } from "./chartsAxisDefaultColor";

// ── Colour controls ──────────────────────────────────────────────────────
//
// `spec.axes.color`/`spec.axes.x.color`/`spec.axes.y.color` and mark
// `options.color` (`@glyphcss/charts`, see AGENTS.md's "Charts" —
// "Colours") are real fields on `GlyphChartSpec`/`GlyphChartAxisOptions`/
// `GlyphChartMarkOptions` now — `applyChartStyle` stays the ONE place the
// workbench writes them into a built spec (never `buildChartsWorkbenchSpec`
// itself) purely so a spec's colour styling has one owner, not because the
// types need a local extension anymore.

/** What `applyChartStyle` overlays onto a built spec. `axes` mirrors the
 *  real (pending) `spec.axes` shape one level deep; `markColors` is
 *  parallel to `spec.marks` (same order `buildChartsWorkbenchSpec` builds
 *  them in) — `undefined` entries are left untouched. */
export interface ChartsWorkbenchChartStyle {
  readonly axes?: {
    readonly color?: string;
    readonly x?: { readonly color?: string };
    readonly y?: { readonly color?: string };
  };
  readonly markColors?: readonly (string | readonly string[] | undefined)[];
}

/**
 * Derives the `ChartsWorkbenchChartStyle` overlay from workbench state —
 * `state.style.axisColor`'s shared/per-axis choice, and each mark's own
 * `color` in mark order. Pure and separate from `applyChartStyle` itself so
 * the merge function can be unit-tested against hand-built style objects
 * with no `ChartsWorkbenchState` in the picture.
 */
export function chartsWorkbenchChartStyle(state: ChartsWorkbenchState): ChartsWorkbenchChartStyle {
  const { axisColor } = state.style;
  // Byte-identical omission at the library's own default — a reader who
  // never opened the Axes row never requests `axes.color` at all, exactly
  // as a `min`/`max` never typed never requests a `domain` (`buildScale`'s
  // own rule, `chartsWorkbenchState.ts`).
  const isDefault = axisColor.mode === "shared"
    ? axisColor.shared === CHARTS_AXIS_DEFAULT_COLOR
    : axisColor.x === CHARTS_AXIS_DEFAULT_COLOR && axisColor.y === CHARTS_AXIS_DEFAULT_COLOR;
  return {
    ...(isDefault ? {} : { axes: axisColor.mode === "shared" ? { color: axisColor.shared } : { x: { color: axisColor.x }, y: { color: axisColor.y } } }),
    markColors: state.marks.map((mark) => mark.color),
  };
}

/**
 * The ONLY place the workbench writes `axes.color`/`axes.x.color`/
 * `axes.y.color`/mark `options.color` into a `GlyphChartSpec` — see this
 * file's own doc above. Pure: never mutates `spec`, and a `style` with no
 * `axes`/`markColors` returns `spec` with its `axes`/`marks` references
 * unchanged (so an unstyled chart's render stays byte-identical, and a
 * caller comparing references — same discipline as `chartsWorkbenchState.ts`'s
 * `withTable`/`reset-target` no-ops — sees no spurious change).
 */
export function applyChartStyle(spec: GlyphChartSpec, style: ChartsWorkbenchChartStyle): GlyphChartSpec {
  const axes: GlyphChartSpec["axes"] = style.axes
    ? {
        ...spec.axes,
        ...(style.axes.color !== undefined ? { color: style.axes.color } : {}),
        ...(style.axes.x ? { x: { ...spec.axes?.x, ...style.axes.x } } : {}),
        ...(style.axes.y ? { y: { ...spec.axes?.y, ...style.axes.y } } : {}),
      }
    : spec.axes;
  const marks: GlyphChartSpec["marks"] = style.markColors?.some((c) => c !== undefined)
    ? spec.marks.map((mark, i) => {
        const color = style.markColors![i];
        return color === undefined ? mark : { ...mark, options: { ...mark.options, color } };
      })
    : spec.marks;
  return { ...spec, axes, marks };
}

export type ChartsWorkbenchRender =
  | { ok: true; display: string; isHtml: boolean; text: string; ansi?: string; meta: GlyphChartMeta }
  | { ok: false; error: string; code?: string };

function failure(error: unknown): ChartsWorkbenchRender {
  const e = error as Error & { code?: string };
  return { ok: false, error: e.code ? `${e.code}: ${e.message}` : e.message, code: e.code };
}
function renderSpec(input: GlyphChartInput, options: GlyphChartRenderOptions): ChartsWorkbenchRender {
  try {
    const result = renderGlyphChart(input, options);
    const text = Array.from({ length: result.grid.rows }, (_, row) =>
      result.grid.char.slice(row * result.grid.cols, (row + 1) * result.grid.cols).join("")
    ).join("\n");
    const isHtml = options.target === "web" && result.html !== undefined;
    // NO_COLOR may have suppressed ANSI despite the requested colour depth.
    const ansi = result.text.includes("\x1b[") ? result.text : undefined;
    return { ok: true, display: isHtml ? result.html! : text, isHtml, text, ansi, meta: result.meta };
  } catch (error) { return failure(error); }
}
export function renderChartsWorkbenchSpec(specJson: string, options: GlyphChartRenderOptions): ChartsWorkbenchRender {
  let input: GlyphChartInput;
  try { input = JSON.parse(specJson); }
  catch (error) { return { ok: false, error: `Invalid JSON: ${(error as Error).message}` }; }
  return renderSpec(input, options);
}
export function renderChartsWorkbenchState(state: ChartsWorkbenchState): ChartsWorkbenchRender {
  try {
    const spec = applyChartStyle(buildChartsWorkbenchSpec(state), chartsWorkbenchChartStyle(state));
    return renderSpec(spec, chartsWorkbenchRenderOptions(state));
  } catch (error) { return failure(error); }
}
