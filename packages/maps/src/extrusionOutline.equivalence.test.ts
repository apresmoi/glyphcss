import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { Session } from "node:inspector";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as outline from "./extrusionOutline";
import * as reference from "./test/extrusionOutlineReference";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import { glyphMapOpenFreeMapProvider } from "./vector/openfreemap";
import { glyphMapOpenMapTilesLayers } from "./vector/openmaptiles";
import { glyphMapDecodeMVT } from "./vector/pmtiles";
import type { Polygon } from "glyphcss";
import type { GlyphMapExtrusionGeometry } from "./layers";

const root = path.resolve(__dirname, "../fixtures/road-relief/ba");
const center: [number, number] = [-58.387044, -34.594994];
// Fixed logical output; this reproduces the pan operations, not browser layout.
const cols = 156, rows = 77, cellWidth = 12 * 1200 / 2048, cellHeight = 12;
const maps: ReturnType<typeof createGlyphMap>[] = [];
afterEach(() => { maps.splice(0).forEach(m => m.destroy()); vi.restoreAllMocks(); document.body.innerHTML = ""; });

async function mount() {
  const host = document.createElement("div"); document.body.append(host);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function(this: Element) {
    const e = this as HTMLElement, k = (parseFloat(e.style.fontSize) || 16) / 16;
    const probe = e.tagName === "PRE" && e.style.visibility === "hidden";
    const width = e === host ? cols * cellWidth : probe ? cellWidth * k : 0;
    const height = e === host ? rows * cellHeight : probe ? cellHeight * k * (e.textContent ?? "").split("\n").length : 0;
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) };
  });
  const loaded = new Set<string>();
  // BA's vendored tiles stop at z13; never silently benchmark empty z14 data.
  const source = glyphMapOpenFreeMapProvider({ maxZoom: 13, fetchTile: async (_url, z, x, y) => {
    const file = path.join(root, `osm_${z}_${x}_${y}.pbf`);
    if (!existsSync(file)) return new ArrayBuffer(0);
    loaded.add(file);
    const bytes = readFileSync(file);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }});
  const layers = glyphMapOpenMapTilesLayers(source, {
    include: ["omt-water", "omt-roads", "omt-buildings"], roadHierarchy: true,
    lineOptions: { "omt-roads": { experimentalGlyphStrategy: "braille", simplify: "vw", color: "#506981" } },
  }).map(l => l.type === "fill-extrusion" ? { ...l, outline: "braille" as const } : l);
  const map = createGlyphMap(host, { view: { center, span: 0.012, cols, rows }, projection: glyphMapGlobe({ exaggeration: 24 }), layers });
  maps.push(map); await map.idle();
  expect(loaded.size).toBeGreaterThan(0);
  return { map, host };
}

it("matches the packet-11 surface and complete stamped grids over BA buildings during pan, tilt and replacement", async () => {
  const create = outline.createGlyphMapExtrusionSurface, stamp = outline.stampGlyphMapExtrusionOutlines;
  let oldSurface: ReturnType<typeof create>;
  let latestPolygons: readonly Polygon[] = [], latestGeometries: readonly GlyphMapExtrusionGeometry[] = [];
  let polygons = 0, checks = 0, braille = 0;
  vi.spyOn(outline, "createGlyphMapExtrusionSurface").mockImplementation((...args) => {
    oldSurface = reference.createGlyphMapExtrusionSurface(...args);
    latestPolygons = args[1];
    polygons = Math.max(polygons, args[1].length);
    return create(...args);
  });
  vi.spyOn(outline, "stampGlyphMapExtrusionOutlines").mockImplementation((grid, geometries, surface, ...rest) => {
    latestGeometries = geometries;
    const expected = { ...grid, char: [...grid.char], color: [...grid.color], depth: grid.depth.slice() };
    reference.stampGlyphMapExtrusionOutlines(expected, geometries, oldSurface, ...rest);
    stamp(grid, geometries, surface, ...rest);
    expect(grid.char).toEqual(expected.char);
    expect(grid.color).toEqual(expected.color);
    expect(grid.depth).toEqual(expected.depth);
    braille += grid.char.filter(c => /[\u2801-\u28ff]/u.test(c)).length;
    checks++;
  });
  const { map } = await mount();
  for (let i = 0; i < 15; i++) {
    map.setView({ center: [center[0] + i * 0.0003, center[1]] }); map.scene.rerender();
  }
  map.setTilt(50); await map.idle(); map.scene.rerender();
  map.setView({ span: 0.004 }); await map.idle(); map.scene.rerender();
  const features = glyphMapDecodeMVT(readFileSync(path.join(root, "osm_13_2767_4936.pbf")), 13, 2767, 4936).building!;
  map.setLayerSource("omt-buildings", { features: features.slice(0, 3) }); await map.idle(); map.scene.rerender();
  expect(latestPolygons).toEqual(latestGeometries.flatMap(g => [...g.polygons]));
  expect(polygons).toBeGreaterThan(10_000);
  expect(checks).toBeGreaterThanOrEqual(17);
  expect(braille).toBeGreaterThan(100);
});

