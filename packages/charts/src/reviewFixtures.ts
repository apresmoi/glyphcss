/**
 * `goodSpecs` below is what every "byte-identity against a real parent
 * build" gate (`strokeWidth.test.ts`, `textScale.test.ts`,
 * `tickFormat.test.ts`, `axisTitlePlacement.test.ts`) renders against a
 * checkout of the commit BEFORE that feature existed. "Claim A" — every
 * review round's baseline byte-identity check — holds across the WHOLE
 * `goodSpecs` array except for the following documented, deliberate
 * exceptions (each one a real, intentional change from some earlier
 * commit, verified against ITS OWN real parent build by its own dedicated
 * test file, never an accidental drift caught by a later review round):
 *
 * 1. `strokeWidth.test.ts` — a wide line's subcell anti-aliasing refinement.
 * 2. `textScale.test.ts` — 2x/3x character-cell allocation under `textScale`.
 * 3. `tickFormat.test.ts` — smart numeric tick compression (`1.2M`, `450k`)
 *    under a `format` preset.
 * 4. `axisTitlePlacement.test.ts` — start/center/end axis-title offset
 *    alignment.
 * 5. (codex P1-7, batch 4) A bar/rect/cell mark sharing an x axis with
 *    calendar-valid ISO date strings uses BAND (categorical, evenly-spaced)
 *    x-positions, never a continuous time scale — `scales.ts`'s
 *    `axisHasBandOnlyMark`/`BAND_ONLY_MARK_TYPES`. These three mark types
 *    are fundamentally discrete (one bar/cell per category); a time
 *    scale's own irregular date-interval spacing is the WRONG shape for
 *    them regardless of what their x values look like as strings. A line
 *    or dot mark on the identical data is unaffected — only bar/rect/cell.
 * 6. (fable review, batch 3, finding b — see `paint.ts`'s
 *    `paintCornerLegend`) A corner-placed legend's own swatch gutter grew
 *    from `text.length + 2` to `text.length*textScale + 3*textScale`
 *    columns, so a LINE-style series (dash/dot/double cadence) has enough
 *    room in its own swatch to actually show that cadence — a single-cell
 *    `canvas.line(p, p)` degenerates to one dot/glyph and can never carry
 *    it. Visible only on a `legend: { placement: "top-right" | ... }`
 *    corner spec with a named line series.
 * 7. (codex P1-5, fable P1-1, batch 4 — see `flowMarks.ts`'s
 *    `sankeyPlanPaintsSmooth`) A smooth-eligible sankey band (adjacent,
 *    non-folded, `braille`/`blocks`) is no longer registered with the
 *    canvas's junction system at all, so `canvas.resolveJunctions()` no
 *    longer writes stray box-drawing residue (`┌──────`-style glyphs) into
 *    its old, abandoned lane/free-row footprint before the smooth painter's
 *    own (different-shaped) footprint ever runs. Affects `goodSpecs[17]`
 *    (`sankeySample`) on `blocks`/`braille` ONLY — `ascii`/`box` have no
 *    subcell smooth path to abandon a footprint from, and every other
 *    `goodSpecs` entry has no sankey mark at all. The three fixture JSON
 *    files that carry index 17 on those two tiers (`textScaleParentFixtures
 *    .json`, `strokeWidthParentFixtures.json`, `axisTitleParentGoodSpecs
 *    .json`) have that one key's own VALUE re-derived from the current
 *    (fixed) build — every other key in each file is untouched, still the
 *    real 926ab7b0/pre-feature parent output.
 *
 * 8. (`flowMarks.ts`'s `sankeyAirGap`) Visual AIR — a gap between stacked
 *    node boxes in one column, and a gap between consecutive bands leaving
 *    or entering one node — is now reserved at the LAYOUT layer before any
 *    row is split among nodes/bands, so a sankey's boxes are visibly
 *    shorter than their column and its links no longer stack edge to edge.
 *    Affects `goodSpecs[17]` (`sankeySample`) on EVERY tier (unlike #7,
 *    this changes row math the fallback path shares too) — the four
 *    fixture files that carry index 17 (`strokeWidthParentFixtures.json`,
 *    `textScaleParentFixtures.json`, `tickFormatParentFixtures.json`,
 *    `axisTitleParentGoodSpecs.json`) have that one key's own value
 *    re-derived from the current build; every other key is untouched.
 *
 * 9. (`paint.ts`'s `paintAreaMark`, CHARTS-RESEARCH
 *    `DIAGNOSIS-stacked-area.md` S3) An area's outer silhouette gains a
 *    sub-cell edge on `blocks`/`braille`: the cell just outside the band
 *    (centre uncovered, part covered) carries the tier's partial fill
 *    glyph (`▗ ▄ ▘ ▀`) instead of staying blank, so a sloped top moves in
 *    half cells rather than whole-cell plateaus. It is the same painter and
 *    the same staircase for a single area as for a stack, so both changed.
 *    Affects `goodSpecs[1]` (`area([-1,1])`) on `blocks`/`braille` ONLY —
 *    `ascii`/`box` have no sub-cell fill, `stackedArea` (index 13) lands on
 *    whole cells, and every other entry has no area mark.
 *    `strokeWidthParentFixtures.json`/`textScaleParentFixtures.json` keys
 *    `1:blocks`/`1:braille` and `axisTitleParentGoodSpecs.json`'s `i: 1`
 *    (web = braille) were re-derived from the current build; every other
 *    key is untouched.
 *
 * 10. (`regionFill.ts`, CHARTS-RESEARCH `DIAGNOSIS-solid-colour-fills.md`)
 *    A COLOURED render whose region marks (bar/rect/area/arc) have distinct
 *    colours paints them solid in its colour-carrying exits only: `html`
 *    under `css` and `text` under `truecolor`/`ansi256`/`ansi16` on the web
 *    target. `build.canvas`, plain `text`, every `color: "none"` exit, NO_COLOR and
 *    the `terminal`/`chat` targets are untouched. `regionFill.test.ts` checks
 *    all of it against `regionFillParentFixtures.json` (hashes from
 *    `2ef7a70b`, the commit before the option existed): every key matches
 *    except where `glyphChartRegionFill` resolves `solid`, and each of those
 *    keys must DIFFER. No older fixture file changed, since every one of them
 *    renders `color: "none"`.
 *
 * 11. (`paint.ts`'s `paintBar`, `eighthBars.test.ts`) A positive,
 *    unstacked `█` bar measures its height in eighths of a row and caps its
 *    top with the matching lower eighth block (`▁`-`▇`) instead of rounding
 *    to whole cells. Shaded series, `ascii`, negative bars and stack segments
 *    are unchanged. Affects the bar entries whose heights are not whole rows
 *    (`goodSpecs[15]`, `[30]`-`[32]`) on `box`/`blocks`/`braille` ONLY; those
 *    keys were re-derived from the current build in every fixture file, each
 *    differing cell checked to be an eighth block where the parent had `█` or
 *    a blank. Every other key is untouched.
 *
 * 12. (`paint.ts`'s `barBandColRange`, `barWidth.test.ts`) A bar series
 *    paints at most `GLYPH_CHART_BAR_MAX_COLS` (3) cells, times `textScale`,
 *    centred on its tick, instead of filling its band (or 70% of its slot on
 *    a continuous x). Affects every bar entry wider than that
 *    (`goodSpecs[2]`, `[15]`, `[28]`-`[32]`) on every tier; those keys were
 *    re-derived from the current build, each differing cell checked to be
 *    bar ink in the parent that is now blank. Every other key is untouched.
 *
 * 13. (`heatmap.ts`, `heatmap.test.ts`) A chart made only of `cell` marks
 *    on two band scales tiles its cells flush, sizes each `2k` columns by `k`
 *    rows for the largest `k` that fits, and shrinks the canvas to that grid.
 *    Unsigned heatmaps also shade on a ramp with no blank level and get a
 *    range key. Affects `goodSpecs[14]` (signed, so only its geometry) on
 *    every tier; those keys were re-derived from the current build. Every
 *    other key is untouched, `goodSpecs[5]` (cells on linear scales) included.
 *
 * A NEW divergence found outside these thirteen is a real regression, not a
 * fourteenth exception to wave through — add it here, with its own dedicated
 * test, only when it is a genuinely deliberate change.
 */
