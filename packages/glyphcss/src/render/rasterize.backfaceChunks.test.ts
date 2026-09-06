import { describe, expect, it } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { createGlyphOrthographicCamera, createGlyphPerspectiveCamera } from "../api/createGlyphCamera";
import {
  buildGlyphPolygonCullChunks,
  buildRasterizeContext,
  type GlyphPolygonCullChunk,
  type ShadeCache,
} from "../api/rasterizeContext";
import { deriveFacingGradient, glyphChunkIsBackFacing, rasterize } from "./rasterize";

/**
 * The pre-projection BACK-FACE run rejection — the category the AABB cull is
 * structurally blind to, because a sphere's far side projects inside the near
 * side's own disc.
 *
 * The fixture is a UV sphere rendered SINGLE-SIDED and sized to sit entirely
 * inside the output grid. Both properties are load-bearing:
 *
 *  - single-sided, because a `doubleSided` scene draws back faces and the
 *    rejection must (and does) switch itself off there;
 *  - entirely on screen, because it makes the AABB cull unable to fire, so any
 *    drop in shaded triangles is attributable to the cone test alone. The
 *    first test below PROVES that premise rather than assuming it.
 *
 * "Shaded triangles" is the observable: the cross-frame shade cache is filled
 * per drawn triangle, above the point where a chunk is skipped, so counting
 * its populated slots counts exactly the triangles that survived chunk
 * rejection. (The empty-coverage skip deliberately sits BELOW the shading
 * block and cannot perturb this count — see its own comment in `rasterize.ts`.)
 */

const light = { direction: [0.3, 0.4, 0.86] as [number, number, number], intensity: 0.8 };
const ambient = { intensity: 0.3 };

const GRID = { cols: 48, rows: 26, cellAspect: 2 };
/**
 * A run of 16 of the 128 quads per latitude ring spans 45 degrees of
 * longitude, which is the same order as the real consumer: `/maps` builds a
 * terrain tile at ~112 quads per row and chunks 48 of them, i.e. a ~19 degree
 * arc. A run spanning a whole ring would have its normals cancel and yield a
 * deliberately unusable cone, which would test nothing.
 */
const CHUNK = 16;

/**
 * A spheroid barrel. The latitude range stops short of the poles on purpose:
 * a true pole ring's quads collapse two vertices onto one point, which makes
 * `u x v` the zero vector and (correctly) marks those runs un-coneable — a
 * degenerate case with its own test below, not the one these assertions are
 * about.
 */
function sphere(lonSteps = 128, latSteps = 12, radius = 1): Polygon[] {
  const polygons: Polygon[] = [];
  const at = (i: number, j: number): [number, number, number] => {
    const lon = (i / lonSteps) * Math.PI * 2;
    const lat = ((-80 + (j / latSteps) * 160) * Math.PI) / 180;
    return [radius * Math.cos(lat) * Math.cos(lon), radius * Math.cos(lat) * Math.sin(lon), radius * Math.sin(lat)];
  };
  for (let j = 0; j < latSteps; j++) {
    for (let i = 0; i < lonSteps; i++) {
      polygons.push({
        // Counter-clockwise from outside, so the far hemisphere back-faces.
        vertices: [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)],
        color: `#${(((i * 7 + j * 13) % 200) + 40).toString(16).padStart(2, "0")}8844`,
      });
    }
  }
  return polygons;
}

function emptyShadeCache(): ShadeCache {
  return { iA: [], iB: [], iC: [], lit: [] };
}

function render(
  polygons: Polygon[],
  cullChunks: readonly GlyphPolygonCullChunk[] | undefined,
  perspective: boolean,
): { text: string; shaded: number } {
  const ctx = buildRasterizeContext({
    camera: perspective
      ? createGlyphPerspectiveCamera({ rotX: 62, rotY: 24, perspective: 900, zoom: 400 })
      : createGlyphOrthographicCamera({ rotX: 62, rotY: 24, zoom: 400 }),
    grid: GRID,
    polygons,
    mode: "solid",
    useColors: true,
    directionalLight: light,
    ambientLight: ambient,
    ...(cullChunks ? { cullChunks } : {}),
  });
  const cache = emptyShadeCache();
  ctx.shadeCache = cache;
  const text = rasterize(ctx);
  let shaded = 0;
  for (let i = 0; i < cache.iA.length; i++) if (cache.iA[i] !== undefined) shaded++;
  return { text, shaded };
}

