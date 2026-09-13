import { describe, expect, it } from "vitest";
import { renderGlyphChart } from "./render";
import { glyphChartArea, glyphChartBar } from "./spec";

/**
 * Packet "renderers, legends, axes, table editor" item 5's own acceptance
 * test, at the chart-renderer level (the canvas-level guarantee lives in
 * `packages/glyphcss/src/render/canvas/tiers.test.ts`): a `braille`-charset
 * bar/area render reads as solid columns (`█`, and the `blocks`-tier
 * quadrant glyphs for partial coverage) next to braille curves — never the
 * braille full-block codepoint `⣿`, which would make a filled bar
 * indistinguishable from a dense scatter of dots.
 */
describe("braille-tier fills render as blocks, not braille dot patterns", () => {
  it("a braille bar chart contains '█' and never '⣿'", () => {
    const r = renderGlyphChart(glyphChartBar([3, 5, 2, 8]), { charset: "braille", color: "none", width: 30, height: 12 });
    expect(r.text).toContain("█");
    expect(r.text).not.toContain("⣿");
  });

  it("a braille area chart contains '█' and never '⣿'", () => {
    const r = renderGlyphChart(glyphChartArea([3, 5, 2, 8]), { charset: "braille", color: "none", width: 30, height: 12 });
    expect(r.text).toContain("█");
    expect(r.text).not.toContain("⣿");
  });

  it("blocks and braille agree exactly on a fill-only render (same underlying table)", () => {
    // A heatmap exercises FRACTIONAL shade values (not just the solid/blank
    // extremes a bar's cell-aligned columns happen to share with box's own
    // ramp), so this is the sharper of the two gates.
    const data = [0, 1, 2, 3].flatMap((x) => [0, 1, 2].map((y) => ({ x: String(x), y: String(y), v: x * y })));
    const spec = { marks: [{ type: "cell" as const, data, channels: { x: "x", y: "y", fill: "v" } }] };
    const blocks = renderGlyphChart(spec, { charset: "blocks", color: "none", width: 30, height: 14 });
    const braille = renderGlyphChart(spec, { charset: "braille", color: "none", width: 30, height: 14 });
    expect(blocks.text).toBe(braille.text);
  });
});
