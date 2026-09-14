// @vitest-environment node
//
// The two vendored 3D datasets (packet C3, AGENTS.md's "Charts 3D" "Website"
// "Datasets"): real, vendored, credited — pinned dims and licence fields.
import { describe, expect, it } from "vitest";
import { glyphChartSurface } from "@glyphcss/charts/3d";
import { CHARTS_3D_DATASETS, etopo1AlpsDataset, maungaWhauVolcanoDataset } from "./index";

describe("maungaWhauVolcanoDataset", () => {
  it("is the real 87x61 R volcano grid (Plotly's own surface example dims)", () => {
    expect(maungaWhauVolcanoDataset.data.z.length).toBe(87);
    expect(maungaWhauVolcanoDataset.data.z[0]!.length).toBe(61);
  });
  it("elevation values fall in R's documented 94..195 range", () => {
    const flat = maungaWhauVolcanoDataset.data.z.flat();
    expect(Math.min(...flat)).toBe(94);
    expect(Math.max(...flat)).toBe(195);
  });
  it("carries a credited, real source with a licence string", () => {
    expect(maungaWhauVolcanoDataset.source.url).toContain("plotly/datasets");
    expect(maungaWhauVolcanoDataset.source.licence.length).toBeGreaterThan(0);
  });
});

describe("etopo1AlpsDataset", () => {
  it("comes from the repo's own baked geo-tiles pyramid, credited to NOAA", () => {
    expect(etopo1AlpsDataset.source.name).toContain("NOAA");
    expect(etopo1AlpsDataset.source.licence).toBe("Public domain (NOAA)");
  });
  it("covers real Alpine terrain (elevation well above sea level somewhere in the window)", () => {
    const flat = etopo1AlpsDataset.data.z.flat();
    expect(Math.max(...flat)).toBeGreaterThan(2000);
  });
});

describe("every vendored 3D dataset builds through the real glyphChartSurface with no decimation surprises", () => {
  it.each(CHARTS_3D_DATASETS)("$id", (dataset) => {
    const mark = glyphChartSurface(dataset.data, dataset.channels, dataset.options);
    expect(mark.type).toBe("surface");
    expect(mark.grid.z.length).toBeGreaterThan(1);
    expect(mark.grid.z[0]!.length).toBeGreaterThan(1);
    // Mutation check: dropping the argmax/argmin retention in
    // `gridSurfacePolygons` (core, C1's own gate) would not be caught HERE
    // — this only pins that the model step itself never throws or drops the
    // dataset's own declared axis titles.
    expect(mark.axes.z.title.length).toBeGreaterThan(0);
  });
});