it.skipIf(!process.env.GLYPH_MAP_OUTLINE_BENCH)("benchmarks packet-11 and optimized 15-frame BA pans without a browser", async () => {
  const create = outline.createGlyphMapExtrusionSurface, stamp = outline.stampGlyphMapExtrusionOutlines;
  let old = false, outlineMs = 0, surfaceMs = 0, stampMs = 0, polygons = 0, geometries = 0;
  vi.spyOn(outline, "createGlyphMapExtrusionSurface").mockImplementation((...args) => {
    const start = performance.now();
    polygons = Math.max(polygons, args[1].length);
    const result = (old ? reference.createGlyphMapExtrusionSurface : create)(...args);
    const elapsed = performance.now() - start; outlineMs += elapsed; surfaceMs += elapsed;
    return result;
  });
  vi.spyOn(outline, "stampGlyphMapExtrusionOutlines").mockImplementation((...args) => {
    const start = performance.now();
    geometries = Math.max(geometries, args[1].length);
    (old ? reference.stampGlyphMapExtrusionOutlines : stamp)(...args);
    const elapsed = performance.now() - start; outlineMs += elapsed; stampMs += elapsed;
  });
  const { map } = await mount();
  const profile = new Session(); profile.connect();
  const post = (method: string, params = {}) => new Promise<any>((resolve, reject) => profile.post(method, params, (err, result) => err ? reject(err) : resolve(result)));
  const results = [];
  for (const rendersPerPan of process.env.GLYPH_MAP_OUTLINE_SINGLE_PAN ? [2, 1] : [2]) for (const baseline of [true, false]) {
    old = baseline;
    for (let i = 0; i < 3; i++) { map.setView({ center }); map.scene.rerender(); }
    const frames: number[] = [], outlines: number[] = [], surfaces: number[] = [], stamps: number[] = [];
    for (let i = 0; i < 15; i++) {
      outlineMs = 0; surfaceMs = 0; stampMs = 0; const start = performance.now();
      map.setView({ center: [center[0] + i * 0.0003, center[1]] });
      if (rendersPerPan === 2) map.scene.rerender();
      frames.push(performance.now() - start); outlines.push(outlineMs); surfaces.push(surfaceMs); stamps.push(stampMs);
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    results.push({ path: baseline ? "packet-11" : "optimized", rendersPerPan, msPerPan: mean(frames), outlineMs: mean(outlines), surfaceMs: mean(surfaces), stampMs: mean(stamps), outlinePercent: 100 * mean(outlines) / mean(frames), frames });
  }
  await post("Profiler.enable"); await post("Profiler.setSamplingInterval", { interval: 100 }); await post("Profiler.start");
  for (let i = 0; i < 15; i++) { map.setView({ center: [center[0] + i * 0.0003, center[1]] }); map.scene.rerender(); }
  const { profile: cpu } = await post("Profiler.stop");
  writeFileSync(process.env.GLYPH_MAP_OUTLINE_PROFILE ?? "/tmp/glyph-map-outline.cpuprofile", JSON.stringify(cpu));
  profile.disconnect();
  const report = { grid: [map.getView().cols, map.getView().rows], tileZoom: 13, polygons, geometries, results };
  if (process.env.GLYPH_MAP_OUTLINE_REPORT) writeFileSync(process.env.GLYPH_MAP_OUTLINE_REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
// The optional single-render comparison doubles the CPU-heavy benchmark work.
}, 60_000);
