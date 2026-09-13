import { describe, expect, it } from "vitest";
import { createGlyphCanvas } from "glyphcss";
import { layoutGlyphChart, scaleToCol, scaleToColExact, scaleToRowExact } from "./layout";
import { paintGlyphChart } from "./paint";
import { renderGlyphChart } from "./render";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { chartSeries, seriesShade } from "./series";
import { glyphChartArea, normalizeGlyphChartInput } from "./spec";
import type { GlyphChartCharset, GlyphChartInput, GlyphChartLedgerEntry, GlyphChartMark, GlyphChartMarkRow } from "./types";

/**
 * Stacked area rendering — CHARTS-RESEARCH `DIAGNOSIS-stacked-area.md`.
 * S1: a stacked layer's colour-off boundary line erased its own band.
 * S2: the fill interpolated between whole-cell-ROUNDED data points.
 * S3: braille/blocks filled whole cells only, so the silhouette stair-stepped.
 */

// World primary energy consumption by source (TWh), the vendored /charts
// dataset `energy-consumption-by-source` verbatim — real data whose three
// upper layers are each under two rows tall at a terminal size.
const ENERGY: Record<string, Record<string, number>> = {
  "1980": { "Fossil fuels": 70684.05, "Nuclear": 2157.35, "Renewables": 2011.78, "Traditional biomass": 10000 },
  "1985": { "Fossil fuels": 73940.64, "Nuclear": 4511.88, "Renewables": 2444.55, "Traditional biomass": 10541 },
  "1990": { "Fossil fuels": 83071.25, "Nuclear": 6062.41, "Renewables": 2879.68, "Traditional biomass": 11111 },
  "1995": { "Fossil fuels": 86596.98, "Nuclear": 7037.97, "Renewables": 3339.47, "Traditional biomass": 11785 },
  "2000": { "Fossil fuels": 94434.00, "Nuclear": 7820.20, "Renewables": 3727.19, "Traditional biomass": 12500 },
  "2005": { "Fossil fuels": 110553.24, "Nuclear": 8389.71, "Renewables": 4419.03, "Traditional biomass": 12076 },
  "2010": { "Fossil fuels": 121765.15, "Nuclear": 8389.61, "Renewables": 6090.43, "Traditional biomass": 11667 },
  "2015": { "Fossil fuels": 129677.21, "Nuclear": 7805.56, "Renewables": 8016.85, "Traditional biomass": 11111 },
  "2020": { "Fossil fuels": 129419.04, "Nuclear": 8155.18, "Renewables": 10508.34, "Traditional biomass": 11111 },
  "2024": { "Fossil fuels": 142532.37, "Nuclear": 8531.21, "Renewables": 13430.05, "Traditional biomass": 11111 },
};
const energyRows = Object.entries(ENERGY).flatMap(([year, sources]) => Object.entries(sources).map(([source, twh]) => ({ year: `${year}-01-01`, source, twh })));
const energyStack: GlyphChartMark = { ...glyphChartArea(energyRows, { x: "year", y: "twh", fill: "source" }), transform: { kind: "stack" } };

const CHARSETS: readonly GlyphChartCharset[] = ["ascii", "box", "blocks", "braille"];
const SIZES: readonly (readonly [number, number])[] = [[80, 24], [96, 32]];

function picture(input: GlyphChartInput, width: number, height: number, colorEnabled: boolean, charset: GlyphChartCharset) {
  const spec = normalizeGlyphChartInput(input), marks = resolveGlyphChartSpec(spec), scales = resolveGlyphChartScales(marks, spec.scales);
  const ledger: GlyphChartLedgerEntry[] = [];
  const layout = layoutGlyphChart(spec, marks, scales, width, height, "auto", ledger, charset);
  const canvas = createGlyphCanvas({ cols: width, rows: height, tier: charset });
  paintGlyphChart(canvas, spec, marks, scales, layout, { colorEnabled }, ledger);
  const series = chartSeries(marks);
  const at = (col: number, row: number) => canvas.grid.char[row * width + col]!;
  return { canvas, layout, scales, series, at };
}

type Picture = ReturnType<typeof picture>;

/**
 * A layer's exact `y1`/`y0` row coordinates at column `col`, interpolated
 * independently of the painter: each data point sits in the column holding
 * its x (`scaleToCol`, where a line or dot mark puts it) with its EXACT row.
 * The energy data is sparser than every size here, so no column holds two.
 */
function exactEdges(p: Picture, rows: readonly GlyphChartMarkRow[], col: number): { top: number; base: number } {
  const pts = rows
    .map((r) => ({ c: scaleToCol(p.scales.x, p.layout.plot, r.x), top: scaleToRowExact(p.scales.y, p.layout.plot, r.y1!), base: scaleToRowExact(p.scales.y, p.layout.plot, r.y0!) }))
    .sort((a, b) => a.c - b.c);
  const at = (key: "top" | "base") => {
    if (col <= pts[0]!.c) return pts[0]![key];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!;
      if (col <= b.c) return a[key] + (b[key] - a[key]) * (col - a.c) / (b.c - a.c);
    }
    return pts[pts.length - 1]![key];
  };
  return { top: at("top"), base: at("base") };
}

