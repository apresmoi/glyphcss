import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createGlyphMap, type GlyphMapHandle, type GlyphMapFillLayer } from "./widget";
import { glyphMapGlobe } from "./projection";
import { glyphMapDecodeGeoTileInt16 } from "./tile";
import { glyphMapDecodeMVT } from "./vector/pmtiles";
import { glyphMapMercatorTileBounds } from "./vector/mercator";
import { glyphMapOpenMapTilesLayers, glyphMapOpenMapTilesWaterDrape, GLYPH_MAP_OPENMAPTILES_WATER_COLORS } from "./vector/openmaptiles";
import { createGlyphMapWaterCoverage } from "./waterTerrain";
import type { GlyphMapVectorProvider, GlyphMapVectorTile } from "./vector/types";

const root = path.resolve(__dirname, "../fixtures/openfreemap/venice");
const CENTER = [12.337646, 45.439453] as const;
const COLS = 160, ROWS = 80;
const maps: GlyphMapHandle[] = [], hosts = new Set<HTMLElement>();
afterEach(() => {
  maps.splice(0).forEach(map => map.destroy());
  hosts.forEach(host => host.remove()); hosts.clear(); vi.restoreAllMocks();
});
const tile: GlyphMapVectorTile = {
  z: 12, x: 2188, y: 1466, bounds: glyphMapMercatorTileBounds(12, 2188, 1466), source: "OpenFreeMap", simplify: "mvt-source",
  layers: glyphMapDecodeMVT(readFileSync(path.join(root, "12_2188_1466.pbf")), 12, 2188, 1466, ["water", "transportation"]),
};
const coverage = createGlyphMapWaterCoverage(tile.bounds, tile.layers.water);
const source: GlyphMapVectorProvider = {
  id: "venice-ground", zooms: [{ z: 12, cols: 4096, rows: 4096, tileLonSpan: 360 / 4096, tileLatSpan: 180 / 4096, tileCols: 256, tileRows: 256 }],
  bounds: glyphMapMercatorTileBounds, tileRange: () => ({ x0: 2188, x1: 2188, y0: 1466, y1: 1466 }), loadTile: async () => tile,
};
function mount(groundElevation?: (lon: number, lat: number) => number | null) {
  const host = document.createElement("div"); document.body.append(host); hosts.add(host);
  if (!vi.isMockFunction(Element.prototype.getBoundingClientRect)) {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const e = this as HTMLElement, probe = e.tagName === "PRE" && e.style.visibility === "hidden";
      const k = (parseFloat(e.style.fontSize) || 16) / 16;
      const width = hosts.has(e) ? COLS * 8 : probe ? 8 * k : 0;
      const height = hosts.has(e) ? ROWS * 16 : probe ? 16 * k * (e.textContent ?? "").split("\n").length : 0;
      return { width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON: () => ({}) };
    });
  }
  const terrain = glyphMapDecodeGeoTileInt16(readFileSync(path.join(root, "terrain-4-8-3.bin")), {
    bounds: { west: 0, east: 22.5, south: 45, north: 56.25 }, cols: 180, rows: 90, source: "ETOPO1", sampler: "nearest",
  });
  const map = createGlyphMap(host, {
    view: { center: CENTER, span: 0.11, cols: COLS, rows: ROWS }, projection: glyphMapGlobe({ exaggeration: 24 }), tilt: 0, groundElevation,
    layers: [{ type: "raster", id: "terrain", source: terrain },
      ...glyphMapOpenMapTilesLayers(source, { include: ["omt-water"], waterTerrain: true })],
    scene: { mode: "solid", useColors: true, colorEncoding: "spans", ambientLight: { intensity: 1, color: "#ffffff" }, directionalLight: { direction: [0, 0, 1], intensity: 0 } },
  });
  maps.push(map);
  return map;
}
function cells(map: GlyphMapHandle): string[][] {
  const grid: string[][] = [[]];
  const walk = (node: Node, color: string): void => {
    if (node.nodeType === 3) {
      for (const ch of node.textContent ?? "") {
        if (ch === "\n") grid.push([]); else grid[grid.length - 1].push(`${color}:${ch}`);
      }
    } else for (const child of Array.from(node.childNodes)) walk(child, (node as HTMLElement).style?.color || color);
  };
  walk(map.scene.output, "none"); return grid;
}
it.each(["braille", "box"] as const)("real Venice: %s causeway road and rail stand on lagoon water", async strategy => {
  const map = mount(); await map.idle(); map.scene.rerender();
  const bare = cells(map);
  // Both cells are on the real causeway, inside the fixture's lagoon polygon.
  for (const [col, row] of [[51, 34], [53, 34]]) {
    expect(coverage.waterAt(...map.unproject([col, row])!)).toBe(true);
    expect(Object.values(GLYPH_MAP_OPENMAPTILES_WATER_COLORS)).toContain(bare[row][col].split(":")[0]);
  }
  for (const klass of ["trunk", "rail"]) {
    const features = tile.layers.transportation.filter(f => f.properties?.class === klass);
    expect(features.some(f => f.properties?.brunnel === "bridge")).toBe(true);
    map.addLayer({ type: "line", id: klass, source: { features }, color: "#ff0000", experimentalGlyphStrategy: strategy });
    await map.idle(); map.scene.rerender();
    const grid = cells(map);
    for (const [col, row] of [[51, 34], [53, 34]]) expect(grid[row][col], `${klass} at ${col},${row}`).toMatch(/^#ff0000:/);
    for (let col = 44; col <= 57; col++) expect(grid.slice(30, 39).some(row => row[col].startsWith("#ff0000:")), `${klass} causeway column ${col}`).toBe(true);
    map.removeLayer(klass); await map.idle();
  }
  expect(cells(map)).toEqual(bare);
});

// Select whole dry roads, not the land pixels of bridges/ferries crossing a shore.
const landFeatures = tile.layers.transportation.filter(feature => feature.geometryType === "line" && feature.rings.every(ring => ring.every((b, i) => {
  const a = ring[Math.max(0, i - 1)];
  const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.0001));
  for (let k = 0; k <= steps; k++) for (const dx of [-0.001, 0, 0.001]) for (const dy of [-0.0014, 0, 0.0014]) {
    if (coverage.waterAt(a[0] + (b[0] - a[0]) * k / steps + dx, a[1] + (b[1] - a[1]) * k / steps + dy)) return false;
  }
  return true;
})));
it.each(["braille", "box"] as const)("real Venice: %s land roads remain byte-identical to HEAD", async strategy => {
  const map = mount(); await map.idle();
  expect(landFeatures).toHaveLength(46);
  map.addLayer({ type: "line", id: "roads", source: { features: landFeatures }, color: "#ff0000", experimentalGlyphStrategy: strategy });
  await map.idle(); map.scene.rerender();
  const ink = cells(map).map(row => row.map(cell => cell.startsWith("#ff0000:") ? cell.split(":")[1] : " ").join("")).join("\n");
  expect(ink.replace(/\s/g, "").length).toBeGreaterThan(20);
  // Captured by running this same fixture against 954164b3.
  expect(createHash("sha256").update(ink).digest("hex")).toBe(strategy === "braille"
    ? "9f3f010a73c464ae49dd9ba9bc2d15503fa23728991f0db833160d6211d5d426"
    : "221a07858c9ee78b18ab0a12f112d577c00bc017e7b04a765db614cd08f077f5");
});

