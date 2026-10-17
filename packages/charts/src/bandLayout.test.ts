import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { glyphChartFromMermaid, renderGlyphChartMermaid } from "./mermaid";
import { renderGlyphChart } from "./render";
import { glyphChartArea, glyphChartBar, glyphChartCell, glyphChartDot, glyphChartFunnel, glyphChartLine, glyphChartRule, glyphChartText } from "./spec";
import { goodSpecs } from "./reviewFixtures";
import type { GlyphChartInput, GlyphChartRenderOptions } from "./types";

const examples = [
  { name: "Gantt", source: `gantt
 title Release plan
 dateFormat YYYY-MM-DD
 axisFormat %b %d
 section Prepare
 Design :d, 2025-01-02, 2d
 Build :b, after d, 3d
 section Ship
 Launch :2025-01-08, 1d` },
  { name: "Radar", source: `radar-beta
 title Team skills
 axis Code, Docs, Tests
 curve a["Team A"]{8,6,9}, b["Team B"]{6,9,7}
 max 10
 ticks 2
 showLegend true` },
  { name: "Horizontal XY bars", source: `xychart horizontal
 title Regional sales
 x-axis Region [East, West, North]
 y-axis Units 0 --> 20
 bar "Sales" [10,18,14]` },
  { name: "Horizontal XY lines", source: `xychart horizontal
 title Regional trend
 x-axis Region [East, West, North]
 y-axis Units 0 --> 20
 line "Sales" [10,18,14]` },
  { name: "Horizontal XY bars and lines", source: `xychart horizontal
 title Regional sales and goals
 x-axis Region [East, West, North]
 y-axis Units 0 --> 20
 bar "Sales" [10,18,14]
 line "Goal" [12,16,15]` },
  { name: "Journey", source: `journey
 title Working day
 section Work
 Plan: 3: Me
 Build: 5: Team
 section Home
 Rest: 4: Me` },
  { name: "Timeline", source: `timeline
 title Release history
 section Prepare
 January : Design
 February : Build : Review
 section Ship
 March : Launch` },
  { name: "Packet", source: `packet-beta
 title Header
 0-15: "Source port"
 16-31: "Target port"
 32-47: "Length"
 48-63: "Checksum"` },
  { name: "Kanban", source: `kanban
 todo[Todo]
  plan[Write docs]
 doing[Doing]
  build[Build parser]
 done[Done]
  check[Review output]` },
  { name: "Treemap", source: `treemap-beta
 title Budget
"Products"
 "Hardware": 50
 "Software": 30
"Research"
 "Labs": 20` },
  { name: "Pie", source: `pie title Pets
"Dogs": 45
"Cats": 35
"Birds": 20` },
  { name: "Vertical XY bars", source: `xychart
 title Sales
 x-axis [Q1, Q2, Q3]
 bar "Sales" [10,18,14]` },
  { name: "Vertical XY lines", source: `xychart
 title Trend
 line "Sales" [10,18,14]` },
  { name: "Numeric horizontal XY line", source: `xychart horizontal
 title Numeric trend
 x-axis Time 0 --> 10
 y-axis Value -5 --> 5
 line [1,-2,3]` },
  { name: "Sankey", source: `sankey-beta
Coal,Power,40
Gas,Power,60
Power,Homes,70
Power,Industry,30` },
  { name: "Quadrant", source: `quadrantChart
 title Priorities
 x-axis Low reach --> High reach
 y-axis Low impact --> High impact
 quadrant-1 Invest
 quadrant-2 Explore
 quadrant-3 Hold
 quadrant-4 Refine
 Alpha: [0.75,0.7]
 Beta: [0.25,0.3]` },
];
const native: { name: string; input: GlyphChartInput }[] = [
  { name: "Area", input: glyphChartArea([3,5,2,8]) },
  { name: "Dot", input: glyphChartDot([3,5,2,8]) },
  { name: "Cell (heatmap)", input: glyphChartCell([{ x: "A", y: "One", v: 2 }, { x: "B", y: "One", v: 4 }, { x: "A", y: "Two", v: 3 }, { x: "B", y: "Two", v: 1 }], { x: "x", y: "y", fill: "v" }) },
  { name: "Text", input: glyphChartText([{ x: 0, y: 1, text: "Start" }, { x: 1, y: 2, text: "End" }], { x: "x", y: "y", label: "text" }) },
  { name: "Rule", input: { marks: [glyphChartLine([3,5,2,8]), glyphChartRule([4])] } },
  { name: "Funnel", input: glyphChartFunnel([{ stage: "Visits", value: 1000 }, { stage: "Views", value: 500 }, { stage: "Orders", value: 100 }], { stage: "stage", value: "value" }) },
];
const modes: { name: string; options: GlyphChartRenderOptions }[] = [
  { name: "chat 72x24 / box", options: { target: "chat", width: 72, height: 24 } },
  { name: "web 72 columns / braille", options: { target: "web", width: 72 } },
  { name: "web defaults / braille", options: { target: "web" } },
];
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const fixturePath = join(process.cwd(), "src/fixtures/bandLayoutParent.json");
const baselineOptions: GlyphChartRenderOptions[] = [
  { target: "chat", width: 72, height: 24 }, { target: "chat", width: 72, height: 40 },
  { target: "web", width: 72, height: 24 }, { target: "web" },
];

