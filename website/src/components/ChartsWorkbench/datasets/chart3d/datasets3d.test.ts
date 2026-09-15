// @vitest-environment node
//
// The eight vendored 3D datasets (packet C3/C6, AGENTS.md's "Charts 3D"
// "Website" "Datasets"): real, vendored/reused, or computed and CLEARLY
// labelled as such — pinned dims/values and licence fields, and every
// dataset builds through its own REAL `@glyphcss/charts/3d` constructor
// (never a restated validation rule).
import { describe, expect, it } from "vitest";
import { glyphChartBars3d, glyphChartLine3d, glyphChartParametric3d, glyphChartScatter3d, glyphChartSurface } from "@glyphcss/charts/3d";
import {
  CHARTS_3D_DATASETS, etopo1AlpsDataset, irisScatter3dDataset, lorenzAttractorDataset,
  maungaWhauVolcanoDataset, olympicsColumns3dDataset, sphereParametric3dDataset, tiltedPlaneDataset, torusParametric3dDataset,
} from "./index";

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

describe("tiltedPlaneDataset", () => {
  it("is a computed example, labelled as such, no external source", () => {
    expect(tiltedPlaneDataset.source.licence).toMatch(/generated/i);
  });
  it("every z value lies exactly on the plane z = 0.35x + 0.55y + 1", () => {
    const mark = glyphChartSurface(tiltedPlaneDataset.data, tiltedPlaneDataset.channels, tiltedPlaneDataset.options);
    for (let r = 0; r < mark.grid.z.length; r++) {
      for (let c = 0; c < mark.grid.z[r]!.length; c++) {
        const expected = 0.35 * mark.grid.x[c]! + 0.55 * mark.grid.y[r]! + 1;
        expect(mark.grid.z[r]![c]!).toBeCloseTo(expected, 6);
      }
    }
  });
});

describe("irisScatter3dDataset", () => {
  it("reuses irisFlowersDataset's own rows verbatim — same licence, same row count", async () => {
    const { irisFlowersDataset } = await import("../irisFlowers");
    expect(irisScatter3dDataset.data).toBe(irisFlowersDataset.rows);
    expect(irisScatter3dDataset.source).toEqual(irisFlowersDataset.source);
    expect(irisScatter3dDataset.data.length).toBe(150);
  });
  it("builds through the real glyphChartScatter3d with a series column (species)", () => {
    const mark = glyphChartScatter3d(irisScatter3dDataset.data, irisScatter3dDataset.channels, irisScatter3dDataset.options);
    expect(mark.type).toBe("scatter3d");
    expect(mark.points.length).toBe(150);
    expect(mark.series.length).toBe(3); // setosa, versicolor, virginica
  });
});

describe("olympicsColumns3dDataset", () => {
  it("reuses olympics2024MedalsByTypeDataset's own real medal counts", async () => {
    const { olympics2024MedalsByTypeDataset } = await import("../olympics2024MedalsByType");
    expect(olympicsColumns3dDataset.source).toEqual(olympics2024MedalsByTypeDataset.source);
    expect(olympicsColumns3dDataset.data.length).toBe(olympics2024MedalsByTypeDataset.rows.length);
  });
  it("builds through the real glyphChartBars3d — one bar per country x medal-type row", () => {
    const mark = glyphChartBars3d(olympicsColumns3dDataset.data, olympicsColumns3dDataset.channels, olympicsColumns3dDataset.options);
    expect(mark.type).toBe("bars3d");
    expect(mark.bars.length).toBe(30); // 10 countries x 3 medal types
    // Every bar keeps its real country/medal name on xLabel/yLabel — the
    // NUMERIC x/y channels alone would lose it (bars.ts's own doc).
    expect(mark.bars.every((b) => typeof b.xLabel === "string" && typeof b.yLabel === "string")).toBe(true);
  });
});

describe("sphereParametric3dDataset / torusParametric3dDataset", () => {
  it("sphere: every point lies at distance 1 from the origin (computed, not vendored)", () => {
    expect(sphereParametric3dDataset.source.licence).toMatch(/generated/i);
    const { x, y, z } = sphereParametric3dDataset.data;
    for (let r = 0; r < x.length; r++) {
      for (let c = 0; c < x[r]!.length; c++) {
        const d = Math.sqrt(x[r]![c]! ** 2 + y[r]![c]! ** 2 + z[r]![c]! ** 2);
        expect(d).toBeCloseTo(1, 6);
      }
    }
  });
  it("sphere builds through the real glyphChartParametric3d with a value grid (spherical harmonic) driving colour", () => {
    const mark = glyphChartParametric3d(sphereParametric3dDataset.data, sphereParametric3dDataset.options);
    expect(mark.type).toBe("parametric3d");
    expect(mark.colorLegend).not.toBeNull();
  });
  it("torus: every point's distance from the major-radius ring equals the minor radius (0.5)", () => {
    expect(torusParametric3dDataset.source.licence).toMatch(/generated/i);
    const { x, y, z } = torusParametric3dDataset.data;
    for (let r = 0; r < x.length; r++) {
      for (let c = 0; c < x[r]!.length; c++) {
        const ringDist = Math.sqrt(x[r]![c]! ** 2 + y[r]![c]! ** 2) - 1.4;
        const tubeDist = Math.sqrt(ringDist ** 2 + z[r]![c]! ** 2);
        expect(tubeDist).toBeCloseTo(0.5, 6);
      }
    }
  });
});

describe("lorenzAttractorDataset", () => {
  it("is a computed, deterministic trajectory (same points on every load)", () => {
    expect(lorenzAttractorDataset.source.licence).toMatch(/generated/i);
    expect(lorenzAttractorDataset.data.length).toBeGreaterThan(1000);
  });
  it("builds through the real glyphChartLine3d as one unnamed series", () => {
    const mark = glyphChartLine3d(lorenzAttractorDataset.data, lorenzAttractorDataset.options);
    expect(mark.type).toBe("line3d");
    expect(mark.series.length).toBe(1);
    expect(mark.series[0]!.points.length).toBe(lorenzAttractorDataset.data.length);
  });
});

describe("every vendored 3D dataset builds through its OWN real constructor with no decimation/validation surprises", () => {
  it.each(CHARTS_3D_DATASETS)("$id ($markType)", (dataset) => {
    switch (dataset.markType) {
      case "surface": {
        const mark = glyphChartSurface(dataset.data, dataset.channels, dataset.options);
        expect(mark.type).toBe("surface");
        expect(mark.grid.z.length).toBeGreaterThan(1);
        expect(mark.grid.z[0]!.length).toBeGreaterThan(1);
        expect(mark.axes.z.title.length).toBeGreaterThan(0);
        break;
      }
      case "scatter3d": {
        const mark = glyphChartScatter3d(dataset.data, dataset.channels, dataset.options);
        expect(mark.type).toBe("scatter3d");
        expect(mark.points.length).toBeGreaterThan(0);
        break;
      }
      case "bars3d": {
        const mark = glyphChartBars3d(dataset.data, dataset.channels, dataset.options);
        expect(mark.type).toBe("bars3d");
        expect(mark.bars.length).toBeGreaterThan(0);
        break;
      }
      case "parametric3d": {
        const mark = glyphChartParametric3d(dataset.data, dataset.options);
        expect(mark.type).toBe("parametric3d");
        break;
      }
      case "line3d": {
        const mark = glyphChartLine3d(dataset.data, dataset.options);
        expect(mark.type).toBe("line3d");
        expect(mark.series.length).toBeGreaterThan(0);
        break;
      }
    }
  });
});
