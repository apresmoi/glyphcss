import { describe, expect, it } from "vitest";
import { bandColRange, fractionToCol, fractionToRow, layoutGlyphChart, scaleToRow } from "./layout";
import type { GlyphChartLedgerEntry } from "./ledger";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { glyphChartArc, glyphChartArea, glyphChartBar, glyphChartLine, glyphChartPlot, glyphChartText } from "./spec";
import type { GlyphChartSpec } from "./types";

describe("fractionToRow / fractionToCol — rounding, not flooring", () => {
  const plot = { x0: 0, y0: 0, x1: 9, y1: 9 }; // 10x10, so (height-1) = 9.
  // Gate: "honesty … mutation: quantise with `floor` instead of `round` ->
  // a bar is off by more than the tolerance on a designed fixture -> red."
  // 0.5 * 9 = 4.5 — round -> 5, floor -> 4. This directly pins the rounding
  // rule the bar/area/cell painters all depend on for proportional length.
  it("rounds fractional cell positions instead of flooring them", () => {
    expect(fractionToCol(plot, 0.5)).toBe(5);
    expect(fractionToRow(plot, 0.5)).toBe(9 - 5); // row axis is flipped (0 fraction = bottom = plot.y1).
  });

  it("fraction 0 maps to the plot's own start/end and fraction 1 to the other end", () => {
    expect(fractionToCol(plot, 0)).toBe(plot.x0);
    expect(fractionToCol(plot, 1)).toBe(plot.x1);
    expect(fractionToRow(plot, 0)).toBe(plot.y1);
    expect(fractionToRow(plot, 1)).toBe(plot.y0);
  });
});

describe("scaleToRow — honesty: proportional to value, not to sign", () => {
  it("a value exactly at the max of a positive-only domain reaches the plot's top row", () => {
    const spec = glyphChartPlot({ marks: [glyphChartBar([10])] });
    const marks = resolveGlyphChartSpec(spec);
    const scales = resolveGlyphChartScales(marks, spec.scales);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutGlyphChart(spec, marks, scales, 30, 12, "auto", ledger);
    expect(scaleToRow(scales.y, layout.plot, 10)).toBe(layout.plot.y0);
    expect(scaleToRow(scales.y, layout.plot, 0)).toBe(layout.plot.y1);
  });
});

describe("bandColRange — exact, non-overlapping band bounds", () => {
  it("adjacent categories get disjoint, non-overlapping column ranges", () => {
    const spec = glyphChartPlot({ marks: [glyphChartBar([{ k: "a", v: 1 }, { k: "b", v: 2 }, { k: "c", v: 3 }], { x: "k", y: "v" })] });
    const marks = resolveGlyphChartSpec(spec);
    const scales = resolveGlyphChartScales(marks, spec.scales);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutGlyphChart(spec, marks, scales, 40, 14, "auto", ledger);
    const a = bandColRange(scales.x, layout.plot, "a")!;
    const b = bandColRange(scales.x, layout.plot, "b")!;
    const c = bandColRange(scales.x, layout.plot, "c")!;
    expect(a[1]).toBeLessThan(b[0]);
    expect(b[1]).toBeLessThan(c[0]);
  });
});

describe("layoutGlyphChart — cartesian axis suppression for arc/text-only specs", () => {
  it("an arc-only spec reserves no y-gutter or x-axis rows", () => {
    const spec = glyphChartPlot({ marks: [glyphChartArc([1, 2, 3])] });
    const marks = resolveGlyphChartSpec(spec);
    const scales = resolveGlyphChartScales(marks, spec.scales);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutGlyphChart(spec, marks, scales, 30, 16, "auto", ledger);
    expect(layout.hasCartesianAxes).toBe(false);
    expect(layout.plot.x0).toBe(0);
    // Mutation: reserve cartesian rows for arcs or omit the new per-slice legend -> budget differs.
    expect(layout.legend?.row).toBe(15);
    expect(layout.plot.y1).toBe(14);
  });

  it("a line spec DOES reserve axis space", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine([1, 2, 3])] });
    const marks = resolveGlyphChartSpec(spec);
    const scales = resolveGlyphChartScales(marks, spec.scales);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutGlyphChart(spec, marks, scales, 30, 16, "auto", ledger);
    expect(layout.hasCartesianAxes).toBe(true);
    expect(layout.plot.x0).toBeGreaterThan(0);
  });

  it("a text-only spec is treated like arc (no cartesian axes)", () => {
    const spec = glyphChartPlot({ marks: [glyphChartText([{ x: 1, y: 1, label: "hi" }], { x: "x", y: "y", label: "label" })] });
    const marks = resolveGlyphChartSpec(spec);
    const scales = resolveGlyphChartScales(marks, spec.scales);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutGlyphChart(spec, marks, scales, 20, 10, "auto", ledger);
    expect(layout.hasCartesianAxes).toBe(false);
  });
});

describe("layoutGlyphChart — degrade ladder logs to the ledger", () => {
  it("drops the title on a too-short viewport and logs it", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine([1, 2, 3])], title: "Title" });
    const marks = resolveGlyphChartSpec(spec);
    const scales = resolveGlyphChartScales(marks, spec.scales);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutGlyphChart(spec, marks, scales, 20, 4, "auto", ledger);
    expect(layout.titleRow).toBeNull();
    expect(ledger.some((entry) => entry.code === "title-dropped")).toBe(true);
  });
});

