import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderGlyphDiagram } from "./render";
import { computeGlyphDiagramQuality } from "./quality";

const presets = JSON.parse(readFileSync("../../website/src/features/mermaid/data/examples.json", "utf8")) as { type: string; source: string; height: number }[];

describe("compound Mermaid showcase width", () => {
  it.each(["C4Context", "C4Container"])("keeps %s within 72 columns before expanding sideways", async (type) => {
    const preset = presets.find((p) => p.type === type)!;
    const options = { target: "web" as const, width: 72, height: preset.height, overflow: "expand" as const };
    const result = await renderGlyphDiagram(preset.source, options);
    expect(result.canvas.cols).toBe(72);
    expect(result.layout.direction).toBe("TB");
    expect(computeGlyphDiagramQuality(result, options)).toMatchObject({ wordCuts: 0, crossings: 0, fakeFrames: 0, droppedEdges: 0, droppedLabels: 0 });
  }, 30000);
});
