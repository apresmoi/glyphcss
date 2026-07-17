import type { Polygon } from "@glyphcss/core";
import { describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import { createGlyphScene } from "../api/createGlyphScene";
import { defineGlyphEffect } from "../api/effects";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { rasterizeToCells } from "./rasterize";

const quad: Polygon = {
  vertices: [[-1, -1, 0], [-1, 1, 0], [1, 1, 0], [1, -1, 0]],
  color: "#ffffff",
};

function context(polygons: Polygon[], supersample = 1) {
  return buildRasterizeContext({
    camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 200 }),
    grid: { cols: 32, rows: 24, cellAspect: 2 },
    polygons,
    mode: "solid",
    useColors: false,
    doubleSided: true,
    supersample,
    directionalLight: { direction: [0, 0, 1], intensity: 0 },
    ambientLight: { intensity: 1 },
  });
}

async function flushRenders(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("retained surface fields", () => {
  it("retains finite world positions and normalized geometric face normals", () => {
    const grid = rasterizeToCells(context([quad]));
    const center = 12 * grid.cols + 16;

    expect(grid.depth[center]).toBeGreaterThan(-Infinity);
    expect(grid.worldPosition).toBeDefined();
    expect(grid.normal).toBeDefined();
    expect(grid.worldPosition![center * 3]).toBeCloseTo(0, 5);
    expect(grid.worldPosition![center * 3 + 1]).toBeCloseTo(0, 5);
    expect(grid.worldPosition![center * 3 + 2]).toBeCloseTo(0, 5);
    expect(grid.normal![center * 3]).toBeCloseTo(0, 5);
    expect(grid.normal![center * 3 + 1]).toBeCloseTo(0, 5);
    expect(grid.normal![center * 3 + 2]).toBeCloseTo(-1, 5);

    const empty = Array.from(grid.depth).findIndex((depth) => depth === -Infinity);
    expect(empty).toBeGreaterThanOrEqual(0);
    expect(grid.worldPosition![empty * 3]).toBeNaN();
    expect(grid.normal![empty * 3]).toBeNaN();
  });

  it("copies one coherent winning face normal through supersampling", () => {
    const left: Polygon = {
      vertices: [[-1.4, -1, 0], [0, -1, 0], [0, 1, 0], [-1.4, 1, 0]],
      color: "#ffffff",
    };
    const right: Polygon = {
      vertices: [[0, -1, 0], [1.4, -1, 0.8], [1.4, 1, 0.8], [0, 1, 0]],
      color: "#ffffff",
    };
    const grid = rasterizeToCells(context([left, right], 2));
    const expected = [
      [0, 0, 1],
      [-0.49613893835683387, 0, 0.8682431421244592],
    ] as const;
    const seen = new Set<number>();

    for (let i = 0; i < grid.depth.length; i++) {
      if (grid.depth[i] === -Infinity) continue;
      const nx = grid.normal![i * 3]!;
      const ny = grid.normal![i * 3 + 1]!;
      const nz = grid.normal![i * 3 + 2]!;
      const match = expected.findIndex(([x, y, z]) => Math.hypot(nx - x, ny - y, nz - z) < 1e-5);
      expect(match).toBeGreaterThanOrEqual(0);
      seen.add(match);
    }
    expect(seen).toEqual(new Set([0, 1]));
  });

  it("provides optional surface inputs in solid mode and falls back cleanly in wireframe", async () => {
    const solidHost = document.createElement("div");
    document.body.appendChild(solidHost);
    let captured: {
      world?: number;
      normal?: number;
      scale?: number;
    } = {};
    const solid = createGlyphScene(solidHost, {
      cols: 30,
      rows: 18,
      useColors: false,
      doubleSided: true,
      camera: createGlyphOrthographicCamera({ zoom: 50 }),
    });
    solid.add([quad]);
    solid.addEffectLayer({
      effect: defineGlyphEffect<{ phase: number }>({
        optionalRequirements: ["worldPosition", "normal"],
        evaluate({ base, coordinates }) {
          const covered = Array.from(base.coverage).findIndex((value) => value > 0);
          if (covered < 0) return;
          captured = {
            world: base.worldPosition?.[covered * 3],
            normal: base.normal?.[covered * 3 + 2],
            scale: coordinates.worldToSceneScale,
          };
        },
      }),
      params: { phase: 0 },
    });
    await flushRenders();

    expect(captured.world).toBeTypeOf("number");
    expect(captured.normal).toBeCloseTo(-1, 5);
    expect(captured.scale).toBeCloseTo(9, 5);
    solid.destroy();
    solidHost.remove();

    const wireHost = document.createElement("div");
    document.body.appendChild(wireHost);
    let wireHasFields = true;
    const wire = createGlyphScene(wireHost, { mode: "wireframe", useColors: false });
    wire.add([quad]);
    expect(() => wire.addEffectLayer({
      effect: defineGlyphEffect<{ phase: number }>({
        optionalRequirements: ["worldPosition", "normal"],
        evaluate({ base }) {
          wireHasFields = base.worldPosition !== undefined || base.normal !== undefined;
        },
      }),
      params: { phase: 0 },
    })).not.toThrow();
    await flushRenders();
    expect(wireHasFields).toBe(false);
    wire.destroy();
    wireHost.remove();
  });
});
