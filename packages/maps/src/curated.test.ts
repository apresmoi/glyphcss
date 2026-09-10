import { describe, expect, it } from "vitest";
import { glyphMapCuratedProvider } from "./curated";
import { glyphMapVectorTileBounds } from "./vector/tile";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapProvider, GlyphMapProviderZoomLevel } from "./provider";

function makeTile(source: string): GlyphMapGeoTile {
  return { bounds: { west: 0, east: 1, south: 0, north: 1 }, cols: 1, rows: 1, elevation: new Float32Array(4), source, sampler: "nearest" };
}

function makeBase(): GlyphMapProvider {
  const declaredZooms = new Set([0, 1]);
  return {
    id: "base",
    zooms: [
      { z: 0, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 180, tileRows: 90 },
      { z: 1, cols: 2, rows: 2, tileLonSpan: 180, tileLatSpan: 90, tileCols: 180, tileRows: 90 },
    ],
    attribution: [{ name: "NOAA NCEI (ETOPO1)", license: "Public domain" }],
    bounds: (z, x, y) => {
      // Mirrors production (`geoTilesProvider.ts`'s `bounds()`, which
      // throws `RangeError` for an undeclared zoom) — without this a test
      // asserting `glyphMapCuratedProvider`'s `bounds()` never delegates to
      // `base.bounds` at a curated depth would stay green even if it
      // regressed to always delegating, since `glyphMapVectorTileBounds`
      // itself would silently compute a plausible answer for any z.
      if (!declaredZooms.has(z)) throw new RangeError(`no zoom level ${z}`);
      return glyphMapVectorTileBounds(z, x, y);
    },
    async loadTile(z, x, y) {
      // Tags the ACTUAL (x, y) it was called with into `source`, so a test
      // can assert the exact ancestor coordinates the wrapper computed —
      // not just that a hardcoded "plausible" tile happens to contain the
      // request (which would pass even if the wrapper's own math were wrong).
      return makeTile(`base-z${z}-${x}_${y}`);
    },
  };
}

function level(z: number, tiles: readonly string[], loader: (x: number, y: number) => Promise<GlyphMapGeoTile>, bounds?: GlyphMapProviderZoomLevel["bounds"]): { zoom: GlyphMapProviderZoomLevel; tiles: ReadonlySet<string>; loadTile: (x: number, y: number) => Promise<GlyphMapGeoTile> } {
  const n = 2 ** z;
  return {
    zoom: { z, cols: n, rows: n, tileLonSpan: 360 / n, tileLatSpan: 180 / n, tileCols: 180, tileRows: 90, bounds },
    tiles: new Set(tiles),
    loadTile: loader,
  };
}

