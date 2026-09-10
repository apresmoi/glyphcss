import { describe, expect, it } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { createGlyphOrthographicCamera, createGlyphPerspectiveCamera } from "../api/createGlyphCamera";
import {
  buildGlyphPolygonCullChunks,
  buildRasterizeContext,
  GLYPH_CULL_CHUNK_MIN_POLYGONS,
  type GlyphPolygonCullChunk,
} from "../api/rasterizeContext";
import { rasterize } from "./rasterize";

/** Ink in a rendered `<pre>` string. A blank render compares equal to anything. */
function nonBlank(rendered: string): number {
  return rendered.replace(/<[^>]*>/g, "").replace(/\s/g, "").length;
}

const light = { direction: [0.3, 0.4, 0.86] as [number, number, number], intensity: 0.8 };
const ambient = { intensity: 0.3 };

/**
 * A wide grid of quads, most of which land far outside the output grid at the
 * cameras below — the shape the cull exists for (a terrain tile is exactly
 * this: a row-major grid whose off-screen part is contiguous).
 */
function grid(cols: number, rows: number, z = 0): Polygon[] {
  const polygons: Polygon[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c - cols / 2) * 0.25;
      const y = (r - rows / 2) * 0.25;
      polygons.push({
        vertices: [[x, y, z], [x, y + 0.25, z], [x + 0.25, y + 0.25, z], [x + 0.25, y, z]],
        color: `#${(((c * 7 + r * 13) % 200) + 40).toString(16).padStart(2, "0")}8844`,
      });
    }
  }
  return polygons;
}

function context(
  polygons: Polygon[],
  cullChunks?: readonly GlyphPolygonCullChunk[],
  perspective = false,
  rot: { rotX: number; rotY: number } = { rotX: 62, rotY: 24 },
) {
  return buildRasterizeContext({
    camera: perspective
      ? createGlyphPerspectiveCamera({ ...rot, perspective: 400, zoom: 90 })
      : createGlyphOrthographicCamera({ ...rot, zoom: 90 }),
    grid: { cols: 48, rows: 26, cellAspect: 2 },
    polygons,
    mode: "solid",
    useColors: true,
    // The fixture quads are authored in the XY plane; without this the camera
    // back-faces every one of them and both sides of each comparison below
    // render blank — which is how the first draft of this file passed while
    // the cull was mutated to reject EVERY run. `nonBlank` guards it now too.
    doubleSided: true,
    directionalLight: light,
    ambientLight: ambient,
    ...(cullChunks ? { cullChunks } : {}),
  });
}

describe("buildGlyphPolygonCullChunks", () => {
  it("declines to chunk a list too small for the 8-corner test to pay for itself", () => {
    expect(buildGlyphPolygonCullChunks(grid(4, 4))).toBeNull();
    expect(buildGlyphPolygonCullChunks(grid(30, 10))).not.toBeNull();
    expect(grid(30, 10).length).toBeGreaterThanOrEqual(GLYPH_CULL_CHUNK_MIN_POLYGONS);
  });

  it("tiles the polygon list contiguously and accounts for every fan triangle", () => {
    const polygons = grid(40, 20);
    const chunks = buildGlyphPolygonCullChunks(polygons)!;
    expect(chunks[0]!.start).toBe(0);
    expect(chunks[chunks.length - 1]!.end).toBe(polygons.length);
    let triangles = 0;
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) expect(chunks[i]!.start).toBe(chunks[i - 1]!.end);
      expect(chunks[i]!.end).toBeGreaterThan(chunks[i]!.start);
      triangles += chunks[i]!.triangles;
    }
    // Every quad fans into exactly two triangles.
    expect(triangles).toBe(polygons.length * 2);
  });

  it("marks a run holding a non-finite vertex un-cullable rather than poisoning its box", () => {
    const polygons = grid(30, 10);
    polygons[5] = { vertices: [[NaN, 0, 0], [0, 1, 0], [1, 1, 0]], color: "#ffffff" };
    const chunk = buildGlyphPolygonCullChunks(polygons)!.find((c) => c.start <= 5 && 5 < c.end)!;
    expect(chunk.minX).toBe(-Infinity);
    expect(chunk.maxX).toBe(Infinity);
  });
});

