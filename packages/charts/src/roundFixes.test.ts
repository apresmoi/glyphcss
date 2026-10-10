/**
 * Dedicated gates for the CHARTS-RESEARCH `DIAGNOSIS-charts-rendering.md`
 * fix round — one `describe` per numbered diagnosis finding, each pinning
 * the exact evidence the diagnosis measured so a regression on that
 * specific finding reddens here rather than only showing up as an
 * incidental assertion elsewhere. See `review.test.ts`/`axes.test.ts`/
 * `paint.subcell.test.ts` for the pre-existing tests updated in the same
 * round (their own comments name the mutation each one now catches).
 */
import { createGlyphCanvas } from "glyphcss";
import { describe, expect, it } from "vitest";
import { bandColRange, layoutGlyphChart } from "./layout";
import { paintGlyphChart } from "./paint";
import { renderGlyphChart } from "./render";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { glyphChartArc, glyphChartArea, glyphChartBar, glyphChartCell, glyphChartDot, glyphChartLine, glyphChartPlot, glyphChartRule, normalizeGlyphChartInput } from "./spec";
import type { GlyphChartCharset, GlyphChartInput, GlyphChartLedgerEntry } from "./types";

function picture(input: GlyphChartInput, width: number, height: number, colorEnabled = false, charset: GlyphChartCharset = "box") {
  const spec = normalizeGlyphChartInput(input);
  const marks = resolveGlyphChartSpec(spec);
  const scales = resolveGlyphChartScales(marks, spec.scales);
  const ledger: GlyphChartLedgerEntry[] = [];
  const layout = layoutGlyphChart(spec, marks, scales, width, height, "auto", ledger, charset);
  const canvas = createGlyphCanvas({ cols: width, rows: height, tier: charset });
  paintGlyphChart(canvas, spec, marks, scales, layout, { colorEnabled }, ledger);
  const at = (col: number, row: number) => canvas.grid.char[row * width + col];
  return { canvas, layout, scales, ledger, at };
}

const SAMPLE = [3, 5, 2, 8, 6, 9, 4];
const MONTHS = ["Jan", "Feb", "Mar", "Apr"];
const BARS = MONTHS.map((month, i) => ({ month, value: SAMPLE[i] }));
const STACKED = MONTHS.flatMap((month, i) => [
  { month, value: SAMPLE[i], region: "North" },
  { month, value: SAMPLE[i + 2], region: "South" },
]);
const page = (marks: ReturnType<typeof glyphChartBar>[]) =>
  glyphChartPlot({ marks, axes: { x: { tickMarks: true, grid: false }, y: { tickMarks: true, grid: false } } });

