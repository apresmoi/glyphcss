// @vitest-environment happy-dom
/**
 * The page's OSM slice through the REAL widget and the REAL rasterizer:
 * `createOsmSource` → `mapOsmLayers` → `createGlyphMap`.
 *
 * Three things are load-bearing here and none of them can be checked by
 * reading the wiring.
 *
 *  1. **It is the planet, not Zürich.** The page's previous source was a
 *     vendored ~4 km extract; the test that matters now is that mounting it
 *     over TOKYO — and over the open Pacific at world scale — puts real
 *     geometry on the grid.
 *  2. **Attribution.** OpenStreetMap data is ODbL and the credit is not
 *     optional. It must ride the mounted LAYER (`GlyphMapVectorProvider
 *     .attribution` → `getAttributions()`), so mounting adds it and
 *     unmounting withdraws it, with no string anywhere on the page.
 *  3. **Volume.** A world view must not fan out to thousands of tiles, and
 *     the number that counts is the number the NETWORK sees with every
 *     default row mounted — each layer runtime sweeps independently.
 *
 * Nothing touches the network: `fetchTile` is injected and serves bytes the
 * live service actually returned, vendored at
 * `packages/maps/fixtures/openfreemap/`. MVT geometry is tile-local, so those
 * bytes decode into whatever address the sweep asked for — which is exactly
 * what makes "real OSM geometry, far from Zürich" testable offline.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap, glyphMapEquirectangular, type GlyphMapHandle } from "@glyphcss/maps";
import { MAP_OSM_DEFAULT_ON, createOsmSource, mapOsmLayers } from "./mapsOsm";

const FIXTURES = path.resolve(__dirname, "../../../../packages/maps/fixtures/openfreemap");
const bytes = (name: string) => {
  const buf = readFileSync(path.join(FIXTURES, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};
const Z0 = bytes("z0-0-0.mvt");
const Z12 = bytes("z12-2145-1434.mvt");

const COLS = 140;
const ROWS = 63;
const OSM_CREDIT = "OpenStreetMap contributors";

const hosts: HTMLElement[] = [];
const maps: GlyphMapHandle[] = [];

function mount(center: [number, number], span: number): GlyphMapHandle {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const map = createGlyphMap(host, {
    view: { center, span, cols: COLS, rows: ROWS },
    projection: glyphMapEquirectangular(),
    tilt: 0,
  });
  maps.push(map);
  return map;
}

/** The page's own source, serving the recorded tile appropriate to the zoom the sweep picks. */
function source(fetchTile: ReturnType<typeof vi.fn>) {
  return createOsmSource({ fetchTile });
}

function recorder() {
  return vi.fn(async (_url: string, z: number) => (z === 0 ? Z0 : Z12));
}

afterEach(() => {
  for (const map of maps.splice(0)) map.destroy();
  for (const host of hosts.splice(0)) host.remove();
});

describe("the page's OSM source draws real data far from Zurich", () => {
  it("puts OpenStreetMap geometry on the grid over Tokyo", async () => {
    const fetchTile = recorder();
    const map = mount([139.7514, 35.6853], 0.06);
    const blank = (map.scene.output.textContent ?? "").replace(/[\s\n]/g, "");
    expect(blank).toBe("");

    for (const layer of mapOsmLayers(source(fetchTile), { enabled: ["omt-roads"], density: 1 })) map.addLayer(layer);
    await vi.waitFor(() => expect(fetchTile).toHaveBeenCalled());
    await vi.waitFor(() => {
      map.scene.rerender();
      expect((map.scene.output.textContent ?? "").replace(/[\s\n]/g, "").length).toBeGreaterThan(0);
    });
    // The sweep asked at city scale, in Mercator, for a Tokyo address — the
    // equal-angle indexer would have put this latitude hundreds of rows away.
    const [z, x, y] = fetchTile.mock.calls[0].slice(1) as [number, number, number];
    expect(z).toBe(12);
    expect(x).toBe(3637);
    expect(y).toBe(1612);
  });

  it("draws at a WORLD view too — the extract's whole coverage problem is gone", async () => {
    const fetchTile = recorder();
    const map = mount([-140, 0], 360);
    for (const layer of mapOsmLayers(source(fetchTile), { enabled: ["omt-water"], density: 1 })) map.addLayer(layer);
    await vi.waitFor(() => expect(fetchTile).toHaveBeenCalled());
    await vi.waitFor(() => {
      map.scene.rerender();
      expect((map.scene.output.textContent ?? "").replace(/[\s\n]/g, "").length).toBeGreaterThan(0);
    });
    expect(fetchTile.mock.calls[0].slice(1)).toEqual([0, 0, 0]);
  });
});

