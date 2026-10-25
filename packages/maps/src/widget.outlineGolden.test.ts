import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Session } from "node:inspector";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { CellGrid } from "glyphcss";
import { GLYPH_FONT_ATLAS, isGlyphInFontAtlas, isQuantizableColor, encodeCellGridOutput,
  encodeCellGrid, encodeCellGridAtlas, createGlyphAtlasPaletteQuantizer } from "glyphcss";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import { glyphMapDecodeGeoTileInt16 } from "./tile";
import { glyphMapOpenFreeMapProvider } from "./vector/openfreemap";
import { glyphMapOpenMapTilesLayers } from "./vector/openmaptiles";
import { glyphMapDecodeMVT } from "./vector/pmtiles";
import { glyphMapMercatorTileBounds } from "./vector/mercator";
import * as outline from "./extrusionOutline";
import * as topologyReference from "./test/extrusionTopology28Reference";
import * as stroke from "./stroke";
import { expectConservativeTree } from "./test/conservativeTree";
import { glyphMapVectorMesh } from "./layers";
import type { GlyphMapExtrusionGeometry } from "./layers";

const root = path.resolve(__dirname, "../fixtures/road-relief/ba");
const golden = path.resolve(__dirname, "test/outlineGolden26.json");
const center = [-58.387044, -34.594994] as const;
const cols = 156, rows = 77, cellWidth = 12 * 1200 / 2048, cellHeight = 12;
const maps: ReturnType<typeof createGlyphMap>[] = [];
afterEach(() => { maps.splice(0).forEach(m => m.destroy()); vi.restoreAllMocks(); document.body.innerHTML = ""; });

const hash = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
// Hash IEEE bytes, not JSON numbers: Infinity, NaN and signed zero must survive.
function fingerprint(g: CellGrid, kind: string) {
  return { kind, cols: g.cols, rows: g.rows,
    char: hash(JSON.stringify(g.char)), color: hash(JSON.stringify(g.color)),
    depth: hash(new Uint8Array(g.depth.buffer, g.depth.byteOffset, g.depth.byteLength)),
    occluded: g.occluded ? hash(g.occluded) : null };
}

async function mount(walk: boolean, venice = false) {
  const fixtureRoot = venice ? path.resolve(__dirname, "../fixtures/openfreemap/venice") : root;
  const host = document.createElement("div"); document.body.append(host);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function(this: Element) {
    const e = this as HTMLElement, k = (parseFloat(e.style.fontSize) || 16) / 16;
    const probe = e.tagName === "PRE" && e.style.visibility === "hidden";
    const width = e === host ? cols * cellWidth : probe ? cellWidth * k : 0;
    const height = e === host ? rows * cellHeight : probe ? cellHeight * k * (e.textContent ?? "").split("\n").length : 0;
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) };
  });
  let tiles = 0;
  const source = glyphMapOpenFreeMapProvider({ maxZoom: venice ? 12 : 13, fetchTile: async (_url, z, x, y) => {
    const file = path.join(fixtureRoot, `${venice ? "" : "osm_"}${z}_${x}_${y}.pbf`);
    if (!existsSync(file)) return new ArrayBuffer(0);
    tiles++;
    const bytes = readFileSync(file);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }});
  if (venice) {
    const z = 12, x = 2188, y = 1466;
    const bounds = glyphMapMercatorTileBounds(z, x, y);
    const tile = { z, x, y, bounds, source: "fixture", simplify: "mvt-source",
      layers: glyphMapDecodeMVT(readFileSync(path.join(fixtureRoot, "12_2188_1466.pbf")), z, x, y) };
    expect(tile.layers.water.length).toBeGreaterThan(0);
    expect(tile.layers.transportation.length).toBeGreaterThan(0);
    Object.assign(source, { zooms: source.zooms.filter(level => level.z === z),
      tileRange: () => ({ x0: x, x1: x, y0: y, y1: y }),
      loadTile: async () => { tiles++; return tile; } });
  }
  const terrain = glyphMapDecodeGeoTileInt16(readFileSync(path.join(fixtureRoot, venice ? "terrain-4-8-3.bin" : "curated_5_10_22.bin")), {
    bounds: venice ? { west: 0, east: 22.5, south: 45, north: 56.25 } : { west: -67.5, east: -56.25, north: -33.75, south: -39.375 },
    cols: 180, rows: 90, source: "etopo1", sampler: "nearest",
  });
  const layers = glyphMapOpenMapTilesLayers(source, {
    include: ["omt-water", "omt-roads", "omt-buildings"], roadHierarchy: true, waterTerrain: true,
    densities: walk ? { "omt-buildings": 1.7 } : undefined,
    lineOptions: { "omt-roads": { experimentalGlyphStrategy: "braille", simplify: "vw", color: "#506981" } },
  }).map(l => l.type === "fill-extrusion" ? { ...l, outline: "braille" as const } : l);
  const map = createGlyphMap(host, { view: { center: venice ? [12.3376, 45.4394] : center, span: venice ? 0.12 : 0.012, cols, rows },
    projection: glyphMapGlobe({ exaggeration: 24 }),
    layers: [{ type: "raster", id: "terrain", source: terrain }, ...layers] });
  maps.push(map); await map.idle();
  if (walk) { map.setWalk({}); await map.idle(); }
  expect(tiles).toBeGreaterThan(0);
  return { map, host };
}

