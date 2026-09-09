// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { buildGlyphSvgLayers, type GlyphSvgLayer } from "./glyphSvgLayers";
import { buildGlyphSvg, type GlyphSvgMetrics, type SvgGrid } from "./glyphSvgExport";

function grid(rows: readonly string[], color: string | null = "#ff0000"): SvgGrid {
  return rows.map((r) => [...r].map((ch) => ({ ch, color, background: null })));
}

const BASE_METRICS: GlyphSvgMetrics = {
  cellWidthPx: 8, cellHeightPx: 16, fontSizePx: 13, fontFamily: "Menlo, monospace", background: "rgb(5, 7, 12)",
};
/** A detail layer at 2x density: half the cell, so twice the rows and cols over the same pixels. */
const DETAIL_METRICS: GlyphSvgMetrics = {
  cellWidthPx: 4, cellHeightPx: 8, fontSizePx: 6.5, fontFamily: "Menlo, monospace",
};

describe("a single layer is byte-identical to the one-`<pre>` export", () => {
  it("returns exactly what buildGlyphSvg returns", () => {
    const layer: GlyphSvgLayer = { grid: grid(["ab", "cd"]), metrics: BASE_METRICS, dx: 0, dy: 0 };
    expect(buildGlyphSvgLayers([layer])).toBe(buildGlyphSvg(layer.grid, layer.metrics));
  });

  it("is null with nothing to export", () => {
    expect(buildGlyphSvgLayers([])).toBeNull();
  });
});

describe("detail layers are composited over the base", () => {
  const base: GlyphSvgLayer = { grid: grid(["...", "..."], "#334455"), metrics: BASE_METRICS, dx: 0, dy: 0 };
  const detail: GlyphSvgLayer = { grid: grid(["--"], "#38bdf8"), metrics: DETAIL_METRICS, dx: 3.5, dy: -2 };
  const svg = buildGlyphSvgLayers([base, detail])!;

  // The whole defect: the roads, borders and buildings the reader switched on
  // live in their own `<pre>`s, and the export dropped every one of them.
  it("carries every layer's glyphs and colours", () => {
    expect(svg).toContain("#334455");
    expect(svg).toContain("#38bdf8");
    expect((svg.match(/<text/g) ?? []).length).toBe(3);
  });

  it("emits each layer at its OWN font size, not the base's", () => {
    expect(svg).toMatch(/font-size="13"/);
    expect(svg).toMatch(/font-size="6\.5"/);
  });

  it("places a layer at its own offset from the base", () => {
    expect(svg).toContain('transform="translate(3.5 -2)"');
  });

  it("paints ONE background — the base's — so a detail layer cannot erase what is under it", () => {
    expect((svg.match(/rgb\(5, 7, 12\)/g) ?? []).length).toBe(1);
  });

  it("sizes the canvas to the base viewport", () => {
    expect(svg).toContain('viewBox="0 0 24 32"');
  });

  it("does not wrap a zero-offset layer in a pointless transform", () => {
    const flat = buildGlyphSvgLayers([base, { ...detail, dx: 0, dy: 0 }])!;
    expect(flat).not.toContain("translate(0 0)");
  });
});
