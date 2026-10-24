import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import { glyphMapDecodeGeoTileInt16 } from "./tile";
import { glyphMapOpenFreeMapProvider } from "./vector/openfreemap";
import { glyphMapOpenMapTilesLayers } from "./vector/openmaptiles";
import * as outline from "./extrusionOutline";

const root = path.resolve(__dirname, "../fixtures/road-relief/ba");
const baseline = path.resolve(__dirname, "test/frameCachingBaseline.json");
const center = [-58.387044, -34.594994] as const;
const maps: ReturnType<typeof createGlyphMap>[] = [];
const hosts = new Set<HTMLElement>();
afterEach(() => { maps.splice(0).forEach(m => m.destroy()); hosts.clear(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

async function mount(create = createGlyphMap) {
  const host = document.createElement("div"); document.body.append(host);
  hosts.add(host);
  const cols = 156, rows = 77, cellWidth = 12 * 1200 / 2048, cellHeight = 12;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function(this: Element) {
    const e = this as HTMLElement, k = (parseFloat(e.style.fontSize) || 16) / 16;
    const probe = e.tagName === "PRE" && e.style.visibility === "hidden";
    const width = hosts.has(e) ? cols * cellWidth : probe ? cellWidth * k : 0;
    const height = hosts.has(e) ? rows * cellHeight : probe ? cellHeight * k * (e.textContent ?? "").split("\n").length : 0;
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) };
  });
  const source = glyphMapOpenFreeMapProvider({ maxZoom: 13, fetchTile: async (_url, z, x, y) => {
    const file = path.join(root, `osm_${z}_${x}_${y}.pbf`);
    if (!existsSync(file)) return new ArrayBuffer(0);
    const bytes = readFileSync(file);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }});
  const terrain = glyphMapDecodeGeoTileInt16(readFileSync(path.join(root, "curated_5_10_22.bin")), {
    bounds: { west: -67.5, east: -56.25, north: -33.75, south: -39.375 },
    cols: 180, rows: 90, source: "etopo1", sampler: "nearest",
  });
  const layers = glyphMapOpenMapTilesLayers(source, {
    include: ["omt-water", "omt-roads", "omt-buildings"], roadHierarchy: true, waterTerrain: true,
    lineOptions: { "omt-roads": { experimentalGlyphStrategy: "braille", simplify: "vw", color: "#506981" } },
  }).map(l => l.type === "fill-extrusion" ? { ...l, outline: "braille" as const } : l);
  const map = create(host, { view: { center, span: 0.012, cols, rows },
    projection: glyphMapGlobe({ exaggeration: 24 }), tilt: 0,
    layers: [{ type: "raster", id: "terrain", source: terrain }, ...layers] });
  maps.push(map); await map.idle();
  return { map, host, terrain };
}

it("keeps the pre-cache BA output bytes across pan, tilt, zoom, terrain, water and exaggeration changes", async () => {
  const { map, host, terrain } = await mount();
  const hashes: Record<string, string> = {};
  const capture = (name: string) => {
    map.scene.rerender();
    const html = [...host.querySelectorAll(".glyph-output")].map(e => e.innerHTML).join("\0");
    expect(html.length).toBeGreaterThan(156 * 77);
    hashes[name] = createHash("sha256").update(html).digest("hex");
    map.scene.rerender();
    expect([...host.querySelectorAll(".glyph-output")].map(e => e.innerHTML).join("\0")).toBe(html);
  };
  capture("initial");
  for (let i = 1; i <= 3; i++) {
    map.setView({ center: [center[0] + i * 0.0003, center[1]] }); capture(`pan${i}`);
  }
  map.setTilt(40); await map.idle(); capture("tilt");
  map.setView({ span: 0.009 }); await map.idle(); capture("zoom");
  map.removeLayer("terrain");
  map.addLayer({ type: "raster", id: "terrain", source: { ...terrain, elevation: new Float32Array(terrain.elevation.length).fill(25) } }, "omt-water");
  await map.idle(); capture("terrain");
  map.removeLayer("omt-water"); await map.idle(); capture("water");
  await map.setProjection(glyphMapGlobe({ exaggeration: 8 }), { durationMs: 0 }); await map.idle(); capture("exaggeration");
  map.removeLayer("terrain");
  map.addLayer({ type: "raster", id: "terrain", source: terrain, minElevation: 50, maxElevation: 50 }, "omt-roads");
  await map.idle(); capture("window");
  if (process.env.UPDATE_GLYPH_FRAME_BASELINE) writeFileSync(baseline, JSON.stringify(hashes, null, 2) + "\n");
  expect(hashes).toEqual(JSON.parse(readFileSync(baseline, "utf8")));
}, 60_000);

