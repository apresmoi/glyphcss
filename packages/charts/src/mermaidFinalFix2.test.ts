import { describe, expect, it } from "vitest";
import baseline from "./fixtures/finalFix2Parent.json";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { glyphChartBar, glyphChartFromMermaid, renderGlyphChart, renderGlyphChartMermaid } from "./index";

const examples = [
  { name: "Gantt section hierarchy", source: `gantt
 title Release plan
 axisFormat %b %d
 section Build
 Design :d, 2025-01-01, 2d
 Code :c, after d, 3d
 section Ship
 Test :t, after c, 2d
 Launch :milestone, after t, 0d` },
  { name: "Radar category labels", source: `radar
 title Skills
 axis Build, Ship, Test
 curve a["First"]{8,6,9}, b["Second"]{6,9,7}
 max 10` },
  { name: "Horizontal XY category labels", source: `xychart horizontal
 title Deliveries
 x-axis [Build, Ship, Test]
 y-axis 0 --> 10
 bar [8,6,9]` },
  { name: "Vertical XY category labels", source: `xychart
 title Deliveries
 x-axis [Build, Ship, Test]
 y-axis 0 --> 10
 bar [8,6,9]` },
];
const size = { width: 72, height: 12 } as const;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

describe("final cleanup 2", () => {
  it("writes before/after renders", () => {
    const destination = process.env.GLYPH_FINAL_FIX2_ARTIFACT;
    if (!destination) return;
    const records = examples.flatMap((example) => (["chat", "web"] as const).map((target) => {
      const result = renderGlyphChartMermaid(example.source, { ...size, target });
      expect(result.text.split("\n").every((line) => [...line].length === 72)).toBe(true);
      return { ...example, target, charset: result.build.resolved.charset, text: result.text, html: result.html, plot: result.build.plot, ledger: result.report.ledger };
    }));
    const font = readFileSync(`${__dirname}/../../../website/public/fonts/glyph-mono.woff2`).toString("base64");
    writeFileSync(destination.replace(/\.json$/, ".html"), `<!doctype html><meta charset="utf-8"><style>@font-face{font-family:GlyphMono;src:url(data:font/woff2;base64,${font})}body{background:#10131a;color:#e8eaf0;font:14px system-ui;padding:24px}pre{font-family:GlyphMono,monospace!important;font-size:16px;line-height:1!important}article{margin:24px 0}</style>${records.map((r) => `<article><h2>${r.name} · ${r.target}</h2><pre>${r.target === "web" ? r.html : r.text}</pre></article>`).join("\n")}`);
    const vertical = (["chat", "web"] as const).map((target) => ({ target, hash: digest(renderGlyphChart(glyphChartBar([3,-5,2,8]), { ...size, target }).text) }));
    writeFileSync(destination, JSON.stringify({ records, vertical }, null, 2) + "\n");
    writeFileSync(destination.replace(/\.json$/, ".txt"), records.map((r) => `${r.name}\nSOURCE\n${r.source}\n\n${r.target.toUpperCase()} (${r.charset}, 72 columns)\n${r.text}\n`).join("\n"));
  });

  it("places Gantt sections at column zero, indents tasks and separates sections", () => {
    for (const target of ["chat", "web"] as const) {
      const result = renderGlyphChartMermaid(examples[0]!.source, { ...size, target });
      const lines = result.text.split("\n");
      const build = lines.findIndex((line) => line.trim() === "Build");
      const ship = lines.findIndex((line) => line.trim() === "Ship");
      expect(lines[build]?.startsWith("Build")).toBe(true);
      expect(lines[ship]?.startsWith("Ship")).toBe(true);
      expect(lines[ship - 1]?.trim()).toBe("");
      for (const task of ["Design", "Code", "Test", "Launch"]) {
        const row = lines.findIndex((line) => line.includes(task));
        expect(lines[row]!.indexOf(task)).toBeGreaterThanOrEqual(2);
        expect(lines[row]!.slice(result.build.plot.x0).trim()).not.toBe("");
      }
      expect(lines[build - 1]?.trim()).toBe("Release plan");
      expect(lines[build + 1]).toContain("Design");
      expect(lines[build + 2]).toContain("Code");
      expect(lines[ship + 1]).toContain("Test");
      expect(lines[ship + 2]).toContain("Launch");
      expect(build).toBeLessThan(lines.findIndex((line) => line.includes("Design")));
      expect(ship).toBeLessThan(lines.findIndex((line) => line.includes("Test")));
    }
  });

  it("retains row structure through shallow copies and logs space limits", () => {
    const source = examples[0]!.source;
    expect(renderGlyphChart({ ...glyphChartFromMermaid(source) }, { ...size, target: "chat" }).text)
      .toBe(renderGlyphChartMermaid(source, { ...size, target: "chat" }).text);
    const narrow = renderGlyphChartMermaid(source, { ...size, width: 12, target: "chat" });
    expect(narrow.report.ledger.some((entry) => entry.detail?.feature === "Gantt row label outside its column")).toBe(true);
    expect(narrow.text).not.toMatch(/Desi|Laun/);
    const short = renderGlyphChartMermaid(source, { ...size, height: 5, target: "chat" });
    expect(short.report.ledger.some((entry) => entry.detail?.feature === "Gantt row outside the viewport")).toBe(true);
    expect(short.text).not.toContain("Launch");
    expect(short.report.ledger.some((entry) => entry.code === "ticks-thinned" && entry.detail?.axis === "y")).toBe(false);
  });

  it("keeps radar and categorical XY labels attached to bars", () => {
    for (const example of examples.slice(1, 3)) {
      const result = renderGlyphChartMermaid(example.source, { ...size, target: "chat" });
      for (const label of ["Build", "Ship", "Test"]) {
        const row = result.text.split("\n").find((line) => line.includes(label))!;
        expect(row.slice(result.build.plot.x0)).toContain("█");
      }
    }
  });

  // G1 refreshes only horizontal XY hashes; Gantt axis bytes now follow the authored rows.
  it("preserves vertical bars and categorical XY fixture hashes", () => {
    for (const target of ["chat", "web"] as const) {
      expect(digest(renderGlyphChart(glyphChartBar([3,-5,2,8]), { ...size, target }).text)).toBe((baseline as Record<string, string>)[`vertical:${target}`]);
      const gantt = renderGlyphChartMermaid(examples[0]!.source, { ...size, target });
      const ganttLines = gantt.text.split("\n");
      expect(digest(ganttLines.slice(gantt.build.plot.y1, gantt.build.plot.y1 + 2).join("\n"))).toBe((baseline as Record<string, string>)[`gantt-axis:${target}`]);
      expect(digest(ganttLines.filter((line) => /[█●\u2801-\u28ff]/.test(line)).map((line) => line.slice(gantt.build.plot.x0)).join("\n"))).toBe((baseline as Record<string, string>)[`gantt-bars:${target}`]);
      for (const example of examples.slice(1)) expect(digest(renderGlyphChartMermaid(example.source, { ...size, target }).text)).toBe((baseline as Record<string, string>)[`${example.name}:${target}`]);
    }
  });
});
