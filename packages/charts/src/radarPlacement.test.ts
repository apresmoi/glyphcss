import { expect, it } from "vitest";
import { glyphChartFromMermaid, renderGlyphChartMermaid } from "./mermaid";
import { fitGlyphRadarScales } from "./radar";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { layoutGlyphChart } from "./layout";
import { GLYPH_CHART_TARGET_DEFAULTS } from "./render";

const labels = ["Speed", "Cost", "Quality", "Safety", "Scale", "Support"];
const source = (ticks = 2, grid = "polygon", series = "4,8,9,7,6,5") => `radar-beta\naxis speed[Speed], cost[Cost], quality[Quality], safety[Safety], scale[Scale], support[Support]\ncurve custom[Custom] {${series}}\nmin 0\nmax 10\ngraticule ${grid}\nticks ${ticks}\nshowLegend false`;

function assertSpokeLabels(input: string, names: string[], width: number, height: number, target: "chat" | "web") {
  const spec = glyphChartFromMermaid(input);
  const marks = resolveGlyphChartSpec(spec), scales = resolveGlyphChartScales(marks, spec.scales);
  const layout = layoutGlyphChart(spec, marks, scales, width, height, "auto", [], "braille");
  const aspect = GLYPH_CHART_TARGET_DEFAULTS[target].cellAspect;
  const fitted = fitGlyphRadarScales(spec, scales, layout.plot, aspect);
  const points = names.map((_, i) => {
    const a = Math.PI * 2 * i / names.length;
    return { x: layout.plot.x0 + fitted.x.toFraction(Math.sin(a)) * (layout.plot.x1 - layout.plot.x0), y: layout.plot.y1 - fitted.y.toFraction(Math.cos(a)) * (layout.plot.y1 - layout.plot.y0) };
  });
  const result = renderGlyphChartMermaid(input, { target, width, height, charset: "braille", color: "none" });
  const rows = result.text.split("\n");
  let placed = 0;
  names.forEach((label, i) => {
    const y = rows.findIndex(row => row.includes(label));
    if (y < 0) {
      expect(result.report.ledger.some(e => e.code === "label-dropped" && e.detail?.text === label), `${width}/${target}: ${label} omission`).toBe(true);
      return;
    }
    placed++;
    const x = rows[y]!.indexOf(label) + (label.length - 1) / 2;
    const distances = points.map(p => ((x - p.x) * aspect) ** 2 + (y - p.y) ** 2);
    expect(distances[i], `${width}/${target}: ${label} belongs to spoke ${i}`).toBeLessThanOrEqual(Math.min(...distances) + 1e-8);
  });
  expect(result.report.ledger.filter(e => e.code === "label-abbreviated" && e.detail?.role === "data label")).toEqual([]);
  return placed;
}

it("places complete radar labels nearest their own outer spoke or logs their omission", () => {
  for (const width of [24, 36, 48, 72]) for (const target of ["chat", "web"] as const) {
    const height = width === 24 ? 14 : width === 36 ? 18 : 24;
    for (const series of ["4,8,9,7,6,5", "9,6,7,8,9,8"]) {
      expect(assertSpokeLabels(source(2, "polygon", series), labels, width, height, target), `${width}/${target}: useful labels`).toBeGreaterThanOrEqual(4);
    }
    // Five spokes and long captions expose sideways relocations even before
    // the generic collision pass: a local free spot may belong to a neighbour.
    const names = ["Planning", "Delivery", "Research", "Security", "Staffing"];
    const crowded = `radar\naxis ${names.join(",")}\ncurve one{2,3,4,5,6}\nmax 10\nshowLegend false`;
    expect(assertSpokeLabels(crowded, names, width, 18, target)).toBeGreaterThan(0);
  }
});

it("outer radar grid retains the contour and every spoke for circles and polygons", () => {
  for (const grid of ["circle", "polygon"]) {
    const outer = renderGlyphChartMermaid(source(5, grid), { target: "chat", charset: "braille", width: 36, height: 18, radarGrid: "outer" });
    const one = renderGlyphChartMermaid(source(1, grid), { target: "chat", charset: "braille", width: 36, height: 18 });
    const all = renderGlyphChartMermaid(source(5, grid), { target: "chat", charset: "braille", width: 36, height: 18 });
    expect(outer.text).toBe(one.text);
    expect(outer.text).not.toBe(all.text);
    expect(outer.report.ledger.some(e => e.detail?.feature === "radar inner graticules")).toBe(true);
    expect(outer.build.report).toBe(outer.report);
    expect(renderGlyphChartMermaid(source(0, grid), { charset: "braille", radarGrid: "outer" }).text).toBe(renderGlyphChartMermaid(source(0, grid), { charset: "braille" }).text);
  }
});

it("fixed spatial captions drop on collisions and overflow instead of clamping, nudging or abbreviating", async () => {
  const { glyphChartLabelLayout } = await import("./labels");
  const candidates = [
    { id: "blocked", x: 5, y: 1, text: "Cost", fixed: true },
    { id: "overflow", x: 0, y: 2, text: "Quality", fixed: true },
    { id: "wide", x: 5, y: 3, text: "A very long axis name", fixed: true },
    { id: "free", x: 15, y: 2, text: "Scale", fixed: true },
  ];
  const result = glyphChartLabelLayout(candidates, { obstacles: [{ x0: 5, x1: 5, y0: 1, y1: 1 }], viewport: { cols: 20, rows: 4 } });
  expect(result.placed).toEqual([{ id: "free", x: 13, y: 2, text: "Scale", abbreviated: false, scale: 1 }]);
  expect(result.dropped).toEqual(["blocked", "overflow", "wide"]);
  expect(result.ledger.map(e => e.code)).toEqual(Array(3).fill("label-dropped"));
});
