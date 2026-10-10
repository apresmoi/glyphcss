/**
 * Budget-first layout (PLAN.md Phase 1 / CHARTS-RESEARCH.md §5): given a
 * fixed `cols × rows` budget, reserve title / legend / y-axis gutter / x-axis
 * row FIRST, pick "nice" ticks and thin them until no two labels collide,
 * THEN allocate whatever remains to the plot rect. At 60×15 the tick count
 * matters more than anti-aliasing (the research doc's own framing) — this is
 * why layout runs before any mark is painted, rather than marks claiming
 * space and axes squeezing into what's left.
 */

import { timeFormat } from "d3-time-format";
import { cellFillValues, cellSigned } from "./heatmap";
import { chartSeries, chartSeriesColors } from "./series";
import { abbreviateChartText, chartText, glyphChartLabelLayout } from "./labels";
import { hasZeroAnchoredMark } from "./scales";
import { resolveGlyphChartTickFormat, type GlyphChartResolvedTickFormat } from "./tickFormat";
import {
  ledgerAxisTitleStacked, ledgerLegendDropped, ledgerLegendPlacementDegraded, ledgerTickDuplicateDropped,
  ledgerTicksThinned, ledgerTitleDropped, type GlyphChartLedgerEntry,
} from "./ledger";
import type { GlyphChartResolvedMark } from "./resolve";
import type { GlyphChartResolvedScale, GlyphChartResolvedScales, GlyphChartTick } from "./scales";
import type {
  GlyphChartCharset, GlyphChartDetail, GlyphChartLegendOption, GlyphChartLegendPlacement,
  GlyphChartPlotRect, GlyphChartSpec, GlyphChartTitleAlign, GlyphChartTitleOption, GlyphChartTitlePosition,
  GlyphChartXAxisTitleAt, GlyphChartYAxisTitleAt,
} from "./types";

/**
 * Maps every raw tick's `label` through a resolved `axes.{x,y}.format`
 * (`undefined` — absent/`"auto"` — is a no-op, returning `ticks` UNCHANGED
 * rather than a fresh array, so the byte-identity guarantee costs nothing
 * to verify: no formatter means this function never runs at all). The
 * `ticks` array the callback receives is the values BEFORE any of this
 * axis's own stride/collision thinning — the full candidate ladder a caller
 * composing an index-relative label (`"#3 of 8"`) would want to see.
 */
function formatAxisTicks(ticks: readonly GlyphChartTick[], fmt: GlyphChartResolvedTickFormat | undefined): readonly GlyphChartTick[] {
  if (!fmt) return ticks;
  const values = ticks.map((t) => t.value);
  return ticks.map((t, i) => ({ ...t, label: fmt.apply(t.value, i, values) }));
}

/** `title: string` is `{ text, align: "center", position: "top" }` — byte-identical to before this option existed. */
export interface GlyphChartResolvedTitle {
  readonly text: string | null;
  readonly align: GlyphChartTitleAlign;
  readonly position: GlyphChartTitlePosition;
}
export function resolveGlyphChartTitle(title: GlyphChartTitleOption | undefined): GlyphChartResolvedTitle {
  if (title === undefined) return { text: null, align: "center", position: "top" };
  if (typeof title === "string") return { text: title || null, align: "center", position: "top" };
  return { text: title.text || null, align: title.align ?? "center", position: title.position ?? "top" };
}

/** `legend: true`/omitted is `{ show: true, placement: "bottom" }` — byte-identical to before this option existed. A render `options.legend` overrides `spec.legend`. */
export interface GlyphChartResolvedLegendOption {
  readonly show: boolean;
  readonly placement: GlyphChartLegendPlacement;
  /** `false` iff neither `spec.legend` nor render `options.legend` was set — `layoutGlyphChart` uses this to default a funnel's own legend OFF (its stage labels already carry identity) while an explicit `legend: true` still lists the stages. */
  readonly explicit: boolean;
}
export function resolveGlyphChartLegendOption(specLegend: GlyphChartLegendOption | undefined, optionLegend: GlyphChartLegendOption | undefined): GlyphChartResolvedLegendOption {
  const chosen = optionLegend ?? specLegend;
  const explicit = chosen !== undefined;
  const source = chosen ?? true;
  return typeof source === "boolean" ? { show: source, placement: "bottom", explicit } : { show: true, placement: source.placement, explicit: true };
}

/**
 * A mid grey, not the full-brightness foreground `paintAxes`/`paintGrid`
 * used before `spec.axes.color`/`spec.axes.{x,y}.color` existed — data marks
 * (the palette's own saturated colours) must read brighter than the frame
 * around them, and painting the axis in the reader's own text colour made
 * the two indistinguishable at a glance (AGENTS.md's "Charts" "Colours").
 * Applies only when colour is enabled; text-only output never sets a colour
 * on the axis at all, exactly as before this constant existed.
 */
export const GLYPH_CHART_AXIS_DEFAULT_COLOR = "#7a7f8a";

/** `spec.axes.color`, overridden per axis by `spec.axes.{x,y}.color`, defaulting to `GLYPH_CHART_AXIS_DEFAULT_COLOR` — the colour `paintAxes`/`paintGrid` use whenever colour is enabled. */
export function resolveGlyphChartAxisColor(axes: GlyphChartSpec["axes"], axis: "x" | "y"): string {
  return axes?.[axis]?.color ?? axes?.color ?? GLYPH_CHART_AXIS_DEFAULT_COLOR;
}

export interface GlyphChartLayoutTick {
  readonly value: unknown;
  readonly label: string;
  /** Cell column (x-axis) or row (y-axis). */
  readonly cell: number;
  /** Left edge after abbreviation and viewport placement. */
  readonly labelStart: number;
}

// `GlyphChartPlotRect` now lives in `./types` — it is part of the public
// `GlyphChartBuild.plot` shape (Packet F1), so `types.ts` is its canonical
// home; re-exported here so every existing `from "./layout"` import keeps
// working unchanged.
export type { GlyphChartPlotRect } from "./types";

export interface GlyphChartLegendItem {
  readonly label: string;
  readonly color?: string;
}

/**
 * `row` is present only for the two ROW-RESERVING placements (`"bottom"`,
 * `"title"`) — the four corner placements paint inside `layout.plot` at
 * paint time (no row reserved, so no fixed row to record here).
 */
export interface GlyphChartLegendLayout {
  readonly placement: GlyphChartLegendPlacement;
  readonly items: readonly GlyphChartLegendItem[];
  readonly row?: number;
}

export interface GlyphChartLayout {
  readonly cols: number;
  readonly rows: number;
  readonly plot: GlyphChartPlotRect;
  readonly xTicks: readonly GlyphChartLayoutTick[];
  readonly yTicks: readonly GlyphChartLayoutTick[];
  readonly titleRow: number | null;
  /** `null` when there's no title text at all (distinct from `titleRow === null`, which can also mean "dropped for lack of room"). */
  readonly titleText: string | null;
  readonly titleAlign: GlyphChartTitleAlign;
  readonly xAxisLineRow: number;
  readonly xAxisLabelRow: number;
  readonly yAxisCol: number;
  /** Packet item 6 — axis tick marks/titles/grid, resolved with their defaults. */
  readonly xTickMarks: boolean;
  readonly yTickMarks: boolean;
  /** Resolved `axes.{x,y}.line`: `false` paints no axis line or tick marks, and a band-y heatmap's bottom category may use the row the x line would take. */
  readonly xAxisLine: boolean;
  readonly yAxisLine: boolean;
  /** An unsigned heatmap's range-key row, or `-1` when there's none. */
  readonly cellKeyRow: number;
  readonly xGrid: boolean;
  readonly yGrid: boolean;
  /** Resolved per `resolveGlyphChartAxisColor` — `paintAxes`/`paintGrid` apply this only when colour is enabled. */
  readonly xAxisColor: string;
  readonly yAxisColor: string;
  /** `null` when there's no title (explicit `""`, no string field, or no room). */
  readonly xAxisTitle: string | null;
  readonly yAxisTitle: string | null;
  readonly xAxisTitleRow: number;
  /** `"start" | "center" | "end"` — resolved `axes.x.titleAt`, default `"center"`. */
  readonly xAxisTitleAt: GlyphChartXAxisTitleAt;
  /** Top-left, above the y-axis by default (`titleAt: "top"`) — or shares/claims a row below the plot at column 0 for `titleAt: "bottom"`. Painted at column 0 either way, so no separate column field is needed. */
  readonly yAxisTitleRow: number;
  readonly legend: GlyphChartLegendLayout | null;
  /** `false` for an arc/text-only spec — see `layoutGlyphChart`'s own comment. `paintAxes` reads this to skip drawing an axis nobody needs. */
  readonly hasCartesianAxes: boolean;
}

