/**
 * `fill` / `fill-extrusion` geometry on a CURVED projection.
 *
 * `layers.fill.test.ts` pins winding, holes and the world-space facing probe
 * against `glyphMapEquirectangular` — a projection that is AFFINE in lon/lat,
 * so a lon/lat triangle and its projected chord triangle are the same shape.
 * The globe is not: `glyphMapVectorPolygons` triangulates with earcut in
 * lon/lat and emits ONE FLAT CHORD FACE per lon/lat triangle, and on a sphere
 * a face spanning a large arc
 *
 *   (a) has a chord that dives far BELOW the surface — measured on the real
 *       baked `website/public/data/vector-tiles` pyramid: a z1 tile emitted a
 *       face with a 1.922-radius edge (96% of the sphere's own diameter — a
 *       chord through the middle of the globe) whose centroid sat 0.575 of a
 *       radius under the surface; the z0 tile emitted 44 such faces,
 *   (b) has a plane normal that can point INTO the sphere — the same z0 tile
 *       produced a minimum plane-vs-origin distance of -1.000, i.e. a face
 *       whose "outward" normal is tangent at the ANTIPODE and therefore aims
 *       straight back at the camera from the far hemisphere, and
 *   (c) is consequently NOT removed by the rasterizer's own backface cull,
 *       which is what should hide far-hemisphere geometry for free.
 *
 * That is one mechanism behind two reported symptoms: "a weird line that
 * renders inside the world" (a) and "you see things that should be on the
 * other side" (b)/(c).
 *
 * The fix is curvature-adaptive subdivision driven by the PROJECTION ITSELF
 * (see `glyphMapVectorPolygons`'s "Curvature" section), so these assertions
 * are geometric properties of the emitted faces rather than a face count.
 */
import { describe, expect, it } from "vitest";
import type { Polygon, Vec3 } from "glyphcss";
import { glyphMapVectorPolygons } from "./layers";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";
import type { GlyphMapVectorFeature } from "./vector/types";

const GLOBE_RADIUS = 1;

function newell(points: readonly Vec3[]): Vec3 {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}
const length = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
function unit(v: Vec3): Vec3 {
  const n = length(v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function centroid(points: readonly Vec3[]): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (const p of points) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  return [c[0] / points.length, c[1] / points.length, c[2] / points.length];
}

/**
 * A face's plane distance from the sphere's centre, SIGNED along its own
 * outward normal. Every vertex of a planar face has the same value, so this
 * is exactly "does this face's front side look away from the globe's centre".
 * Negative = the face's front side looks INTO the globe.
 */
function planeDistance(polygon: Polygon): number {
  const vertices = polygon.vertices as readonly Vec3[];
  return dot(unit(newell(vertices)), vertices[0]);
}

/** How far under the sphere's surface a face's own centroid sits, in radii. */
function chordSag(polygon: Polygon): number {
  return GLOBE_RADIUS - length(centroid(polygon.vertices as readonly Vec3[]));
}

function ring(west: number, east: number, south: number, north: number, step = 5): [number, number][] {
  const out: [number, number][] = [];
  for (let lon = west; lon <= east; lon += step) out.push([lon, south]);
  for (let lat = south + step; lat <= north; lat += step) out.push([east, lat]);
  for (let lon = east - step; lon >= west; lon -= step) out.push([lon, north]);
  for (let lat = north - step; lat >= south; lat -= step) out.push([west, lat]);
  out.push([west, south]);
  return out;
}

function feature(rings: readonly (readonly [number, number])[][], properties?: Record<string, unknown>): GlyphMapVectorFeature {
  return { geometryType: "polygon", properties, rings, polygons: [rings] };
}

const CASES: readonly { readonly name: string; readonly rings: readonly (readonly [number, number])[][] }[] = [
  // Every one of these is bigger than a glyph cell's worth of arc, which is
  // the whole point: real admin_0 country rings at the pyramid's shallow
  // levels routinely span tens of degrees.
  { name: "a 70x60-degree patch straddling the limb", rings: [ring(60, 130, -30, 30)] },
  { name: "a 140x80-degree far-hemisphere patch", rings: [ring(110, 250, -40, 40)] },
  { name: "a 140x80-degree near-hemisphere patch", rings: [ring(-70, 70, -40, 40)] },
  { name: "a polar patch reaching the pole", rings: [ring(-180, 180, 60, 90, 15)] },
  { name: "an outer ring with a hole", rings: [ring(-70, 70, -40, 40), [...ring(-30, 30, -15, 15)].reverse()] },
];

describe("glyphMapVectorPolygons on the globe — no face may look into the sphere", () => {
  for (const testCase of CASES) {
    it(`emits only outward-facing cap faces for ${testCase.name}`, () => {
      const polygons = glyphMapVectorPolygons([feature(testCase.rings)], glyphMapGlobe());
      expect(polygons.length).toBeGreaterThan(0);
      const inward = polygons.filter((p) => planeDistance(p) <= 0);
      expect(inward.map(planeDistance)).toEqual([]);
    });

    it(`keeps every cap face's chord within 2% of a radius of the surface for ${testCase.name}`, () => {
      const polygons = glyphMapVectorPolygons([feature(testCase.rings)], glyphMapGlobe());
      const deep = polygons.filter((p) => chordSag(p) > 0.02);
      expect(deep.map(chordSag)).toEqual([]);
    });
  }

  it("keeps an extrusion's WALLS out of the sphere's interior too", () => {
    // `exaggeration` 1 with a metre height keeps the walls a thin skirt on
    // the surface, so any wall face whose centroid sits deep inside the globe
    // got there through a chord, not through its own height.
    const polygons = glyphMapVectorPolygons(
      [feature([ring(-70, 70, -40, 40)], { height: 200_000 })],
      glyphMapGlobe(),
      { height: (f) => Number(f.properties?.height ?? 0) },
    );
    const deep = polygons.filter((p) => chordSag(p) > 0.02);
    expect(deep.map(chordSag)).toEqual([]);
  });
});

describe("glyphMapVectorPolygons — an affine projection is untouched", () => {
  const projection = glyphMapEquirectangular();

  it("emits the identical face list for a wide patch (no subdivision at all)", () => {
    // `glyphMapEquirectangular` is affine in lon/lat, so the projected
    // midpoint of every edge IS the chord midpoint and the curvature probe
    // never fires. Pinned as an exact vertex-by-vertex comparison against a
    // hand-triangulated expectation would restate earcut; the property that
    // matters is that the flat path emits ONE face per earcut triangle, which
    // is what this count is.
    const wide = glyphMapVectorPolygons([feature([ring(-170, 170, -80, 80, 10)])], projection);
    // 101 boundary vertices after `openRing` -> 98 earcut triangles.
    expect(wide.length).toBe(98);
  });

  it("emits the identical face list for an extruded wide patch", () => {
    const wide = glyphMapVectorPolygons(
      [feature([ring(-170, 170, -80, 80, 10)], { height: 5 })],
      projection,
      { height: (f) => Number(f.properties?.height ?? 0) },
    );
    // 98 cap triangles + one wall per boundary edge (101 open-ring vertices).
    expect(wide.length).toBe(98 + 101);
  });
});