it.each([undefined, -1000, 20] as const)("committed water ground follows max(terrain, datum), supplied=%s", async supplied => {
  const map = mount(supplied === undefined ? undefined : () => supplied);
  await map.idle();
  const wet = [12.31, 45.45] as const;
  expect(coverage.waterAt(...wet)).toBe(true);
  map.setView({ center: wet }); await map.idle();
  expect(map.scene.camera.target).toEqual(glyphMapGlobe({ exaggeration: 24 }).project(...wet, supplied === 20 ? 20 : 0));
  map.removeLayer("omt-water"); await map.idle();
  expect(map.scene.camera.target).not.toEqual(glyphMapGlobe({ exaggeration: 24 }).project(...wet, 0));
  if (supplied !== undefined) {
    map.addLayer(glyphMapOpenMapTilesLayers(source, { include: ["omt-water"], waterTerrain: true })[0]); await map.idle();
    for (const at of [CENTER, [12.3, 45.45] as const]) {
      // Caller-supplied land (including land outside tile coverage) stays authoritative.
      expect(coverage.waterAt(...at)).toBe(false);
      map.setView({ center: at }); await map.idle();
      expect(map.scene.camera.target).toEqual(glyphMapGlobe({ exaggeration: 24 }).project(...at, supplied));
    }
  }
});