describe("glyphMapCuratedProvider", () => {
  it("rejects a curated zoom that is not deeper than the base pyramid's max", () => {
    const base = makeBase();
    expect(() => glyphMapCuratedProvider(base, [level(1, [], async () => makeTile("x"))])).toThrow(RangeError);
  });

  it("returns `base` unchanged (not merely `base.id`) for an empty curated list", () => {
    const base = makeBase();
    const provider = glyphMapCuratedProvider(base, []);
    expect(provider).toBe(base);
    // `base.bounds` still throws at an undeclared depth exactly as it would
    // with no wrapper at all — the honest form of "no-op".
    expect(() => provider.bounds(5, 0, 0)).toThrow(RangeError);
  });

  it("returns the real curated tile for a curated (x, y)", async () => {
    const base = makeBase();
    const provider = glyphMapCuratedProvider(base, [level(5, ["17_11"], async (x, y) => makeTile(`curated-${x}_${y}`))]);
    const tile = await provider.loadTile(5, 17, 11);
    expect(tile.source).toBe("curated-17_11");
    expect(provider.zooms.map((z) => z.z)).toEqual([0, 1, 5]);
  });

  it("gate: an UNCURATED tile at the curated depth degrades to the base pyramid's deepest ancestor — never blank, never throws", async () => {
    const base = makeBase();
    const provider = glyphMapCuratedProvider(base, [level(5, ["17_11"], async () => makeTile("curated"))]);
    // z5 tile (21, 5) is nowhere near Switzerland's (17, 11); its z1 ancestor
    // (scale 2^(5-1)=16) is floor(21/16)=1, floor(5/16)=0 — deliberately
    // NON-ZERO coordinates, so a broken floor/scale computation (an off-by-
    // one exponent, floor swapped for ceil, etc.) actually changes the
    // result instead of coincidentally landing on (0, 0) either way.
    const tile = await provider.loadTile(5, 21, 5);
    expect(tile.source).toBe("base-z1-1_0");
    const requested = glyphMapVectorTileBounds(5, 21, 5);
    const ancestor = glyphMapVectorTileBounds(1, 1, 0);
    expect(ancestor.west).toBeLessThanOrEqual(requested.west);
    expect(ancestor.east).toBeGreaterThanOrEqual(requested.east);
    expect(ancestor.south).toBeLessThanOrEqual(requested.south);
    expect(ancestor.north).toBeGreaterThanOrEqual(requested.north);
  });

  it("degrades a deeper curated miss to a SHALLOWER curated level before falling all the way to base", async () => {
    const base = makeBase();
    // z6 tile (35, 23) is the child of z5 tile floor(35/2)=17, floor(23/2)=11 — a real curated z5 tile.
    const provider = glyphMapCuratedProvider(base, [
      level(5, ["17_11"], async (x, y) => makeTile(`z5-${x}_${y}`)),
      level(6, [], async () => makeTile("z6-should-not-be-called")),
    ]);
    const tile = await provider.loadTile(6, 35, 23);
    expect(tile.source).toBe("z5-17_11");
  });

  it("resolves a real tile at the deepest curated level when present", async () => {
    const base = makeBase();
    const provider = glyphMapCuratedProvider(base, [
      level(5, ["17_11"], async (x, y) => makeTile(`z5-${x}_${y}`)),
      level(6, ["35_23"], async (x, y) => makeTile(`z6-${x}_${y}`)),
      level(7, ["70_46"], async (x, y) => makeTile(`z7-${x}_${y}`)),
    ]);
    const tile = await provider.loadTile(7, 70, 46);
    expect(tile.source).toBe("z7-70_46");
  });

  it("non-curated-depth requests pass straight through to the base provider", async () => {
    const base = makeBase();
    const provider = glyphMapCuratedProvider(base, [level(5, [], async () => makeTile("curated"))]);
    const tile = await provider.loadTile(1, 0, 0);
    expect(tile.source).toBe("base-z1-0_0");
  });

  it("bounds() at a curated depth matches the equal-angle quadtree formula, and at base depth matches base.bounds", () => {
    const base = makeBase();
    const provider = glyphMapCuratedProvider(base, [level(5, [], async () => makeTile("x"))]);
    expect(provider.bounds(5, 17, 11)).toEqual(glyphMapVectorTileBounds(5, 17, 11));
    expect(provider.bounds(1, 0, 0)).toEqual(base.bounds(1, 0, 0));
  });

  it("zooms is always sorted by z, regardless of curated-array order", () => {
    const base = makeBase();
    const provider = glyphMapCuratedProvider(base, [
      level(7, ["1_1"], async () => makeTile("z7")),
      level(5, ["1_1"], async () => makeTile("z5")),
      level(6, ["1_1"], async () => makeTile("z6")),
    ]);
    expect(provider.zooms.map((z) => z.z)).toEqual([0, 1, 5, 6, 7]);
  });

  describe("two curated places sharing one zoom", () => {
    it("unions both places' real-tile keys into ONE zoom record instead of one overwriting the other", async () => {
      const base = makeBase();
      const switzerland = level(5, ["16_7"], async (x, y) => makeTile(`switzerland-${x}_${y}`));
      const otherPlace = level(5, ["1_1"], async (x, y) => makeTile(`other-${x}_${y}`));
      const provider = glyphMapCuratedProvider(base, [switzerland, otherPlace]);

      // Exactly ONE z5 record — not two duplicates from the same-key insert.
      expect(provider.zooms.filter((z) => z.z === 5)).toHaveLength(1);

      // Both places' real tiles resolve to THEIR OWN loader, not degrade to
      // an ancestor and not cross-resolve to the other place's loader.
      expect((await provider.loadTile(5, 16, 7)).source).toBe("switzerland-16_7");
      expect((await provider.loadTile(5, 1, 1)).source).toBe("other-1_1");
    });

    it("does not expose stored-place bounds as effective coverage because misses are served globally by ancestors", () => {
      const base = makeBase();
      const a = level(5, ["16_7"], async () => makeTile("a"), { west: 0, east: 10, south: 0, north: 10 });
      const b = level(5, ["1_1"], async () => makeTile("b"), { west: 90, east: 100, south: 40, north: 50 });
      const provider = glyphMapCuratedProvider(base, [a, b]);
      const z5 = provider.zooms.find((z) => z.z === 5);
      expect(z5?.bounds).toBeUndefined();
      expect(provider.resolveTile?.(5, 20, 4)).toEqual({ z: 1, x: 1, y: 0 });
    });
  });

  /**
   * The real Switzerland + Bahía Blanca (incl. Sierra de la Ventana) curated
   * z5-z7 tile keys `bake-geo-tiles.mjs` actually bakes (pinned from the
   * real bake output, the same convention `provider.test.ts`'s
   * `REAL_GEO_TILES_ZOOMS` uses for the z0-z4 pyramid) — the honesty check
   * this task ran found Buenos Aires too flat (measured -2..39 m across the
   * whole metro box) to justify curated depth, so it deliberately has no
   * entry here; Bahía Blanca's box was widened north to reach the Sierra de
   * la Ventana range (measured -10..929 m) for genuine relief.
   */
  describe("resolves real Switzerland + Bahía Blanca curated tiles baked by bake-geo-tiles.mjs, side by side", () => {
    function realBaseAndCurated() {
      const base = makeBase();
      const switzerland = [
        level(5, ["16_7"], async (x, y) => makeTile(`switzerland-z5-${x}_${y}`)),
        level(6, ["33_14", "33_15"], async (x, y) => makeTile(`switzerland-z6-${x}_${y}`)),
        level(7, ["66_29", "67_29", "66_30", "67_30", "66_31", "67_31"], async (x, y) => makeTile(`switzerland-z7-${x}_${y}`)),
      ];
      const bahiaBlanca = [
        level(5, ["10_22"], async (x, y) => makeTile(`bahia-blanca-z5-${x}_${y}`)),
        level(6, ["20_45", "21_45"], async (x, y) => makeTile(`bahia-blanca-z6-${x}_${y}`)),
        level(7, ["41_90", "42_90", "41_91", "42_91"], async (x, y) => makeTile(`bahia-blanca-z7-${x}_${y}`)),
      ];
      const provider = glyphMapCuratedProvider(base, [...switzerland, ...bahiaBlanca]);
      return { base, provider };
    }

    it("resolves a real Bahía Blanca z7 tile to its own loader, unaffected by Switzerland sharing the same depth", async () => {
      const { provider } = realBaseAndCurated();
      const tile = await provider.loadTile(7, 41, 90);
      expect(tile.source).toBe("bahia-blanca-z7-41_90");
      expect(provider.resolveTile?.(7, 41, 90)).toEqual({ z: 7, x: 41, y: 90 });
    });

    it("resolves a real Switzerland z7 tile to its own loader, unaffected by Bahía Blanca sharing the same depth", async () => {
      const { provider } = realBaseAndCurated();
      const tile = await provider.loadTile(7, 66, 29);
      expect(tile.source).toBe("switzerland-z7-66_29");
      expect(provider.resolveTile?.(7, 66, 29)).toEqual({ z: 7, x: 66, y: 29 });
    });

    it("degrades a z7 tile far from BOTH curated places to the base pyramid's own ancestor — never blank, never cross-resolves to the other place", async () => {
      const { provider } = realBaseAndCurated();
      // z7 tile (100, 100) is nowhere near Switzerland's (66-67, 29-31) or
      // Bahía Blanca's (41-42, 90-91); its z1 ancestor (scale 2^(7-1)=64) is
      // floor(100/64)=1, floor(100/64)=1.
      const tile = await provider.loadTile(7, 100, 100);
      expect(tile.source).toBe("base-z1-1_1");
      expect(provider.resolveTile?.(7, 100, 100)).toEqual({ z: 1, x: 1, y: 1 });
    });

    it("exactly one zoom record per curated depth despite two places both populating z5/z6/z7", () => {
      const { provider } = realBaseAndCurated();
      for (const z of [5, 6, 7]) {
        expect(provider.zooms.filter((zoom) => zoom.z === z)).toHaveLength(1);
      }
    });
  });

  describe("resolveTile", () => {
    it("reports the resolved identity WITHOUT fetching, matching what loadTile actually returns", async () => {
      const base = makeBase();
      const provider = glyphMapCuratedProvider(base, [level(5, ["17_11"], async (x, y) => makeTile(`z5-${x}_${y}`))]);

      // A real curated tile resolves to itself.
      expect(provider.resolveTile?.(5, 17, 11)).toEqual({ z: 5, x: 17, y: 11 });

      // z6 (35, 23) degrades to the z5 curated ancestor (17, 11) — same
      // scenario as the "degrades a deeper curated miss" test above.
      const resolved = provider.resolveTile?.(6, 35, 23);
      expect(resolved).toEqual({ z: 5, x: 17, y: 11 });
      expect((await provider.loadTile(resolved!.z, resolved!.x, resolved!.y)).source).toBe("z5-17_11");

      // Non-curated depth passes through unchanged.
      expect(provider.resolveTile?.(1, 0, 0)).toEqual({ z: 1, x: 0, y: 0 });
    });

    it("two different requested tiles that both miss curated coverage resolve to the SAME base ancestor identity", () => {
      const base = makeBase();
      const provider = glyphMapCuratedProvider(base, [level(5, ["17_11"], async () => makeTile("curated"))]);
      // Both (21, 5) and (20, 4) are far from (17, 11) and share the z1
      // ancestor floor(x/16), floor(y/16) = (1, 0).
      const a = provider.resolveTile?.(5, 21, 5);
      const b = provider.resolveTile?.(5, 20, 4);
      expect(a).toEqual({ z: 1, x: 1, y: 0 });
      expect(a).toEqual(b);
    });
  });
});
