import { describe, expect, it } from "vitest";
import type { Polygon, Vec3 } from "@glyphcss/core";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { rasterize, rasterizeToCells } from "./rasterize";

/**
 * Axis-aligned cube, outward CCW winding — same fixture `objectExit.test.ts`
 * uses, kept identical so the two Phase-0-adjacent buffers (`objectPosition`,
 * `objectExit`, `objectNormal`) are exercised against the exact same
 * geometry. `objectVertices` is omitted (`objectVertices ?? verts` falls
 * back to `verts`), so object space trivially equals world space here — the
 * frame-mismatch counter-case below is the one fixture where the two
 * diverge on purpose.
 */
function cubePolygons(cx = 0, cy = 0, cz = 0, he = 1): Polygon[] {
  const faces: Vec3[][] = [
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], // +Z
    [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]], // -Z
    [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]], // +Y
    [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]], // -Y
    [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]], // +X
    [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]], // -X
  ];
  return faces.map((verts) => ({
    vertices: verts.map(([x, y, z]) => [x * he + cx, y * he + cy, z * he + cz] as Vec3),
    color: "#8899cc",
  }));
}

function rotateX(v: Vec3, deg: number): Vec3 {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

function rotateY(v: Vec3, deg: number): Vec3 {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

// Compound rotation about BOTH X and Y at non-special angles: a pure
// single-axis rotation leaves that axis's own face normal invariant (e.g.
// rotateY leaves [0,1,0] unchanged), which would make the ±Y faces a
// degenerate no-op for the frame-mismatch check below. Compounding two axes
// guarantees every one of the six axis-aligned face normals genuinely moves.
function rotateObject(v: Vec3, degX: number, degY: number): Vec3 {
  return rotateY(rotateX(v, degX), degY);
}

/**
 * The same cube, but with WORLD vertices rotated from the canonical OBJECT
 * vertices — a mesh with a non-identity `rotation`, the exact case
 * `createGlyphScene.ts`'s `applyTransform` produces for a real scene. Object
 * space (`objectVertices`) stays the canonical axis-aligned cube; world
 * space (`vertices`) is that cube rotated by `rotateObject`.
 */
function rotatedCubePolygons(degX: number, degY: number): Polygon[] {
  return cubePolygons().map((p) => ({
    ...p,
    objectVertices: p.vertices,
    vertices: p.vertices.map((v) => rotateObject(v, degX, degY)),
  }));
}

function vec3At(buf: Float32Array, i: number): Vec3 {
  return [buf[i * 3]!, buf[i * 3 + 1]!, buf[i * 3 + 2]!];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

describe("objectNormal — object-space depth-winning face normal", () => {
  it("is unallocated and rasterize() stays byte-identical when no caller requests it", () => {
    const camera = createGlyphOrthographicCamera({ rotX: 25, rotY: 35, zoom: 300 });
    const base = buildRasterizeContext({
      camera,
      grid: { cols: 40, rows: 24, cellAspect: 2 },
      polygons: cubePolygons(),
      mode: "solid",
      useColors: true,
    });
    const baseline = rasterize(base);
    const scratch = base.camera as unknown as { __glyphScratch?: { objectNormal?: Float32Array | null } };
    expect(scratch.__glyphScratch?.objectNormal).toBeNull();
    // The buffer DID get allocated and filled here (retainObjectNormal true)...
    expect(rasterize({ ...base, retainObjectNormal: true })).toBe(baseline);
    expect(scratch.__glyphScratch?.objectNormal).toBeInstanceOf(Float32Array);
    // ...but a subsequent render with it off again is still byte-identical —
    // an allocated-but-unused scratch buffer never leaks into output.
    expect(rasterize(base)).toBe(baseline);
  });

  it("is NaN in uncovered cells and finite (unit length) on covered ones", () => {
    const grid = rasterizeToCells(buildRasterizeContext({
      camera: createGlyphOrthographicCamera({ rotX: 25, rotY: 35, zoom: 300 }),
      grid: { cols: 40, rows: 24, cellAspect: 2 },
      polygons: cubePolygons(),
      mode: "solid",
      useColors: false,
      retainObjectNormal: true,
    }));
    expect(grid.objectNormal).toBeInstanceOf(Float32Array);
    let coveredChecked = 0, emptyChecked = 0;
    for (let i = 0; i < grid.depth.length; i++) {
      const nx = grid.objectNormal![i * 3]!;
      if (grid.depth[i] === -Infinity) {
        expect(Number.isNaN(nx)).toBe(true);
        emptyChecked++;
      } else {
        const n = vec3At(grid.objectNormal!, i);
        expect(Number.isFinite(n[0]) && Number.isFinite(n[1]) && Number.isFinite(n[2])).toBe(true);
        expect(Math.hypot(...n)).toBeCloseTo(1, 5);
        coveredChecked++;
      }
    }
    expect(coveredChecked).toBeGreaterThan(20);
    expect(emptyChecked).toBeGreaterThan(20);
  });

  it("analytic per-face object normals on an axis-aligned cube — all six faces", () => {
    const cols = 40, rows = 24, cellAspect = 2;
    // Two opposite-facing orthographic views (rotX+180 exactly negates the
    // view direction — see the derivation this mirrors from
    // objectExit.test.ts's own analytic camera reasoning) together see all
    // six faces of a generic (non-axis-aligned-direction) cube view: each
    // camera sees the 3 faces adjacent to the vertex nearest it.
    const cameras = [
      createGlyphOrthographicCamera({ rotX: 25, rotY: 35, zoom: 300 }),
      createGlyphOrthographicCamera({ rotX: 205, rotY: 35, zoom: 300 }),
    ];
    const seenFaces = new Set<string>();
    let checked = 0;
    for (const camera of cameras) {
      const grid = rasterizeToCells(buildRasterizeContext({
        camera,
        grid: { cols, rows, cellAspect },
        polygons: cubePolygons(),
        mode: "solid",
        useColors: false,
        retainObjectPosition: true,
        retainObjectNormal: true,
      }));
      for (let i = 0; i < grid.depth.length; i++) {
        if (grid.depth[i] === -Infinity) continue;
        const pos = vec3At(grid.objectPosition!, i);
        if (!Number.isFinite(pos[0])) continue;
        // Classify which face this cell's entry point lies on: the unit cube
        // coordinate closest to +-1.
        let axis = 0, sign = 1, best = -Infinity;
        for (let a = 0; a < 3; a++) {
          const v = Math.abs(pos[a]!);
          if (v > best) { best = v; axis = a; sign = pos[a]! >= 0 ? 1 : -1; }
        }
        expect(best).toBeCloseTo(1, 2);
        const analytic: Vec3 = [0, 0, 0];
        analytic[axis] = sign;
        const n = vec3At(grid.objectNormal!, i);
        expect(dot(n, analytic)).toBeGreaterThan(0.999);
        seenFaces.add(`${axis}:${sign}`);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
    // All six faces (3 axes x 2 signs) were actually exercised by the two
    // opposing camera views — otherwise "all six faces" would be unproven.
    expect(seenFaces.size).toBe(6);
  });

  it("frame-mismatch counter-case: on a ROTATED cube, objectNormal matches the OBJECT-frame analytic normal and DIFFERS from the world normal buffer", () => {
    // The mandatory Phase-0 acceptance case (VOLUMETRIC-4.md): a world-space
    // implementation of this buffer must FAIL this test. `(degX, degY) =
    // (17, 40)` is a generic compound rotation (not a multiple of 90 on
    // either axis) so every visible face's world normal genuinely diverges
    // from its object normal — including the ±Y faces, which a single-axis
    // Y rotation alone would leave invariant.
    const degX = 17, degY = 40;
    const cols = 40, rows = 24, cellAspect = 2;
    const camera = createGlyphOrthographicCamera({ rotX: 25, rotY: 35, zoom: 300 });
    const grid = rasterizeToCells(buildRasterizeContext({
      camera,
      grid: { cols, rows, cellAspect },
      polygons: rotatedCubePolygons(degX, degY),
      mode: "solid",
      useColors: false,
      doubleSided: true,
      retainObjectPosition: true,
      retainObjectNormal: true,
      retainNormal: true,
    }));
    let checked = 0;
    const worldVsObjectDots: number[] = [];
    for (let i = 0; i < grid.depth.length; i++) {
      if (grid.depth[i] === -Infinity) continue;
      const pos = vec3At(grid.objectPosition!, i);
      if (!Number.isFinite(pos[0])) continue;
      let axis = 0, sign = 1, best = -Infinity;
      for (let a = 0; a < 3; a++) {
        const v = Math.abs(pos[a]!);
        if (v > best) { best = v; axis = a; sign = pos[a]! >= 0 ? 1 : -1; }
      }
      expect(best).toBeCloseTo(1, 2);
      const analyticObject: Vec3 = [0, 0, 0];
      analyticObject[axis] = sign;

      const objectNormal = vec3At(grid.objectNormal!, i);
      const worldNormal = vec3At(grid.normal!, i);

      // objectNormal matches the fixed, UNROTATED analytic face normal.
      expect(dot(objectNormal, analyticObject)).toBeGreaterThan(0.999);

      // worldNormal is the analytic normal ROTATED the same way the mesh's
      // own vertices were — the measured numbers this test reports.
      const analyticWorld = rotateObject(analyticObject, degX, degY);
      expect(dot(worldNormal, analyticWorld)).toBeGreaterThan(0.999);

      // The load-bearing assertion: objectNormal and worldNormal genuinely
      // differ at this cell (a world-space implementation would make this
      // dot product ~1 at every cell, not measurably below it).
      const crossDot = dot(objectNormal, worldNormal);
      worldVsObjectDots.push(crossDot);
      expect(crossDot).toBeLessThan(0.99);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
    // Report the measured spread so a regression that accidentally aligns
    // the two buffers (e.g. a copy-paste that feeds world verts into the
    // object-normal cross product) is visible in the numbers, not just the
    // pass/fail.
    const minDot = Math.min(...worldVsObjectDots);
    const maxDot = Math.max(...worldVsObjectDots);
    // eslint-disable-next-line no-console
    console.log(`objectNormal vs world normal dot range at degX=${degX}, degY=${degY}: [${minDot.toFixed(4)}, ${maxDot.toFixed(4)}]`);
    expect(maxDot).toBeLessThan(1 - 1e-6);
  });

  it("downsampled from the SAME representative subcell as objectPosition under supersample > 1", () => {
    const cols = 40, rows = 24, cellAspect = 2;
    const camera = createGlyphOrthographicCamera({ rotX: 25, rotY: 35, zoom: 300 });
    for (const supersample of [2, 3]) {
      const grid = rasterizeToCells(buildRasterizeContext({
        camera,
        grid: { cols, rows, cellAspect },
        polygons: cubePolygons(),
        mode: "solid",
        useColors: false,
        retainObjectPosition: true,
        retainObjectNormal: true,
        supersample,
      }));
      let checked = 0;
      for (let i = 0; i < grid.depth.length; i++) {
        if (grid.depth[i] === -Infinity) continue;
        const pos = vec3At(grid.objectPosition!, i);
        if (!Number.isFinite(pos[0])) continue;
        let axis = 0, sign = 1, best = -Infinity;
        for (let a = 0; a < 3; a++) {
          const v = Math.abs(pos[a]!);
          if (v > best) { best = v; axis = a; sign = pos[a]! >= 0 ? 1 : -1; }
        }
        const analytic: Vec3 = [0, 0, 0];
        analytic[axis] = sign;
        const n = vec3At(grid.objectNormal!, i);
        // Same representative subcell as objectPosition → the normal must
        // agree with the SAME face objectPosition picked, not a neighboring
        // subcell's different face.
        expect(dot(n, analytic)).toBeGreaterThan(0.999);
        checked++;
      }
      expect(checked).toBeGreaterThan(50);
    }
  });

  it("zero-cost guarantee: an unrelated scene's rasterize() output is unaffected by objectNormal ever having been requested elsewhere", () => {
    const camera = createGlyphOrthographicCamera({ rotX: 10, rotY: 15, zoom: 200 });
    const scene = buildRasterizeContext({
      camera,
      grid: { cols: 30, rows: 18, cellAspect: 2 },
      polygons: cubePolygons(2, 0, 0),
      mode: "solid",
      useColors: true,
    });
    const baseline = rasterize(scene);
    // Exercise a DIFFERENT context requesting objectNormal on the shared
    // camera-scratch host first...
    rasterize({ ...scene, retainObjectNormal: true });
    // ...then re-render the original, unrelated scene — still identical.
    expect(rasterize(scene)).toBe(baseline);
  });
});
