/**
 * The reported live defect on `/maps`: with the OSM layers mounted and a
 * tilted camera, "buildings should cover the road layers clearly" — and they
 * did not. A road passing under a 60 m building was drawn straight through
 * it, cell for cell, as if the building were not there.
 *
 * MEASURED CAUSE (`stroke.ts`'s depth test, instrumented at the reported
 * view: globe, 40 degree tilt, 0.006 degree span, 140x63):
 *
 * | quantity                      | value        |
 * |-------------------------------|--------------|
 * | road's own projected depth    | -1.0229e-8   |
 * | grid depth (the building cap) |  1.16661e-5  |
 * | the building stands in front by | 1.1676e-5  |
 * | allowance applied             |  0.0300006   |
 * | verdict, all 25 crossing cells| NOT occluded |
 *
 * The allowance was a flat `GLYPH_MAP_STROKE_DEPTH_BIAS = 0.03` world units
 * — 2,570x the gap. It was not a discretization bias at all: at `/maps`'
 * default 24x exaggeration 0.03 earth radii is ~7,960 m of terrain, i.e. an
 * unstated allowance for Earth's entire relief, because a `line` layer's
 * vertices are projected at ELEVATION ZERO while the terrain they belong on
 * stands at the real ground elevation. Sized to survive Everest, it swallowed
 * everything a city contains.
 *
 * The fix stated that allowance instead of guessing it — each vertex carried
 * the depth its own lon/lat reached at the GROUND elevation under it — and
 * that measurement has since become the stroke's own POSITION instead: a
 * `line` vertex is now projected AT the ground (`widget.ts`'s drape,
 * `widget.strokeDrape.test.ts`), so there is no offset left to forgive and
 * the coplanar allowance is the whole of it.
 *
 * THE SECOND REPORT, and why this file did not catch it. The same complaint
 * came back — "the roads are again showing on top of the buildings" — and
 * the clause below was passing the whole time, because it pinned ONE
 * building height: 60 m. The allowance that replaced the flat `0.03` was
 * SLOPE-scaled, i.e. a fraction of the depth the surface spans across one
 * screen cell, and under a tilt a HORIZONTAL surface spans a great deal of
 * it — at `/maps`' own 40 degree pitch and 4.8 m cells, about 8 m of depth
 * per row on flat ground. A building only occludes what it stands more than
 * that in front of, so the height at which a real occluder became invisible
 * was a function of the camera's PITCH and nothing else: measured on this
 * file's own fixture, every building of 6 m or under was drawn straight
 * through at 40 degrees (all 23 cells of the road inside its footprint), 8 m
 * at 60 degrees, 8 m at 70 — while the 60 m tower this file pinned was ten
 * times over the threshold at every pitch and never failed. A test that
 * fixes the one dimension the defect lives on cannot see it, which is why
 * the clauses below are parameterised on height and pitch instead.
 *
 * `stroke.ts` now reconstructs the surface at the stroke's own sub-cell
 * position rather than forgiving that offset, and scales what is left on the
 * surface's CURVATURE — a flat roof has none however steeply it is
 * foreshortened. What this file pins is:
 *
 *  - a building standing on the same ground as the road occludes it,
 *    AT EVERY ORDINARY HEIGHT AND PITCH (this file's first tests — the
 *    reported bug, twice);
 *  - terrain the road LIES ON does not (this file's second test, the guard
 *    that the fix did not trade one defect for the road vanishing over any
 *    high ground — `widget.tiltedTileCulling.test.ts` covers the same
 *    property against a 4 km alpine ridge and a real curated pyramid).
 *
 * happy-dom has no layout, hence `stubMonospaceMetrics`; assertions are on
 * EXACT cells of the road's own row, never a row-wide ink count, because a
 * count is satisfied by ink anywhere on the row.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { GLYPH_MAP_EARTH_RADIUS_M, glyphMapGlobe } from "./projection";
import type { GlyphMapProvider } from "./provider";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapVectorFeature } from "./vector/types";

const COLS = 140;
const ROWS = 63;
const CELL_W = 8;
const CELL_H = 16;
const BASE_FONT_PX = 16;
/** `/maps`' own default pitch — without a tilt a building's cap sits exactly over its own footprint and there is no "behind" to test. */
const TILT = 40;
/** Zurich, at a span where a city block is legible: ~670 m across, 4.8 m per cell. */
const CENTRE: readonly [number, number] = [8.54, 47.375];
const SPAN = 0.006;
/** Half-width of the building footprint in degrees (~89 m of latitude). */
const HALF = 0.0008;
/** A real OSM `render_height` for a mid-rise block, in TRUE metres (extrusions do not inherit the terrain's exaggeration). */
const BUILDING_M = 60;
/**
 * And an ordinary two-storey one, which is what the second report was about.
 * Not a contrived minimum: in the vendored OpenFreeMap tile
 * `fixtures/openfreemap/z14-8579-5736.mvt` the `building` layer's
 * `render_height` runs from 3 m up, and 8 of its 50 features are 6 m or
 * under.
 */
