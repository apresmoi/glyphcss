import { describe, expect, it } from "vitest";
import type { Polygon, Vec3 } from "@glyphcss/core";
import { createGlyphOrthographicCamera, createGlyphPerspectiveCamera } from "../api/createGlyphCamera";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { rasterize, rasterizeToCells } from "./rasterize";

const DEG = Math.PI / 180;

/**
 * Axis-aligned cube, outward CCW winding (glyphcss's "CCW from outside"
 * input convention — verified per-face via the right-hand cross product of
 * each quad's first two edges). Centered at `[cx, cy, cz]`, half-extent `he`.
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

function depthOf(p: readonly [number, number, number, number?]): number {
  return p[3] ?? p[2];
}

/**
 * World-space direction along which moving increases an orthographic
 * camera's screen depth (`r[2]`, "larger = nearer") — the inverse of
 * `rotateVec3Voxcss` applied to local `[0, 0, 1]`, derived independently of
 * the renderer for the analytic ray-box chord check below (see the
 * commit message / VOLUMETRIC.md for the derivation).
 */
function orthoViewRayDir(rotXDeg: number, rotYDeg: number): Vec3 {
  const X = rotXDeg * DEG, Y = rotYDeg * DEG;
  return [Math.cos(Y) * Math.sin(X), Math.sin(Y) * Math.sin(X), Math.cos(X)];
}