it("keeps all pre-existing goodSpecs byte-identical", () => {
  const hashes = Object.fromEntries(goodSpecs.flatMap((spec, i) => baselineOptions.map((options, j) => [`${i}:${j}`, hash(renderGlyphChart(spec, options).text)])));
  expect(hashes).toEqual(JSON.parse(readFileSync(fixturePath, "utf8")));
});

describe("content-sized band layouts", () => {
  it.each([24, 40])("puts Gantt's axis immediately after the last authored band at height %i", (height) => {
    for (const target of ["chat", "web"] as const) {
      const r = renderGlyphChartMermaid(examples[0]!.source, { target, width: 72, height });
      const lines = r.text.split("\n"), last = lines.findIndex((line) => line.includes("Launch"));
      expect(last).toBeGreaterThan(0);
      expect(r.build.plot.y1).toBe(last + 1);
      expect(lines[last + 1]!.trim()).not.toBe("");
      expect(lines.slice(last + 3).every((line) => !line.trim())).toBe(true);
      expect(lines).toHaveLength(height);
    }
  });
  it.each([24, 40])("puts each horizontal summary axis directly after its last bar at height %i", (height) => {
    for (const index of [1, 2, 4]) {
      for (const target of ["chat", "web"] as const) {
        if (index === 1 && target === "web") continue;
        const r = renderGlyphChartMermaid(examples[index]!.source, { target, width: 72, height });
        const rows = r.text.split("\n");
        const lastBar = rows.slice(0, r.build.plot.y1).reduce((last, line, row) => /[█░▒▓]/.test(line) ? row : last, -1);
        expect(lastBar).toBe(r.build.plot.y1 - 1);
        expect(rows[r.build.plot.y1]!.trim()).not.toBe("");
      }
    }
  });
  it("does not reserve a blank axis row when horizontal axis lines are disabled", () => {
    const spec = { marks: [glyphChartBar([{ x: 5, y: "A" }, { x: 8, y: "B" }], { x: "x", y: "y" }, { orientation: "horizontal" })], axes: { x: { line: false } } };
    for (const height of [24, 40]) {
      const r = renderGlyphChart(spec, { target: "chat", width: 72, height });
      expect(r.build.plot.y1).toBe(2);
      expect(r.text.split("\n")[2]).toContain("█");
      expect(r.text.split("\n")[3]).toContain("0");
      expect(r.text.split("\n").slice(4).every((line) => !line.trim())).toBe(true);
    }
  });
  it.each([1, 2, 3])("keeps scaled Gantt bands and chrome adjacent at textScale %i", (textScale) => {
    const r = renderGlyphChartMermaid(examples[0]!.source, { target: "web", width: 144, height: 80, textScale });
    // Compact seven rows plus two extra blank rows at each of the two task gaps.
    const first = r.text.split("\n").findIndex((line) => line.trim());
    expect(r.build.plot.y1 - first).toBe(11 * textScale);
  });
  it.each(examples.slice(1, 9).filter(({ name }) => name !== "Horizontal XY lines"))("keeps $name's drawing independent of spare height", ({ source }) => {
    for (const target of ["chat", "web"] as const) {
      // Web radar polygons genuinely use height; its chat summary has fixed rows.
      if (source.startsWith("radar") && target === "web") continue;
      const short = renderGlyphChartMermaid(source, { target, width: 72, height: 24 });
      const tall = renderGlyphChartMermaid(source, { target, width: 72, height: 40 });
      const compactWeb = target === "web" && /^(journey|timeline|packet|kanban)\b/.test(source);
      if (compactWeb) {
        const content = (text: string) => { const lines = text.split("\n"); return lines.slice(lines.findIndex((line) => line.trim()), lines.reduce((last, line, row) => line.trim() ? row + 1 : last, 0)).join("\n"); };
        expect(content(tall.text)).toBe(content(short.text));
        for (const result of [short, tall]) {
          const lines = result.text.split("\n"), first = lines.findIndex((line) => line.trim()), last = lines.reduce((last, line, row) => line.trim() ? row : last, 0);
          expect(Math.abs(first - (lines.length - last - 1))).toBeLessThanOrEqual(1);
        }
      } else {
        expect(tall.text.split("\n").slice(0, 24).join("\n")).toBe(short.text);
        expect(tall.text.split("\n").slice(24).every((line) => !line.trim())).toBe(true);
        expect(short.text.split("\n").findIndex((line) => line.trim())).toBe(0);
      }
    }
  });
  it.each([24, 40])("keeps native horizontal bars, axis, legend and bottom title together at height %i", (height) => {
    const r = renderGlyphChart({
      marks: [glyphChartBar([{ x: 5, y: "A" }, { x: 8, y: "B" }], { x: "x", y: "y" }, { orientation: "horizontal", name: "Count" })],
      title: { text: "Bottom title", position: "bottom" }, axes: { x: { title: "Value" }, y: { title: "Category", titleAt: "bottom" } },
    }, { target: "chat", width: 72, height });
    const lines = r.text.split("\n"), lastBar = lines.findIndex((line) => /^\s*A\s*[┤│]/.test(line));
    expect(lastBar).toBeGreaterThanOrEqual(0);
    expect(r.build.plot.y1).toBe(lastBar + 1);
    const title = lines.findIndex((line) => line.includes("Bottom title"));
    expect(lines[r.build.plot.y1 + 1]).toContain("0");
    expect(lines[r.build.plot.y1 + 2]).toContain("Value");
    expect(lines[r.build.plot.y1 + 2]).toContain("Category");
    expect(title).toBe(r.build.plot.y1 + 4);
    expect(lines.slice(title + 1).every((line) => !line.trim())).toBe(true);
    expect(lines[title - 1]).toContain("Count");
  });
});

