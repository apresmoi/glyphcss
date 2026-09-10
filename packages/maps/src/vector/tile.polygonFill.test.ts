/**
 * A `fill` layer's geometry survives the TILE CUT — the end-to-end gate for
 * "a country whose outline crosses a tile boundary fills completely".
 *
 * This walks the real path a baked pyramid takes, with no stand-ins:
 * `glyphMapBuildVectorTile` (bake) -> `glyphMapDecodeVectorTile` (the
 * provider's own decode) -> `glyphMapVectorPolygons` (the fill mesh) ->
 * `compileScene` (glyphcss's real rasterizer, documented byte-identical to
 * the runtime render). The assertion is per-CELL, not per-row: a row-total
 * ink count stays green while a bow-tie hole opens in the middle of a
 * country, which is exactly the defect this pins.
 *
 * Camera geometry (`cellAspect: 1` -> square 50px cells, `zoom: 30` -> 0.6
 * cells per world unit = 0.6 cells per degree under
 * `exaggeration: GLYPH_MAP_EARTH_RADIUS_M`, `rotX: 0` straight down):
 *
 *   col = (COLS - 1) / 2 + 0.6 * lon      row = (ROWS - 1) / 2 - 0.6 * lat
 */
import { describe, expect, it } from "vitest";
import { compileScene, createGlyphOrthographicCamera, type Polygon } from "glyphcss";
import { glyphMapVectorPolygons } from "../layers";
import { GLYPH_MAP_EARTH_RADIUS_M, glyphMapEquirectangular } from "../projection";
import type { GlyphMapVectorFeature } from "./types";
import { glyphMapBuildVectorTile, glyphMapDecodeVectorTile } from "./tile";

const COLS = 81;
const ROWS = 41;
const ZOOM = 30;
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
  return inner
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .split("\n");
}

/** A closed CCW box ring in lon/lat, first point repeated as last (the GeoJSON convention). */
function boxRing(west: number, east: number, south: number, north: number): (readonly [number, number])[] {
  return [[west, south], [east, south], [east, north], [west, north], [west, south]];
}

function countryFeature(west: number, east: number, south: number, north: number): GlyphMapVectorFeature {
  const ring = boxRing(west, east, south, north);
  return { id: "c", geometryType: "polygon", properties: { name: "c" }, rings: [ring], polygons: [[ring]] };
}

/** Every z-level tile index the box touches, using the pyramid's own equal-angle addressing. */
function tilesFor(z: number, west: number, east: number, south: number, north: number): [number, number][] {
  const n = 2 ** z;
  const lonSpan = 360 / n;
  const latSpan = 180 / n;
  const out: [number, number][] = [];
  for (let x = Math.floor((west + 180) / lonSpan); x <= Math.floor((east + 180) / lonSpan); x++) {
    for (let y = Math.floor((90 - north) / latSpan); y <= Math.floor((90 - south) / latSpan); y++) out.push([x, y]);
  }
  return out;
}

/** Bake `feature` into every tile it touches at `z`, decode each, and mesh them exactly as the widget does. */
function tiledFillPolygons(feature: GlyphMapVectorFeature, z: number, west: number, east: number, south: number, north: number): Polygon[] {
  const out: Polygon[] = [];
  for (const [x, y] of tilesFor(z, west, east, south, north)) {
    const wire = glyphMapBuildVectorTile({ admin0: [feature] }, z, x, y, { source: "t", simplify: `z${z}` });
    const tile = glyphMapDecodeVectorTile(wire);
    for (const decoded of tile.layers.admin0 ?? []) out.push(...glyphMapVectorPolygons([decoded], projection));
  }
  return out;
}

/**
 * Cells whose CENTRE is strictly inside the country, inset by one whole cell
 * on every side so an edge cell's own partial coverage can never be the
 * reason a cell reads blank. Returns the blank ones — the count that must be
 * zero — alongside how many were tested, so a fixture that stopped covering
 * the country at all can't pass by testing nothing.
 */
function unpaintedInside(grid: readonly string[], west: number, east: number, south: number, north: number): { readonly blank: [number, number][]; readonly tested: number } {
  const inset = 1 / CELLS_PER_DEG;
  const cx = (COLS - 1) / 2;
  const cy = (ROWS - 1) / 2;
  const blank: [number, number][] = [];
  let tested = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const lon = (col - cx) / CELLS_PER_DEG;
      const lat = (cy - row) / CELLS_PER_DEG;
      if (lon <= west + inset || lon >= east - inset || lat <= south + inset || lat >= north - inset) continue;
      tested++;
      if ((grid[row]?.[col] ?? " ") === " ") blank.push([col, row]);
    }
  }
  return { blank, tested };
}

