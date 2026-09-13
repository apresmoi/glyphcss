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
import { chartSeries, SERIES_COLORS } from "./series";
import { abbreviateChartText, glyphChartLabelLayout } from "./labels";
import { hasZeroAnchoredMark } from "./scales";
import { ledgerLegendDropped, ledgerTickDuplicateDropped, ledgerTicksThinned, ledgerTitleDropped, type GlyphChartLedgerEntry } from "./ledger";
import type { GlyphChartResolvedMark } from "./resolve";
import type { GlyphChartResolvedScale, GlyphChartResolvedScales, GlyphChartTick } from "./scales";
import type { GlyphChartCharset, GlyphChartDetail, GlyphChartSpec } from "./types";

export interface GlyphChartLayoutTick {
  readonly value: unknown;
  readonly label: string;
  /** Cell column (x-axis) or row (y-axis). */
  readonly cell: number;
  /** Left edge after abbreviation and viewport placement. */
  readonly labelStart: number;
}

export interface GlyphChartPlotRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface GlyphChartLegendItem {
  readonly label: string;
  readonly color?: string;
}

export interface GlyphChartLayout {
  readonly cols: number;
  readonly rows: number;
  readonly plot: GlyphChartPlotRect;
  readonly xTicks: readonly GlyphChartLayoutTick[];
  readonly yTicks: readonly GlyphChartLayoutTick[];
  readonly titleRow: number | null;
  readonly xAxisLineRow: number;
  readonly xAxisLabelRow: number;
  readonly yAxisCol: number;
  /** Packet item 6 — axis tick marks/titles/grid, resolved with their defaults. */
  readonly xTickMarks: boolean;
  readonly yTickMarks: boolean;
  readonly xGrid: boolean;
  readonly yGrid: boolean;
  /** `null` when there's no title (explicit `""`, no string field, or no room). */
  readonly xAxisTitle: string | null;
  readonly yAxisTitle: string | null;
  readonly xAxisTitleRow: number;
  /** Top-left, above the y-axis — see `GlyphChartAxisOptions.title`'s doc. */
  readonly yAxisTitleRow: number;
  readonly legend: { readonly row: number; readonly items: readonly GlyphChartLegendItem[] } | null;
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
): GlyphChartLayoutTick[] {
  let sorted = raw.map((t) => ({ ...t, cell: toCell(t.fraction) })).sort((a, b) => a.cell - b.cell);
  // The leftmost tick is the reader's only anchor for what date the WHOLE
  // axis is showing, so it is forced to survive (added to the priority set,
  // exactly like the zero baseline) and, when it isn't itself a date
  // boundary, reformatted to carry one explicitly BEFORE the normal
  // label-layout/abbreviation/collision pipeline runs on it — never patched
  // in afterward, which would leave its `labelStart`/collision decisions
  // computed for the shorter original string and paint the longer one
  // overlapping whatever now sits to its right (review finding 8: "the
  // first label still omits its date").
  let priorityValuesEffective = priorityValues;
  if (timeAxis && sorted.length > 0) {
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
    stride = Math.max(1, Math.ceil((axis === "x" ? 5 : 2) / spacing));
  } else if (!band && sorted.length > requestedCount && requestedCount > 0) {
    stride = Math.ceil(sorted.length / requestedCount);
  }
  // Priority ticks (the zero baseline, a log axis's decades, a time axis's
  // date boundaries) survive the stride sample regardless of index parity —
  // the SAME "never lose a priority tick" guarantee the collision loop
  // below already gives them, extended to this earlier thinning pass.
  const strided = sorted.filter((t, i) => i % stride === 0 || priorityValuesEffective.has(t.value));
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
    // only the SCALE knows which vocabulary its own labels belong to.
    const numeric = !band && typeof t.value === "number";
    const label = glyphChartLabelLayout([{ id: `${axis}:${String(t.value)}`, x: axis === "x" ? t.cell : Math.floor(slot / 2), y: axis === "x" ? labelRow : t.cell, text: t.label, maxWidth: slot, numeric, role: `${axis}-axis label` }], { obstacles: [], viewport: { cols, rows }, charset });
    ledger.push(...label.ledger);
    const placed = label.placed[0];
    if (!placed) continue;
    const start = axis === "x" ? placed.x : Math.max(0, maxWidth - placed.text.length);
    // A full interval-overlap test (order-independent) rather than the
    // one-directional "does the new label start before the previous kept
    // one ends" check: priority reordering means `kept` is no longer
    // guaranteed to be in ascending cell order while this loop runs (it is
    // re-sorted at the end), so a one-directional test would misjudge a
    // candidate that sorts BEFORE an already-kept priority tick.
    const tEnd = start + placed.text.length - 1;
    // Symmetric (order-independent) form of the original one-directional
    // "does the new label start before a 1-cell gap past the previous kept
    // one ends" test — reduces to exactly that test when candidates are
    // visited in ascending cell order (the un-prioritised case), and also
    // catches a candidate that sorts BEFORE an already-kept priority tick.
    const collides = kept.some((k) => axis === "x"
      ? start <= k.labelStart + k.label.length && k.labelStart <= tEnd + 1
      : Math.abs(t.cell - k.cell) < 2);
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
  showLegend = true,
): GlyphChartLayout {
  let top = 0;
  let bottom = rows - 1;

  // A spec made only of `arc`/`text` marks has no cartesian x/y axis to
  // show at all (a pie chart's own radius fills the whole rect) — skipping
  // the gutter and axis rows for that case, rather than drawing empty
  // ticks against a meaningless default [0,1] domain, is what keeps a
  // donut chart from wasting a third of a small viewport on an axis nobody
  // reads. Computed early (packet item 6 needs it to gate axis titles too).
  const cartesian = marks.some(({ mark }) => mark.type !== "arc" && mark.type !== "text");

  const xAxisOpts = spec.axes?.x;
  const yAxisOpts = spec.axes?.y;
  const xTickMarks = xAxisOpts?.tickMarks ?? true;
  const yTickMarks = yAxisOpts?.tickMarks ?? true;
  const xGrid = xAxisOpts?.grid ?? false;
  const yGrid = yAxisOpts?.grid ?? false;
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

  let titleRow: number | null = null;
  if (spec.title && detail !== "simplified" && rows > 4) {
    titleRow = top;
    top += 1;
  } else if (spec.title) {
    ledger.push(ledgerTitleDropped({ cols, rows }));
  }

  // y-axis title: "top-left, above the axis" — rotating a column of text
  // isn't representable on a character grid, so unlike the x title this
  // never shares a row with anything else.
  let yAxisTitleRow = -1;
  if (yAxisTitleText && detail !== "simplified" && rows - top > 3) {
    yAxisTitleRow = top;
    top += 1;
  }

  // >= 1, not > 1: a single NAMED mark (packet item 4 — every mark
  // constructor takes `name?`) contributes its own legend entry with a
  // swatch exactly like a categorical series does; only ZERO named series
  // (nothing named anything) omits the row entirely.
  const names = seriesNames(marks);
  let legend: GlyphChartLayout["legend"] = null;
  const legendWide = names.length > 0 && cols >= 12 && rows - top - 3 > 2;
  if (showLegend && legendWide && detail !== "simplified") {
    legend = { row: bottom, items: names.map((label, i) => ({ label, color: SERIES_COLORS[i % SERIES_COLORS.length] })) };
    bottom -= 1;
  } else if (showLegend && names.length > 0) {
    ledger.push(ledgerLegendDropped({ series: names.length, cols, rows }));
  }

  let xAxisLabelRow = -1;
  let xAxisLineRow = -1;
  let xAxisTitleRow = -1;
  let yAxisCol = 0;
  let xTicks: GlyphChartLayoutTick[] = [];
  let yTicks: GlyphChartLayoutTick[] = [];

  if (cartesian && rows - top >= 3 && cols >= 4) {
    // x-axis title, when present, is the BOTTOM-most row (drawn "under the
    // x axis", i.e. below its own tick labels) — reserved before the label
    // row so both survive together or the title alone drops first on a
    // short chart.
    if (xAxisTitleText && detail !== "simplified" && rows - top >= 4) {
      xAxisTitleRow = bottom;
      bottom -= 1;
    }
    xAxisLabelRow = bottom;
    bottom -= 1;
    // The axis LINE is no longer a separately reserved row below the plot
    // (CHARTS-RESEARCH diagnosis B1) — `xAxisLineRow` is reassigned below,
    // once the plot rect and y scale are known, to whichever row the
    // y-scale's own zero actually lands on (that row IS the plot's bottom
    // row `bottom` for the common all-nonnegative/zero-anchored domain,
    // and an INTERIOR row for a mixed-sign one — see the derivation below
    // and B6a). Reserving a distinct row here, unconditionally one below
    // the plot, put the drawn rule one row past the plot's own y=0 row,
    // floating every bar/area a full row off the line meant to anchor them.

    // y-axis gutter width: measure a generous tick set's label width first,
    // then reserve exactly that many columns plus the axis-line column.
    // The requested count is derived from what the MINIMUM label spacing
    // (2 rows, `axisTicks`'s own y-collision rule) can actually hold —
    // asking d3 for more than that just gets greedily thinned back down to
    // an arbitrary, unevenly-spaced subset (review finding 5) rather than
    // d3's own evenly-spaced "nice" answer for a count that already fits.
    // `axes.y.ticks` (packet item 6) overrides this budget outright — a
    // caller-requested count, not a fitting heuristic; `axisTicks`'s own
    // collision/stride thinning still applies underneath it.
    // Off-by-one (CHARTS-RESEARCH diagnosis B3): `bottom - top` is the
    // number of ROW-INTERVALS the plot's `bottom - top + 1` rows span (one
    // fewer than the row count), and a minimum 2-row spacing between
    // adjacent ticks (`axisTicks`'s own y-collision rule) admits at most
    // `floor(intervals / 2) + 1` of them — the previous `+ 1` inside the
    // `floor` counted the row count instead of the interval count, so it
    // over-asked d3 by one tick at every height, and `axisTicks`'s
    // pre-existing overshoot-stride thinning (only engaged when d3 returns
    // MORE than requested) never triggered because the over-ask matched
    // d3's own overshoot exactly — leaving the flat collision loop to drop
    // an arbitrary interior rung instead of asking for (or striding down
    // to) a coarser, evenly-spaced ladder.
    const yRowBudget = yAxisOpts?.ticks ?? Math.max(2, Math.min(8, Math.floor((bottom - top) / 2) + 1));
    // Only the auto-computed budget gets shrunk to fit actual row spacing —
    // an explicit `axes.y.ticks` count is a caller request, not a fitting
    // heuristic (matches `axisTicks`'s own stride/collision thinning, which
    // still applies underneath either path). Band ticks ignore `count`
    // entirely (`buildBand`'s own `ticks()`), so they're excluded too.
    const yTicksFitted = scales.y.type === "band" || yAxisOpts?.ticks !== undefined
      ? scales.y.ticks(yRowBudget)
      : fitTicksToRowSpacing((n) => scales.y.ticks(n), yRowBudget, top, bottom, 2);
    let yTicksRaw: GlyphChartTick[] = integerOnlyTicks(yTicksFitted, scales.y.type !== "band" && scales.y.type !== "time" && isIntegerAxisData(marks, "y"));
    const yZeroAnchored = scales.y.type !== "band" && scales.y.type !== "time" && hasZeroAnchoredMark(marks);
    // The zero baseline is the one tick a bar/rect/area chart must always
    // label, whether or not d3's own "nice" set happened to include it.
    if (yZeroAnchored && !yTicksRaw.some((t) => t.value === 0)) {
      yTicksRaw = [...yTicksRaw, { value: 0, fraction: scales.y.toFraction(0), label: scales.y.format(0) }];
    }
    const yLabelWidth = Math.min(Math.max(1, Math.floor(cols / 4)), yTicksRaw.reduce((w, t) => Math.max(w, abbreviateChartText(t.label, cols, charset, scales.y.type !== "band" && typeof t.value === "number").text.length), 1));
    yAxisCol = yLabelWidth + 1;

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
        const [chunkTop, chunkBottom] = bandPartitionRowRange(plotForTicks, total, total - 1 - index);
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
    const xTickCountProvisional = xAxisOpts?.ticks ?? Math.max(2, Math.floor(plotWidth / 6));
    const provisionalXTicks = scales.x.ticks(xTickCountProvisional);
    const measuredXLabelWidth = provisionalXTicks.reduce((w, t) => Math.max(w, abbreviateChartText(t.label, cols, charset, scales.x.type !== "band" && typeof t.value === "number").text.length), 1);
    const xTickCount = xAxisOpts?.ticks ?? Math.max(2, Math.min(xTickCountProvisional, Math.floor(plotWidth / (measuredXLabelWidth + 1))));
    let xTicksRaw = integerOnlyTicks(
      xTickCount >= xTickCountProvisional ? provisionalXTicks : scales.x.ticks(xTickCount),
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
    xTicks = axisTicks(xTicksRaw, (f) => plotForTicks.x0 + Math.round(f * (plotWidth - 1)), "x", cols, rows, xAxisLabelRow, cols, scales.x.type === "band", charset, ledger, xPriority, xTickCount, scales.x.type === "time");
    yTicks = axisTicks(yTicksRaw, (f) => plotForTicks.y1 - Math.round(f * (plotHeight - 1)), "y", cols, rows, 0, yLabelWidth, scales.y.type === "band", charset, ledger, yPriority, yRowBudget, scales.y.type === "time");
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
    xAxisLineRow,
    xAxisLabelRow,
    yAxisCol,
    legend,
    hasCartesianAxes: xAxisLineRow >= 0,
    xTickMarks,
    yTickMarks,
    xGrid,
    yGrid,
    xAxisTitle: xAxisTitleRow >= 0 ? xAxisTitleText! : null,
    yAxisTitle: yAxisTitleRow >= 0 ? yAxisTitleText! : null,
    xAxisTitleRow,
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
  const range = scale.bandRange?.(value);
  if (!range) return undefined;
  const [lo, hi] = range;
  return [fractionToCol(plot, lo), fractionToCol(plot, hi) - 1];
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
export function bandRowRange(scale: GlyphChartResolvedScale, plot: GlyphChartPlotRect, value: unknown): readonly [number, number] | undefined {
  if (!scale.bandRange) return undefined;
  const total = scale.domain.length;
  const index = scale.domain.indexOf(String(value));
  if (index < 0 || total === 0) return undefined;
  return bandPartitionRowRange(plot, total, total - 1 - index);
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