/** A power-of-ten value (either sign) — the tick a log axis must never thin away, so the reader always has at least one labelled decade to anchor the others against (review finding 5). */
function isDecadeTick(value: unknown): boolean {
  if (typeof value !== "number" || value === 0 || !Number.isFinite(value)) return false;
  const log = Math.log10(Math.abs(value));
  return Number.isFinite(log) && Math.abs(log - Math.round(log)) < 1e-9;
}

/**
 * A calendar-day boundary (local midnight) — d3's own multi-scale time
 * `tickFormat` already renders exactly these ticks with a DATE (`"Tue 02"`),
 * never a bare time, so giving them the same never-thinned priority a log
 * axis's decades get is what makes a reader's one reliable date anchor
 * survive collision thinning (review finding 8).
 */
function isDateBoundaryTick(value: unknown): boolean {
  return value instanceof Date && value.getHours() === 0 && value.getMinutes() === 0 && value.getSeconds() === 0 && value.getMilliseconds() === 0;
}

/**
 * d3's per-tick multi-scale formatter (`formatHour = timeFormat("%I %p")`)
 * renders every exact-hour, non-midnight tick as a bare time ("12 PM") with
 * NO date at all, regardless of which day it falls on — so a multi-day axis
 * whose ticks all land on the same time of day (noon, say) can end up with
 * every surviving label reading identically. Used to force a DATE onto the
 * first surviving tick (review finding 8's "the first label still omits its
 * date") and to reformat a first-format duplicate before dropping it.
 */
const FULL_TIME_LABEL = timeFormat("%a %d, %I %p");

function axisTicks(
  raw: readonly { value: unknown; fraction: number; label: string }[],
  toCell: (f: number) => number,
  axis: "x" | "y", cols: number, rows: number, labelRow: number,
  maxWidth: number, band: boolean, charset: GlyphChartCharset, ledger: GlyphChartLedgerEntry[],
  priorityValues: ReadonlySet<unknown> = new Set(),
  requestedCount = Infinity,
  timeAxis = false,
  format?: GlyphChartResolvedTickFormat,
  textScale = 1,
  // A heatmap's (flush band) categories: y labels may sit on consecutive
  // rows, x labels need only their own width plus a gap, and thinning keeps
  // the first category.
  flush = false,
): GlyphChartLayoutTick[] {
  const rowGap = flush ? 0 : 1;
  let sorted = raw.map((t) => ({ ...t, cell: toCell(t.fraction) })).sort((a, b) => a.cell - b.cell);
  // The leftmost tick is the reader's only anchor for what date the WHOLE
  // axis is showing, so it is forced to survive (added to the priority set,
  // exactly like the zero baseline) and, when it isn't itself a date
  // boundary, reformatted to carry one explicitly BEFORE the normal
  // label-layout/abbreviation/collision pipeline runs on it — never patched
  // in afterward, which would leave its `labelStart`/collision decisions
  // computed for the shorter original string and paint the longer one
  // overlapping whatever now sits to its right (review finding 8: "the
  // first label still omits its date"). Skipped entirely under a custom
  // `format` — every tick, first included, already carries whatever that
  // formatter produced, and overwriting it here would silently discard the
  // caller's own choice for exactly the one tick most likely to anchor it.
  let priorityValuesEffective = priorityValues;
  if (timeAxis && !format && sorted.length > 0) {
    const first = sorted[0]!;
    priorityValuesEffective = new Set([...priorityValues, first.value]);
    if (!isDateBoundaryTick(first.value)) sorted = [{ ...first, label: FULL_TIME_LABEL(first.value as Date) }, ...sorted.slice(1)];
  }
  // Band ticks retain every kth category when a slot cannot carry even a
  // useful abbreviated label. Numeric/time ticks instead compare what d3
  // actually RETURNED against what was actually REQUESTED: `scale.ticks(n)`
  // can overshoot `n` to land on a "nice" step (`ticks(0, 8, 6)` returns 9),
  // and thinning that overshoot through the collision loop below alone
  // picks an ARBITRARY subset (whichever candidates happen not to collide
  // in visiting order) rather than a coarser NICE set — `0,2,4,6,8` for a
  // budget of 6, not `0,3,4,6,8` (review finding 9: gaps 2,2,1,3). A single
  // uniform stride applied by INDEX POSITION (not physical spacing, which
  // the band branch above still uses — categories have no "nice number"
  // notion to preserve) reduces any overshoot to a coarser, evenly-spaced
  // subsequence of d3's own nice ladder.
  let stride = 1;
  if (band && sorted.length > 1) {
    const spacing = Math.max(1, (sorted.at(-1)!.cell - sorted[0]!.cell) / (sorted.length - 1));
    // The target spacing (5 cols/2 rows) is a MINIMUM LABEL FOOTPRINT, and a
    // label painted at `scale: textScale` occupies `textScale` cells per
    // glyph — scaling it the same way keeps the band-label stride (and so
    // which category labels survive) identical across every web Density,
    // exactly like the y-axis's own `yMinRowSpacing` above.
    const footprint = axis === "y" ? 1 + rowGap : flush ? Math.max(...sorted.map((t) => t.label.length)) + 1 : 5;
    stride = Math.max(1, Math.ceil(footprint * textScale / spacing));
  } else if (!band && sorted.length > requestedCount && requestedCount > 0) {
    stride = Math.ceil(sorted.length / requestedCount);
  }
  // Final-gate-2 review (Opus finding 6 / codex #9): the overshoot stride
  // above samples `sorted` by RAW INDEX, and `sorted` is ordered by CELL —
  // ascending row number, which for the y-axis's `fractionToRow` mapping is
  // DESCENDING value (a bigger value sits at a SMALLER row). Index 0 is
  // therefore the domain's MAXIMUM, so `i % stride === 0` anchors the kept
  // sequence at the max and works backward — and the zero baseline, forced
  // to survive via `priorityValuesEffective` regardless of its own index
  // parity, then lands at whatever offset the max-anchored stride left it
  // at, one gap short of uniform (the Area preset at heights 22-24: kept
  // ticks 9,7,5,3,1,0 — gaps 2,2,2,2,1 — because index 0 is the value 9,
  // not 0). Anchoring the modulo at the ZERO tick's own index instead (or,
  // when 0 isn't among the candidates, at the LAST index — `sorted`'s
  // domain-minimum end) makes the stride phase-align with the one tick a
  // zero-anchored chart already always keeps, so the sampled sequence is
  // arithmetic from zero (or from the minimum) by construction rather than
  // by coincidence.
  const zeroIndex = sorted.findIndex((t) => t.value === 0);
  const strideAnchor = zeroIndex >= 0 ? zeroIndex : flush && axis === "x" ? 0 : sorted.length - 1;
  const strided = sorted.filter((t, i) => (((i - strideAnchor) % stride) + stride) % stride === 0 || priorityValuesEffective.has(t.value));
  // Priority ticks (a bar/rect y-axis's zero baseline, a log axis's own
  // decade values) go through the greedy collision test FIRST, so they can
  // never lose their cell to an ordinary neighbour that merely happened to
  // sort earlier — same candidates, same per-candidate logic, only the
  // ORDER changes; with no priority values this is the original cell order.
  const candidates = priorityValuesEffective.size === 0 ? strided : [
    ...strided.filter((t) => priorityValuesEffective.has(t.value)),
    ...strided.filter((t) => !priorityValuesEffective.has(t.value)),
  ];
  const kept: GlyphChartLayoutTick[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const t = candidates[i]!;
    const spacing = Math.min(i > 0 ? Math.abs(t.cell - candidates[i - 1]!.cell) : Infinity, i + 1 < candidates.length ? Math.abs(candidates[i + 1]!.cell - t.cell) : Infinity);
    const slot = axis === "x" && band ? Math.min(maxWidth, Math.max(1, Math.floor(spacing) - 1)) : maxWidth;
    // `band` (the scale's own type, not a re-derivation from `t.value`'s
    // runtime type) decides this — a synthetic/mocked tick source could
    // hand a band axis numeric-typed `value`s with non-numeric `label`s, and
    // only the SCALE knows which vocabulary its own labels belong to. A
    // CALLBACK format's output is opaque text the library cannot parse back
    // into a number (AGENTS.md's "Charts" "Axes"), so it is always treated
    // as a category label (elided with `…`) regardless of the scale's own
    // numeric-ness — a PRESET keeps the scale's numeric hint, since a
    // preset's own `siFallback` (when it has one) exists exactly to serve
    // this drop-vs-abbreviate policy.
    const numeric = !band && !format?.isCallback && typeof t.value === "number";
    const label = glyphChartLabelLayout([{
      id: `${axis}:${String(t.value)}`, x: axis === "x" ? t.cell : Math.floor(slot / 2), y: axis === "x" ? labelRow : t.cell,
      text: t.label, maxWidth: slot, numeric, role: `${axis}-axis label`,
      // Only for a candidate ALREADY treated as numeric AND under a
      // CUSTOM format — a band/callback tick stays on the category-style
      // ellipsis path (`abbreviateChartText` gates on `numeric` first)
      // regardless of whether `t.value` happens to be a number underneath,
      // and the default (no `format`) path must never pass `rawValue` at
      // all: `abbreviateChartText` treats its PRESENCE as "this text came
      // from a preset, so only ITS OWN `siFallback` may rescue it" — passing
      // it unconditionally would silently swap the default path's own
      // generic SI-of-the-parsed-text fallback for an immediate drop.
      rawValue: numeric && format ? (t.value as number) : undefined,
      siFallback: numeric ? format?.siFallback : undefined,
      scale: textScale,
    }], { obstacles: [], viewport: { cols, rows }, charset });
    ledger.push(...label.ledger);
    const placed = label.placed[0];
    if (!placed) continue;
    // `placed.text.length * textScale` is the label's actual COLUMN
    // footprint once painted via `canvas.text({ scale: textScale })` — the
    // y-axis gutter right-aligns against it exactly like it always
    // right-aligned against the raw character count at `textScale === 1`.
    const labelCols = placed.text.length * textScale;
    const start = axis === "x" ? placed.x : Math.max(0, maxWidth - labelCols);
    // A full interval-overlap test (order-independent) rather than the
    // one-directional "does the new label start before the previous kept
    // one ends" check: priority reordering means `kept` is no longer
    // guaranteed to be in ascending cell order while this loop runs (it is
    // re-sorted at the end), so a one-directional test would misjudge a
    // candidate that sorts BEFORE an already-kept priority tick.
    const tEnd = start + labelCols - 1;
    // Symmetric (order-independent) form of the original one-directional
    // "does the new label start before a 1-cell gap past the previous kept
    // one ends" test — reduces to exactly that test when candidates are
    // visited in ascending cell order (the un-prioritised case), and also
    // catches a candidate that sorts BEFORE an already-kept priority tick.
    // The y-axis test's own minimum spacing generalizes from "2" (one
    // scale-1 label row + one blank gap row) to `textScale + 1` (a
    // `textScale`-row label + the same one-row gap).
    const collides = kept.some((k) => axis === "x"
      ? start <= k.labelStart + k.label.length * textScale && k.labelStart <= tEnd + 1
      : Math.abs(t.cell - k.cell) < textScale + rowGap);
    if (collides) continue;
    // Never show the identical label text twice — ambiguous, not merely
    // crowded (review finding 5/8: a multi-day time axis kept THREE ticks
    // all formatted "12 PM", because d3's per-tick multi-scale formatter
    // renders every exact-hour, non-midnight tick as a bare time with no
    // date regardless of which day it falls on). Checked against EVERY
    // already-kept label, not just the immediately previous one — two ticks
    // separated by a THIRD, distinctly-labelled tick could otherwise still
    // repeat the same ambiguous string (review finding 7: a 3-/4-day axis
    // kept "12 PM" a second and third time past the immediate neighbour).
    const duplicate = kept.some((k) => k.label === placed.text);
    if (duplicate) {
      ledger.push(ledgerTickDuplicateDropped({ axis, label: placed.text }));
      continue;
    }
    kept.push({ value: t.value, label: placed.text, cell: t.cell, labelStart: start });
  }
  // Priority ticks were considered out of cell order above; restore ascending
  // cell order for the returned/painted set (every consumer assumes it).
  kept.sort((a, b) => a.cell - b.cell);
  if (kept.length < raw.length) ledger.push(ledgerTicksThinned({ axis, shown: kept.length, total: raw.length, stride, band }));
  return kept;
}

