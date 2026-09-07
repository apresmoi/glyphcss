/**
 * The shared cross-layer occlusion id-map, under a POSITIONED PERSPECTIVE
 * camera — and the one property it exists to have under any camera: **the
 * cells it says a layer owns are the cells that layer actually paints.**
 *
 * Every clause here was silently false until `@glyphcss/maps` put a walker on
 * the ground and the reports came back as "the roads are on top of everything,
 * the sky is also on top of everything". Three separate reasons, each of which
 * an orthographic camera hides:
 *
 *  1. **The depth quantity.** `project()` returns a linear eye-space `cssZ` at
 *     `[2]` and a screen-space-linear z-buffer at `[3]`; every paint path uses
 *     `[3] ?? [2]`, and `computeOcclusionIds` used `[2]`. Ortho omits `[3]`, so
 *     the two agreed by accident for as long as glyphcss had only orbit
 *     cameras. Under a perspective camera they are different numbers in
 *     different units, and `rasterizeSolid`'s sub-cell seam refinement compares
 *     the id-map's retained depth against the pass's own `CellGrid.depth`
 *     DIRECTLY — so it compared incompatible quantities and refused every
 *     blank.
 *  2. **The near plane.** `computeOcclusionIds` did not clip, so a polygon with
 *     any vertex behind the eye projected to NaN and dropped out of the map
 *     entirely. A street-level camera stands INSIDE its scene, so that is most
 *     of the frame's geometry rather than an edge case.
 *  3. **The sample point.** `fillDepthTri` tested coverage at the cell CENTRE
 *     while `scanFillTriangle` tests it at the integer `(col, row)` — half a
 *     cell apart, which is a whole cell of disagreement along every bottom and
 *     right silhouette edge, in EVERY projection.
 *
 * The discriminator for (2) and (3) is the same and needs no magic number: the
 * claimed set and the painted set, cell for cell, on the identical camera,
 * grid and metrics. For (1) it is the two depths at the same cell.
 */
import { describe, expect, it } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { createGlyphOrthographicCamera, createGlyphPerspectiveCamera } from "../api/createGlyphCamera";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { buildCellGrid } from "./cells";
import { computeOcclusionIds, rasterizeToCells } from "./rasterize";
import {
  composeRetainedGlyphEffectOutput,
  retainGlyphEffectOutput,
  type GlyphEffectOutputMetadata,
} from "./effectCompositor";

const COLS = 32, ROWS = 24, ASPECT = 2;
const LIGHT = { direction: [0, 0, 1] as [number, number, number], intensity: 0 };
const AMBIENT = { intensity: 1 };
const GROUP_ID = 7;

/**
 * A quad tilted off both screen axes, so its silhouette crosses cells at
 * fractional positions on every side — the only shape that can see a half-cell
 * sample-point offset at all. An axis-aligned one lands on cell boundaries and
 * agrees with itself under either convention.
 */
const tilted: Polygon = {
  vertices: [[-1.13, -0.71, -0.37], [-0.44, 1.19, -0.22], [1.27, 0.63, -0.41], [0.58, -1.31, -0.17]],
  color: "#ffffff",
};

/** The same quad pushed so one corner sits BEHIND a perspective camera's eye. */
const straddling: Polygon = {
  vertices: [[-1.13, -0.71, 12], [-0.44, 1.19, -0.22], [1.27, 0.63, -0.41], [0.58, -1.31, -0.17]],
  color: "#ffffff",
};

const orthoCamera = () => createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 160 });
/** The near plane sits at `P/100`, i.e. `cssZ = 5` — world `z = 9.9` at this zoom, which the straddling fixture below reaches. */
const perspectiveCamera = () => createGlyphPerspectiveCamera({ rotX: 0, rotY: 0, perspective: 500, zoom: 160 });

function context(polygons: Polygon[], camera: ReturnType<typeof orthoCamera> | ReturnType<typeof perspectiveCamera>) {
  return buildRasterizeContext({
    camera,
    grid: { cols: COLS, rows: ROWS, cellAspect: ASPECT },
    polygons,
    mode: "solid",
    useColors: false,
    doubleSided: true,
    directionalLight: LIGHT,
    ambientLight: AMBIENT,
  });
}

/** The cells this polygon set actually PAINTS, and the depth it leaves in each. */
function painted(polygons: Polygon[], camera: Parameters<typeof context>[1]) {
  const grid = rasterizeToCells(context(polygons, camera));
  const cells = new Set<number>();
  for (let i = 0; i < grid.cols * grid.rows; i++) if (Number.isFinite(grid.depth[i]!)) cells.add(i);
  return { cells, depth: grid.depth };
}

/** The cells the shared id-map says this polygon set OWNS, and the depth it retained. */
function claimed(polygons: Polygon[], camera: Parameters<typeof context>[1]) {
  const ctx = context(polygons, camera);
  const depth = new Float64Array(COLS * ROWS);
  const idMap = computeOcclusionIds(
    [{ polygons, id: GROUP_ID }], camera, COLS, ROWS, ASPECT, 1, ctx.metrics, null, depth,
  );
  const cells = new Set<number>();
  for (let i = 0; i < idMap.length; i++) if (idMap[i] === GROUP_ID) cells.add(i);
  return { cells, depth };
}

