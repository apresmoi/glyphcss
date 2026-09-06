/**
 * Web Mercator addressing THROUGH THE REAL WIDGET — the end this feature
 * exists for.
 *
 * `vector/mercator.test.ts` proves the indexer; this proves that
 * `createGlyphMap`'s own tile sweep uses it, that the equal-angle sweep is
 * untouched by its existence, and — the number the planet-scale requirement
 * turns on — how many tiles the real sweep actually asks the network for at
 * three scales. Every count below is a `loadTile` call count off the live
 * runtime (visible-set diff, cache, in-flight guard and all), not an
 * estimate off the candidate range.
 */
import { describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import { glyphMapMercatorTileBounds, glyphMapMercatorTileRange, glyphMapMercatorZooms } from "./vector/mercator";
import type { GlyphMapVectorProvider, GlyphMapVectorTile } from "./vector/types";
import { glyphMapVectorTileBounds } from "./vector/tile";

const COLS = 140;
const ROWS = 63;

/** A Mercator-addressed provider that records what the sweep asks for and serves an empty tile for everything. */
function mercatorProbe(): GlyphMapVectorProvider & { readonly loadTile: ReturnType<typeof vi.fn> } {
  const loadTile = vi.fn(async (z: number, x: number, y: number): Promise<GlyphMapVectorTile> => ({
    z, x, y, bounds: glyphMapMercatorTileBounds(z, x, y), source: "probe", simplify: "mvt-source", layers: {},
  }));
  return {
    id: "mercator-probe",
    zooms: glyphMapMercatorZooms(0, 14, 256),
    tileRange: glyphMapMercatorTileRange,
    bounds: glyphMapMercatorTileBounds,
    loadTile,
  };
}

/** The same probe with NO addressing capability — i.e. this package's own equal-angle pyramids. */
function equalAngleProbe(): GlyphMapVectorProvider & { readonly loadTile: ReturnType<typeof vi.fn> } {
  const loadTile = vi.fn(async (z: number, x: number, y: number): Promise<GlyphMapVectorTile> => ({
    z, x, y, bounds: glyphMapVectorTileBounds(z, x, y), source: "probe", simplify: "vw-z0", layers: {},
  }));
  const zooms = [];
  for (let z = 0; z <= 6; z++) {
    zooms.push({ z, cols: 2 ** z, rows: 2 ** z, tileLonSpan: 360 / 2 ** z, tileLatSpan: 180 / 2 ** z, tileCols: 256, tileRows: 256 });
  }
  return { id: "equal-angle-probe", zooms, bounds: glyphMapVectorTileBounds, loadTile };
}

async function mount(provider: GlyphMapVectorProvider, center: [number, number], span: number) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center, span, cols: COLS, rows: ROWS },
    projection: glyphMapEquirectangular(),
    tilt: 0,
  });
  map.addLayer({ type: "line", id: "probe", source: provider, sourceLayer: "transportation", color: "#fff" });
  await vi.waitFor(() => expect(provider.loadTile).toHaveBeenCalled());
  return { host, map };
}

describe("the widget sweep addresses a Mercator provider in Mercator", () => {
  it("requests the tile the service actually serves for Zurich, not the equal-angle one", async () => {
    const provider = mercatorProbe();
    const { host, map } = await mount(provider, [8.54, 47.375], 0.06);
    const asked = (provider.loadTile as ReturnType<typeof vi.fn>).mock.calls as [number, number, number][];
    const z = asked[0][0];
    expect(z).toBe(12);
    // The exact address the live service serves 142 KB of Zurich from, and
    // the one `fixtures/openfreemap/z12-2145-1434.mvt` was recorded at.
    expect(asked).toContainEqual([12, 2145, 1434]);
    // Equal-angle would put this latitude ~400 rows north (row 1026), over
    // the Arctic. Nothing in that neighbourhood is ever requested.
    expect(asked.map(([, , y]) => y).every((y) => y > 1400 && y < 1470)).toBe(true);
    map.destroy();
    host.remove();
  });

  it("leaves a provider WITHOUT the capability on the equal-angle indexer", async () => {
    const provider = equalAngleProbe();
    const { host, map } = await mount(provider, [8.54, 47.375], 0.06);
    const asked = (provider.loadTile as ReturnType<typeof vi.fn>).mock.calls as [number, number, number][];
    const [z, x, y] = asked[0];
    // The pyramid's own equal-angle addressing: `y = floor((90 - north) / tileLatSpan)`.
    const b = glyphMapVectorTileBounds(z, x, y);
    expect(b.north).toBeGreaterThanOrEqual(47.375);
    expect(b.south).toBeLessThanOrEqual(47.5);
    map.destroy();
    host.remove();
  });
});