/**
 * Shrinks a numeric/time axis's requested tick count until the SCALE's own
 * `ticks(n)` map to rows that already clear the minimum spacing on their
 * own — so `axisTicks`'s later collision loop has nothing left to
 * arbitrarily thin (CHARTS-RESEARCH diagnosis B3). The row-budget off-by-one
 * fix at this function's call site handles the DOMINANT cause (over-asking
 * d3 by one tick), but it doesn't fully rule out a second, independent one:
 * `scale.ticks(n)` can return a count that already fits the budget while
 * two of its VALUES still round to the same or adjacent rows (a step that
 * doesn't divide the available rows evenly) — this loop is what turns "the
 * budget fits" into "the actual rows fit," by re-asking for a coarser count
 * exactly as the diagnosis's own rule prescribes ("re-ask d3 with a smaller
 * count") rather than leaving the flat collision test to drop an arbitrary
 * rung. `y1 - y0` (not `y1 - y0 + 1`, matching `fractionToRow`'s own
 * `height - 1`) is the row-INTERVAL count the fraction spreads across.
 */
function fitTicksToRowSpacing(
  ticksFor: (n: number) => readonly GlyphChartTick[],
  initialCount: number,
  y0: number,
  y1: number,
  minSpacing: number,
): readonly GlyphChartTick[] {
  const toRow = (fraction: number) => y1 - Math.round(fraction * Math.max(1, y1 - y0));
  let n = initialCount;
  let ticks = ticksFor(n);
  while (n > 2) {
    const rows = [...new Set(ticks.map((t) => toRow(t.fraction)))].sort((a, b) => a - b);
    let fits = true;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i]! - rows[i - 1]! < minSpacing) { fits = false; break; }
    }
    if (fits) break;
    n -= 1;
    ticks = ticksFor(n);
  }
  return ticks;
}

export function seriesNames(marks: readonly GlyphChartResolvedMark[]): string[] {
  return [...new Set(chartSeries(marks).flatMap((s) => s.name === undefined ? [] : [s.name]))];
}

/** An axis's default title (packet item 6): the first mark's own channel
 * field NAME, only when it's a plain string (an accessor/literal-array
 * channel has no name to show). */
function defaultAxisFieldName(marks: readonly GlyphChartResolvedMark[], axis: "x" | "y"): string | undefined {
  for (const { mark } of marks) {
    const value = mark.channels[axis];
    if (typeof value === "string") return value;
  }
  return undefined;
}

/** Whether every numeric value this axis actually plots is an integer —
 * gates the "index/integer data never shows a 0.5 tick" rule below. `false`
 * (no filtering) when the axis carries no numeric data at all, so a purely
 * categorical/time axis is untouched. */
function isIntegerAxisData(marks: readonly GlyphChartResolvedMark[], axis: "x" | "y"): boolean {
  let sawNumber = false;
  for (const { rows } of marks) {
    for (const row of rows) {
      const v = row[axis];
      if (typeof v !== "number") continue;
      sawNumber = true;
      if (!Number.isInteger(v)) return false;
    }
  }
  return sawNumber;
}

