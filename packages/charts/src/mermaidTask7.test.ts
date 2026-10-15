import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { glyphChartFromMermaid, renderGlyphChartMermaid, glyphChartBar, glyphChartLine, glyphChartTreemap, glyphChartJsonSchema, renderGlyphChart } from "./index";
import { resolveGlyphChartSpec } from "./resolve";
import { squarify } from "./treemap";

export const task7Examples = [
  { name: "Gantt dependencies, exclusions, tags, milestone and vertical markers", source: `gantt
  title Release plan
  dateFormat YYYY-MM-DD
  axisFormat %b %d
  tickInterval 2day
  excludes weekends
  excludes 2025-01-08
  todayMarker off
  section Prepare
  Design :done, d, 2025-01-02, 2d
  Build :crit, active, b, after d, 3d
  section Ship
  Check :c, after d b, until launch
  Launch :milestone, launch, 2025-01-15, 0d
  vert Review : 2025-01-09` },
  { name: "Gantt custom dates, sequential durations and Friday weekends", source: `gantt
  title Working calendar
  dateFormat DD/MM/YYYY HH:mm
  axisFormat %d %b
  weekend friday
  excludes weekends, monday
  section Work
  Start :a, 02/01/2025 09:00, 4h
  Continue :2d
  End :until gate
  Gate :milestone, gate, 10/01/2025 09:00, 0d
  Deadline :vert, 10/01/2025 09:00` },
  { name: "Radar positional and keyed curves, labels, polygon ticks and legend", source: `radar-beta
  title Team skills
  axis code["Code"], docs["Docs"], tests["Tests"]
  axis design["Design"], ops["Ops"]
  curve a["Team A"]{8, 6, 9, 7, 5}, b["Team B"]{ops:8, design:6, tests:7, docs:9, code:6}
  min 0
  max 10
  ticks 3
  graticule polygon
  showLegend true` },
  { name: "Radar circle, inferred maximum and hidden legend", source: `radar
  title Product profile
  axis Speed, Quality, Price, Support
  curve current["Current"]{3, 5, 4, 2}
  graticule circle
  ticks 2
  showLegend false` },
  { name: "Treemap nested hierarchy, tabs, sections and inert classes", source: `---
title: Portfolio
config:
  theme: forest
---
treemap-beta
"Products"
    "Hardware"
        "Phones": 50
        "Laptops": 30
    "Software":::featured
        "Apps": 40
        "Services": 20
"Research"
\t"Labs": 30
\t"Trials": 10:::featured
classDef featured fill:red,color:blue;` },
  { name: "Treemap repeated labels, zero and negative values", source: `treemap
  title Budget
"North"
  "Staff": 60
  "Tools": 20
"South"
  "Staff": 40
  "Tools": 10
  "Empty": 0
  "Deficit": -2` },
  { name: "Horizontal XY bars and lines", source: `xychart horizontal
  title Regional sales
  x-axis Region [East, West, North]
  y-axis Units -5 --> 20
  bar "Sales" [10,18,14]
  line "Goal" [12,16,16]` },
  { name: "Quadrant endpoint labels without numeric ticks", source: `quadrantChart
  title Priorities
  x-axis Low reach --> High reach
  y-axis Low impact --> High impact
  quadrant-1 Invest
  quadrant-2 Explore
  quadrant-3 Hold
  quadrant-4 Refine
  Alpha: [0.75, 0.7]
  Beta: [0.25, 0.3]` },
];
const channels = { x: "x", y: "y" } as const;
const options = { width: 72, height: 24 } as const;
const observed = new Map(task7Examples.map((e) => [e.source, e.name]));
const parse = (source: string) => { if (!observed.has(source)) observed.set(source, `Syntax case ${observed.size + 1}`); return glyphChartFromMermaid(source); };
const data = (source: string) => parse(source).marks.flatMap((m) => m.data) as Record<string, unknown>[];
const bars = (source: string) => parse(source).marks.filter((m) => m.type === "bar").flatMap((m) => m.data) as { x0: Date; x: Date; y: string }[];
const local = (s: string) => new Date(s).getTime();

