import { describe, expect, it } from "vitest";
import { glyphMapCuratedVectorProvider } from "./curated";
import { glyphMapVectorTileBounds } from "./tile";
import type { GlyphMapVectorProvider, GlyphMapVectorTile } from "./types";

function emptyTile(z: number, x: number, y: number, source: string): GlyphMapVectorTile {
  return { z, x, y, bounds: glyphMapVectorTileBounds(z, x, y), layers: {}, source, simplify: "test" };
}

function makeBase(): GlyphMapVectorProvider {
  return {
    id: "base",
    zooms: [
      { z: 0, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 180, tileRows: 90 },
      { z: 1, cols: 2, rows: 2, tileLonSpan: 180, tileLatSpan: 90, tileCols: 180, tileRows: 90 },
    ],
    attribution: [{ name: "Natural Earth", license: "Public domain" }],
    bounds: (z, x, y) => glyphMapVectorTileBounds(z, x, y),
    async loadTile(z, x, y) {
      return emptyTile(z, x, y, "base-tile");
    },
  };
}

describe("glyphMapCuratedVectorProvider", () => {
  it("rejects a curated zoom that is not deeper than the base pyramid's max", () => {
    const base = makeBase();
    expect(() =>
      glyphMapCuratedVectorProvider(base, {
        zoom: { z: 1, cols: 4, rows: 4, tileLonSpan: 90, tileLatSpan: 45, tileCols: 720, tileRows: 360 },
        tiles: new Map(),
      }),
    ).toThrow(RangeError);
  });

  it("returns the real curated tile for a curated (x, y)", async () => {
    const base = makeBase();
    const curatedTile: GlyphMapVectorTile = { ...emptyTile(2, 5, 3, "curated"), layers: { admin1: [{ rings: [[[0, 0], [1, 1]]] }] } };
    const provider = glyphMapCuratedVectorProvider(base, {
      zoom: { z: 2, cols: 4, rows: 4, tileLonSpan: 90, tileLatSpan: 45, tileCols: 720, tileRows: 360 },
      tiles: new Map([["5_3", curatedTile]]),
    });
    const tile = await provider.loadTile(2, 5, 3);
    expect(tile).toBe(curatedTile);
    expect(provider.zooms.map((z) => z.z)).toEqual([0, 1, 2]);
  });

  it("gate: an UNCURATED tile at the curated depth degrades to the base pyramid's deepest ancestor — never blank, never throws", async () => {
    const base = makeBase();
    const provider = glyphMapCuratedVectorProvider(base, {
      zoom: { z: 2, cols: 4, rows: 4, tileLonSpan: 90, tileLatSpan: 45, tileCols: 720, tileRows: 360 },
      tiles: new Map(), // nothing curated anywhere
    });
    // z2 tile (3,1) sits inside z1 tile floor(3/2)=1, floor(1/2)=0.
    const tile = await provider.loadTile(2, 3, 1);
    expect(tile.source).toBe("base-tile");
    expect(tile.z).toBe(1);
    expect(tile.x).toBe(1);
    expect(tile.y).toBe(0);
    // Geographically contains the requested z2 tile's bounds.
    const requested = glyphMapVectorTileBounds(2, 3, 1);
    expect(tile.bounds.west).toBeLessThanOrEqual(requested.west);
    expect(tile.bounds.east).toBeGreaterThanOrEqual(requested.east);
    expect(tile.bounds.south).toBeLessThanOrEqual(requested.south);
    expect(tile.bounds.north).toBeGreaterThanOrEqual(requested.north);
  });

  it("non-curated-depth requests pass straight through to the base provider", async () => {
    const base = makeBase();
    const provider = glyphMapCuratedVectorProvider(base, {
      zoom: { z: 2, cols: 4, rows: 4, tileLonSpan: 90, tileLatSpan: 45, tileCols: 720, tileRows: 360 },
      tiles: new Map(),
    });
    const tile = await provider.loadTile(1, 0, 0);
    expect(tile.z).toBe(1);
    expect(tile.source).toBe("base-tile");
  });
});