/** Drop fractional ticks (0.5, 1.5, ...) once the underlying data are all
 * integers — d3's own "nice" ladder for a small domain like [0,3] reaches
 * for half-steps well before it runs out of room, which reads as real data
 * to an INDEX or integer-count axis (never a genuine intermediate value).
 * Never returns an empty result: if filtering would drop every tick, the
 * original set survives untouched rather than leaving the axis blank. */
function integerOnlyTicks(ticks: readonly GlyphChartTick[], integerData: boolean): readonly GlyphChartTick[] {
  if (!integerData) return ticks;
  const filtered = ticks.filter((t) => typeof t.value !== "number" || Number.isInteger(t.value));
  return filtered.length > 0 ? filtered : ticks;
}

export function layoutGlyphChart(
  spec: GlyphChartSpec,
  marks: readonly GlyphChartResolvedMark[],
  scales: GlyphChartResolvedScales,
  cols: number,
  rows: number,
  detail: GlyphChartDetail,
  ledger: GlyphChartLedgerEntry[],
  charset: GlyphChartCharset = "box",
  legendOption: GlyphChartResolvedLegendOption = { show: true, placement: "bottom", explicit: false },
  /**
   * Web-only `textScale` affordance (AGENTS.md's "Charts" "Density"
   * paragraph, `render.ts`'s own `GlyphChartRenderOptions.textScale` doc):
   * every row/column this function reserves for TEXT (title, axis titles,
   * tick labels, the bottom/title-shared legend row) reserves `textScale`
   * of them instead of `1` — the label is painted later via
   * `canvas.text({ scale: textScale })`, so its box is genuinely that
   * large. Default `1`, byte-identical to before this parameter existed
   * (every `+= textScale`/`-= textScale` below is `+= 1`/`-= 1` there).
   */
  textScale = 1,
): GlyphChartLayout {
  let top = 0;
  let bottom = rows - 1;

  // A spec made only of `arc`/`text` marks has no cartesian x/y axis to
  // show at all (a pie chart's own radius fills the whole rect) — skipping
  // the gutter and axis rows for that case, rather than drawing empty
  // ticks against a meaningless default [0,1] domain, is what keeps a
  // donut chart from wasting a third of a small viewport on an axis nobody
  // reads. Computed early (packet item 6 needs it to gate axis titles too).
  const NON_CARTESIAN_MARK_TYPES = ["arc", "text", "sankey", "funnel"];
  const cartesian = marks.some(({ mark }) => !NON_CARTESIAN_MARK_TYPES.includes(mark.type));

  const xAxisOpts = spec.axes?.x;
  const yAxisOpts = spec.axes?.y;
  // `undefined` for absent/`"auto"` — `formatAxisTicks` is then a no-op and
  // every label below is the scale's own default, byte-identical to before
  // `axes.{x,y}.format` existed (already validated by `validateGlyphChartSpec`;
  // re-resolving here is cheap and keeps this the ONE place that interprets it).
  const xTickFormat = resolveGlyphChartTickFormat(xAxisOpts?.format);
  const yTickFormat = resolveGlyphChartTickFormat(yAxisOpts?.format);
  const xTickMarks = xAxisOpts?.tickMarks ?? true;
  const yTickMarks = yAxisOpts?.tickMarks ?? true;
  const xAxisLine = xAxisOpts?.line ?? true;
  const yAxisLine = yAxisOpts?.line ?? true;
  const xGrid = xAxisOpts?.grid ?? false;
  const yGrid = yAxisOpts?.grid ?? false;
  const xAxisColor = resolveGlyphChartAxisColor(spec.axes, "x");
  const yAxisColor = resolveGlyphChartAxisColor(spec.axes, "y");
  // An auto title (derived from a mark's own field NAME, never an explicit
  // caller-supplied `axes.*.title`) costs a whole row it doesn't ask
  // permission for, and it repeats what the tick labels already say —
  // CHARTS-RESEARCH diagnosis B4 measured it costing 2 of 14 rows on a
  // 40x14 bar chart, which is exactly the regime where the y ladder no
  // longer fits (B3). An explicit title always shows regardless of size;
  // the auto default is gated on there being genuine room for it (rows>=20
  // for the x title, cols>=60 for the y title) AND the field name actually
  // being a name (>2 characters — `defaultAxisFieldName`'s own "v"/"m"
  // single-letter table columns are not worth a row anywhere).
  const xFieldName = defaultAxisFieldName(marks, "x");
  const yFieldName = defaultAxisFieldName(marks, "y");
  const autoXTitleFits = rows >= 20 && (xFieldName?.length ?? 0) > 2;
  const autoYTitleFits = cols >= 60 && (yFieldName?.length ?? 0) > 2;
  const xAxisTitleText = cartesian ? (xAxisOpts?.title !== undefined ? xAxisOpts.title : (autoXTitleFits ? xFieldName : undefined)) : undefined;
  const yAxisTitleText = cartesian ? (yAxisOpts?.title !== undefined ? yAxisOpts.title : (autoYTitleFits ? yFieldName : undefined)) : undefined;
  // `titleAt` placement (owner packet): defaults are byte-identical to
  // before either option existed — "center" is the x title's existing
  // centred placement, "top" is the y title's existing top-left placement.
  const xTitleAt: GlyphChartXAxisTitleAt = xAxisOpts?.titleAt ?? "center";
  const yTitleAt: GlyphChartYAxisTitleAt = yAxisOpts?.titleAt ?? "top";

  // Title placement (owner packet: "the title has to have some placement
  // controls"). Resolved once, up front, because BOTH the title's own row
  // reservation AND the legend's optional "title" placement (below) need to
  // know whether/where it landed. `position: "top"` claims a row the SAME
  // way the pre-existing unconditional title row did (byte-identical for
  // the default `title: string` shape); `position: "bottom"` claims the
  // chart's LAST row instead, reserved here — before the legend/axis
  // sections below get to `bottom` — so it is genuinely the bottommost row
  // of the whole chart, with the legend and axis rows stacking above it.
  const resolvedTitle = resolveGlyphChartTitle(spec.title);
  let titleRow: number | null = null;
  if (resolvedTitle.text && detail !== "simplified" && rows > 4 * textScale) {
    if (resolvedTitle.position === "bottom") { titleRow = bottom - textScale + 1; bottom -= textScale; }
    else { titleRow = top; top += textScale; }
  } else if (resolvedTitle.text) {
    ledger.push(ledgerTitleDropped({ cols, rows }));
  }

  // y-axis title, `titleAt: "top"` (default): "top-left, above the axis" —
  // rotating a column of text isn't representable on a character grid, so
  // unlike the x title this never shares a row with anything else.
  // `titleAt: "bottom"` is resolved later, inside the cartesian block below,
  // once the x-axis title's own row (if any) and the y-axis gutter (which
  // fixes the plot's column extent, independent of the row budget) are both
  // known — see that block's own comment.
  let yAxisTitleRow = -1;
  if (yAxisTitleText && detail !== "simplified" && yTitleAt === "top" && rows - top > 3 * textScale) {
    yAxisTitleRow = top;
    top += textScale;
  }

  // >= 1, not > 1: a single NAMED mark (packet item 4 — every mark
  // constructor takes `name?`) contributes its own legend entry with a
  // swatch exactly like a categorical series does; only ZERO named series
  // (nothing named anything) omits the row entirely.
  const names = seriesNames(marks);
  let legend: GlyphChartLayout["legend"] = null;
  // A mark's own `options.color` override (`chartSeries`' own resolution,
  // never re-derived here) repaints the legend swatch too — falls back to
  // the shared palette by first-appearance order exactly as before this
  // option existed. No further fallback here: `names` and `seriesColors`
  // both derive from the same `chartSeries` pass, so every name in `names`
  // is already a key of `seriesColors` (a `SERIES_COLORS[i % …]` fallback
  // here was previously unreachable dead code).
  const seriesColors = chartSeriesColors(marks);
  const items = names.map((label) => ({ label, color: seriesColors.get(label)! }));
  const reserveBottomLegend = (): boolean => {
    const legendWide = cols >= 12 && rows - top - 3 * textScale > 2 * textScale;
    if (legendWide) { legend = { placement: "bottom", row: bottom - textScale + 1, items }; bottom -= textScale; }
    return legendWide;
  };
  // A funnel's stage labels already carry the same identity a legend
  // entry would (AGENTS.md's "Charts" section) — an unrequested legend
  // just repeats them below the chart, so the default is OFF for a spec
  // whose only named series come from a `funnel` mark. An EXPLICIT
  // `legend: true` (spec or render option) still lists the stages.
  const funnelOnly = marks.length > 0 && marks.every(({ mark }) => mark.type === "funnel");
  const showLegend = legendOption.show && !(!legendOption.explicit && funnelOnly);
  // ONE named series shows the legend (`> 0`, not `> 1`): a single named
  // mark otherwise built a `meta.series` entry the row never painted.
  if (showLegend && names.length > 0 && detail !== "simplified") {
    if (legendOption.placement === "bottom") {
      if (!reserveBottomLegend()) ledger.push(ledgerLegendDropped({ series: names.length, cols, rows }));
    } else if (legendOption.placement === "title") {
      // Shares the title's own row (no extra row reserved) — a rough width
      // check up front (paint-time collision-avoidance still nudges each
      // entry clear of the title text itself); degrades to "bottom" with a
      // ledger entry when there's no title row at all, or the entries
      // plainly can't fit beside it.
      const entriesWidth = items.reduce((w, it) => w + it.label.length + 3, 0);
      const fits = titleRow !== null && cols >= 12 && entriesWidth <= cols - (resolvedTitle.text?.length ?? 0) - 2;
      if (fits) {
        legend = { placement: "title", row: titleRow!, items };
      } else if (reserveBottomLegend()) {
        ledger.push(ledgerLegendPlacementDegraded({ placement: "title", reason: titleRow === null ? "there's no title row to share" : "the entries don't fit beside the title" }));
      } else {
        ledger.push(ledgerLegendDropped({ series: names.length, cols, rows }));
      }
    } else {
      // Corner placements paint INSIDE the plot rect at paint time — no
      // chart row reserved here at all.
      legend = { placement: legendOption.placement, items };
    }
  } else if (showLegend && names.length > 0) {
    ledger.push(ledgerLegendDropped({ series: names.length, cols, rows }));
  }

  // Bottommost, under the axis labels: an unsigned heatmap's value key.
  const fills = cellFillValues(marks);
  let cellKeyRow = -1;
  if (fills.length > 0 && !cellSigned(fills) && detail !== "simplified" && rows - top - 3 * textScale > 2 * textScale) {
    cellKeyRow = bottom - textScale + 1;
    bottom -= textScale;
  }

  let xAxisLabelRow = -1;
  let xAxisLineRow = -1;
  let xAxisTitleRow = -1;
  let yAxisCol = 0;
  let xTicks: GlyphChartLayoutTick[] = [];
  let yTicks: GlyphChartLayoutTick[] = [];

  if (cartesian && rows - top >= 3 && cols >= 4) {
    // y-axis gutter width and the y-tick ladder are computed by this same
    // closure twice below — once PROVISIONALLY (to size the column gutter
    // for the `titleAt: "bottom"` sharing check, before any bottom-stack
    // row is reserved) and once FINALLY (against the true, fully-reserved
    // `bottom`, so the tick ladder painted is the one actually fitted to
    // the plot it lands in — see the reservation-order comment below).
    // `bottomForFit` is the only thing that varies between the two calls.
    //
    // The requested count is derived from what the MINIMUM label spacing
    // (2 rows, `axisTicks`'s own y-collision rule) can actually hold —
    // asking d3 for more than that just gets greedily thinned back down to
    // an arbitrary, unevenly-spaced subset (review finding 5) rather than
    // d3's own evenly-spaced "nice" answer for a count that already fits.
    // `axes.y.ticks` (packet item 6) overrides this budget outright — a
    // caller-requested count, not a fitting heuristic; `axisTicks`'s own
    // collision/stride thinning still applies underneath it.
    // `bottomForFit - top` is the number of ROW-INTERVALS the plot's
    // `bottomForFit - top + 1` rows span (one fewer than the row count),
    // and a minimum 2-row spacing between adjacent ticks (`axisTicks`'s own
    // y-collision rule) admits at most `floor(intervals / 2) + 1` of them.
    // This is only ever a STARTING GUESS, never the final count:
    // `fitTicksToRowSpacing` below re-asks d3 for one fewer tick at a time
    // until the ladder it gets back already clears the minimum spacing on
    // its own, so the final ladder converges to the same answer regardless
    // of which reasonable count this seeds it with — final-gate-2 review
    // (Opus finding 9, "the yRowBudget off-by-one fix is inert") measured
    // this directly: restoring the interval-vs-row-count off-by-one this
    // replaced (`floor((bottomForFit - top + 1) / 2) + 1`) leaves every
    // kept y-ladder byte-identical across every tray-preset/width/height
    // this package sweeps. Kept in its now-correct (interval-counting)
    // form because it is the more honest formula for what this variable is
    // actually named, not because a wrong seed would change the result.
    const yZeroAnchored = scales.y.type !== "band" && scales.y.type !== "time" && hasZeroAnchoredMark(marks);
    // The minimum y-tick row spacing generalizes from `2` (a scale-1 label
    // row + a blank gap row, `axisTicks`'s own y-collision rule) to
    // `textScale + 1` — see that function's own matching comment.
    const yMinRowSpacing = textScale + 1;
    const computeYGutter = (bottomForFit: number) => {
      const yRowBudget = yAxisOpts?.ticks ?? Math.max(2, Math.min(8, Math.floor((bottomForFit - top) / yMinRowSpacing) + 1));
      // Only the auto-computed budget gets shrunk to fit actual row
      // spacing — an explicit `axes.y.ticks` count is a caller request, not
      // a fitting heuristic (matches `axisTicks`'s own stride/collision
      // thinning, which still applies underneath either path). Band ticks
      // ignore `count` entirely (`buildBand`'s own `ticks()`), so they're
      // excluded too.
      const yTicksFitted = scales.y.type === "band" || yAxisOpts?.ticks !== undefined
        ? scales.y.ticks(yRowBudget)
        : fitTicksToRowSpacing((n) => scales.y.ticks(n), yRowBudget, top, bottomForFit, yMinRowSpacing);
      let yTicksRaw: readonly GlyphChartTick[] = formatAxisTicks(
        integerOnlyTicks(yTicksFitted, scales.y.type !== "band" && scales.y.type !== "time" && isIntegerAxisData(marks, "y")),
        yTickFormat,
      );
      // The zero baseline is the one tick a bar/rect/area chart must always
      // label, whether or not d3's own "nice" set happened to include it.
      if (yZeroAnchored && !yTicksRaw.some((t) => t.value === 0)) {
        const zeroLabel = yTickFormat ? yTickFormat.apply(0, yTicksRaw.length, [...yTicksRaw.map((t) => t.value), 0]) : scales.y.format(0);
        yTicksRaw = [...yTicksRaw, { value: 0, fraction: scales.y.toFraction(0), label: zeroLabel }];
      }
      const yLabelWidth = Math.min(Math.max(1, Math.floor(cols / 4)), yTicksRaw.reduce((w, t) => Math.max(w, abbreviateChartText(t.label, cols, charset, scales.y.type !== "band" && typeof t.value === "number").text.length), 1));
      // The gutter reserves `yLabelWidth * textScale` COLUMNS — each
      // character of a right-aligned y-tick label now occupies `textScale`
      // columns once painted via `canvas.text({ scale: textScale })`.
      return { yRowBudget, yTicksRaw, yLabelWidth, yAxisCol: yLabelWidth * textScale + 1 };
    };

    // x-axis title, when present, is the BOTTOM-most row (drawn "under the
    // x axis", i.e. below its own tick labels) — reserved before the label
    // row so both survive together or the title alone drops first on a
    // short chart.
    const xAxisTitleWillShow = !!(xAxisTitleText && detail !== "simplified" && rows - top >= 4 * textScale);
    const wantsYTitleBottomRow = !!(yTitleAt === "bottom" && yAxisTitleText && detail !== "simplified");

    // y-axis title, `titleAt: "bottom"`: below the plot at the axis column
    // (column 0, mirroring `"top"`'s own column) — shares the x-axis
    // title's own row when it fits to the LEFT of it (column math only,
    // resolved from a PROVISIONAL gutter below); when both titles genuinely
    // want the bottom and don't fit side by side, the y title claims a
    // second row of its own and logs `axis-title-stacked`. With no x-axis
    // title to share with, it simply claims its own row — the same base
    // cost `titleAt: "bottom"`'s own doc describes, no stacking conflict to
    // report.
    let fitsSharing = false;
    if (wantsYTitleBottomRow) {
      const provisionalBottom = bottom - (xAxisTitleWillShow ? textScale : 0) - textScale;
      const provisionalGutter = computeYGutter(provisionalBottom);
      const titlePlotX0 = Math.min(cols - 1, provisionalGutter.yAxisCol + 1);
      const titlePlotWidth = Math.max(1, cols - 1 - titlePlotX0 + 1);
      let xTitleStartCol = cols;
      if (xAxisTitleWillShow && xAxisTitleText) {
        // Measured through the SAME `canvas.text` fold `paint.ts` paints
        // with (F10) — a raw JS `.length` counts UTF-16 code units, not
        // painted CELLS, so a combining-mark sequence or any character
        // `canvas.text` folds to something else would size this check
        // differently from what actually lands on screen.
        const xLen = chartText(xAxisTitleText, charset).length;
        xTitleStartCol = xTitleAt === "start" ? titlePlotX0
          : xTitleAt === "end" ? Math.max(titlePlotX0, cols - xLen)
          : Math.max(titlePlotX0, titlePlotX0 + Math.floor((titlePlotWidth - xLen) / 2));
      }
      // The y-title's own painted footprint scales to `textScale` columns
      // per character; the trailing `+1` (one blank gap column before the
      // x-title's own start column) stays a single column regardless.
      fitsSharing = xAxisTitleWillShow && chartText(yAxisTitleText!, charset).length * textScale + 1 < xTitleStartCol;
    }

    // Rows are reserved here in true visual (bottom-up) ORDER, not merely
    // by how many are spent: the y-axis title's own row (when it needs
    // one) is claimed FIRST — as the actual bottommost row of the grid —
    // so it lands BELOW the x-axis title and its tick labels, never
    // between the axis line and the labels the pre-fix code produced
    // (review F1: `xAxisTitleRow`/`xAxisLabelRow` had already claimed the
    // true bottom rows by the time this block used to run, so a
    // non-sharing y title was pushed ABOVE both instead of below them).
    // Claiming it here — before `computeYGutter`'s FINAL call below runs —
    // is also what keeps the y-tick ladder identical to what the same plot
    // height gets via `titleAt: "top"` (review F2): the "top" path already
    // reserves its own row from `top` before any tick fit runs, so
    // `titleAt: "bottom"` must reserve its row from `bottom` on the same
    // schedule rather than after `computeYGutter` has already fitted ticks
    // against a `bottom` one row taller than the plot ends up being.
    if (wantsYTitleBottomRow && !fitsSharing && bottom - (xAxisTitleWillShow ? textScale : 0) - textScale > top) {
      yAxisTitleRow = bottom - textScale + 1;
      bottom -= textScale;
      if (xAxisTitleWillShow) ledger.push(ledgerAxisTitleStacked({ cols, rows }));
    }
    if (xAxisTitleWillShow) {
      xAxisTitleRow = bottom - textScale + 1;
      bottom -= textScale;
    }
    xAxisLabelRow = bottom - textScale + 1;
    bottom -= textScale;
    if (wantsYTitleBottomRow && fitsSharing) {
      yAxisTitleRow = xAxisTitleRow;
    }
    // The axis LINE is no longer a separately reserved row below the plot
    // (CHARTS-RESEARCH diagnosis B1) — `xAxisLineRow` is reassigned below,
    // once the plot rect and y scale are known, to whichever row the
    // y-scale's own zero actually lands on (that row IS the plot's bottom
    // row `bottom` for the common all-nonnegative/zero-anchored domain,
    // and an INTERIOR row for a mixed-sign one — see the derivation below
    // and B6a). Reserving a distinct row here, unconditionally one below
    // the plot, put the drawn rule one row past the plot's own y=0 row,
    // floating every bar/area a full row off the line meant to anchor them.

    // The FINAL gutter/tick fit, against the now fully-reserved `bottom` —
    // see `computeYGutter`'s own comment above for why this must be a
    // second, later call rather than reusing the provisional one.
    const finalGutter = computeYGutter(bottom);
    yAxisCol = finalGutter.yAxisCol;
    const yLabelWidth = finalGutter.yLabelWidth;
    let yTicksRaw: readonly GlyphChartTick[] = finalGutter.yTicksRaw;
    const yRowBudget = finalGutter.yRowBudget;

    const plotForTicks: GlyphChartPlotRect = {
      x0: Math.min(cols - 1, yAxisCol + 1),
      y0: top,
      x1: cols - 1,
      y1: Math.max(top, bottom),
    };
    const plotWidth = Math.max(1, plotForTicks.x1 - plotForTicks.x0 + 1);
    const plotHeight = Math.max(1, plotForTicks.y1 - plotForTicks.y0 + 1);

    // The x-axis LINE row (CHARTS-RESEARCH diagnosis B1/B6a): wherever the
    // y-scale's own zero lands, via the SAME fraction->row mapping every
    // bar/area painter already uses for its own baseline
    // (`scaleToRow(scales.y, plot, 0)`) — so the drawn rule and the row a
    // bar stops one short of are, by construction, the same row. For a
    // domain that does not admit zero at all (a band/time y scale, or a
    // continuous one whose domain excludes it), that row is `plotForTicks
    // .y1`, the y-MINIMUM row — the plot's own bottom edge, exactly where
    // the pre-fix code always drew it. For an ordinary non-negative
    // zero-anchored domain (the common bar/area case), the two coincide:
    // `toFraction(0) === 0` there too. Only a MIXED-SIGN domain (B6a) puts
    // this row somewhere INTERIOR to the plot — positive bars grow up from
    // it, negative bars down, and `paintAxes` draws the actual rule there.
    const yPositional = scales.y.type !== "band" && scales.y.type !== "time";
    const zeroFraction = yPositional ? scales.y.toFraction(0) : NaN;
    xAxisLineRow = Number.isFinite(zeroFraction) && zeroFraction >= 0 && zeroFraction <= 1
      ? fractionToRow(plotForTicks, zeroFraction)
      : plotForTicks.y1;

    // A band category's tick fraction is otherwise an independent
    // continuous-fraction computation (`scale.ticks()`'s own `bandwidth/2`
    // center) that rounds to a row on its OWN, unrelated to `bandRowRange`'s
    // integer partition of the same plot — the two can (and, pre-fix,
    // measurably did — review finding 2) disagree about which row a
    // category's band actually occupies. Re-deriving each band tick's
    // fraction from `bandPartitionRowRange`'s own chunk centre guarantees
    // the label always lands inside (at the centre of) the exact rows
    // `bandRowRange` paints, by construction rather than by coincidence.
    if (scales.y.type === "band") {
      const total = scales.y.domain.length;
      yTicksRaw = yTicksRaw.map((t) => {
        const index = scales.y.domain.indexOf(String(t.value));
        if (index < 0 || total === 0) return t;
        const [chunkTop, chunkBottom] = bandPartitionRowRange(bandCategoryPlot(plotForTicks, xAxisLine), total, total - 1 - index);
        const center = Math.round((chunkTop + chunkBottom) / 2);
        const fraction = plotHeight > 1 ? (plotForTicks.y1 - center) / (plotHeight - 1) : t.fraction;
        return { ...t, fraction };
      });
    }

    // x: same "ask for what fits" idea, refined by an actually MEASURED
    // label width rather than a flat constant — a provisional request gives
    // d3's own labels to measure, then a tighter final request (never
    // larger) accounts for genuinely wide ones (e.g. "Jan 01" on a time
    // axis) instead of relying on `axisTicks`'s collision thinning to claw
    // back the overshoot.
    // `axes.x.ticks` (packet item 6) is a requested count, not a fitting
    // heuristic — it skips the measured-width auto-shrink below entirely,
    // exactly like the y budget above.
    // `6` is a MINIMUM COLUMN SPACING per label (AGENTS.md's "Charts"
    // "Axes"), and `measuredXLabelWidth` is a raw character count whose
    // actual painted footprint is `measuredXLabelWidth * textScale` columns
    // once drawn via `canvas.text({ scale: textScale })` — both budgets
    // scale by `textScale` so the auto-requested x-tick count (and so the
    // set of tick VALUES `scale.ticks(n)` returns) stays the same across
    // every web Density, mirroring the y budget's `yMinRowSpacing` above.
    const xTickCountProvisional = xAxisOpts?.ticks ?? Math.max(2, Math.floor(plotWidth / (6 * textScale)));
    const provisionalXTicks = formatAxisTicks(scales.x.ticks(xTickCountProvisional), xTickFormat);
    const measuredXLabelWidth = provisionalXTicks.reduce((w, t) => Math.max(w, abbreviateChartText(t.label, cols, charset, scales.x.type !== "band" && typeof t.value === "number").text.length), 1);
    const xTickCount = xAxisOpts?.ticks ?? Math.max(2, Math.min(xTickCountProvisional, Math.floor(plotWidth / (measuredXLabelWidth * textScale + 1))));
    let xTicksRaw = integerOnlyTicks(
      xTickCount >= xTickCountProvisional ? provisionalXTicks : formatAxisTicks(scales.x.ticks(xTickCount), xTickFormat),
      scales.x.type !== "band" && scales.x.type !== "time" && isIntegerAxisData(marks, "x"),
    );

    // Same disagreement as the y-band fix above, mirrored for columns
    // (CHARTS-RESEARCH diagnosis B6c): `scale.ticks()`'s own continuous
    // `start + bandwidth/2` fraction, rounded to a column independently,
    // can (and measurably did) land one column right of the band
    // `bandColRange` — the function `paintBar`/`paintRect`/`paintCell`
    // ACTUALLY paint from — occupies, because `bandColRange`'s own
    // `fractionToCol(hi) - 1` right-edge pull-in isn't visible to a
    // fraction computed independently of it. Re-deriving the tick's
    // fraction from `bandColRange`'s own painted `[lo, hi]` centre (the
    // same function the painters call, not a parallel re-implementation)
    // guarantees the label always centres on the exact columns the bar
    // occupies, by construction.
    if (scales.x.type === "band") {
      xTicksRaw = xTicksRaw.map((t) => {
        const range = bandColRange(scales.x, plotForTicks, t.value);
        if (!range) return t;
        const center = Math.round((range[0] + range[1]) / 2);
        const fraction = plotWidth > 1 ? (center - plotForTicks.x0) / (plotWidth - 1) : t.fraction;
        return { ...t, fraction };
      });
    }

    const xPriority = new Set<unknown>(
      scales.x.type === "log" ? xTicksRaw.filter((t) => isDecadeTick(t.value)).map((t) => t.value)
      : scales.x.type === "time" ? xTicksRaw.filter((t) => isDateBoundaryTick(t.value)).map((t) => t.value)
      : [],
    );
    const yPriority = new Set<unknown>(
      scales.y.type === "log" ? yTicksRaw.filter((t) => isDecadeTick(t.value)).map((t) => t.value)
      : yZeroAnchored ? [0]
      : scales.y.type === "time" ? yTicksRaw.filter((t) => isDateBoundaryTick(t.value)).map((t) => t.value)
      : [],
    );
    xTicks = axisTicks(xTicksRaw, (f) => plotForTicks.x0 + Math.round(f * (plotWidth - 1)), "x", cols, rows, xAxisLabelRow, cols, scales.x.type === "band", charset, ledger, xPriority, xTickCount, scales.x.type === "time", xTickFormat, textScale, scales.x.bandFlush);
    // `yLabelWidth * textScale`: `axisTicks`' own `maxWidth` is a COLUMN
    // budget (its `slot` is fed straight into `glyphChartLabelLayout`,
    // which now divides a candidate's `maxWidth` by `scale` to recover the
    // character budget) — `yLabelWidth` itself stays a raw character count
    // (the y gutter's own `yAxisCol` derivation multiplies it the same way).
    yTicks = axisTicks(yTicksRaw, (f) => plotForTicks.y1 - Math.round(f * (plotHeight - 1)), "y", cols, rows, 0, yLabelWidth * textScale, scales.y.type === "band", charset, ledger, yPriority, yRowBudget, scales.y.type === "time", yTickFormat, textScale, scales.y.bandFlush);
  }

  const plot: GlyphChartPlotRect = {
    x0: xAxisLineRow >= 0 ? Math.min(cols - 1, yAxisCol + 1) : 0,
    y0: top,
    x1: cols - 1,
    // The plot's bottom row is `bottom` itself now (B1) — never
    // `xAxisLineRow - 1`: the axis line sits AT `plot.y1` for the common
    // zero-anchored/no-zero-in-domain case, or somewhere INTERIOR to the
    // plot for a mixed-sign one, but the plot rect's own extent is fixed
    // by the reserved chrome rows alone, independent of where inside it
    // the line lands.
    y1: xAxisLineRow >= 0 ? Math.max(top, bottom) : bottom,
  };

  return {
    cols,
    rows,
    plot,
    xTicks,
    yTicks,
    titleRow,
    titleText: resolvedTitle.text,
    titleAlign: resolvedTitle.align,
    xAxisLineRow,
    xAxisLabelRow,
    yAxisCol,
    legend,
    hasCartesianAxes: xAxisLineRow >= 0,
    xTickMarks,
    yTickMarks,
    xAxisLine,
    yAxisLine,
    cellKeyRow,
    xGrid,
    yGrid,
    xAxisColor,
    yAxisColor,
    xAxisTitle: xAxisTitleRow >= 0 ? xAxisTitleText! : null,
    yAxisTitle: yAxisTitleRow >= 0 ? yAxisTitleText! : null,
    xAxisTitleRow,
    xAxisTitleAt: xTitleAt,
    yAxisTitleRow,
  };
}

