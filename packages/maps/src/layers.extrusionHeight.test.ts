/**
 * An extrusion's HEIGHT is a real measured quantity, so it renders at true
 * metres no matter how far the terrain under it is exaggerated — while its
 * BASE stays on that exaggerated terrain, because the ground a building
 * stands on is wherever the terrain says it is.
 *
 * That split is the whole contract, and reversing either half is a visible
 * defect: exaggerating the height draws a 20 m house 480 m tall at `/maps`'
 * default `exaggeration: 24` (the reported "the OpenStreetMap buildings seem
 * a bit disproportioned"), while de-exaggerating the base buries every
 * structure inside the relief it should be standing on.
 *
 * Assertions are on WORLD Z (and on radius for the globe), read straight off
 * the polygons `glyphMapVectorMesh` emits — the same vertices the rasterizer
 * consumes — not on the elevation arguments handed to `project`, which would
 * pass for an implementation that merely moved the multiply around.
 */
import { describe, expect, it } from "vitest";
import { glyphMapVectorMesh } from "./layers";
import { glyphMapPolygons } from "./mesh";
import { GLYPH_MAP_EARTH_RADIUS_M, glyphMapEquirectangular, glyphMapGlobe } from "./projection";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapVectorFeature } from "./vector/types";

const BUILDING_M = 30;
const GROUND_M = 1_000;

const square: GlyphMapVectorFeature = {
  geometryType: "polygon",
  properties: {},
  rings: [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]],
};

function extrusion(exaggeration: number, height: number, base = 0) {
  return glyphMapVectorMesh([square], glyphMapEquirectangular({ exaggeration }), {
    height: () => height,
    base: () => base,
  });
}

/** Every world Z the mesh emits, deduplicated to the two rings an extrusion actually has. */
function zRange(polygons: readonly { vertices: readonly (readonly [number, number, number])[] }[]): { min: number; max: number } {
  const zs = polygons.flatMap((p) => p.vertices.map((v) => v[2]));
  return { min: Math.min(...zs), max: Math.max(...zs) };
}

function flatTile(elevation: number): GlyphMapGeoTile {
  return {
    bounds: { west: -1, east: 1, south: -1, north: 1 },
    cols: 1,
    rows: 1,
    elevation: Float32Array.from([elevation, elevation, elevation, elevation]),
    source: "synthetic",
    sampler: "nearest",
  };
}

describe("fill-extrusion height is exempt from terrain exaggeration", () => {
  it("renders the same world height at exaggeration 1 and at exaggeration 24", () => {
    const plain = zRange(extrusion(1, BUILDING_M).polygons);
    const exaggerated = zRange(extrusion(24, BUILDING_M).polygons);
    // True scale: the world Z axis is a fraction of Earth's radius, so a
    // 30 m building is 30/R world units tall — at BOTH exaggerations.
    expect(plain.max - plain.min).toBeCloseTo(BUILDING_M / GLYPH_MAP_EARTH_RADIUS_M, 15);
    expect(exaggerated.max - exaggerated.min).toBe(plain.max - plain.min);
  });

  it("still exaggerates the terrain the building stands on", () => {
    const zOf = (exaggeration: number) =>
      zRange(glyphMapPolygons(flatTile(BUILDING_M), glyphMapEquirectangular({ exaggeration })) as never).max;
    // The control: terrain at the SAME 30 m is 24x taller at exaggeration 24,
    // so the test above is proving an exemption, not a projection that ignores
    // elevation altogether.
    expect(zOf(24) / zOf(1)).toBeCloseTo(24, 9);
  });

  it("leaves the base sitting on the exaggerated terrain", () => {
    const projection = glyphMapEquirectangular({ exaggeration: 24 });
    const { min, max } = zRange(extrusion(24, BUILDING_M, GROUND_M).polygons);
    // The BASE is a terrain elevation and moves with the relief it stands on —
    // exactly `project(lon, lat, 1000)`'s own Z, to the bit.
    expect(min).toBe(projection.project(0, 0, GROUND_M)[2]);
    // ...and only the height on top of it is true-scale.
    expect(max - min).toBeCloseTo(BUILDING_M / GLYPH_MAP_EARTH_RADIUS_M, 15);
  });

  it("lifts by true metres along the globe's radial up as well", () => {
    const radii = (exaggeration: number) => {
      const mesh = glyphMapVectorMesh([square], glyphMapGlobe({ radius: 1, exaggeration }), {
        height: () => BUILDING_M,
        base: () => GROUND_M,
      });
      const lengths = mesh.polygons.flatMap((p) => p.vertices.map((v) => Math.hypot(v[0], v[1], v[2])));
      return { min: Math.min(...lengths), max: Math.max(...lengths) };
    };
    const plain = radii(1);
    const exaggerated = radii(24);
    // `radius: 1` means one world unit per Earth radius, so a true-scale 30 m
    // wall spans 30/R of radial thickness whatever the terrain does.
    expect(plain.max - plain.min).toBeCloseTo(BUILDING_M / GLYPH_MAP_EARTH_RADIUS_M, 15);
    expect(exaggerated.max - exaggerated.min).toBeCloseTo(BUILDING_M / GLYPH_MAP_EARTH_RADIUS_M, 15);
    // The base still rides the exaggerated ground: 24x further out. Asserted
    // as a RATIO — the two radial offsets differ by 24x on the 13th
    // significant figure of a number that is `1 + 0.0038`, which is inside
    // double precision as an absolute difference but not as an exact one.
    expect((exaggerated.min - 1) / (plain.min - 1)).toBeCloseTo(24, 9);
  });

  it("keeps a wall's own recorded top elevation on the same axis its cap was projected on", () => {
    const projection = glyphMapGlobe({ radius: 1, exaggeration: 24 });
    const mesh = glyphMapVectorMesh([square], projection, { height: () => BUILDING_M, base: () => GROUND_M });
    const wall = mesh.walls[0];
    expect(wall).toBeDefined();
    // `glyphMapVectorCullWalls` re-projects `elevTop` to decide whether a wall
    // clears the globe's limb, so it has to be the elevation the cap was
    // actually built at — a true-metre number here would over-reach the
    // horizon by the exaggeration factor.
    const top = projection.project(wall.a[0], wall.a[1], wall.elevTop);
    const capMax = Math.max(...mesh.polygons.flatMap((p) => p.vertices.map((v) => Math.hypot(v[0], v[1], v[2]))));
    expect(Math.hypot(top[0], top[1], top[2])).toBeCloseTo(capMax, 15);
  });

  it("treats the flat `height` fallback and an attribute the same way — both are metres", () => {
    const viaOption = zRange(extrusion(24, BUILDING_M).polygons);
    const viaAttribute = zRange(
      glyphMapVectorMesh(
        [{ ...square, properties: { render_height: BUILDING_M } }],
        glyphMapEquirectangular({ exaggeration: 24 }),
        { height: (f) => Number(f.properties?.render_height ?? 0) },
      ).polygons,
    );
    expect(viaAttribute.max - viaAttribute.min).toBe(viaOption.max - viaOption.min);
  });

  it("leaves a flat fill (no height) byte-identical under exaggeration", () => {
    const fill = glyphMapVectorMesh([square], glyphMapEquirectangular({ exaggeration: 24 }), { base: () => GROUND_M });
    const projection = glyphMapEquirectangular({ exaggeration: 24 });
    expect(fill.walls).toHaveLength(0);
    expect(fill.polygons.every((p) => p.vertices.every((v) => v[2] === projection.project(0, 0, GROUND_M)[2]))).toBe(true);
  });
});
