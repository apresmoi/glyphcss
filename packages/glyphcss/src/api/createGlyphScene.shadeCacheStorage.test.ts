/**
 * What the scene hands the rasterizer as its cross-frame shade cache. A
 * growable JS array written at scattered positional indices drops V8 into
 * dictionary elements (most of the rasterizer's self time on a street-level
 * map), so the contract is dense typed storage sized to the pass's triangle
 * count - including after a dirtying `setOptions`, which is every frame of a
 * moving map camera.
 */
import { describe, expect, it, vi } from "vitest";
import type { Polygon } from "@glyphcss/core";
import type { ShadeCache } from "./rasterizeContext";

const captured: ShadeCache[] = [];
vi.mock("../render/rasterize", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../render/rasterize")>();
  return {
    ...actual,
    rasterize: (ctx: { shadeCache?: ShadeCache | null }) => {
      if (ctx.shadeCache) captured.push(ctx.shadeCache);
      return actual.rasterize(ctx as never);
    },
  };
});

const { createGlyphScene } = await import("./createGlyphScene");

function tris(count: number): Polygon[] {
  return Array.from({ length: count }, () => ({
    vertices: [[0, 1, 0], [-1, -1, 0], [1, -1, 0]] as [number, number, number][],
    color: "#aaaaaa",
  }));
}

describe("createGlyphScene shade-cache storage", () => {
  it("hands the rasterizer Float64Array storage sized to the triangle count, dirty or warm or grown", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, { cols: 8, rows: 4, useColors: true });
    scene.add(tris(40));
    scene.rerender();

    const last = () => captured[captured.length - 1]!;
    expect(last().iA).toBeInstanceOf(Float64Array);
    expect(last().iB).toBeInstanceOf(Float64Array);
    expect(last().iC).toBeInstanceOf(Float64Array);
    expect(last().iA.length).toBe(40);
    expect(last().lit.length).toBe(40);

    // Dirtying setOptions: the map's per-frame light follow.
    scene.setOptions({ directionalLight: { direction: [0.2, 0.5, 0.8], intensity: 0.7 } });
    scene.rerender();
    expect(last().iA).toBeInstanceOf(Float64Array);
    expect(last().iA.length).toBe(40);
    expect(Array.from(last().iA).some((v) => !Number.isNaN(v))).toBe(true);

    scene.add(tris(25));
    scene.rerender();
    expect(last().iA).toBeInstanceOf(Float64Array);
    expect(last().iA.length).toBe(65);
    scene.destroy();
  });
});