export function fractionToCol(plot: GlyphChartPlotRect, fraction: number): number {
  const width = Math.max(1, plot.x1 - plot.x0 + 1);
  return plot.x0 + Math.round(fraction * (width - 1));
}

/** Row 0 is the grid's TOP, but a fraction of 1 means "top of the axis domain" (the scale's own convention) — so a larger fraction maps to a SMALLER row. */
export function fractionToRow(plot: GlyphChartPlotRect, fraction: number): number {
  const height = Math.max(1, plot.y1 - plot.y0 + 1);
  return plot.y1 - Math.round(fraction * (height - 1));
}

export function scaleToCol(scale: GlyphChartResolvedScale, plot: GlyphChartPlotRect, value: unknown): number {
  return fractionToCol(plot, scale.toFraction(value));
}

export function scaleToRow(scale: GlyphChartResolvedScale, plot: GlyphChartPlotRect, value: unknown): number {
  return fractionToRow(plot, scale.toFraction(value));
}

/**
 * `fractionToCol`/`fractionToRow` WITHOUT the `Math.round` — the sub-cell
 * precision a `braille`/`blocks` `dot` mark needs to place its mark at the
 * data point's actual sub-cell position (via `canvas.line`'s degenerate
 * point case) instead of snapping to the nearest whole cell first and
 * losing that precision before the canvas ever sees it. Every other caller
 * (bars, areas, axes, the whole-cell `dot` path) wants the rounded, integer
 * CELL the rest of this module already provides.
 */
