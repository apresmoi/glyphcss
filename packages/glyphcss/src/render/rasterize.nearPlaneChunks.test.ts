/**
 * The pre-projection cull's THIRD rule: a run whose box projects to eight NaN
 * corners is WHOLLY behind the near plane and is rejected outright.
 *
 * Rule 1 ("a box not wholly in front of the near plane is always accepted")
 * is a NaN test, and it cannot tell a run that STRADDLES the near plane from
 * one entirely behind the eye — both produce NaN corners. Under an
 * orthographic camera that never mattered, because nothing ever NaNs. Under
 * the perspective camera a street-level reader walks with, it is most of the
 * scene: measured on `/maps` in Zürich, 1,096 of 1,444 runs were accepted on
 * a NaN corner and 681 of those sat entirely behind the walker's head, so
 * 48.4% of every triangle submitted was projected vertex by vertex and then
 * discarded one triangle at a time on the per-triangle NaN test.
 *
 * Two things have to hold and each fails differently:
 *
 *  1. **It fires.** Silent failure: the rule is written but never reached, and
 *     nothing about the picture says so. Pinned by COUNTING `camera.project`
 *     calls — geometry behind the eye must not be projected at all.
 *  2. **It never eats a straddling run.** Silent failure: a wall the eye is
 *     standing on vanishes, which is exactly what rule 1 exists to prevent.
 *     Pinned on the rendered bytes against the same scene with no cull runs.
 */
import { describe, expect, it } from "vitest";
import type { Polygon, Vec3 } from "@glyphcss/core";
import { createGlyphPerspectiveCamera } from "../api/createGlyphCamera";
import {
  buildGlyphPolygonCullChunks,
  buildRasterizeContext,
  type GlyphPolygonCullChunk,
} from "../api/rasterizeContext";
import { rasterize } from "./rasterize";

const light = { direction: [0.3, 0.4, 0.86] as [number, number, number], intensity: 0.8 };
const ambient = { intensity: 0.3 };

/** Ink in a rendered `<pre>` string. A blank render compares equal to anything. */
function nonBlank(rendered: string): number {
  return rendered.replace(/<[^>]*>/g, "").replace(/\s/g, "").length;
}

/**
 * A slab of quads in the XY plane at a fixed `z`. With `rotX: 0, rotY: 0` the
 * camera looks down +Z and `perspective: 400` (BASE_TILE 50) puts the near
 * plane at camera-space z ≈ 7.92 — so `z` below that is in front of the eye
 * and `z` above it is behind.
 */
function slab(count: number, z: number, xOffset = 0): Polygon[] {
  const out: Polygon[] = [];
  for (let i = 0; i < count; i++) {
    const x = xOffset + (i % 16) * 0.25 - 2;
    const y = Math.floor(i / 16) * 0.25 - 2;
    out.push({
      vertices: [[x, y, z], [x, y + 0.25, z], [x + 0.25, y + 0.25, z], [x + 0.25, y, z]],
      color: `#${(((i * 7) % 200) + 40).toString(16).padStart(2, "0")}8844`,
    });
  }
  return out;
}

/** A wrapped camera that counts every `project()` the rasterizer performs. */
function countingCamera() {
  const inner = createGlyphPerspectiveCamera({ rotX: 0, rotY: 0, perspective: 400, zoom: 90 });
  let calls = 0;
  const camera = Object.create(inner) as typeof inner & { projectCalls(): number };
  camera.project = (v: Vec3, cols: number, rows: number, cellAspect: number, metrics?: Parameters<typeof inner.project>[4]) => {
    calls++;
    return inner.project(v, cols, rows, cellAspect, metrics);
  };
  camera.projectCalls = () => calls;
  return camera;
}

function context(polygons: Polygon[], camera: ReturnType<typeof countingCamera>, cullChunks?: readonly GlyphPolygonCullChunk[]) {
  return buildRasterizeContext({
    camera,
    grid: { cols: 48, rows: 26, cellAspect: 2 },
    polygons,
    mode: "solid",
    useColors: true,
    doubleSided: true,
    directionalLight: light,
    ambientLight: ambient,
    ...(cullChunks ? { cullChunks } : {}),
  });
}

describe("pre-projection cull — a run wholly behind the near plane", () => {
  it("is rejected without projecting one of its vertices", () => {
    // 512 quads in front of the eye, then 512 behind it. Both slabs are far
    // larger than one 48-polygon run, so the behind half is many whole runs.
    const polygons = [...slab(512, 2), ...slab(512, 40)];
    const chunks = buildGlyphPolygonCullChunks(polygons)!;

    const plainCam = countingCamera();
    rasterize(context(polygons, plainCam));
    const culledCam = countingCamera();
    rasterize(context(polygons, culledCam, chunks));

    // The behind half is 512 quads × 4 vertices = 2,048 projections the
    // uncalled path pays and this one must not. The corner probes the cull
    // itself makes are 8 per run, so the saving has to survive them.
    expect(plainCam.projectCalls()).toBeGreaterThan(4000);
    expect(culledCam.projectCalls()).toBeLessThan(plainCam.projectCalls() - 1500);
  });

  it("still draws a run that STRADDLES the near plane, byte for byte", () => {
    // One slab tilted through the near plane: each quad spans z 6 → 10, so
    // every run holds both NaN and finite corners. Rule 1 must keep them.
    const polygons: Polygon[] = [];
    for (let i = 0; i < 600; i++) {
      const x = (i % 16) * 0.25 - 2;
      const y = Math.floor(i / 16) * 0.06 - 2;
      polygons.push({
        vertices: [[x, y, 6], [x, y + 0.25, 10], [x + 0.25, y + 0.25, 10], [x + 0.25, y, 6]],
        color: `#${(((i * 7) % 200) + 40).toString(16).padStart(2, "0")}8844`,
      });
    }
    const chunks = buildGlyphPolygonCullChunks(polygons)!;
    const plain = rasterize(context(polygons, countingCamera()));
    const culled = rasterize(context(polygons, countingCamera(), chunks));
    expect(nonBlank(plain)).toBeGreaterThan(200);
    expect(culled).toBe(plain);
  });

  it("keeps a mixed scene byte-identical with and without cull runs", () => {
    const polygons = [...slab(512, 2), ...slab(512, 40), ...slab(512, 3, 3)];
    const chunks = buildGlyphPolygonCullChunks(polygons)!;
    const plain = rasterize(context(polygons, countingCamera()));
    const culled = rasterize(context(polygons, countingCamera(), chunks));
    expect(nonBlank(plain)).toBeGreaterThan(200);
    expect(culled).toBe(plain);
  });

  it("never rejects an UN-CULLABLE run, whose infinite box also projects to NaN", () => {
    // `buildGlyphPolygonCullChunks` marks a run holding a non-finite vertex
    // with an infinite box meaning "always draw". Its corners project to NaN
    // for a reason that has nothing to do with the near plane, so rule 3's
    // finite-box guard is what keeps that geometry on screen.
    const polygons = slab(512, 2);
    polygons[300] = { vertices: [[NaN, 0, 2], [0, 1, 2], [1, 1, 2]], color: "#ffffff" };
    const chunks = buildGlyphPolygonCullChunks(polygons)!;
    const marked = chunks.find((c) => c.start <= 300 && 300 < c.end)!;
    expect(marked.minX).toBe(-Infinity);
    const plain = rasterize(context(polygons, countingCamera()));
    const culled = rasterize(context(polygons, countingCamera(), chunks));
    expect(nonBlank(plain)).toBeGreaterThan(200);
    expect(culled).toBe(plain);
  });
});