// One synchronous changed-view render per frame, including the walk look sequence.
function frame(map: ReturnType<typeof createGlyphMap>, walk: boolean, i: number) {
  if (walk) map.setBearing(15 + i * 7);
  else map.setView({ center: [center[0] + i * 0.0003, center[1]] });
}

it("matches HEAD e5f7d714 in EVERY grid and field over BA pan and walk look frames", async () => {
  const actual: Record<string, ReturnType<typeof fingerprint>[][]> = {};
  let polygons = 0, braille = 0, occluded = 0;
  const create = outline.createGlyphMapExtrusionSurface;
  vi.spyOn(outline, "createGlyphMapExtrusionSurface").mockImplementation((...args) => {
    polygons = Math.max(polygons, args[1].length); return create(...args);
  });
  for (const walk of [false, true]) {
    const { map, host } = await mount(walk);
    const hook = map.scene.getOptions().transformCells!;
    let capture: ReturnType<typeof fingerprint>[] | undefined;
    map.scene.setOptions({ transformCells: (g, layer) => {
      const out = hook(g, layer) ?? g;
      if (capture) {
        capture.push(fingerprint(out, layer?.viewport ? "viewport" : layer?.detail ? "detail" : "base"));
        braille += out.char.filter(c => /[\u2801-\u28ff]/u.test(c)).length;
        occluded += out.occluded?.reduce((a, b) => a + b, 0) ?? 0;
      }
      return out;
    }});
    const frames: ReturnType<typeof fingerprint>[][] = [];
    actual[walk ? "walk" : "pan"] = frames;
    for (let i = 0; i < 12; i++) {
      capture = []; frame(map, walk, i); frames.push(capture);
      expect(capture.filter(g => g.kind === "base")).toHaveLength(1);
      expect(capture).toHaveLength(host.querySelectorAll("pre.glyph-output").length);
      if (walk) expect(capture.some(g => g.kind === "detail")).toBe(true);
      capture = undefined;
    }
    map.destroy(); maps.splice(maps.indexOf(map), 1); host.remove();
  }
  expect(polygons).toBeGreaterThan(10_000);
  expect(braille).toBeGreaterThan(100);
  expect(occluded).toBeGreaterThan(0);
  if (process.env.UPDATE_GLYPH_OUTLINE_GOLDEN) writeFileSync(golden, JSON.stringify(actual, null, 2) + "\n");
  expect(actual).toEqual(JSON.parse(readFileSync(golden, "utf8")));
}, 60_000);

