import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createGlyphMap, type GlyphMapHandle } from "./widget";
import { glyphMapGlobe } from "./projection";
import { glyphMapCuratedProvider } from "./curated";
import * as tile from "./tile";
import * as mesh from "./mesh";
import * as stroke from "./stroke";
import type { GlyphMapProvider, GlyphMapProviderZoomLevel } from "./provider";
import { glyphMapOpenFreeMapProvider } from "./vector/openfreemap";
import { glyphMapOpenMapTilesLayers } from "./vector/openmaptiles";

// Isolate the supplied tiles' ground/depth math. Native layout and the page's
// React mount lifecycle remain outside this probe; it does not reproduce the
// reported east-half loss and must not stand in for that acceptance gate.
const root = path.resolve(__dirname, "../fixtures/road-relief/ba");
const COLS = 139, ROWS = 77;
type DepthProbe = { col: number; row: number; strokeDepth: number; reconstructedDepth: number; allowance: number; curvature: number; residual: number };
const center: [number, number] = [-58.387044, -34.594994];
const hosts: HTMLElement[] = [], maps: GlyphMapHandle[] = [];
afterEach(() => {
  maps.splice(0).forEach(map => map.destroy());
  hosts.splice(0).forEach(host => host.remove());
  vi.restoreAllMocks();
});

function terrainFixture() {
  const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")) as {
    zooms: GlyphMapProviderZoomLevel[]; source: string; sampler: string;
    curated: { zoom: GlyphMapProviderZoomLevel; tiles: string[] }[];
  };
  const loaded = new Map<string, tile.GlyphMapGeoTile>();
  const bounds = (level: GlyphMapProviderZoomLevel, x: number, y: number) => {
    const west = -180 + x * level.tileLonSpan, north = 90 - y * level.tileLatSpan;
    return { west, east: west + level.tileLonSpan, north, south: north - level.tileLatSpan };
  };
  const decode = (file: string, level: GlyphMapProviderZoomLevel, x: number, y: number) => {
    const decoded = tile.glyphMapDecodeGeoTileInt16(readFileSync(path.join(root, file)), {
      bounds: bounds(level, x, y), cols: level.tileCols, rows: level.tileRows,
      source: manifest.source, sampler: manifest.sampler,
    });
    loaded.set(file, decoded);
    return decoded;
  };
  const base: GlyphMapProvider = { id: "geo-tiles", zooms: manifest.zooms,
    bounds(z, x, y) { return bounds(manifest.zooms.find(level => level.z === z)!, x, y); },
    async loadTile(z, x, y) { return decode(`${z}_${x}_${y}.bin`, manifest.zooms.find(level => level.z === z)!, x, y); },
  };
  const provider = glyphMapCuratedProvider(base, manifest.curated.map(entry => ({
    zoom: entry.zoom, tiles: new Set(entry.tiles),
    async loadTile(x, y) { return decode(`curated_${entry.zoom.z}_${x}_${y}.bin`, entry.zoom, x, y); },
  })));
  return { provider, loaded };
}