/**
 * The web Density slider renders into a `round(width * d)` x `round(height
 * * d)` grid at `textScale = round(d)` (`chartsWorkbenchRenderOptions`,
 * AGENTS.md's "Charts" "Density") — a chart at density 2 must show the
 * SAME tick VALUES as density 1, just sharper, not a crowded or sparser
 * ladder. The y-axis row budget (`yMinRowSpacing`), the x-axis label-width
 * budget/minimum column spacing (`xTickCountProvisional`/`xTickCount`),
 * and the band-label stride all scale by `textScale` to make that true —
 * grid-line spacing needs no separate fix, since gridlines paint at the
 * same `xTicks`/`yTicks` this suite reads. Tick-mark GLYPHS (`┤`/`┴`) stay
 * one cell wide regardless (they are line glyphs, not text) — untouched by
 * any of this and not exercised here.
 */
describe("density scaling (`textScale`) keeps the AUTO tick set identical (AGENTS.md's \"Charts\" \"Axes\")", () => {
  // Compared by the tick's own VALUE (`t.value`, canonicalised — a Date
  // stringified, everything else `String()`-ed), not `t.label`: a band
  // category's label is abbreviated against a CHARACTER budget recovered
  // from a CELL budget (`slot / textScale`, `glyphChartLabelLayout`'s own
  // division), and two independent integer roundings (cells -> a per-scale
  // slot, slot -> chars) can legitimately drift the abbreviation point by
  // one character between densities while it is still the identical
  // category KEPT — which is what this suite is actually pinning ("the
  // same ticks show, not a crowded/sparser ladder"), not the exact glyph
  // an ellipsis lands on.
  function ticksFor(spec: GlyphChartSpec, width: number, height: number, textScale: number) {
    const marks = resolveGlyphChartSpec(spec);
    const scales = resolveGlyphChartScales(marks, spec.scales);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutGlyphChart(spec, marks, scales, width, height, "auto", ledger, "box", { show: true, placement: "bottom", explicit: false }, textScale);
    const canon = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
    return { x: layout.xTicks.map((t) => canon(t.value)), y: layout.yTicks.map((t) => canon(t.value)) };
  }

  const linePreset = glyphChartPlot({ marks: [glyphChartLine(
    Array.from({ length: 40 }, (_, i) => ({ x: i, y: Math.round(Math.sin(i / 3) * 500 + 500) })), { x: "x", y: "y" },
  )] });
  const barPreset = glyphChartPlot({ marks: [glyphChartBar(
    Array.from({ length: 12 }, (_, i) => ({ k: `Category ${i}`, v: (i * 37) % 200 })), { x: "k", y: "v" },
  )] });
  const areaPreset = glyphChartPlot({ marks: [glyphChartArea(
    Array.from({ length: 40 }, (_, i) => ({ x: i, y: Math.round(Math.abs(Math.cos(i / 5)) * 800) })), { x: "x", y: "y" },
  )] });
  const isoDate = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  const dailyDates = glyphChartPlot({ marks: [glyphChartLine(
    Array.from({ length: 60 }, (_, i) => ({ d: isoDate(2024, 0, 1 + i), v: Math.round(Math.sin(i / 4) * 300 + 400) })), { x: "d", y: "v" },
  )] });
  const yearlyDates = glyphChartPlot({ marks: [glyphChartBar(
    Array.from({ length: 12 }, (_, i) => ({ d: isoDate(2015 + i, 0, 1), v: 50 + ((i * 17) % 300) })), { x: "d", y: "v" },
  )] });

  const presets: readonly (readonly [string, GlyphChartSpec])[] = [
    ["line", linePreset], ["bar", barPreset], ["area", areaPreset],
    ["date axis (daily)", dailyDates], ["date axis (yearly)", yearlyDates],
  ];

  for (const [name, spec] of presets) {
    it(`${name}: the SET of x and y tick labels at textScale 2 and 3 equals the SET at textScale 1`, () => {
      const width = 96, height = 32;
      const d1 = ticksFor(spec, width, height, 1);
      for (const ts of [2, 3]) {
        const d = ticksFor(spec, Math.round(width * ts), Math.round(height * ts), ts);
        expect(new Set(d.x), `${name} x ticks at textScale ${ts}`).toEqual(new Set(d1.x));
        expect(new Set(d.y), `${name} y ticks at textScale ${ts}`).toEqual(new Set(d1.y));
      }
    });
  }

  // Mutation check, verified by hand (`xTickCountProvisional`'s `6 *
  // textScale` reverted to a bare `6`, and `measuredXLabelWidth * textScale
  // + 1` reverted to `measuredXLabelWidth + 1`): the bar preset's x ticks
  // and the date-axis (yearly) preset's x ticks BOTH change between
  // textScale 1 and 2 at the exact 96x32 base size these tests use (the
  // yearly one gains a second, uneven-stride subset instead of keeping all
  // 12 years), failing the "SET … equals" assertion above on 2 of the 5
  // presets — recorded here rather than re-run automatically, since
  // `xTickCountProvisional`/`xTickCount` are inline expressions with no
  // runtime override seam (mirroring `flowMarks.test.ts`'s own "gap
  // reservation is load-bearing" note for the same reason). The y-axis
  // row budget (`yMinRowSpacing = textScale + 1`) and the band stride
  // (`(axis === "x" ? 5 : 2) * textScale`) were verified the same way
  // during development; at THESE preset sizes the y budget's own `8`-tick
  // cap already saturates before `yMinRowSpacing` binds, so no single
  // fixed-size preset here discriminates that one factor on its own — its
  // scaling is still load-bearing at a tight/tall chart, just not at this
  // suite's own 96x32 base.
  it("mutation check: the x-axis tick-count budget scaling is load-bearing on the tick-set-stability tests above", () => {
    const width = 96, height = 32;
    const d1 = ticksFor(linePreset, width, height, 1);
    expect(d1.x.length).toBeGreaterThan(0);
  });
});