type Mode = "pan" | "bearing" | "walk" | "venice";
const modes: Mode[] = ["pan", "bearing", "walk", "venice"];
function packet28Frame(map: ReturnType<typeof createGlyphMap>, mode: Mode, i: number) {
  if (mode === "bearing" || mode === "walk") map.setBearing(15 + i * 7);
  else if (mode === "venice") map.setView({ center: [12.3376 + i * 0.002, 45.4394] });
  else frame(map, false, i);
}

async function packet28Grids(cull: boolean) {
  const actual: Record<string, ReturnType<typeof fingerprint>[][]> = {};
  let compilations = 0;
  const compile = outline.createGlyphMapExtrusionTopology;
  vi.spyOn(outline, "createGlyphMapExtrusionTopology").mockImplementation((...args) => {
    compilations++;
    const topology = compile(...args);
    // One leaf over every face: the tree can then drop nothing at all.
    if (!cull) topology.root = { corners: topology.root.corners, faces: Int32Array.from(topology.polygons, (_, i) => i) };
    return topology;
  });
  for (const mode of modes) {
    const { map, host } = await mount(mode === "walk", mode === "venice");
    if (mode === "bearing") { map.setTilt(50); await map.idle(); }
    const hook = map.scene.getOptions().transformCells!;
    let capture: ReturnType<typeof fingerprint>[] | undefined;
    map.scene.setOptions({ transformCells: (g, layer) => {
      const out = hook(g, layer) ?? g;
      capture?.push(fingerprint(out, layer?.viewport ? "viewport" : layer?.detail ? "detail" : "base"));
      return out;
    }});
    const frames = actual[mode] = [] as ReturnType<typeof fingerprint>[][];
    for (let i = 0; i < 24; i++) {
      if (i === 12 && mode !== "venice") {
        const before = compilations;
        const file = path.resolve(root, "osm_13_2767_4936.pbf");
        const features = glyphMapDecodeMVT(readFileSync(file), 13, 2767, 4936).building!;
        expect(features.length).toBeGreaterThan(0);
        map.setLayerSource("omt-buildings", { features: features.slice(0, 100) }); await map.idle();
        expect(compilations).toBeGreaterThan(before);
      }
      capture = []; packet28Frame(map, mode, i); frames.push(capture);
      expect(capture.filter(g => g.kind === "base")).toHaveLength(1);
      expect(capture).toHaveLength(host.querySelectorAll("pre.glyph-output").length);
      capture = undefined;
    }
    map.destroy(); maps.splice(maps.indexOf(map), 1); host.remove();
  }
  return actual;
}


it("retains d9a9c976 grids through extended pan, bearing, walk, Venice and mid-sequence building rebuild", async () => {
  const actual = await packet28Grids(true);
  const file = path.resolve(__dirname, "test/outlineGolden28.json");
  if (process.env.CAPTURE_PACKET28) writeFileSync(file, JSON.stringify(actual, null, 2) + "\n");
  expect(actual).toEqual(JSON.parse(readFileSync(file, "utf8")));
}, 120_000);

// The culling tree may take any conservative shape only because a face it
// drops cannot change a drawn byte. A tree that drops nothing must agree.
it("draws the same grids when the culling tree drops no face at all", async () => {
  expect(await packet28Grids(false)).toEqual(JSON.parse(readFileSync(path.resolve(__dirname, "test/outlineGolden28.json"), "utf8")));
}, 120_000);

// The supplied Venice tile has no buildings. Its real water rings still
// exercise large, irregular topology; no synthetic buildings enter the golden.
function veniceTopologyInput(): Parameters<typeof outline.createGlyphMapExtrusionTopology> {
  const features = glyphMapDecodeMVT(readFileSync(path.resolve(__dirname, "../fixtures/openfreemap/venice/12_2188_1466.pbf")), 12, 2188, 1466).water!;
  const geometries: GlyphMapExtrusionGeometry[] = [];
  const mesh = glyphMapVectorMesh(features, glyphMapGlobe({ exaggeration: 24 }), { height: () => 10, onExtrusion: g => geometries.push(g) });
  expect(mesh.polygons.length).toBeGreaterThan(100);
  return [mesh.polygons, geometries];
}

