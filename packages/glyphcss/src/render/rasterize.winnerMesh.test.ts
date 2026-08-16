import { describe, expect, it } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { createGlyphOrthographicCamera, createGlyphPerspectiveCamera } from "../api/createGlyphCamera";
import { buildRasterizeContext, type OcclusionMap } from "../api/rasterizeContext";
import { rasterize, rasterizeToCells } from "./rasterize";

const light = { direction: [0, 0, 1] as [number, number, number], intensity: 0 };
const ambient = { intensity: 1 };

function quad(z: number, x0 = -1, x1 = 1): Polygon {
  return {
    vertices: [[x0, -1, z], [x0, 1, z], [x1, 1, z], [x1, -1, z]],
    color: "#ffffff",
  };
}

function context(polygons: Polygon[], meshIds?: number[], supersample = 1, perspective = false) {
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
    ...(meshIds ? { polygonMeshIds: meshIds, retainWinnerMesh: true } : {}),
  });
}

function coveredCenter(grid: ReturnType<typeof rasterizeToCells>): number {
  const center = (grid.rows >> 1) * grid.cols + (grid.cols >> 1);
  expect(grid.depth[center]).toBeGreaterThan(-Infinity);
  return center;
}

describe("solid winner mesh capture (VOLUMETRIC-3.md §1)", () => {
  it("retains the depth-winning mesh id for orthographic and perspective cameras", () => {
    const ortho = rasterizeToCells(context([quad(0), quad(1)], [5, 7]));
    const orthoCenter = coveredCenter(ortho);
    expect(ortho.winnerMesh).toBeInstanceOf(Int32Array);
    expect(ortho.winnerMesh![orthoCenter]).toBe(7);

    const perspective = rasterizeToCells(context([quad(-2), quad(0)], [5, 7], 1, true));
    const perspectiveCenter = coveredCenter(perspective);
    expect(perspective.winnerMesh![perspectiveCenter]).toBe(7);
  });

  it("uses -1 for empty and cross-layer-occluded cells", () => {
    const empty = rasterizeToCells(context([], []));
    expect(empty.winnerMesh).toBeDefined();
    expect(Array.from(empty.winnerMesh!)).toEqual(Array(empty.cols * empty.rows).fill(-1));

    const base = context([quad(0)], [3]);
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
    expect(occluded.winnerMesh![center]).toBe(-1);
    expect(Array.from(occluded.winnerMesh!).every((value) => value === -1)).toBe(true);
  });

  it("copies the winner mesh id from the same representative supersample as other surface fields", () => {
    const left = quad(0, -1.4, 0);
    const right = quad(0.8, 0, 1.4);
    const grid = rasterizeToCells(context([left, right], [11, 13], 2));
    expect(grid.winnerMesh).toBeDefined();
    expect(grid.worldPosition).toBeDefined();
    for (let i = 0; i < grid.depth.length; i++) {
      if (grid.depth[i] === -Infinity) {
        expect(grid.winnerMesh![i]).toBe(-1);
      } else {
        expect([11, 13]).toContain(grid.winnerMesh![i]);
        const expectedZ = grid.winnerMesh![i] === 11 ? 0 : 0.8;
        expect(grid.worldPosition![i * 3 + 2]).toBeCloseTo(expectedZ, 5);
      }
    }
  });

  it("allocates the winner-mesh scratch buffer under EITHER retainObjectExit or retainWinnerMesh, but only exposes CellGrid.winnerMesh under retainWinnerMesh", () => {
    const ctx = context([quad(0), quad(1)], [5, 7]);
    const baseline = rasterize({ ...ctx, retainWinnerMesh: false });
    const cameraScratch = ctx.camera as unknown as { __glyphScratch?: { winnerMesh?: Int32Array | null } };
    expect(cameraScratch.__glyphScratch?.winnerMesh).toBeNull();

    // Byte-identical string output regardless of the flag — the buffer is
    // purely a retained-frame concern, never touches the direct string path.
    expect(rasterize({ ...ctx, retainWinnerMesh: false })).toBe(baseline);

    // retainObjectExit alone allocates the internal scratch buffer (it always
    // did) but must NOT expose CellGrid.winnerMesh.
    const objectExitOnly = rasterizeToCells({ ...ctx, retainObjectExit: true, retainWinnerMesh: false });
    expect(cameraScratch.__glyphScratch?.winnerMesh).toBeInstanceOf(Int32Array);
    expect(objectExitOnly.winnerMesh).toBeUndefined();

    // retainWinnerMesh exposes it.
    const withWinnerMesh = rasterizeToCells({ ...ctx, retainWinnerMesh: true });
    expect(withWinnerMesh.winnerMesh).toBeInstanceOf(Int32Array);
  });

  it("exposes winner mesh identity directly to transformCells", () => {
    const ctx = context([quad(0), quad(1)], [5, 7]);
    let captured: ReturnType<typeof rasterizeToCells> | undefined;
    rasterize({
      ...ctx,
      transformCells(grid) {
        captured = { ...grid } as ReturnType<typeof rasterizeToCells>;
        return grid;
      },
    });
    expect(captured).toBeDefined();
    const center = coveredCenter(captured!);
    expect(captured!.winnerMesh![center]).toBe(7);
  });
});
