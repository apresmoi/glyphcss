import {
  glyphChartRegionFill, renderGlyphChart,
  type GlyphChartCharset, type GlyphChartInput, type GlyphChartMeta, type GlyphChartRegionFillResolution, type GlyphChartRenderOptions,
  type GlyphChartReport, type GlyphChartSpec, type GlyphChartXAxisTitleAt, type GlyphChartYAxisTitleAt,
} from "@glyphcss/charts";
import {
  buildChartsWorkbenchSpec, chartsWorkbenchEffectiveDensity, chartsWorkbenchRenderOptions, type ChartsWorkbenchState, type GlyphPixelBox,
} from "./chartsWorkbenchState";
import { CHARTS_AXIS_DEFAULT_COLOR } from "./chartsAxisDefaultColor";
import { correctChartHtmlTextScale } from "./chartsWorkbenchHtmlColor";
import { chartsWorkbenchNothingDrawn } from "./chartsMarkTypeFit";

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
    readonly x?: { readonly color?: string; readonly titleAt?: GlyphChartXAxisTitleAt };
    readonly y?: { readonly color?: string; readonly titleAt?: GlyphChartYAxisTitleAt };
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
  const { axisColor, axisTitlePlacement } = state.style;
  // Byte-identical omission at the library's own default — a reader who
  // never opened the Axes row never requests `axes.color` at all, exactly
  // as a `min`/`max` never typed never requests a `domain` (`buildScale`'s
  // own rule, `chartsWorkbenchState.ts`).
  const isColorDefault = axisColor.mode === "shared"
    ? axisColor.shared === CHARTS_AXIS_DEFAULT_COLOR
    : axisColor.x === CHARTS_AXIS_DEFAULT_COLOR && axisColor.y === CHARTS_AXIS_DEFAULT_COLOR;
  const sharedColor = !isColorDefault && axisColor.mode === "shared" ? axisColor.shared : undefined;
  const colorX = !isColorDefault && axisColor.mode === "per-axis" ? axisColor.x : undefined;
  const colorY = !isColorDefault && axisColor.mode === "per-axis" ? axisColor.y : undefined;
  // `titleAt` (Dock item "Axis Title + Title at") folds into the SAME
  // per-axis style object as colour, independently — a reader can move the
  // title without touching colour, or vice versa, and each omits at the
  // library's own default ("center"/"top") exactly like colour omits at
  // `CHARTS_AXIS_DEFAULT_COLOR`.
  const titleAtX = axisTitlePlacement.x !== "center" ? axisTitlePlacement.x : undefined;
  const titleAtY = axisTitlePlacement.y !== "top" ? axisTitlePlacement.y : undefined;
  const xStyle = colorX !== undefined || titleAtX !== undefined
    ? { ...(colorX !== undefined ? { color: colorX } : {}), ...(titleAtX !== undefined ? { titleAt: titleAtX } : {}) }
    : undefined;
  const yStyle = colorY !== undefined || titleAtY !== undefined
    ? { ...(colorY !== undefined ? { color: colorY } : {}), ...(titleAtY !== undefined ? { titleAt: titleAtY } : {}) }
    : undefined;
  const axes = sharedColor !== undefined || xStyle || yStyle
    ? { ...(sharedColor !== undefined ? { color: sharedColor } : {}), ...(xStyle ? { x: xStyle } : {}), ...(yStyle ? { y: yStyle } : {}) }
    : undefined;
  return {
    ...(axes ? { axes } : {}),
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
  | {
      ok: true; display: string; isHtml: boolean; text: string; ansi?: string; meta: GlyphChartMeta; report: GlyphChartReport;
      /** True when this render silently substituted `box` for a requested
       *  `braille` charset because the target is `chat` (see `renderSpec`'s
       *  own doc — CHARTS-RESEARCH `DIAGNOSIS-target-matrix.md` C4). Absent
       *  (never `false`) when no substitution happened, so a caller that
       *  never checks it sees no new field at all. */
      charsetDowngraded?: true;
    }
  | { ok: false; error: string; code?: string };

// ── Ticks row seed (Dock item "Ticks rows") ──────────────────────────────
//
// Unchecking "auto" needs the axis's ACTUAL rendered tick count so the
// click that turns auto off changes no cell (REVIEW-dock-addenda-opus.md
// P2-2) — AGENTS.md's own rule for this page's other `auto` toggles ("…so
// one click never changes the render"). Neither `GlyphChartMeta` nor
// `GlyphChartReport` carries a tick count directly; the only place one is
// EVER reported is a `ticks-thinned` ledger entry's `shown` field, logged
// only when the auto/requested count didn't fit and had to be collision-
// thinned — most charts never hit that (the page's own default preset at
// its own default size doesn't). So the PRIMARY source is the rendered
// TEXT itself.
//
// Counting the tick GLYPHS (`┴`/`┤`) was the first cut and is wrong: the
// axis LINES themselves cross at a corner cell — `AGENTS.md`'s "the x-axis
// LINE ROW is the y=0 row whenever 0 is in the y domain" means that row's
// own y-tick position is almost always ALSO where the x-axis's rule
// crosses it, and that ONE cell can only carry one glyph (the T-junction
// `├`/`└`, never `┤`) — so a glyph count silently drops exactly the tick
// that coincides with the other axis's line, on both axes, in the single
// most common case (a zero-anchored y domain, an index x domain starting
// at 0). Measured: on the page's own default preset, that undercounts by
// one on each axis, and feeding the undercounted number back as an
// EXPLICIT `ticks` request asks d3 for a different "nice" ladder entirely
// (its choice of values is not a subsequence of a larger request's ladder)
// — the render visibly changes, exactly the defect this exists to close.
// LABEL text has no such collision — a tick's number is real, separate
// text wherever the tick is — so this counts labels instead.

/** `box`/`blocks`/`braille` share one junction table for axis lines
 *  (AGENTS.md's "Axes" — tick marks are "reused directly from the box
 *  tier's own JUNCTION table"); only `ascii`'s own table collapses every
 *  multi-stem entry to `+`, so it needs its own glyph family — used here
 *  only to FIND the axis row/column, never to read a tick off it. */
const BOX_AXIS_FAMILY = {
  horizFamily: new Set(["─", "┴", "└", "┘", "┬", "┼", "├"]),
  vertFamily: new Set(["│", "┤", "└", "┌", "┼", "├", "┬"]),
} as const;
const ASCII_AXIS_FAMILY = {
  horizFamily: new Set(["-", "+"]),
  vertFamily: new Set(["|", "+"]),
} as const;

/**
 * Counts tick LABELS on the rendered chart's OWN x-axis row and y-axis
 * column. Pure — takes the joined `<pre>` text `renderChartsWorkbenchState`
 * already returns, not a chart/library import. The axis row/column is
 * found as "whichever row/column carries the most rule-family glyphs" (the
 * x-axis row is almost entirely `─`/`-` but for its ticks and one corner;
 * the y-axis column almost entirely `│`/`|`), which fails safe —
 * `undefined` — on a grid with no discernible axis line at all, rather
 * than guessing.
 *
 * A Y-tick is any row whose own y-axis-column cell is part of the axis
 * line's glyph family AND carries non-blank text to its left (the
 * right-aligned number `AGENTS.md`'s "Axes" describes) — this reads the
 * x-line row's own label (usually "0") exactly like every other tick row,
 * with no special case, because the glyph-family gate is what excludes an
 * axis TITLE row sitting above the plot (which has no axis-line glyph at
 * that column at all) rather than an exclusion keyed on row identity. An
 * X-tick is a whitespace-separated token on the row directly below the
 * x-axis line (where `AGENTS.md`'s tick-label row always lands) — reading
 * text rather than a glyph is also what makes `tickMarks: false` (the
 * axis drawn as a plain rule, no per-cell tick glyph at all) NOT a blind
 * spot here: the labels are unaffected by that option
 * (`tickMarks: false … byte-identical [to] the feature not existing`,
 * same doc).
 */
export function chartsWorkbenchRenderedTickCounts(text: string, charset: GlyphChartCharset): { x: number; y: number } | undefined {
  const lines = text.split("\n");
  const rows = lines.length;
  const cols = lines[0]?.length ?? 0;
  if (rows === 0 || cols === 0) return undefined;
  const family = charset === "ascii" ? ASCII_AXIS_FAMILY : BOX_AXIS_FAMILY;

  let xRow = -1, xRowCount = 0;
  for (let r = 0; r < rows; r++) {
    const line = lines[r]!;
    if (line.length !== cols) continue;
    let count = 0;
    for (let c = 0; c < cols; c++) if (family.horizFamily.has(line[c]!)) count++;
    if (count > xRowCount) { xRowCount = count; xRow = r; }
  }
  let yCol = -1, yColCount = 0;
  for (let c = 0; c < cols; c++) {
    let count = 0;
    for (let r = 0; r < rows; r++) {
      const line = lines[r]!;
      if (line.length === cols && family.vertFamily.has(line[c]!)) count++;
    }
    if (count > yColCount) { yColCount = count; yCol = c; }
  }
  if (xRow === -1 || yCol === -1) return undefined;

  let y = 0;
  for (let r = 0; r < rows; r++) {
    const line = lines[r]!;
    if (line.length !== cols) continue;
    if (family.vertFamily.has(line[yCol]!) && line.slice(0, yCol).trim() !== "") y++;
  }
  const labelRow = xRow + 1 < rows ? lines[xRow + 1] : undefined;
  const x = labelRow ? labelRow.split(/\s+/).filter((token) => token !== "").length : 0;
  return { x, y };
}

/**
 * The ticks row's own seed value. Tries the rendered text first
 * (`chartsWorkbenchRenderedTickCounts`), then the `ticks-thinned` ledger
 * entry (right when it fires, and the only source left once a degenerate
 * grid has no discernible axis line to read labels off), and is
 * `undefined` — never a guessed flat number — when neither has an answer.
 */
export function chartsWorkbenchActualTicks(rendered: ChartsWorkbenchRender, axis: "x" | "y", charset: GlyphChartCharset): number | undefined {
  if (rendered.ok) {
    const counted = chartsWorkbenchRenderedTickCounts(rendered.text, charset)?.[axis];
    if (counted !== undefined && counted > 0) return counted;
  }
  const ledger = rendered.ok ? rendered.report.ledger : [];
  const entry = ledger.find((e) => e.code === "ticks-thinned" && e.detail?.axis === axis);
  const shown = entry?.detail?.shown;
  return typeof shown === "number" && Number.isFinite(shown) ? shown : undefined;
}

function failure(error: unknown): ChartsWorkbenchRender {
  const e = error as Error & { code?: string };
  return { ok: false, error: e.code ? `${e.code}: ${e.message}` : e.message, code: e.code };
}
/**
 * CHARTS-RESEARCH `DIAGNOSIS-target-matrix.md` C4: `chat`'s own fenced-code
 * font stack carries no braille glyphs (0/256 in both SF Mono and Menlo,
 * measured cmap) while `box` is 32/32 on every one of those faces — the
 * SAME reason `chat`'s own charset DEFAULT is `box`, never `braille`
 * (AGENTS.md's "Targets and page"). A default never reaches here (an
 * unset `options.charset` isn't `"braille"`); what does is an EXPLICIT
 * override the page carries across a target switch (AGENTS.md: "the page
 * tracks explicit overrides per control") — a reader who picked `braille`
 * on `web`/`terminal` and then switches to `chat` keeps it. Downgrading to
 * `box` here — the tier `chat` already defaults to — is a faithful
 * substitution of the SAME data-mark request, never a different chart;
 * `blocks` is untouched (32/32 on both chat-stack faces, so it needs no
 * downgrade — CHARTS-RESEARCH's own font table). Callers report the
 * substitution via `charsetDowngraded` rather than silently swapping it,
 * so `TargetPreview` can say so in its own chrome.
 */
function chatCharsetDowngrade(options: GlyphChartRenderOptions): GlyphChartRenderOptions {
  return options.target === "chat" && options.charset === "braille" ? { ...options, charset: "box" } : options;
}
/**
 * Web-target text-scale fix (CHARTS-RESEARCH `REVIEW-batch4-codex.md` P1-3,
 * `-fable.md` P1-5/P2-1, N1/N2 `REVIEW-batch4-fixes-opus.md`).
 * `renderGlyphChart` now emits `.glyph-text` scaled-text markup (the `html`
 * exit) for the CALLER's own requested colour mode whenever `textScale > 1`
 * — not only `color: "css"` (`packages/charts/src/render.ts`'s own doc,
 * N2) — so a `none`/ANSI-mode render already carries it with no second
 * render and no page-side colour surgery: `result.html` below is simply
 * used as-is. What remains genuinely page-owned is the FRACTIONAL density
 * correction (`correctChartHtmlTextScale`, N1): the library's own
 * `textScale` must stay the positive integer it laid reserved cells out
 * at, so a 1.5x/1.75x/… density still needs its baked `Nem`/`width`
 * reservation corrected down to the slider's own exact em — that pass runs
 * on whatever `result.html` this render already produced, for every colour
 * mode alike.
 *
 * `logicalEm` is `renderChartsWorkbenchState`'s own fractional density —
 * `renderChartsWorkbenchSpec` (the raw, `state`-free public entry the
 * target-matrix unit tests call directly) never passes one, so a caller
 * supplying `options.textScale` explicitly keeps today's byte-identical
 * behaviour with no extra pass.
 */
function renderSpec(input: GlyphChartInput, options: GlyphChartRenderOptions, logicalEm?: number): ChartsWorkbenchRender {
  try {
    const downgraded = chatCharsetDowngrade(options);
    const charsetDowngraded = downgraded !== options;
    const result = renderGlyphChart(input, downgraded);
    const grid = result.build.canvas.grid;
    const text = Array.from({ length: grid.rows }, (_, row) =>
      grid.char.slice(row * grid.cols, (row + 1) * grid.cols).join("")
    ).join("\n");
    // `html` is produced for `color: "css"` on every target, and for any
    // OTHER colour mode once `textScale > 1` (N2) — the library has no
    // target gate of its own (CHARTS-RESEARCH C2) — `TargetPreview` is
    // what decides whether a given target may SHOW it (never `chat`;
    // `terminal` shows it with its own chrome note), so this stays
    // ungated rather than re-implementing that decision here too.
    const isHtml = result.html !== undefined;
    let display = isHtml ? result.html! : text;
    // NO_COLOR may have suppressed ANSI despite the requested colour depth.
    const ansi = result.text.includes("\x1b[") ? result.text : undefined;

    const target = downgraded.target ?? "web";
    const textScale = downgraded.textScale ?? 1;
    if (isHtml && target === "web" && textScale > 1 && logicalEm !== undefined) {
      display = correctChartHtmlTextScale(display, textScale, logicalEm);
    }

    return {
      ok: true, display, isHtml, text, ansi, meta: result.meta, report: result.report,
      ...(charsetDowngraded ? { charsetDowngraded: true as const } : {}),
    };
  } catch (error) { return failure(error); }
}
export function renderChartsWorkbenchSpec(specJson: string, options: GlyphChartRenderOptions): ChartsWorkbenchRender {
  let input: GlyphChartInput;
  try { input = JSON.parse(specJson); }
  catch (error) { return { ok: false, error: `Invalid JSON: ${(error as Error).message}` }; }
  return renderSpec(input, options);
}
/** The fully-styled spec (`buildChartsWorkbenchSpec` + `applyChartStyle`)
 *  a real render is built from — the one input `glyphChartSeriesPreview`
 *  must also read (`ChartsWorkbench.tsx`), so a mark card's per-series
 *  swatch shows the exact colour the render paints, prefill included. */
export function buildStyledChartsWorkbenchSpec(state: ChartsWorkbenchState): GlyphChartSpec {
  return applyChartStyle(buildChartsWorkbenchSpec(state), chartsWorkbenchChartStyle(state));
}
/** `viewportPx` — the measured live viewport (`useElementSize`) — reaches
 *  `chartsWorkbenchRenderOptions` unchanged; see that function's own doc
 *  for why every target but `web` ignores it. */
export function renderChartsWorkbenchState(state: ChartsWorkbenchState, viewportPx?: GlyphPixelBox): ChartsWorkbenchRender {
  try {
    // A data mark that paints nothing is a chart that failed to show its
    // data, never a blank frame (`chartsWorkbenchNothingDrawn`).
    const nothingDrawn = chartsWorkbenchNothingDrawn(state);
    if (nothingDrawn !== null) return { ok: false, error: nothingDrawn, code: "nothing-drawn" };
    return renderSpec(buildStyledChartsWorkbenchSpec(state), chartsWorkbenchRenderOptions(state, viewportPx), chartsWorkbenchEffectiveDensity(state.controls));
  } catch (error) { return failure(error); }
}

/** What the Dock's Textures row shows: what `auto` resolves to and why, and
 *  why `off` (solid) is unavailable when it is. */
export interface ChartsWorkbenchRegionFillStatus {
  readonly auto: GlyphChartRegionFillResolution;
  /** Set when an explicit `solid` could not show: the library would refuse it, or the target never shows colour. */
  readonly solidUnavailable?: string;
  /** Set when the chart has no bar/rect/area/pie fill, so the whole row does nothing. */
  readonly inapplicable?: string;
}
export const CHARTS_CHAT_TEXTURE_REASON = "Chat never shows colour, so textures always stay on.";
/**
 * Asks the library's own resolver (`glyphChartRegionFill`, the function
 * `renderGlyphChart` calls) with the SAME styled spec and options the render
 * uses, so the row's reason can never disagree with the picture. `null` when
 * the spec does not validate (the render is failing anyway).
 *
 * The "auto" preview clears `regionFill` back to `undefined` rather than
 * forcing the literal `"auto"` string: that IS what clicking the Dock's own
 * "auto" option sends (`set-region-fill`'s reducer clears the field, never
 * writes `"auto"` — `chartsUrlState.ts` normalizes a decoded `"auto"` the
 * same way), and it is what the untouched/default state already carries.
 * The library's own default is `"texture"` (USER DECISION: faithful to
 * glyphcss rendering, not auto's nuanced colour-collision resolution) — so
 * forcing the literal string here would preview a DIFFERENT render than the
 * one selecting "auto" (or doing nothing) actually produces.
 */
export function chartsWorkbenchRegionFillStatus(state: ChartsWorkbenchState): ChartsWorkbenchRegionFillStatus | null {
  try {
    const spec = buildStyledChartsWorkbenchSpec(state);
    const options = chartsWorkbenchRenderOptions(state);
    const auto = glyphChartRegionFill(spec, { ...options, regionFill: undefined });
    if (auto.reason === "no-region-mark") return { auto, inapplicable: auto.message };
    // `TargetPreview` strips colour on chat whatever the render carries, so a
    // solid fill could never reach the reader there.
    if (options.target === "chat") return { auto, solidUnavailable: CHARTS_CHAT_TEXTURE_REASON };
    const solid = glyphChartRegionFill(spec, { ...options, regionFill: "solid" });
    return solid.fill === "solid" ? { auto } : { auto, solidUnavailable: solid.message };
  } catch { return null; }
}

/**
 * The viewport's own content rule (never a readout, AGENTS.md's "Charts" —
 * "the viewport holds only the render; feedback lives on the buttons and
 * in the rail"): the CURRENT render when it's valid, else whatever last
 * rendered OK — so a bad chart config (a Dock control, a legacy link)
 * dims the frame instead of collapsing it. Pure and separate from
 * `ChartsWorkbench.tsx`'s own `useRef` bookkeeping so the FALLBACK rule
 * itself — "current if ok, else the frozen last-good, never null-out a
 * working picture" — has a test with no DOM in the loop.
 */
export function chartsWorkbenchDisplayRender(
  current: ChartsWorkbenchRender,
  lastGood: Extract<ChartsWorkbenchRender, { ok: true }> | null,
): Extract<ChartsWorkbenchRender, { ok: true }> | null {
  return current.ok ? current : lastGood;
}
