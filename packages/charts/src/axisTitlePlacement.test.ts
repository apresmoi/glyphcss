import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGlyphCanvas } from "glyphcss";
import { renderGlyphChart } from "./render";
import { glyphChartLine, glyphChartPlot, normalizeGlyphChartInput } from "./spec";
import { layoutGlyphChart } from "./layout";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { paintGlyphChart } from "./paint";
import { goodSpecs } from "./reviewFixtures";
import type { GlyphChartInput, GlyphChartLedgerEntry } from "./types";

/**
 * `axes.x.titleAt: "start" | "center" | "end"` / `axes.y.titleAt: "top" |
 * "bottom"` (AGENTS.md's "Charts" "Axes"). `center`/`top` are the resolved
 * defaults — byte-identical to every chart rendered before this option
 * existed, which the fixture below proves against a real pre-`titleAt`
 * build rather than by re-deriving the same defaults this file's own code
 * would produce.
 */

// `__filename`/`__dirname` don't exist in this ESM-transformed test module,
// and vitest's own transform can hand `import.meta.url` a non-`file:` scheme
// — resolved from `expect.getState().testPath` instead, which vitest always
// reports as a real filesystem path for the currently running test file.
function fixturePath(relative: string): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("no test path available to resolve fixture from");
  return join(dirname(testPath), relative);
}
// Every `arc`-mark entry's own `text` (goodSpecs indices 6, 11, 20, 21, 22)
// was regenerated after the P1-1 fix (`GLYPH_CHART_TARGET_DEFAULTS.web.
// cellAspect`, AGENTS.md's "Arc shape and callouts") — that fix changes the
// web target's disc shape independently of `titleAt`, so the literal
// pre-titleAt build's bytes for an arc chart are no longer what this build
// produces even with `titleAt` absent. Every other (non-arc) entry is
// untouched.
//
// Multi-series entries (indices 17-22: `sankeySample`, `funnelSample`, the
// bare `[1000,500,100]` funnel, and the three `browserShares` arc specs)
// were regenerated AGAIN for `series.ts`'s shade-ramp fix
// (CHARTS-RESEARCH `DIAGNOSIS-pie-contrast.md`): the old `█ ▓ ▒ ░`/`# % + .`
// density-only cycle failed a 0.15 ink-coverage adjacency gap in every
// measured monospace font, replaced by a shape-family ramp — this changes
// every region/arc mark with 2+ series, byte for byte, everywhere. A
// single-series entry's own `█`/`#` fill glyph is unaffected (index 0-16,
// 23-33 stayed byte-identical).
const parentGoodSpecs: { i: number; text: string }[] = JSON.parse(readFileSync(fixturePath("fixtures/axisTitleParentGoodSpecs.json"), "utf8"));

/**
 * Mirrors `review.test.ts`'s own `picture()` helper — the internal
 * layout/paint pipeline directly, so a test can read `layout.plot`,
 * `layout.xAxisTitleRow`/`yAxisTitleRow`, and `report.ledger` without
 * re-deriving them from the painted grid alone.
 */
function picture(input: GlyphChartInput, width: number, height: number) {
  const spec = normalizeGlyphChartInput(input);
  const marks = resolveGlyphChartSpec(spec);
  const scales = resolveGlyphChartScales(marks, spec.scales);
  const ledger: GlyphChartLedgerEntry[] = [];
  const layout = layoutGlyphChart(spec, marks, scales, width, height, "auto", ledger, "box");
  const canvas = createGlyphCanvas({ cols: width, rows: height, tier: "box" });
  paintGlyphChart(canvas, spec, marks, scales, layout, { colorEnabled: false }, ledger);
  const rowText = (y: number): string => {
    let s = "";
    for (let x = 0; x < width; x++) s += canvas.grid.char[y * width + x];
    return s;
  };
  return { layout, ledger, rowText };
}

const data = [{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 2 }, { x: 3, y: 4 }];

describe("byte-identity: titleAt absent renders exactly like the parent build (f66ca73e, before titleAt existed)", () => {
  it("every reviewFixtures goodSpecs entry with titleAt absent matches the pre-titleAt build byte for byte", () => {
    // Mutation: change either default ("center"/"top") to anything else, or
    // paint even ONE cell differently on the titleAt-absent path (e.g. run
    // the "bottom" y-title reservation unconditionally instead of gating it
    // on `yTitleAt === "bottom"`) -> at least one of these 33 pre-existing
    // fixtures, rendered at this package's own default web/braille target,
    // stops matching the real dist built from the commit before this
    // feature existed.
    expect(parentGoodSpecs.length).toBeGreaterThan(0);
    expect(parentGoodSpecs.length).toBeLessThan(goodSpecs.length);
    for (const { i, text } of parentGoodSpecs) {
      const spec = goodSpecs[i]!;
      expect(spec.axes?.x?.titleAt, `goodSpecs[${i}] must have no x.titleAt for this comparison to mean anything`).toBeUndefined();
      expect(spec.axes?.y?.titleAt, `goodSpecs[${i}] must have no y.titleAt for this comparison to mean anything`).toBeUndefined();
      const r = renderGlyphChart(spec);
      expect(r.text, `goodSpecs[${i}]`).toBe(text);
    }
  });

  it("the appended titleAt-bearing fixture is excluded from the byte-identity set (it must differ from a pre-titleAt build)", () => {
    const last = goodSpecs.at(-1)!;
    expect(last.axes?.x?.titleAt ?? last.axes?.y?.titleAt).toBeDefined();
    expect(goodSpecs.length).toBe(parentGoodSpecs.length + 1);
  });
});