it("a static water collection grants no authority and keeps its existing drape", async () => {
  const map = mount(); await map.idle();
  map.removeLayer("omt-water"); await map.idle();
  const water: GlyphMapFillLayer = { type: "fill", id: "static-water", source: { features: tile.layers.water }, color: "#2c5c8f", drape: glyphMapOpenMapTilesWaterDrape };
  map.addLayer(water); await map.idle(); map.scene.rerender();
  const before = map.scene.output.outerHTML;
  map.removeLayer("static-water");
  map.addLayer({ ...water, waterTerrain: true }); await map.idle(); map.scene.rerender();
  expect(map.scene.output.outerHTML).toBe(before);
});

it.runIf(process.env.GLYPH_MAP_WATER_GROUND_BENCH === "1")("Venice node frame cost", async () => {
  const map = mount(); await map.idle();
  map.addLayer({ type: "line", id: "roads", source: { features: tile.layers.transportation }, color: "#ff0000", experimentalGlyphStrategy: "braille" });
  await map.idle();
  for (let i = 0; i < 20; i++) map.scene.rerender();
  const batches: number[] = [];
  for (let batch = 0; batch < 7; batch++) {
    const start = performance.now();
    for (let i = 0; i < 30; i++) map.scene.rerender();
    batches.push((performance.now() - start) / 30);
  }
  console.log("Venice ms/frame", JSON.stringify({ median: [...batches].sort((a, b) => a - b)[3], batches }));
  expect(map.scene.output.textContent?.length).toBe(COLS * ROWS + ROWS - 1);
});

// The live page draws this view from the z10 tile, whose lagoon ring is far
// coarser than z12's: draped from its shore vertices the lake surface rose
// above the DEM the causeway read pointwise, and the bridge vanished under its
// own lagoon. Still water is level, so both now stand on one shoreline level.
it.each(["braille", "box"] as const)("real Venice z10: %s causeway stands on the level lagoon surface", async strategy => {
  const z10: GlyphMapVectorTile = {
    z: 10, x: 547, y: 366, bounds: glyphMapMercatorTileBounds(10, 547, 366), source: "OpenFreeMap", simplify: "mvt-source",
    layers: glyphMapDecodeMVT(readFileSync(path.join(root, "10_547_366.pbf")), 10, 547, 366, ["water", "transportation"]),
  };
  const z10Source: GlyphMapVectorProvider = {
    ...source, id: "venice-ground-z10",
    zooms: [{ z: 10, cols: 1024, rows: 1024, tileLonSpan: 360 / 1024, tileLatSpan: 180 / 1024, tileCols: 256, tileRows: 256 }],
    tileRange: () => ({ x0: 547, x1: 547, y0: 366, y1: 366 }), loadTile: async () => z10,
  };
  const map = mount(); await map.idle();
  map.removeLayer("omt-water");
  map.addLayer(glyphMapOpenMapTilesLayers(z10Source, { include: ["omt-water"], waterTerrain: true })[0]);
  await map.idle(); map.scene.rerender();
  for (const klass of ["trunk", "rail"]) {
    const features = z10.layers.transportation.filter(f => f.properties?.class === klass);
    map.addLayer({ type: "line", id: klass, source: { features }, color: "#ff0000", experimentalGlyphStrategy: strategy });
    await map.idle(); map.scene.rerender();
    const grid = cells(map);
    for (let col = 44; col <= 57; col++) expect(grid.slice(30, 39).some(row => row[col]?.startsWith("#ff0000:")), `${klass} causeway column ${col}`).toBe(true);
    map.removeLayer(klass); await map.idle();
  }
});