export function fractionToColExact(plot: GlyphChartPlotRect, fraction: number): number {
  const width = Math.max(1, plot.x1 - plot.x0 + 1);
  return plot.x0 + fraction * (width - 1);
}

export function fractionToRowExact(plot: GlyphChartPlotRect, fraction: number): number {
  const height = Math.max(1, plot.y1 - plot.y0 + 1);
  return plot.y1 - fraction * (height - 1);
}

export function scaleToColExact(scale: GlyphChartResolvedScale, plot: GlyphChartPlotRect, value: unknown): number {
  return fractionToColExact(plot, scale.toFraction(value));
}

export function scaleToRowExact(scale: GlyphChartResolvedScale, plot: GlyphChartPlotRect, value: unknown): number {
  return fractionToRowExact(plot, scale.toFraction(value));
}

/** Exact band bounds in CELLS for a `band`-scaled `value` — `undefined` when `scale` isn't a band scale. */
export function bandColRange(scale: GlyphChartResolvedScale, plot: GlyphChartPlotRect, value: unknown): readonly [number, number] | undefined {
  if (scale.bandFlush) {
    // Flush (heatmap) bands tile the plot by integer partition, like
    // `bandRowRange`, so every cell gets the same width when the plot divides evenly.
    const index = scale.domain.indexOf(String(value));
    if (index < 0) return undefined;
    const width = plot.x1 - plot.x0 + 1, total = scale.domain.length;
    if (total > width) { const col = plot.x0 + Math.floor((index * width) / total); return [col, col]; }
    const base = Math.floor(width / total), remainder = width % total;
    const start = plot.x0 + index * base + Math.min(index, remainder);
    return [start, start + base + (index < remainder ? 1 : 0) - 1];
  }
  const range = scale.bandRange?.(value);
  if (!range) return undefined;
  const [lo, hi] = range;
  return [fractionToCol(plot, lo), fractionToCol(plot, hi) - 1];
}

