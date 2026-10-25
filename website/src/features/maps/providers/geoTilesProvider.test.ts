/**
 * `createGeoTilesProvider`'s two real contracts: it REJECTS a manifest that
 * doesn't declare the current `format`/`version` pair rather than silently
 * reinterpreting it (no dual code paths — AGENTS.md), and when the manifest
 * carries `curated` entries it wires the base z0-z4 provider through
 * `@glyphcss/maps`'s `glyphMapCuratedProvider` — a real curated tile fetches
 * from `curated/{z}/{x}_{y}.bin`, an uncurated one at the same depth
 * degrades to the correct ancestor tile URL.
 *
 * Runs in vitest's `node` environment (this repo's website config), which
 * has a global `fetch` to stub directly — no DOM/jsdom needed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeoTilesProvider } from "./geoTilesProvider";

function encodeInt16LE(samples: readonly number[]): ArrayBuffer {
  const buf = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buf);
  samples.forEach((v, i) => view.setInt16(i * 2, v, true));
  return buf;
}

// tileCols=2, tileRows=1 -> (2+1)*(1+1) = 6 vertex samples per tile, tiny.
const TILE_COLS = 2;
const TILE_ROWS = 1;

function baseManifest(curated?: unknown) {
  return {
    version: 2,
    format: "int16",
    byteOrder: "little-endian",
    zooms: [
      { z: 0, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: TILE_COLS, tileRows: TILE_ROWS },
      { z: 1, cols: 2, rows: 2, tileLonSpan: 180, tileLatSpan: 90, tileCols: TILE_COLS, tileRows: TILE_ROWS },
    ],
    source: "etopo1",
    sampler: "nearest",
    attribution: [{ name: "NOAA NCEI (ETOPO1)", license: "Public domain" }],
    ...(curated !== undefined ? { curated } : {}),
  };
}

function stubFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      for (const [suffix, make] of Object.entries(routes)) {
        if (url.endsWith(suffix)) return make();
      }
      return new Response(null, { status: 404 });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createGeoTilesProvider — manifest encoding/version gate", () => {
  it("rejects a manifest with a format other than int16", async () => {
    stubFetch({
      "/manifest.json": () => Response.json({ ...baseManifest(), format: "json" }),
    });
    await expect(createGeoTilesProvider("/data/geo-tiles")).rejects.toThrow(/format "json"/);
  });

  it("rejects a manifest with a version other than 2", async () => {
    stubFetch({
      "/manifest.json": () => Response.json({ ...baseManifest(), version: 1 }),
    });
    await expect(createGeoTilesProvider("/data/geo-tiles")).rejects.toThrow(/version 1/);
  });

  it("rejects a manifest with a byte order other than little-endian", async () => {
    stubFetch({
      "/manifest.json": () => Response.json({ ...baseManifest(), byteOrder: "big-endian" }),
    });
    await expect(createGeoTilesProvider("/data/geo-tiles")).rejects.toThrow(/byteOrder "big-endian"/);
  });

  it("accepts a valid int16 little-endian version-2 manifest with no curated field", async () => {
    stubFetch({
      "/manifest.json": () => Response.json(baseManifest()),
    });
    const provider = await createGeoTilesProvider("/data/geo-tiles", offline);
    expect(provider.zooms.map((z) => z.z)).toEqual(STREAMED_ZOOMS);
    expect(provider.sampler).toBe("nearest (z0-z1), bilinear streamed (z2-z12)");
  });
});

// Every level below the baked z0-z1 is streamed; the curated z2 level is now
// the fallback a failed stream degrades to.
const STREAMED_ZOOMS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const offline = () => Promise.reject(new Error("offline"));

describe("createGeoTilesProvider — curated fallback under the streamed levels", () => {
  const curatedZoom = { z: 2, cols: 4, rows: 4, tileLonSpan: 90, tileLatSpan: 45, tileCols: TILE_COLS, tileRows: TILE_ROWS };

  it("serves a failed streamed tile from the real curated tile at curated/{z}/{x}_{y}.bin", async () => {
    const calls = stubFetch({
      "/manifest.json": () => Response.json(baseManifest([{ name: "Switzerland", zoom: curatedZoom, bounds: { west: 0, east: 90, south: 0, north: 45 }, tiles: ["1_1"] }])),
      "/curated/2/1_1.bin": () => new Response(encodeInt16LE([1, 2, 3, 4, 5, 6])),
      "/1/1_1.bin": () => new Response(encodeInt16LE([9, 9, 9, 9, 9, 9])),
    });
    const provider = await createGeoTilesProvider("/data/geo-tiles", offline);
    expect(provider.zooms.map((z) => z.z)).toEqual(STREAMED_ZOOMS);
    expect(provider.zooms.find((z) => z.z === 2)?.bounds).toBeUndefined();

    const tile = await provider.loadTile(2, 1, 1);
    expect(Array.from(tile.elevation)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(calls.some((u) => u.endsWith("/curated/2/1_1.bin"))).toBe(true);
  });

  it("degrades a failed uncurated tile to the z1 ancestor, resampled onto the requested tile — never blank, never throws", async () => {
    const calls = stubFetch({
      "/manifest.json": () => Response.json(baseManifest([{ name: "Switzerland", zoom: curatedZoom, bounds: { west: 0, east: 90, south: 0, north: 45 }, tiles: ["1_1"] }])),
      "/curated/2/1_1.bin": () => new Response(encodeInt16LE([1, 2, 3, 4, 5, 6])),
      "/1/1_1.bin": () => new Response(encodeInt16LE([9, 9, 9, 9, 9, 9])),
    });
    const provider = await createGeoTilesProvider("/data/geo-tiles", offline);

    // z2 tile (3, 3) is not curated ("1_1" is the only real curated tile);
    // its z1 ancestor is floor(3/2)=1, floor(3/2)=1.
    const tile = await provider.loadTile(2, 3, 3);
    expect(Array.from(tile.elevation)).toEqual([9, 9, 9, 9, 9, 9]);
    expect(calls.some((u) => u.endsWith("/curated/2/3_3.bin"))).toBe(false);
    expect(calls.some((u) => u.endsWith("/1/1_1.bin"))).toBe(true);
    // Siblings that share the ancestor each get their OWN tile, so none mounts the ancestor's mesh over the others.
    expect(tile.bounds).toEqual(provider.bounds(2, 3, 3));
  });

  it("serves a streamed tile when the terrain tiles load, without touching the baked pyramid", async () => {
    const calls = stubFetch({
      "/manifest.json": () => Response.json(baseManifest([{ name: "Switzerland", zoom: curatedZoom, bounds: { west: 0, east: 90, south: 0, north: 45 }, tiles: ["1_1"] }])),
    });
    const provider = await createGeoTilesProvider("/data/geo-tiles", async () => new Float32Array(256 * 256).fill(42));
    const tile = await provider.loadTile(2, 1, 1);
    expect(tile.source).toBe("terrarium");
    expect(tile.bounds).toEqual(provider.bounds(2, 1, 1));
    expect(Array.from(tile.elevation)).toEqual([42, 42, 42, 42, 42, 42]);
    expect(calls.filter((u) => u.endsWith(".bin"))).toEqual([]);
  });
});
