import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Polygon } from "@glyphcss/core";
import { createGlyphOrthographicCamera, createGlyphPerspectiveCamera } from "../api/createGlyphCamera";
import { buildRasterizeContext, type OcclusionMap } from "../api/rasterizeContext";
import { rasterize, rasterizeToCells } from "./rasterize";
import { cloneCellGrid } from "./cells";

const light = { direction: [0, 0, 1] as [number, number, number], intensity: 0 };
const ambient = { intensity: 1 };

function quad(z: number, x0 = -1, x1 = 1): Polygon {
  return {
    vertices: [[x0, -1, z], [x0, 1, z], [x1, 1, z], [x1, -1, z]],
    color: "#ffffff",
  };
}

function polygon(vertices: [number, number, number][]): Polygon {
  return { vertices, color: "#ffffff" };
}

function context(polygons: Polygon[], supersample = 1, perspective = false) {
  return buildRasterizeContext({
    camera: perspective
      ? createGlyphPerspectiveCamera({ rotX: 0, rotY: 0, perspective: 500, zoom: 100 })
      : createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 160 }),
    grid: { cols: 32, rows: 24, cellAspect: 2 },
    polygons,
    mode: "solid",
    useColors: false,
    doubleSided: true,
    supersample,
    directionalLight: light,
    ambientLight: ambient,
  });
}

function coveredCenter(grid: ReturnType<typeof rasterizeToCells>): number {
  const center = (grid.rows >> 1) * grid.cols + (grid.cols >> 1);
  expect(grid.depth[center]).toBeGreaterThan(-Infinity);
  return center;
}

