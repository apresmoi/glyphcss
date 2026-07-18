import type { Polygon, TextureSampler } from "@glyphcss/core";
import { describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import { createGlyphScene } from "../api/createGlyphScene";
import { defineGlyphEffect } from "../api/effects";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { rasterizeToCells } from "./rasterize";

const quad: Polygon = {
  vertices: [[-1, -1, 0], [-1, 1, 0], [1, 1, 0], [1, -1, 0]],
  color: "#ffffff",
  texture: "gray",
  uvs: [[0, 0], [0, 1], [1, 1], [1, 0]],
};

function quadContext(supersample = 1) {
  return buildRasterizeContext({
    camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 200 }),
    grid: { cols: 32, rows: 24, cellAspect: 2 },
    polygons: [quad],
    mode: "solid",
    useColors: false,
    doubleSided: true,
    supersample,
    directionalLight: { direction: [0, 0, -1], intensity: 0.5 },
    ambientLight: { intensity: 0.2 },
  });
}

function cubePolygons(): Polygon[] {
  const faces: Polygon["vertices"][] = [
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1]],
    [[-1, -1, 1], [1, 1, 1], [-1, 1, 1]],
    [[1, -1, -1], [-1, -1, -1], [-1, 1, -1]],
    [[1, -1, -1], [-1, 1, -1], [1, 1, -1]],
    [[-1, 1, 1], [1, 1, 1], [1, 1, -1]],
    [[-1, 1, 1], [1, 1, -1], [-1, 1, -1]],
  ];
  return faces.map((vertices) => ({ vertices, color: "#ffffff" }));
}

async function flushRenders(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("solid base shading retention", () => {
  it("retains the final clamped scalar that selects the glyph", () => {
    const grid = rasterizeToCells(quadContext());
    const center = 12 * grid.cols + 16;

    expect(grid.depth[center]).toBeGreaterThan(-Infinity);
    expect(grid.shade).toBeDefined();
    expect(grid.shade![center]).toBeCloseTo(0.7, 5);

    const empty = Array.from(grid.depth).findIndex((depth) => depth === -Infinity);
    expect(empty).toBeGreaterThanOrEqual(0);
    expect(grid.shade![empty]).toBeNaN();
  });

  it("includes texture luminance and box-filters supersampled edge shading", () => {
    const sampler: TextureSampler = {
      width: 1,
      height: 1,
      lowDetail: false,
      data: new Uint8ClampedArray([64, 64, 64, 255]),
    };
    const textured = quadContext();
    textured.directionalLight = { direction: [0, 0, -1], intensity: 0 };
    textured.ambientLight = { intensity: 1 };
    textured.textureSamplers = new Map([["gray", sampler]]);
    const texturedGrid = rasterizeToCells(textured);
    const center = 12 * texturedGrid.cols + 16;
    expect(texturedGrid.shade![center]).toBeCloseTo(64 / 255, 5);

    const supersampled = quadContext(2);
    const supersampledGrid = rasterizeToCells(supersampled);
    const finiteShade = Array.from(supersampledGrid.shade!).filter(Number.isFinite);
    expect(Math.max(...finiteShade)).toBeCloseTo(0.7, 5);
    expect(finiteShade.some((shade) => shade > 0 && shade < 0.7 - 1e-5)).toBe(true);
  });

  it("exposes shade on retained base and detail outputs when baseShade is required", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const frames: Array<{ coverage: number[]; shade?: number[] }> = [];
    const scene = createGlyphScene(host, {
      cols: 30,
      rows: 18,
      supersample: 2,
      useColors: false,
      camera: createGlyphOrthographicCamera({ zoom: 50 }),
      directionalLight: { direction: [0, 0, 1], intensity: 0 },
      ambientLight: { intensity: 0.3 },
    });
    scene.add(cubePolygons(), { density: 2 });
    scene.addEffectLayer({
      effect: defineGlyphEffect<{ phase: number }>({
        requirements: ["baseShade"],
        evaluate({ base }) {
          frames.push({
            coverage: Array.from(base.coverage),
            ...(base.shade ? { shade: Array.from(base.shade) } : {}),
          });
        },
      }),
      params: { phase: 0 },
    });

    await flushRenders();

    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames.every((frame) => frame.shade !== undefined)).toBe(true);
    const coveredDetail = frames.find((frame) => frame.coverage.some((coverage) => coverage > 0));
    expect(coveredDetail).toBeDefined();
    for (let i = 0; i < coveredDetail!.coverage.length; i++) {
      if (coveredDetail!.coverage[i]! > 0) expect(coveredDetail!.shade![i]).toBeCloseTo(0.3, 5);
    }

    scene.destroy();
    host.remove();
  });

  it("rerasterizes when a newly added layer introduces the baseShade requirement", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      cols: 30,
      rows: 18,
      useColors: false,
      camera: createGlyphOrthographicCamera({ zoom: 50 }),
      directionalLight: { direction: [0, 0, 1], intensity: 0 },
      ambientLight: { intensity: 0.4 },
    });
    scene.add(cubePolygons());
    scene.addEffectLayer({
      effect: defineGlyphEffect<{ phase: number }>({ evaluate() {} }),
      params: { phase: 0 },
    });
    await flushRenders();

    let coveredShade: number | undefined;
    scene.addEffectLayer({
      effect: defineGlyphEffect<{ phase: number }>({
        requirements: ["baseShade"],
        evaluate({ base }) {
          for (let i = 0; i < base.coverage.length; i++) {
            if (base.coverage[i]! > 0) {
              coveredShade = base.shade?.[i];
              break;
            }
          }
        },
      }),
      params: { phase: 0 },
    });
    await flushRenders();

    expect(coveredShade).toBeCloseTo(0.4, 5);
    scene.destroy();
    host.remove();
  });
});