it("renders every Mermaid chart type and remaining native marks in their real target defaults", () => {
  const output: string[] = [], html: string[] = [];
  const all: { name: string; input: GlyphChartInput; source?: string }[] = [...examples.map((example) => ({ ...example, input: glyphChartFromMermaid(example.source) })), ...native];
  for (const example of all) {
    output.push(`=== ${example.name} ===`, example.source !== undefined ? example.source : JSON.stringify(example.input));
    for (const mode of modes) {
      const result = example.source !== undefined ? renderGlyphChartMermaid(example.source, mode.options) : renderGlyphChart(example.input, mode.options);
      expect(result.text.trim()).not.toBe("");
      expect(result.build.resolved.charset).toBe(mode.options.target === "chat" ? "box" : "braille");
      expect(result.report.unsupportedGlyphs).toEqual([]);
      expect(result.text.split("\n").every((line) => [...line].length === result.build.canvas.cols)).toBe(true);
      output.push(`--- ${mode.name} ---`, result.text, `Ledger: ${JSON.stringify(result.report.ledger)}`, "");
      if (mode.options.target === "web") html.push(`<h2>${example.name} — ${mode.name}</h2><pre>${result.html}</pre>`);
    }
  }
  const path = process.env.GLYPH_BAND_ARTIFACT;
  if (path) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, output.join("\n") + "\n");
    const font = readFileSync(join(__dirname, "../../../website/public/fonts/glyph-mono.woff2")).toString("base64");
    writeFileSync(path.replace(/\.txt$/, ".html"), `<!doctype html><meta charset="utf-8"><title>G1 target renders</title><style>@font-face{font-family:GlyphMono;src:url(data:font/woff2;base64,${font})}body{background:#0f172a;color:#e2e8f0;font:14px monospace;padding:20px}pre{font-family:GlyphMono,monospace!important;font-size:16px;line-height:1!important;white-space:pre}h2{margin-top:32px}</style>${html.join("\n")}`);
  }
});
