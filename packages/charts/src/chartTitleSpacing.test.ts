import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { glyphChartFromMermaid, renderGlyphChartMermaid } from "./mermaid";
import { chartSeries } from "./series";
import { resolveGlyphChartSpec } from "./resolve";
import { layoutSankeyGraph } from "./flowMarks";
import { glyphChartSankey } from "./spec";
import parent from "./fixtures/chartTitleSpacingParent.json";
import { renderGlyphChart } from "./render";
import { goodSpecs } from "./reviewFixtures";
import type { GlyphChartSpec } from "./types";

const readExample = (name: string) => readFileSync(`../../glyphcss-diagrams/examples/${name}`, "utf8");
const quadrant = readExample("quadrant.mmd"), radar = readExample("radar.mmd");
const traffic = JSON.parse(readExample("traffic.json")) as GlyphChartSpec;
const examples = JSON.parse(readFileSync("src/fixtures/mermaidExamples.json", "utf8")) as { name: string; source: string; height?: number }[];
const presets = JSON.parse(readFileSync("../../website/src/features/mermaid/data/examples.json", "utf8")) as { type: string; source: string; height?: number }[];
const catalog = [
  ...goodSpecs.map((spec, i) => ({ name: `goodSpecs[${i}]`, spec, height: 24 })),
  ...examples.map((e) => ({ name: `fixture: ${e.name}`, source: e.source, height: e.height ?? 24 })),
  ...presets.filter((p) => /^(gantt|treemap|journey|timeline|packet|kanban|xychart|radar|quadrant|pie|sankey)/.test(p.type)).map((p) => ({ name: `showcase: ${p.type}`, source: p.source, height: p.height ?? 24 })),
];
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

it("captures title-spacing catalogue and requested gallery examples", () => {
  const path = process.env.GLYPH_CHART_TITLE_ARTIFACT;
  if (!path) return;
  const records = [];
  for (const target of ["chat", "web"] as const) {
    for (const [name, spec, height] of [["Quadrant", quadrant, 22], ["Radar", radar, 22], ["Sankey", traffic, 14]] as const) {
      for (const width of [60, 72]) {
        const result = typeof spec === "string" ? renderGlyphChartMermaid(spec, { target, width, height }) : renderGlyphChart(spec, { target, width, height });
        records.push({ name, target, width, height, charset: result.build.resolved.charset, text: result.text, html: result.html, ledger: result.report.ledger });
      }
    }
    for (const [name, source] of families) {
      const result = renderGlyphChart(familySpec(name, source), { target, width: 72, height: 40 });
      records.push({ name: `family audit: ${name}`, target, width: 72, height: 40, charset: result.build.resolved.charset, text: result.text, html: result.html, ledger: result.report.ledger });
    }
    const empty = renderGlyphChartMermaid("timeline\ntitle Empty timeline", { target, width: 72, height: 2 });
    records.push({ name: "Empty timeline", target, width: 72, height: 2, charset: empty.build.resolved.charset, text: empty.text, html: empty.html, ledger: empty.report.ledger });
    for (const entry of catalog) {
      const { name, height } = entry;
      const result = "source" in entry ? renderGlyphChartMermaid(entry.source, { target, width: 72, height }) : renderGlyphChart(entry.spec, { target, width: 72, height });
      records.push({ name, target, width: 72, height, charset: result.build.resolved.charset, text: result.text, html: result.html, hash: hash(result.text), ledger: result.report.ledger });
    }
  }
  writeFileSync(path, JSON.stringify(records, null, 2) + "\n");
});

const families = [
  ["bars", "xychart\nbar [2,4,3]"], ["lines", "xychart\nline [2,4,3]"],
  ["pie", 'pie\n"A": 3\n"B": 2'], ["gantt", "gantt\ndateFormat YYYY-MM-DD\nsection Work\nBuild :2025-01-01, 2d\nShip :2025-01-03, 1d"],
  ["radar", radar], ["quadrant", quadrant],
  ["funnel", ""], ["heatmap", ""],
  ["treemap", 'treemap-beta\n"A": 3\n"B": 2'],
  ["journey", "journey\nsection Work\nBuild: 4: Team\nShip: 5: Team"],
  ["timeline", "timeline\nsection Work\nToday : Build\nTomorrow : Ship"],
  ["packet", 'packet\n0-15: "First"\n16-31: "Second"'],
  ["kanban", "kanban\ntodo[Todo]\n card[Build]"],
] as const;
const familySpec = (name: string, source: string): GlyphChartSpec => ({
  ...(name === "funnel" ? goodSpecs[17]! : name === "heatmap" ? goodSpecs[13]! : glyphChartFromMermaid(source)), title: "Chart title",
});

