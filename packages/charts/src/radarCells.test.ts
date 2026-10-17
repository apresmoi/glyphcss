import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { glyphChartFromMermaid, renderGlyphChartMermaid } from "./mermaid";
import { renderGlyphChart } from "./render";
import { goodSpecs } from "./reviewFixtures";
import examples from "./fixtures/mermaidExamples.json";
import baseline from "./fixtures/radar3ParentHashes.json";
import { fitGlyphRadarScales } from "./radar";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { scaleToColExact, scaleToRowExact } from "./layout";
import type { GlyphChartRenderOptions } from "./types";

const labels = ["Speed", "Cost", "Quality", "Safety", "Scale", "Support"];
const axes = "axis speed[\"Speed\"], cost[\"Cost\"], quality[\"Quality\"], safety[\"Safety\"], scale[\"Scale\"], support[\"Support\"]";
const curves = ["curve hosted[\"Hosted\"]{9,6,7,8,9,8}", "curve custom[\"Custom\"]{4,8,9,7,6,5}", "curve hybrid[\"Hybrid\"]{7,7,8,9,8,7}"];
const source = `radar-beta\n${axes}\n${curves.join("\n")}\nmax 10\ngraticule polygon\nticks 2`;
const options = { target: "chat", charset: "braille", width: 72, height: 24, radarGrid: "outer", radarSeries: "cells" } as const;
const glyphs = ["•", "○", "×", "+"];

it("preserves pre-change text and HTML hashes across every native fixture, target and charset", () => {
  const hashes: Record<string, string> = {};
  const hash = (r: { text: string; html?: string }) => createHash("sha256").update(JSON.stringify([r.text, r.html])).digest("hex");
  for (const target of ["chat", "web", "terminal"] as const) for (const charset of ["ascii", "box", "braille", "blocks"] as const) {
    const mode: GlyphChartRenderOptions = { target, charset, width: 72, height: 24 };
    goodSpecs.forEach((s, i) => {
      const result = renderGlyphChart(s, mode);
      hashes[`native:${i}:${target}:${charset}`] = hash(result);
      expect(hash(renderGlyphChart(s, { ...mode, radarSeries: "cells" }))).toBe(hash(result));
    });
    examples.forEach((s, i) => {
      const result = renderGlyphChartMermaid(s.source, mode);
      hashes[`mermaid:${i}:${target}:${charset}`] = hash(result);
      expect(hash(renderGlyphChartMermaid(s.source, { ...mode, radarSeries: "line" }))).toBe(hash(result));
    });
  }
  expect(hashes).toEqual(baseline);
  // Renders every fixture 24 times; the CI runner takes about 9 s.
}, 30_000);

it("paints whole-cell series over braille guides, with symbol legends and no redundant prefixes", () => {
  const result = renderGlyphChartMermaid(source, options);
  const rows = result.text.split("\n");
  expect(result.text).toMatch(/[\u2801-\u28ff]/u);
  for (const [i, name] of ["Hosted", "Custom", "Hybrid"].entries()) {
    expect(rows.at(-1)).toMatch(new RegExp(`${glyphs[i]} +${name}`, "u"));
    expect(rows.slice(0, -1).join("\n")).toContain(glyphs[i]);
  }
  expect(result.text).not.toMatch(/[ABC]: /);
  const hidden = renderGlyphChartMermaid(`${source}\nshowLegend false`, options);
  expect(hidden.text).not.toMatch(/Hosted|Custom|Hybrid/);
  expect(hidden.text).toContain("•");
  expect(result.report.ledger.some(e => e.detail?.feature === "radar cell edges")).toBe(true);
});

it("keeps the declared first series in shared cells, including identically named curves", () => {
  const same = `radar\n${axes}\ncurve one["Plan"]{9,6,7,8,9,8}\ncurve two["Plan"]{9,6,7,8,9,8}\nmax 10`;
  const result = renderGlyphChartMermaid(same, options);
  const plot = result.build.plot;
  const marks = result.build.canvas.grid.char.filter((_, index) => {
    const x = index % 72, y = Math.floor(index / 72);
    return x >= plot.x0 && x <= plot.x1 && y >= plot.y0 && y <= plot.y1;
  });
  expect(marks).toContain("•");
  expect(marks).not.toContain("○");
  expect(result.text).toMatch(/• +Plan.*○ +Plan/u);
  expect(result.meta.series).toHaveLength(2);
});

