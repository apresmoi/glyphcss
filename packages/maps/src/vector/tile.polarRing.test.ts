/**
 * A polygon group whose FIRST ring bounds no area still fills — the
 * end-to-end gate for Antarctica's mainland on the Natural Earth 50m source.
 *
 * That source encodes Antarctica's mainland as a two-ring group whose
 * EXTERIOR ring is the 257-vertex pole edge (every vertex at lat -89.999,
 * so the ring is exactly collinear and encloses zero planar area) and whose
 * second ring is the real 2,539-vertex coastline. Spherically that pair is
 * an annulus; in this package's planar lon/lat model the pole edge bounds
 * nothing and the coast ring alone is the mainland, closed down to the pole
 * by `closeOverPole` exactly as the 110m source's single-ring Antarctica
 * already is.
 *
 * Two independent things then hit the same group:
 *
 * - `glyphMapSimplifyArc` correctly collapses the pole edge to its two
 *   (identical) endpoints — every interior triangle has area exactly 0, and
 *   VW never removes an arc endpoint, so a closed collinear arc legitimately
 *   reduces to one repeated point. Pinned in `simplify.test.ts`.
 * - `glyphMapClipPolygonGroup` then has to decide what a zero-area exterior
 *   ring means. Treating it as the group's outline discards the whole
 *   mainland (before this gate: every z2/z3 tile carried Antarctica's
 *   islands and nothing else).
 *
 * Camera geometry (`cellAspect: 1` -> square 50px cells, `zoom: 25` -> 0.5
 * cells per degree under `exaggeration: GLYPH_MAP_EARTH_RADIUS_M`,
 * `rotX: 0` straight down), sized so the whole -90..90 latitude range fits:
 *
 *   col = 90 + 0.5 * lon      row = 45 - 0.5 * lat
 */
import { describe, expect, it } from "vitest";
import { compileScene, createGlyphOrthographicCamera, type Polygon } from "glyphcss";
import { glyphMapVectorPolygons } from "../layers";
import { GLYPH_MAP_EARTH_RADIUS_M, glyphMapEquirectangular } from "../projection";
import { glyphMapSimplifyArcs, type GlyphMapLonLat } from "./simplify";
import type { GlyphMapVectorFeature } from "./types";
import { glyphMapBuildVectorTile, glyphMapDecodeVectorTile } from "./tile";

const COLS = 181;
const ROWS = 91;
const ZOOM = 25;
const CELLS_PER_DEG = ZOOM / 50;

const projection = glyphMapEquirectangular({ exaggeration: GLYPH_MAP_EARTH_RADIUS_M });

function render(polygons: readonly Polygon[]): string[] {
  const { inner } = compileScene({
    polygons,
    camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: ZOOM }),
    cols: COLS,
    rows: ROWS,
    cellAspect: 1,
    mode: "solid",
    useColors: false,
  });
  return inner.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").split("\n");
}

/**
 * The pole-edge ring, in Natural Earth 50m's own shape: 257 vertices all at
 * lat -89.999, starting at lon -180 and walking WEST (decreasing longitude,
 * which wraps immediately to +178.59) back to -180.
 */
function poleEdgeRing(): GlyphMapLonLat[] {
  const ring: GlyphMapLonLat[] = [[-180, -89.999]];
  for (let k = 1; k < 256; k++) ring.push([180 - (k * 360) / 256, -89.999]);
  ring.push([-180, -89.999]);
  return ring;
}

/** A wobbly coastline encircling the south pole, closed at lon -180 like the real one. */
function coastRing(): GlyphMapLonLat[] {
  const ring: GlyphMapLonLat[] = [];
  const n = 240;
  for (let k = 0; k < n; k++) {
    const lon = -180 + (k * 360) / n;
    ring.push([lon, -70 + 3 * Math.sin((4 * lon * Math.PI) / 180)]);
  }
  ring.push([ring[0][0], ring[0][1]]);
  return ring;
}

function antarcticaFeature(rings: readonly GlyphMapLonLat[][]): GlyphMapVectorFeature {
  return { id: "ata", geometryType: "polygon", properties: { name: "Antarctica" }, rings: [...rings], polygons: [[...rings]] };
}

/** Bake into every z2 tile of the southern band, decode, and mesh exactly as the widget does. */
function tiledPolygons(feature: GlyphMapVectorFeature): Polygon[] {
  const out: Polygon[] = [];
  for (let x = 0; x < 4; x++) {
    const wire = glyphMapBuildVectorTile({ admin0: [feature] }, 2, x, 3, { source: "t", simplify: "z2" });
    const tile = glyphMapDecodeVectorTile(wire);
    for (const decoded of tile.layers.admin0 ?? []) out.push(...glyphMapVectorPolygons([decoded], projection));
  }
  return out;
}

const at = (grid: readonly string[], lon: number, lat: number): string =>
  grid[Math.round(45 - lat * CELLS_PER_DEG)]?.[Math.round(90 + lon * CELLS_PER_DEG)] ?? " ";

describe("a polar mainland whose exterior ring is the pole edge", () => {
  // The two bake epsilons the global pyramid actually uses for the 50m
  // source: z2 = (360/4/180)/2 = 0.25 deg, z3 = 0.125 deg.
  const EPSILONS = [0.25, 0.125] as const;

  it("keeps the mainland COAST ring under both 50m bake epsilons", () => {
    const coast = coastRing();
    for (const eps of EPSILONS) {
      const [simplified] = glyphMapSimplifyArcs([coast], eps);
      // Enough vertices to be a polygon at all, and still recognisably the
      // coastline rather than a handful of survivors.
      expect(simplified.length).toBeGreaterThan(50);
      expect(simplified[0]).toEqual(coast[0]);
      expect(simplified[simplified.length - 1]).toEqual(coast[coast.length - 1]);
    }
  });

  it.each(EPSILONS)("fills a polar cap at bake epsilon %s despite the zero-area exterior ring", (eps) => {
    const [pole, coast] = glyphMapSimplifyArcs([poleEdgeRing(), coastRing()], eps);
    const grid = render(tiledPolygons(antarcticaFeature([pole, coast])));
    // Interior of the cap, well south of the coast's -73..-67 wobble and
    // spread across all four z2 tiles, asserted CELL by cell.
    const blank: string[] = [];
    for (const lon of [-150, -90, -30, 30, 90, 150]) {
      for (const lat of [-78, -82, -86]) {
        if (at(grid, lon, lat) === " ") blank.push(`${lon},${lat}`);
      }
    }
    expect(blank).toEqual([]);
    // Ocean north of the coast stays empty — the cap is a cap, not a
    // whole-hemisphere flood.
    expect(at(grid, 0, -50)).toBe(" ");
    expect(at(grid, 0, 0)).toBe(" ");
  });

  it("drops a group whose every ring bounds no area, rather than painting one", () => {
    // Natural Earth 110m's North Korea carries a group of four identical
    // points; it can never paint anything, and must not reach a tile.
    const dot: GlyphMapLonLat = [130.78, 42.22];
    const feature = antarcticaFeature([[dot, dot, dot, dot]]);
    const wire = glyphMapBuildVectorTile({ admin0: [feature] }, 2, 3, 1, { source: "t", simplify: "z2" });
    expect((wire.layers.admin0 ?? [])[0]?.polygons).toBeUndefined();
  });
});
