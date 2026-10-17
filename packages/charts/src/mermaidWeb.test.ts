import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterAll, expect, it } from "vitest";
import { glyphChartFromMermaid as parseMermaid, renderGlyphChartMermaid as renderMermaid } from "./mermaid";
import { renderGlyphChart } from "./render";
import { createGlyphCanvas } from "glyphcss";
import { fitGlyphGanttTicks, glyphGanttTickGranularity } from "./gantt";
import { fitGlyphRadarScales } from "./radar";
import { layoutGlyphChart, scaleToColExact, scaleToRowExact } from "./layout";
import { paintGlyphChart } from "./paint";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { glyphChartBar } from "./spec";
import type { GlyphChartLedgerEntry } from "./types";
import type { GlyphCanvasLineOptions, GlyphCanvasPoint } from "glyphcss";
import { goodSpecs } from "./reviewFixtures";

const sources = new Set<string>();
const glyphChartFromMermaid: typeof parseMermaid = (source) => { sources.add(source); return parseMermaid(source); };
const renderGlyphChartMermaid: typeof renderMermaid = (source, options) => { sources.add(source); return renderMermaid(source, options); };
const examples = [
  { name: "gantt preset", source: "gantt\n dateFormat YYYY-MM-DD\n section Release\n Build :a, 2026-01-01, 2d\n Test :after a, 1d" },
  { name: "radar preset", source: "radar-beta\n axis speed[\"Speed\"], cost[\"Cost\"], quality[\"Quality\"]\n curve a[\"Plan\"] {4, 3, 5}\n max 5" },
  { name: "quadrantChart preset", source: "quadrantChart\n x-axis Effort --> Reach\n y-axis Cost --> Value\n Alpha: [0.25, 0.75]\n Beta: [0.75, 0.25]" },
  { name: "xychart preset", source: "xychart-beta\n x-axis [Jan, Feb, Mar]\n y-axis Sales 0 --> 10\n bar [3, 8, 5]" },
  { name: "radar polygon", source: "radar-beta\n axis North, East, South, West\n curve a[\"Plan\"] {4, 3, 5, 2}, b[\"Goal\"] {3, 4, 2, 5}\n max 5\n graticule polygon" },
];
const modes = [{ target: "chat", width: 72, height: 24 }, { target: "web", width: 96, height: 32 }, { target: "web", width: 72, height: 24 }] as const;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

afterAll(() => {
  const path = process.env.GLYPH_C_WEB_ARTIFACT;
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  const catalogue = [...examples, ...[...sources].filter((source) => !examples.some((e) => e.source === source)).map((source, i) => ({ name: `Regression example ${i + 1}`, source }))];
  const records = catalogue.flatMap((example) => modes.map((options) => {
    const result = renderGlyphChartMermaid(example.source, options);
    expect(result.text.split("\n")).toHaveLength(options.height);
    expect(result.text.split("\n").every((line) => [...line].length === options.width)).toBe(true);
    expect(result.report.unsupportedGlyphs).toEqual([]);
    return { ...example, ...options, text: result.text, html: result.html, hash: hash(result.text), ledger: result.report.ledger };
  }));
  writeFileSync(path, records.map((r) => `=== ${r.name} — ${r.target} ${r.width}x${r.height} ===\nSOURCE\n${r.source}\nRENDER\n${r.text}\nLedger: ${JSON.stringify(r.ledger)}\nSHA256: ${r.hash}\n`).join("\n"));
  writeFileSync(path.replace(/\.txt$/, ".json"), JSON.stringify(records, null, 2) + "\n");
  const font = readFileSync(`${__dirname}/../../../website/public/fonts/glyph-mono.woff2`).toString("base64");
  writeFileSync(path.replace(/\.txt$/, ".html"), `<!doctype html><meta charset="utf-8"><style>@font-face{font-family:GlyphMono;src:url(data:font/woff2;base64,${font})}body{background:#10131a;color:#e8eaf0;padding:20px}pre{font:16px/1 GlyphMono,monospace;white-space:pre}pre.chat{font-family:Menlo,monospace;line-height:1.2}</style>${records.map((r) => `<h2>${r.name} — ${r.target} ${r.width}x${r.height}</h2><pre class="${r.target}">${r.html ?? r.text}</pre>`).join("\n")}`);
  writeFileSync(path.replace(/\.txt$/, "-native-hashes.json"), JSON.stringify(Object.fromEntries(goodSpecs.flatMap((spec, i) => modes.map((options, j) => [`${i}:${j}`, hash(renderGlyphChart(spec, options).text)]))), null, 2) + "\n");
});

