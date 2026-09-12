/**
 * Charts-level gates for the cell canvas's sub-cell `line()` (`braille`/
 * `blocks`) — see `packages/glyphcss/src/render/canvas/subcell.test.ts` for
 * the canvas-level gates this sits on top of, and `paint.ts`'s `paintDot`
 * doc comment for the sub-cell dot-mark design.
 */
import { createGlyphCanvas } from "glyphcss";
import { describe, expect, it } from "vitest";
import { layoutGlyphChart } from "./layout";
import { paintGlyphChart } from "./paint";
import { renderGlyphChart } from "./render";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { categoricalSeriesData } from "./reviewFixtures";
import { glyphChartDot, glyphChartLine, normalizeGlyphChartInput } from "./spec";
import type { GlyphChartCharset, GlyphChartInput } from "./types";

function popcount(mask: number): number {
  let n = 0, m = mask;
  while (m > 0) { n += m & 1; m >>>= 1; }
  return n;
}

/** Braille-mask popcounts for every painted cell strictly inside the PLOT
 * rect — never the whole grid, which also carries the axis lines' own
 * braille dots (an axis line is `canvas.line` too, and gets the same
 * sub-cell treatment; its popcounts are unrelated to a mark's own dots). */
function plotBraillePopcounts(input: GlyphChartInput, width: number, height: number, colorEnabled: boolean): number[] {
  const spec = normalizeGlyphChartInput(input);
  const marks = resolveGlyphChartSpec(spec);
  const scales = resolveGlyphChartScales(marks, spec.scales);
  const charset: GlyphChartCharset = "braille";
  const ledger: string[] = [];
  const layout = layoutGlyphChart(spec, marks, scales, width, height, "auto", ledger, charset);
  const canvas = createGlyphCanvas({ cols: width, rows: height, tier: charset });
  paintGlyphChart(canvas, spec, marks, scales, layout, { colorEnabled }, ledger);
  const counts: number[] = [];
  for (let y = layout.plot.y0; y <= layout.plot.y1; y++) {
    for (let x = layout.plot.x0; x <= layout.plot.x1; x++) {
      const c = canvas.grid.char[y * width + x]!;
      const cp = c.codePointAt(0)!;
      if (cp >= 0x2800 && cp <= 0x28ff) counts.push(popcount(cp - 0x2800));
    }
  }
  return counts;
}

describe("sub-cell line(): a chart line rendered in braille is genuinely higher-resolution than box", () => {
  it("MUTATION CAUGHT: falling back to whole-cell slope glyphs -> braille has no more distinct glyphs than box and reuses '/'/'\\'", () => {
    const data = [3, 5, 2, 8, 6, 9, 4, 7, 3, 5];
    const box = renderGlyphChart(glyphChartLine(data), { target: "chat", charset: "box", width: 44, height: 12 });
    const braille = renderGlyphChart(glyphChartLine(data), { target: "chat", charset: "braille", width: 44, height: 12 });

    const distinctNonSpace = (text: string): number => new Set(text.replace(/\n/g, "").split("").filter((c) => c !== " ")).size;
    expect(distinctNonSpace(braille.text)).toBeGreaterThan(distinctNonSpace(box.text));
    expect(braille.text).not.toMatch(/[/\\]/);
    // The box render, by contrast, is exactly the whole-cell slope-glyph
    // vocabulary this feature moves braille/blocks off of.
    expect(box.text).toMatch(/[/\\]/);
  });
});

describe("sub-cell 'dot' mark: a braille point occupies one cell with ≤2 dots, at the sub-cell position", () => {
  it("MUTATION CAUGHT: a whole-cell dot glyph (or unbounded fill) -> some painted cell has more than 2 dots", () => {
    const counts = plotBraillePopcounts(glyphChartDot([0, 1, 0]), 24, 10, false);
    expect(counts.length).toBeGreaterThan(0);
    for (const count of counts) expect(count).toBeLessThanOrEqual(2);
  });

  it("a single-series dot mark (styleIndex 0, or colour carrying identity) is exactly one dot", () => {
    // colorEnabled: true (colour carries series identity) — `paintDot`
    // zeroes every mark's styleIndex, so every dot is the single-dot shape.
    const counts = plotBraillePopcounts(
      glyphChartDot(categoricalSeriesData, { x: "x", y: "y", fill: "s" }),
      24,
      10,
      true,
    );
    expect(counts.length).toBeGreaterThan(0);
    expect(counts.every((c) => c === 1)).toBe(true);
  });
});
