import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createGlyphMap, type GlyphMapHandle } from "./widget";
import { glyphMapGlobe } from "./projection";
import { glyphMapDecodeGeoTileInt16 } from "./tile";
import type { GlyphMapProvider } from "./provider";
import { glyphMapOpenFreeMapProvider } from "./vector/openfreemap";
import { glyphMapOpenMapTilesLayers } from "./vector/openmaptiles";
import type { GlyphMapVectorSource } from "./vector/types";
import * as stroke from "./stroke";

const COLS = 139, ROWS = 77;
const root = path.resolve(__dirname, "../fixtures/road-relief");
const hosts: HTMLElement[] = [], maps: GlyphMapHandle[] = [];
afterEach(() => {
  maps.splice(0).forEach(map => map.destroy());
  hosts.splice(0).forEach(host => host.remove());
  vi.restoreAllMocks();
});
function mount(center: [number, number], terrain: ReturnType<typeof glyphMapDecodeGeoTileInt16> | GlyphMapProvider, source: GlyphMapVectorSource, strategy: "box" | "braille") {
  const host = document.createElement("div"); document.body.append(host); hosts.push(host);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const e = this as HTMLElement, k = (parseFloat(e.style.fontSize) || 16) / 16;
    const probe = e.tagName === "PRE" && e.style.visibility === "hidden";
    const width = e === host ? COLS * 12 : probe ? 12 * k : 0;
    const height = e === host ? ROWS * 14 : probe ? 14 * k * (e.textContent ?? "").split("\n").length : 0;
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) };
  });
  const roads = glyphMapOpenMapTilesLayers(source, { include: ["omt-roads"], roadHierarchy: true,
    lineOptions: { "omt-roads": { experimentalGlyphStrategy: strategy, simplify: "vw" } } });
  const map = createGlyphMap(host, { view: { center, span: 0.0475, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ exaggeration: 24 }), tilt: 0,
    layers: [{ id: "terrain", type: "raster", source: terrain }, ...roads] });
  maps.push(map); return map;
}

for (const strategy of ["box", "braille"] as const) {
  it(`keeps ${strategy} roads over the reported Buenos Aires ETOPO1 slope`, async () => {
    const { zooms } = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
    const loaded = new Set<string>();
    const terrain: GlyphMapProvider = { id: "etopo1", zooms, bounds(z, x, y) {
      const level = zooms[z];
      const west = -180 + x * level.tileLonSpan, north = 90 - y * level.tileLatSpan;
      return { west, east: west + level.tileLonSpan, north, south: north - level.tileLatSpan };
    }, async loadTile(z, x, y) {
      loaded.add(`${z}/${x}/${y}`);
      return glyphMapDecodeGeoTileInt16(readFileSync(path.join(root, `terrain/${z}_${x}_${y}.bin`)), {
        bounds: this.bounds(z, x, y), cols: 180, rows: 90, source: "etopo1", sampler: "nearest",
      });
    } };
    // Synthetic routes isolate the actual BA terrain defect; these are not OSM geometry.
    const source = { features: Array.from({ length: 24 }, (_, i) => ({ geometryType: "line" as const,
      properties: { class: "minor" }, rings: [[[-58.42, -34.613 + i * 0.002], [-58.36, -34.613 + i * 0.002]]] as const })) };
    const ink = new Set<number>(); let bypass = false;
    const realStamp = stroke.stampGlyphMapPolyline;
    vi.spyOn(stroke, "stampGlyphMapPolyline").mockImplementation((g, vertices, opts) => {
      // Remove terrain depth once per frame; retain the lines’ own depth writes.
      if (bypass) { g.depth.fill(-Infinity); bypass = false; }
      realStamp(g, vertices, { ...opts, onInk: idx => ink.add(idx) });
    });
    const map = mount([-58.3918, -34.5919], terrain, source, strategy); await map.idle();
    ink.clear(); map.scene.rerender(); const actual = new Set(ink);
    bypass = true; ink.clear(); map.scene.rerender(); const ceiling = new Set(ink);
    expect(loaded).toEqual(new Set(["0/0/0", "3/2/5", "4/5/11"]));
    expect(ceiling.size).toBeGreaterThan(1500);
    expect(actual).toEqual(ceiling);
  });

  it(`keeps real OpenFreeMap ${strategy} roads over real Houston ETOPO1 relief`, async () => {
    const terrain = glyphMapDecodeGeoTileInt16(readFileSync(path.join(root, "terrain/houston_4_3_5.bin")), {
      bounds: { west: -112.5, east: -90, north: 33.75, south: 22.5 }, cols: 180, rows: 90, source: "etopo1", sampler: "nearest",
    });
    const loaded: string[] = [];
    const source = glyphMapOpenFreeMapProvider({ minZoom: 14, maxZoom: 14, fetchTile: async (_url, z, x, y) => {
      if (x !== 3851 || y !== 6772) return new ArrayBuffer(0);
      loaded.push(`${z}/${x}/${y}`);
      const bytes = readFileSync(path.resolve(__dirname, "../fixtures/openfreemap/z14-3851-6772-hide3d.mvt"));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    } });
    const ink = new Set<number>(); let bypass = false;
    const realStamp = stroke.stampGlyphMapPolyline;
    vi.spyOn(stroke, "stampGlyphMapPolyline").mockImplementation((g, vertices, opts) => {
      if (bypass) { g.depth.fill(-Infinity); bypass = false; }
      realStamp(g, vertices, { ...opts, onInk: idx => ink.add(idx) });
    });
    const map = mount([-95.3723, 29.7548], terrain, source, strategy); await map.idle();
    ink.clear(); map.scene.rerender(); const actual = new Set(ink);
    bypass = true; ink.clear(); map.scene.rerender(); const ceiling = new Set(ink);
    expect(loaded).toContain("14/3851/6772");
    expect(ceiling.size).toBeGreaterThan(1500);
    // Both strategies test against the relief as it stood before the layer.
    expect([...ceiling].filter(idx => !actual.has(idx))).toEqual([]);
  });
}
