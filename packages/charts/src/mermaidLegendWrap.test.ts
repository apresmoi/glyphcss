import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { glyphChartFromMermaid, renderGlyphChartMermaid } from "./mermaid";
import { renderGlyphChart } from "./render";

const source = (JSON.parse(readFileSync("../../website/src/features/mermaid/data/examples.json", "utf8")) as { type: string; source: string }[]).find((p) => p.type === "pie")!.source;

describe("verbose Mermaid legends", () => {
  it.each(["chat", "web"] as const)("wraps all six pie legend entries whole in %s", (target) => {
    for (const width of [72, 96]) {
      const result = renderGlyphChartMermaid(source, { target, width, height: 24 });
      const lines = result.text.split("\n"), legend = lines.slice(-2);
      for (const label of ["Search [34]", "Direct [24]", "Email [18]", "Partners [12]", "Social [8]", "Other [4]"]) expect(legend.join("\n")).toContain(label);
      expect(legend.every((line) => line.trim())).toBe(true);
      expect(legend.map((line) => line.match(/\[\d+\]/g)?.length)).toEqual([3, 3]);
      expect(result.report.ledger.filter((e) => /label-abbreviated|label-dropped/.test(e.code))).toEqual([]);
      expect(renderGlyphChart(glyphChartFromMermaid(source), { target, width, height: 24 }).text).toBe(result.text);
    }
  });
});
