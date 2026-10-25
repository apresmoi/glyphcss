/**
 * The shade cache is dense typed storage sized to the pass's positional
 * triangle count, with occupancy in a separate `filled` flag. These pin the
 * two properties that make that safe: the helper counts exactly the way
 * `rasterizeSolid`'s `triT` advances, and the cache never changes a byte of
 * output - checked against goldens captured from the rasterizer as it was
 * before dense storage (parent 79241b09), full HTML with colour, not against
 * this implementation.
 */
import { describe, expect, it } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import {
  buildRasterizeContext,
  clearShadeCacheEntry,
  countShadeTriangles,
  createShadeCache,
  type ShadeCache,
} from "../api/rasterizeContext";
import { rasterize } from "./rasterize";
import { runScenarios } from "./shadeCacheScenarios";
import golden from "./__fixtures__/shadeCacheParentGolden.json";

function render(polygons: Polygon[], cache: ShadeCache): void {
  const ctx = buildRasterizeContext({
    camera: createGlyphOrthographicCamera({ rotX: 40, rotY: 20, zoom: 90 }),
    grid: { cols: 48, rows: 26, cellAspect: 2 },
    polygons,
    mode: "solid",
    useColors: true,
    doubleSided: true,
    directionalLight: { direction: [0.3, 0.4, 0.86], intensity: 0.8 },
    ambientLight: { intensity: 0.3 },
  });
  ctx.shadeCache = cache;
  rasterize(ctx);
}

function quads(n: number): Polygon[] {
  return Array.from({ length: n }, (_, i) => {
    const x = (i - n / 2) * 0.25;
    return { vertices: [[x, 0, 0], [x, 0.25, 0], [x + 0.25, 0.25, 0], [x + 0.25, 0, 0]], color: "#cc3322" } as Polygon;
  });
}

describe("dense shade cache", () => {
  it("counts triangles exactly as rasterizeSolid's triT advances", () => {
    const degenerate: Polygon = { vertices: [[0, 0, 0], [1, 0, 0]], color: "#ffffff" };
    const hidden: Polygon = { ...quads(1)[0]!, hidden: true };
    const polygons = [degenerate, hidden, ...quads(12)];
    const cache = createShadeCache(countShadeTriangles(polygons));
    expect(cache.iA.length).toBe(2 + 12 * 2);
    render(polygons, cache);
    // The last visible triangle only lands in range if the hidden polygon's
    // fan was counted and the 2-vertex polygon was not.
    expect(cache.filled[cache.filled.length - 1]).toBe(1);
    expect(cache.filled[0]).toBe(0);
    expect(cache.filled[1]).toBe(0);
  });

  it("renders every cold / warm / partial / NaN / rollback / bucket-arrival scenario exactly as the parent did", () => {
    const got = runScenarios<ShadeCache>({
      make: (n) => createShadeCache(n, true),
      undo: (cache, t) => clearShadeCacheEntry(cache, t),
    });
    expect(got).toEqual(golden);
    // The bucket scenarios must actually discriminate arrival order, or they prove nothing.
    expect(new Set([got.bucketLoFirst, got.bucketHiFirst, got.bucketHiWarmThenLo]).size).toBe(3);
  });
});
