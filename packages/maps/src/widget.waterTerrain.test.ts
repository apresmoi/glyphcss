import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { decodeGlyphAtlasCodePoint, ensureGlyphAtlasFontFaceStyles } from "glyphcss";
import { createGlyphMap, type GlyphMapHandle } from "./widget";
import { glyphMapGlobe, glyphMapEquirectangular } from "./projection";
import { glyphMapBreaks } from "./classify";
import { glyphMapDecodeGeoTileInt16, glyphMapGeoTileElevationAt, type GlyphMapGeoTile } from "./tile";
import { glyphMapDecodeMVT } from "./vector/pmtiles";
import { glyphMapMercatorTileBounds } from "./vector/mercator";
import { glyphMapOpenMapTilesLayers, GLYPH_MAP_OPENMAPTILES_WATER_COLORS } from "./vector/openmaptiles";
import type { GlyphMapVectorProvider, GlyphMapVectorTile } from "./vector/types";
import { glyphMapWaterContains } from "./waterTerrain";

const root = path.resolve(__dirname, "../fixtures/openfreemap/venice");
const VENICE = [12.3376, 45.4394] as const;
const COLS = 138, ROWS = 77;
const SEA = "#2a55a8", LAND = "#2f5a36";
const maps: GlyphMapHandle[] = [], hosts = new Set<HTMLElement>();
afterEach(() => {
  maps.splice(0).forEach(m => m.destroy());
  hosts.forEach(h => h.remove()); hosts.clear(); vi.restoreAllMocks();
});

function fixture(z: number, x: number, y: number): GlyphMapVectorTile {
  return { z, x, y, bounds: glyphMapMercatorTileBounds(z, x, y), source: "OpenFreeMap", simplify: "mvt-source",
    layers: glyphMapDecodeMVT(readFileSync(path.join(root, `${z}_${x}_${y}.pbf`)), z, x, y, ["water"]) };
}
function provider(tile: GlyphMapVectorTile, load = async () => tile): GlyphMapVectorProvider {
  const { z, x, y } = tile;
  return { id: "water-fixture", zooms: [{ z, cols: 2 ** z, rows: 2 ** z, tileLonSpan: 360 / 2 ** z,
    tileLatSpan: 180 / 2 ** z, tileCols: 256, tileRows: 256 }],
    bounds: glyphMapMercatorTileBounds, tileRange: () => ({ x0: x, x1: x, y0: y, y1: y }), loadTile: load };
}
function terrain(): GlyphMapGeoTile {
  return glyphMapDecodeGeoTileInt16(readFileSync(path.join(root, "terrain-4-8-3.bin")), {
    bounds: { west: 0, east: 22.5, south: 45, north: 56.25 }, cols: 180, rows: 90, source: "ETOPO1", sampler: "bilinear",
  });
}
function mount(source: GlyphMapVectorProvider, waterTerrain?: boolean, globe = false, ground = terrain(), minElevation: number | null = 0) {
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
  const map = createGlyphMap(host, {
    view: { center: VENICE, span: 1.1, cols: COLS, rows: ROWS },
    projection: globe ? glyphMapGlobe({ exaggeration: 24 }) : glyphMapEquirectangular({ exaggeration: 24 }),
    tilt: 0,
    layers: [{ type: "raster", id: "terrain", source: ground, ...(minElevation === null ? {} : { minElevation }), classifier: glyphMapBreaks([0]), colors: [SEA, LAND] },
      ...glyphMapOpenMapTilesLayers(source, { include: ["omt-water"], ...(waterTerrain === undefined ? {} : { waterTerrain }) })],
    scene: { mode: "solid", useColors: true, colorEncoding: "spans", ambientLight: { intensity: 1, color: "#ffffff" }, directionalLight: { direction: [0, 0, 1], intensity: 0 } },
  });
  maps.push(map); return map;
}
function colors(map: GlyphMapHandle): string[][] {
  const grid: string[][] = [[]];
  const walk = (node: Node, color: string): void => {
    if (node.nodeType === 3) {
      for (const ch of node.textContent ?? "") {
        if (ch === "\n") grid.push([]); else grid[grid.length - 1].push(ch === " " ? "blank" : color);
      }
    } else {
      for (const child of Array.from(node.childNodes)) walk(child, (node as HTMLElement).style?.color || color);
    }
  };
  walk(map.scene.output, "none"); return grid;
}
function colorAt(map: GlyphMapHandle, at: readonly [number, number]): string {
  const { col, row } = map.project(at);
  return colors(map)[Math.floor(row)]?.[Math.round(col)];
}