describe.each([40, 72, 96])("x-axis titleAt at %i cols", (cols) => {
  const title = "Population";

  it("'start' lands the title's first glyph at the plot's own left edge", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine(data, { x: "x", y: "y" })], axes: { x: { title, titleAt: "start" } } });
    const p = picture(spec, cols, 20);
    expect(p.layout.xAxisTitle).toBe(title);
    const row = p.rowText(p.layout.xAxisTitleRow);
    // Mutation: fall through to the "center"/"end" branch for "start" ->
    // the title lands mid-row or flush right instead of at `plot.x0`.
    expect(row.indexOf(title)).toBe(p.layout.plot.x0);
  });

  it("'end' lands the title's last glyph at the plot's own right edge", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine(data, { x: "x", y: "y" })], axes: { x: { title, titleAt: "end" } } });
    const p = picture(spec, cols, 20);
    const row = p.rowText(p.layout.xAxisTitleRow);
    const start = row.indexOf(title);
    expect(start).toBeGreaterThanOrEqual(0);
    // Mutation: drop the "end" branch (fall through to "center") -> the
    // title's last glyph lands short of `plot.x1` by roughly a quarter of
    // the plot width instead of exactly at it.
    expect(start + title.length - 1).toBe(p.layout.plot.x1);
  });

  it("'center' (explicit) is byte-identical to titleAt absent — the pre-existing centred default", () => {
    const withDefault = glyphChartPlot({ marks: [glyphChartLine(data, { x: "x", y: "y" })], axes: { x: { title } } });
    const withExplicit = glyphChartPlot({ marks: [glyphChartLine(data, { x: "x", y: "y" })], axes: { x: { title, titleAt: "center" } } });
    const a = renderGlyphChart(withDefault, { width: cols, height: 20 });
    const b = renderGlyphChart(withExplicit, { width: cols, height: 20 });
    expect(b.text).toBe(a.text);
  });

  it("(default, F3) the centred start column matches an independently re-derived formula, not merely a second call into the same code", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine(data, { x: "x", y: "y" })], axes: { x: { title } } });
    const p = picture(spec, cols, 20);
    const plotWidth = p.layout.plot.x1 - p.layout.plot.x0 + 1;
    const expectedStart = Math.max(p.layout.plot.x0, p.layout.plot.x0 + Math.floor((plotWidth - title.length) / 2));
    const row = p.rowText(p.layout.xAxisTitleRow);
    // Mutation: `paint.ts`'s centred start-column `Math.floor` -> `Math.ceil`
    // shifts every default-centred x title by one column whenever
    // `plotWidth - title.length` is odd — F3's own review finding measured
    // this mutation leaving the ENTIRE pre-fix charts suite green (1,034/
    // 1,034), because every other guard either painted no title at all or
    // compared two calls into the same (possibly mutated) formula.
    expect(row.indexOf(title)).toBe(expectedStart);
  });
});

describe.each([40, 72, 96])("y-axis titleAt at %i cols", (cols) => {
  const title = "Income";

  it("'top' (explicit) is byte-identical to titleAt absent — the pre-existing top-left default", () => {
    const withDefault = glyphChartPlot({ marks: [glyphChartLine(data, { x: "x", y: "y" })], axes: { y: { title } } });
    const withExplicit = glyphChartPlot({ marks: [glyphChartLine(data, { x: "x", y: "y" })], axes: { y: { title, titleAt: "top" } } });
    const a = renderGlyphChart(withDefault, { width: cols, height: 20 });
    const b = renderGlyphChart(withExplicit, { width: cols, height: 20 });
    expect(b.text).toBe(a.text);
  });

  it("'bottom' with no x-axis title claims its own row below the plot, at column 0, with no stacking ledger entry", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine(data, { x: "x", y: "y" })], axes: { y: { title, titleAt: "bottom" } } });
    const p = picture(spec, cols, 20);
    expect(p.layout.yAxisTitle).toBe(title);
    expect(p.layout.yAxisTitleRow).toBeGreaterThan(p.layout.plot.y1);
    // F1: the y title's row must sit BELOW the x tick-label row — never
    // between the axis line and the labels it names. Mutation: reserve the
    // y-title-bottom row from `bottom` AFTER the x-label row already
    // claimed it (the pre-fix order) -> this goes red (the title lands one
    // row ABOVE the labels instead of below them).
    expect(p.layout.yAxisTitleRow).toBeGreaterThan(p.layout.xAxisLabelRow);
    expect(p.rowText(p.layout.yAxisTitleRow).indexOf(title)).toBe(0);
    expect(p.ledger.some((e) => e.code === "axis-title-stacked")).toBe(false);
  });
});

