import { describe, expect, it } from "vitest";
import { GLYPH_CHART_TARGET_DEFAULTS } from "@glyphcss/charts";
import { glyphMonoWebGridSize, GLYPH_MONO_WEB_CELL_ASPECT } from "./glyphMonoMetrics";

describe("GLYPH_MONO_WEB_CELL_ASPECT", () => {
  // Pin: this constant and `@glyphcss/charts`' own `GLYPH_CHART_TARGET_
  // DEFAULTS.web.cellAspect` are the SAME real-font measurement
  // (`glyphMonoMetrics.ts`'s own doc) — if the library's own value ever
  // moves (a font regen), this page's viewport-fill math must move with
  // it, or a chart rendered live drifts from what `renderGlyphChart`
  // itself thinks a cell is shaped like (the arc-shape defect this exact
  // number already fixed once, AGENTS.md's "Arc shape and callouts").
  it("matches @glyphcss/charts' own web cellAspect exactly", () => {
    expect(GLYPH_MONO_WEB_CELL_ASPECT).toBe(GLYPH_CHART_TARGET_DEFAULTS.web.cellAspect);
  });
});

describe("glyphMonoWebGridSize", () => {
  it("derives cols/rows from a measured pixel box at density 1", () => {
    // 13px base font, cellW = 13 * 0.5859375 = 7.6171875px, cellH = 13px.
    const size = glyphMonoWebGridSize({ width: 761.71875, height: 130 }, 13, 1);
    expect(size).toEqual({ width: 100, height: 10 });
  });

  // Mutation: dividing by `density` instead of multiplying the font-size
  // divisor (i.e. shrinking cells as density grows instead of growing
  // them) would HALVE this at density 2 instead of doubling it.
  it("a higher density packs MORE, smaller cells into the identical pixel box", () => {
    const at1 = glyphMonoWebGridSize({ width: 761.71875, height: 130 }, 13, 1);
    const at2 = glyphMonoWebGridSize({ width: 761.71875, height: 130 }, 13, 2);
    expect(at2.width).toBe(at1.width * 2);
    expect(at2.height).toBe(at1.height * 2);
  });

  it("floors to whole cells and never returns fewer than one cell on a degenerate (zero/negative) box", () => {
    expect(glyphMonoWebGridSize({ width: 10, height: 10 }, 13, 1)).toEqual({ width: 1, height: 1 });
    expect(glyphMonoWebGridSize({ width: 0, height: 0 }, 13, 1)).toEqual({ width: 1, height: 1 });
  });
});
