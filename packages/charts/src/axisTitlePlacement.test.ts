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
    expect(p.rowText(p.layout.yAxisTitleRow).indexOf(title)).toBe(0);
    expect(p.ledger.some((e) => e.code === "axis-title-stacked")).toBe(false);
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
