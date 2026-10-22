import { describe, expect, it } from "vitest";
import { staticGallery, staticLoader, staticMap, staticSynth, staticWordArt } from "./scenes";
import { staticDiagrams } from "../../features/diagrams/render/staticDiagrams";
import { staticCharts } from "../../features/charts/render/staticCharts";

describe("build-time workbench renders", () => {
  it("renders every diagram family from the shared corpus", async () => {
    const result = await staticDiagrams();
    expect(result.initial.source).toContain("flowchart");
    expect(result.examples).toHaveLength(16);
    for (const entry of [result.initial, ...result.examples]) expect(entry.text.trim().length).toBeGreaterThan(30);
    expect(result.examples.map((entry) => entry.title)).toEqual(expect.arrayContaining(["sequenceDiagram", "gitGraph", "C4Deployment"]));
  }, 60000);

  it("renders Mermaid charts and native-only presets", () => {
    const result = staticCharts();
    expect(result.examples).toHaveLength(16);
    expect(result.examples.map((entry) => entry.title)).toEqual(expect.arrayContaining(["gantt", "radar", "Heatmap", "Funnel", "Area", "Donut"]));
    for (const entry of [result.initial, ...result.examples]) expect(entry.text.trim().length).toBeGreaterThan(30);
  });

  it.each([staticGallery, staticLoader, staticMap, staticSynth, staticWordArt])("renders %s without a browser", async (render) => {
    const result = await render();
    expect(result.text.trim().length).toBeGreaterThan(30);
    expect(result.text.split("\n").filter((line) => line.trim()).length).toBeGreaterThan(2);
  });
});