/** Ink in a rendered `<pre>` string. A blank render compares equal to anything. */
function nonBlank(rendered: string): number {
  return rendered.replace(/<[^>]*>/g, "").replace(/\s/g, "").length;
}

/** The same runs with their cones neutered — the AABB-only cull, as it was. */
function withoutCones(chunks: readonly GlyphPolygonCullChunk[]): GlyphPolygonCullChunk[] {
  return chunks.map((c) => ({ ...c, coneX: 0, coneY: 0, coneZ: 0, coneCos: -1 }));
}

describe("pre-projection back-face run rejection", () => {
  const polygons = sphere();
  const chunks = buildGlyphPolygonCullChunks(polygons, CHUNK)!;

  it("renders a non-blank sphere with every run's box on screen, so the AABB cull cannot fire", () => {
    const plain = render(polygons, undefined, false);
    const aabbOnly = render(polygons, withoutCones(chunks), false);
    expect(nonBlank(plain.text)).toBeGreaterThan(200);
    // The premise every later assertion rests on: on this fixture the AABB
    // test rejects nothing, so anything the cull removes is the cone's doing.
    expect(aabbOnly.shaded).toBe(plain.shaded);
    expect(aabbOnly.text).toBe(plain.text);
  });

  it("derives a facing gradient whose sign matches the rasterizer's own area2, triangle for triangle", () => {
    // The whole risk of this mechanism is the orientation sign. Check it the
    // way `chirality.test.ts` checks the camera: re-derive the reference
    // independently, here straight from `camera.project`, and require the
    // derived world-space functional to agree on EVERY triangle.
    const camera = createGlyphOrthographicCamera({ rotX: 62, rotY: 24, zoom: 400 });
    const g = deriveFacingGradient(camera, GRID.cols, GRID.rows, GRID.cellAspect, {}, chunks)!;
    expect(g).not.toBeNull();
    expect(Math.hypot(g[0], g[1], g[2])).toBeCloseTo(1, 12);
    let front = 0, back = 0;
    for (const poly of polygons) {
      const v = poly.vertices;
      for (let f = 1; f < v.length - 1; f++) {
        const v0 = v[0]!, v1 = v[f]!, v2 = v[f + 1]!;
        const pa = camera.project(v0, GRID.cols, GRID.rows, GRID.cellAspect, {});
        const pb = camera.project(v1, GRID.cols, GRID.rows, GRID.cellAspect, {});
        const pc = camera.project(v2, GRID.cols, GRID.rows, GRID.cellAspect, {});
        const area2 = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
        const ux = v1[0] - v0[0], uy = v1[1] - v0[1], uz = v1[2] - v0[2];
        const vx = v2[0] - v0[0], vy = v2[1] - v0[1], vz = v2[2] - v0[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const dot = nx * g[0] + ny * g[1] + nz * g[2];
        if (Math.abs(area2) < 1e-9) continue;
        expect(Math.sign(dot)).toBe(Math.sign(area2));
        if (area2 > 0) back++; else front++;
      }
    }
    // Guard against a vacuous pass: a fixture with no back faces (or none at
    // all) would satisfy the loop above trivially.
    expect(front).toBeGreaterThan(500);
    expect(back).toBeGreaterThan(500);
  });

  it("returns no gradient for a perspective camera, whose screen map is not affine", () => {
    const camera = createGlyphPerspectiveCamera({ rotX: 62, rotY: 24, perspective: 900, zoom: 400 });
    expect(deriveFacingGradient(camera, GRID.cols, GRID.rows, GRID.cellAspect, {}, chunks)).toBeNull();
  });

  it("rejects far-side runs, keeps near-side ones, and keeps every run that straddles the horizon", () => {
    const camera = createGlyphOrthographicCamera({ rotX: 62, rotY: 24, zoom: 400 });
    const g = deriveFacingGradient(camera, GRID.cols, GRID.rows, GRID.cellAspect, {}, chunks)!;
    let rejected = 0;
    for (const c of chunks) {
      const isBack = glyphChunkIsBackFacing(c, g[0], g[1], g[2]);
      // Ground truth for this run, from the triangles themselves.
      let anyFront = false, anyBack = false;
      for (let p = c.start; p < c.end; p++) {
        const v = polygons[p]!.vertices;
        for (let f = 1; f < v.length - 1; f++) {
          const v0 = v[0]!, v1 = v[f]!, v2 = v[f + 1]!;
          const ux = v1[0] - v0[0], uy = v1[1] - v0[1], uz = v1[2] - v0[2];
          const vx = v2[0] - v0[0], vy = v2[1] - v0[1], vz = v2[2] - v0[2];
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          if (nx * g[0] + ny * g[1] + nz * g[2] > 0) anyBack = true; else anyFront = true;
        }
      }
      // The one property that MUST hold: never reject a run holding a
      // front-facing triangle. A straddling run has both, so it is kept.
      if (isBack) { expect(anyFront).toBe(false); expect(anyBack).toBe(true); rejected++; }
    }
    // And it must actually fire: a closed-ish surface seen from outside has
    // roughly half its runs wholly on the far side.
    expect(rejected / chunks.length).toBeGreaterThan(0.25);
    expect(rejected / chunks.length).toBeLessThan(0.5);
  });

  it("produces a byte-identical render", () => {
    expect(render(polygons, chunks, false).text).toBe(render(polygons, undefined, false).text);
  });

  it("stays byte-identical from every direction, including the poles", () => {
    for (const [rotX, rotY] of [[0, 0], [90, 0], [180, 0], [40, 137], [62, 300], [115, 210]] as const) {
      const build = (cull?: readonly GlyphPolygonCullChunk[]) => {
        const ctx = buildRasterizeContext({
          camera: createGlyphOrthographicCamera({ rotX, rotY, zoom: 400 }),
          grid: GRID, polygons, mode: "solid", useColors: true,
          directionalLight: light, ambientLight: ambient,
          ...(cull ? { cullChunks: cull } : {}),
        });
        return rasterize(ctx);
      };
      const plain = build();
      expect(nonBlank(plain)).toBeGreaterThan(200);
      expect(build(chunks)).toBe(plain);
    }
  });

  it("switches itself off for a double-sided scene, where back faces are drawn", () => {
    const build = (cull?: readonly GlyphPolygonCullChunk[]) => {
      const ctx = buildRasterizeContext({
        camera: createGlyphOrthographicCamera({ rotX: 62, rotY: 24, zoom: 400 }),
        grid: GRID, polygons, mode: "solid", useColors: true, doubleSided: true,
        directionalLight: light, ambientLight: ambient,
        ...(cull ? { cullChunks: cull } : {}),
      });
      const cache = emptyShadeCache();
      ctx.shadeCache = cache;
      const text = rasterize(ctx);
      let shaded = 0;
      for (let i = 0; i < cache.iA.length; i++) if (cache.iA[i] !== undefined) shaded++;
      return { text, shaded };
    };
    const plain = build();
    const withCones = build(chunks);
    expect(nonBlank(plain.text)).toBeGreaterThan(200);
    expect(withCones.text).toBe(plain.text);
    // Not merely equal output: with back faces drawn, rejecting a far-side run
    // would delete visible ink, so the count must be untouched too.
    expect(withCones.shaded).toBe(plain.shaded);
  });

  it("switches itself off under a perspective camera, whose screen map is not affine", () => {
    const aabbOnly = render(polygons, withoutCones(chunks), true);
    const withCones = render(polygons, chunks, true);
    expect(nonBlank(aabbOnly.text)).toBeGreaterThan(200);
    expect(withCones.text).toBe(aabbOnly.text);
    expect(withCones.shaded).toBe(aabbOnly.shaded);
  });
});

describe("chunk normal cones", () => {
  it("collapses to the plane normal for a coplanar run", () => {
    const polygons: Polygon[] = [];
    for (let i = 0; i < 512; i++) {
      const x = i * 0.25;
      polygons.push({ vertices: [[x, 0, 0], [x, 1, 0], [x + 0.25, 1, 0], [x + 0.25, 0, 0]] });
    }
    for (const c of buildGlyphPolygonCullChunks(polygons)!) {
      expect(c.coneCos).toBeCloseTo(1, 10);
      expect(Math.abs(c.coneZ)).toBeCloseTo(1, 10);
    }
  });

  it("widens with the run's own spread, and every member normal is inside it", () => {
    const polygons = sphere();
    for (const c of buildGlyphPolygonCullChunks(polygons, CHUNK)!) {
      expect(c.coneCos).toBeGreaterThan(0);
      expect(c.coneCos).toBeLessThan(1);
      for (let p = c.start; p < c.end; p++) {
        const v = polygons[p]!.vertices;
        for (let f = 1; f < v.length - 1; f++) {
          const v0 = v[0]!, v1 = v[f]!, v2 = v[f + 1]!;
          const ux = v1[0] - v0[0], uy = v1[1] - v0[1], uz = v1[2] - v0[2];
          const vx = v2[0] - v0[0], vy = v2[1] - v0[1], vz = v2[2] - v0[2];
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          const len = Math.hypot(nx, ny, nz);
          const dot = (nx / len) * c.coneX + (ny / len) * c.coneY + (nz / len) * c.coneZ;
          expect(dot).toBeGreaterThanOrEqual(c.coneCos - 1e-12);
        }
      }
    }
  });

  it("declares itself unusable when a run carries a degenerate normal", () => {
    const polygons = sphere();
    // A zero-area quad: `u x v` is the zero vector, so no direction can be
    // claimed for it and the whole run must refuse to conclude anything.
    polygons[3] = { vertices: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]] };
    const chunk = buildGlyphPolygonCullChunks(polygons, CHUNK)!.find((c) => c.start <= 3 && 3 < c.end)!;
    expect(chunk.coneCos).toBe(-1);
  });
});