describe("y-axis titleAt: 'bottom' does not perturb the y tick ladder (F2)", () => {
  // A wide y-domain (mirroring the review's own `max=4`/`max=23` repros) —
  // the reported divergence is a difference in TICK COUNT/spacing, which a
  // narrow domain (few candidate "nice" ticks at any budget) can't expose.
  const wideData = [{ x: 0, y: 0 }, { x: 1, y: 23 }, { x: 2, y: 4 }, { x: 3, y: 17 }];

  it("the fitted y ticks equal the same spec's ticks rendered at the plot height the option leaves, across a height sweep", () => {
    let compared = 0;
    for (const cols of [40, 60, 96]) {
      for (let h = 8; h <= 30; h++) {
        const baseline = glyphChartPlot({ marks: [glyphChartLine(wideData, { x: "x", y: "y" })] });
        const titled = glyphChartPlot({ marks: [glyphChartLine(wideData, { x: "x", y: "y" })], axes: { y: { title: "Income", titleAt: "bottom" } } });
        const pb = picture(baseline, cols, h - 1);
        const pt = picture(titled, cols, h);
        // Title dropped for lack of room at this height — nothing to compare
        // (mirrors the pre-existing "top" path's own small-chart degradation).
        if (pt.layout.yAxisTitleRow < 0) continue;
        compared += 1;
        // `titleAt: "bottom"` at height `h` spends exactly the one extra row
        // the baseline never does, so the two plot heights coincide here by
        // construction — the review's own "equal plot height" comparison.
        expect(pt.layout.plot.y1 - pt.layout.plot.y0).toBe(pb.layout.plot.y1 - pb.layout.plot.y0);
        // Mutation: reserve the `titleAt: "bottom"` row AFTER
        // `fitTicksToRowSpacing` already ran (the pre-fix order) -> the
        // titled ladder is fitted against a `bottom` one row taller than the
        // plot it actually lands in, producing a denser, non-arithmetic
        // ladder (review's own `[2,2,2,3,2,2]` vs `[4,3,4]` example) that
        // diverges from the baseline at the same plot height.
        expect(pt.layout.yTicks.map((t) => t.label)).toEqual(pb.layout.yTicks.map((t) => t.label));
      }
    }
    expect(compared).toBeGreaterThan(30);
  });
});