const LOW_BUILDING_M = 6;
/** Terrain for the "a surface does not occlude what lies on it" guard — see that test for why it is metres, not hundreds of them. */
const GROUND_M = 10;

const EMPTY_RECT = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
const rect = (width: number, height: number): DOMRect =>
  ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
const stubbedHosts = new Set<HTMLElement>();

function stubMonospaceMetrics(host: HTMLElement): void {
  stubbedHosts.add(host);
  if (vi.isMockFunction(Element.prototype.getBoundingClientRect)) return;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (stubbedHosts.has(el)) return rect(COLS * CELL_W, ROWS * CELL_H);
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY_RECT;
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? String(BASE_FONT_PX));
    const k = fontPx / BASE_FONT_PX;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

const mounted: { destroy(): void }[] = [];
const hostsToRemove: HTMLElement[] = [];
afterEach(() => {
  for (const m of mounted.splice(0)) m.destroy();
  for (const h of hostsToRemove.splice(0)) h.remove();
  vi.restoreAllMocks();
  stubbedHosts.clear();
});

function mount(tilt: number = TILT) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hostsToRemove.push(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [CENTRE[0], CENTRE[1]], span: SPAN, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ exaggeration: 24 }),
    tilt,
  });
  mounted.push(map);
  return map;
}

/** Uniform terrain at `elevM`, as a z0-z4 provider — the shape `bake-geo-tiles.mjs` produces. */
function terrainProvider(elevM: number): GlyphMapProvider {
  const zooms = [0, 1, 2, 3, 4].map((z) => ({
    z, cols: 2 ** z, rows: 2 ** z, tileLonSpan: 360 / 2 ** z, tileLatSpan: 180 / 2 ** z, tileCols: 32, tileRows: 32,
  }));
  const bounds = (z: number, x: number, y: number) => {
    const level = zooms[z];
    const west = -180 + x * level.tileLonSpan;
    const north = 90 - y * level.tileLatSpan;
    return { west, east: west + level.tileLonSpan, south: north - level.tileLatSpan, north };
  };
  return {
    id: "stroke-occlusion-terrain",
    zooms,
    bounds,
    async loadTile(z, x, y): Promise<GlyphMapGeoTile> {
      return { bounds: bounds(z, x, y), cols: 32, rows: 32, elevation: new Float32Array(33 * 33).fill(elevM), source: "stroke-occlusion", sampler: "nearest" };
    },
  };
}

function squareRing(lon: number, lat: number, half: number): [number, number][] {
  return [[lon - half, lat - half], [lon + half, lat - half], [lon + half, lat + half], [lon - half, lat + half], [lon - half, lat - half]];
}

const building = (metres: number): GlyphMapVectorFeature => ({
  id: "block",
  geometryType: "polygon",
  rings: [squareRing(CENTRE[0], CENTRE[1], HALF)],
  properties: { render_height: metres },
});

/** A straight west-east road through the building, long enough to leave open road on both flanks. */
const road: GlyphMapVectorFeature = {
  id: "street",
  geometryType: "line",
  rings: [[[CENTRE[0] - 0.02, CENTRE[1]], [CENTRE[0] + 0.02, CENTRE[1]]]],
};

const rows = (map: { scene: { output: { textContent: string | null } } }): string[] => (map.scene.output.textContent ?? "").split("\n");

