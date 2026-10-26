import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as glyph from "glyphcss";
import { createGlyphMap, type GlyphMapHandle } from "./widget";
import { glyphMapGlobe } from "./projection";
import { glyphMapBreaks } from "./classify";
import { glyphMapDecodeGeoTileInt16 } from "./tile";
import type { GlyphMapProvider } from "./provider";
import { glyphMapDecodeMVT } from "./vector/pmtiles";
import { glyphMapMercatorTileBounds } from "./vector/mercator";
import { glyphMapOpenMapTilesLayers } from "./vector/openmaptiles";
import type { GlyphMapVectorProvider, GlyphMapVectorTile } from "./vector/types";

const terrainRoot = path.resolve(__dirname, "../../../website/public/data/geo-tiles");
const waterRoot = path.resolve(__dirname, "../fixtures/openfreemap/venice");
const mounted = new Map<glyph.GlyphMeshHandle, string>();
const maps: GlyphMapHandle[] = [];
afterEach(() => {
  maps.splice(0).forEach(map => map.destroy());
  document.body.innerHTML = "";
  mounted.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("budgets Venice's real z0 floor + two z4 fine meshes, including a late water commit", async () => {
  const createScene = glyph.createGlyphScene;
  vi.spyOn(glyph, "createGlyphScene").mockImplementation((...args) => {
    const scene = createScene(...args), add = scene.add;
    scene.add = (polygons, transform) => {
      const handle = add(polygons, transform);
      mounted.set(handle, transform?.detailGroup ?? "water");
      const dispose = handle.dispose;
      handle.dispose = () => { mounted.delete(handle); dispose(); };
      return handle;
    };
    return scene;
  });
  const zooms = [0, 4].map(z => ({ z, cols: 2 ** z, rows: 2 ** z,
    tileLonSpan: 360 / 2 ** z, tileLatSpan: 180 / 2 ** z, tileCols: 180, tileRows: 90 }));
  const loaded = new Set<string>();
  const terrain: GlyphMapProvider = {
    id: "real-venice-tiers", zooms,
    bounds: (z, x, y) => ({ west: -180 + x * 360 / 2 ** z, east: -180 + (x + 1) * 360 / 2 ** z,
      north: 90 - y * 180 / 2 ** z, south: 90 - (y + 1) * 180 / 2 ** z }),
    loadTile: async (z, x, y) => {
      loaded.add(`${z}/${x}_${y}`);
      return glyphMapDecodeGeoTileInt16(readFileSync(path.join(terrainRoot, `${z}/${x}_${y}.bin`)), {
        bounds: terrain.bounds(z, x, y), cols: 180, rows: 90, source: `${z}/${x}_${y}`, sampler: "nearest",
      });
    },
  };
  const tiles = [91, 92].map(y => ({ z: 8, x: 136, y, bounds: glyphMapMercatorTileBounds(8, 136, y),
    source: "OpenFreeMap", simplify: "mvt-source", layers: glyphMapDecodeMVT(
      readFileSync(path.join(waterRoot, `8_136_${y}.pbf`)), 8, 136, y, ["water"]),
  } satisfies GlyphMapVectorTile));
  const water: GlyphMapVectorProvider = {
    id: "venice-z8", zooms: [{ z: 8, cols: 256, rows: 256, tileLonSpan: 360 / 256,
      tileLatSpan: 180 / 256, tileCols: 256, tileRows: 256 }],
    bounds: glyphMapMercatorTileBounds,
    tileRange: () => ({ x0: 136, x1: 136, y0: 91, y1: 92 }),
    loadTile: async (_z, _x, row) => tiles[row - 91],
  };
  const snapshots: Record<string, number[]> = {};
  for (const mode of ["no-water", "legacy-water", "waterTerrain", "water-first"] as const) {
    loaded.clear();
    const host = document.createElement("div"); document.body.append(host);
    const waterLayers = glyphMapOpenMapTilesLayers(water, { include: ["omt-water"], waterTerrain: mode !== "legacy-water" });
    const raster = { type: "raster" as const, id: "terrain", source: terrain,
      classifier: glyphMapBreaks([0]), colors: ["#2a55a8", "#2f5a36"] };
    const map = createGlyphMap(host, {
      // Decoded from p3x57cfsey5r1xb1s252t10E1L1bO21g. The two cached z8
      // tiles are real source data, not a claim to the entire page tile set.
      view: { center: [12.337646, 45.439453], span: Math.exp(.091), cols: 160, rows: 64 },
      projection: glyphMapGlobe({ exaggeration: 24 }), tilt: 0,
      layers: mode === "water-first" ? waterLayers : [raster, ...(mode === "no-water" ? [] : waterLayers)],
      scene: { mode: "solid", useColors: true },
    });
    maps.push(map); await map.idle();
    if (mode === "water-first") { map.addLayer(raster); await map.idle(); }
    const globe = glyphMapGlobe();
    const rows = [...mounted].map(([handle, tier]) => ({ tier,
      tile: tier.endsWith(":floor") ? "0/0_0" : tier.endsWith(":fine")
        ? globe.unproject(handle.polygons[0].vertices[0])[1] > 50 ? "4/8_3" : "4/8_4"
        : "8/136_91 + 8/136_92",
      polygons: handle.polygons.length,
    }));
    const terrainCounts = rows.filter(row => row.tier !== "water").map(row => row.polygons);
    const waterCount = rows.filter(row => row.tier === "water").reduce((sum, row) => sum + row.polygons, 0);
    snapshots[mode] = [...terrainCounts, waterCount];
    console.log(JSON.stringify({ mode, meshes: rows, total: rows.reduce((sum, row) => sum + row.polygons, 0) }));
    expect([...loaded].sort()).toEqual(["0/0_0", "4/8_3", "4/8_4"]);
    expect(rows.filter(row => row.tier.endsWith(":floor"))).toHaveLength(1);
    expect(rows.filter(row => row.tier.endsWith(":fine")).map(row => row.tile).sort()).toEqual(["4/8_3", "4/8_4"]);
    expect(rows.some(row => row.tier.endsWith(":fallback"))).toBe(false);
    expect(map.scene.output.textContent?.trim()).toBeTruthy();
    const perf: { polys: number[] } = { polys: [] };
    vi.stubGlobal("__glyphPerf", perf);
    map.scene.rerender();
    expect(perf.polys.at(-1)).toBe(rows.reduce((sum, row) => sum + row.polygons, 0));
    vi.unstubAllGlobals();
    if (mode === "no-water") expect(terrainCounts).toEqual([512, 16200, 16200]);
    if (mode === "waterTerrain" || mode === "water-first") {
      expect(terrainCounts[0]).toBeLessThanOrEqual(550);
      expect(terrainCounts[1]).toBeLessThanOrEqual(19200);
      expect(terrainCounts[2]).toBeLessThanOrEqual(18500);
      expect(rows.reduce((sum, row) => sum + row.polygons, 0)).toBeLessThanOrEqual(45200);
    }
    map.destroy();
  }
  expect(snapshots["water-first"]).toEqual(snapshots.waterTerrain);
});