/**
 * The volume gate. These counts are not tuned — they FALL OUT of
 * `glyphMapTargetLOD` keying on degrees-per-cell against
 * `glyphMapMercatorZooms`' `tileResolution` (256): the LOD picker chooses
 * the zoom whose tiles resolve about that many cells across, so the tiles a
 * viewport covers stay ~`view.cols / 256` regardless of how far in the
 * camera is. Recorded here so "a world view must not fan out to thousands of
 * tiles" stops being an argument and becomes a measurement.
 */
describe("on-demand volume at planet scale", () => {
  const count = async (center: [number, number], span: number) => {
    const provider = mercatorProbe();
    const { host, map } = await mount(provider, center, span);
    // Let the sweep settle: `addLayer` kicks off one update synchronously and
    // nothing else fetches until a gesture re-arms the debounce.
    await vi.waitFor(() => expect(provider.loadTile).toHaveBeenCalled());
    const calls = (provider.loadTile as ReturnType<typeof vi.fn>).mock.calls as [number, number, number][];
    map.destroy();
    host.remove();
    return { z: calls[0][0], tiles: calls.length };
  };

  it("fetches one tile at a world view", async () => {
    expect(await count([0, 0], 360)).toEqual({ z: 0, tiles: 1 });
  });

  it("fetches a handful at a country view", async () => {
    const { z, tiles } = await count([8.5, 47], 10);
    expect(z).toBe(5);
    expect(tiles).toBeLessThanOrEqual(12);
    expect(tiles).toBeGreaterThan(0);
  });

  it("fetches a handful at a city view", async () => {
    const { z, tiles } = await count([8.54, 47.375], 0.06);
    expect(z).toBe(12);
    expect(tiles).toBeLessThanOrEqual(12);
    expect(tiles).toBeGreaterThan(0);
  });

  it("fetches a handful at a street view, at the pyramid's deepest zoom", async () => {
    const { z, tiles } = await count([8.54, 47.375], 0.004);
    expect(z).toBe(14);
    expect(tiles).toBeLessThanOrEqual(12);
    expect(tiles).toBeGreaterThan(0);
  });

  it("never fans out to thousands anywhere on the zoom ladder, at any latitude", async () => {
    let worst = 0;
    for (const lat of [0, 47, 75]) {
      for (const e of [0, 2, 4, 6, 8, 10, 12, 14]) {
        worst = Math.max(worst, (await count([0, lat], 360 / 2 ** e)).tiles);
      }
    }
    expect(worst).toBeLessThanOrEqual(24);
  });

  it("caps at the pyramid's own maxzoom instead of asking for z18", async () => {
    expect((await count([8.54, 47.375], 0.0005)).z).toBe(14);
  });
});

describe("failure degrades quietly", () => {
  it("a rejecting tile leaves the layer mounted and the map alive", async () => {
    const loadTile = vi.fn(async () => { throw new Error("504 Gateway Timeout"); });
    const provider: GlyphMapVectorProvider = {
      id: "failing", zooms: glyphMapMercatorZooms(0, 14, 256),
      tileRange: glyphMapMercatorTileRange, bounds: glyphMapMercatorTileBounds, loadTile,
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [8.54, 47.375], span: 0.06, cols: COLS, rows: ROWS },
      projection: glyphMapEquirectangular(),
      tilt: 0,
    });
    // A provider that REJECTS (rather than the shipped one, which resolves
    // empty) is the harsher case: `addLayer` must not throw synchronously and
    // the map must survive the rejected sweep.
    expect(() => map.addLayer({ type: "line", id: "failing", source: provider, color: "#fff" })).not.toThrow();
    await vi.waitFor(() => expect(loadTile).toHaveBeenCalled());
    expect(() => map.setView({ center: [8.55, 47.38] })).not.toThrow();
    map.destroy();
    host.remove();
  });
});
