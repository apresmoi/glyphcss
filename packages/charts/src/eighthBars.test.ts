/**
 * Eighth-block bar tops (`paint.ts`'s `paintBar`, reviewFixtures exception
 * 11): a positive, unstacked `█` bar ends in the lower eighth block for its
 * remaining fraction of a row; every other bar keeps whole cells.
 */
import { describe, expect, it } from "vitest";
import { renderGlyphChart } from "./render";
import { glyphChartBar, glyphChartPlot } from "./spec";
import type { GlyphChartCharset, GlyphChartMark, GlyphChartRenderOptions, GlyphChartSpec } from "./types";

const EIGHTHS = "▁▂▃▄▅▆▇";

/**
 * Renders `marks` on a y domain of `[min, rows - 1]` (plus the base options),
 * so one data unit is exactly one row, and returns a cell reader plus the
 * plot rect. The axis line sits on `plot.y1` whenever `min` is 0.
 */
function render(marks: GlyphChartMark[], opts: { min?: number; charset?: GlyphChartCharset } & Partial<GlyphChartRenderOptions> = {}) {
  const { min = 0, charset = "box", ...rest } = opts;
  const width = 40, height = 16;
  const probe = renderGlyphChart(glyphChartPlot({ marks, scales: { y: { domain: [min, 1] } } }), { width, height, charset, color: "none", ...rest });
  const rows = probe.build.plot.y1 - probe.build.plot.y0 + 1;
  const spec: GlyphChartSpec = glyphChartPlot({ marks, scales: { y: { domain: [min, rows - 1] } } });
  const r = renderGlyphChart(spec, { width, height, charset, color: "none", ...rest });
  expect(r.build.plot.y1 - r.build.plot.y0 + 1, "the plot height must not depend on the domain").toBe(rows);
  const at = (x: number, y: number) => r.build.canvas.grid.char[y * width + x];
  const column = (x: number) => Array.from({ length: rows }, (_, i) => at(x, r.build.plot.y0 + i)).join("");
  return { r, at, column, plot: r.build.plot };
}

/** The first plot column a band bar paints, scanning one row above the axis line. */
function firstBarCol(p: ReturnType<typeof render>, axisRow: number): number {
  for (let x = p.plot.x0; x <= p.plot.x1; x++) if (p.at(x, axisRow - 1) !== " ") return x;
  throw new Error("no bar painted");
}

describe("eighth-block bar tops", () => {
  it.each([1, 2, 3, 4, 5, 6, 7])("a bar 3 + %i/8 rows tall is three █ rows capped by the matching eighth", (k) => {
    // Mutation: drop the partial-row fill (or index LOWER_EIGHTHS off by one) -> red.
    const p = render([glyphChartBar([{ x: "a", y: 3 + k / 8 }], { x: "x", y: "y" })]);
    const x = firstBarCol(p, p.plot.y1);
    for (const dy of [1, 2, 3]) expect(p.at(x, p.plot.y1 - dy), `row ${dy} above the axis`).toBe("█");
    expect(p.at(x, p.plot.y1 - 4)).toBe(EIGHTHS[k - 1]);
    expect(p.at(x, p.plot.y1 - 5)).toBe(" ");
  });

  it("a whole-row height paints whole cells only", () => {
    const p = render([glyphChartBar([{ x: "a", y: 4 }], { x: "x", y: "y" })]);
    const x = firstBarCol(p, p.plot.y1);
    expect(p.column(x).slice(0, -1).trim()).toBe("████");
  });

  it("close values that one whole-cell row cannot separate get distinct tops", () => {
    // 4.25, 4.5 and 4.75 rows all round to 4 or 5 whole cells.
    const p = render([glyphChartBar([{ x: "a", y: 4.25 }, { x: "b", y: 4.5 }, { x: "c", y: 4.75 }], { x: "x", y: "y" })]);
    const tops = new Set<string>();
    for (let x = p.plot.x0; x <= p.plot.x1; x++) {
      const top = p.at(x, p.plot.y1 - 5)!;
      if (top !== " ") tops.add(top);
    }
    expect([...tops].sort()).toEqual(["▂", "▄", "▆"]);
  });

  it("a value under one row still shows as an eighth instead of vanishing", () => {
    // Mutation: gate the eighth path on the whole-cell `rowTop === rowBottom` skip -> red.
    const p = render([glyphChartBar([{ x: "a", y: 0.25 }], { x: "x", y: "y" })]);
    const row = Array.from({ length: p.plot.x1 - p.plot.x0 + 1 }, (_, i) => p.at(p.plot.x0 + i, p.plot.y1 - 1)).join("");
    expect(row.trim()).toMatch(/^▂+$/);
  });

  it("ascii keeps whole-cell # bars", () => {
    const p = render([glyphChartBar([{ x: "a", y: 3.5 }], { x: "x", y: "y" })], { charset: "ascii" });
    const text = p.r.text;
    expect(text).toContain("#");
    expect(text).not.toMatch(/[▁▂▃▄▅▆▇]/);
  });

  it("a textured second series keeps whole cells", () => {
    const data = [{ x: "a", y: 3.5, s: "A" }, { x: "a", y: 2.5, s: "B" }];
    const p = render([glyphChartBar(data, { x: "x", y: "y", fill: "s" })]);
    const tops = new Set<string>();
    for (let x = p.plot.x0; x <= p.plot.x1; x++) for (let y = p.plot.y0; y < p.plot.y1; y++) tops.add(p.at(x, y)!);
    // Series A (█) gets its ▄ top; series B's shade never mixes with an eighth block.
    expect(tops.has("▄")).toBe(true);
    const shades = [...tops].filter((c) => "░▒▓".includes(c));
    expect(shades.length).toBe(1);
    expect([...tops].filter((c) => EIGHTHS.includes(c))).toEqual(["▄"]);
  });

  it("negative bars and stack segments keep whole cells", () => {
    // Mutation: drop the `topValue > 0` or `!stacked` gate -> red.
    const negative = renderGlyphChart(glyphChartPlot({ marks: [glyphChartBar([{ x: "a", y: -3.5 }, { x: "b", y: -1.25 }], { x: "x", y: "y" })] }), { width: 40, height: 16, charset: "box", color: "none" });
    expect(negative.text).toContain("█");
    expect(negative.text).not.toMatch(/[▁▂▃▄▅▆▇]/);
    // One series, so no later segment covers the first one's top row.
    const stacked = render([{ ...glyphChartBar([{ x: "a", y: 3.5 }], { x: "x", y: "y" }), transform: { kind: "stack" as const } }]);
    expect(stacked.r.text).toContain("█");
    expect(stacked.r.text).not.toMatch(/[▁▂▃▄▅▆▇]/);
  });
});