import { glyphChartArc, glyphChartArea, glyphChartBar, glyphChartCell, glyphChartDot, glyphChartFunnel, glyphChartLine, glyphChartRect, glyphChartRule, glyphChartSankey, glyphChartText } from "./spec";
import type { GlyphChartMark, GlyphChartRenderOptions, GlyphChartSpec } from "./types";

export const categoricalSeriesData = [{ x: 0, y: 1, s: "A" }, { x: 1, y: 2, s: "A" }, { x: 0, y: 8, s: "B" }, { x: 1, y: 9, s: "B" }];
export const stackedArea = { ...glyphChartArea([{ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 3 }, { x: 1, y: 3 }], { x: "x", y: "y" }), transform: { kind: "stack" as const } };
export const signedCells = glyphChartCell([{ x: "a", y: "v", v: -10 }, { x: "b", y: "v", v: 0 }, { x: "c", y: "v", v: 10 }], { x: "x", y: "y", fill: "v" });
export const longBands = glyphChartBar([{ x: "abcdefghijklmnopqrstuvwx123456", y: 1 }, { x: "second-category-very-long", y: 2 }], { x: "x", y: "y" });
export const hourlyLine = glyphChartLine([{ x: "2026-01-01T00:00:00Z", y: 1 }, { x: "2026-01-01T02:00:00Z", y: 2 }], { x: "x", y: "y" });
export const categoricalDots = glyphChartDot([{ x: 0, y: "low" }, { x: 1, y: "high" }], { x: "x", y: "y" });
export const browserShares = [{ browser: "Chrome", share: 65 }, { browser: "Safari", share: 20 }, { browser: "Firefox", share: 15 }];
export const sankeySample = glyphChartSankey(
  [{ from: "A", to: "B", amount: 10 }, { from: "A", to: "C", amount: 5 }, { from: "B", to: "D", amount: 10 }, { from: "C", to: "D", amount: 5 }],
  { source: "from", target: "to", value: "amount" },
);
export const funnelSample = glyphChartFunnel(
  [{ stage: "Visits", count: 1000 }, { stage: "Views", count: 500 }, { stage: "Purchase", count: 100 }],
  { stage: "stage", value: "count" },
);
export const markFactories = [glyphChartLine, glyphChartArea, glyphChartBar, glyphChartDot, glyphChartRect, glyphChartCell, glyphChartArc, glyphChartText, glyphChartRule];
const spec = (mark: GlyphChartMark): GlyphChartSpec => ({ marks: [mark] });
export const goodSpecs: GlyphChartSpec[] = [
  ...markFactories.map((fn) => spec(fn([-1, 1]))),
  spec(glyphChartLine([3, 5, 2, 8])), spec(glyphChartBar([0, 0, 0])), spec(glyphChartArc([0, 0, 0])),
  spec(glyphChartLine(categoricalSeriesData, { x: "x", y: "y", fill: "s" })),
  spec(stackedArea), spec(signedCells), spec(longBands), spec(categoricalDots),
  spec(sankeySample), spec(funnelSample), spec(glyphChartFunnel([1000, 500, 100])),
  // Mutation: put arc back in XY_MARK_TYPES/schema's x+y clause -> this exact review input rejects.
  spec(glyphChartArc(browserShares, { fill: "browser", y: "share" })),
  spec(glyphChartArc(browserShares, { label: "browser", y: "share" })),
  spec(glyphChartArc(browserShares, { y: "share" })),
  { marks: [hourlyLine], scales: { x: { type: "time", domain: ["2026-01-01", "2026-01-02"] } } },
  { marks: [glyphChartDot([1, 10, 100])], scales: { y: { type: "log" } } },
  { marks: [glyphChartDot([0, 1, 4])], scales: { y: { type: "sqrt" } } },
  { marks: [glyphChartLine([1, 2]), glyphChartDot([1, 2]), glyphChartRule([0])], title: "<b>&x" },
  // Legend/title placement (owner packet items 1/2): an object title (align
  // + position) alongside a corner legend placement, both new option shapes.
  { marks: [glyphChartLine([1, 2, 3], undefined, { name: "A" })], title: { text: "Left title", align: "left", position: "bottom" }, legend: { placement: "top-right" } },
  ...(["bin", "stack", "group", "normalize", "window"] as const).map((kind) => spec({ ...glyphChartBar([1, 2, 4]), transform: { kind } })),
  // Axis title AUTOMATIC default coverage (review finding F3): every other
  // entry above has no axis title painted at all (a field name of "x"/"y",
  // or an accessor/literal-array channel with no field name to show), so
  // the byte-identity comparison below never exercised the default
  // `"center"`/`"top"` placement's actual painted position — a `paint.ts`
  // `floor`->`ceil` mutation on the centred title's start column left the
  // whole pre-fix suite green. Real field names (`> 2` characters) at the
  // package default web target (96x32, well past the `rows>=20`/`cols>=60`
  // auto-title gate) so both titles paint with no `titleAt` set at all —
  // this entry's own index (33) is in `axisTitleParentGoodSpecs.json`.
  spec(glyphChartLine([{ population: 0, income: 1 }, { population: 1, income: 3 }, { population: 2, income: 2 }, { population: 3, income: 4 }], { x: "population", y: "income" })),
  // Axis title placement: both axes' titleAt vocabularies exercised at once.
  // Appended last so every EARLIER fixture's index — including
  // `axisTitlePlacement.test.ts`'s own byte-identity comparison against a
  // pre-`titleAt` build — stays stable.
  { marks: [glyphChartLine([{ x: 0, y: 1 }, { x: 1, y: 3 }], { x: "population", y: "income" })], axes: { x: { titleAt: "end" }, y: { titleAt: "bottom" } } },
];

