/**
 * What the walk's tile sweep asks for — the two things that were the REAL
 * limit on how far a walker can see, neither of which was
 * `GLYPH_MAP_WALK_FAR_M`.
 *
 * Both were reported as "there is too much distance culling", and raising the
 * horizon alone would have fixed neither.
 *
 *  1. **The sweep kept ONE tile.** `isBoundsVisible` is the per-tile
 *     authority and every answer in it is derived for the ORTHOGRAPHIC
 *     camera: its first half asks whether a tile contains one of the
 *     VIEWPORT's own unprojected sample points, and under the walk camera not
 *     one screen point unprojects, so `viewportGeoSamples` degrades to
 *     `[view.center]` — which only ever lands in the tile the walker is
 *     standing in; its second half probes the tile's own 3x3 corners through
 *     `projection.visible`, which is the same expression `nearSideVisible`
 *     documents as WRONG under a positioned perspective camera. Measured on
 *     the real page at Zurich with the OpenStreetMap card on:
 *     `candidateTileRange` offered 35 z14 candidates and this kept 1. With
 *     buildings mounted that is the city clipped to one 1.67 km tile, so a
 *     walker within `far` of any tile edge saw nothing across it and no
 *     horizon could reach past it.
 *  2. **The LOD was keyed on the walk FOOTPRINT.** `view.span` is pinned to
 *     `glyphMapWalkSpan(far)` so everything downstream keeps working, and
 *     `glyphMapTargetLOD(provider, span / cols)` then read it as a
 *     RESOLUTION. It is not one under a perspective camera — the near field
 *     resolves at centimetres per cell and the horizon at metres — and the
 *     consequence was that the walker's data level depended on the WINDOW
 *     WIDTH: the z13/z14 boundary sits at `9.54 * cols` metres, i.e. 1,336 m
 *     on a 1440x900 grid but 468 m on a 390 px phone, where the shipped
 *     400 m horizon cleared it by 15% and nothing said so. Crossing it does
 *     not blur the city, it DELETES it (rendered at `far: 2000`: z13, and
 *     not one building drawn).
 *
 * Both are pinned here against a REAL provider sweep — `loadTile` call
 * counts off the live runtime, cache and in-flight guard and all — rather
 * than against the helpers, because the helpers were never the thing that
 * was wrong.
 *
 * Fixture trap: happy-dom has no layout, so the host's
 * `getBoundingClientRect` is stubbed — the walk lens solves `zoom` from
 * `cols * cellWidth` and a zero-width host gives it nothing to solve from.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import { GLYPH_MAP_WALK_FAR_M } from "./walk";
import { glyphMapMercatorTileBounds, glyphMapMercatorTileRange, glyphMapMercatorZooms } from "./vector/mercator";
import type { GlyphMapVectorProvider, GlyphMapVectorTile } from "./vector/types";

const COLS = 140, ROWS = 63, CELL_W = 8, CELL_H = 16;
const M_PER_DEG = 6_371_000 * (Math.PI / 180);

const rect = (w: number, h: number) =>
  ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
const EMPTY_RECT = rect(0, 0);
const stubbedHosts = new Map<HTMLElement, { cols: number; rows: number }>();

function stubMonospaceMetrics(host: HTMLElement, cols: number, rows: number): void {
  stubbedHosts.set(host, { cols, rows });
  if (vi.isMockFunction(Element.prototype.getBoundingClientRect)) return;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    const shape = stubbedHosts.get(el);
    if (shape) return rect(shape.cols * CELL_W, shape.rows * CELL_H);
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY_RECT;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W, CELL_H * lines);
  });
}

afterEach(() => { vi.restoreAllMocks(); stubbedHosts.clear(); });

/** A Mercator-addressed provider (OpenFreeMap's own shape) that records every sweep request. */
function probe(): GlyphMapVectorProvider & { readonly loadTile: ReturnType<typeof vi.fn> } {
  const loadTile = vi.fn(async (z: number, x: number, y: number): Promise<GlyphMapVectorTile> => ({
    z, x, y, bounds: glyphMapMercatorTileBounds(z, x, y), source: "probe", simplify: "mvt-source", layers: {},
  }));
  return {
    id: "walk-horizon-probe",
    zooms: glyphMapMercatorZooms(0, 14, 256),
    tileRange: glyphMapMercatorTileRange,
    bounds: glyphMapMercatorTileBounds,
    loadTile,
  };
}

/**
 * `span` defaults WIDE on purpose. Walk mode pins `view.span` to the
 * footprint and sweeps from there, so mounting at a street-level span would
 * warm the very tiles the walk then asks for and every assertion below would
 * read an empty `loadTile` log. Opening a LOD away from the walk's own is
 * what makes the walk sweep cold and therefore visible.
 */
async function mount(center: [number, number], cols = COLS, rows = ROWS, span = 2) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host, cols, rows);
  const provider = probe();
  const map = createGlyphMap(host, {
    view: { center, span, cols, rows },
    projection: glyphMapGlobe(),
  });
  map.addLayer({ type: "line", id: "probe", source: provider, sourceLayer: "transportation", color: "#fff" });
  await vi.waitFor(() => expect(provider.loadTile).toHaveBeenCalled());
  return { host, map, provider, done: () => { map.destroy(); host.remove(); } };
}

const asked = (provider: { loadTile: ReturnType<typeof vi.fn> }) =>
  (provider.loadTile.mock.calls as [number, number, number][]);