it("deep-compares every compiled topology field with the frozen d9a9c976 compiler on BA and Venice", async () => {
  const compile = outline.createGlyphMapExtrusionTopology;
  const data = (t: ReturnType<typeof compile>) => {
    const { vertexId, incidentFaces, prepare, root, ...fields } = t;
    return fields;
  };
  let checks = 0;
  const check = (actual: ReturnType<typeof compile>, args: Parameters<typeof compile>) => {
    const expected = topologyReference.createGlyphMapExtrusionTopology(...args);
    expect(data(actual)).toEqual(data(expected));
    expectConservativeTree(actual);
    for (const v of actual.vertices) expect(actual.vertexId(v)).toBe(expected.vertexId(v));
    for (let i = 0; i < actual.edgeVertices.length; i += 2) {
      const a = actual.vertices[actual.edgeVertices[i]]!, b = actual.vertices[actual.edgeVertices[i + 1]]!;
      expect([...actual.incidentFaces(a, b)]).toEqual([...expected.incidentFaces(a, b)]);
    }
    checks++;
  };
  vi.spyOn(outline, "createGlyphMapExtrusionTopology").mockImplementation((...args) => {
    const actual = compile(...args);
    check(actual, args);
    return actual;
  });
  // A tile landing compiles the topology ahead of its install, a slice at a time: that compile is held to the same reference.
  const compileSteps = outline.compileGlyphMapExtrusionTopology;
  vi.spyOn(outline, "compileGlyphMapExtrusionTopology").mockImplementation(function* (...args) {
    const actual = yield* compileSteps(...args);
    check(actual, args);
    return actual;
  });
  for (const venice of [false, true]) {
    if (venice) { outline.createGlyphMapExtrusionTopology(...veniceTopologyInput()); continue; }
    const { map, host } = await mount(false, venice);
    map.destroy(); maps.splice(maps.indexOf(map), 1); host.remove();
  }
  expect(checks).toBeGreaterThanOrEqual(2);
}, 120_000);

