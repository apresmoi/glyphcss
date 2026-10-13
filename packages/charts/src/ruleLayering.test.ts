/**
 * Rules are reference lines painted under the data (`paint.ts`): a target
 * line crossing a bar leaves every bar cell as it was.
 */
import { describe, expect, it } from "vitest";
import { renderGlyphChart } from "./render";
import { glyphChartBar, glyphChartPlot, glyphChartRule } from "./spec";

describe("rule layering", () => {
  it.each(["box", "braille", "ascii"] as const)("a rule crossing bars keeps every bar cell on %s", (charset) => {
    // Mutation: paint rules after the data marks again -> the dashes overwrite bar cells.
    const bars = glyphChartBar([{ q: "Q1", v: 42 }, { q: "Q2", v: 55 }, { q: "Q3", v: 38 }, { q: "Q4", v: 61 }], { x: "q", y: "v" });
    const opts = { target: "chat" as const, width: 48, height: 16, charset, color: "none" as const };
    const bare = renderGlyphChart(glyphChartPlot({ marks: [bars] }), opts).build.canvas.grid.char;
    const ruled = renderGlyphChart(glyphChartPlot({ marks: [bars, glyphChartRule([50])] }), opts).build.canvas.grid.char;
    const changed = bare.flatMap((ch, i) => ch !== " " && ruled[i] !== ch ? [i] : []);
    expect(changed).toEqual([]);
    expect(ruled.join("")).not.toBe(bare.join(""));
  });
});