it("chooses whole-day Gantt candidates before formatting on both targets", () => {
  for (const options of modes) {
    for (const section of ["", "section Release\n"]) {
      const source = `gantt\ndateFormat YYYY-MM-DD\n${section}Build :a, 2026-01-01, 2d\nTest :after a, 1d`;
      const spec = glyphChartFromMermaid(source), marks = resolveGlyphChartSpec(spec);
      const scale = fitGlyphGanttTicks(spec, resolveGlyphChartScales(marks, spec.scales).x);
      const ticks = scale.ticks(16);
      expect(ticks.map((t) => (t.value as Date).getDate())).toEqual([1, 2, 3, 4]);
      expect(ticks.every((t) => (t.value as Date).getHours() === 0)).toBe(true);
      const result = renderGlyphChartMermaid(source, options);
      expect(result.report.ledger.filter((e) => /tick-duplicate-dropped|ticks-thinned/.test(e.code))).toEqual([]);
      expect(result.text).toContain("2026-01-01");
      expect(result.text).toContain("2026-01-04");
    }
  }
});

it("respects both format precisions, literal escapes, coarse calendars and sub-day units", () => {
  for (const [date, axis, expected] of [
    ["YYYY-MM-DD", "%H:%M", "day"], ["YYYY-MM-DD HH:mm", "%Y-%m-%d", "day"],
    ["YYYY-MM-DD HH:mm", "%H", "hour"], ["HH:mm:ss", "%H:%M", "minute"],
    ["HH:mm:ss.SSS", "%S.%L", "millisecond"], ["X", "%s", "second"],
    ["YYYY-MM", "%Y-%m-%d", "month"], ["YYYY-MM-DD", "%b", "month"],
    ["YYYY-MM-DD", "%Y", "year"], ["YYYY-MM-DD", "%q", "quarter"],
    ["YYYY-MM-DD", "%V", "week"], ["YYYY-MM-DD [HH:mm:ss]", "%%H %Y-%m-%d", "day"],
  ]) expect(glyphGanttTickGranularity(date!, axis!)).toBe(expected);
  for (const [format, start, duration, unit] of [
    ["%H", "2026-01-01 10:00:00", "3h", "hour"],
    ["%H:%M", "2026-01-01 10:00:00", "3m", "minute"],
    ["%H:%M:%S", "2026-01-01 10:00:00", "3s", "second"],
    ["%b", "2026-01-01 00:00:00", "3M", "month"],
    ["%Y", "2026-01-01 00:00:00", "3y", "year"],
  ]) {
    const source = `gantt\ndateFormat YYYY-MM-DD HH:mm:ss\naxisFormat ${format}\nBuild :${start}, ${duration}`;
    const spec = glyphChartFromMermaid(source), marks = resolveGlyphChartSpec(spec);
    const ticks = fitGlyphGanttTicks(spec, resolveGlyphChartScales(marks, spec.scales).x).ticks(16);
    expect(ticks.length).toBeGreaterThan(1);
    expect(new Set(ticks.map((t) => (spec.axes!.x!.format as (v: Date) => string)(t.value as Date))).size).toBe(ticks.length);
    for (const tick of ticks) {
      const d = tick.value as Date;
      expect(d.getMilliseconds()).toBe(0);
      if (unit !== "second") expect(d.getSeconds()).toBe(0);
      if (["hour", "month", "year"].includes(unit!)) expect(d.getMinutes()).toBe(0);
      if (["month", "year"].includes(unit!)) expect(d.getDate()).toBe(1);
    }
    expect(renderGlyphChartMermaid(source).report.ledger.some((e) => e.code === "tick-duplicate-dropped")).toBe(false);
  }
  const dst = glyphChartFromMermaid("gantt\nBuild :2026-03-28, 3d");
  const ticks = fitGlyphGanttTicks(dst, resolveGlyphChartScales(resolveGlyphChartSpec(dst), dst.scales).x).ticks(16);
  expect(ticks.map((t) => (t.value as Date).getHours())).toEqual([0, 0, 0, 0]);
  expect(+ticks[2]!.value - +ticks[1]!.value).toBe(23 * 3600000);
});

it("does not count hidden quadrant or band ticks as thinned labels", () => {
  for (const source of [examples[2]!.source, "quadrantChart\nP: [0.3,0.4]", "quadrantChart\nx-axis Low --> High\nP: [0.3,0.4]"]) {
    for (const options of modes) expect(renderGlyphChartMermaid(source, options).report.ledger.filter((e) => /tick-duplicate-dropped|ticks-thinned/.test(e.code))).toEqual([]);
  }
  const spec = { marks: [glyphChartBar([{ x: "A", y: 2 }, { x: "B", y: 3 }], { x: "x", y: "y" })], axes: { x: { ticks: 0 }, y: { ticks: 0 } } };
  const result = renderGlyphChart(spec, { target: "web" });
  expect(result.report.ledger.filter((e) => e.code === "ticks-thinned")).toEqual([]);
  expect(result.text).not.toMatch(/[AB]/);
});