describe("y-axis titleAt: 'bottom' sharing/stacking with the x-axis title", () => {
  it("shares the x-axis title's row when the y title fits to its left", () => {
    const spec = glyphChartPlot({
      marks: [glyphChartLine(data, { x: "x", y: "y" })],
      axes: { x: { title: "X", titleAt: "end" }, y: { title: "Y", titleAt: "bottom" } },
    });
    const p = picture(spec, 60, 20);
    expect(p.layout.xAxisTitleRow).toBeGreaterThanOrEqual(0);
    // Mutation: never share (always reserve a second row) -> these two rows
    // would differ even though "Y" trivially fits before "X"'s end-aligned
    // start column.
    expect(p.layout.yAxisTitleRow).toBe(p.layout.xAxisTitleRow);
    const row = p.rowText(p.layout.xAxisTitleRow);
    expect(row.indexOf("Y")).toBe(0);
    expect(row.indexOf("X")).toBeGreaterThan(0);
    expect(p.ledger.some((e) => e.code === "axis-title-stacked")).toBe(false);
  });

  it("claims its own row and logs axis-title-stacked when it doesn't fit beside the x-axis title", () => {
    const spec = glyphChartPlot({
      marks: [glyphChartLine(data, { x: "x", y: "y" })],
      axes: {
        x: { title: "A very long x-axis title that fills most of the row", titleAt: "start" },
        y: { title: "A very long y-axis title", titleAt: "bottom" },
      },
    });
    const p = picture(spec, 60, 20);
    expect(p.layout.xAxisTitleRow).toBeGreaterThanOrEqual(0);
    // Mutation: always share regardless of fit -> the y title would overlap
    // (or eat into) the x title's own text on the same row.
    expect(p.layout.yAxisTitleRow).not.toBe(p.layout.xAxisTitleRow);
    expect(p.ledger.some((e) => e.code === "axis-title-stacked")).toBe(true);
    // The stacked row is still below the plot and still column 0, and the
    // x title's own row keeps its text intact (no collision damage).
    expect(p.layout.yAxisTitleRow).toBeGreaterThan(p.layout.plot.y1);
    // F1 (stacked case): the y title's own row must be the LAST row of the
    // whole bottom stack — below both the x title's row and the x
    // tick-label row — matching `ledger.ts`'s own "gave the y-axis title
    // its own row below the x-axis title" wording. Mutation: reserve this
    // row where the pre-fix code did (after `xAxisTitleRow`/
    // `xAxisLabelRow` already claimed the true bottom rows) -> this goes
    // red (the y title lands ABOVE the x title instead of below it).
    expect(p.layout.yAxisTitleRow).toBeGreaterThan(p.layout.xAxisTitleRow);
    expect(p.layout.yAxisTitleRow).toBeGreaterThan(p.layout.xAxisLabelRow);
    expect(p.rowText(p.layout.yAxisTitleRow).indexOf("A very long y-axis title")).toBe(0);
  });

  it("titles never overwrite tick labels or the axis line", () => {
    const spec = glyphChartPlot({
      marks: [glyphChartLine(data, { x: "x", y: "y" })],
      axes: {
        x: { title: "A very long x-axis title that fills most of the row", titleAt: "end" },
        y: { title: "A very long y-axis title", titleAt: "bottom" },
      },
    });
    const p = picture(spec, 60, 20);
    // The axis line row and every tick-label row sit strictly inside the
    // plot's own row range or at its own reserved label row — never at a
    // row a title claimed.
    const titleRows = new Set([p.layout.xAxisTitleRow, p.layout.yAxisTitleRow].filter((r) => r >= 0));
    expect(titleRows.has(p.layout.xAxisLineRow)).toBe(false);
    expect(titleRows.has(p.layout.xAxisLabelRow)).toBe(false);
    for (const t of p.layout.yTicks) expect(titleRows.has(t.cell)).toBe(false);
  });

  // F10: `fitsSharing` must measure the y title's PAINTED CELL width (what
  // `canvas.text` folds it to), not its raw UTF-16 `.length` — a combining
  // mark adds a code unit with no extra cell. `AVeryTallY` is a plain
  // 10-cell word; appending U+0301 (combining acute) to its last letter
  // makes the grapheme cluster "Ý" fold to ONE cell (box/ASCII has no
  // such precomposed glyph), so the folded width stays 10 while the raw JS
  // length is 11. `cols: 13` is chosen so the threshold falls exactly
  // between the two: `xTitleStartCol` (x title "X", `titleAt: "end"`) is
  // `cols - 1 = 12`, and sharing needs `yLen + 1 < 12` — true at the real
  // folded width (11 < 12) and false at the raw one (12 < 12 is not).
  it("measures the y title's folded cell width, not its raw string length, when deciding whether it shares the x title's row", () => {
    const yTitle = "AVeryTallÝ";
    const spec = glyphChartPlot({
      marks: [glyphChartLine(data, { x: "x", y: "y" })],
      axes: { x: { title: "X", titleAt: "end" }, y: { title: yTitle, titleAt: "bottom" } },
    });
    const p = picture(spec, 13, 20);
    expect(p.layout.xAxisTitleRow).toBeGreaterThanOrEqual(0);
    // Mutation: measure `yAxisTitleText.length` (raw UTF-16 units, the
    // pre-fix code) instead of the folded cell count -> the combining mark
    // makes the raw length 11 (10 base letters + the mark), so the check
    // becomes `11 + 1 < 12`, which is FALSE — this flips from a shared row
    // to a separate, stacked one, where the correct folded measurement
    // (10 cells, `10 + 1 < 12` true) shares it.
    expect(p.layout.yAxisTitleRow).toBe(p.layout.xAxisTitleRow);
    expect(p.ledger.some((e) => e.code === "axis-title-stacked")).toBe(false);
  });
});

describe("bad-axis-title-at", () => {
  it("rejects an x.titleAt value from the y vocabulary", () => {
    expect(() => renderGlyphChart({ marks: [glyphChartLine(data, { x: "x", y: "y" })], axes: { x: { titleAt: "top" as never } } }))
      .toThrow(expect.objectContaining({ code: "bad-axis-title-at" }));
  });
  it("rejects a y.titleAt value from the x vocabulary", () => {
    expect(() => renderGlyphChart({ marks: [glyphChartLine(data, { x: "x", y: "y" })], axes: { y: { titleAt: "start" as never } } }))
      .toThrow(expect.objectContaining({ code: "bad-axis-title-at" }));
  });
});