it.skipIf(!process.env.GLYPH_OUTLINE_BENCH)("measures packet-28 single-render sequences and isolated topology compile", async () => {
  const profiler = process.env.GLYPH_OUTLINE_PROFILE ? new Session() : undefined;
  profiler?.connect();
  const post = (method: string) => new Promise<any>((resolve, reject) => profiler!.post(method, (err, result) => err ? reject(err) : resolve(result)));
  let surfaceMs = 0, stampMs = 0, roadMs = 0;
  const create = outline.createGlyphMapExtrusionSurface, stamp = outline.stampGlyphMapExtrusionOutlines;
  let latest: Parameters<typeof outline.createGlyphMapExtrusionTopology> | undefined;
  const compile = outline.createGlyphMapExtrusionTopology, polyline = stroke.stampGlyphMapPolyline;
  vi.spyOn(outline, "createGlyphMapExtrusionTopology").mockImplementation((...args) => { latest = args; return compile(...args); });
  vi.spyOn(stroke, "stampGlyphMapPolyline").mockImplementation((...args) => {
    if (args[2]?.occludes) return polyline(...args);
    const start = performance.now(); polyline(...args); roadMs += performance.now() - start;
  });
  vi.spyOn(outline, "createGlyphMapExtrusionSurface").mockImplementation((...args) => {
    const start = performance.now(); const out = create(...args); surfaceMs += performance.now() - start; return out;
  });
  vi.spyOn(outline, "stampGlyphMapExtrusionOutlines").mockImplementation((...args) => {
    const start = performance.now(); stamp(...args); stampMs += performance.now() - start;
  });
  const results = [], topology = [];
  for (const mode of modes) {
    const { map, host } = await mount(mode === "walk", mode === "venice");
    if (mode === "bearing") { map.setTilt(50); await map.idle(); }
    const input = mode === "venice" ? veniceTopologyInput() : latest!;
    if (process.env.GLYPH_TOPOLOGY_PROFILE && mode === "pan") {
      const session = new Session(); session.connect();
      const call = (method: string) => new Promise<any>((resolve, reject) => session.post(method, (err, result) => err ? reject(err) : resolve(result)));
      await call("Profiler.enable"); await call("Profiler.start");
      for (let i = 0; i < 30; i++) compile(...input);
      const { profile } = await call("Profiler.stop"); session.disconnect();
      writeFileSync(process.env.GLYPH_TOPOLOGY_PROFILE, JSON.stringify(profile));
    }
    // Same exact compiler/input for pilot and measured rounds; alternate order.
    for (let round = -2; round < 5; round++) {
      let before = 0, after = 0;
      const run = (old: boolean) => {
        const start = performance.now();
        const out = (old ? topologyReference.createGlyphMapExtrusionTopology : compile)(...input);
        expect(out.polygons.length).toBeGreaterThan(0);
        const ms = performance.now() - start;
        if (old) before = ms; else after = ms;
      };
      if (round % 2) { run(true); run(false); } else { run(false); run(true); }
      if (round >= 0) topology.push({ mode, round, faces: input[0].length, geometries: input[1]?.length, before, after });
    }
    for (let i = 0; i < 12; i++) packet28Frame(map, mode, i);
    if (profiler) { await post("Profiler.enable"); await post("Profiler.start"); }
    for (let round = 0; round < 3; round++) {
      const frames: { total: number; surface: number; stamp: number; road: number }[] = [];
      for (let i = 0; i < 12; i++) {
        surfaceMs = 0; stampMs = 0; roadMs = 0;
        const start = performance.now(); packet28Frame(map, mode, i);
        frames.push({ total: performance.now() - start, surface: surfaceMs, stamp: stampMs, road: roadMs });
      }
      const mean = (key: keyof typeof frames[number]) => frames.reduce((sum, f) => sum + f[key], 0) / frames.length;
      results.push({ mode, round, total: mean("total"), surface: mean("surface"), stamp: mean("stamp"), road: mean("road"), frames });
    }
    if (profiler) {
      const { profile } = await post("Profiler.stop");
      writeFileSync(process.env.GLYPH_OUTLINE_PROFILE! + "." + mode + ".cpuprofile", JSON.stringify(profile));
    }
    map.destroy(); maps.splice(maps.indexOf(map), 1); host.remove();
  }
  profiler?.disconnect();
  writeFileSync(process.env.GLYPH_OUTLINE_BENCH!, JSON.stringify({ grid: [cols, rows], rendersPerFrame: 1, results, topology }, null, 2) + "\n");
  console.log(JSON.stringify(results.map(({ frames, ...r }) => r)));
}, 180_000);

// Captured on packet 26 before changing ground reads; lagoon water exercises
// the still-water first-hit branch that the BA street view cannot establish.
it("retains packet-26 Venice water/road grids through pan and authority removal", async () => {
  const { map } = await mount(false, true);
  const hook = map.scene.getOptions().transformCells!;
  const frames: ReturnType<typeof fingerprint>[][] = [];
  let capture: ReturnType<typeof fingerprint>[] = [];
  map.scene.setOptions({ transformCells: (g, layer) => {
    const out = hook(g, layer) ?? g;
    capture.push(fingerprint(out, layer?.viewport ? "viewport" : layer?.detail ? "detail" : "base"));
    return out;
  }});
  for (let i = 0; i < 4; i++) {
    capture = []; map.setView({ center: [12.3376 + i * 0.002, 45.4394] }); frames.push(capture);
  }
  map.removeLayer("omt-water"); await map.idle();
  capture = []; map.scene.rerender(); frames.push(capture);
  expect(frames.every(f => f.some(g => g.kind === "base"))).toBe(true);
  expect(frames[4]).not.toEqual(frames[3]);
  const file = path.resolve(__dirname, "test/outlineGolden26Venice.json");
  if (process.env.CAPTURE_PACKET26_VENICE) writeFileSync(file, JSON.stringify(frames, null, 2) + "\n");
  expect(frames).toEqual(JSON.parse(readFileSync(file, "utf8")));
}, 60_000);