it("keeps a visible native 2x2 dot at each quadrant point with and without color", () => {
  for (const options of modes) for (const color of ["none", "css"] as const) {
    const result = renderGlyphChartMermaid(examples[2]!.source, { ...options, color });
    if (options.target === "chat") { expect(result.text.match(/●/g)).toHaveLength(2); continue; }
    const { plot, canvas } = result.build;
    for (const [x, y] of [[0.25, 0.75], [0.75, 0.25]]) {
      const col = plot.x0 + x! * (plot.x1 - plot.x0), row = plot.y1 - y! * (plot.y1 - plot.y0);
      const cellCol = Math.floor(Math.round(2 * col + 0.5) / 2), cellRow = Math.floor(Math.round(4 * row + 1.5) / 4);
      const mask = canvas.sub[cellRow * canvas.cols + cellCol]!;
      expect(mask.toString(2).replace(/0/g, "")).toHaveLength(4);
    }
  }
});

function radarPaint(source: string, width = 96, height = 32, cellAspect = 0.5859375, colorEnabled = true) {
  const spec = glyphChartFromMermaid(source), marks = resolveGlyphChartSpec(spec);
  const scales = resolveGlyphChartScales(marks, spec.scales), ledger: GlyphChartLedgerEntry[] = [];
  const layout = layoutGlyphChart(spec, marks, scales, width, height, "auto", ledger, "braille");
  const canvas = createGlyphCanvas({ cols: width, rows: height, tier: "braille", cellAspect });
  const calls: { a: GlyphCanvasPoint; b: GlyphCanvasPoint; options?: GlyphCanvasLineOptions }[] = [];
  paintGlyphChart({ ...canvas, line: (a, b, options) => { calls.push({ a, b, options }); canvas.line(a, b, options); } }, spec, marks, scales, layout, { colorEnabled }, ledger);
  return { calls, canvas, layout, scales: fitGlyphRadarScales(spec, scales, layout.plot, cellAspect), ledger };
}

it("fits circles and regular polygon vertices to one physical radial metric", () => {
  for (const [width, height, aspect] of [[96, 32, 0.5859375], [72, 24, 0.5], [40, 50, 0.8]]) {
    const { scales, layout } = radarPaint("radar\naxis N,E,S,W\ngraticule polygon", width, height, aspect);
    const p = layout.plot;
    const dx = (scaleToColExact(scales.x, p, 1) - scaleToColExact(scales.x, p, 0)) * aspect!;
    const dy = scaleToRowExact(scales.y, p, 0) - scaleToRowExact(scales.y, p, 1);
    expect(dx).toBeCloseTo(dy, 10);
    expect(dx).toBeGreaterThan(0);
  }
});

it("draws every spoke at its actual sub-cell position, including diagonal axes", () => {
  const { calls, canvas, scales, layout } = radarPaint("radar\naxis N,NE,SE,S,SW,NW\nticks 0\nshowLegend false");
  expect(calls).toHaveLength(6);
  for (let i = 0; i < 6; i++) {
    const angle = i * Math.PI / 3, point = calls[i]!;
    expect(point.a.x).toBeCloseTo(scaleToColExact(scales.x, layout.plot, 0), 10);
    expect(point.b.x).toBeCloseTo(scaleToColExact(scales.x, layout.plot, Math.sin(angle)), 10);
    expect(point.b.y).toBeCloseTo(scaleToRowExact(scales.y, layout.plot, Math.cos(angle)), 10);
    const x = Math.floor((point.a.x + point.b.x) / 2), y = Math.floor((point.a.y + point.b.y) / 2);
    expect([-1, 0, 1].some((oy) => [-1, 0, 1].some((ox) => canvas.sub[(y + oy) * canvas.cols + x + ox]! > 0))).toBe(true);
  }
});

it("samples inner circular rings densely on the dot lattice without cell-sized stairs", () => {
  const { calls } = radarPaint("radar\naxis N,E,S,W\nticks 5\nshowLegend false");
  const ring = calls.slice(0, 256);
  expect(ring).toHaveLength(256);
  expect(Math.max(...ring.map(({ a, b }) => Math.hypot(2 * (a.x - b.x), 4 * (a.y - b.y))))).toBeLessThan(1);
  expect(ring.some(({ a }) => a.x !== Math.round(a.x) && a.y !== Math.round(a.y))).toBe(true);
});

it("uses native series styles for monochrome radar and solid lines with color", () => {
  const source = "radar\naxis N,E,S,W\nticks 0\ncurve a{4,3,5,2}, b{3,4,2,5}, c{2,5,4,3}, d{5,2,3,4}\nmax 5";
  for (const colorEnabled of [true, false]) {
    const { calls, canvas } = radarPaint(source, 96, 32, 0.5859375, colorEnabled);
    expect(calls.slice(4).length).toBeGreaterThanOrEqual(16);
    expect(new Set(calls.slice(4, 20).map((c) => c.options?.style))).toEqual(new Set(colorEnabled ? ["solid"] : ["solid", "dashed", "dotted", "double"]));
    expect(canvas.report.ledger.some((message) => message.includes("double"))).toBe(!colorEnabled);
  }
});