describe("item 2 (B1) — bars touch the axis, proportional from the axis line", () => {
  it("3:5:2:8 at 40x14 paints rows in exact proportion from the axis line, every bar touching it", () => {
    // Mutation: reintroduce the reserved axis-line row below the plot
    // (`layout.ts`'s old `xAxisLineRow = bottom; bottom -= 1`) -> every
    // bar's bottom row stops one row short of the drawn "└" rule again,
    // and the counts below (11/7/5/3, not the pre-fix 9/6/4/3 read from the
    // axis) go red.
    const p = picture(page([glyphChartBar(BARS, { x: "month", y: "value" }, { name: "Sales" })]), 40, 14);
    // A bar's top cell may be a lower eighth block; it still occupies that row.
    const FILL_GLYPHS = "█▓▒░▁▂▃▄▅▆▇";
    // Rows strictly ABOVE `xAxisLineRow` — the plot's own bottom row can
    // now legitimately BE the axis line row (B1's fix), so a naive
    // `plot.y0..plot.y1` scan would count the axis's own tick/rule glyphs
    // as "bar fill" and overstate every height by one.
    const countFilled = (month: string) => {
      const [x0, x1] = bandColRange(p.scales.x, p.layout.plot, month)!;
      let max = 0;
      for (let x = x0; x <= x1; x++) {
        let n = 0;
        for (let y = p.layout.plot.y0; y < p.layout.xAxisLineRow; y++) if (FILL_GLYPHS.includes(p.at(x, y) ?? " ")) n++;
        max = Math.max(max, n);
      }
      return max;
    };
    const heights = MONTHS.map(countFilled);
    // Exact counts at 40x14 (measured against the fixed code): value 8 (the
    // domain max) fills the WHOLE plot height; 5, 3, 2 scale from it. Rows
    // occupied, partial top included: 3/8, 5/8, 2/8 and 8/8 of 11 rows are
    // 4 1/8, 6 7/8, 2 6/8 and 11 rows.
    expect(heights).toEqual([5, 7, 3, 11]);
    const topGlyph = (month: string) => {
      const [x0] = bandColRange(p.scales.x, p.layout.plot, month)!;
      return p.at(x0, p.layout.xAxisLineRow - heights[MONTHS.indexOf(month)]!);
    };
    expect(MONTHS.map(topGlyph)).toEqual(["▁", "▇", "▆", "█"]);
    // Every bar's own bottom-most FILL row is immediately above the axis
    // line, with no blank row between them (the diagnosis's own "the
    // columns grow not proportionally" / a floating blank `0` row).
    for (const month of MONTHS) {
      const [x0] = bandColRange(p.scales.x, p.layout.plot, month)!;
      expect(FILL_GLYPHS.includes(p.at(x0, p.layout.xAxisLineRow - 1) ?? " ")).toBe(true);
    }
  });

  it("stacked segments and dodged groups touch the axis exactly like a single-series bar", () => {
    const FILL_GLYPHS = "█▓▒░";
    const stacked = picture({ ...glyphChartBar(STACKED, { x: "month", y: "value", fill: "region" }), transform: { kind: "stack" as const } }, 40, 14);
    const dodged = picture(glyphChartBar(STACKED, { x: "month", y: "value", fill: "region" }), 40, 14);
    for (const p of [stacked, dodged]) {
      for (const month of MONTHS) {
        const [x0, x1] = bandColRange(p.scales.x, p.layout.plot, month)!;
        // At least one column of the band has FILL ink on the row directly
        // above the axis line — the bottom-most stacked segment (or the
        // dodged North sub-band) sits flush against it.
        let touches = false;
        for (let x = x0; x <= x1; x++) if (FILL_GLYPHS.includes(p.at(x, p.layout.xAxisLineRow - 1) ?? " ")) touches = true;
        expect(touches).toBe(true);
      }
    }
  });

  it("when 0 is not in the domain, the axis line row is the y-min row (a line touches it exactly)", () => {
    // Mutation: keep the axis line pinned to the plot's structural bottom
    // regardless of the scale -> a domain like [2,9] (no bar/area forcing
    // zero) leaves a blank row between the lowest data point and the axis.
    const r = renderGlyphChart({ marks: [{ type: "line", data: [3, 5, 2, 8, 6, 9, 4, 7, 3, 5], channels: {} }] }, { target: "chat", charset: "box", width: 44, height: 12 });
    const rows = r.text.split("\n");
    const axisRow = rows.findIndex((row) => row.includes("└"));
    expect(axisRow).toBeGreaterThan(0);
    // The row directly above the axis line has ink somewhere (the line's
    // own minimum reaches all the way down) rather than a uniformly blank
    // "floating" row.
    expect(rows[axisRow - 1]).toMatch(/[^\s0-9]/);
  });
});