// These are logical DOM probes, not a reproduction of Chromium's layout.
// The second metric uses the shipped Glyph Mono's 1200/2048 advance at 12px.
for (const [cellW, cellH] of [[12, 14], [12 * 1200 / 2048, 12]]) {
  for (const strategy of ["box", "braille"] as const) {
    it(`records no terrain depth rejection for supplied BA ${strategy} roads (${cellW}×${cellH})`, async () => {
      const host = document.createElement("div"); document.body.append(host); hosts.push(host);
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const e = this as HTMLElement, k = (parseFloat(e.style.fontSize) || 16) / 16;
        const probe = e.tagName === "PRE" && e.style.visibility === "hidden";
        const width = e === host ? COLS * cellW : probe ? cellW * k : 0;
        const height = e === host ? ROWS * cellH : probe ? cellH * k * (e.textContent ?? "").split("\n").length : 0;
        return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) };
      });
      const terrain = terrainFixture();
      const drawn: { tile: tile.GlyphMapGeoTile; options: mesh.GlyphMapPolygonsOptions | undefined }[] = [];
      const realPolygons = mesh.glyphMapPolygons;
      vi.spyOn(mesh, "glyphMapPolygons").mockImplementation((t, p, options) => {
        drawn.push({ tile: t, options });
        return realPolygons(t, p, options);
      });
      const osmLoaded = new Set<string>();
      const source = glyphMapOpenFreeMapProvider({ fetchTile: async (_url, z, x, y) => {
        const file = `osm_${z}_${x}_${y}.pbf`; osmLoaded.add(file);
        const bytes = readFileSync(path.join(root, file));
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      } });
      const layers = glyphMapOpenMapTilesLayers(source, {
        include: ["omt-water", "omt-waterways", "omt-roads", "omt-boundaries"], roadHierarchy: true,
        lineOptions: {
          "omt-roads": { color: "#506981", experimentalGlyphStrategy: strategy, simplify: "vw" },
          "omt-waterways": { experimentalGlyphStrategy: strategy, simplify: "vw" },
          "omt-boundaries": { experimentalGlyphStrategy: strategy, simplify: "vw", sharedArcs: true },
        },
      });
      let capture = false;
      let surface: Parameters<typeof stroke.stampGlyphMapPolyline>[0] | null = null;
      const reads = new Set<tile.GlyphMapGeoTile>();
      const realElevation = tile.glyphMapGeoTileElevationAt;
      vi.spyOn(tile, "glyphMapGeoTileElevationAt").mockImplementation((t, lon, lat, window) => {
        const value = realElevation(t, lon, lat, window);
        if (capture && Number.isFinite(value)) reads.add(t);
        return value;
      });
      const rejected: object[] = [];
      let samples = 0;
      const diagnostics: { worst: DepthProbe | null } = { worst: null };
      const realStamp = stroke.stampGlyphMapPolyline;
      vi.spyOn(stroke, "stampGlyphMapPolyline").mockImplementation((g, vertices, opts) => {
        if (capture) surface ??= { ...g, depth: g.depth.slice() };
        if (capture && opts?.color === "#506981") {
          // Test the relief independently of earlier roads' depth writes.
          for (let s = 1; s < vertices.length; s++) {
            const a = vertices[s - 1], b = vertices[s];
            const dx = b.col - a.col, dy = b.row - a.row;
            const steps = Math.max(1, Math.ceil(strategy === "braille" ? Math.hypot(dx * 2, dy * 4) : Math.hypot(dx, dy)));
            for (let i = 0; i <= steps; i++) {
              const t = i / steps, col = a.col + dx * t, row = a.row + dy * t;
              const x = Math.floor(col), y = Math.floor(row);
              if (!Number.isFinite(col) || !Number.isFinite(row) || x < 0 || x >= g.cols || y < 0 || y >= g.rows) continue;
              const depth = a.depth + (b.depth - a.depth) * t;
              const allowance = (opts.depthBias ?? 0) + (a.slack ?? 0) + ((b.slack ?? 0) - (a.slack ?? 0)) * t;
              samples++;
              const d = surface!.depth, idx = y * g.cols + x, base = d[idx];
              const left = x > 0 ? d[idx - 1] : NaN, right = x < g.cols - 1 ? d[idx + 1] : NaN;
              const up = y > 0 ? d[idx - g.cols] : NaN, down = y < g.rows - 1 ? d[idx + g.cols] : NaN;
              const slope = (back: number, forward: number) => Number.isFinite(forward) ? forward - base : Number.isFinite(back) ? base - back : 0;
              const bend = (back: number, forward: number) => Number.isFinite(back) && Number.isFinite(forward) ? Math.abs(base * 2 - back - forward) : 0;
              const reconstructedDepth = base + slope(left, right) * (col - x) + slope(up, down) * (row - y);
              const curvatureScale = opts.depthCurvatureScale ?? stroke.GLYPH_MAP_STROKE_DEPTH_CURVATURE_SCALE;
              const curvature = curvatureScale * Math.hypot(bend(left, right), bend(up, down));
              const residual = reconstructedDepth - depth - allowance - curvature;
              if (diagnostics.worst === null || residual > diagnostics.worst.residual) diagnostics.worst = { col, row, strokeDepth: depth, reconstructedDepth, allowance, curvature, residual };
              if (stroke.glyphMapSurfaceOccludes(surface!, x, y, col - x, row - y, depth, allowance, curvatureScale)) {
                rejected.push({ x, y, subCol: col - x, subRow: row - y, strokeDepth: depth,
                  rasterDepth: base, reconstructedDepth, allowance, curvature, residual });
              }
            }
          }
        }
        realStamp(g, vertices, opts);
      });
      const map = createGlyphMap(host, {
        view: { center, span: 0.0474537370209488, cols: COLS, rows: ROWS },
        projection: glyphMapGlobe({ exaggeration: 24 }), tilt: 0, snapPan: true,
        layers: [{ id: "terrain", type: "raster", source: terrain.provider }, ...layers],
      });
      maps.push(map); await map.idle();
      capture = true; map.scene.rerender(); capture = false;
      const z5 = terrain.loaded.get("curated_5_10_22.bin")!;
      if (process.env.GLYPH_MAP_BA_DEPTH_REPORT) {
        // The inverse reads the mounted terrain; it locates the ground quad
        // near this stroke sample, not an independent source measurement.
        const sample = diagnostics.worst;
        if (sample === null) throw new Error("No on-screen road sample to report");
        const datumLonLat = map.unproject([sample.col, sample.row])!;
        const c = Math.floor((datumLonLat[0] - z5.bounds.west) / (z5.bounds.east - z5.bounds.west) * z5.cols);
        const r = Math.floor((z5.bounds.north - datumLonLat[1]) / (z5.bounds.north - z5.bounds.south) * z5.rows);
        const nw = r * (z5.cols + 1) + c;
        console.log(JSON.stringify({ strategy, cellW, cellH, samples, rejected, worst: sample, datumLonLat,
          groundSource: "etopo1:curated/5/10_22", reliefSource: "etopo1:curated/5/10_22",
          quad: { c, r, nw: z5.elevation[nw], ne: z5.elevation[nw + 1],
            sw: z5.elevation[nw + z5.cols + 1], se: z5.elevation[nw + z5.cols + 2] } }));
      }
      expect([...terrain.loaded.keys()].sort()).toEqual(["0_0_0.bin", "curated_5_10_22.bin"]);
      expect(osmLoaded.size).toBe(6);
      expect(reads.size).toBe(1);
      expect(reads.has(z5)).toBe(true);
      expect(drawn.some(d => d.tile === z5 && d.options?.elevationBias === 0 && d.options.resolution === undefined)).toBe(true);
      expect(samples).toBeGreaterThan(10_000);
      expect(rejected.length, JSON.stringify(rejected.slice(0, 3))).toBe(0);
    });
  }
}

