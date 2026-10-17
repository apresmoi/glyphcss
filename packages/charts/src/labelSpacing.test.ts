import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderGlyphChartMermaid } from "./mermaid";
import { renderGlyphChart } from "./render";
import { goodSpecs } from "./reviewFixtures";
import { glyphChartBar, glyphChartLine } from "./spec";
import baseline from "./fixtures/labelSpacingParent.json";
import type { GlyphChartSpec, GlyphChartRenderOptions } from "./types";

const signups: GlyphChartSpec = {
  title: "Weekly signups",
  axes: { x: { title: "Week" }, y: { title: "Signups" } },
  marks: [{ type: "line", channels: { x: "week", y: "signups" },
    data: [14, 22, 18, 31, 28, 44, 51, 47].map((signups, i) => ({ week: i + 1, signups })) }],
};
const gantt = `gantt
  title Release plan
  dateFormat YYYY-MM-DD
  section Delivery
  Build :build, 2026-10-19, 2d
  Test :test, after build, 1d
  Ship :ship, after test, 1d`;
const multiSection = `${gantt}\n section Launch\n Notify :after ship, 1d\n Publish :after ship, 1d`;
const tightPlots: GlyphChartSpec[] = [
  { marks: [glyphChartLine([0, 10, 5])], axes: { y: { title: "Values" } } },
  { marks: [glyphChartBar([{ x: 5, y: "A" }, { x: 8, y: "B" }, { x: 3, y: "C" }], { x: "x", y: "y" }, { orientation: "horizontal" })], axes: { y: { title: "Groups" } } },
];

// Optional before/after evidence uses the exact regression inputs and the existing catalogues.
it("captures label-spacing examples and catalogue outputs when requested", () => {
  const path = process.env.GLYPH_LABEL_SPACING_ARTIFACT;
  if (!path) return;
  const records: unknown[] = [];
  const add = (name: string, options: GlyphChartRenderOptions, result: ReturnType<typeof renderGlyphChart>) => {
    records.push({ name, options, charset: result.build.resolved.charset, text: result.text, html: result.html, plot: result.build.plot, ledger: result.report.ledger });
  };
  for (const target of ["chat", "web"] as const) {
    for (const [width, height] of [[48, 16], [72, 24]]) {
      const options = { target, width, height, ...(width === 48 ? { charset: "braille" as const, detail: "balanced" as const } : {}) };
      add("Signups", options, renderGlyphChart(signups, options));
    }
    for (const [width, height] of [[60, 18], [72, 24], [60, 7]]) {
      const options = { target, width, height };
      add("Gantt", options, renderGlyphChartMermaid(gantt, options));
    }
    tightPlots.forEach((spec, i) => {
      const options = { target, width: 72, height: 6 };
      add(i ? "Tight category rows" : "Tight proportional plot", options, renderGlyphChart(spec, options));
    });
    add("Multiple Gantt sections", { target, width: 72, height: 24 }, renderGlyphChartMermaid(multiSection, { target, width: 72, height: 24 }));
    const axisExample = {
      marks: [glyphChartLine([{ month: "Jan", value: 3 }, { month: "Feb", value: 5 }, { month: "Mar", value: 2 }, { month: "Apr", value: 8 }, { month: "May", value: 6 }], { x: "month", y: "value" }, { name: "Revenue" })],
      axes: { y: { ticks: 4, grid: true } },
    };
    add("README axes example", { target, width: 64, height: 22 }, renderGlyphChart(axisExample, { target, charset: "box", color: "none", width: 64, height: 22 }));
    goodSpecs.forEach((spec, i) => {
      const options = { target, width: 72, height: 24 };
      add(`goodSpecs[${i}]`, options, renderGlyphChart(spec, options));
    });
    const examples = JSON.parse(readFileSync("src/fixtures/mermaidExamples.json", "utf8")) as { name: string; source: string; height?: number }[];
    const presets = JSON.parse(readFileSync("../../website/src/features/mermaid/data/examples.json", "utf8")) as { type: string; source: string; height?: number }[];
    for (const example of examples) {
      const options = { target, width: 72, height: example.height ?? 24 };
      add(`fixture: ${example.name}`, options, renderGlyphChartMermaid(example.source, options));
    }
    for (const preset of presets.filter((p) => /^(gantt|treemap|journey|timeline|packet|kanban|xychart|radar|quadrant|pie|sankey)/.test(p.type))) {
      const options = { target, width: 72, height: preset.height ?? 24 };
      add(`showcase: ${preset.type}`, options, renderGlyphChartMermaid(preset.source, options));
    }
  }
  writeFileSync(path, JSON.stringify(records, null, 2) + "\n");
});