it("cycles all four symbols in the plot and every legend placement", () => {
  const five = `radar\naxis North,East,South,West\n${[2,4,6,8,10].map((v,i) => `curve s${i}["P${i}"]{${[v,v,v,v]}}`).join("\n")}\nmax 10`;
  for (const legend of ["bottom", "title", "top-left", "top-right", "bottom-left", "bottom-right"] as const) {
    const result = renderGlyphChartMermaid(`---\ntitle: Plans\n---\n${five}`, { ...options, width: 96, height: 40, legend: { placement: legend } });
    for (const [i, name] of Array.from({ length: 5 }, (_, i) => `P${i}`).entries()) {
      expect(result.text).toMatch(new RegExp(`${i % 4 === 3 ? "\\+" : glyphs[i % 4]} +${name}`, "u"));
    }
  }
  const result = renderGlyphChartMermaid(`${five}\nshowLegend false`, { ...options, width: 96, height: 40 });
  for (const glyph of glyphs) expect(result.text).toContain(glyph);
});

it("covers every cell intersected by each edge, including shallow and steep slopes, in one canvas", () => {
  const spec = glyphChartFromMermaid(`${source}\nshowLegend false`);
  const resolved = resolveGlyphChartSpec(spec), raw = resolveGlyphChartScales(resolved, spec.scales);
  const result = renderGlyphChart(spec, options), { plot, canvas } = result.build;
  const scales = fitGlyphRadarScales(spec, raw, plot, canvas.cellAspect);
  const expected = new Map<number, string>();
  // Independent closed-rectangle intersection oracle: no dense sampling or cell walker.
  const hits = (a: number[], b: number[], x: number, y: number) => {
    let lo = 0, hi = 1;
    for (const [axis, centre] of [x, y].entries()) {
      const d = b[axis]! - a[axis]!;
      if (d === 0) { if (a[axis]! < centre - .5 || a[axis]! > centre + .5) return false; }
      else { const t = [(centre - .5 - a[axis]!) / d, (centre + .5 - a[axis]!) / d].sort((a,b) => a-b); lo = Math.max(lo,t[0]!); hi = Math.min(hi,t[1]!); }
    }
    return lo <= hi;
  };
  resolved.filter(m => m.mark.type === "line" && m.mark.options?.name).forEach((series, i) => {
    const points = series.rows.map(row => [scaleToColExact(scales.x, plot, row.x), scaleToRowExact(scales.y, plot, row.y)]);
    for (let y = plot.y0; y <= plot.y1; y++) for (let x = plot.x0; x <= plot.x1; x++) {
      if (points.slice(1).some((b,j) => hits(points[j]!, b, x, y)) && !expected.has(y * canvas.cols + x)) expected.set(y * canvas.cols + x, glyphs[i % 4]!);
    }
  });
  expect(expected.size).toBeGreaterThan(50);
  for (const [index, glyph] of expected) expect(canvas.grid.char[index], `cell ${index % canvas.cols},${Math.floor(index / canvas.cols)}`).toBe(glyph);
  expect(canvas.grid.char.filter(g => glyphs.includes(g))).toHaveLength(expected.size);
});

it("keeps one blank cell from all ink around each complete caption at both requested chat sizes", () => {
  for (const [width, height] of [[72,24], [36,18]]) for (const curvesToUse of [curves.slice(0,1), curves]) {
    const result = renderGlyphChartMermaid(`radar\n${axes}\n${curvesToUse.join("\n")}\nmax 10`, { ...options, width, height });
    const rows = result.text.split("\n");
    for (const label of labels) {
      const y = rows.findIndex(r => r.includes(label));
      if (y < 0) {
        expect(result.report.ledger.some(e => e.code === "label-dropped" && e.detail?.text === label)).toBe(true);
        continue;
      }
      const x = rows[y]!.indexOf(label);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= label.length; dx++) {
        if (dy === 0 && dx >= 0 && dx < label.length) continue;
        expect(rows[y + dy]?.[x + dx] ?? " ", `${width} ${label} ${dx},${dy}`).toBe(" ");
      }
    }
    expect(labels.filter(l => result.text.includes(l)).length).toBeGreaterThanOrEqual(4);
  }
});