describe("item 3 (B2/B6d) — region-mark series are distinguishable in monochrome", () => {
  it("stacked 3-series bars: 3 distinct non-space glyphs in the bars, legend swatches match exactly", () => {
    // Mutation: revert `paintBar`/`paintRect`/`paintArea` to `fill: "solid"`
    // (drop the `seriesShade(tier, styleIndex)` glyph) -> every series
    // paints "█", collapsing to ONE distinct glyph -> red.
    const data = ["Jan", "Feb"].flatMap((month) => [
      { month, value: 3, region: "North" },
      { month, value: 5, region: "Central" },
      { month, value: 2, region: "South" },
    ]);
    const spec = { ...glyphChartBar(data, { x: "month", y: "value", fill: "region" }), transform: { kind: "stack" as const } };
    const p = picture(spec, 40, 16);
    const glyphsInPlot = new Set<string>();
    for (let y = p.layout.plot.y0; y <= p.layout.plot.y1; y++) {
      for (let x = p.layout.plot.x0; x <= p.layout.plot.x1; x++) {
        const c = p.at(x, y)!;
        if (c !== " ") glyphsInPlot.add(c);
      }
    }
    const barGlyphs = [...glyphsInPlot].filter((c) => "█░▚╱▌═▓▒".includes(c));
    expect(barGlyphs.length).toBe(3);
    // The legend swatch for each series is exactly one of those glyphs —
    // never a line style (`─`/`╌`/`═`/`·`), which is what a bar chart's
    // legend used to show (diagnosis B2: "───North" under a "█" bar).
    expect(p.layout.legend).not.toBeNull();
    const legendRow = p.layout.legend!.row!;
    const legendGlyphs = new Set<string>();
    for (let x = 0; x < 40; x++) {
      const c = p.at(x, legendRow)!;
      if ("█░▚╱▌═▓▒".includes(c)) legendGlyphs.add(c);
    }
    expect(legendGlyphs.size).toBe(3);
    for (const g of legendGlyphs) expect(barGlyphs).toContain(g);
    // No line-style swatch glyph anywhere on the legend row.
    for (const glyph of ["─", "╌", "═", "·"]) {
      const row = Array.from({ length: 40 }, (_, x) => p.at(x, legendRow)).join("");
      expect(row).not.toContain(glyph);
    }
  });

  it("braille heatmap cells use monotone block shades, never quadrant shapes, and the legend matches", () => {
    // Mutation: let `paintCell` fall through to `fillRect`'s own sub-cell
    // path on `blocks`/`braille` -> a partial-coverage cell picks a
    // quadrant glyph (▘ ▀ ▛) instead of box's own monotone "░▒▓█" ramp.
    const data = [1, 2, 3, 4].map((v, i) => ({ x: String(i), y: "row", v }));
    const p = picture(glyphChartCell(data, { x: "x", y: "y", fill: "v" }, { name: "Activity" }), 30, 8, false, "braille");
    const glyphsInPlot = new Set<string>();
    // Strictly ABOVE the axis line row: a single-band y scale puts
    // `xAxisLineRow` at the plot's own bottom row, which carries the
    // axis's own box-drawing glyphs, not cell fill.
    for (let y = p.layout.plot.y0; y < p.layout.xAxisLineRow; y++) {
      for (let x = p.layout.plot.x0; x <= p.layout.plot.x1; x++) {
        const c = p.at(x, y)!;
        if (c !== " ") glyphsInPlot.add(c);
      }
    }
    expect(glyphsInPlot.size).toBeGreaterThan(0);
    for (const c of glyphsInPlot) expect(" ░▒▓█".includes(c)).toBe(true);
    expect(p.layout.legend).not.toBeNull();
    const legendRow = p.layout.legend!.row!;
    let sawShade = false;
    for (let x = 0; x < 30; x++) { if (p.at(x, legendRow) === "█") sawShade = true; }
    expect(sawShade).toBe(true);
  });
});