// Literal expected IDs are independent of the implementation's rule table.
// Mutation: delete any rule from the table OR its runtime check -> red.
export const badSpecs: { id: string; spec: GlyphChartSpec; options?: GlyphChartRenderOptions }[] = [
  { id: "empty-marks", spec: { marks: [] } },
  { id: "unknown-mark-type", spec: { marks: [null as never] } },
  { id: "unknown-mark-type", spec: spec({ type: "scatter3d", data: [1], channels: {} } as never) },
  { id: "empty-data", spec: spec(glyphChartLine([])) },
  { id: "missing-xy-channels", spec: spec(glyphChartLine([{ v: 1 }], { x: "v" })) },
  // Mutation: omit the arc value requirement, rule entry, hint, or schema clause -> Ajv/runtime parity goes red.
  { id: "arc-missing-value", spec: spec(glyphChartArc(browserShares, { fill: "browser" })) },
  { id: "unknown-transform", spec: spec({ ...glyphChartLine([1, 2]), transform: { kind: "bogus" } as never }) },
  { id: "invalid-transform-n", spec: spec({ ...glyphChartLine([1, 2]), transform: { kind: "bin", n: 0 } }) },
  { id: "invalid-inner-radius", spec: spec(glyphChartArc([1, 2], {}, { innerRadius: 1.5 })) },
  { id: "invalid-rule-axis", spec: spec(glyphChartRule([0], { axis: "z" as never })) },
  { id: "bad-size", spec: spec(glyphChartLine([1, 2])), options: { width: 20.5, height: 6 } },
  { id: "bad-text-scale", spec: spec(glyphChartLine([1, 2])), options: { textScale: 1.5 } },
  { id: "bad-region-fill", spec: spec(glyphChartLine([1, 2])), options: { regionFill: "stripes" as never } },
  { id: "bad-shades", spec: spec(glyphChartBar([1, 2])), options: { shades: ["##"] } },
  { id: "bad-cell-ramp", spec: spec(glyphChartBar([1, 2])), options: { cellRamp: [] } },
  { id: "non-finite-data", spec: spec(glyphChartLine([NaN, Infinity])) },
  { id: "non-finite-data", spec: spec(glyphChartLine([{ x: 1, y: Infinity }], { x: "x", y: "y" })) },
  { id: "bad-channels", spec: spec(glyphChartDot([1, 2], { size: [1, 2] } as never)) },
  { id: "bad-channels", spec: spec(glyphChartDot([1, 2], { shape: ["o", "x"] } as never)) },
  { id: "bad-options", spec: spec(glyphChartLine([1, 2], {}, { curve: "basis" } as never)) },
  { id: "bad-scale", spec: { marks: [glyphChartLine([1, 2])], scales: { y: { type: "bogus" } as never } } },
  { id: "log-domain", spec: { marks: [glyphChartBar([1, 10])], scales: { y: { type: "log" } } } },
  { id: "bad-scale", spec: { marks: [glyphChartBar([1, 2])], scales: { y: { type: "band", domain: ["a", "b"] } } } },
  ...([[0, 100], [-1, 1]] as const).map((domain) => ({ id: "log-domain", spec: { marks: [glyphChartDot([1, 10, 100])], scales: { y: { type: "log" as const, domain } } } })),
  ...([glyphChartBar, glyphChartRect] as const).map((fn) => ({ id: "bar-domain-excludes-zero", spec: { marks: [fn([5, 10])], scales: { y: { domain: [5, 10] } } } })),
  ...["2026-02-30", "2026-99-01", "2026-01-01T25:00:00Z"].map((date) => ({ id: "bad-time-domain", spec: { marks: [hourlyLine], scales: { x: { type: "time" as const, domain: [date, "2026-01-02"] } } } })),
  { id: "bad-time-domain", spec: { marks: [hourlyLine], scales: { x: { type: "time", domain: ["invalid", "2026-01-02"] } } } },
  { id: "bad-title", spec: { marks: [glyphChartLine([1, 2])], title: { text: "x", align: "diagonal" } as never } },
  { id: "bad-legend", spec: { marks: [glyphChartLine([1, 2])], legend: { placement: "middle" } as never } },
  // Mutation: drop the `sankey` schema `allOf` clause, the runtime channel
  // check, or the rule's table/hint entry -> Ajv/runtime parity goes red.
  { id: "sankey-bad-value", spec: spec({ ...glyphChartSankey([{ source: "a", target: "b", value: 1 }], { source: "source", target: "target", value: "value" }), channels: { source: "source", target: "target" } }) },
  // Mutation: drop `validateGlyphChartAxes`, its rule/hint entry, or widen
  // the schema's `axes`/`axes.{x,y}` back to accept non-objects -> Ajv/
  // runtime parity goes red (review finding P3-3: `axes?.color`'s optional
  // chaining silently accepted every one of these before this rule existed).
  { id: "bad-axes", spec: { marks: [glyphChartLine([1, 2])], axes: null as never } },
  { id: "bad-axes", spec: { marks: [glyphChartLine([1, 2])], axes: "red" as never } },
  { id: "bad-axes", spec: { marks: [glyphChartLine([1, 2])], axes: { x: null } as never } },
  { id: "bad-axes", spec: { marks: [glyphChartLine([1, 2])], axes: { x: 5 } as never } },
  // Mutation: drop the axis-colour check, its rule/hint entry, or the
  // schema's `axes.color` clause -> Ajv/runtime parity goes red. "none" is
  // deliberately not treated as a colour keyword here — it must fail the
  // same canonical-hex check any other invalid string would.
  { id: "bad-axis-color", spec: { marks: [glyphChartLine([1, 2])], axes: { color: "none" as never } } },
  { id: "bad-axis-color", spec: { marks: [glyphChartLine([1, 2])], axes: { x: { color: "#ABCDEF" as never } } } },
  // Mutation: drop `validateGlyphChartAxisTitleAt`, its rule/hint entry, or
  // the schema's per-axis `titleAt` enum -> Ajv/runtime parity goes red.
  // Each axis has its own vocabulary — "top" is valid for y.titleAt but not
  // x.titleAt, and vice versa for "start" — so a value from the OTHER
  // axis's vocabulary must still reject.
  { id: "bad-axis-title-at", spec: { marks: [glyphChartLine([1, 2])], axes: { x: { titleAt: "top" as never } } } },
  { id: "bad-axis-title-at", spec: { marks: [glyphChartLine([1, 2])], axes: { y: { titleAt: "start" as never } } } },
  { id: "bad-mark-color", spec: spec(glyphChartLine([1, 2], {}, { color: "blue" as never })) },
  { id: "bad-mark-color", spec: spec(glyphChartBar([1, 2], {}, { color: [] as never })) },
  // Mutation: drop the funnel schema `allOf` clause (the literal `number[]`
  // shorthand's own `minimum: 0`), the runtime negative-value check in
  // `resolveFunnelRows`, or the rule's table/hint entry -> Ajv/runtime
  // parity goes red. A negative value behind an ACCESSOR/field channel is
  // NOT independently Ajv-checkable (the same asymmetry `sankey-bad-value`
  // documents) — the shorthand array is the one shape schema CAN see.
  { id: "funnel-bad-value", spec: spec(glyphChartFunnel([-5, 10])) },
  // `funnel-missing-value`: record data with no `value` channel at all —
  // the state every mark-type switch or dataset Apply with no `value`
  // mapping lands in (fable review, batch 3, finding d). Mirrors
  // `arc-missing-value` exactly; the bare `number[]` shorthand needs no
  // channel and never trips this.
  { id: "funnel-missing-value", spec: spec(glyphChartFunnel([{ stage: "a" }, { stage: "b" }], { stage: "stage" })) },
  // `bad-options`: a transform on a flow mark, which has no x/y scale for
  // one to act on (P3-5) — structurally rejected by schema too (the
  // sankey/funnel `not: { required: ["transform"] }` clause).
  { id: "bad-options", spec: spec({ ...glyphChartSankey([{ from: "A", to: "B", amount: 1 }], { source: "from", target: "to", value: "amount" }), transform: { kind: "stack" } }) },
  // Mutation: drop the runtime strokeWidth check, its rule/hint entry, or
  // the schema's `strokeWidth` enum -> Ajv/runtime parity goes red.
  { id: "bad-stroke-width", spec: spec(glyphChartLine([1, 2], undefined, { strokeWidth: 4 as never })) },
  // Mutation: drop `resolveGlyphChartTickFormat`'s preset-name check, its
  // rule/hint entry, or the schema's `format` enum -> Ajv/runtime parity
  // goes red. An unknown preset name (`tickFormat.test.ts` covers the rest
  // — bad params, an unrecognised object shape).
  { id: "bad-tick-format", spec: { marks: [glyphChartLine([1, 2])], axes: { y: { format: "nonsense-preset" as never } } } },
];