/** The columns of `row` this render CHANGED relative to `before` — i.e. the cells the stroke layer itself inked. */
function inkedColumns(before: readonly string[], after: readonly string[], row: number): number[] {
  const out: number[] = [];
  for (let col = 0; col < COLS; col++) {
    if ((before[row]?.[col] ?? " ") !== (after[row]?.[col] ?? " ")) out.push(col);
  }
  return out;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

describe("createGlyphMap — a building occludes a road passing under it", () => {
  /**
   * The same assertions at one height and one pitch. Both are arguments
   * because the defect that came back lives EXACTLY on those two axes: the
   * building the original clause pinned was tall enough to clear the
   * allowance at any pitch, so no other dimension of this test could have
   * exposed it.
   */
  const roadIsHiddenByTheBuilding = async (metres: number, tilt: number) => {
    const map = mount(tilt);
    map.addLayer({ type: "fill-extrusion", id: "buildings", source: { features: [building(metres)] }, color: "#94a3b8", heightProperty: "render_height" });
    await settle();
    map.scene.rerender();
    const before = rows(map);

    map.addLayer({ type: "line", id: "roads", source: { features: [road] }, color: "#e8c988" });
    await settle();
    map.scene.rerender();
    const after = rows(map);

    // The road runs through the view centre, so its own row is the centre row
    // — asserted, not assumed, so a framing change fails loudly here rather
    // than quietly moving every assertion below onto an empty row.
    const centre = map.project([CENTRE[0], CENTRE[1]]);
    const roadRow = Math.floor(centre.row);
    const west = map.project([CENTRE[0] - HALF, CENTRE[1]]);
    const east = map.project([CENTRE[0] + HALF, CENTRE[1]]);
    const footprintWest = Math.ceil(Math.min(west.col, east.col));
    const footprintEast = Math.floor(Math.max(west.col, east.col));
    expect(footprintEast - footprintWest).toBeGreaterThan(10);

    const inked = inkedColumns(before, after, roadRow);

    // 1. Not one cell strictly inside the building's own footprint is inked
    //    by the road. Cell-exact: a count over the row would pass on the
    //    flanks alone.
    const throughTheBuilding = inked.filter((col) => col > footprintWest && col < footprintEast);
    expect(throughTheBuilding).toEqual([]);

    // 2. The same road inks normally in the open, on BOTH sides — an
    //    occlusion "fix" that simply stopped drawing the layer would pass (1).
    expect(inked.filter((col) => col < footprintWest - 1).length).toBeGreaterThan(20);
    expect(inked.filter((col) => col > footprintEast + 1).length).toBeGreaterThan(20);

    // 3. Those footprint cells still show the BUILDING, so (1) is occlusion
    //    rather than a hole punched through both.
    for (let col = footprintWest + 1; col < footprintEast; col++) {
      expect(after[roadRow]?.[col]).not.toBe(" ");
    }
  };

  it("a 60 m tower, at `/maps`' own pitch — the first report", async () => {
    await roadIsHiddenByTheBuilding(BUILDING_M, TILT);
  });

  // The three the slope-scaled allowance lost, each measured: at these
  // heights and pitches the road drew through ALL 23 cells of the
  // footprint, not a few marginal ones at its edges.
  it("an ordinary 6 m building, at `/maps`' own pitch — the second report", async () => {
    await roadIsHiddenByTheBuilding(LOW_BUILDING_M, TILT);
  });

  it("and the same 6 m building at a steeper pitch, where one row of flat ground spans even more depth", async () => {
    await roadIsHiddenByTheBuilding(LOW_BUILDING_M, 60);
  });

  it("an 8 m building at 70 degrees — the pitch is what set the threshold, so the ceiling has to hold too", async () => {
    await roadIsHiddenByTheBuilding(8, 70);
  });

  it("still draws the road where terrain stands under it — the road lies ON that terrain, and a surface does not occlude what lies on it", async () => {
    const map = mount();
    map.addLayer({ type: "raster", id: "terrain", source: terrainProvider(GROUND_M) });
    await settle();
    map.scene.rerender();
    const before = rows(map);

    map.addLayer({ type: "line", id: "roads", source: { features: [road] }, color: "#e8c988" });
    await settle();
    map.scene.rerender();
    const after = rows(map);

    // The road's own row is the DRAPED one, not the datum's — see
    // `widget.strokeDrape.test.ts` for the derivation of this expression and
    // for why the ground has to be small enough to stay on a 63-row
    // viewport (10 m is already 16 rows at 24x; 400 m would be 2,000).
    const near = map.project([CENTRE[0], CENTRE[1]]);
    const far = map.project([CENTRE[0] + 180, -CENTRE[1]]);
    const originRow = (near.row + far.row) / 2;
    const k = 1 + (GROUND_M / GLYPH_MAP_EARTH_RADIUS_M) * 24;
    const roadRow = Math.floor(originRow + k * (near.row - originRow));
    // The road crosses the whole viewport, and the terrain it lies on
    // occludes not one cell of it.
    expect(inkedColumns(before, after, roadRow).length).toBeGreaterThan(100);
  });
});