describe("Task 7 Mermaid syntax and native marks", () => {
  it.each(task7Examples)("renders $name with both target defaults", ({ source }) => {
    for (const target of ["chat", "web"] as const) {
      const result = renderGlyphChartMermaid(source, { ...options, target });
      expect(result.build.resolved.charset).toBe(target === "chat" ? "box" : "braille");
      expect(result.text.split("\n")).toHaveLength(24);
      expect(result.text.split("\n").every((s) => [...s].length === 72)).toBe(true);
      expect(result.text.trim()).not.toBe("");
      expect(result.report.unsupportedGlyphs).toEqual([]);
      expect(result.build.report.ledger).toEqual(result.report.ledger);
      if (target === "web") expect(result.html).toContain("<");
    }
  });
  it.each([
    'pie\n"A": 1', 'xychart\nbar [1,2]', 'sankey\nA,B,2',
    'quadrantChart\nA: [0.2,0.3]', 'gantt\nA :2025-01-01, 1d',
    'radar\naxis A,B,C\ncurve c{1,2,3}', 'treemap\n"Root"\n  "Leaf": 1',
  ].flatMap((source) => [
    { name: "plain comments", comment: '  %% Note: holiday' },
    { name: "unbalanced comment quotes", comment: '  %% Note: "unfinished' },
    { name: "initialization directives", comment: '  %%{init: {"theme": "dark"}}%%' },
  ].map((c) => ({ source, ...c }))))("strips $name before label protection: $source", ({ source, comment }) => {
    const baseline = parse(source);
    const at = source.indexOf("\n"), withComment = `${source.slice(0, at)}\n${comment}${source.slice(at)}`;
    const parsed = parse(withComment);
    expect(parsed.marks).toEqual(baseline.marks);
    expect(parsed.scales).toEqual(baseline.scales);
    expect(parsed.ledger.filter((e) => !(e.code === "mermaid-degraded" && e.message.startsWith("Kept ")))).toEqual(baseline.ledger);
    expect(parsed.ledger.filter((e) => e.code === "mermaid-degraded" && e.message.startsWith("Kept "))).toHaveLength(comment.includes("init:") ? 1 : 0);
    for (const target of ["chat", "web"] as const) expect(renderGlyphChartMermaid(withComment, { ...options, target }).text).toBe(renderGlyphChartMermaid(source, { ...options, target }).text);
  });
  it("uses grouped horizontal bars for whole-cell radar, preserving every axis and series", () => {
    const source = task7Examples[2]!.source;
    for (const charset of ["ascii", "box"] as const) {
      const result = renderGlyphChartMermaid(source, { ...options, charset, color: "none" });
      expect(result.build.meta.series).toHaveLength(2);
      expect(result.text).toContain("A: Team A"); expect(result.text).toContain("B: Team B");
      for (const axis of ["Code", "Docs", "Tests", "Design", "Ops"]) expect(result.text).toContain(axis);
      expect(result.text).not.toMatch(/[\\/‾]/);
      const barRows = result.text.split("\n").slice(1, -3).filter((row) => /[█░#.]/.test(row));
      expect(barRows).toHaveLength(10);
      expect(barRows.every((row) => !(row.includes("█") && row.includes("░")) && !(row.includes("#") && row.includes(".")))).toBe(true);
      expect(result.report.ledger.some((e) => e.detail?.feature === "radar whole-cell curves")).toBe(true);
      expect(result.report.ledger.filter((e) => /label-(?:dropped|abbreviated)/.test(e.code))).toEqual([]);
    }
  });
  it("keeps radar axes with repeated display labels in separate summary bands", () => {
    const source = 'radar\naxis a["Shared"], b["Shared"], c["Other"]\ncurve x{2,4,6}, y{3,5,7}';
    parse(source);
    const result = renderGlyphChartMermaid(source, { ...options, target: "chat" });
    const rows = result.text.split("\n");
    expect(rows.filter((row) => row.includes("Shared"))).toHaveLength(2);
    expect(result.text).toContain("Shared (a)"); expect(result.text).toContain("Shared (b)");
    expect(result.report.ledger.some((e) => e.detail?.feature === "radar repeated axis labels")).toBe(true);
    expect(rows.slice(1, -3).filter((row) => /[█░]/.test(row))).toHaveLength(6);
    expect(result.report.ledger.filter((e) => /label-(?:dropped|abbreviated)/.test(e.code))).toEqual([]);
  });
  it("aligns every horizontal group label with its first bar and separates all groups by one blank row", () => {
    const sources = [task7Examples[2]!.source, 'xychart horizontal\nx-axis [Code, Docs, Tests, Design, Ops]\nbar [8,6,9,7,5]'];
    for (const source of sources) {
      parse(source);
      for (const height of [19, 24]) for (const charset of ["ascii", "box"] as const) {
        const result = renderGlyphChartMermaid(source, { width: 72, height, target: "chat", charset });
        const lines = result.text.split("\n"), glyphs = charset === "ascii" ? ["#", "."] : ["█", "░"];
        const labels = source.startsWith("radar") ? ["Code", "Docs", "Tests", "Design", "Ops"] : ["Ops", "Design", "Tests", "Docs", "Code"];
        const groupSize = source.startsWith("radar") ? 2 : 1;
        const firstRows = labels.map((label) => lines.findIndex((line) => line.includes(label)));
        firstRows.forEach((row, index) => {
          expect(row).toBeGreaterThanOrEqual(0);
          for (let series = 0; series < groupSize; series++) expect(lines[row + series]!.slice(result.build.plot.x0)).toContain(glyphs[series]);
          if (index > 0) {
            expect(row - firstRows[index - 1]!).toBe(groupSize + 1);
            expect(lines[row - 1]!.slice(result.build.plot.x0).trim()).toBe("");
          }
        });
      }
    }
    const mark = glyphChartBar(["Code", "Docs", "Tests", "Design", "Ops"].flatMap((y) => [
      { x: 8, y, series: "First" }, { x: 6, y, series: "Second" },
    ]), { x: "x", y: "y", fill: "series" }, { orientation: "horizontal" });
    for (const target of ["chat", "web"] as const) {
      const result = renderGlyphChart(mark, { ...options, target }), lines = result.text.split("\n");
      const firstRows = ["Ops", "Design", "Tests", "Docs", "Code"].map((label) => lines.findIndex((line) => line.includes(label)));
      firstRows.forEach((row, index) => {
        expect(lines[row]!.slice(result.build.plot.x0)).toContain("█");
        expect(lines[row + 1]!.slice(result.build.plot.x0)).toContain("░");
        if (index > 0) { expect(row - firstRows[index - 1]!).toBe(3); expect(lines[row - 1]!.slice(result.build.plot.x0).trim()).toBe(""); }
      });
    }
  });
  it("keeps a blank cell between treemap borders and complete labels", () => {
    for (const target of ["chat", "web"] as const) {
      const result = renderGlyphChartMermaid(task7Examples[4]!.source, { ...options, target });
      const lines = result.text.split("\n");
      for (const label of ["Products", "Hardware", "Software", "Research", "Phones", "Laptops", "Apps", "Labs", "Trials"]) {
        const line = lines.find((row) => row.includes(label));
        expect(line, label).toBeDefined();
        const start = line!.indexOf(label);
        expect(line![start - 1], label).toBe(" ");
        expect(line![start - 2], label).toBe("│");
      }
      expect(result.text).not.toMatch(/│[A-Za-z]/);
      expect(result.text).not.toMatch(/[A-Za-z0-9]│/);
    }
    const narrow = renderGlyphChart(glyphChartTreemap([{ id: "one", label: "Leaf", value: 1 }]), { width: 8, height: 8, target: "chat" });
    expect(narrow.text).toContain("│ Leaf │"); expect(narrow.text).toContain("│ 1    │");
    expect(narrow.report.ledger.filter((entry) => entry.code === "treemap-omitted")).toEqual([]);
    const snug = renderGlyphChart(glyphChartTreemap([{ id: "one", label: "Leaf", value: 1 }]), { width: 9, height: 8, target: "chat" });
    expect(snug.text).toContain("│ Leaf  │"); expect(snug.text).toContain("│ 1     │");
  });
  it("aligns categorical XY line overlays with the horizontal bar and label rows", () => {
    const source = 'xychart horizontal\nx-axis [East, West, North]\ny-axis 0 --> 10\nbar [4,5,6]\nline [8,9,10]';
    parse(source);
    for (const target of ["chat", "web"] as const) {
      const result = renderGlyphChartMermaid(source, { ...options, target }), lines = result.text.split("\n");
      for (const [index, label] of ["East", "West", "North"].entries()) {
        const row = lines.findIndex((line) => line.includes(label));
        expect(lines[row]!.slice(result.build.plot.x0)).toContain("█");
        const col = result.build.plot.x0 + Math.round((8 + index) / 10 * (result.build.plot.x1 - result.build.plot.x0));
        const endpoint = lines[row]![col]!;
        if (target === "chat") expect(endpoint).toMatch(/[_/‾▔-]/);
        else expect(endpoint).toMatch(/[\u2801-\u28ff]/);
      }
    }
  });
  it("keeps braille radar polygons identifiable without color and omits colliding interior ticks", () => {
    const source = task7Examples[2]!.source;
    const result = renderGlyphChartMermaid(source, { ...options, target: "web", color: "none" });
    expect(result.text).not.toMatch(/3\.33|6\.67/);
    const chart = parse(source), labels = chart.marks.filter((m) => m.type === "text").flatMap((m) => m.data) as { label: string }[];
    expect(labels.filter((d) => d.label === "A")).toHaveLength(5);
    expect(labels.filter((d) => d.label === "B")).toHaveLength(5);
    const plotRows = result.text.split("\n").slice(1, -1).join("\n");
    expect(plotRows.match(/A/g)).toHaveLength(5); expect(plotRows.match(/B/g)).toHaveLength(5);
    expect(result.report.ledger.some((e) => e.detail?.feature === "radar tick labels")).toBe(true);
    expect(result.report.ledger.filter((e) => /label-(?:dropped|abbreviated)/.test(e.code))).toEqual([]);
    const coincident = parse('radar\naxis X,Y,Z\ncurve a{1,2,3},b{1,2,3}');
    expect(coincident.marks.filter((m) => m.type === "text").flatMap((m) => m.data).filter((d) => (d as { label: string }).label === "A/B")).toHaveLength(3);
  });
  it("logs inert treemap value configuration explicitly", () => {
    const source = '---\nconfig:\n  treemap:\n    showValues: false\n    valueFormat: "$,.2f"\n---\ntreemap\n"Leaf": 1234';
    const chart = parse(source);
    expect(chart.ledger.map((e) => e.detail?.feature)).toContain("treemap.showValues");
    expect(chart.ledger.map((e) => e.detail?.feature)).toContain("treemap.valueFormat");
    expect(renderGlyphChartMermaid(source, { ...options, target: "chat" }).text).toContain("Leaf 1.234k");
  });
  it("shares treemap sibling borders with proper junctions and no accumulating inset", () => {
    const source = 'treemap\n"Root"\n  "Branch"\n    "Nested"\n      "First leaf": 4\n      "Second leaf": 4\n    "Third leaf": 4\n  "Last leaf": 4';
    parse(source);
    for (const target of ["chat", "web"] as const) {
      const result = renderGlyphChartMermaid(source, { ...options, target });
      expect(result.text).not.toMatch(/││|┐┌|┘└/);
      for (const word of ["Root", "Branch", "Nested", "First leaf", "Second leaf", "Third leaf", "Last leaf"]) expect(result.text).toContain(word);
      expect(result.text).toMatch(/[├┤┬┴┼]/);
      expect(result.report.ledger.filter((e) => e.code === "treemap-omitted")).toEqual([]);
    }
    const flat = glyphChartTreemap([1,2,3,4].map((i) => ({ id: String(i), value: 1, label: String(i) })));
    const result = renderGlyphChart(flat, { width: 25, height: 13, target: "chat" });
    expect(result.text).toContain("┼"); expect(result.text).toContain("┬"); expect(result.text).toContain("┴");
    expect(result.text).not.toContain("││");
  });
  it("honors exclusions, multiple after dependencies, until, explicit ids, milestones and markers", () => {
    const source = task7Examples[0]!.source, chart = parse(source), b = bars(source);
    expect(chart.title).toBe("Release plan");
    expect(b[0]!.x0.getTime()).toBe(local("2025-01-02T00:00:00"));
    expect(b[0]!.x.getTime()).toBe(local("2025-01-06T00:00:00"));
    expect(b[1]!.x0.getTime()).toBe(b[0]!.x.getTime());
    expect(b[1]!.x.getTime()).toBe(local("2025-01-10T00:00:00"));
    expect(b[2]!.x0.getTime()).toBe(b[1]!.x.getTime());
    expect(b[2]!.x.getTime()).toBe(local("2025-01-15T00:00:00"));
    expect(chart.marks.find((m) => m.type === "dot")?.data).toMatchObject([{ x: new Date("2025-01-15T00:00:00") }]);
    expect(chart.marks.find((m) => m.type === "rule")?.data).toEqual([{ x: new Date("2025-01-09T00:00:00") }]);
    expect(b[1]!.y).toContain("crit,active");
    expect(b[0]!.y).toContain("Prepare");
    const serializedRule = resolveGlyphChartSpec(JSON.parse(JSON.stringify(chart))).find((m) => m.mark.type === "rule");
    expect(serializedRule?.ruleValues).toEqual([new Date("2025-01-09T00:00:00")]);
    expect(chart.axes?.x?.format).toBeTypeOf("function");
    expect(chart.axes?.x?.ticks).toBeGreaterThan(1);
    expect(chart.ledger.some((e) => e.detail?.feature === "todayMarker")).toBe(true);
  });
  it.each(["500ms", "30s", "30m", "4h", "1.5d", "2w", "1M", "1y"])("resolves duration %s from a custom epoch date", (duration) => {
    const row = bars(`gantt\ndateFormat x\nTask :a, 1735689600000, ${duration}`)[0]!;
    const expected = { "500ms": 500, "30s": 30000, "30m": 1800000, "4h": 14400000, "1.5d": 1.5 * 86400000, "2w": 14 * 86400000, "1M": 31 * 86400000, "1y": 365 * 86400000 }[duration];
    expect(row.x.getTime() - row.x0.getTime()).toBe(expected);
  });
  it.each([
    ["YYYY-MM-DD", "2025-01-02"], ["YY-Q-DD", "25-1-02"], ["D MMMM YYYY", "2 January 2025"],
    ["Do MMM YYYY", "2nd Jan 2025"], ["YYYY-DDD", "2025-2"], ["YYYY-DDDD", "2025-002"],
    ["X", "1735776000"], ["x", "1735776000000"], ["DD-MM-YYYY HH:mm:ss.SSS", "02-01-2025 13:04:05.123"],
    ["YYYY-MM-DD h:mm A", "2025-01-02 1:04 PM"], ["YYYY-MM-DDTHH:mm:ssZ", "2025-01-02T13:04:05+02:00"],
    ["YYYY-MM-DDTHH:mm:ssZZ", "2025-01-02T13:04:05+0200"], ["YYYY-MM-DD [at] H:m:s.S", "2025-01-02 at 1:4:5.1"],
  ])("reads documented date tokens %s", (format, date) => {
    const chart = parse(`gantt\ndateFormat ${format}\nTask :a, ${date}, 1h`);
    const row = chart.marks[0]!.data[0] as { x0: Date; x: Date };
    expect(row.x.getTime() - row.x0.getTime()).toBe(3600000);
    expect(row.x0.getTime()).toBeGreaterThan(local("2025-01-01"));
    expect(chart.ledger.filter((e) => String(e.detail?.feature).includes("unrecognized"))).toEqual([]);
  });
  it("handles sequential implicit start and each dependency form", () => {
    const source = `gantt\ndateFormat YYYY-MM-DD\nA :a, 2025-01-01, 2025-01-03\nB :b, after a, 1d\nC :2025-01-06\nD :d, 1d\nE :after d, until gate\nGate :milestone, gate, 2025-01-10, 0d`;
    const b = bars(source);
    expect(b.map((d) => d.x.getDate())).toEqual([3,4,6,7,10]);
    expect(b.map((d) => d.x0.getDate())).toEqual([1,3,4,6,7]);
  });
  it("applies weekday, repeated date exclusions, Friday weekends and an offset milestone", () => {
    const b = bars(task7Examples[1]!.source);
    expect(b[1]!.x0).toEqual(b[0]!.x);
    expect(b[1]!.x.getDate()).toBe(7);
    expect((data('gantt\nM :milestone, 2025-01-01, 2d')[0]!.x as Date).getDate()).toBe(2);
    expect(bars('gantt\nexcludes 2025-01-02\nexcludes friday\nT :2025-01-01, 2d')[0]!.x.getDate()).toBe(5);
  });
  it("matches radar axes and curves in positional and keyed forms", () => {
    const chart = parse(task7Examples[2]!.source), curves = chart.marks.filter((m) => m.options?.name);
    expect(curves.map((m) => m.options?.name)).toEqual(["A: Team A", "B: Team B"]);
    expect(curves[0]!.data).toHaveLength(6);
    expect(curves[0]!.data[0]).toEqual({ x: 0, y: 0.8 });
    expect(curves[1]!.data[0]).toEqual({ x: 0, y: 0.6 });
    expect(curves[1]!.data[4]).toEqual(expect.objectContaining({ y: expect.closeTo(Math.cos(8 * Math.PI / 5) * 0.8) }));
    expect(chart.marks.filter((m) => m.type === "text").flatMap((m) => m.data)).toContainEqual({ x: 0, y: 1.18, label: "Code" });
    expect(chart.legend).toBe(true);
    expect(chart.marks.filter((m) => m.type === "line" && m.data.length === 6 && !m.options?.name)).toHaveLength(3);
    const circle = parse(task7Examples[3]!.source);
    expect(circle.legend).toBe(false);
    expect(circle.marks.filter((m) => m.type === "line" && m.data.length === 65)).toHaveLength(2);
    expect(circle.marks.find((m) => m.options?.name)?.data[1]).toEqual({ x: 1, y: expect.closeTo(0) });
    const range = parse('radar\naxis A,B,C\ncurve c{2,4,6}\nmin 2\nmax 6\nticks 0');
    expect(range.marks.find((m) => m.options?.name)?.data[0]).toEqual({ x: 0, y: 0 });
  });
  it("retains treemap indentation, repeated labels, values and inert styling", () => {
    const chart = parse(task7Examples[4]!.source), rows = chart.marks[0]!.data as Record<string, unknown>[];
    expect(chart.title).toBe("Portfolio");
    expect(rows.map((d) => d.parent)).toEqual(["", "0", "1", "1", "0", "4", "4", "", "7", "7"]);
    expect(rows.find((d) => d.label === "Phones")?.value).toBe(50);
    expect(chart.ledger.filter((e) => e.code === "mermaid-degraded" && e.message.startsWith("Kept "))).toHaveLength(4);
    expect(parse(task7Examples[5]!.source).marks[0]!.data).toHaveLength(8);
  });
  it("squarifies by value with exact area, no overlaps and a real nested rectangle painter", () => {
    const tiles = squarify([{ value: 6 }, { value: 3 }, { value: 1 }], 10, 10);
    tiles.forEach((t, i) => expect(t.w * t.h).toBeCloseTo([60,30,10][i]!, 12));
    for (const a of tiles) for (const b of tiles) if (a.index !== b.index) expect(a.x >= b.x + b.w - 1e-9 || b.x >= a.x + a.w - 1e-9 || a.y >= b.y + b.h - 1e-9 || b.y >= a.y + a.h - 1e-9).toBe(true);
    const mark = glyphChartTreemap([{ id: "r", label: "Root" }, { id: "a", parent: "r", value: 6, label: "A" }, { id: "b", parent: "r", value: 3, label: "B" }]);
    const render = renderGlyphChart(mark, { ...options, target: "chat" });
    expect(render.text).toContain("Root"); expect(render.text).toContain("A 6"); expect(render.text).toContain("B 3");
    expect(render.text).toContain("┌");
    expect(() => renderGlyphChart(glyphChartTreemap([{ id: "a", parent: "a", value: 1 }]))).toThrow(expect.objectContaining({ code: "treemap-hierarchy" }));
  });
  it("paints horizontal positive/negative bars, interval bars and keeps explicit vertical output identical", () => {
    const base = glyphChartBar([2, 4, -3]);
    const opts = { ...options, target: "chat" as const };
    expect(renderGlyphChart(base, opts).text).toBe(renderGlyphChart({ ...base, options: { orientation: "vertical" } }, opts).text);
    const h = glyphChartBar([{ x: 4, y: "A" }, { x: -3, y: "B" }], channels, { orientation: "horizontal" });
    const result = renderGlyphChart(h, opts);
    expect(result.text.split("\n").some((s) => s.includes("████"))).toBe(true);
    expect(resolveGlyphChartSpec(glyphChartFromMermaid(task7Examples[6]!.source)).filter((m) => m.mark.type === "bar")[0]!.rows[1]).toMatchObject({ x: 18, y: "West" });
    expect(renderGlyphChartMermaid(task7Examples[6]!.source, opts).text).toContain("Sales");
    const interval = glyphChartBar([{ x0: 2, x: 4, y: "Task" }], { x0: "x0", x: "x", y: "y" }, { orientation: "horizontal" });
    expect(() => renderGlyphChart({ marks: [interval], scales: { x: { domain: [2,4] } } }, opts)).not.toThrow();
  });
  it("keeps a blank cell before legend labels in all charsets and placements", () => {
    for (const charset of ["ascii", "box", "blocks", "braille"] as const) for (const placement of ["bottom", "top-left", "top-right", "bottom-left", "bottom-right", "title"] as const) {
      const result = renderGlyphChart({ marks: [glyphChartLine([1,2], undefined, { name: "Goal" })], title: "Legend", legend: { placement } }, { ...options, charset });
      const row = result.text.split("\n").find((s) => s.includes("Goal"))!;
      expect(row[row.indexOf("Goal") - 1], `${charset}/${placement}`).toBe(" ");
    }
  });
  it("reserves the complete line swatch and separator at the left edge", () => {
    for (const charset of ["ascii", "box", "blocks", "braille"] as const) {
      const result = renderGlyphChart(glyphChartLine([1,2], undefined, { name: "Revenue" }), { width: 12, height: 14, charset, color: "none" });
      const row = result.text.split("\n").find((s) => s.includes("Revenue"))!;
      const start = row.indexOf("Revenue");
      expect(start).toBeGreaterThanOrEqual(4);
      expect(row[start - 1]).toBe(" ");
      expect(row.slice(start - 4, start - 1).trim()).not.toBe("");
    }
  });
  it("places quadrant low/high labels at endpoints and hides numeric ticks", () => {
    const result = renderGlyphChartMermaid(task7Examples[7]!.source, { ...options, target: "chat" });
    expect(result.text).toContain("Low reach"); expect(result.text).toContain("High reach");
    expect(result.text).toContain("Low impact"); expect(result.text).toContain("High impact");
    const lines = result.text.split("\n");
    expect(lines.findIndex((s) => s.includes("High impact"))).toBeLessThan(lines.findIndex((s) => s.includes("Low impact")));
    expect(result.text).not.toMatch(/\b[01]\b/);
  });
  it("keeps newly valid JSON options in parity with Ajv", () => {
    const validate = new Ajv2020({ strict: false }).compile(glyphChartJsonSchema());
    for (const source of task7Examples) { const chart = parse(source.source); const json = JSON.parse(JSON.stringify(chart)); expect(validate(json), JSON.stringify(validate.errors)).toBe(true); }
    const bad = { marks: [glyphChartBar([{ x: 1, y: "A" }], channels, { orientation: "horizontal" })], scales: { x: { domain: [1,2] } } };
    expect(validate(bad)).toBe(false); expect(() => renderGlyphChart(bad)).toThrow(expect.objectContaining({ code: "bar-domain-excludes-zero" }));
  });
  it("resolves until to the earliest start and schedules vertical-marker dependencies without a lane", () => {
    const source = `gantt
 dateFormat HH:mm
 axisFormat %H:%M
 Initial vert :vert, v1, 17:30, 2m
 Task A :a, 3m
 Task B :b, after a, until v2 c
 Final vert :vert, v2, 17:58, 4m
 C :c, 17:50, 1m`;
    const chart = parse(source), b = bars(source);
    expect(b).toHaveLength(3);
    expect(b[0]!.x0.getHours()).toBe(17); expect(b[0]!.x0.getMinutes()).toBe(32);
    expect(b[1]!.x.getMinutes()).toBe(50);
    expect(chart.marks.filter((m) => m.type === "rule")).toHaveLength(2);
    expect(chart.scales?.y?.domain).toHaveLength(3);
    const preEpoch = bars('gantt\nA :a, 1960-01-01, 1d\nB :b, after a, 1d');
    expect(preEpoch[1]!.x0.getFullYear()).toBe(1960);
  });
  it("keeps free Gantt labels, radar punctuation and multiline curves intact", () => {
    const g = parse(`gantt
 title Release: [alpha; unmatched "
 section Working [set
 Bob's "draft :a, 2025-01-01, 1d`);
    expect(g.title).toBe('Release: [alpha; unmatched "');
    expect((g.marks[0]!.data[0] as { y: string }).y).toContain('Bob\'s "draft');
    const radar = parse(`radar
axis A["A, {braces}"], B, C
curve c["Curly {label}"]{
  A: 2, B: 3, C: 4
}
showLegend false`);
    expect(radar.marks.find((m) => m.options?.name)?.options?.name).toBe("A: Curly {label}");
    expect(radar.marks.find((m) => m.type === "text")?.data).toContainEqual(expect.objectContaining({ label: "A, {braces}" }));
    expect(parse('treemap\naccTitle: Accessible tree\naccDescr {Two levels}\n"Root"\n  "Leaf": 1').description).toBe("Accessible tree\nTwo levels");
  });
  it("handles includes, inclusive dates, month-end clamping, DST and inert layout directives", () => {
    expect(bars('gantt\nexcludes weekends\nincludes 2025-01-04\nA :2025-01-03, 1d')[0]!.x.getDate()).toBe(4);
    expect(bars('gantt\ninclusiveEndDates\nA :2025-01-01, 2025-01-02')[0]!.x.getDate()).toBe(3);
    expect(bars('gantt\nA :2025-01-31, 1M')[0]!.x.getDate()).toBe(28);
    const dst = bars('gantt\nA :2025-03-29, 2d')[0]!;
    expect(dst.x.getHours()).toBe(0); expect(dst.x.getDate()).toBe(31);
    expect(dst.x.getTime() - dst.x0.getTime()).toBe(47 * 3600000);
    const inert = parse('gantt\ntopAxis\ndisplayMode compact\nweekday monday\ntodayMarker stroke:#0f0,stroke-width:5px\nA :2025-01-01, 1d\nclick a call alert("no")');
    expect(inert.ledger.filter((e) => e.code === "mermaid-degraded" && e.message.startsWith("Kept "))).toHaveLength(5);
  });
  it("degrades incomplete/extreme data and renders empty declarations without throwing", () => {
    for (const source of [
      "gantt", "radar", "treemap", "radar-beta", "treemap-beta",
      'gantt\nexcludes sunday monday tuesday wednesday thursday friday saturday\nA :2025-01-01, 1d',
      'gantt\nA :a, after b, 1d\nB :b, after a, 1d',
      'gantt\nA :after missing, 3dX',
      'radar\naxis A,B,C\ncurve c{A:2,B:20}\nmin 0\nmax 5\nticks 100',
      'radar\naxis A,B,C\ncurve c{0,0,0}',
      'radar\naxis A,B,C\ncurve c{-1e308,0,1e308}\nmin -1e308\nmax 1e308',
      'treemap\n"R"\n "A": 1e308\n "B": 1e308',
    ]) {
      const chart = parse(source);
      for (const target of ["chat", "web"] as const) expect(() => renderGlyphChartMermaid(source, { ...options, target })).not.toThrow();
      if (source.includes("3dX")) expect(chart.ledger.some((e) => e.detail?.feature === "unrecognized Gantt end date or duration")).toBe(true);
    }
    const narrow = renderGlyphChart(glyphChartTreemap([{ id: "r", label: "Unbreakablelonglabel", value: 1 }]), { ...options, width: 8 });
    expect(narrow.text).not.toContain("Unbrea");
    expect(narrow.report.ledger.some((e) => e.code === "treemap-omitted")).toBe(true);
    const tinyMark = glyphChartBar([{ x0: 1, x: 1.00001, y: "A" }], { x0: "x0", x: "x", y: "y" }, { orientation: "horizontal" });
    const tiny = renderGlyphChart({ marks: [tinyMark], scales: { x: { domain: [0,10] } } }, { ...options, target: "chat" });
    expect(tiny.report.ledger.some((e) => e.code === "bar-interval-collapsed")).toBe(true);
    expect(tiny.text).toContain("●");
  });
  it("preserves literal percent formatting and wraps treemap words without splitting them", () => {
    const source = 'gantt\ndateFormat YYYY-MM-DD\naxisFormat %Y %% complete\nA :2025-01-01, 2d';
    const chart = parse(source);
    const formatter = chart.axes?.x?.format as (v: Date) => string;
    expect(formatter(new Date("2025-01-01"))).toBe("2025 % complete");
    const tree = renderGlyphChart(glyphChartTreemap([{ id: "a", label: "Long leaf label", value: 123 }]), { ...options, width: 10 });
    expect(tree.text).toContain("Long"); expect(tree.text).toContain("leaf"); expect(tree.text).toContain("label"); expect(tree.text).toContain("123");
    expect(tree.report.ledger.filter((e) => e.code === "treemap-omitted")).toEqual([]);
    const tooSmall = renderGlyphChart(glyphChartTreemap([{ id: "r" }, { id: "c", parent: "r", label: "Child", value: 1 }]), { ...options, width: 4, height: 3 });
    expect(tooSmall.report.ledger.some((e) => e.code === "treemap-omitted" && e.detail?.label === "Child")).toBe(true);
  });
  it("uses named errors for malformed new syntax and rejects unsupported native combinations", () => {
    for (const source of ['gantt\nBroken', 'radar\ncurve c{bad}', 'radar\naxis A\ngraticule square', 'radar\nshowLegend yes', 'treemap\nBare node']) {
      expect(() => glyphChartFromMermaid(source)).toThrow(expect.objectContaining({ code: "GLYPH_MERMAID_SYNTAX" }));
    }
    const ajv = new Ajv2020({ strict: false }).compile(glyphChartJsonSchema());
    for (const mark of [
      { ...glyphChartBar([{ x0: 1, x: 2, y: "A" }], { x0: "x0", x: "x", y: "y" }) },
      { ...glyphChartBar([1,2], undefined, { orientation: "horizontal" }), transform: { kind: "stack" as const } },
      { ...glyphChartBar([1,2]), options: { orientation: "diagonal" as never } },
    ]) {
      expect(ajv({ marks: [mark] })).toBe(false);
      expect(() => renderGlyphChart(mark)).toThrow(expect.objectContaining({ code: "bad-options" }));
    }
  });
  it("writes every valid new example twice, verbatim at 72 columns", () => {
    const destination = process.env.GLYPH_TASK7_ARTIFACT;
    if (!destination) return;
    mkdirSync(dirname(destination), { recursive: true });
    const size = (source: string) => {
      const spec = glyphChartFromMermaid(source);
      if (spec.scales?.x?.type === "time") {
        const lanes = spec.scales?.y?.domain?.length ?? Math.max(1, spec.marks.filter((m) => m.type !== "rule").length);
        return { width: 72, height: Math.max(8, 2 * lanes + (spec.title ? 1 : 0) + (spec.legend ? 1 : 0) + 2) };
      }
      if (/^radar(?:-beta)?\b/m.test(source)) {
        const axes = spec.marks.filter((m) => m.type === "text").flatMap((m) => m.data).filter((d) => Math.hypot(Number((d as { x: number }).x), Number((d as { y: number }).y)) > 1.1).length;
        const curves = spec.marks.filter((m) => m.options?.name).length;
        return { width: 72, height: Math.max(10, axes * (curves + 1) + 4) };
      }
      return { width: 72, height: source.includes("treemap") ? 20 : 24 };
    };
    const font = readFileSync(join(__dirname, "../../../website/public/fonts/glyph-mono.woff2")).toString("base64");
    const previews = [...observed].map(([source, name]) => `<article><h2>${name}</h2><pre>${renderGlyphChartMermaid(source, { ...size(source), target: "web" }).html}</pre></article>`).join("\n");
    writeFileSync(destination.replace(/\.txt$/, ".html"), `<!doctype html><meta charset="utf-8"><style>@font-face{font-family:GlyphMono;src:url(data:font/woff2;base64,${font})}body{background:#10131a;color:#e8eaf0;font:14px system-ui;padding:24px}article{margin:24px 0}pre{font-family:GlyphMono,monospace!important;font-size:16px;line-height:1!important}</style>${previews}`);
    const text = [...observed].map(([source, name]) => {
      const rendered = (["chat", "web"] as const).map((target) => { const result = renderGlyphChartMermaid(source, { ...size(source), target }); expect(result.text.split("\n").every((row) => [...row].length === 72)).toBe(true); return `${target.toUpperCase()} (${result.build.resolved.charset}, 72 columns)\n${result.text}\n\nLEDGER\n${result.report.ledger.map((e) => `${e.code}: ${e.message}`).join("\n") || "(none)"}`; }).join("\n\n");
      return `${name}\n\nSOURCE\n${source}\n\n${rendered}`;
    }).join("\n\n" + "=".repeat(72) + "\n\n") + "\n";
    const native = [
      { name: "Grouped horizontal bars with aligned labels and separators", height: 24, mark: glyphChartBar(["Code", "Docs", "Tests", "Design", "Ops"].flatMap((y) => [{ x: 8, y, series: "First" }, { x: 6, y, series: "Second" }]), { x: "x", y: "y", fill: "series" }, { orientation: "horizontal" }) },
      { name: "Shared-border four-leaf treemap", mark: glyphChartTreemap([1,2,3,4].map((i) => ({ id: String(i), value: 1, label: String(i) }))) },
      { name: "README horizontal bar", mark: glyphChartBar([{ region: "East", units: 10 }], { x: "units", y: "region" }, { orientation: "horizontal" }) },
      { name: "README floating date interval", mark: glyphChartBar([{ start: new Date("2025-01-01"), end: new Date("2025-01-03"), task: "Build" }], { x0: "start", x: "end", y: "task" }, { orientation: "horizontal" }) },
    ].map(({ name, mark, height }) => `${name}\n\nNATIVE SPEC\n${JSON.stringify(mark, null, 2)}\n\n` + (["chat", "web"] as const).map((target) => {
      const result = renderGlyphChart(mark, { width: 72, height: height ?? 8, target });
      expect(result.text.split("\n").every((row) => [...row].length === 72)).toBe(true);
      return `${target.toUpperCase()} (${result.build.resolved.charset}, 72 columns)\n${result.text}\n\nLEDGER\n${result.report.ledger.map((e) => `${e.code}: ${e.message}`).join("\n") || "(none)"}`;
    }).join("\n\n")).join("\n\n" + "=".repeat(72) + "\n\n");
    writeFileSync(destination, text + "\n" + "=".repeat(72) + "\n\n" + native + "\n");
    expect(text.match(/72 columns\)/g)).toHaveLength(observed.size * 2);
  });
});
