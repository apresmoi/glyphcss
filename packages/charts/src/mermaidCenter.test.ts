import type { GlyphCanvas } from "glyphcss";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderGlyphChartMermaid } from "./mermaid";
import { renderGlyphChart } from "./render";
import { glyphChartBar } from "./spec";

const presets = JSON.parse(readFileSync("../../website/src/features/mermaid/data/examples.json", "utf8")) as { type: string; owner: string; source: string }[];
const compact = ["journey", "timeline", "kanban", "packet", "gantt"];
function bounds(text: string) {
  const lines = text.split("\n"), occupied = lines.map((line, row) => ({ line, row })).filter(({ line }) => /\S/.test(line));
  return { top: occupied[0]!.row, bottom: lines.length - 1 - occupied.at(-1)!.row,
    left: Math.min(...occupied.map(({ line }) => line.search(/\S/))), right: lines[0]!.length - Math.max(...occupied.map(({ line }) => line.trimEnd().length)) };
}

function inkBounds(canvas: GlyphCanvas) {
  const cells = [...canvas.ink].flatMap((ink, i) => (ink || canvas.textFiller[i]) ? [{ x: i % canvas.cols, y: Math.floor(i / canvas.cols) }] : []);
  return { top: Math.min(...cells.map((c) => c.y)), bottom: canvas.rows - 1 - Math.max(...cells.map((c) => c.y)),
    left: Math.min(...cells.map((c) => c.x)), right: canvas.cols - 1 - Math.max(...cells.map((c) => c.x)) };
}

describe("web compact Mermaid chart centring", () => {
  it.each(presets.filter((p) => compact.includes(p.type)))("centres $type geometry at viewport sizes and text scales", ({ source }) => {
    for (const [width, height, scale] of [[96, 64, 1], [120, 96, 1], [192, 128, 2]]) {
      for (const color of ["none", "css"] as const) {
        const result = renderGlyphChartMermaid(source, { target: "web", width, height, textScale: scale, color });
        const b = inkBounds(result.build.canvas);
        expect(b.top).toBeGreaterThan(0);
        expect(Math.abs(b.top - b.bottom)).toBeLessThanOrEqual(scale! * 2 - 1);
        expect(Math.abs(b.left - b.right)).toBeLessThanOrEqual(scale! * 2);
        expect(result.report.ledger.filter((e) => /omitted|outside the viewport/.test(e.message))).toEqual([]);
        // HTML and plain-text exits must share the same translated layout.
        if (color === "css") expect(result.html?.split("\n").findIndex((line) => line.replace(/<[^>]*>/g, "").trim())).toBe(b.top);
      }
    }
  });

  it("keeps scaled labels attached to their journey bars and Gantt milestones", () => {
    for (const type of ["journey", "gantt"]) for (const scale of [1, 2]) {
      const source = presets.find((p) => p.type === type)!.source;
      const { text } = renderGlyphChartMermaid(source, { target: "web", width: 120 * scale, height: 64 * scale, textScale: scale });
      const lines = text.split("\n");
      if (type === "gantt") { for (const label of ["Sign off", "Go live"]) expect(lines.find((line) => line.includes([...label].join(" ".repeat(scale - 1))))).toContain("●"); }
      else { for (const label of ["Find the store", "Compare plans", "Reorder"]) {
        const row = lines.findIndex((line) => line.includes([...label].join(" ".repeat(scale - 1))));
        expect(lines.slice(row, row + scale).some((line) => /[▄█]/.test(line))).toBe(true);
      } }
    }
  });

  it("keeps chat compact charts top anchored", () => {
    for (const { type, source } of presets.filter((p) => compact.includes(p.type))) {
      expect(bounds(renderGlyphChartMermaid(source, { target: "chat", width: 96, height: 64 }).text).top, type).toBe(0);
    }
  });

  it("leaves native and proportional charts unchanged by compact layout centring", () => {
    const native = renderGlyphChart(glyphChartBar([3, 5, 2]), { target: "web", width: 96, height: 64 });
    expect(native.build.plot.y1).toBeGreaterThan(55);
    for (const { source } of presets.filter((p) => p.owner === "charts" && !compact.includes(p.type))) {
      const a = renderGlyphChartMermaid(source, { target: "web", width: 96, height: 64 });
      const b = bounds(a.text);
      expect(b.top).toBeLessThan(7);
      expect(b.bottom).toBeLessThan(4);
    }
  });
});
