/**
 * Snapshot test for the solid-mode rasterizer.
 *
 * Originally this asserted byte-identical output to asciss. The rasterizer has
 * since diverged: half-space rasterization with per-pixel barycentric depth
 * replaced asciss's scanline + per-triangle average depth, fixing
 * angle-dependent silhouette artifacts (the old scheme picked a single average
 * depth per triangle, which flipped winners between adjacent surface triangles
 * with very small camera rotations and showed up as dark bands cutting through
 * solid shapes).
 *
 * The fixtures are now snapshots of the current rasterizer's output for three
 * reference meshes (unit cube, single triangle, tetrahedron) and guard against
 * accidental regressions. Only solid mode is snapshotted — wireframe uses
 * Math.random() for glyph selection and is not deterministic.
 *
 * To regenerate after an intentional rasterizer change: write a one-off
 * vitest that calls rasterize() with the parameters below and writes the
 * output to test/fixtures/<name>.txt, run it once, then delete it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { rasterize } from "../src/render/rasterize";
import { buildRasterizeContext } from "../src/api/rasterizeContext";
import { createGlyphPerspectiveCamera } from "../src/api/createGlyphCamera";
import type { Polygon, Vec3 } from "@glyphcss/core";

const FIXTURE_DIR = resolve(__dirname, "fixtures");

const GRID = { cols: 40, rows: 20, cellAspect: 2.0 };
// Source vector from the surface toward the light. Paired with the source-vector
// Lambert convention, this preserves the fixture lighting from the old travel-
// vector renderer.
const DIR_LIGHT = { direction: [0.5, 0.7, 0.5] as Vec3, intensity: 1 };
const AMB_LIGHT = { intensity: 0.4 };

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURE_DIR, `${name}.txt`), "utf8");
}

function makeUnitCubePolygons(): Polygon[] {
  const faces: Array<[Vec3, Vec3, Vec3, string]> = [
    [[-1,-1, 1],[1,-1, 1],[1, 1, 1],"#ff4444"],
    [[-1,-1, 1],[1, 1, 1],[-1, 1, 1],"#ff4444"],
    [[1,-1,-1],[-1,-1,-1],[-1, 1,-1],"#44ff44"],
    [[1,-1,-1],[-1, 1,-1],[1, 1,-1],"#44ff44"],
    [[-1, 1, 1],[1, 1, 1],[1, 1,-1],"#4444ff"],
    [[-1, 1, 1],[1, 1,-1],[-1, 1,-1],"#4444ff"],
    [[-1,-1,-1],[1,-1,-1],[1,-1, 1],"#ffff44"],
    [[-1,-1,-1],[1,-1, 1],[-1,-1, 1],"#ffff44"],
    [[1,-1, 1],[1,-1,-1],[1, 1,-1],"#44ffff"],
    [[1,-1, 1],[1, 1,-1],[1, 1, 1],"#44ffff"],
    [[-1,-1,-1],[-1,-1, 1],[-1, 1, 1],"#ff44ff"],
    [[-1,-1,-1],[-1, 1, 1],[-1, 1,-1],"#ff44ff"],
  ];
  return faces.map(([v0, v1, v2, color]) => ({ vertices: [v0, v1, v2], color }));
}

function makeSinglePolygon(): Polygon[] {
  return [{ vertices: [[0, 1, 0], [-1, -1, 0], [1, -1, 0]], color: "#aaaaaa" }];
}

function makeTetrahedronPolygons(): Polygon[] {
  const s = Math.sqrt(2/3);
  const r = Math.sqrt(1/3);
  const v: Vec3[] = [
    [0, 1, 0],
    [2*r, -1/3, 0],
    [-r, -1/3, s],
    [-r, -1/3, -s],
  ];
  return [
    { vertices: [v[0]!, v[1]!, v[2]!], color: "#ff6600" },
    { vertices: [v[0]!, v[2]!, v[3]!], color: "#0066ff" },
    { vertices: [v[0]!, v[3]!, v[1]!], color: "#00ff66" },
    { vertices: [v[1]!, v[3]!, v[2]!], color: "#ffff00" },
  ];
}

// Camera parameters are now in DEGREES (voxcss / three.js convention).
// Fixtures were generated with these exact parameters after the camera
// convention alignment. Regenerate with the vitest update-snapshots workflow
// described at the top of this file if the rasterizer changes intentionally.
// `perspective: 0` pins these to the legacy distance-pinhole projection the
// fixtures were generated with (the camera default is now 32000 = CSS perspective).
describe("parity: glyphcss rasterize vs fixtures", () => {
  it("unit cube (solid, no colors) matches fixture byte-for-byte", () => {
    // rotX=65°/rotY=45° = voxcss default view (isometric-ish); zoom=300 fills the grid
    const camera = createGlyphPerspectiveCamera({ rotX: 65, rotY: 45, zoom: 300, distance: 20, perspective: 0 });
    const ctx = buildRasterizeContext({
      camera,
      grid: GRID,
      polygons: makeUnitCubePolygons(),
      mode: "solid",
      directionalLight: DIR_LIGHT,
      ambientLight: AMB_LIGHT,
      glyphPalette: "default",
      useColors: false,
    });
    const output = rasterize(ctx);
    const fixture = loadFixture("unit-cube");
    expect(output).toBe(fixture);
  });

  it("single triangle (solid, no colors) matches fixture byte-for-byte", () => {
    // rotX=30°/rotY=20° — oblique view that shows the triangle clearly; zoom=400 fills the grid
    const camera = createGlyphPerspectiveCamera({ rotX: 30, rotY: 20, zoom: 400, distance: 20, perspective: 0 });
    const ctx = buildRasterizeContext({
      camera,
      grid: GRID,
      polygons: makeSinglePolygon(),
      mode: "solid",
      directionalLight: DIR_LIGHT,
      ambientLight: AMB_LIGHT,
      glyphPalette: "default",
      useColors: false,
    });
    const output = rasterize(ctx);
    const fixture = loadFixture("single-triangle");
    expect(output).toBe(fixture);
  });

  it("tetrahedron (solid, no colors) matches fixture byte-for-byte", () => {
    // rotX=20°/rotY=46° — slightly elevated view with a twist; zoom=350 fills the grid
    const camera = createGlyphPerspectiveCamera({ rotX: 20, rotY: 46, zoom: 350, distance: 20, perspective: 0 });
    const ctx = buildRasterizeContext({
      camera,
      grid: GRID,
      polygons: makeTetrahedronPolygons(),
      mode: "solid",
      directionalLight: DIR_LIGHT,
      ambientLight: AMB_LIGHT,
      glyphPalette: "default",
      useColors: false,
    });
    const output = rasterize(ctx);
    const fixture = loadFixture("tetrahedron");
    expect(output).toBe(fixture);
  });
});
