import { describe, it, expect } from "vitest";
import { buildSceneContext, computeSceneBbox } from "./context";
import type { Polygon } from "../types";

describe("computeSceneBbox", () => {
  it("returns zero-extent bbox at origin for empty input", () => {
    const bbox = computeSceneBbox([]);
    expect(bbox.min).toEqual([0, 0, 0]);
    expect(bbox.max).toEqual([0, 0, 0]);
  });

  it("returns zero-extent bbox at origin when polygons have no vertices", () => {
    const bbox = computeSceneBbox([{ vertices: [] }]);
    expect(bbox.min).toEqual([0, 0, 0]);
    expect(bbox.max).toEqual([0, 0, 0]);
  });

  it("computes bbox across single polygon vertices", () => {
    const polys: Polygon[] = [{ vertices: [[0, 0, 0], [3, 0, 0], [0, 4, 0]] }];
    const bbox = computeSceneBbox(polys);
    expect(bbox.min).toEqual([0, 0, 0]);
    expect(bbox.max).toEqual([3, 4, 0]);
  });

  it("computes bbox across multiple polygons", () => {
    const polys: Polygon[] = [
      { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] },
      { vertices: [[-2, -3, 5], [10, 0, 0], [0, 0, -1]] },
    ];
    const bbox = computeSceneBbox(polys);
    expect(bbox.min).toEqual([-2, -3, -1]);
    expect(bbox.max).toEqual([10, 1, 5]);
  });
});

describe("buildSceneContext", () => {
  it("returns empty result for empty polygon list", () => {
    const result = buildSceneContext({ polygons: [] });
    expect(result.context.polygons).toEqual([]);
    expect(result.context.sceneBbox.min).toEqual([0, 0, 0]);
    expect(result.context.sceneBbox.max).toEqual([0, 0, 0]);
    expect(result.warnings).toEqual([]);
  });

  it("normalizes input polygons by default", () => {
    const polys: Polygon[] = [
      { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] },
      { vertices: [[0, 0, 0], [1, 0, 0]] }, // < 3 vertices → dropped
    ];
    const result = buildSceneContext({ polygons: polys });
    expect(result.context.polygons).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("skips normalization when skipNormalize is set", () => {
    const polys: Polygon[] = [
      { vertices: [[0, 0, 0], [1, 0, 0]] }, // would be dropped by normalize
    ];
    const result = buildSceneContext({ polygons: polys, skipNormalize: true });
    expect(result.context.polygons).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it("computes scene bbox + size from polygon vertices", () => {
    const polys: Polygon[] = [
      { vertices: [[0, 0, 0], [10, 0, 0], [0, 5, 0]] },
    ];
    const result = buildSceneContext({ polygons: polys });
    expect(result.dimensions.sceneBbox.min).toEqual([0, 0, 0]);
    expect(result.dimensions.sceneBbox.max).toEqual([10, 5, 0]);
    expect(result.dimensions.size).toEqual([10, 5, 0]);
  });

  it("propagates warnings from normalize into the result", () => {
    const polys: Polygon[] = [
      { vertices: [[0, 0, 0], [1, 0, 0]] },
    ];
    const result = buildSceneContext({ polygons: polys });
    expect(result.warnings).toEqual(result.context.warnings);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
