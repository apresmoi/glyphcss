import { describe, expect, it } from "vitest";
import { renderGlyphChart } from "./render";
import { glyphChartArc } from "./spec";
import { browserShares } from "./reviewFixtures";
import type { GlyphChartResult } from "./types";

function disc(r: GlyphChartResult): string[] {
  // These budgets reserve the final row for the legend; never count its swatches as quantity.
  return r.grid.char.slice(0, -r.grid.cols).filter((c) => c !== " ");
}
function shares(cells: readonly string[], glyphs: readonly string[]): number[] {
  return glyphs.map((glyph) => cells.filter((c) => c === glyph).length / cells.length);
}

describe("Phase 1 round 2 arc regressions", () => {
  it("record arc uses y for values and fill for categories without an x channel", () => {
    // Mutation: require x+y for arc, or paint each category as a separate whole pie -> throws / slice ratios differ.
    const r = renderGlyphChart(glyphChartArc(browserShares, { fill: "browser", y: "share" }), { target: "chat", width: 40, height: 14 });
    expect(r.meta.series).toEqual(["Chrome", "Safari", "Firefox"]);
    expect(r.meta.values).toBe(3);
    const cells = disc(r);
    expect(new Set(cells)).toEqual(new Set(["█", "▓", "▒"]));
    shares(cells, ["█", "▓", "▒"]).forEach((share, i) => expect(Math.abs(share - [0.65, 0.2, 0.15][i]!)).toBeLessThan(0.04));
    // Mutation: exclude arc from chartSeries or use line swatches -> named slice legend disappears/mismatches.
    const legend = r.text.split("\n").at(-1)!;
    expect(legend).toMatch(/█\s+Chrome.*▓\s+Safari.*▒\s+Firefox/);
  });

  it.each(["ascii", "box", "blocks", "braille"] as const)("[50,25,25] at 30x16 retains 2:1:1 glyph areas in %s", (charset) => {
    // Mutation: paint every slice solid -> fewer than three disc glyphs and wrong 2:1:1 counts.
    const r = renderGlyphChart(glyphChartArc([50, 25, 25]), { target: "chat", width: 30, height: 16, charset });
    const glyphs = charset === "ascii" ? ["#", "%", "+"] : ["█", "▓", "▒"];
    const cells = disc(r);
    expect(new Set(cells)).toEqual(new Set(glyphs));
    shares(cells, glyphs).forEach((share, i) => expect(Math.abs(share - [0.5, 0.25, 0.25][i]!)).toBeLessThan(0.04));
    expect(r.meta.series).toEqual(["0", "1", "2"]);
    // Mutation: select Unicode shades on ascii -> 7-bit gate goes red.
    if (charset === "ascii") expect(r.text).toMatch(/^[\x20-\x7e\n]*$/);
  });

  it.each(["none", "css"] as const)("label fallback and fill precedence agree with legend under %s colour", (color) => {
    // Mutation: ignore label categories or let label override fill -> names/legend differ from the slices.
    const fallback = renderGlyphChart(glyphChartArc(browserShares, { y: "share", label: "browser" }), { target: "chat", width: 40, height: 14, color });
    const filled = renderGlyphChart(glyphChartArc(browserShares, { y: "share", fill: "browser", label: ["wrong", "wrong", "wrong"] }), { target: "chat", width: 40, height: 14, color });
    expect(fallback.meta.series).toEqual(["Chrome", "Safari", "Firefox"]);
    expect(filled.text).toBe(fallback.text);
    // Mutation: cycle only with colour off -> stripping colours downstream leaves a solid disc.
    expect(new Set(disc(fallback))).toEqual(new Set(["█", "▓", "▒"]));
    if (color === "css") {
      // Mutation: paint all slices/swatches with palette colour 0 -> named colours disappear.
      for (const [glyph, name, hex] of [["█", "Chrome", "#3b82f6"], ["▓", "Safari", "#f97316"], ["▒", "Firefox", "#22c55e"]]) {
        expect(fallback.html).toMatch(new RegExp(`color:${hex}[^>]*>[^<]*${glyph}`));
        expect(fallback.html).toMatch(new RegExp(`color:${hex}[^>]*>[^<]*${name}`));
      }
    }
  });

  it.each(["box", "ascii"] as const)("cycles four %s shades and keeps the closing neighbours distinct after wrapping", (charset) => {
    // Mutation: always use index % 4, including the closing slice -> slice 5 matches slice 1.
    const r = renderGlyphChart(glyphChartArc([20, 20, 20, 20, 20]), { target: "chat", width: 80, height: 24, charset });
    const swatches = r.text.split("\n").at(-1)!.match(charset === "ascii" ? /[#%+.]/g : /[█▓▒░]/g)!;
    expect(swatches).toHaveLength(5);
    expect(new Set(disc(r))).toEqual(new Set(charset === "ascii" ? ["#", "%", "+", "."] : ["█", "▓", "▒", "░"]));
    swatches.forEach((glyph, i) => expect(glyph).not.toBe(swatches[(i + 1) % swatches.length]));
  });
});
