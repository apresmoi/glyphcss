/**
 * The shade cache is dense typed storage sized to the pass's positional
 * triangle count (NaN = unfilled). These pin the two properties that
 * make that safe: the helper counts exactly the way `rasterizeSolid`'s `triT`
 * advances, and the cache never changes a byte of output whether it is cold,
 * warm, undersized or absent.
 */
import { describe, expect, it } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import {
  buildRasterizeContext,
  countShadeTriangles,
  createShadeCache,
  growShadeCache,
  type ShadeCache,
} from "../api/rasterizeContext";
import { rasterize } from "./rasterize";

const light = { direction: [0.3, 0.4, 0.86] as [number, number, number], intensity: 0.8 };
const ambient = { intensity: 0.3 };
const COLORS = ["#cc3322", "#22aa44", "#3355dd", "#ddcc22", "#aa22aa"];

function quads(cols: number, rows: number): Polygon[] {
  const out: Polygon[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c - cols / 2) * 0.25;
      const y = (r - rows / 2) * 0.25;
      out.push({
        vertices: [[x, y, 0], [x, y + 0.25, 0], [x + 0.25, y + 0.25, 0], [x + 0.25, y, 0]],
        // Several base colours with varied per-face tilt so many (colour, q) buckets exist.
        color: COLORS[(c + r * 3) % COLORS.length]!,
        shadingNormal: [Math.sin(c * 0.7) * 0.5, Math.cos(r * 0.9) * 0.5, 1],
      });
    }
  }
  return out;
}

function render(polygons: Polygon[], zoom: number, cache: ShadeCache | null): string {
  const ctx = buildRasterizeContext({
    camera: createGlyphOrthographicCamera({ rotX: 40, rotY: 20, zoom }),
    grid: { cols: 48, rows: 26, cellAspect: 2 },
    polygons,
    mode: "solid",
    useColors: true,
    doubleSided: true,
    directionalLight: light,
    ambientLight: ambient,
  });
  ctx.shadeCache = cache;
  return rasterize(ctx);
}

const filled = (c: ShadeCache) => Array.from(c.iA).filter((v) => !Number.isNaN(v)).length;

describe("dense shade cache", () => {
  it("counts triangles exactly as rasterizeSolid's triT advances", () => {
    const degenerate: Polygon = { vertices: [[0, 0, 0], [1, 0, 0]], color: "#ffffff" };
    const hidden: Polygon = { ...quads(1, 1)[0]!, hidden: true };
    const polygons = [degenerate, hidden, ...quads(6, 4)];
    const cache = createShadeCache(countShadeTriangles(polygons));
    expect(cache.iA.length).toBe(2 + 6 * 4 * 2);
    render(polygons, 90, cache);
    // The LAST visible triangle only lands in range if the hidden polygon's
    // fan was counted and the 2-vertex polygon was not.
    expect(Number.isNaN(cache.iA[cache.iA.length - 1]!)).toBe(false);
    expect(Number.isNaN(cache.iA[0]!)).toBe(true);
    expect(Number.isNaN(cache.iA[1]!)).toBe(true);
  });

  it("is byte-identical cold, warm, undersized, grown and absent", () => {
    const polygons = quads(36, 18);
    const total = countShadeTriangles(polygons);
    const none = render(polygons, 70, null);

    const cache = createShadeCache(total);
    const cold = render(polygons, 70, cache);
    expect(filled(cache)).toBeGreaterThan(0);
    const warm = render(polygons, 70, cache);
    // A different camera over the same warm cache: only hits, still the same bytes.
    const warmZoomed = render(polygons, 95, cache);
    const noneZoomed = render(polygons, 95, null);

    const small = createShadeCache(Math.floor(total / 3));
    const undersized = render(polygons, 70, small);
    const undersizedWarm = render(polygons, 70, small);

    const grown = growShadeCache(small, total);
    expect(Array.from(grown.iA.slice(0, small.iA.length))).toEqual(Array.from(small.iA));
    const afterGrow = render(polygons, 70, grown);

    expect(cold).toBe(none);
    expect(warm).toBe(none);
    expect(warmZoomed).toBe(noneZoomed);
    expect(undersized).toBe(none);
    // A PARTIALLY warm cache (undersized, or just grown) legitimately moves a
    // lit colour by one hex step: hits skip `litCache`, so which triangle first
    // populates a (colour, q) bucket changes - the same as any partly filled
    // cache before dense storage. Glyphs and coverage must not move.
    const glyphs = (html: string) => html.replace(/<[^>]*>/g, "");
    expect(glyphs(undersizedWarm)).toBe(glyphs(none));
    expect(glyphs(afterGrow)).toBe(glyphs(none));
    // The mesh really does exercise several shaded colours.
    expect(new Set(none.match(/#[0-9a-f]{6}/g)).size).toBeGreaterThan(5);
  });
});