/**
 * The rect a y-band category partition actually has available for
 * CATEGORIES, never the axis LINE row. Whenever `y` is a band scale,
 * `xAxisLineRow` unconditionally falls back to `plot.y1` (`layoutGlyphChart`'s
 * own derivation — a band/time y scale never admits a zero fraction), so
 * `plot.y1` IS the axis row for every band-y chart, heatmaps included. A
 * category partition that includes it hands a `cell` mark's bottommost
 * category a chunk `paintAxes` — which runs AFTER `paintCell` — then
 * unconditionally overwrites; when that chunk is exactly one row (as many
 * real category counts produce), the whole category's ink is erased with
 * no ledger entry (final-gate review finding 1). Bars/rects/areas already
 * stop one row short of the axis line for the identical reason
 * (`paintBar`'s own `(rowTop < rowBottom ? 1 : 0)` exclusion of the
 * baseline row) — this gives band-y categories the same guarantee, and
 * both `bandRowRange` (what `paintCell` paints into) and the y-tick label
 * centering below call this so a category's label always lands inside the
 * same rows it's actually painted into. Degrades to the full rect only
 * when excluding the axis row would leave nothing at all (a one-row plot)
 * — the same "never hand back an empty range" rule `bandPartitionRowRange`
 * itself already keeps.
 */
