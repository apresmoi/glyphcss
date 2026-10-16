import { afterAll, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { renderGlyphChartMermaid } from "./mermaid";
import { glyphChartFromMermaid } from "./mermaid";
import { renderGlyphChart } from "./render";
import { glyphChartBar, glyphChartLine } from "./spec";
import { encodeGlyphCanvasText } from "glyphcss";
import { GLYPH_CHART_ARC_FILL, GLYPH_CHART_ARC_CALLOUT_GUTTER_COLS } from "./paint";

const presets = JSON.parse(readFileSync("../../website/src/features/mermaid/data/examples.json", "utf8")) as { type: string; source: string; height: number }[];
const captures: unknown[] = [];
for (const target of ["chat", "web"] as const) for (const preset of presets.filter(p => /^(pie|xychart)/.test(p.type))) {
  it(`${preset.type} ${target} final showcase`, () => {
    const result = renderGlyphChartMermaid(preset.source, { target, color: target === "web" ? "css" : "none", width: target === "chat" ? 72 : 96, height: target === "chat" ? preset.height : 32 });
    captures.push({ type: preset.type, source: preset.source, target, width: result.build.canvas.cols, height: result.build.canvas.rows, text: target === "web" ? encodeGlyphCanvasText(result.build.colorCanvas) : result.text, html: result.html, ledger: result.report.ledger });
    expect(result.text).toContain("Portal");
    if (preset.type.startsWith("xychart")) {
      expect(result.meta.series).toEqual(["Bar", "Line"]);
      expect(result.text).toContain("Bar"); expect(result.text).toContain("Line");
      if (target === "web") {
        expect(result.html).toContain("#3b82f6"); expect(result.html).toContain("#f97316");
      }
    } else {
      const { plot, canvas } = result.build;
      const cols = plot.x1 - plot.x0 + 1, rows = plot.y1 - plot.y0 + 1;
      const gutter = Math.min(GLYPH_CHART_ARC_CALLOUT_GUTTER_COLS, Math.floor(cols / 4));
      const ry = Math.min(rows, (cols - 2 * gutter) * canvas.cellAspect) * GLYPH_CHART_ARC_FILL / 2;
      const rx = ry / canvas.cellAspect, cx = (plot.x0 + plot.x1) / 2, cy = (plot.y0 + plot.y1) / 2;
      for (let y = plot.y0; y <= plot.y1; y++) for (let x = plot.x0; x <= plot.x1; x++) {
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1) continue;
        expect(canvas.grid.char[y * canvas.cols + x], `disc at ${x},${y}`).toMatch(/^[█░▚╱▌═]$/);
      }
    }
  });
}

it.each(["texture", "solid"] as const)("keeps native %s bars behind the sub-cell line at every full-cell intersection", regionFill => {
  const bars = glyphChartBar([8, 8, 8], undefined, { name: "Orders" });
  const line = glyphChartLine([2, 5, 3], undefined, { name: "Target" });
  const options = { target: "web", color: "css", width: 72, height: 24, regionFill } as const;
  const both = renderGlyphChart({ marks: [bars, line] }, options).build.colorCanvas;
  const baseline = renderGlyphChart({ marks: [bars, { ...line, data: [0, 0, 0] }] }, options).build.colorCanvas;
  let intersections = 0;
  for (let i = 0; i < both.grid.char.length; i++) {
    if (baseline.grid.char[i] !== "█" || both.grid.color[i] !== "#f97316") continue;
    intersections++;
    expect(both.bg[i], `cell ${i % both.cols},${Math.floor(i / both.cols)} ${both.grid.char[i]}`).toBe("#3b82f6");
  }
  expect(intersections).toBeGreaterThan(3);
});

it("preserves authored names and allocates distinct unnamed XY names", () => {
  const spec = glyphChartFromMermaid('xychart\nbar "Line" [3,4]\nline [2,3]\nbar [1,2]');
  expect(renderGlyphChart(spec).meta.series).toEqual(["Line", "Line 2", "Bar 1"]);
});
afterAll(() => { if (process.env.GLYPH_FINAL_CAPTURE) writeFileSync(process.env.GLYPH_FINAL_CAPTURE, JSON.stringify(captures, null, 2)); });