/**
 * The whole contract of the pre-projection cull: it may only make the render
 * CHEAPER. A run is skipped or drawn in place, never reordered (`depthEpsilon`
 * resolves coplanar ties by draw order), and a box that is not wholly in front
 * of the near plane is always accepted so glyphcss's own clipping stays
 * authoritative.
 */
describe("pre-projection cull runs are render-identical", () => {
  it("orthographic: identical output with and without cull runs, on a mesh mostly off-grid", () => {
    const polygons = grid(140, 70);
    const chunks = buildGlyphPolygonCullChunks(polygons)!;
    const plain = rasterize(context(polygons));
    const culled = rasterize(context(polygons, chunks));
    expect(nonBlank(plain)).toBeGreaterThan(200);
    expect(culled).toBe(plain);
    // The fixture has to actually exercise the skip, or this proves nothing.
    const camera = createGlyphOrthographicCamera({ rotX: 62, rotY: 24, zoom: 90 });
    const offGrid = chunks.filter((c) => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < 8; i++) {
        const p = camera.project(
          [(i & 1) ? c.maxX : c.minX, (i & 2) ? c.maxY : c.minY, (i & 4) ? c.maxZ : c.minZ],
          48, 26, 2, {});
        minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
        minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
      }
      return minX >= 48 || maxX < 0 || minY >= 26 || maxY < 0;
    });
    expect(offGrid.length).toBeGreaterThan(10);
  });

  it("perspective: identical output for runs that straddle the near plane (the hull bound stops holding there)", () => {
    // `eyeDepth <= 0` is the "not wholly in front of the near plane" test, and
    // `perspective: 400` with glyphcss's BASE_TILE of 50 puts that plane at
    // camera-space z ~ 7.9. Sweeping z across it guarantees runs on both sides
    // AND runs straddling it, which is where the projected-corner hull stops
    // bounding the run's contents and the cull MUST decline.
    const polygons: Polygon[] = [];
    for (let r = 0; r < 70; r++) {
      for (let c = 0; c < 40; c++) {
        const x = (c - 20) * 0.25;
        const y = (r - 35) * 0.25;
        // z varies along the COLUMN axis, so every ~48-polygon run (a partial
        // row) spans the whole depth range and straddles the near plane.
        const z = -14 + (c / 40) * 28;
        polygons.push({
          vertices: [[x, y, z], [x, y + 0.25, z], [x + 0.25, y + 0.25, z + 0.6], [x + 0.25, y, z + 0.6]],
          color: `#${(((c * 7 + r * 13) % 200) + 40).toString(16).padStart(2, "0")}8844`,
        });
      }
    }
    const chunks = buildGlyphPolygonCullChunks(polygons)!;
    // The fixture has to actually contain straddling runs, or this proves nothing.
    const camera = createGlyphPerspectiveCamera({ rotX: 0, rotY: 0, perspective: 400, zoom: 90 });
    const straddling = chunks.filter((c) => {
      let anyBehind = false, anyFront = false;
      for (let i = 0; i < 8; i++) {
        const d = camera.eyeDepth([(i & 1) ? c.maxX : c.minX, (i & 2) ? c.maxY : c.minY, (i & 4) ? c.maxZ : c.minZ]);
        if (d > 0) anyFront = true; else anyBehind = true;
      }
      return anyFront && anyBehind;
    });
    expect(straddling.length).toBeGreaterThan(10);
    const plain = rasterize(context(polygons, undefined, true, { rotX: 0, rotY: 0 }));
    expect(nonBlank(plain)).toBeGreaterThan(200);
    expect(rasterize(context(polygons, chunks, true, { rotX: 0, rotY: 0 }))).toBe(plain);
  });

  it("identical output when a run's polygons are hidden", () => {
    const polygons = grid(140, 70);
    for (let i = 0; i < polygons.length; i += 3) polygons[i]!.hidden = true;
    const chunks = buildGlyphPolygonCullChunks(polygons)!;
    const plain = rasterize(context(polygons));
    expect(nonBlank(plain)).toBeGreaterThan(200);
    expect(rasterize(context(polygons, chunks))).toBe(plain);
  });

  it("keeps the positional shade-cache aligned across a skip, and across a CHANGING skip set", () => {
    const polygons = grid(140, 70);
    const chunks = buildGlyphPolygonCullChunks(polygons)!;
    // The real hazard is a camera MOVE: the cache is warmed with one set of
    // runs skipped and reused with a different set skipped, so a `triT` that
    // does not advance by each skipped run's whole triangle count reads
    // another triangle's shade and colour on the second frame.
    const poseA = { rotX: 62, rotY: 24 };
    const poseB = { rotX: 58, rotY: 71 };
    const shared = { iA: [] as number[], iB: [] as number[], iC: [] as number[], lit: [] as (string | null)[] };
    const warm = context(polygons, chunks, false, poseA);
    warm.shadeCache = shared;
    rasterize(warm);
    // The two poses must genuinely skip different runs, or this proves nothing.
    const skipped = (pose: { rotX: number; rotY: number }) => {
      const cam = createGlyphOrthographicCamera({ ...pose, zoom: 90 });
      return chunks.filter((c) => {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < 8; i++) {
          const p = cam.project([(i & 1) ? c.maxX : c.minX, (i & 2) ? c.maxY : c.minY, (i & 4) ? c.maxZ : c.minZ], 48, 26, 2, {});
          minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
          minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
        }
        return minX >= 48 || maxX < 0 || minY >= 26 || maxY < 0;
      }).length;
    };
    expect(skipped(poseA)).toBeGreaterThan(10);
    expect(skipped(poseB)).not.toBe(skipped(poseA));

    const reuse = context(polygons, chunks, false, poseB);
    reuse.shadeCache = shared;
    const fresh = rasterize(context(polygons, chunks, false, poseB));
    expect(nonBlank(fresh)).toBeGreaterThan(200);
    expect(rasterize(reuse)).toBe(fresh);
  });

  it("a run whose box covers the whole world is never skipped", () => {
    const polygons = grid(50, 24);
    const everything: GlyphPolygonCullChunk[] = [{
      start: 0, end: polygons.length, triangles: polygons.length * 2,
      minX: -Infinity, minY: -Infinity, minZ: -Infinity, maxX: Infinity, maxY: Infinity, maxZ: Infinity,
    }];
    const plain = rasterize(context(polygons));
    expect(nonBlank(plain)).toBeGreaterThan(200);
    expect(rasterize(context(polygons, everything))).toBe(plain);
  });
});