/** Per layer: the band's cells (centre inside `(top - 0.5, base - 0.5]`) and how many carry the layer's own shade glyph. */
function bandOwnership(p: Picture, charset: GlyphChartCharset) {
  const { plot } = p.layout;
  return p.series.map((s) => {
    const glyph = seriesShade(charset, s.styleIndex, p.series.length);
    let band = 0, own = 0;
    const columnsMissingOwn: number[] = [];
    for (let col = plot.x0; col <= plot.x1; col++) {
      const { top, base } = exactEdges(p, s.rows, col);
      let colBand = 0, colOwn = 0;
      for (let row = plot.y0; row <= plot.y1; row++) {
        if (!(top - 0.5 < row && row <= base - 0.5)) continue;
        band++; colBand++;
        if (p.at(col, row) === glyph) { own++; colOwn++; }
      }
      if (colBand > 0 && colOwn === 0) columnsMissingOwn.push(col);
    }
    return { name: s.name, glyph, band, own, columnsMissingOwn };
  });
}

describe("stacked area: every layer keeps its own fill glyph (S1, S2)", () => {
  it.each(CHARSETS.flatMap((charset) => SIZES.map(([w, h]) => [charset, w, h] as const)))("%s %ix%i, colour off: no boundary line erases a band", (charset, w, h) => {
    // Mutation (S1): draw the colour-off boundary line on stacked layers
    // again -> Nuclear keeps 1-23% of its cells (a line glyph lies along
    // its own top row, which is its whole band) -> red.
    const p = picture({ marks: [energyStack] }, w, h, false, charset);
    const bands = bandOwnership(p, charset);
    expect(bands.map((b) => b.name)).toEqual(["Fossil fuels", "Nuclear", "Renewables", "Traditional biomass"]);
    for (const b of bands.slice(1)) {
      expect(b.band, `${b.name} premise: a thin upper band`).toBeGreaterThan(0);
      expect(b.own / b.band, `${b.name} own-glyph share`).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("colour off: a stacked layer logs no double-diagonal-solid (it draws no line at all)", () => {
    // Mutation (S1): restore the boundary line -> the 4th series' "double"
    // style logs one entry per sloped segment -> red.
    for (const charset of CHARSETS) {
      const r = renderGlyphChart({ marks: [energyStack] }, { charset, width: 80, height: 24, color: "none" });
      expect(r.report.ledger.filter((e) => e.code === "double-diagonal-solid"), charset).toEqual([]);
    }
  });

  it.each(CHARSETS.flatMap((charset) => SIZES.map(([w, h]) => [charset, w, h] as const)))("%s %ix%i, colour on: every band cell carries its own layer's glyph (exact interpolation)", (charset, w, h) => {
    // Colour on never draws a boundary, so this isolates the fill.
    // Mutation (S2): round each data point's ROW before interpolating again
    // -> cells per upper band go to a neighbour -> red.
    // Mutation (S3 guard): let the silhouette overwrite a band's own
    // centre-covered cell -> red on blocks/braille.
    const p = picture({ marks: [energyStack] }, w, h, true, charset);
    for (const b of bandOwnership(p, charset)) expect(b.own, b.name).toBe(b.band);
  });
});

describe("stacked area: a band 1-2 rows tall still shows its fill", () => {
  // Three layers over x = 0..6: a tall base, then two thin layers whose
  // thickness is checked against the actual layout below (the premise).
  const data = [0, 1, 2, 3, 4, 5, 6].flatMap((x) => [
    { x, y: 20 + x, s: "base" },
    { x, y: 2.6, s: "thin" },
    { x, y: 3.4 + (x % 2) * 0.2, s: "thinner" },
  ]);
  const mark: GlyphChartMark = { ...glyphChartArea(data, { x: "x", y: "y", fill: "s" }), transform: { kind: "stack" } };

  it.each(CHARSETS)("%s, colour off: every column of each thin band holds at least one of its own glyph", (charset) => {
    // Mutation (S1): restore the boundary line -> the line lies on each
    // thin band's own top row, its only row in most columns -> red.
    const p = picture({ marks: [mark] }, 40, 16, false, charset);
    const bands = bandOwnership(p, charset);
    for (const b of bands.slice(1)) {
      const thickness = b.band / (p.layout.plot.x1 - p.layout.plot.x0 + 1);
      expect(thickness, `${b.name} premise: 1-2 rows`).toBeGreaterThanOrEqual(1);
      expect(thickness, `${b.name} premise: 1-2 rows`).toBeLessThanOrEqual(2);
      expect(b.columnsMissingOwn, b.name).toEqual([]);
    }
  });
});

describe("area data denser than the plot keeps every point's own column", () => {
  it("a one-sample spike between two column centres still fills its own column to its value", () => {
    // 200 points over a ~30-column plot, flat at 1 with one spike to 9. The
    // spike index is chosen from the layout so that the spike and the NEXT
    // sample both sit left of the spike column's own centre: sampling the
    // centre alone would interpolate between two flat samples.
    // Mutation: sample each column at its centre only (exact-x interpolation)
    // -> the spike's column stays at 1 -> red.
    const spiky = (at: number) => glyphChartArea(Array.from({ length: 200 }, (_, i) => (i === at ? 9 : 1)));
    const probe = picture({ marks: [spiky(0)] }, 34, 14, false, "box");
    const exact = (i: number) => scaleToColExact(probe.scales.x, probe.layout.plot, i);
    const spike = Array.from({ length: 196 }, (_, i) => i + 2).find((i) => Math.round(exact(i)) > exact(i + 1) && exact(i) !== Math.round(exact(i)))!;
    expect(spike, "premise: such an index exists").toBeDefined();
    const p = picture({ marks: [spiky(spike)] }, 34, 14, false, "box");
    const col = scaleToCol(p.scales.x, p.layout.plot, spike);
    expect(scaleToColExact(p.scales.x, p.layout.plot, spike + 1), "premise").toBeLessThan(col);
    expect(p.at(col, Math.round(scaleToRowExact(p.scales.y, p.layout.plot, 9)))).toBe("█");
  });
});

describe("area silhouette slopes at sub-cell resolution on braille/blocks (S3)", () => {
  // One slow rise: the stack top climbs 4 units over the whole plot width,
  // far less than one row per column.
  const data = [0, 1].flatMap((x) => [{ x, y: 1, s: "a" }, { x, y: 1 + 4 * x, s: "b" }]);
  const mark: GlyphChartMark = { ...glyphChartArea(data, { x: "x", y: "y", fill: "s" }), transform: { kind: "stack" } };
  const spec = { marks: [mark], scales: { y: { domain: [0, 12] as [number, number] } } };
  const BOTTOM_LEFT = new Set(["▖", "▄", "▙", "▟", "▌", "▛"]);
  const BOTTOM_RIGHT = new Set(["▗", "▄", "▙", "▟", "▐", "▜"]);

  it.each(["blocks", "braille"] as const)("%s: height in half-cells per quadrant column is monotone, steps by at most one half-cell, and uses half levels", (charset) => {
    // Mutation (S3): paint no sub-cell silhouette -> the top only moves in
    // whole cells, a 2-half-cell jump between flat runs -> red.
    const p = picture(spec, 48, 18, false, charset);
    const { plot } = p.layout;
    const shades = new Set(p.series.map((s) => seriesShade(charset, s.styleIndex, p.series.length)));
    const heights: number[] = [];
    for (let col = plot.x0; col <= plot.x1; col++) {
      let full = 0;
      let cap = " ";
      for (let row = plot.y0; row < p.layout.xAxisLineRow; row++) {
        const ch = p.at(col, row);
        if (shades.has(ch)) full++;
        else if (ch !== " ") cap = ch;
      }
      heights.push(2 * full + (BOTTOM_LEFT.has(cap) ? 1 : 0), 2 * full + (BOTTOM_RIGHT.has(cap) ? 1 : 0));
    }
    const rise = heights[heights.length - 1]! - heights[0]!;
    expect(rise, "premise: the top rises several cells").toBeGreaterThanOrEqual(8);
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]! - heights[i - 1]!, `quadrant column ${i}`).toBeGreaterThanOrEqual(0);
      expect(heights[i]! - heights[i - 1]!, `quadrant column ${i}`).toBeLessThanOrEqual(1);
    }
    expect(heights.some((h) => h % 2 === 1), "some columns sit on a half-cell level").toBe(true);
  });

  it("box/ascii have no sub-cell glyphs: the silhouette stays whole cells there", () => {
    for (const charset of ["box", "ascii"] as const) {
      const p = picture(spec, 48, 18, false, charset);
      expect(p.canvas.grid.char.some((c) => "▖▗▘▝▄▀".includes(c)), charset).toBe(false);
    }
  });

  const sample = [3, 5, 2, 8, 6, 9, 4];
  const quadrants = (c: string) => "▖▗▄".includes(c);

  it("an unstacked area without a boundary line gets the same sub-cell silhouette (same painter, same defect)", () => {
    // Mutation: gate the silhouette on `stacked` alone -> red.
    const unnamed = renderGlyphChart(glyphChartArea(sample), { charset: "braille", width: 48, height: 16, color: "none" });
    expect(unnamed.grid.char.some(quadrants)).toBe(true);
  });

  it("an unstacked area whose colour-off boundary line IS its edge draws no silhouette on top of it", () => {
    // Mutation: always pass `silhouette: true` -> quadrant caps sit above
    // the named area's own boundary line, a doubled edge -> red.
    const named = renderGlyphChart(glyphChartArea(sample, undefined, { name: "Traffic" }), { charset: "braille", width: 48, height: 16, color: "none" });
    expect(named.grid.char.some(quadrants)).toBe(false);
  });
});
