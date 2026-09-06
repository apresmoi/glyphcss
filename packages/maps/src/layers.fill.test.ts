/**
 * `fill` / `fill-extrusion` geometry, decided by the REAL rasterizer.
 *
 * Every assertion here renders through `glyphcss`'s own `compileScene` (pure,
 * DOM-less, documented byte-identical to the runtime render) rather than
 * re-implementing the front/back test in the test. That matters because the
 * cull lives in `scanFillTriangle` — signed screen-space 2x area, `area2 > 0`
 * dropped — and a fixture that merely checks a normal's sign would keep
 * passing if the convention ever moved.
 *
 * Camera geometry these fixtures depend on (`cellAspect: 1` -> square 50px
 * cells, `zoom: 75` -> 1.5 cells per world unit, `cols`/`rows` 41 -> centre
 * cell 20.5):
 *
 *   rotX 0   col = 20.5 + 1.5*lon   row = 20.5 - 1.5*lat    (straight down)
 *   rotX 65  col = 20.5 + 1.5*lon   row = 20.5 + 1.5*(-lat*cos65 - h*sin65)
 *
 * `exaggeration: GLYPH_MAP_EARTH_RADIUS_M` makes `height`/`base` read as world
 * units instead of metres (`reliefZ` divides by the earth radius), so the
 * numbers above stay legible.
 */
import { describe, expect, it } from "vitest";
import { compileScene, createGlyphOrthographicCamera, type Polygon } from "glyphcss";
import { glyphMapVectorPolygons } from "./layers";
import { GLYPH_MAP_EARTH_RADIUS_M, glyphMapEquirectangular, glyphMapFromD3Raw } from "./projection";
import type { GlyphMapVectorFeature } from "./vector/types";

const COLS = 41;
const ROWS = 41;
const ZOOM = 75;

const projection = glyphMapEquirectangular({ exaggeration: GLYPH_MAP_EARTH_RADIUS_M });

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

function inkedCells(grid: readonly string[]): number {
  return grid.reduce((n, line) => n + [...line].filter((c) => c !== " ").length, 0);
}

function inkedInRows(grid: readonly string[], from: number, to: number): number {
  return inkedCells(grid.slice(from, to + 1));
}

function cellAt(grid: readonly string[], col: number, row: number): string {
  return grid[row]?.[col] ?? " ";
}

/** Ring corners in lon/lat, counter-clockwise (the GeoJSON outer convention). */
function ccwRing(half: number): (readonly [number, number])[] {
  return [[-half, -half], [half, -half], [half, half], [-half, half], [-half, -half]];
}

function reversed(ring: readonly (readonly [number, number])[]): (readonly [number, number])[] {
  return [...ring].reverse();
}

function feature(polygons: (readonly [number, number])[][][], properties?: Record<string, unknown>): GlyphMapVectorFeature {
  return { geometryType: "polygon", properties, rings: polygons.flat(), polygons };
}

describe("fill layer winding", () => {
  const outerCcw = ccwRing(10);
  const outerCw = reversed(outerCcw);

  it("renders a clockwise-wound ring front-facing, exactly like a counter-clockwise one", () => {
    const ccw = render(glyphMapVectorPolygons([feature([[outerCcw]])], projection), 0);
    const cw = render(glyphMapVectorPolygons([feature([[outerCw]])], projection), 0);
    // A back-facing cap is culled by `scanFillTriangle`, so the whole square
    // vanishes — hence the non-emptiness check alongside the equality.
    expect(inkedCells(ccw)).toBeGreaterThan(600);
    expect(cw).toEqual(ccw);
  });

  it("preserves the per-polygon attribute colour join through the fix", () => {
    const polygons = glyphMapVectorPolygons([feature([[outerCw]])], projection, { color: () => "#123456" });
    expect(polygons.length).toBeGreaterThan(0);
    expect(polygons.every((p) => p.color === "#123456")).toBe(true);
  });

  it("still skips a group cropped by the projection's valid window", () => {
    const mercator = glyphMapEquirectangular();
    const offDomain = glyphMapVectorPolygons(
      [feature([[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]] as (readonly [number, number])[]]])],
      { ...mercator, project: () => [NaN, NaN, NaN] },
    );
    expect(offDomain).toEqual([]);
  });
});

describe("fill layer holes", () => {
  const outer = ccwRing(10);
  const hole = reversed(ccwRing(4));

  it("leaves a ring's hole empty and the surrounding band intact", () => {
    const grid = render(glyphMapVectorPolygons([feature([[outer, hole]])], projection), 0);
    // Dead centre of the hole.
    expect(cellAt(grid, 20, 20)).toBe(" ");
    // Well inside the hole but off-centre (lon/lat +-2 -> +-3 cells).
    expect(cellAt(grid, 23, 23)).toBe(" ");
    expect(cellAt(grid, 17, 17)).toBe(" ");
    // The fill band between the hole and the outer edge (lon 7 -> col ~31).
    expect(cellAt(grid, 31, 20)).not.toBe(" ");
    expect(cellAt(grid, 10, 20)).not.toBe(" ");
    expect(cellAt(grid, 20, 31)).not.toBe(" ");
    expect(cellAt(grid, 20, 10)).not.toBe(" ");
  });

  it("honours a hole no matter which winding the source rings arrive in", () => {
    const canonical = render(glyphMapVectorPolygons([feature([[outer, hole]])], projection), 0);
    const flipped = render(glyphMapVectorPolygons([feature([[reversed(outer), reversed(hole)]])], projection), 0);
    const sameWinding = render(glyphMapVectorPolygons([feature([[outer, reversed(hole)]])], projection), 0);
    expect(flipped).toEqual(canonical);
    expect(sameWinding).toEqual(canonical);
  });
});