describe("label spacing", () => {
  it("keeps untitled axes and compact Gantts byte-identical to the parent", () => {
    for (const [key, hash] of Object.entries(baseline)) {
      const [name, target] = key.split(":") as [string, "chat" | "web"];
      const index = /^goodSpecs\[(\d+)\]$/.exec(name);
      const options = { target, width: index ? 72 : 60, height: index ? 24 : 7 };
      const result = index ? renderGlyphChart(goodSpecs[Number(index[1])]!, options) : renderGlyphChartMermaid(gantt, options);
      expect(createHash("sha256").update(result.text).digest("hex"), key).toBe(hash);
    }
  });

  for (const target of ["chat", "web"] as const) {
    it(`separates the y title from the top tick in ${target}`, () => {
      for (const width of [48, 72]) {
        const result = renderGlyphChart(signups, { target, width, height: width === 48 ? 16 : 24, ...(width === 48 ? { charset: "braille" } : {}) });
        const rows = result.text.split("\n"), title = rows.findIndex((row) => row.trim() === "Signups");
        expect(title).toBe(2);
        expect(rows[title - 1]!.trim()).toBe("");
        expect(rows[title + 1]!.trim()).toBe("");
        expect(result.build.plot.y0).toBe(title + 2);
        expect(result.report.ledger.some((e) => e.code === "axis-title-gap-omitted")).toBe(false);
        expect(result.text).toContain("Week");
      }
    });

    it(`gives Gantt headers the task gap without losing tasks in ${target}`, () => {
      for (let height = 7; height <= 30; height++) {
        const result = renderGlyphChartMermaid(gantt, { target, width: 60, height });
        const rows = result.text.split("\n");
        const [section, build, test, ship] = ["Delivery", "Build", "Test", "Ship"].map((label) => rows.findIndex((row) => row.includes(label)));
        expect([section, build, test, ship].every((row) => row >= 0)).toBe(true);
        const taskGap = test! - build! - 1;
        expect(taskGap).toBeLessThanOrEqual(2);
        expect(build! - section! - 1).toBe(taskGap);
        expect(ship! - test! - 1).toBe(taskGap);
        if (height === 18) expect(taskGap).toBe(2);
        expect(rows.slice(section! + 1, build!).every((row) => !row.trim())).toBe(true);
        expect(result.build.plot.y1).toBe(ship! + 1);
        expect(rows[ship! + 2]!.trim()).not.toBe("");
        expect(result.report.ledger.filter((e) => e.detail?.feature === "Gantt row outside the viewport")).toEqual([]);
      }
    });

    it(`preserves tight plot/category rows and logs the missing title gap in ${target}`, () => {
      for (const spec of tightPlots) {
        const result = renderGlyphChart(spec, { target, width: 48, height: 6 });
        expect(result.build.plot.y0).toBe(1);
        expect(result.build.plot.y1 - result.build.plot.y0 + 1).toBe(4);
        expect(result.report.ledger.filter((e) => e.code === "axis-title-gap-omitted")).toEqual([
          { code: "axis-title-gap-omitted", message: "Omitted the blank row below the y-axis title to preserve plot rows in 48×6.", detail: { cols: 48, rows: 6 } },
        ]);
        if (spec === tightPlots[1]) {
          const compact = renderGlyphChart({ ...spec, axes: { y: { title: "" } } }, { target, width: 48, height: 5 });
          const dataRows = result.text.split("\n").slice(1, result.build.plot.y1);
          expect(dataRows).toEqual(compact.text.split("\n").slice(0, compact.build.plot.y1));
          expect(dataRows.filter((row) => /[█▄]/.test(row))).toHaveLength(3);
        }
      }
    });
  }

  it.each([1, 2, 3])("scales the y-title gap with textScale %i", (textScale) => {
    const result = renderGlyphChart({ marks: [glyphChartLine([0, 10, 5])], axes: { y: { title: "Values" } } }, { target: "web", width: 144, height: 60, textScale });
    expect(result.build.plot.y0).toBe(2 * textScale);
    expect(result.text.split("\n").slice(textScale, 2 * textScale).every((row) => !row.trim())).toBe(true);
  });

  it.each([1, 2, 3])("balances all section/task gaps at textScale %i", (textScale) => {
    const result = renderGlyphChartMermaid(multiSection, { target: "web", width: 144, height: 80 * textScale, textScale });
    const lines = result.text.split("\n");
    const at = (text: string) => lines.findIndex((line) => line.includes([...text].join(" ".repeat(textScale - 1))));
    const gap = at("Test") - at("Build") - textScale;
    expect(gap).toBe(2 * textScale);
    expect(at("Build") - at("Delivery") - textScale).toBe(gap);
    expect(at("Notify") - at("Launch") - textScale).toBe(gap);
    expect(at("Launch") - at("Ship") - textScale).toBe(gap + textScale);
    expect(result.report.ledger.filter((e) => e.detail?.feature === "Gantt row outside the viewport")).toEqual([]);
  });
});