function inRing(at: readonly [number, number], ring: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > at[1]) !== (b[1] > at[1]) && at[0] < (b[0] - a[0]) * (at[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function veniceCells(map: GlyphMapHandle, tile: GlyphMapVectorTile) {
  const grid = colors(map);
  let land = 0, lake = 0;
  for (let row = 35; row <= 42; row++) for (let col = 63; col <= 75; col++) {
    // The rasterizer samples integer cells. Rounding a geographic point can
    // land in a canal instead of its island at the reported 138x77 grid.
    const at = map.unproject([col, row]);
    if (!at || !glyphMapWaterContains(tile.bounds, ...at)) continue;
    const water = tile.layers.water.find(f => f.polygons?.some(g => inRing(at, g[0]) && !g.slice(1).some(hole => inRing(at, hole))));
    if (!water) { expect(grid[row][col], `dry cell ${col},${row} at ${at}`).toBe(LAND); land++; }
    else if (water.properties?.class === "lake") { expect(Object.values(GLYPH_MAP_OPENMAPTILES_WATER_COLORS)).toContain(grid[row][col]); lake++; }
  }
  expect(land).toBeGreaterThan(0);
  expect(lake).toBeGreaterThan(0);
}

it.each([[8, 136, 91], [10, 547, 366], [12, 2188, 1466]])("real Venice z%s: the lagoon's hole renders land, and lagoon water remains water", async (z, x, y) => {
  const tile = fixture(z, x, y);
  expect(tile.layers.water.some(f => f.properties?.class === "ocean")).toBe(true);
  expect(glyphMapGeoTileElevationAt(terrain(), ...VENICE)).toBeLessThan(0);
  const map = mount(provider(tile), true);
  await map.idle(); map.scene.rerender();
  expect(tile.layers.water.some(f => f.properties?.class === "lake" && f.polygons?.some(g => g.slice(1).some(hole => inRing(VENICE, hole))))).toBe(true);
  veniceCells(map, tile);
});

it("open ocean remains water on the globe, even where datum terrain used to occlude the ocean fill", async () => {
  const map = mount(provider(fixture(8, 136, 91)), true, true);
  await map.idle(); map.scene.rerender();
  veniceCells(map, fixture(8, 136, 91));
  expect(colorAt(map, [12.55, 45.3])).toBe("#1b3f66");
  const frame = map.scene.output.outerHTML;
  map.scene.rerender(); expect(map.scene.output.outerHTML).toBe(frame);
});

it("opt-out is byte-identical to the legacy water row, and removing authority restores it", async () => {
  const source = provider(fixture(8, 136, 91));
  const legacy = mount(source), off = mount(source, false), on = mount(source, true);
  await Promise.all([legacy.idle(), off.idle(), on.idle()]);
  for (const map of [legacy, off, on]) map.scene.rerender();
  expect(colors(legacy)[38][68]).toBe(SEA);
  expect(off.scene.output.outerHTML).toBe(legacy.scene.output.outerHTML);
  on.removeLayer("omt-water"); legacy.removeLayer("omt-water");
  await Promise.all([legacy.idle(), on.idle()]);
  on.scene.rerender(); legacy.scene.rerender();
  expect(on.scene.output.outerHTML).toBe(legacy.scene.output.outerHTML);
});

it("does not grant authority before a successful load or outside its bounds", async () => {
  const tile = fixture(12, 2188, 1466);
  let release!: (tile: GlyphMapVectorTile) => void;
  const pending = new Promise<GlyphMapVectorTile>(resolve => { release = resolve; });
  const map = mount(provider(tile, () => pending), true);
  map.scene.rerender();
  expect(colorAt(map, VENICE)).toBe(SEA);
  release(tile); await map.idle(); map.scene.rerender();
  veniceCells(map, tile);
  expect(colorAt(map, [12.55, 45.3])).toBe(SEA);
});

it("retains the committed water/land snapshot through pending and failed replacements, then retries", async () => {
  const tile = fixture(8, 136, 91), nextBounds = glyphMapMercatorTileBounds(8, 137, 91);
  const next = { ...tile, x: 137, bounds: nextBounds, layers: {} };
  let expanded = false, release!: (tile: GlyphMapVectorTile) => void;
  let pending = new Promise<GlyphMapVectorTile>(resolve => { release = resolve; });
  const load = vi.fn(async (_z: number, x: number) => x === 136 ? tile : pending);
  const source = { ...provider(tile), tileRange: () => ({ x0: 136, x1: expanded ? 137 : 136, y0: 91, y1: 91 }), loadTile: load };
  const map = mount(source, true);
  await map.idle(); veniceCells(map, tile);
  expanded = true; map.setView({ span: 1.10001 });
  await vi.waitFor(() => expect(load.mock.calls.some(call => call[1] === 137)).toBe(true), { timeout: 5000 });
  map.scene.rerender(); veniceCells(map, tile);
  expect(colorAt(map, [12.8, 45.3])).toBe(SEA);
  release({ ...next, unavailable: true }); await map.idle();
  map.scene.rerender(); veniceCells(map, tile);
  expect(colorAt(map, [12.8, 45.3])).toBe(SEA);
  pending = Promise.resolve(next); map.setView({ span: 1.1 }); await map.idle();
  map.scene.rerender(); veniceCells(map, tile);
  expect(load.mock.calls.filter(call => call[1] === 137)).toHaveLength(2);
  // A successful, empty land-only tile is different from failed transport.
  expect(colorAt(map, [12.8, 45.3])).toBe(LAND);
});

it("plants dry land at datum without a terrain floor, while water keeps its original ground", async () => {
  const tile = fixture(8, 136, 91);
  const ground: GlyphMapGeoTile = { bounds: tile.bounds, cols: 4, rows: 4, elevation: new Float32Array(25).fill(-1000), source: "submerged-island", sampler: "nearest" };
  const map = mount(provider(tile), true, false, ground, null);
  const projection = glyphMapEquirectangular({ exaggeration: 24 });
  await map.idle();
  expect(map.scene.camera.target).toEqual(projection.project(...VENICE, 0));
  map.setView({ center: [12.36, 45.47] }); await map.idle();
  expect(map.scene.camera.target).toEqual(projection.project(12.36, 45.47, -1000));
});

it("encodes the corrected land and water cells as atlas glyphs", async () => {
  const map = mount(provider(fixture(8, 136, 91)), true);
  await map.idle(); map.scene.rerender();
  const expected = colors(map);
  expect(expected[38][68]).toBe(LAND);
  const palette = [...new Set([SEA, LAND, ...Object.values(GLYPH_MAP_OPENMAPTILES_WATER_COLORS)])];
  map.scene.setOptions({ colorEncoding: "atlas", atlasPalette: palette });
  expect(await ensureGlyphAtlasFontFaceStyles(document)).toBe(true);
  await map.idle(); map.scene.rerender();
  expect(map.scene.output.querySelectorAll("span")).toHaveLength(0);
  const rows = (map.scene.output.textContent ?? "").split("\n").map(row => Array.from(row));
  let decoded = 0;
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (expected[row][col] === "blank") continue;
    const glyph = decodeGlyphAtlasCodePoint(rows[row][col].codePointAt(0)!);
    expect(glyph).not.toBeNull();
    expect(palette[glyph!.paletteSlot]).toBe(expected[row][col]); decoded++;
  }
  expect(decoded).toBeGreaterThan(1000);
});

it("real z0 open ocean remains water across the global terrain backstop", async () => {
  const bounds = glyphMapMercatorTileBounds(0, 0, 0);
  const tile: GlyphMapVectorTile = { z: 0, x: 0, y: 0, bounds, source: "OpenFreeMap", simplify: "mvt-source",
    layers: glyphMapDecodeMVT(readFileSync(path.join(root, "../z0-0-0.mvt")), 0, 0, 0, ["water"]) };
  expect(tile.layers.water.some(f => f.properties?.class === "ocean")).toBe(true);
  const ground: GlyphMapGeoTile = { bounds: { west: -180, east: 180, south: -90, north: 90 }, cols: 180, rows: 90,
    elevation: new Float32Array(181 * 91).fill(-6000), source: "global-seabed", sampler: "nearest" };
  const map = mount(provider(tile), true, true, ground);
  map.setView({ center: [-140, 0], span: 240 });
  await map.idle(); map.scene.rerender();
  expect(colorAt(map, [-140, 0])).toBe("#1b3f66");
});