describe("attribution rides the mounted layer, never the page", () => {
  it("adds the ODbL credit on mount and withdraws it on removal", async () => {
    const map = mount([139.7514, 35.6853], 0.06);
    expect(map.getAttributions()).toEqual([]);

    const layers = mapOsmLayers(source(recorder()), { enabled: ["omt-roads"], density: 1 });
    for (const layer of layers) map.addLayer(layer);
    const credited = map.getAttributions();
    expect(credited.map((a) => a.name)).toContain(OSM_CREDIT);
    expect(credited.find((a) => a.name === OSM_CREDIT)?.license).toBe("ODbL");
    // OpenFreeMap host the planet for free and OpenMapTiles own the schema;
    // both are credited alongside the data's own licence.
    expect(credited.map((a) => a.name)).toContain("OpenMapTiles");
    expect(credited.map((a) => a.name)).toContain("OpenFreeMap");

    for (const layer of layers) map.removeLayer(layer.id!);
    expect(map.getAttributions().map((a) => a.name)).not.toContain(OSM_CREDIT);
  });

  it("credits OpenStreetMap exactly once however many rows are on", async () => {
    const map = mount([139.7514, 35.6853], 0.06);
    const layers = mapOsmLayers(source(recorder()), { enabled: MAP_OSM_DEFAULT_ON, density: 1 });
    expect(layers.length).toBe(MAP_OSM_DEFAULT_ON.length);
    for (const layer of layers) map.addLayer(layer);
    expect(map.getAttributions().filter((a) => a.name === OSM_CREDIT)).toHaveLength(1);
  });
});

/**
 * The counts the page actually pays. Every mounted row sweeps on its own
 * cache, so these would be four times larger without `createOsmSource`'s
 * in-flight sharing — which is what the first case here pins.
 */
describe("on-demand volume with every default row mounted", () => {
  const count = async (center: [number, number], span: number) => {
    const fetchTile = recorder();
    const map = mount(center, span);
    for (const layer of mapOsmLayers(source(fetchTile), { enabled: MAP_OSM_DEFAULT_ON, density: 1 })) map.addLayer(layer);
    await vi.waitFor(() => expect(fetchTile).toHaveBeenCalled());
    // Let every mounted runtime's sweep land before counting.
    await new Promise((r) => setTimeout(r, 0));
    const calls = fetchTile.mock.calls as unknown as [string, number, number, number][];
    return { z: calls[0][1], tiles: calls.length, distinct: new Set(calls.map((c) => `${c[1]}/${c[2]}_${c[3]}`)).size };
  };

  it("fetches ONE tile at a world view, not one per mounted row", async () => {
    const { z, tiles, distinct } = await count([0, 0], 360);
    expect(z).toBe(0);
    expect(distinct).toBe(1);
    expect(tiles).toBe(1);
  });

  it("fetches a handful at a country view", async () => {
    const { z, tiles } = await count([8.5, 47], 10);
    expect(z).toBe(5);
    expect(tiles).toBeGreaterThan(0);
    expect(tiles).toBeLessThanOrEqual(24);
  });

  it("fetches a handful at a city view", async () => {
    const { z, tiles } = await count([139.7514, 35.6853], 0.06);
    expect(z).toBe(12);
    expect(tiles).toBeGreaterThan(0);
    expect(tiles).toBeLessThanOrEqual(24);
  });
});

describe("failure degrades quietly", () => {
  it("keeps the layer mounted and the map alive when every tile fails", async () => {
    const onError = vi.fn();
    const fetchTile = vi.fn(async () => { throw new Error("504 Gateway Timeout"); });
    const map = mount([139.7514, 35.6853], 0.06);
    const layers = mapOsmLayers(createOsmSource({ fetchTile, onError }), { enabled: ["omt-roads"], density: 1 });
    expect(() => { for (const layer of layers) map.addLayer(layer); }).not.toThrow();
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(() => map.setView({ center: [139.76, 35.69] })).not.toThrow();
    expect(map.getAttributions().map((a) => a.name)).toContain(OSM_CREDIT);
  });
});