describe("chart title spacing", () => {
  for (const target of ["chat", "web"] as const) {
    it(`aligns quadrant endpoint labels to the complete axis in ${target}`, () => {
      for (const width of [60, 72]) {
        const r = renderGlyphChartMermaid(quadrant, { target, width, height: 22 });
        const rows = r.text.split("\n");
        const low = rows.findIndex((row) => row.includes("Low effort"));
        const origin = rows[low - 1]!.indexOf("─");
        expect(rows[low]!.indexOf("Low effort")).toBe(origin);
        expect(rows[low]!.indexOf("High effort") + "High effort".length).toBe(width);
        expect(rows[low - 1]!.indexOf("Low impact") + "Low impact".length).toBeLessThan(origin);
        for (const label of ["Docs", "Cache", "Theme", "Rewrite", "Do now", "Plan", "Later", "Skip"]) expect(r.text).toContain(label);
      }
    });
    it.each([[quadrant, "Next fixes", 22], [radar, "Hosted delivery profile", 22], [traffic, "From visits to signups", 14]] as const)(`separates the reported %s title in ${target}`, (input, title, height) => {
      for (const width of [60, 72]) {
        const r = typeof input === "string" ? renderGlyphChartMermaid(input, { target, width, height }) : renderGlyphChart(input, { target, width, height });
        const rows = r.text.split("\n"), at = rows.findIndex((row) => row.trim() === title);
        expect(at).toBeGreaterThanOrEqual(0);
        expect(rows[at + 1]!.trim()).toBe("");
        expect(rows.slice(at + 2).some((row) => row.trim())).toBe(true);
        expect(r.report.ledger.filter((e) => e.code === "title-gap-omitted")).toEqual([]);
      }
    });
    it.each(families)(`separates %s titles from content in ${target}`, (name, source) => {
      const result = renderGlyphChart(familySpec(name, source), { target, width: 72, height: 40 });
      const rows = result.text.split("\n"), at = rows.findIndex((row) => row.includes("Chart title"));
      expect(at).toBeGreaterThanOrEqual(0);
      expect(rows[at + 1]!.trim()).toBe("");
      expect(rows.slice(at + 2).some((row) => row.trim())).toBe(true);
    });
    it.each(families.filter(([name]) => ["journey", "timeline", "packet", "kanban"].includes(name)))(`preserves every compact %s row when a title gap cannot fit in ${target}`, (name, source) => {
      const spec = familySpec(name, source);
      const untitled = renderGlyphChart({ ...spec, title: undefined }, { target, width: 72 });
      const tight = renderGlyphChart(spec, { target, width: 72, height: untitled.build.resolved.height + 1 });
      expect(tight.text.split("\n").slice(1).join("\n")).toBe(untitled.text);
      expect(tight.report.ledger.filter((e) => e.code === "title-gap-omitted")).toHaveLength(1);
    });
  }
  it.each([1,2,3])("scales title air and keeps shared title legends on their row at scale %i", (textScale) => {
    const spec = { ...goodSpecs[26]!, title: "Chart title", legend: { placement: "title" as const } };
    const r = renderGlyphChart(spec, { target: "web", width: 144, height: 60, textScale });
    expect(r.build.plot.y0).toBe(2 * textScale);
    expect(r.text.split("\n").slice(textScale, 2 * textScale).every((row) => !row.trim())).toBe(true);
  });
  it("keeps bottom titles separated from lower chrome and logs omitted gaps on tight native plots", () => {
    for (const position of ["top", "bottom"] as const) {
      const spec = { ...goodSpecs[8]!, title: { text: "Title", position } };
      const roomy = renderGlyphChart(spec, { target: "chat", width: 72, height: 24 });
      const rows = roomy.text.split("\n"), at = rows.findIndex((row) => row.includes("Title"));
      expect(rows[at + (position === "top" ? 1 : -1)]!.trim()).toBe("");
      const tight = renderGlyphChart(spec, { target: "chat", width: 72, height: 6 });
      expect(tight.build.plot.y1 - tight.build.plot.y0 + 1).toBe(4);
      expect(tight.report.ledger.filter((e) => e.code === "title-gap-omitted")).toHaveLength(1);
    }
  });
});

it("keeps every unaffected catalogue render byte-identical to space1", () => {
  for (const entry of catalog) for (const target of ["chat", "web"] as const) {
    const key = `${entry.name}:${target}` as keyof typeof parent;
    if (!(key in parent)) continue;
    const r = "source" in entry ? renderGlyphChartMermaid(entry.source, { target, width: 72, height: entry.height }) : renderGlyphChart(entry.spec, { target, width: 72, height: entry.height });
    expect(hash(r.text), key).toBe(parent[key]);
  }
});

it("lets the Sankey planner veto a title gap that would hide a small flow", () => {
  const mark = glyphChartSankey([{ from: "A", to: "B", value: 100 }, { from: "A", to: "C", value: 10 }, { from: "A", to: "D", value: 1 }], { source: "from", target: "to", value: "value" });
  const groups = chartSeries(resolveGlyphChartSpec({ marks: [mark] }));
  let vetoes = 0;
  for (const target of ["chat", "web"] as const) for (let height = 6; height <= 30; height++) {
    const r = renderGlyphChart({ title: "Flows", marks: [mark] }, { target, width: 72, height });
    const base = layoutSankeyGraph(groups, { x0: 0, x1: 71, y0: 1, y1: height - 1 }, r.build.resolved.charset, [])!;
    const current = layoutSankeyGraph(groups, r.build.plot, r.build.resolved.charset, [])!;
    for (const b of base.bands) expect(current.bands.some((c) => c.source === b.source && c.target === b.target && c.value === b.value && c.folded === b.folded)).toBe(true);
    for (const n of base.nodes.filter((n) => n.height > 0)) expect(current.nodes.some((c) => c.id === n.id && c.height > 0)).toBe(true);
    if (height >= 7 && r.report.ledger.some((e) => e.code === "title-gap-omitted")) vetoes++;
  }
  expect(vetoes).toBeGreaterThan(0);
});

it("budgets an empty timeline caption before optional title air", () => {
  for (const target of ["chat", "web"] as const) {
    const r = renderGlyphChartMermaid("timeline\ntitle Empty timeline", { target, width: 72, height: 2 });
    expect(r.text).toContain("Empty timeline");
    expect(r.text).toContain("No periods");
    expect(r.report.ledger.filter((e) => e.code === "title-gap-omitted")).toHaveLength(1);
    expect(r.report.ledger.filter((e) => e.detail?.feature === "timeline empty caption outside the viewport")).toEqual([]);
  }
});