describe("fill-extrusion winding", () => {
  const outerCcw = ccwRing(10);
  const outerCw = reversed(outerCcw);
  const props = { height: 5 };
  const opts = { height: (f: GlyphMapVectorFeature) => Number(f.properties?.height ?? 0) };

  /**
   * At rotX 65 the roof occupies rows ~7..20 and the near (south) wall skirt
   * rows ~21..26 — disjoint bands, because the roof's own south edge and the
   * wall's top edge meet at row 20.05. So ink below row 21 exists ONLY if the
   * south wall is front-facing, which is what makes this a wall assertion
   * rather than a silhouette one. Inward-facing walls leave that band empty
   * (the far/north wall still renders, but in the roof's band).
   */
  const WALL_SKIRT_FROM = 22;
  const WALL_SKIRT_TO = 26;

  it("gives a clockwise-wound extruded ring outward-facing walls", () => {
    const ccw = render(glyphMapVectorPolygons([feature([[outerCcw]], props)], projection, opts), 65);
    const cw = render(glyphMapVectorPolygons([feature([[outerCw]], props)], projection, opts), 65);
    expect(inkedInRows(ccw, WALL_SKIRT_FROM, WALL_SKIRT_TO)).toBeGreaterThan(60);
    expect(inkedInRows(ccw, 8, 19)).toBeGreaterThan(300);
    expect(cw).toEqual(ccw);
  });

  it("keeps the roof cap alone when height is zero", () => {
    const flat = glyphMapVectorPolygons([feature([[outerCw]])], projection);
    expect(flat.every((p) => p.vertices.every((v) => v[2] === 0))).toBe(true);
  });
});

describe("fill-extrusion holes", () => {
  const outer = ccwRing(10);
  const hole = reversed(ccwRing(4));
  const props = { height: 5 };
  const opts = { height: (f: GlyphMapVectorFeature) => Number(f.properties?.height ?? 0) };

  it("leaves the roof aperture empty from directly above", () => {
    const grid = render(glyphMapVectorPolygons([feature([[outer, hole]], props)], projection, opts), 0);
    // Vertical walls project to zero area straight down, so the aperture can
    // only be filled by a roof that ignored the hole.
    expect(cellAt(grid, 20, 20)).toBe(" ");
    expect(cellAt(grid, 23, 23)).toBe(" ");
    expect(cellAt(grid, 31, 20)).not.toBe(" ");
  });

  it("walls the aperture from inside, facing into the hole", () => {
    const grid = render(glyphMapVectorPolygons([feature([[outer, hole]], props)], projection, opts), 65);
    // Cols 16..25 x rows 12..16 fall inside the roof aperture, so the only
    // thing that can fill them is the hole's own north inner wall — which
    // faces SOUTH, into the hole. Give that wall the outer ring's winding
    // instead and it faces north, is culled, and this rectangle goes blank
    // (verified: exactly this window empties).
    for (let row = 12; row <= 16; row++) {
      for (let col = 16; col <= 25; col++) {
        expect(cellAt(grid, col, row), `cell ${col},${row}`).not.toBe(" ");
      }
    }
  });
});

/**
 * Every projection this package ships maps lon/lat into world space
 * orientation-PRESERVINGLY, so normalizing the source rings in lon/lat is on
 * its own enough for all of them. `glyphMapFromD3Raw` lets a caller bring a
 * raw projection with the opposite convention — `y` growing southward, which
 * is what a d3 SCREEN projection produces — and that one reverses handedness.
 * These pin the second half of the fix: the world-space facing probe, which
 * has no shipped projection to exercise it.
 */
describe("orientation-reversing projection", () => {
  const DEG = Math.PI / 180;
  // The mirror of `glyphMapEquirectangular`: world X = +lat, not -lat.
  const mirrored = glyphMapFromD3Raw(
    (lambda, phi) => [lambda / DEG, -phi / DEG],
    { id: "test-mirrored-equirectangular", exaggeration: GLYPH_MAP_EARTH_RADIUS_M },
  );
  const outer = ccwRing(10);
  const props = { height: 5 };
  const opts = { height: (f: GlyphMapVectorFeature) => Number(f.properties?.height ?? 0) };

  it("faces the cap toward the camera even though the projection flips handedness", () => {
    const ccw = render(glyphMapVectorPolygons([feature([[outer]])], mirrored), 0);
    const cw = render(glyphMapVectorPolygons([feature([[reversed(outer)]])], mirrored), 0);
    expect(inkedCells(ccw)).toBeGreaterThan(600);
    expect(cw).toEqual(ccw);
  });

  it("reverses the extrusion walls with the cap, so they still face outward", () => {
    const grid = render(glyphMapVectorPolygons([feature([[outer]], props)], mirrored, opts), 65);
    // Same two disjoint bands as the equirectangular case — the projection is
    // its north/south mirror, and at rotX 65 the near wall is now the north
    // one. Ink in the skirt band still means an outward-facing near wall.
    expect(inkedInRows(grid, 22, 26)).toBeGreaterThan(60);
    expect(inkedInRows(grid, 8, 19)).toBeGreaterThan(300);
  });

  it("keeps a hole open under the flip", () => {
    const grid = render(glyphMapVectorPolygons([feature([[outer, reversed(ccwRing(4))]])], mirrored), 0);
    expect(cellAt(grid, 20, 20)).toBe(" ");
    expect(cellAt(grid, 31, 20)).not.toBe(" ");
  });
});
