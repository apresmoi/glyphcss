import { describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera } from "glyphcss";
import { createGlyphMapOrthographicProjector } from "./orthographicCell";

/**
 * The projector is only allowed to be faster than `camera.project`, never
 * different: every double must be the camera's own, bit for bit.
 */

const grid = { cols: 184, rows: 101, cellAspect: 0.6, cellWidth: 7.3, cellHeight: 14.1, centerCol: 91.5, centerRow: 50.25 };

function points(n: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  let seed = 12345;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < n; i++) out.push([(rand() - 0.5) * 3, (rand() - 0.5) * 3, (rand() - 0.5) * 3]);
  return out;
}

function expectSame(camera: ReturnType<typeof createGlyphOrthographicCamera>) {
  const projector = createGlyphMapOrthographicProjector(camera, grid)!;
  expect(projector).not.toBeNull();
  for (const v of points(200)) {
    const p = camera.project(v, grid.cols, grid.rows, grid.cellAspect, grid);
    projector.to(v[0], v[1], v[2]);
    expect(Object.is(projector.col, p[0])).toBe(true);
    expect(Object.is(projector.row, p[1])).toBe(true);
    expect(Object.is(projector.depth, p[3] ?? p[2])).toBe(true);
  }
}

describe("createGlyphMapOrthographicProjector", () => {
  it("returns the Euler camera's doubles exactly", () => {
    const camera = createGlyphOrthographicCamera({ zoom: 38.7 });
    camera.rotX = 61.3; camera.rotY = -17.9; camera.fovScale = 1.0123; camera.target = [0.13, -0.27, 0.05];
    expectSame(camera);
    camera.rotX = 0; camera.rotY = 0; camera.fovScale = 1; camera.target = [0, 0, 0];
    expectSame(camera);
  });

  it("returns the matrix camera's doubles exactly", () => {
    const camera = createGlyphOrthographicCamera({ zoom: 210.5 });
    camera.mat = [0.36, -0.8, 0.48, 0.93, 0.29, -0.17, 0.05, 0.51, 0.86];
    camera.useMat = true; camera.target = [-0.4, 0.22, 0.31]; camera.fovScale = 0.987;
    expectSame(camera);
  });

  it("declines a grid without usable cell metrics, leaving the camera to answer", () => {
    const camera = createGlyphOrthographicCamera({ zoom: 10 });
    expect(createGlyphMapOrthographicProjector(camera, { ...grid, cellWidth: 0 })).toBeNull();
    expect(createGlyphMapOrthographicProjector(camera, { ...grid, cellHeight: NaN })).toBeNull();
  });
});
