import { describe, expect, it } from "vitest";
import { renderGlyphChartMermaid, glyphChartFromMermaid } from "./mermaid";
import { renderGlyphChart } from "./render";

const release = `gantt
 title Customer portal release
 dateFormat YYYY-MM-DD
 axisFormat %b %d
 section Discovery
 Interviews :done, research, 2026-04-06, 3d
 Prototype :done, design, after research, 4d
 Sign off :milestone, approved, after design, 0d
 section Delivery
 API :active, api, after approved, 5d
 Dashboard :active, ui, after approved, 7d
 Integration :crit, merge, after api ui, 3d
 section Launch
 Acceptance :crit, qa, after merge, 3d
 Runbook :docs, after ui, 4d
 Go live :milestone, after qa docs, 0d`;
const sections = ["Discovery", "Delivery", "Launch"];
const tasks = ["Interviews", "Prototype", "Sign off", "API", "Dashboard", "Integration", "Acceptance", "Runbook", "Go live"];

describe("Gantt content-sized axis", () => {
  for (const target of ["chat", "terminal", "web"] as const) {
    it.each([24, 30, 32, 40])(`${target} attaches the axis to the final task at height %i`, (height) => {
      const width = target === "web" ? 96 : 72;
      const result = renderGlyphChartMermaid(release, { target, width, height, color: "none" });
      const lines = result.text.split("\n");
      const last = lines.findIndex((line) => line.includes("Go live"));
      expect(last).toBeGreaterThan(0);
      expect(result.build.plot.y1).toBe(last + 1);
      expect(lines[last]).toContain("●");
      expect(lines[last + 1]).toContain("─");
      expect(lines[last + 2]).toContain("Apr");
      for (const label of [...sections, ...tasks]) expect(result.text).toContain(label);
      expect(result.report.ledger.filter((entry) => entry.detail?.feature === "Gantt row outside the viewport")).toEqual([]);

      const taskGaps = [[0, 1], [1, 2], [3, 4], [4, 5], [6, 7], [7, 8]].map(([a, b]) =>
        lines.findIndex((line) => line.includes(tasks[b!]!)) - lines.findIndex((line) => line.includes(tasks[a!]!)) - 1);
      expect(new Set(taskGaps).size).toBe(1);
      expect(taskGaps[0]).toBeGreaterThanOrEqual(0);
      expect(taskGaps[0]).toBeLessThanOrEqual(2);
      for (const [previous, section] of [["Sign off", "Delivery"], ["Integration", "Launch"]]) {
        const a = lines.findIndex((line) => line.includes(previous!));
        const b = lines.findIndex((line) => line.trim() === section);
        expect(b - a - 1).toBe(taskGaps[0]! + 1);
        expect(lines.slice(a + 1, b).every((line) => !line.trim())).toBe(true);
      }

      const occupied = lines.map((line, row) => ({ line, row })).filter(({ line }) => line.trim());
      const top = occupied[0]!.row, bottom = height - occupied.at(-1)!.row - 1;
      if (target === "web") expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);
      else expect(top).toBe(0);
      if (height === 40) expect(occupied.at(-1)!.row - top + 1).toBeLessThan(height);
      expect(result.build.resolved.charset).toBe(target === "chat" ? "box" : "braille");
    });
  }

  it.each(["chat", "web"] as const)("%s trims indivisible surplus at a forced 40 rows", (target) => {
    const source = `${release}\n Monitor :monitor, after qa, 1d\n Handover :handover, after monitor, 1d\n Close :after handover, 1d`;
    const result = renderGlyphChartMermaid(source, { target, width: 72, height: 40 });
    const lines = result.text.split("\n"), last = lines.findIndex((line) => line.includes("Close"));
    expect(last).toBeGreaterThan(0);
    expect(result.build.plot.y1).toBe(last + 1);
    expect(lines[last + 1]).toContain("─");
  });

  it.each([1, 2, 3])("attaches scaled bands and chrome at textScale %i", (textScale) => {
    const result = renderGlyphChartMermaid(release, { target: "web", width: 144 * textScale, height: 48 * textScale, textScale });
    const lines = result.text.split("\n"), label = [..."Go live"].join(" ".repeat(textScale - 1));
    const last = lines.findIndex((line) => line.includes(label));
    expect(last).toBeGreaterThan(0);
    expect(result.build.plot.y1).toBe(last + textScale);
    expect(lines[result.build.plot.y1]).toContain("─");
  });

  it.each([
    "gantt\nOnly task :2026-04-06, 2d",
    "gantt\nFirst :a, 2026-04-06, 2d\nLast :after a, 1d",
    "gantt\nsection Release\nOnly task :2026-04-06, 2d",
  ])("trims unused plot rows with or without section/task boundaries: %s", (source) => {
    for (const target of ["chat", "web"] as const) {
      const result = renderGlyphChartMermaid(source, { target, width: 72, height: 40 });
      const lines = result.text.split("\n"), last = lines.findIndex((line) => /Only task|Last/.test(line));
      expect(result.build.plot.y1).toBe(last + 1);
      expect(lines[last + 1]).toContain("─");
    }
  });

  it.each([8, 9, 10, 11])("places the axis after the final visible task at clipped height %i", (height) => {
    for (const target of ["chat", "web"] as const) {
      const result = renderGlyphChartMermaid(release, { target, width: 72, height });
      const lines = result.text.split("\n"), last = lines.reduce((last, line, row) => tasks.some((task) => line.includes(task)) ? row : last, -1);
      expect(last).toBeGreaterThan(0);
      expect(result.build.plot.y1).toBe(last + 1);
      expect(result.report.ledger.some((entry) => entry.detail?.feature === "Gantt row outside the viewport")).toBe(true);
    }
  });

  it("moves bottom title and marker legend with the axis", () => {
    const spec = glyphChartFromMermaid("gantt\nOnly task :2026-04-06, 2d\nMarker :vert, 2026-04-07, 0d");
    for (const target of ["chat", "web"] as const) {
      const result = renderGlyphChart({ ...spec, title: { text: "Bottom title", position: "bottom" } }, { target, width: 72, height: 40 });
      const lines = result.text.split("\n"), last = lines.findIndex((line) => line.includes("Only task"));
      expect(result.build.plot.y1).toBe(last + 1);
      const title = lines.findIndex((line) => line.includes("Bottom title")), legend = lines.findIndex((line) => line.includes("Marker"));
      expect(title).toBeGreaterThan(result.build.plot.y1);
      expect(legend).toBeGreaterThan(result.build.plot.y1);
      expect(Math.max(title, legend) - result.build.plot.y1).toBeLessThanOrEqual(4);
    }
  });
});