/** Analytic ray–axis-aligned-box slab intersection. `null` = ray misses the box. */
function rayBoxIntersect(origin: Vec3, dir: Vec3, lo: number, hi: number): [number, number] | null {
  let tmin = -Infinity, tmax = Infinity;
  for (let k = 0; k < 3; k++) {
    const o = origin[k]!, d = dir[k]!;
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
  }
  return tmin > tmax ? null : [tmin, tmax];
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe("objectExit — second-sweep farthest object-space exit point", () => {
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
    const scratch = base.camera as unknown as { __glyphScratch?: { objectExit?: Float32Array | null } };
    expect(scratch.__glyphScratch?.objectExit).toBeNull();
    // The sweep DID run here (retainObjectExit true)...
    expect(rasterize({ ...base, retainObjectPosition: true, retainObjectExit: true })).toBe(baseline);
    expect(scratch.__glyphScratch?.objectExit).toBeInstanceOf(Float32Array);
    // ...but a subsequent render with it off again is still byte-identical —
    // an allocated-but-unused scratch buffer never leaks into output.
    expect(rasterize(base)).toBe(baseline);
  });

  it("is NaN in uncovered cells and finite on covered ones", () => {
    const grid = rasterizeToCells(buildRasterizeContext({
      camera: createGlyphOrthographicCamera({ rotX: 25, rotY: 35, zoom: 300 }),
      grid: { cols: 40, rows: 24, cellAspect: 2 },
      polygons: cubePolygons(),
      mode: "solid",
      useColors: false,
      retainObjectPosition: true,
      retainObjectExit: true,
    }));
    expect(grid.objectExit).toBeInstanceOf(Float32Array);
    let coveredChecked = 0, emptyChecked = 0;
    for (let i = 0; i < grid.depth.length; i++) {
      const ex = grid.objectExit![i * 3]!;
      if (grid.depth[i] === -Infinity) {
        expect(Number.isNaN(ex)).toBe(true);
        emptyChecked++;
      } else {
        expect(Number.isFinite(ex)).toBe(true);
        coveredChecked++;
      }
    }
    expect(coveredChecked).toBeGreaterThan(20);
    expect(emptyChecked).toBeGreaterThan(20);
  });

  function checkEntryExitInvariants(
    grid: ReturnType<typeof rasterizeToCells>,
    camera: { project(v: Vec3, cols: number, rows: number, cellAspect: number): [number, number, number, number?] },
    cols: number,
    rows: number,
    cellAspect: number,
  ): number {
    let checked = 0;
    for (let i = 0; i < grid.depth.length; i++) {
      if (grid.depth[i] === -Infinity) continue;
      const entry: Vec3 = [grid.objectPosition![i * 3]!, grid.objectPosition![i * 3 + 1]!, grid.objectPosition![i * 3 + 2]!];
      const exit: Vec3 = [grid.objectExit![i * 3]!, grid.objectExit![i * 3 + 1]!, grid.objectExit![i * 3 + 2]!];
      if (!Number.isFinite(entry[0]) || !Number.isFinite(exit[0])) continue;

      // Both lie on the unit-cube surface (one coordinate at exactly ±1).
      expect(Math.max(...entry.map(Math.abs))).toBeCloseTo(1, 2);
      expect(Math.max(...exit.map(Math.abs))).toBeCloseTo(1, 2);

      // Exit is no nearer than entry (camera-space depth, "larger = nearer").
      const entryProj = camera.project(entry, cols, rows, cellAspect);
      const exitProj = camera.project(exit, cols, rows, cellAspect);
      expect(depthOf(entryProj)).toBeGreaterThanOrEqual(depthOf(exitProj) - 1e-6);

      // Both re-project on-screen (finite, within a generous margin of the grid).
      for (const p of [entryProj, exitProj]) {
        expect(Number.isFinite(p[0])).toBe(true);
        expect(Number.isFinite(p[1])).toBe(true);
        expect(p[0]).toBeGreaterThan(-2);
        expect(p[0]).toBeLessThan(cols + 2);
        expect(p[1]).toBeGreaterThan(-2);
        expect(p[1]).toBeLessThan(rows + 2);
      }
      checked++;
    }
    return checked;
  }

  it("orthographic: entry/exit lie on the cube surface, exit no nearer, both on-screen", () => {
    const cols = 40, rows = 24, cellAspect = 2;
    const camera = createGlyphOrthographicCamera({ rotX: 25, rotY: 35, zoom: 300 });
    const grid = rasterizeToCells(buildRasterizeContext({
      camera,
      grid: { cols, rows, cellAspect },
      polygons: cubePolygons(),
      mode: "solid",
      useColors: false,
      retainObjectPosition: true,
      retainObjectExit: true,
    }));
    const checked = checkEntryExitInvariants(grid, camera, cols, rows, cellAspect);
    expect(checked).toBeGreaterThan(50);
  });

  it("orthographic: entry/exit match the analytic ray–box chord independently of the rasterizer", () => {
    const cols = 40, rows = 24, cellAspect = 2;
    const rotX = 25, rotY = 35;
    const camera = createGlyphOrthographicCamera({ rotX, rotY, zoom: 300 });
    const grid = rasterizeToCells(buildRasterizeContext({
      camera,
      grid: { cols, rows, cellAspect },
      polygons: cubePolygons(),
      mode: "solid",
      useColors: false,
      retainObjectPosition: true,
      retainObjectExit: true,
    }));
    const dir = orthoViewRayDir(rotX, rotY);
    expect(Math.hypot(...dir)).toBeCloseTo(1, 6);

    let checked = 0;
    for (let i = 0; i < grid.depth.length; i++) {
      if (grid.depth[i] === -Infinity) continue;
      const entry: Vec3 = [grid.objectPosition![i * 3]!, grid.objectPosition![i * 3 + 1]!, grid.objectPosition![i * 3 + 2]!];
      const exit: Vec3 = [grid.objectExit![i * 3]!, grid.objectExit![i * 3 + 1]!, grid.objectExit![i * 3 + 2]!];
      if (!Number.isFinite(entry[0]) || !Number.isFinite(exit[0])) continue;

      // Cast the SAME view ray through `entry` (guaranteed to lie on the box
      // by construction — it's a real rasterized surface point) from well
      // outside the box, and independently solve the analytic slab
      // intersection. One root reproduces `entry`; the other is the
      // analytic prediction for `exit`.
      const origin: Vec3 = [entry[0] - 5 * dir[0], entry[1] - 5 * dir[1], entry[2] - 5 * dir[2]];
      const roots = rayBoxIntersect(origin, dir, -1, 1);
      expect(roots).not.toBeNull();
      const [tmin, tmax] = roots!;
      const p1: Vec3 = [origin[0] + tmin * dir[0], origin[1] + tmin * dir[1], origin[2] + tmin * dir[2]];
      const p2: Vec3 = [origin[0] + tmax * dir[0], origin[1] + tmax * dir[1], origin[2] + tmax * dir[2]];
      const [analyticEntry, analyticExit] = dist(p1, entry) <= dist(p2, entry) ? [p1, p2] : [p2, p1];

      expect(dist(analyticEntry, entry)).toBeLessThan(0.05);
      expect(dist(analyticExit, exit)).toBeLessThan(0.05);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("perspective (including camera near/inside the mesh): entry/exit lie on the cube surface, exit no nearer, both on-screen, and near-plane-straddling triangles still produce finite exits", () => {
    const cols = 40, rows = 24, cellAspect = 2;
    // `distance: -0.5` pulls the camera INSIDE the unit cube (half-extent 1) —
    // the marquee volumetric case, forcing the exit sweep's near-plane clip
    // path (VOLUMETRIC.md: skipping instead of clipping would NaN the exit
    // exactly here).
    const camera = createGlyphPerspectiveCamera({ rotX: 25, rotY: 35, zoom: 800, perspective: 2000, distance: -0.5 });
    const grid = rasterizeToCells(buildRasterizeContext({
      camera,
      grid: { cols, rows, cellAspect },
      polygons: cubePolygons(),
      mode: "solid",
      useColors: false,
      doubleSided: true,
      retainObjectPosition: true,
      retainObjectExit: true,
    }));
    const checked = checkEntryExitInvariants(grid, camera, cols, rows, cellAspect);
    expect(checked).toBeGreaterThan(20);
  });

  it("perspective, camera outside the mesh: entry/exit lie on the cube surface, exit no nearer, both on-screen", () => {
    const cols = 40, rows = 24, cellAspect = 2;
    const camera = createGlyphPerspectiveCamera({ rotX: 25, rotY: 35, zoom: 800, perspective: 2000, distance: 300 });
    const grid = rasterizeToCells(buildRasterizeContext({
      camera,
      grid: { cols, rows, cellAspect },
      polygons: cubePolygons(),
      mode: "solid",
      useColors: false,
      retainObjectPosition: true,
      retainObjectExit: true,
    }));
    const checked = checkEntryExitInvariants(grid, camera, cols, rows, cellAspect);
    expect(checked).toBeGreaterThan(50);
  });

  it("restricts the exit sweep to the winning mesh — a farther mesh's back face never leaks in", () => {
    // Mesh A (id 0): unit cube at the origin, z in [-1, 1].
    // Mesh B (id 1): a LARGER cube directly behind A, same XY footprint
    // (so B fully backs A's silhouette), z in [-8, -4] — its own back face
    // (z = -8) is far FARTHER than A's back face (z = -1). Without the
    // winner-mesh restriction, the exit sweep would find B's back face as
    // the "global farthest" for every cell inside A's silhouette; with it,
    // those cells must report A's OWN back face instead.
    const meshA = cubePolygons(0, 0, 0, 1);
    const meshB = cubePolygons(0, 0, -6, 2);
    const polygons = [...meshA, ...meshB];
    const polygonMeshIds = [...meshA.map(() => 0), ...meshB.map(() => 1)];
    const cols = 40, rows = 24, cellAspect = 2;
    // Looking straight down world Z (rotX=0, rotY=0): larger world Z = nearer,
    // so A (z in [-1,1]) sits in front of B (z in [-8,-4]) and B's larger XY
    // footprint fully backs A's silhouette in screen space.
    const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 150 });
    const grid = rasterizeToCells(buildRasterizeContext({
      camera,
      grid: { cols, rows, cellAspect },
      polygons,
      mode: "solid",
      useColors: false,
      retainObjectPosition: true,
      retainObjectExit: true,
      polygonMeshIds,
    }));
    let aWinnerCells = 0;
    for (let i = 0; i < grid.depth.length; i++) {
      if (grid.depth[i] === -Infinity) continue;
      const ez = grid.objectPosition![i * 3 + 2]!;
      if (!Number.isFinite(ez) || ez < -1 - 1e-6 || ez > 1 + 1e-6) continue; // not a mesh-A-winning cell
      const exitZ = grid.objectExit![i * 3 + 2]!;
      expect(Number.isFinite(exitZ)).toBe(true);
      // Exit must stay within mesh A's own range — never B's (z <= -4).
      expect(exitZ).toBeGreaterThanOrEqual(-1 - 1e-6);
      expect(exitZ).toBeLessThanOrEqual(1 + 1e-6);
      aWinnerCells++;
    }
    expect(aWinnerCells).toBeGreaterThan(30);
  });

  it("byte-identity regression: rasterize() output for a scene that never touches objectExit is pinned to its pre-change hash", () => {
    // Independently confirmed via `git stash` against the pre-Phase-1 tree:
    // these are the EXACT hashes `rasterize()` produced for this scene before
    // any of this file's changes existed. A scene that never sets
    // `retainObjectExit`/`polygonMeshIds` must keep producing them forever —
    // the new second sweep is additive and gated, never on the default path.
    function fnv1a(s: string): string {
      let h = 0x811c9dc5;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return (h >>> 0).toString(16).padStart(8, "0");
    }
    function pinnedCubePolygons(): Polygon[] {
      const faces: Vec3[][] = [
        [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
        [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]],
        [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]],
        [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]],
        [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]],
        [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
      ];
      return faces.map((vertices) => ({ vertices, color: "#88aacc" }));
    }

    const orthoOut = rasterize(buildRasterizeContext({
      camera: createGlyphOrthographicCamera({ rotX: 25, rotY: 35, zoom: 40 }),
      grid: { cols: 40, rows: 24, cellAspect: 2 },
      polygons: pinnedCubePolygons(),
      mode: "solid",
      useColors: true,
      doubleSided: false,
    }));
    expect(fnv1a(orthoOut)).toBe("07da73ec");
    expect(orthoOut.length).toBe(1123);

    const perspOut = rasterize(buildRasterizeContext({
      camera: createGlyphPerspectiveCamera({ rotX: 25, rotY: 35, zoom: 800, perspective: 2000, distance: 300 }),
      grid: { cols: 40, rows: 24, cellAspect: 2 },
      polygons: pinnedCubePolygons(),
      mode: "solid",
      useColors: true,
      doubleSided: false,
    }));
    expect(fnv1a(perspOut)).toBe("18420d54");
    expect(perspOut.length).toBe(2068);
  });
});
