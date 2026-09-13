import { describe, expect, it } from "vitest";
import { renderGlyphChart } from "./render";
import { glyphChartArc } from "./spec";
import { browserShares } from "./reviewFixtures";
import type { GlyphChartResult } from "./types";

function disc(r: GlyphChartResult): string[] {
  // These budgets reserve the final row for the legend; never count its swatches as quantity.
  // Every call in this file paints with `labels: "legend-only"` (arcShape.test.ts
  // owns the callout feature itself) precisely so this remains "every
  // non-space cell but the last row IS the disc" — a callout's own leader/
  // label glyphs would otherwise land in that same slice and corrupt the
  // glyph-area ratios these regression tests exist to pin.
  return r.grid.char.slice(0, -r.grid.cols).filter((c) => c !== " ");
}
function shares(cells: readonly string[], glyphs: readonly string[]): number[] {
  return glyphs.map((glyph) => cells.filter((c) => c === glyph).length / cells.length);
}

describe("Phase 1 round 2 arc regressions", () => {
  it("record arc uses y for values and fill for categories without an x channel", () => {
    // Mutation: require x+y for arc, or paint each category as a separate whole pie -> throws / slice ratios differ.
    const r = renderGlyphChart(glyphChartArc(browserShares, { fill: "browser", y: "share" }, { labels: "legend-only" }), { target: "chat", width: 40, height: 14 });
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
    const r = renderGlyphChart(glyphChartArc([50, 25, 25], undefined, { labels: "legend-only" }), { target: "chat", width: 30, height: 16, charset });
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
    const fallback = renderGlyphChart(glyphChartArc(browserShares, { y: "share", label: "browser" }, { labels: "legend-only" }), { target: "chat", width: 40, height: 14, color });
    const filled = renderGlyphChart(glyphChartArc(browserShares, { y: "share", fill: "browser", label: ["wrong", "wrong", "wrong"] }, { labels: "legend-only" }), { target: "chat", width: 40, height: 14, color });
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

  // P3-3 (REVIEW-arc-density-search-opus.md): every case above renders
  // with `labels: "legend-only"` specifically so a callout's own
  // leader/label glyphs never land in the disc's own glyph-area ratio —
  // which means NOTHING in this suite pins the area ratio under the
  // SHIPPED DEFAULT (`labels: "callout"`) any more. This case closes that:
  // it renders at the real default (no `labels` override at all), then
  // restricts the area count to cells the ellipse test says are genuinely
  // part of the disc (the same independent geometry `arcShape.test.ts`
  // re-derives, never importing the private `arcRadii`) — so a leader/
  // label cell painted just outside the disc can't skew the ratio, and a
  // regression that leaked callout ink INTO the disc (corrupting a real
  // slice's own glyph) would still be caught.
  it("[50,25,25] at 72x24 retains 2:1:1 glyph areas under the SHIPPED DEFAULT (labels: callout), counting only cells inside the disc ellipse", () => {
    const width = 72, height = 24;
    const r = renderGlyphChart(glyphChartArc([50, 25, 25]), { target: "chat", width, height, legend: false });
    // Independent re-derivation of `arcRadii`'s own formula (mirrors
    // `arcShape.test.ts`'s `expectedRadii`) — `legend: false` means
    // `layout.plot` is exactly the full grid, and callouts (angular spans
    // 180°/90°/90°, all well past the 8° minimum) always fit at 72 columns.
    const GUTTER = 12; // GLYPH_CHART_ARC_CALLOUT_GUTTER_COLS
    const cappedGutter = Math.min(GUTTER, Math.floor(width / 4));
    const availableCols = width - 2 * cappedGutter;
    const cellAspect = 0.5; // chat target
    const diameter = Math.min(height, availableCols * cellAspect) * 0.8; // GLYPH_CHART_ARC_FILL
    const ry = Math.max(0.5, diameter / 2);
    const rx = ry / cellAspect;
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;

    const glyphs = ["█", "▓", "▒"];
    const insideDisc: string[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = r.grid.char[y * width + x]!;
        if (!glyphs.includes(c)) continue;
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) insideDisc.push(c);
      }
    }
    expect(insideDisc.length).toBeGreaterThan(0);
    expect(new Set(insideDisc)).toEqual(new Set(glyphs));
    shares(insideDisc, glyphs).forEach((share, i) => expect(Math.abs(share - [0.5, 0.25, 0.25][i]!)).toBeLessThan(0.05));
  });

  it.each(["box", "ascii"] as const)("cycles four %s shades and keeps the closing neighbours distinct after wrapping", (charset) => {
    // Mutation: always use index % 4, including the closing slice -> slice 5 matches slice 1.
    const r = renderGlyphChart(glyphChartArc([20, 20, 20, 20, 20], undefined, { labels: "legend-only" }), { target: "chat", width: 80, height: 24, charset });
    const swatches = r.text.split("\n").at(-1)!.match(charset === "ascii" ? /[#%+.]/g : /[█▓▒░]/g)!;
    expect(swatches).toHaveLength(5);
    expect(new Set(disc(r))).toEqual(new Set(charset === "ascii" ? ["#", "%", "+", "."] : ["█", "▓", "▒", "░"]));
    swatches.forEach((glyph, i) => expect(glyph).not.toBe(swatches[(i + 1) % swatches.length]));
  });
});
