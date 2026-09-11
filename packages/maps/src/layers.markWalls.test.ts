/**
 * `glyphMapVectorMarkWalls` — the wall cull's per-frame form.
 *
 * `glyphMapVectorCullWalls` returns a fresh survivor list, and that is the
 * right shape for a caller re-culling a static mesh against an arbitrary
 * camera. It is the wrong shape for a cull that runs every moving frame:
 * glyphcss's caches key on polygon-array IDENTITY, so handing the scene a new
 * array throws away the cross-frame shade cache, re-scans every polygon in the
 * scene for texture URLs, misses the `WeakMap` holding this mesh's
 * pre-projection cull runs and their normal cones, and re-merges the base
 * grid's run list. `glyphMapVectorMarkWalls` writes the same verdict as
 * `Polygon.hidden` on the mesh's own polygons instead.
 *
 * Two functions, one verdict, and the thing that goes silently wrong is the
 * word "same". So the gate is EQUIVALENCE with the shipped subset form on the
 * same mesh and the same predicate — not a hand-written expectation, which
 * would only pin the two against the same mistake.
 */
import { describe, expect, it } from "vitest";
import type { Polygon, Vec3 } from "@glyphcss/core";
import { createGlyphOrthographicCamera } from "glyphcss";
import { glyphMapVectorCullWalls, glyphMapVectorMarkWalls, glyphMapVectorMesh } from "./layers";
import { glyphMapGlobe } from "./projection";
import type { GlyphMapVectorFeature } from "./vector/types";

const COLS = 120, ROWS = 48;
const projection = glyphMapGlobe({ radius: 1, exaggeration: 1 });

function ring(west: number, east: number, south: number, north: number, step = 5): [number, number][] {
  const out: [number, number][] = [];
  for (let lon = west; lon <= east; lon += step) out.push([lon, south]);
  for (let lat = south + step; lat <= north; lat += step) out.push([east, lat]);
  for (let lon = east - step; lon >= west; lon -= step) out.push([lon, north]);
  for (let lat = north - step; lat >= south; lat -= step) out.push([west, lat]);
  out.push([west, south]);
  return out;
}

function box(west: number, east: number, heightM: number): GlyphMapVectorFeature {
  const r = ring(west, east, -10, 10);
  return { geometryType: "polygon", properties: { height: heightM }, rings: [r], polygons: [[r]] };
}

function mesh() {
  return glyphMapVectorMesh(
    [box(-20, 20, 200_000), box(100, 115, 1_200_000), box(150, 170, 50_000)],
    projection,
    { height: (f) => Number(f.properties?.height ?? 0), groundElevation: () => 0 },
  );
}

/** The widget's own near-side predicate, against glyphcss's real camera. */
function nearSideAt(lonCenter: number): (lon: number, lat: number, elev: number) => boolean {
  const camera = createGlyphOrthographicCamera({ rotX: 90, rotY: lonCenter, zoom: 1 });
  const depthOf = (world: Vec3) => camera.project(world, COLS, ROWS, 1)[2];
  return (lon, lat, elev) => {
    const world = projection.project(lon, lat, elev);
    return world.every((v) => Number.isFinite(v)) && projection.visible!(world, depthOf);
  };
}

/** The polygons NOT flagged hidden, in mesh order. */
function visiblePolygons(polygons: readonly Polygon[]): Polygon[] {
  return polygons.filter((p) => !p.hidden);
}

describe("glyphMapVectorMarkWalls", () => {
  it("marks exactly the complement of what glyphMapVectorCullWalls keeps, at every camera", () => {
    for (const lonCenter of [0, 45, 90, 150, -110]) {
      const visible = nearSideAt(lonCenter);
      // Two independent meshes so the subset form cannot see the flags the
      // mark form writes, and vice versa.
      const subsetMesh = mesh();
      const markMesh = mesh();
      const kept = glyphMapVectorCullWalls(subsetMesh, visible);
      glyphMapVectorMarkWalls(markMesh, visible);
      const shown = visiblePolygons(markMesh.polygons);

      expect(shown.length).toBe(kept.length);
      // Same POSITIONS in the mesh, which is what keeps draw order — and the
      // coplanar tie-break that rides on it — identical between the two.
      const keptIndexes = kept.map((p) => subsetMesh.polygons.indexOf(p));
      const shownIndexes = shown.map((p) => markMesh.polygons.indexOf(p));
      expect(shownIndexes).toEqual(keptIndexes);
    }
  });

  it("actually hides something, and keeps something — neither verdict is vacuous", () => {
    const m = mesh();
    glyphMapVectorMarkWalls(m, nearSideAt(0));
    const hidden = m.polygons.filter((p) => p.hidden).length;
    expect(hidden).toBeGreaterThan(0);
    expect(m.polygons.length - hidden).toBeGreaterThan(0);
  });

  it("never hides a CAP — only walls carry a camera-dependent verdict", () => {
    const m = mesh();
    const capCount = m.polygons.length - m.walls.length;
    expect(capCount).toBeGreaterThan(0);
    glyphMapVectorMarkWalls(m, () => false);
    const wallPolygons = new Set(m.walls.map((w) => w.polygon));
    for (let i = 0; i < m.polygons.length; i++) {
      if (!wallPolygons.has(i)) expect(m.polygons[i]!.hidden ?? false).toBe(false);
    }
  });

  it("is idempotent, and reports whether a flag actually moved", () => {
    const m = mesh();
    expect(glyphMapVectorMarkWalls(m, nearSideAt(0))).toBe(true);
    expect(glyphMapVectorMarkWalls(m, nearSideAt(0))).toBe(false);
    // A genuinely different camera moves flags again.
    expect(glyphMapVectorMarkWalls(m, nearSideAt(150))).toBe(true);
  });

  it("takes a `provenHidden` proof without changing the verdict it would have reached", () => {
    const visible = nearSideAt(0);
    const plain = mesh();
    glyphMapVectorMarkWalls(plain, visible);
    const truth = plain.walls.map((w) => plain.polygons[w.polygon]!.hidden === true);

    // A proof that names a SUBSET of what the predicate already rejects —
    // which is exactly the contract, and exactly what a distance bound gives.
    let asked = 0;
    const proved = mesh();
    glyphMapVectorMarkWalls(proved, visible, (_wall, index) => {
      asked++;
      return truth[index] === true && index % 2 === 0;
    });
    expect(asked).toBe(proved.walls.length);
    expect(proved.walls.map((w) => proved.polygons[w.polygon]!.hidden === true)).toEqual(truth);
  });

  it("short-circuits the predicate for a wall the proof rules out", () => {
    // The point of the hook: a proven-hidden wall must not reach `visible` at
    // all, because `visible` is a projection plus a haversine per corner.
    const m = mesh();
    let predicateCalls = 0;
    glyphMapVectorMarkWalls(m, (lon, lat, elev) => { predicateCalls++; return nearSideAt(0)(lon, lat, elev); }, () => true);
    expect(predicateCalls).toBe(0);
    expect(m.walls.every((w) => m.polygons[w.polygon]!.hidden === true)).toBe(true);
  });

  it("clears a flag when a wall comes back, not only sets it when one leaves", () => {
    const m = mesh();
    glyphMapVectorMarkWalls(m, () => false);
    expect(m.walls.every((w) => m.polygons[w.polygon]!.hidden === true)).toBe(true);
    glyphMapVectorMarkWalls(m, () => true);
    expect(m.walls.every((w) => m.polygons[w.polygon]!.hidden === false)).toBe(true);
  });
});