it("keeps near-ground BA roads visible at the evidence-2 ground pivot", async () => {
  const host = document.createElement("div"); document.body.append(host); hosts.push(host);
  const cellW = 12 * 1200 / 2048, cellH = 12;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const e = this as HTMLElement, k = (parseFloat(e.style.fontSize) || 16) / 16;
    const probe = e.tagName === "PRE" && e.style.visibility === "hidden";
    const width = e === host ? COLS * cellW : probe ? cellW * k : 0;
    const height = e === host ? ROWS * cellH : probe ? cellH * k * (e.textContent ?? "").split("\n").length : 0;
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) };
  });
  const terrain = terrainFixture();
  const source = glyphMapOpenFreeMapProvider({ fetchTile: async (_url, z, x, y) => {
    const bytes = readFileSync(path.join(root, `osm_${z}_${x}_${y}.pbf`));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  } });
  // The vendored extract contains z13, so keep that real geometry at deep
  // zoom rather than silently fetching an unvendored z14 tile.
  const roads = { ...source, zooms: source.zooms.filter(level => level.z <= 13) };
  const projection = glyphMapGlobe({ exaggeration: 24 });
  const viewCenter = [-58.378402, -34.600165] as const;
  const map = createGlyphMap(host, {
    view: { center: viewCenter, span: 0.0017999435062305911, cols: COLS, rows: ROWS },
    projection, tilt: 67, bearing: 37, snapPan: true,
    layers: [{ id: "terrain", type: "raster", source: terrain.provider },
      ...glyphMapOpenMapTilesLayers(roads, { include: ["omt-roads"], roadHierarchy: true,
        lineOptions: { "omt-roads": { experimentalGlyphStrategy: "braille", simplify: "vw" } } })],
  });
  maps.push(map);
  await map.idle();
  const count = () => [...(map.scene.output.textContent ?? "").split("\n").slice(Math.floor(ROWS * 2 / 3)).join("")]
    .filter(ch => ch >= "⠀" && ch <= "⣿").length;
  const ground = count(), target = map.scene.camera.target;
  const elev = tile.glyphMapGeoTileElevationAt(terrain.loaded.get("curated_5_10_22.bin")!, ...viewCenter);
  expect(target).toEqual(projection.project(...viewCenter, elev));
  map.scene.camera.target = projection.project(...viewCenter, 0);
  map.scene.rerender();
  const datum = count();
  map.scene.camera.target = target;
  map.scene.rerender();
  if (process.env.GLYPH_MAP_BA_DEPTH_REPORT) console.log(JSON.stringify({ ground, datum, elev }));
  expect(ground).toBeGreaterThan(50);
  // This z13 extract does not reproduce the page's original near-half loss:
  // the old pivot still sees roads elsewhere. Do not claim otherwise.
  expect(datum).toBeGreaterThan(50);
  expect(map.project(viewCenter).row).toBeCloseTo(ROWS / 2, 6);
});