const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);

describe("the occlusion id-map claims exactly the cells the paint rasterizer covers", () => {
  it("orthographic — the case that always had to hold, pinned so the sample point cannot drift back", () => {
    const camera = orthoCamera();
    const paint = painted([tilted], camera);
    const claim = claimed([tilted], camera);
    expect(paint.cells.size).toBeGreaterThan(50);
    expect(sorted(claim.cells)).toEqual(sorted(paint.cells));
  });

  it("perspective — same quad, same equality", () => {
    const camera = perspectiveCamera();
    const paint = painted([tilted], camera);
    const claim = claimed([tilted], camera);
    expect(paint.cells.size).toBeGreaterThan(50);
    expect(sorted(claim.cells)).toEqual(sorted(paint.cells));
  });

  it("perspective — a polygon STRADDLING the near plane claims what it paints instead of vanishing", () => {
    const camera = perspectiveCamera();
    const paint = painted([straddling], camera);
    const claim = claimed([straddling], camera);
    // The premise: this quad really does cross the near plane (one corner is
    // behind the eye) and really does still paint a large part of the frame.
    expect(camera.eyeDepth(straddling.vertices[0] as [number, number, number])).toBeLessThan(0);
    expect(camera.eyeDepth(straddling.vertices[2] as [number, number, number])).toBeGreaterThan(0);
    expect(paint.cells.size).toBeGreaterThan(50);
    expect(sorted(claim.cells)).toEqual(sorted(paint.cells));
  });
});

describe("the id-map's retained depth is the SAME quantity as a pass's own CellGrid.depth", () => {
  it("perspective — the two agree at every covered cell", () => {
    const camera = perspectiveCamera();
    const paint = painted([tilted], camera);
    const claim = claimed([tilted], camera);
    expect(paint.cells.size).toBeGreaterThan(50);
    // Not "both are finite" — the VALUES, which is what `rasterizeSolid`'s
    // seam refinement subtracts from one another. `cssZ` here is O(1e-1) and
    // the z-buffer O(1e-1..1) too, so a loose tolerance would pass on the
    // wrong one; these are the same interpolated number.
    for (const i of paint.cells) {
      expect(claim.depth[i]!).toBeCloseTo(paint.depth[i]!, 9);
    }
  });

  it("orthographic — unchanged, because there is no fourth component to prefer", () => {
    const camera = orthoCamera();
    const paint = painted([tilted], camera);
    const claim = claimed([tilted], camera);
    for (const i of paint.cells) expect(claim.depth[i]!).toBeCloseTo(paint.depth[i]!, 12);
  });
});

describe("cell ownership survives the retained-effect compositor", () => {
  /**
   * `CellGrid.occluded` is the rasterizer's answer to "does another output
   * layer own this cell", and the grid the user's `transformCells` hook is
   * handed comes out of the effect compositor whenever any effect layer is
   * mounted. Dropping it there made `@glyphcss/maps`' stroke ownership test
   * inert for exactly the scenes that have an effect — its street-level sky is
   * a mesh-targeted appearance program, so entering walk mode disabled it.
   */
  const metadata = (cols: number, rows: number): GlyphEffectOutputMetadata => ({
    id: "base",
    pre: document.createElement("pre"),
    isBase: true,
    cellToSceneGrid: [1, 0, 0, 1, 0, 0],
    sceneGridSize: [cols, rows],
    localCellFootprint: [1, 1],
  });

  it("reaches the far side of retain + compose, by value", () => {
    const chars = [" ", "#", " ", "#"];
    const grid = buildCellGrid(chars, [null, null, null, null], new Float64Array([-Infinity, 0, -Infinity, 0]), 4, 1);
    grid.occluded = new Uint8Array([1, 0, 1, 0]);

    const composed = composeRetainedGlyphEffectOutput(retainGlyphEffectOutput(grid, metadata(4, 1)), []);
    expect(composed.occluded).toBeDefined();
    expect(Array.from(composed.occluded!)).toEqual([1, 0, 1, 0]);
  });

  it("is absent — not stale — on a grid that was rendered without a shared id-map", () => {
    // The pooled working scratch is reused across frames, so "the previous
    // frame's ownership" is a real failure mode and not a hypothetical.
    const build = () => buildCellGrid([" ", "#"], [null, null], new Float64Array([-Infinity, 0]), 2, 1);
    const withOwnership = build();
    withOwnership.occluded = new Uint8Array([1, 0]);
    const first = retainGlyphEffectOutput(withOwnership, metadata(2, 1));
    composeRetainedGlyphEffectOutput(first, []);

    const composed = composeRetainedGlyphEffectOutput(
      retainGlyphEffectOutput(build(), metadata(2, 1), first),
      [],
    );
    expect(composed.occluded).toBeUndefined();
  });
});
