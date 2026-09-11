/**
 * Indexed vertex projection (`render/vertexIndex.ts`).
 *
 * The mechanism projects one DISTINCT world position per pass instead of one
 * per vertex OCCURRENCE, so every guarantee here is a byte-identity guarantee:
 * a scene that renders through the index must produce exactly the string it
 * produced before the index existed.
 *
 * Each clause below goes red on its own mutant:
 *  - serving a slot filled by an EARLIER pass (drop the generation bump);
 *  - welding on `===` instead of the bit pattern (merges `+0` with `-0`);
 *  - indexing on FIRST sight (the build is pure loss for a one-render array);
 *  - indexing a mesh that shares nothing (pure indirection, no projection saved).
 */
import { describe, expect, it } from "vitest";
import type { Polygon, Vec3 } from "@glyphcss/core";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { createGlyphOrthographicCamera, createGlyphPerspectiveCamera } from "../api/createGlyphCamera";
import { rasterize } from "./rasterize";
import { resolveGlyphVertexIndex } from "./vertexIndex";

/**
 * An `n x n` quad grid. Adjacent quads are handed SEPARATE `Vec3` objects
 * holding bit-identical coordinates along every shared edge — which is what a
 * real mesh generator emits (`@glyphcss/maps`' `glyphMapPolygons` calls its
 * per-corner projector once per quad corner), and the only case the index is
 * for.
 */
function quadGrid(n: number): Polygon[] {
  const at = (i: number, j: number): Vec3 => [i / n - 0.5, j / n - 0.5, Math.sin(i * 0.7) * Math.cos(j * 0.9) * 0.1];
  const polygons: Polygon[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      polygons.push({
        vertices: [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)],
        color: `#${(((i * 37 + j * 11) & 0xff) | 0x808080).toString(16).slice(-6)}`,
      });
    }
  }
  return polygons;
}

function clone(polygons: Polygon[]): Polygon[] {
  return polygons.map((p) => ({ ...p, vertices: p.vertices.map((v) => [v[0], v[1], v[2]] as Vec3) }));
}

function render(polygons: Polygon[], cols: number, rows: number, perspective: boolean): string {
  const camera = perspective
    ? createGlyphPerspectiveCamera({ rotX: 62, rotY: 31, zoom: 700, distance: 40 })
    : createGlyphOrthographicCamera({ rotX: 65, rotY: 45, zoom: 900 });
  return rasterize(buildRasterizeContext({
    camera,
    grid: { cols, rows, cellAspect: 2 },
    polygons,
    mode: "solid",
    useColors: true,
    doubleSided: true,
    directionalLight: { direction: [0.5, 0.7, 0.5], intensity: 1 },
    ambientLight: { intensity: 0.4 },
  }));
}

describe("indexed vertex projection", () => {
  it("renders the shared-vertex mesh byte-identically once the index is live", () => {
    for (const perspective of [false, true]) {
      const polygons = quadGrid(12);
      // The FIRST render is unindexed by construction, so it is the reference
      // the indexed renders after it have to match to the byte.
      const reference = render(polygons, 48, 24, perspective);
      // A blank grid is identical to a blank grid: assert there is a picture.
      expect(reference.replace(/<[^>]*>/g, "").trim().length).toBeGreaterThan(200);
      for (let i = 0; i < 4; i++) expect(render(polygons, 48, 24, perspective)).toBe(reference);
    }
  });

  it("a second grid shape on the SAME polygon array never reads the first's coordinates", () => {
    const shared = quadGrid(10);
    // References taken on throwaway copies, so each is an unindexed render of
    // exactly these coordinates at exactly this grid shape.
    const wide = render(clone(shared), 60, 20, false);
    const tall = render(clone(shared), 24, 40, false);
    expect(wide.replace(/<[^>]*>/g, "").trim().length).toBeGreaterThan(200);
    expect(tall.replace(/<[^>]*>/g, "").trim().length).toBeGreaterThan(200);
    // Alternating passes over one array: without the per-pass generation bump
    // the second shape would be served the first shape's projected columns.
    for (let i = 0; i < 4; i++) {
      expect(render(shared, 60, 20, false)).toBe(wide);
      expect(render(shared, 24, 40, false)).toBe(tall);
    }
  });

  it("a moved camera on the SAME polygon array re-projects rather than re-serving", () => {
    const shared = quadGrid(8);
    const outputs: string[] = [];
    for (const rotY of [0, 45, 90, 135]) {
      const camera = createGlyphOrthographicCamera({ rotX: 65, rotY, zoom: 900 });
      const ctx = buildRasterizeContext({
        camera, grid: { cols: 40, rows: 20, cellAspect: 2 }, polygons: shared, mode: "solid",
        useColors: true, doubleSided: true,
        directionalLight: { direction: [0.5, 0.7, 0.5], intensity: 1 },
        ambientLight: { intensity: 0.4 },
      });
      // Twice: the first pass at this angle may be the one that builds the
      // index, the second is certainly served by it.
      rasterize(ctx);
      outputs.push(rasterize(ctx));
    }
    for (const out of outputs) expect(out.replace(/<[^>]*>/g, "").trim().length).toBeGreaterThan(50);
    expect(new Set(outputs).size).toBe(outputs.length);
  });

  it("keys on the bit pattern, so +0 and -0 are different positions", () => {
    const zeros: Polygon[] = [
      { vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] },
      { vertices: [[-0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] },
    ];
    expect(resolveGlyphVertexIndex(zeros)).toBeNull();          // first sight
    const index = resolveGlyphVertexIndex(zeros);
    expect(index).not.toBeNull();
    // The two quads share three corners exactly; their first corners differ
    // only in the sign of zero, which `===` cannot see and the bit key can.
    expect(index!.positions.length).toBe(5);
    expect(Object.is(index!.positions[0]![0], 0)).toBe(true);
    expect(Object.is(index!.positions[4]![0], -0)).toBe(true);
  });

  it("is not built on the first sight of an array", () => {
    const polygons = quadGrid(4);
    expect(resolveGlyphVertexIndex(polygons)).toBeNull();
    expect(resolveGlyphVertexIndex(polygons)).not.toBeNull();
  });

  it("declines a mesh that shares nothing, and never reconsiders it", () => {
    // Six independent quads, 24 corners, no two alike — a cube authored with
    // per-face vertices. Indexing it would be per-occurrence indirection with
    // not one projection saved.
    const unshared: Polygon[] = [];
    for (let f = 0; f < 6; f++) {
      unshared.push({ vertices: [[f, 0, 0], [f, 1, 0], [f, 1, 1], [f, 0, 1]] });
    }
    expect(resolveGlyphVertexIndex(unshared)).toBeNull();
    expect(resolveGlyphVertexIndex(unshared)).toBeNull();
    expect(resolveGlyphVertexIndex(unshared)).toBeNull();
  });

  it("indexes a real shared-edge grid down to its corner count", () => {
    const polygons = quadGrid(10);   // 100 quads, 400 occurrences, 11x11 corners
    resolveGlyphVertexIndex(polygons);
    const index = resolveGlyphVertexIndex(polygons)!;
    expect(index.slots.length).toBe(400);
    expect(index.positions.length).toBe(121);
  });
});