// The map fixture defaults to spans. Measure the changed atlas path explicitly
// on its real output grids with a deterministic, identical palette clock.
it.skipIf(!process.env.GLYPH_ENCODER_BENCH)("measures atlas encoding on captured BA pan/walk grids with identical histories", async () => {
  const results = [];
  for (const walk of [false, true]) {
    const { map, host } = await mount(walk);
    const hook = map.scene.getOptions().transformCells!;
    const frames: CellGrid[][] = [];
    let capture: CellGrid[] | undefined;
    map.scene.setOptions({ transformCells: (g, layer) => {
      const out = hook(g, layer) ?? g;
      capture?.push({ cols: out.cols, rows: out.rows, char: out.char.slice(), color: out.color.slice(),
        depth: out.depth.slice(), screenX: out.screenX, screenY: out.screenY });
      return out;
    }});
    for (let i = 0; i < 12; i++) { capture = []; frame(map, walk, i); frames.push(capture); capture = undefined; }
    let clock = 0, atlasFrames = 0;
    const old = createGlyphAtlasPaletteQuantizer({ now: () => clock });
    const next = createGlyphAtlasPaletteQuantizer({ now: () => clock });
    // Packet-26 eligibility gate, followed by the unchanged standalone
    // quantizer histogram and encoder. Keep this oracle independent of the
    // new fused scan so eligibility errors cannot route around comparison.
    const oldEncode = (g: CellGrid) => {
      const n = g.cols * g.rows, validated = new Set<string>();
      let eligible = g.char.length >= n && g.color.length >= n;
      for (let i = 0; eligible && i < n; i++) {
        const glyph = g.char[i];
        if (glyph === undefined || glyph === " ") continue;
        if (!isGlyphInFontAtlas(glyph)) { eligible = false; break; }
        const c = g.color[i];
        if (c == null) { eligible = false; break; }
        if (!validated.has(c)) { if (!isQuantizableColor(c)) { eligible = false; break; } validated.add(c); }
      }
      const palette = eligible ? old.resolveGlyphAtlasPalette(g.char, g.color, n) : undefined;
      return palette?.length && palette.length <= GLYPH_FONT_ATLAS.maxPaletteSize
        ? { text: encodeCellGridAtlas(g, palette), encoding: "atlas" as const }
        : { text: encodeCellGrid(g, true), encoding: "spans" as const };
    };
    for (let round = -1; round < 3; round++) {
      let before = 0, after = 0;
      for (let i = 0; i < frames.length; i++) {
        clock += 17; old.beginTransaction(); next.beginTransaction();
        let a: ReturnType<typeof oldEncode>[] = [], b: ReturnType<typeof encodeCellGridOutput>[] = [];
        const runOld = () => { const start = performance.now(); a = frames[i].map(oldEncode); before += performance.now() - start; };
        const runNew = () => { const start = performance.now(); b = frames[i].map(g => encodeCellGridOutput(g, true, 0, "atlas", next)); after += performance.now() - start; };
        if (i % 2) { runOld(); runNew(); } else { runNew(); runOld(); }
        expect(b).toEqual(a); expect(next.palette).toEqual(old.palette); expect(next.generation).toBe(old.generation);
        expect(next.repoolDeferredMs()).toBe(old.repoolDeferredMs());
        atlasFrames += b.filter(out => out.encoding === "atlas").length;
        old.endTransaction(); next.endTransaction();
      }
      if (round >= 0) results.push({ mode: walk ? "walk" : "pan", round, before: before / frames.length, after: after / frames.length });
    }
    expect(atlasFrames).toBeGreaterThan(40);
    map.destroy(); maps.splice(maps.indexOf(map), 1); host.remove();
  }
  writeFileSync(process.env.GLYPH_ENCODER_BENCH!, JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results));
}, 60_000);