describe("item 4 (B3) — tick ladders are always evenly spaced, never a collision-thinned hole", () => {
  function isArithmetic(values: readonly number[]): boolean {
    if (values.length <= 2) return true;
    const step = values[1]! - values[0]!;
    for (let i = 2; i < values.length; i++) if (Math.abs(values[i]! - values[i - 1]! - step) > 1e-9) return false;
    return true;
  }

  it.each(Array.from({ length: 17 }, (_, i) => i + 8))("height %i: the 3:5:2:8 bar preset's kept y ticks form an arithmetic sequence", (height) => {
    // This single-series preset's own ladder turns out robust to both
    // mutations below at every height 8..24 — its coverage is the
    // stacked-bar sweep just below (which DOES redden removing
    // `fitTicksToRowSpacing`'s shrink loop, at height 9) and the
    // final-gate-2 tray-preset sweep further down (19 reddened cases
    // across line/multi-line/dot/area/stacked-bar/line-rule). Restoring
    // the OLD `yRowBudget` interval/row-count off-by-one this describe
    // block's name once cited does NOT redden any test here — final-gate-2
    // review (Opus finding 9) measured it byte-identical, because
    // `fitTicksToRowSpacing` converges to the same final count however
    // it's seeded; `layout.ts`'s own comment on `yRowBudget` records this.
    // Kept as a plain regression pin for this preset's shape.
    const spec = page([glyphChartBar(BARS, { x: "month", y: "value" }, { name: "Sales" })]);
    const marks = resolveGlyphChartSpec(spec);
    const scales = resolveGlyphChartScales(marks, spec.scales);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutGlyphChart(spec, marks, scales, 40, height, "auto", ledger, "box");
    const numericTicks = layout.yTicks.map((t) => t.value).filter((v): v is number => typeof v === "number");
    expect(isArithmetic(numericTicks)).toBe(true);
  });

  it.each(Array.from({ length: 17 }, (_, i) => i + 8))("height %i: the stacked-bar preset's kept y ticks form an arithmetic sequence", (height) => {
    // Mutation: remove `fitTicksToRowSpacing`'s shrink-until-it-fits loop
    // (return `ticksFor(initialCount)` unconditionally) -> height 9's
    // ladder is no longer evenly spaced -> red.
    const spec = page([{ ...glyphChartBar(STACKED, { x: "month", y: "value", fill: "region" }), transform: { kind: "stack" as const } }]);
    const marks = resolveGlyphChartSpec(spec);
    const scales = resolveGlyphChartScales(marks, spec.scales);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutGlyphChart(spec, marks, scales, 40, height, "auto", ledger, "box");
    const numericTicks = layout.yTicks.map((t) => t.value).filter((v): v is number => typeof v === "number");
    expect(isArithmetic(numericTicks)).toBe(true);
  });

  // Final-gate-2 review (Opus finding 6 / codex #9): the bar/stacked-bar
  // sweeps above already caught the y-row-budget off-by-one, but missed the
  // SEPARATE max-anchored-stride defect the Area preset exposed at heights
  // 22-24 (a line/area/dot mark's y-ticks go through the exact same
  // `axisTicks` stride path bar/rect do). Extended here to every shipped
  // tray-preset MARK TYPE (`website/src/components/ChartsWorkbench/
  // chartsWorkbenchState.ts`'s `CHART_PRESETS`, reproduced locally — this
  // package can't import from `website/`) across every width the review
  // swept (20/40/80) and every height 8..24. `pie`/`donut` (arc-only, no
  // cartesian y-axis) and `heatmap` (band y-scale, no numeric ticks) are
  // included for completeness and pass vacuously (`isArithmetic` on an
  // empty/short list is trivially true) — the meaningful coverage is
  // line/multi-line/bar/stacked-bar/dot/area/line-rule.
  const SHARES = [{ browser: "Chrome", share: 65 }, { browser: "Safari", share: 20 }, { browser: "Firefox", share: 15 }];
  const SERIES = ["North", "South"].flatMap((region, i) => SAMPLE.map((value, month) => ({ month, value: value + i * 2, region })));
  const HEATMAP = ["Mon", "Tue", "Wed", "Thu"].flatMap((day, x) => ["AM", "Noon", "PM"].map((hour, y) => ({ day, hour, value: (x + 1) * (y + 1) })));
  const TRAY_PRESET_SPECS: Readonly<Record<string, ReturnType<typeof glyphChartPlot>>> = {
    line: page([glyphChartLine(SAMPLE, undefined, { name: "Revenue" })]),
    "multi-line": page([glyphChartLine(SERIES, { x: "month", y: "value", fill: "region" })]),
    bar: page([glyphChartBar(BARS, { x: "month", y: "value" }, { name: "Sales" })]),
    "stacked-bar": page([{ ...glyphChartBar(STACKED, { x: "month", y: "value", fill: "region" }), transform: { kind: "stack" as const } }]),
    dot: page([glyphChartDot(SAMPLE, undefined, { name: "Visits" })]),
    area: page([glyphChartArea(SAMPLE, undefined, { name: "Traffic" })]),
    pie: page([glyphChartArc(SHARES, { y: "share", fill: "browser" })]),
    donut: page([glyphChartArc(SHARES, { y: "share", fill: "browser" }, { innerRadius: 0.5 })]),
    heatmap: page([glyphChartCell(HEATMAP, { x: "day", y: "hour", fill: "value" }, { name: "Activity" })]),
    "line-rule": page([glyphChartLine(SAMPLE, undefined, { name: "Revenue" }), glyphChartRule([5])]),
  };
  for (const [id, spec] of Object.entries(TRAY_PRESET_SPECS)) {
    for (const width of [20, 40, 80]) {
      it.each(Array.from({ length: 17 }, (_, i) => i + 8))(`final-gate-2: tray preset "${id}" at ${width}x%i keeps an arithmetic y ladder`, (height) => {
        const marks = resolveGlyphChartSpec(spec);
        const scales = resolveGlyphChartScales(marks, spec.scales);
        const ledger: GlyphChartLedgerEntry[] = [];
        const layout = layoutGlyphChart(spec, marks, scales, width, height, "auto", ledger, "box");
        const numericTicks = layout.yTicks.map((t) => t.value).filter((v): v is number => typeof v === "number");
        expect(isArithmetic(numericTicks)).toBe(true);
      });
    }
  }
});