describe("fill through the tile cut", () => {
  it("fills a country spanning four tiles with no hole strictly inside its own outline", () => {
    // -60..60 x -30..30 crosses BOTH z2 tile boundaries (lon 0, lat 0), so
    // every one of the four tiles gets a piece of the ring and none gets the
    // whole thing.
    const [w, e, s, n] = [-60, 60, -30, 30];
    const grid = render(tiledFillPolygons(countryFeature(w, e, s, n), 2, w, e, s, n));
    const { blank, tested } = unpaintedInside(grid, w, e, s, n);
    expect(tested).toBeGreaterThan(2000);
    expect(blank).toEqual([]);
  });

  it("still fills a country that fits inside one tile", () => {
    // 10..20 x 10..20 sits wholly inside z2 tile (2, 1) — the case that was
    // never broken, kept as the control that the fix did not trade one for
    // the other.
    const [w, e, s, n] = [10, 20, 10, 20];
    const grid = render(tiledFillPolygons(countryFeature(w, e, s, n), 2, w, e, s, n));
    const { blank, tested } = unpaintedInside(grid, w, e, s, n);
    expect(tested).toBeGreaterThan(15);
    expect(blank).toEqual([]);
  });

  it("fills a tile that lies wholly INSIDE the country, which carries no piece of its outline", () => {
    // -80..80 x -60..60 swallows z3 tile (4, 3) (lon 0..45, lat 0..22.5)
    // whole: the ring never enters it, so the polyline clip correctly emits
    // no border fragment there and the tile used to carry no feature at all.
    // Kept under 180 degrees per EDGE — a wider one is indistinguishable
    // from an antimeridian wrap by the rule `glyphMapSplitAtAntimeridian`
    // and `glyphMapClipPolygonGroup` both apply, and no real simplified
    // boundary has an edge that long.
    const [w, e, s, n] = [-80, 80, -60, 60];
    const wire = glyphMapBuildVectorTile({ admin0: [countryFeature(w, e, s, n)] }, 3, 4, 3, { source: "t", simplify: "z3" });
    const tile = glyphMapDecodeVectorTile(wire);
    const features = tile.layers.admin0 ?? [];
    expect(features).toHaveLength(1);
    expect(glyphMapVectorPolygons([features[0]], projection).length).toBeGreaterThan(0);
  });

  it("carries a lake through the cut as a HOLE of its own country, not as a second country", () => {
    // The hole is wholly inside z2 tile (2, 1) while the outer ring is not,
    // so this only holds if the clip keeps the two rings in ONE group.
    const outer = boxRing(-60, 60, -30, 30);
    const lake = [...boxRing(5, 25, 5, 25)].reverse();
    const feature: GlyphMapVectorFeature = { id: "c", geometryType: "polygon", properties: {}, rings: [outer, lake], polygons: [[outer, lake]] };
    const wire = glyphMapBuildVectorTile({ admin0: [feature] }, 2, 2, 1, { source: "t", simplify: "z2" });
    const tile = glyphMapDecodeVectorTile(wire);
    const decoded = (tile.layers.admin0 ?? [])[0];
    expect(decoded.polygons).toHaveLength(1);
    expect(decoded.polygons?.[0]).toHaveLength(2);
    const grid = render(glyphMapVectorPolygons([decoded], projection));
    const cx = (COLS - 1) / 2;
    const cy = (ROWS - 1) / 2;
    const at = (lon: number, lat: number) => grid[Math.round(cy - lat * CELLS_PER_DEG)]?.[Math.round(cx + lon * CELLS_PER_DEG)] ?? " ";
    expect(at(15, 15)).toBe(" "); // inside the lake
    expect(at(35, 15)).not.toBe(" "); // land east of it, same tile
  });
});

describe("TopoJSON polygon grouping", () => {
  // Two arcs: a big square and a small square inside it, sharing no vertex —
  // the minimal shape that distinguishes "[outer, hole]" from "two outers".
  const topology = {
    type: "Topology" as const,
    arcs: [
      [[-40, -20], [40, -20], [40, 20], [-40, 20], [-40, -20]],
      [[-10, -5], [-10, 5], [10, 5], [10, -5], [-10, -5]],
    ],
    objects: {
      countries: {
        type: "GeometryCollection" as const,
        geometries: [{ type: "MultiPolygon" as const, id: 1, properties: { name: "c" }, arcs: [[[0], [1]]] }],
      },
    },
  };

  it("keeps a MultiPolygon's [outer, ...holes] grouping and marks it a polygon", async () => {
    const { decodeGlyphMapTopoJsonArcs, glyphMapTopoJsonFeatures } = await import("./topology");
    const [feature] = glyphMapTopoJsonFeatures(topology, "countries", decodeGlyphMapTopoJsonArcs(topology));
    expect(feature.geometryType).toBe("polygon");
    expect(feature.polygons).toHaveLength(1);
    expect(feature.polygons?.[0]).toHaveLength(2);
    // `rings` stays FLAT and in source order — the `line` path walks it and
    // must be untouched by the grouping.
    expect(feature.rings).toHaveLength(2);
    expect(feature.rings[0][0]).toEqual([-40, -20]);
    expect(feature.rings[1][0]).toEqual([-10, -5]);
  });
});
