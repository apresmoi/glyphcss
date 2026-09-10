/**
 * The OpenFreeMap provider: addressing, on-demand volume, and failure.
 *
 * Nothing here touches the network. `fetchTile` is injected with a recorded
 * response (`fixtures/openfreemap/*.mvt`, bytes the live service actually
 * served) or with a deliberate failure, so CI is offline and deterministic
 * while the DATA under test is real.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { glyphMapOpenFreeMapProvider } from "./openfreemap";
import { glyphMapMercatorTileRange, GLYPH_MAP_MERCATOR_MAX_LAT } from "./mercator";
import { GLYPH_MAP_OPENFREEMAP_ATTRIBUTION } from "../attribution";

const FIXTURES = path.resolve(__dirname, "../../fixtures/openfreemap");
const z0 = readFileSync(path.join(FIXTURES, "z0-0-0.mvt"));
const z12 = readFileSync(path.join(FIXTURES, "z12-2145-1434.mvt"));

describe("glyphMapOpenFreeMapProvider", () => {
  it("declares the service's own pyramid and its Mercator addressing capability", () => {
    const p = glyphMapOpenFreeMapProvider();
    expect(p.zooms.map((l) => l.z)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(p.tileRange).toBe(glyphMapMercatorTileRange);
    expect(p.attribution).toEqual(GLYPH_MAP_OPENFREEMAP_ATTRIBUTION);
    // `bounds` is Mercator's, not the equal-angle grid's: the root tile stops
    // at the projection's latitude limit rather than at the pole.
    expect(p.bounds(0, 0, 0).north).toBeCloseTo(GLYPH_MAP_MERCATOR_MAX_LAT, 5);
  });

  it("requests the tile the service actually serves, at the URL it documents", async () => {
    const fetchTile = vi.fn(async () => z12.buffer.slice(z12.byteOffset, z12.byteOffset + z12.byteLength));
    const p = glyphMapOpenFreeMapProvider({ fetchTile });
    const tile = await p.loadTile(12, 2145, 1434);
    expect(fetchTile).toHaveBeenCalledWith("https://tiles.openfreemap.org/planet/latest/12/2145/1434.pbf", 12, 2145, 1434);
    expect(tile.layers.transportation).toHaveLength(1911);
    expect(tile.attribution).toEqual(GLYPH_MAP_OPENFREEMAP_ATTRIBUTION);
    expect(tile.bounds.north).toBeCloseTo(47.398, 2);
  });

  it("decodes into lon/lat, not tile-local coordinates", async () => {
    const p = glyphMapOpenFreeMapProvider({
      fetchTile: async () => z12.buffer.slice(z12.byteOffset, z12.byteOffset + z12.byteLength),
    });
    const tile = await p.loadTile(12, 2145, 1434);
    const [lon, lat] = tile.layers.transportation[0].rings[0][0];
    expect(lon).toBeGreaterThan(8.4);
    expect(lon).toBeLessThan(8.7);
    expect(lat).toBeGreaterThan(47.2);
    expect(lat).toBeLessThan(47.5);
  });

  it("restricts decoding to the requested source layers", async () => {
    const p = glyphMapOpenFreeMapProvider({
      layers: ["water"],
      fetchTile: async () => z0.buffer.slice(z0.byteOffset, z0.byteOffset + z0.byteLength),
    });
    expect(Object.keys(await p.loadTile(0, 0, 0).then((t) => t.layers))).toEqual(["water"]);
  });
});

describe("failure degrades quietly — that region simply has no data this frame", () => {
  it("returns an EMPTY tile on a 404 rather than throwing", async () => {
    const p = glyphMapOpenFreeMapProvider({
      fetchTile: async () => { throw new Error("404 Not Found"); },
    });
    const tile = await p.loadTile(9, 1, 1);
    expect(tile.layers).toEqual({});
    // Still a real, well-formed tile: bounds, source and credit intact, so a
    // sweep caches a legitimate empty rather than a hole in its bookkeeping.
    expect(tile.z).toBe(9);
    expect(tile.bounds.west).toBeCloseTo(-179.297, 3);
    expect(tile.attribution).toEqual(GLYPH_MAP_OPENFREEMAP_ATTRIBUTION);
  });

  it("returns an EMPTY tile on a timeout / aborted request", async () => {
    const p = glyphMapOpenFreeMapProvider({
      fetchTile: async () => { throw Object.assign(new Error("The operation was aborted."), { name: "AbortError" }); },
    });
    await expect(p.loadTile(14, 0, 0)).resolves.toMatchObject({ layers: {} });
  });

  it("returns an EMPTY tile on undecodable bytes rather than corrupting the layer", async () => {
    const p = glyphMapOpenFreeMapProvider({
      fetchTile: async () => new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff]).buffer,
    });
    await expect(p.loadTile(3, 1, 1)).resolves.toMatchObject({ layers: {} });
  });

  it("reports every failure through onError instead of swallowing it silently", async () => {
    const onError = vi.fn();
    const p = glyphMapOpenFreeMapProvider({
      onError,
      fetchTile: async () => { throw new Error("boom"); },
    });
    await p.loadTile(5, 2, 3);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toEqual({ z: 5, x: 2, y: 3 });
  });

  it("never lets one failing tile take down a whole sweep's Promise.all", async () => {
    let n = 0;
    const p = glyphMapOpenFreeMapProvider({
      fetchTile: async () => {
        if (n++ === 1) throw new Error("503");
        return z0.buffer.slice(z0.byteOffset, z0.byteOffset + z0.byteLength);
      },
    });
    const tiles = await Promise.all([p.loadTile(0, 0, 0), p.loadTile(0, 0, 0), p.loadTile(0, 0, 0)]);
    expect(tiles.map((t) => Object.keys(t.layers).length > 0)).toEqual([true, false, true]);
  });
});
