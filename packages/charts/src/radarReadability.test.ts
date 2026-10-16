import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createGlyphCanvas, type GlyphCanvasLineOptions, type GlyphCanvasPoint } from "glyphcss";
import { glyphChartFromMermaid, renderGlyphChartMermaid } from "./mermaid";
import { glyphChartLine } from "./spec";
import { renderGlyphChart } from "./render";
import { layoutGlyphChart } from "./layout";
import { paintGlyphChart } from "./paint";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { SERIES_STYLES } from "./series";
import { goodSpecs } from "./reviewFixtures";
import type { GlyphChartLedgerEntry, GlyphChartSpec } from "./types";

const preset = JSON.parse(readFileSync(`${__dirname}/../../../website/src/features/mermaid/data/examples.json`, "utf8")).find((e: { type: string }) => e.type === "radar").source as string;
const modes = [
  { target: "chat", width: 72, height: 24, charset: "braille", color: "none" },
  { target: "web", width: 96, height: 32, charset: "braille", color: "none" },
  { target: "web", width: 72, height: 24, charset: "braille", color: "css" },
] as const;
const native = glyphChartLine(["A", "B", "C"].flatMap((series, i) => [0, 1, 2].map((x) => ({ x, y: i + x, series }))), { x: "x", y: "y", stroke: "series" });

function painted(spec: GlyphChartSpec, colorEnabled = false) {
  const marks = resolveGlyphChartSpec(spec), scales = resolveGlyphChartScales(marks, spec.scales);
  const ledger: GlyphChartLedgerEntry[] = [];
  const layout = layoutGlyphChart(spec, marks, scales, 72, 24, "auto", ledger, "braille");
  const canvas = createGlyphCanvas({ cols: 72, rows: 24, tier: "braille" });
  const calls: { a: GlyphCanvasPoint; b: GlyphCanvasPoint; options?: GlyphCanvasLineOptions }[] = [];
  paintGlyphChart({ ...canvas, line: (a, b, options) => { calls.push({ a, b, options }); canvas.line(a, b, options); } }, spec, marks, scales, layout, { colorEnabled }, ledger);
  return { calls, canvas, layout, ledger };
}

it("captures complete target renders and native hashes", () => {
  const destination = process.env.GLYPH_RADAR_CAPTURE;
  if (!destination) return;
  const records = modes.map((options) => ({ options, ...renderGlyphChartMermaid(preset, options) }));
  writeFileSync(destination, records.map(({ options, text, report }) => `=== ${options.target} ${options.width}x${options.height}/${options.color} ===\nSOURCE\n${preset}\nRENDER\n${text}\nLEDGER\n${JSON.stringify(report.ledger, null, 2)}\n`).join("\n") + `=== Native three-series channels.stroke ===\n${renderGlyphChart(native, modes[0]).text}\n`);
  writeFileSync(destination + ".json", JSON.stringify(records.map(({ options, text, html }) => ({ options, text, html })), null, 2));
  const hashes = Object.fromEntries(goodSpecs.flatMap((spec, i) => modes.map((options, j) => [`${i}:${j}`, createHash("sha256").update(JSON.stringify([renderGlyphChart(spec, options).text, renderGlyphChart(spec, options).html])).digest("hex")])));
  writeFileSync(destination + ".hashes.json", JSON.stringify(hashes, null, 2));
});

it("uses the native categorical line styles and identical legend samples", () => {
  const chart = glyphChartFromMermaid(preset), result = painted(chart);
  const guides = chart.marks.filter((m) => m.type === "line" && !m.options?.name);
  const guideSegments = guides.reduce((count, m) => count + m.data.length - 1, 0);
  const curves = result.calls.slice(guideSegments, guideSegments + 18);
  expect(curves.map((c) => c.options?.style)).toEqual(SERIES_STYLES.slice(0, 3).flatMap((style) => Array(6).fill(style)));
  const radarText = renderGlyphChartMermaid(preset, modes[0]).text;
  const nativeText = renderGlyphChart(native, modes[0]).text;
  for (const sample of ["⠠⠤⠤", "⠠⠄⠤", "⠠⠠⠠"]) {
    expect(nativeText).toContain(sample);
    expect(radarText).toContain(sample);
  }
  const colored = painted(chart, true).calls.slice(guideSegments, guideSegments + 18);
  expect(new Set(colored.map((c) => c.options?.style))).toEqual(new Set(["solid"]));
});

it("keeps a blank cell around every complete axis label without vertex letters", () => {
  for (const options of modes) {
    const result = renderGlyphChartMermaid(preset, options), rows = result.text.split("\n");
    for (const label of ["Speed", "Cost", "Quality", "Safety", "Scale", "Support"]) {
      const y = rows.findIndex((row) => row.includes(label)), x = rows[y]?.indexOf(label) ?? -1;
      expect(x, `${options.target}: ${label}`).toBeGreaterThanOrEqual(1);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= label.length; dx++) {
        if (dy === 0 && dx >= 0 && dx < label.length) continue;
        expect(rows[y + dy]?.[x + dx] ?? " ", `${options.target}: ${label} gap at ${dx},${dy}`).toBe(" ");
      }
    }
    expect(rows.slice(1, -1).join("\n")).not.toMatch(/[ABC](?![a-z])/);
    expect(result.report.ledger.filter((e) => /label-(?:dropped|abbreviated)/.test(e.code))).toEqual([]);
  }
  const spec = glyphChartFromMermaid(preset);
  expect(spec.marks.filter((m) => m.type === "text").flatMap((m) => m.data)).toHaveLength(6);
});

it("makes monochrome guides sparser than series through the existing dotted tier", () => {
  const chart = glyphChartFromMermaid(preset), result = painted(chart);
  expect(result.calls.slice(0, 18).every((c) => c.options?.style === "dotted")).toBe(true);
  expect(painted(chart, true).calls.slice(0, 18).every((c) => c.options?.style === "solid")).toBe(true);
  const noCurves = { ...chart, marks: chart.marks.filter((m) => !m.options?.name) };
  const mono = painted(noCurves).canvas.sub.reduce((sum, mask) => sum + mask.toString(2).replace(/0/g, "").length, 0);
  const color = painted(noCurves, true).canvas.sub.reduce((sum, mask) => sum + mask.toString(2).replace(/0/g, "").length, 0);
  expect(mono).toBeLessThan(color * 0.7);
});

it("keeps sampled circular guides dotted instead of restarting at each tiny segment", () => {
  const spec = glyphChartFromMermaid("radar\naxis North,East,South,West\ngraticule circle\nticks 2\nshowLegend false");
  const mono = painted(spec), colored = painted(spec, true);
  expect(colored.calls).toHaveLength(516);
  expect(mono.calls.length).toBeLessThan(colored.calls.length / 2);
  const dots = (canvas: typeof mono.canvas) => canvas.sub.reduce((sum, mask) => sum + mask.toString(2).replace(/0/g, "").length, 0);
  expect(dots(mono.canvas)).toBeLessThan(dots(colored.canvas) * 0.7);
  expect(mono.calls.every((call) => call.options?.style === "dotted")).toBe(true);
});