describe("solid winner polygon capture", () => {
  it("retains the depth-winning positional polygon index for orthographic and perspective cameras", () => {
    const ortho = rasterizeToCells(context([quad(0), quad(1)]));
    const orthoCenter = coveredCenter(ortho);
    expect(ortho.winnerPolygon).toBeInstanceOf(Int32Array);
    expect(ortho.winnerPolygon![orthoCenter]).toBe(1);

    const perspective = rasterizeToCells(context([quad(-2), quad(0)], 1, true));
    const perspectiveCenter = coveredCenter(perspective);
    expect(perspective.winnerPolygon![perspectiveCenter]).toBe(1);
  });

  it("uses stable paint order for exact depth ties and keeps distinct surfaces separate for repeated classes", () => {
    const grid = rasterizeToCells(context([quad(0), quad(0)]));
    expect(grid.winnerPolygon![coveredCenter(grid)]).toBe(0);
    const repeatedClassSurfaces = rasterizeToCells(context([quad(0, -1.4, -0.1), quad(0, 0.1, 1.4)]));
    // Both entries may resolve to one semantic class later, but their positional
    // winners remain distinct opaque surface lookup keys.
    expect(new Set(Array.from(repeatedClassSurfaces.winnerPolygon!).filter((value) => value >= 0))).toEqual(new Set([0, 1]));
  });

  it("resolves fixture-side polygon → surface → instance → class → dictionary lineage for distinct instances of one class", () => {
    const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "../../research/ascii-image-generation/fixtures/lineage/winner-lineage.json"), "utf8")) as {
      dictionary: { classes: { id: number; semanticGlyph: string; color: string }[] };
      scene: {
        instances: { id: string; classId: number }[];
        surfaces: { id: string; instanceId: string }[];
        polygons: { index: number; surfaceId: string; vertices: [number, number, number][] }[];
      };
    };
    const grid = rasterizeToCells(context(fixture.scene.polygons.map(({ vertices }) => polygon(vertices))));
    const surfaces = new Map(fixture.scene.surfaces.map((surface) => [surface.id, surface]));
    const instances = new Map(fixture.scene.instances.map((instance) => [instance.id, instance]));
    const classes = new Map(fixture.dictionary.classes.map((entry) => [entry.id, entry]));
    const winners = new Set(Array.from(grid.winnerPolygon!).filter((index) => index >= 0));

    expect(winners).toEqual(new Set([0, 1]));
    const resolved = [...winners].map((polygonIndex) => {
      const source = fixture.scene.polygons[polygonIndex]!;
      const surface = surfaces.get(source.surfaceId)!;
      const instance = instances.get(surface.instanceId)!;
      return { source, surface, instance, dictionary: classes.get(instance.classId)! };
    });
    expect(resolved.map(({ surface }) => surface.id)).toEqual([
      "surface/vehicle-left-body",
      "surface/vehicle-right-body",
    ]);
    expect(resolved.map(({ instance }) => instance.id)).toEqual([
      "instance/vehicle-left",
      "instance/vehicle-right",
    ]);
    expect(resolved.map(({ dictionary }) => dictionary)).toEqual([
      { id: 7, semanticGlyph: "V", color: "#72b7b2" },
      { id: 7, semanticGlyph: "V", color: "#72b7b2" },
    ]);
  });

  it("retains the polygon owner through fan triangulation and perspective near-plane clipping", () => {
    const fan = rasterizeToCells(context([polygon([
      [-1.2, -1, 0], [-1.4, 0.3, 0], [-0.4, 1.2, 0], [1.2, 0.8, 0], [1.1, -1, 0],
    ])]));
    expect(new Set(Array.from(fan.winnerPolygon!).filter((index) => index >= 0))).toEqual(new Set([0]));

    const camera = createGlyphPerspectiveCamera({
      rotX: 0, rotY: 0, perspective: 500, zoom: 100,
      useMat: true, mat: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    });
    const clipped = rasterizeToCells(buildRasterizeContext({
      camera,
      grid: { cols: 32, rows: 24, cellAspect: 2 },
      polygons: [polygon([[-1, -1, 0], [-1, 1, 0], [1, 0, 12]])],
      mode: "solid", useColors: false, doubleSided: true,
      directionalLight: light, ambientLight: ambient,
    }));
    const clippedWinners = Array.from(clipped.winnerPolygon!).filter((index) => index >= 0);
    expect(clippedWinners.length).toBeGreaterThan(0);
    expect(new Set(clippedWinners)).toEqual(new Set([0]));
  });

  it("uses -1 for empty and cross-layer-occluded cells", () => {
    const empty = rasterizeToCells(context([]));
    expect(empty.winnerPolygon).toBeDefined();
    expect(Array.from(empty.winnerPolygon!)).toEqual(Array(empty.cols * empty.rows).fill(-1));

    const base = context([quad(0)]);
    const ids = new Int32Array(base.grid.cols * base.grid.rows).fill(9);
    const occlusion: OcclusionMap = {
      idMap: ids,
      layerId: 2,
      cols: base.grid.cols,
      rows: base.grid.rows,
      colScale: 1,
      colOffset: 0,
      rowScale: 1,
      rowOffset: 0,
    };
    const occluded = rasterizeToCells({ ...base, occlusion });
    const center = (occluded.rows >> 1) * occluded.cols + (occluded.cols >> 1);
    expect(occluded.winnerPolygon![center]).toBe(-1);
    expect(Array.from(occluded.winnerPolygon!).every((value) => value === -1)).toBe(true);
  });

  it("copies the winner from the same representative supersample as surface fields", () => {
    const left = quad(0, -1.4, 0);
    const right = quad(0.8, 0, 1.4);
    const grid = rasterizeToCells(context([left, right], 2));
    expect(grid.winnerPolygon).toBeDefined();
    expect(grid.normal).toBeDefined();
    for (let i = 0; i < grid.depth.length; i++) {
      if (grid.depth[i] === -Infinity) {
        expect(grid.winnerPolygon![i]).toBe(-1);
      } else {
        expect(grid.winnerPolygon![i]).toBeGreaterThanOrEqual(0);
        expect(grid.winnerPolygon![i]).toBeLessThan(2);
        expect(Number.isFinite(grid.normal![i * 3])).toBe(true);
        const expectedZ = grid.winnerPolygon![i] === 0 ? 0 : 0.8;
        expect(grid.worldPosition![i * 3 + 2]).toBeCloseTo(expectedZ, 5);
      }
    }
  });

  it("returns a durable winner copy and leaves the ordinary string path byte-identical and unallocated", () => {
    const ctx = context([quad(0), quad(1)]);
    const baseline = rasterize(ctx);
    const cameraScratch = ctx.camera as unknown as { __glyphScratch?: { winnerPolygon?: Int32Array | null } };
    expect(cameraScratch.__glyphScratch?.winnerPolygon).toBeNull();
    expect(rasterize({ ...ctx, retainWinnerPolygon: true })).toBe(baseline);
    expect(cameraScratch.__glyphScratch?.winnerPolygon).toBeInstanceOf(Int32Array);

    const captureContext = context([quad(0), quad(1)]);
    const durable = rasterizeToCells(captureContext);
    const cell = coveredCenter(durable);
    durable.winnerPolygon![cell] = 12345;
    const next = rasterizeToCells(captureContext);
    expect(next.winnerPolygon![coveredCenter(next)]).toBe(1);
  });

  it("exposes winner identity directly to transformCells and cloneCellGrid isolates every mutable buffer", () => {
    const ctx = context([quad(0), quad(1)]);
    let captured: ReturnType<typeof rasterizeToCells> | undefined;
    rasterize({
      ...ctx,
      retainWinnerPolygon: true,
      transformCells(grid) {
        captured = cloneCellGrid(grid);
      },
    });
    expect(captured).toBeDefined();
    const center = coveredCenter(captured!);
    expect(captured!.winnerPolygon![center]).toBe(1);

    const source = rasterizeToCells(context([
      { ...quad(0), uvs: [[0, 0], [0, 1], [1, 1], [1, 0]] },
      { ...quad(1), uvs: [[0, 0], [0, 1], [1, 1], [1, 0]] },
    ]));
    const sourceCenter = coveredCenter(source);
    const clone = cloneCellGrid(source);
    const original = {
      char: source.char[sourceCenter], color: source.color[sourceCenter], depth: source.depth[sourceCenter],
      screenX: source.screenX[sourceCenter], screenY: source.screenY[sourceCenter], winner: source.winnerPolygon![sourceCenter],
      shade: source.shade![sourceCenter], world: source.worldPosition![sourceCenter * 3], normal: source.normal![sourceCenter * 3], uv: source.surfaceUv![sourceCenter * 2],
    };
    clone.char[sourceCenter] = "@";
    clone.color[sourceCenter] = "#000000";
    clone.depth[sourceCenter] = 123;
    clone.screenX[sourceCenter] = 123;
    clone.screenY[sourceCenter] = 123;
    clone.winnerPolygon![sourceCenter] = 123;
    clone.shade![sourceCenter] = 123;
    clone.worldPosition![sourceCenter * 3] = 123;
    clone.normal![sourceCenter * 3] = 123;
    clone.surfaceUv![sourceCenter * 2] = 123;
    expect(source.char[sourceCenter]).toBe(original.char);
    expect(source.color[sourceCenter]).toBe(original.color);
    expect(source.depth[sourceCenter]).toBe(original.depth);
    expect(source.screenX[sourceCenter]).toBe(original.screenX);
    expect(source.screenY[sourceCenter]).toBe(original.screenY);
    expect(source.winnerPolygon![sourceCenter]).toBe(original.winner);
    expect(source.shade![sourceCenter]).toBe(original.shade);
    expect(source.worldPosition![sourceCenter * 3]).toBe(original.world);
    expect(source.normal![sourceCenter * 3]).toBe(original.normal);
    expect(source.surfaceUv![sourceCenter * 2]).toBe(original.uv);
  });
});