/** The z14 tile holding a lon/lat, from the provider's own addressing. */
function tileAt(lon: number, lat: number): { x: number; y: number } {
  const range = glyphMapMercatorTileRange(
    glyphMapMercatorZooms(14, 14, 256)[0],
    { west: lon, east: lon, south: lat, north: lat },
  );
  return { x: range.x0, y: range.y0 };
}

describe("the walk tile sweep reaches across a tile edge", () => {
  it("loads the tile the horizon reaches into, not only the one underfoot", async () => {
    // Stand 120 m EAST of a z14 tile's west edge, so the tile to the west
    // starts 120 m away — a fifth of the horizon, and unmissable.
    const seed: [number, number] = [8.5417, 47.3769];
    const home = tileAt(seed[0], seed[1]);
    const bounds = glyphMapMercatorTileBounds(14, home.x, home.y);
    const lonPerM = 1 / (M_PER_DEG * Math.cos(seed[1] * (Math.PI / 180)));
    const stand: [number, number] = [bounds.west + 120 * lonPerM, (bounds.north + bounds.south) / 2];
    // The premise, stated in metres: the neighbour starts well inside the
    // horizon, and the tile is far wider than it — which is exactly why a
    // point test on the tile's own samples cannot answer this.
    const tileWidthM = (bounds.east - bounds.west) * M_PER_DEG * Math.cos(seed[1] * (Math.PI / 180));
    expect(120).toBeLessThan(GLYPH_MAP_WALK_FAR_M);
    expect(tileWidthM).toBeGreaterThan(2 * GLYPH_MAP_WALK_FAR_M);

    const { map, provider, done } = await mount(stand);
    provider.loadTile.mockClear();
    map.setWalk({});
    await vi.waitFor(() => expect(provider.loadTile).toHaveBeenCalled());
    await new Promise<void>((resolve) => { setTimeout(resolve, 300); });

    const deep = asked(provider).filter(([z]) => z === 14);
    const xs = new Set(deep.map(([, x]) => x));
    // The tile underfoot, and the one across the edge the walker can see into.
    expect(xs.has(home.x)).toBe(true);
    expect(xs.has(home.x - 1)).toBe(true);
    // Still BOUNDED — the horizon, not the padded candidate window (which
    // reaches 17 km here and offered 35+ candidates on the real page).
    expect(deep.length).toBeLessThanOrEqual(16);
    done();
  });

  it("drops a tile the horizon does not reach", async () => {
    // Dead centre of a tile: at 600 m the horizon cannot leave a 1.67 km
    // tile in longitude, so no neighbour may be swept. This is the clause
    // that goes red if the box test is replaced by "accept everything".
    const seed: [number, number] = [8.5417, 47.3769];
    const home = tileAt(seed[0], seed[1]);
    const b = glyphMapMercatorTileBounds(14, home.x, home.y);
    const centre: [number, number] = [(b.west + b.east) / 2, (b.north + b.south) / 2];
    const halfWidthM = ((b.east - b.west) / 2) * M_PER_DEG * Math.cos(centre[1] * (Math.PI / 180));
    expect(halfWidthM).toBeGreaterThan(GLYPH_MAP_WALK_FAR_M);

    const { map, provider, done } = await mount(centre);
    provider.loadTile.mockClear();
    map.setWalk({});
    await vi.waitFor(() => expect(provider.loadTile).toHaveBeenCalled());
    await new Promise<void>((resolve) => { setTimeout(resolve, 300); });

    const xs = new Set(asked(provider).filter(([z]) => z === 14).map(([, x]) => x));
    expect(xs.has(home.x)).toBe(true);
    expect(xs.has(home.x - 1)).toBe(false);
    expect(xs.has(home.x + 1)).toBe(false);
    done();
  });
});

describe("the walk LOD does not depend on the window width", () => {
  it("asks for the deepest level on a narrow grid, where the footprint would not", async () => {
    // 60 columns. `span / cols` is then 1.80e-4 deg, which is coarser than
    // z13's own 8.58e-5 AND z12's 1.72e-4 — so the footprint rule picks z12,
    // two levels of city short of what the pyramid holds.
    const NARROW = 60;
    const { map, provider, done } = await mount([8.5417, 47.3769], NARROW, 40);
    provider.loadTile.mockClear();
    map.setWalk({});
    await vi.waitFor(() => expect(provider.loadTile).toHaveBeenCalled());
    await new Promise<void>((resolve) => { setTimeout(resolve, 300); });

    const zs = new Set(asked(provider).map(([z]) => z));
    expect([...zs]).toEqual([14]);
    // The footprint rule's own answer, stated so the discriminator is
    // visible rather than implied.
    const view = map.getView();
    const degPerCell = view.span / view.cols;
    // The walk's OWN pinned footprint over 60 columns, which is coarser than
    // z13's native resolution — so the footprint rule would have stopped
    // there and never asked for the level above it.
    expect(degPerCell).toBeGreaterThan(360 / 2 ** 13 / 256);
    done();
  });

  it("leaves the ORBIT sweep on the footprint rule", async () => {
    // The branch must not leak. Off walk mode the same narrow grid still
    // picks the level its own degrees-per-cell asks for: span 0.02 over 60
    // columns is 3.33e-4 deg, and `glyphMapTargetLOD` takes the coarsest
    // level at or under that, which is z13 (1.72e-4) — not the deepest.
    const { provider, done } = await mount([8.5417, 47.3769], 60, 40, 0.02);
    const zs = new Set(asked(provider).map(([z]) => z));
    expect([...zs]).toEqual([13]);
    done();
  });
});