/**
 * The pre-projection cull's rule 1 — "a box not wholly in front of the near
 * plane is always accepted" — is implemented as a NaN test on the projected
 * corners, which is only correct because every shipped camera reports a point
 * at or past the near plane that way. Pin the property the cull leans on.
 */
describe("near-plane NaN contract the cull depends on", () => {
  it("the perspective camera projects a point at or past the near plane to NaN", () => {
    const cam = createGlyphPerspectiveCamera({ rotX: 0, rotY: 0, perspective: 400, zoom: 90 });
    // `perspective: 400` with glyphcss's BASE_TILE of 50 puts the near plane
    // at camera-space z ~ 7.92.
    expect(cam.eyeDepth([1, 1, 7])).toBeGreaterThan(0);
    expect(Number.isFinite(cam.project([1, 1, 7], 48, 26, 2, {})[0])).toBe(true);
    for (const z of [8, 9, 12, 40]) {
      expect(cam.eyeDepth([1, 1, z])).toBeLessThan(0);
      expect(Number.isNaN(cam.project([1, 1, z], 48, 26, 2, {})[0])).toBe(true);
      expect(Number.isNaN(cam.project([1, 1, z], 48, 26, 2, {})[1])).toBe(true);
    }
  });

  it("the orthographic camera has no eye, so no point is ever behind its near plane", () => {
    const cam = createGlyphOrthographicCamera({ rotX: 62, rotY: 24, zoom: 90 });
    for (const z of [-1e6, 0, 1e6]) {
      expect(cam.eyeDepth([1, 1, z])).toBe(Number.POSITIVE_INFINITY);
      expect(Number.isFinite(cam.project([1, 1, z], 48, 26, 2, {})[0])).toBe(true);
    }
  });
});