function bandCategoryPlot(plot: GlyphChartPlotRect, axisLine = true): GlyphChartPlotRect {
  return axisLine && plot.y1 - 1 >= plot.y0 ? { ...plot, y1: plot.y1 - 1 } : plot;
}

/**
 * Partitions `plot`'s `count` rows into `total` contiguous, gapless,
 * non-overlapping chunks (the SAME "first `total % count` chunks get one
 * extra cell" scheme `dodgeColRange` uses for columns) and returns the one
 * for `index`, ordered from `plot.y0` DOWN — `visual` 0 is the TOPMOST
 * chunk. Exported so `layoutGlyphChart`'s own y-axis tick placement can
 * center a band category's LABEL on the exact same chunk `bandRowRange`
 * paints, rather than an independently-rounded continuous fraction that can
 * disagree with it.
 */
export function bandPartitionRowRange(plot: GlyphChartPlotRect, total: number, visual: number): readonly [number, number] {
  const height = plot.y1 - plot.y0 + 1;
  if (total > height) {
    // More categories than rows: an equal partition would give some
    // categories a genuinely EMPTY (zero-row) range — the pigeonhole
    // principle makes strict non-overlap literally impossible here, so
    // every category instead gets its own single, non-empty row via the
    // standard evenly-distributed `floor(i * height / total)` assignment
    // (the same one `Array.from({length: N})` bucketing uses) —
    // MULTIPLE categories legitimately share a row, but none is ever
    // silently dropped to nothing (a heatmap with more categories than
    // its own plot has rows for still paints every one of them).
    const row = plot.y0 + Math.min(height - 1, Math.floor((visual * height) / total));
    return [row, row];
  }
  const base = Math.floor(height / total);
  const remainder = height % total;
  const size = base + (visual < remainder ? 1 : 0);
  const offset = visual * base + Math.min(visual, remainder);
  return [plot.y0 + offset, plot.y0 + offset + size - 1];
}

/**
 * Exact band bounds in CELLS (rows) for a `band`-scaled `value`.
 *
 * A continuous-fraction derivation (map each of the category's own `[lo,
 * hi]` fraction bounds to a row, then round) can make an already-thin band
 * round to a SINGLE row — and the "shrink the far edge by one" adjustment
 * that used to run unconditionally (to stop two adjacent bands sharing a
 * boundary row, review finding 12) then had NO room to shrink into and
 * deleted that row entirely: `[b + 1, a]` with `a === b` is the empty range
 * `[a + 1, a]` (review finding 2 — measured 7 of 76 swept band-count x
 * height combinations losing a whole category, 25 of 76 with a tick label
 * landing outside the band it names, because the label's own row came from
 * a THIRD, still-independent fraction rounding).
 *
 * Fixed by never rounding a continuous fraction into a row at all: `index`
 * (the category's position in the scale's own domain order) selects one
 * chunk of `bandPartitionRowRange`'s integer partition of the whole plot
 * height, which is gapless and non-overlapping BY CONSTRUCTION for every
 * category count and every plot height, and gives every category a
 * non-empty row the moment there are at least as many rows as categories.
 * Category `index` 0 sits at the scale's own fraction-0 end — `plot.y1`,
 * the BOTTOM row (`fractionToRow(0) === plot.y1`) — so chunks are assigned
 * bottom-up: `index` 0 gets the LAST (bottommost, `visual = total - 1`)
 * chunk.
 */
export function bandRowRange(scale: GlyphChartResolvedScale, plot: GlyphChartPlotRect, value: unknown, axisLine = true): readonly [number, number] | undefined {
  if (!scale.bandRange) return undefined;
  const total = scale.domain.length;
  const index = scale.domain.indexOf(String(value));
  if (index < 0 || total === 0) return undefined;
  return bandPartitionRowRange(bandCategoryPlot(plot, axisLine), total, total - 1 - index);
}

/**
 * Clips a segment `a`-`b` (in CELL space, possibly sub-cell/fractional) to
 * `plot`'s inclusive `[x0, x1] x [y0, y1]` rectangle — the standard
 * Liang-Barsky parametric line clip. Returns `null` when the segment misses
 * the rect entirely. Callers whose fill/text painters already clamp their
 * own coordinates (bar/rect/cell/arc/dot) don't need this; `line()` draws
 * along a run the canvas itself never bounds to anything narrower than the
 * whole grid, so a mark whose value lies outside an explicit, narrower
 * scale domain (review finding 2) would otherwise paint through the title,
 * the axis line, and the tick labels.
 */
export function clipSegmentToPlot(a: GlyphCanvasPointLike, b: GlyphCanvasPointLike, plot: GlyphChartPlotRect): readonly [GlyphCanvasPointLike, GlyphCanvasPointLike] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clipEdge = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (!clipEdge(-dx, a.x - plot.x0)) return null;
  if (!clipEdge(dx, plot.x1 - a.x)) return null;
  if (!clipEdge(-dy, a.y - plot.y0)) return null;
  if (!clipEdge(dy, plot.y1 - a.y)) return null;
  if (t0 > t1) return null;
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}

interface GlyphCanvasPointLike { readonly x: number; readonly y: number }