it.skipIf(!process.env.GLYPH_MAP_FRAME_VARIANTS)("ablates BA frame caches in one Node process with alternating order", async () => {
  const variants: Record<string, string> = JSON.parse(readFileSync(process.env.GLYPH_MAP_FRAME_VARIANTS!, "utf8"));
  let polygons = 0;
  const createSurface = outline.createGlyphMapExtrusionSurface;
  const surfaceProbe = vi.spyOn(outline, "createGlyphMapExtrusionSurface").mockImplementation((...args) => {
    polygons = Math.max(polygons, args[1].length);
    return createSurface(...args);
  });
  const entries = [];
  for (const [name, file] of Object.entries(variants)) {
    const module = await import(/* @vite-ignore */ file);
    const { map, host } = await mount(module.createGlyphMap);
    entries.push({ name, map, host, frames: [] as number[] });
  }
  surfaceProbe.mockRestore();
  expect(polygons).toBeGreaterThan(10_000);
  // Each variant must draw the same nonempty frame before any timing claim.
  const html = entries.map(e => [...e.host.querySelectorAll(".glyph-output")].map(p => p.innerHTML).join("\0"));
  expect(html[0]!.length).toBeGreaterThan(156 * 77);
  for (const frame of html) expect(frame).toBe(html[0]);
  for (let round = 0; round < 5; round++) {
    for (const { map } of entries) for (let i = 0; i < 5; i++) map.setView({ center: [center[0] - i * 0.0003, center[1]] });
    for (let i = 0; i < 15; i++) {
      const order = (round + i) % 2 ? [...entries].reverse() : entries;
      for (const entry of order) {
        const start = performance.now();
        entry.map.setView({ center: [center[0] + i * 0.0003, center[1]] });
        entry.frames.push(performance.now() - start);
      }
    }
  }
  const results = entries.map(({ name, frames }) => ({ name, polygons, frames,
    median: [...frames].sort((a, b) => a - b)[Math.floor(frames.length / 2)], mean: frames.reduce((a, b) => a + b, 0) / frames.length }));
  writeFileSync(process.env.GLYPH_MAP_FRAME_VARIANTS_REPORT ?? "/tmp/packet24-variants.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.map(({ frames, ...result }) => result)));
}, 120_000);

it.skipIf(!process.env.GLYPH_MAP_FRAME_BENCH)("measures BA buildings and draped braille roads in Node", async () => {
  const { map } = await mount();
  const results = [];
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 5; i++) map.setView({ center: [center[0] - i * 0.0003, center[1]] });
    const frames = [];
    for (let i = 0; i < 15; i++) {
      const start = performance.now();
      map.setView({ center: [center[0] + i * 0.0003, center[1]] });
      frames.push(performance.now() - start);
    }
    results.push({ round, msPerFrame: frames.reduce((a, b) => a + b, 0) / frames.length, frames });
  }
  const report = { grid: [156, 77], tileZoom: 13, rendersPerPan: 1, results };
  writeFileSync(process.env.GLYPH_MAP_FRAME_BENCH!, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}, 60_000);
