/**
 * The `shades` render option: a caller-supplied texture palette that
 * replaces the charset's own series glyphs everywhere a region fill is
 * painted, cycles (and reports the repeat) on its own length.
 */
import { describe, expect, it } from "vitest";
import { renderGlyphChart } from "./render";
import { glyphChartArc, glyphChartArea, glyphChartBar, glyphChartFunnel, glyphChartPlot, glyphChartSankey } from "./spec";
import type { GlyphChartRenderOptions, GlyphChartSpec } from "./types";

const PALETTE = ["#", "=", "+", ":", "."];
const BASE: GlyphChartRenderOptions = { width: 72, height: 24, charset: "box", color: "none" };
const BUILT_IN = /[█░▚╱▌═▓▒]/;

function render(spec: GlyphChartSpec, opts: GlyphChartRenderOptions = {}) {
  return renderGlyphChart(spec, { ...BASE, shades: PALETTE, ...opts });
}
const browsers = [{ b: "Chrome", v: 64 }, { b: "Safari", v: 19 }, { b: "Edge", v: 5 }, { b: "Firefox", v: 3 }, { b: "Other", v: 9 }];
const pie = glyphChartPlot({ marks: [glyphChartArc(browsers, { y: "v", fill: "b" })] });

describe("shades option", () => {
  it("fills pie slices and their legend swatches from the palette, in series order", () => {
    // Mutation: drop `shades` from paintArc's regionFillGlyph call -> red.
    const r = render(pie);
    expect(r.text).not.toMatch(BUILT_IN);
    const legend = r.text.trimEnd().split("\n").at(-1)!;
    for (let i = 0; i < browsers.length; i++) expect(legend).toContain(`${PALETTE[i]}  ${browsers[i]!.b}`);
    for (const g of PALETTE) expect(r.text.split("\n").slice(0, -1).join("\n")).toContain(g);
  });

  it("fills corner-legend swatches from the palette", () => {
    // Mutation: drop `shades` from paintCornerLegend's swatches -> red.
    const data = [{ k: "a", v: 3, s: "A" }, { k: "a", v: 5, s: "B" }];
    const r = render(glyphChartPlot({ legend: { placement: "top-right" }, marks: [glyphChartBar(data, { x: "k", y: "v", fill: "s" })] }), { width: 48, height: 16 });
    expect(r.text).toMatch(/#\s+A/);
    expect(r.text).toMatch(/=\s+B/);
    expect(r.text).not.toMatch(BUILT_IN);
  });

  it("fills dodged bar series from the palette", () => {
    const data = [{ k: "a", v: 3, s: "A" }, { k: "a", v: 5, s: "B" }, { k: "b", v: 4, s: "A" }, { k: "b", v: 2, s: "B" }];
    const r = render(glyphChartPlot({ marks: [glyphChartBar(data, { x: "k", y: "v", fill: "s" })] }), { width: 48, height: 16 });
    expect(r.text).not.toMatch(BUILT_IN);
    expect(r.text).toContain("##");
    expect(r.text).toContain("==");
  });

  it("fills stacked area series from the palette", () => {
    // Mutation: drop `shades` from paintAreaMark's glyph -> red.
    const data = [0, 1, 2, 3].flatMap((x) => [{ x, y: 2 + x, s: "A" }, { x, y: 3, s: "B" }]);
    const r = render(glyphChartPlot({ marks: [{ ...glyphChartArea(data, { x: "x", y: "y", fill: "s" }), transform: { kind: "stack" as const } }] }), { width: 48, height: 16 });
    expect(r.text).not.toMatch(BUILT_IN);
    expect(r.text).toContain("==");
  });

  it("fills funnel stages and sankey ribbons from the palette", () => {
    // Mutation: drop `shades` from paintFunnelMark's or computeSankeyRoutedRows' glyph -> red.
    const funnel = render(glyphChartPlot({ marks: [glyphChartFunnel([{ s: "Visit", v: 100 }, { s: "Cart", v: 40 }, { s: "Buy", v: 10 }], { stage: "s", value: "v" })] }));
    expect(funnel.text).not.toMatch(BUILT_IN);
    const flows = [{ from: "A", to: "X", v: 5 }, { from: "B", to: "X", v: 3 }, { from: "B", to: "Y", v: 2 }];
    const sankey = render(glyphChartPlot({ marks: [glyphChartSankey(flows, { source: "from", target: "to", value: "v" })] }));
    expect(sankey.text).not.toMatch(BUILT_IN);
    expect(sankey.text).toContain("=");
  });

  it("cycles on the palette's own length and reports each repeat", () => {
    // Mutation: drop the `cycle` argument from chartSeries -> red.
    const seven = [...browsers, { b: "Opera", v: 2 }, { b: "Brave", v: 1 }];
    const r = render(glyphChartPlot({ marks: [glyphChartArc(seven, { y: "v", fill: "b" })] }));
    const repeats = r.report.ledger.filter((e) => e.code === "series-shade-repeat").map((e) => e.detail);
    expect(repeats).toEqual([{ repeated: "Opera", reused: "Chrome" }, { repeated: "Brave", reused: "Safari" }]);
    const legend = r.text.trimEnd().split("\n").slice(-2).join(" ");
    expect(legend).toContain("#  Opera");
  });

  it("leaves a render without shades on the charset's own glyphs", () => {
    const r = renderGlyphChart(pie, BASE);
    expect(r.text).toContain("█");
    expect(r.text).toContain("░");
  });

  it.each([[[]], [["##"]], [[" "]], [["#", 3]], ["#"]])("rejects %j", (shades) => {
    expect(() => render(pie, { shades: shades as never })).toThrow(expect.objectContaining({ code: "bad-shades" }));
  });

  it("keeps ascii 7-bit", () => {
    expect(() => render(pie, { charset: "ascii", shades: ["#", "█"] })).toThrow(expect.objectContaining({ code: "bad-shades" }));
    expect(render(pie, { charset: "ascii" }).text).toContain("=");
  });
});

describe("thin pie slices", () => {
  it("report the callout they cannot get", () => {
    // Mutation: drop the ledger push for a slice under the callout angle -> red.
    const thin = [{ b: "Chrome", v: 97 }, { b: "Lynx", v: 1 }, { b: "Other", v: 2 }];
    const r = renderGlyphChart(glyphChartPlot({ legend: false, marks: [glyphChartArc(thin, { y: "v", fill: "b" })] }), BASE);
    const dropped = r.report.ledger.filter((e) => e.code === "label-dropped").map((e) => e.detail?.text);
    expect(dropped).toContain("Lynx · 1%");
    expect(r.text).not.toContain("Lynx");
  });
});
