/**
 * A `fill-extrusion` band RAISED off its own ground has an underside, and
 * before this it had none: `glyphMapVectorMesh` emitted a cap and walls, the
 * cap faces up so back-face culling removes it from below, the far walls go
 * with it, and the eye looking up at the band sees straight through it.
 *
 * Reported on the Berlin Fernsehturm. Its live OpenFreeMap z14 tile
 * (`14/8802/5373`) ships the tower as eight stacked `render_min_height`
 * bands — 0..205, 205..235, 235..256, 256..264, 264..285, 284..307, 307..332
 * and 332..374 — so seven of the eight are raised, and from the street every
 * one of them was a hollow shell.
 *
 * The gate is a RENDER from underneath, not a polygon count: a floor whose
 * winding is wrong is still a polygon and still draws nothing.
 *
 * The second clause is the gate on the GATE. A band standing ON its ground
 * gets no floor, because that floor is coplanar with the terrain and can
 * never be seen — so the grounded path has to stay exactly what it was, and
 * dropping `baseOffset > 0` reddens it.
 */
import { describe, expect, it } from "vitest";
import { compileScene, createGlyphOrthographicCamera, type Polygon } from "glyphcss";
import { glyphMapVectorMesh } from "./layers";
import { GLYPH_MAP_EARTH_RADIUS_M, glyphMapEquirectangular } from "./projection";
import type { GlyphMapVectorFeature } from "./vector/types";

const COLS = 41;
const ROWS = 41;
const ZOOM = 75;

/** One world unit per metre of true height, so the fixtures below are legible as world units. */
const projection = glyphMapEquirectangular({ exaggeration: GLYPH_MAP_EARTH_RADIUS_M });

const square: GlyphMapVectorFeature = {
  geometryType: "polygon",
  properties: {},
  rings: [[[-4, -4], [4, -4], [4, 4], [-4, 4], [-4, -4]]],
};

/** A band `thickness` metres tall whose underside sits `offset` metres above the ground. */
function band(offset: number, thickness: number) {
  return glyphMapVectorMesh([square], projection, {
    height: () => thickness,
    baseOffset: () => offset,
  });
}

function render(polygons: readonly Polygon[], rotX: number): string[] {
  const { inner } = compileScene({
    polygons,
    camera: createGlyphOrthographicCamera({ rotX, rotY: 0, zoom: ZOOM }),
    cols: COLS,
    rows: ROWS,
    cellAspect: 1,
    mode: "solid",
    useColors: false,
  });
  return inner
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .split("\n");
}

function inked(grid: readonly string[]): number {
  return grid.reduce((n, line) => n + [...line].filter((c) => c !== " ").length, 0);
}

/** The face's geometric normal, Newell over its own vertices. */
function normalOf(polygon: Polygon): readonly [number, number, number] {
  const v = polygon.vertices;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

describe("a raised extrusion band has an underside", () => {
  it("draws from below, in the same silhouette it draws from above", () => {
    const raised = band(200, 30);
    // rotX 0 is straight down on this camera and 180 is straight up at it, so
    // these two framings see the same square from opposite poles. A solid
    // band paints the same cells either way; a band with no floor paints
    // none at all from below, which is the reported defect.
    const above = render(raised.polygons, 0);
    const below = render(raised.polygons, 180);
    expect(inked(above)).toBeGreaterThan(0);
    expect(inked(below)).toBe(inked(above));
  });

  it("winds every floor face downward", () => {
    const raised = band(200, 30);
    const base = Math.min(...raised.polygons.flatMap((p) => p.vertices.map((v) => v[2])));
    const floors = raised.polygons.filter((p) => p.vertices.every((v) => v[2] === base) && p.vertices.length === 3);
    expect(floors.length).toBeGreaterThan(0);
    // Equirectangular's up is +Z, so a face that looks down has a negative one.
    for (const floor of floors) expect(normalOf(floor)[2]).toBeLessThan(0);
  });

  it("keeps the floor out of a band standing on its own ground", () => {
    const grounded = band(0, 30);
    const raised = band(200, 30);
    // A square footprint: two cap triangles and four walls, and that is the
    // whole of the grounded mesh exactly as before this existed.
    expect(grounded.polygons).toHaveLength(6);
    expect(raised.polygons).toHaveLength(8);
    expect(inked(render(grounded.polygons, 180))).toBe(0);
  });
});