describe("item 6 — mixed-sign zero row, and band ticks centred on their band", () => {
  it("B6a: a mixed-sign bar's zero row is the axis line itself, never a blank row", () => {
    const p = picture(glyphChartBar([{ m: "a", v: -3 }, { m: "b", v: 4 }, { m: "c", v: 1 }], { x: "m", y: "v" }), 30, 12);
    // The row the axis line is drawn on is interior to the plot (mixed
    // sign), and every column of it carries the axis's own glyph — never a
    // blank cell (diagnosis B6a: "the zero baseline row is blank").
    let sawBlank = false;
    for (let x = p.layout.plot.x0; x <= p.layout.plot.x1; x++) if (p.at(x, p.layout.xAxisLineRow) === " ") sawBlank = true;
    expect(sawBlank).toBe(false);
    expect(p.layout.xAxisLineRow).toBeGreaterThan(p.layout.plot.y0);
    expect(p.layout.xAxisLineRow).toBeLessThan(p.layout.plot.y1);
  });

  it("B6c: a band tick and label centre on the exact columns bandColRange paints, not one column off", () => {
    // Mutation: derive the x-band tick fraction independently (the scale's
    // own continuous `start + bandwidth/2`, pre-fix) instead of from
    // `bandColRange`'s own painted `[lo, hi]` -> the tick lands one column
    // right of centre at most widths (diagnosis B6c).
    for (const width of [40, 72, 96]) {
      const p = picture(page([glyphChartBar(BARS, { x: "month", y: "value" }, { name: "Sales" })]), width, 14);
      for (const t of p.layout.xTicks) {
        const range = bandColRange(p.scales.x, p.layout.plot, t.value);
        if (!range) continue;
        const [lo, hi] = range;
        const center = Math.round((lo + hi) / 2);
        expect(Math.abs(t.cell - center)).toBeLessThanOrEqual(0);
      }
    }
  });
});