describe("empty-coverage skip", () => {
  /**
   * The safety property: a triangle small enough that its screen bbox clamps
   * to a SINGLE cell must still paint that cell. This is what a mutation of
   * the skip's comparison (`>` to `>=`) destroys — at 30.5% of surviving
   * triangles on the real `/maps` scene, a one-cell box is the common case,
   * not an edge one.
   */
  it("still paints triangles whose screen box clamps to exactly one cell", () => {
    // At zoom 400 with this grid's 25 x 50 css-px cell, one output column is
    // 0.0625 world units along the camera's horizontal axis and one row is
    // 0.125 along its vertical one. Each quad below is 0.9 of a cell in both,
    // centred exactly on an output cell's centre — so its clamped screen box
    // is exactly one cell and it must paint exactly that cell.
    const polygons: Polygon[] = [];
    const dy = 0.9 * 25 / 400, dx = 0.9 * 50 / 400;
    let expected = 0;
    for (const k of [-8, -4, 0, 4, 8]) {
      for (const m of [-6, -3, 0, 3, 6]) {
        const y = (k * 25) / 400, x = (m * 50) / 400;
        polygons.push({ vertices: [
          [x - dx / 2, y - dy / 2, 0], [x - dx / 2, y + dy / 2, 0],
          [x + dx / 2, y + dy / 2, 0], [x + dx / 2, y - dy / 2, 0],
        ], color: "#66ccff" });
        expected++;
      }
    }
    const ctx = buildRasterizeContext({
      camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 400 }),
      grid: GRID, polygons, mode: "solid", useColors: true, doubleSided: true,
      directionalLight: light, ambientLight: ambient,
    });
    expect(nonBlank(rasterize(ctx))).toBe(expected);
  });
});
