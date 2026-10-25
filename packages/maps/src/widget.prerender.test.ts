/**
 * Compositor pre-rendering: the camera-only half of a stroke/outline render is
 * prepared ahead of the frame it is for, and the frame is then rendered AT the
 * pose it was prepared at.
 *
 * Every claim here is an IDENTITY claim — the bytes a render produces with a
 * prepared plan are the bytes it produces without — so each is checked against
 * a map that never prepared anything, never against a recorded snapshot.
 * Preparation is driven through the handle's test seam (an exact moment to
 * finish a job and to render) and the scheduler is made deterministic: slices
 * are unbounded unless a test says otherwise, and idle callbacks are a queue
 * the test flushes.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createGlyphMap, type GlyphMapLayer, type GlyphMapOptions } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";
import { glyphMapPrerenderSeam, glyphMapPrerenderTuning, type GlyphMapPrerenderSeam } from "./prerender";
import type { GlyphMapProvider } from "./provider";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapField } from "./types";
import { glyphMapBreaks } from "./classify";
import { glyphMapDecodeGeoTileInt16 } from "./tile";
import { glyphMapDecodeMVT } from "./vector/pmtiles";
import { glyphMapMercatorTileBounds } from "./vector/mercator";
import { glyphMapOpenMapTilesLayers } from "./vector/openmaptiles";
import type { GlyphMapVectorFeature, GlyphMapVectorProvider, GlyphMapVectorTile } from "./vector/types";

type Map = ReturnType<typeof createGlyphMap>;
const seam = (m: Map): GlyphMapPrerenderSeam => (m as unknown as Record<symbol, GlyphMapPrerenderSeam>)[glyphMapPrerenderSeam]!;

const maps: Map[] = [];
let queue = new globalThis.Map<number, FrameRequestCallback>(), time = 100, next = 0, stagedRenders = 0;
let idleQueue: ((deadline: { timeRemaining(): number; didTimeout: boolean }) => void)[] = [];
const tuning = { ...glyphMapPrerenderTuning };

function frame(step = 16) {
  const work = [...queue.values()]; queue.clear(); time += step;
  for (const cb of work) cb(time);
}
/** Runs queued idle callbacks (and the ones they queue) for up to `rounds` rounds. */
function flushIdle(rounds = 200) {
  for (let i = 0; i < rounds && idleQueue.length; i++) {
    const work = idleQueue; idleQueue = [];
    for (const cb of work) cb({ timeRemaining: () => 50, didTimeout: false });
  }
}
function pointer(m: Map, type: string, x: number, y = 150) {
  m.host.dispatchEvent(new PointerEvent(type, { pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true }));
}

const CENTRE: readonly [number, number] = [8.54, 47.375];
const ring = (lon: number, lat: number, half: number): [number, number][] =>
  [[lon - half, lat - half], [lon + half, lat - half], [lon + half, lat + half], [lon - half, lat + half], [lon - half, lat - half]];
const buildings: GlyphMapVectorFeature[] = [[0, 0, 0.0006], [0.0016, 0.0009, 0.0004], [-0.0015, -0.0008, 0.0005]].map(([dx, dy, h], i) => ({
  id: `b${i}`, geometryType: "polygon", rings: [ring(CENTRE[0] + dx!, CENTRE[1] + dy!, h!)], polygons: [[ring(CENTRE[0] + dx!, CENTRE[1] + dy!, h!)]],
  properties: { height: 40 + 25 * i, base: 0 },
}));
const road = (dy: number): GlyphMapVectorFeature => ({
  id: `road${dy}`, geometryType: "line",
  rings: [[[CENTRE[0] - 0.02, CENTRE[1] + dy], [CENTRE[0] - 0.004, CENTRE[1] + dy * 1.4], [CENTRE[0], CENTRE[1] + dy], [CENTRE[0] + 0.004, CENTRE[1] - dy * 1.2], [CENTRE[0] + 0.02, CENTRE[1] + dy]]],
});

/** Relief that varies in both directions, so a draped stroke carries real per-vertex elevation and slack. */
function terrain(scale = 1): GlyphMapProvider {
  const zooms = [0, 1, 2, 3, 4].map(z => ({ z, cols: 2 ** z, rows: 2 ** z, tileLonSpan: 360 / 2 ** z, tileLatSpan: 180 / 2 ** z, tileCols: 32, tileRows: 32 }));
  const bounds = (z: number, x: number, y: number) => {
    const level = zooms[z]!, west = -180 + x * level.tileLonSpan, north = 90 - y * level.tileLatSpan;
    return { west, east: west + level.tileLonSpan, south: north - level.tileLatSpan, north };
  };
  const elevation = new Float32Array(33 * 33);
  for (let j = 0; j < 33; j++) for (let i = 0; i < 33; i++) elevation[j * 33 + i] = scale * (40 + 30 * Math.sin(i / 3) + 25 * Math.cos(j / 2.5));
  return {
    id: "prerender-terrain", zooms, bounds,
    async loadTile(z, x, y): Promise<GlyphMapGeoTile> {
      return { bounds: bounds(z, x, y), cols: 32, rows: 32, elevation, source: "prerender", sampler: "nearest" };
    },
  };
}

const sceneLayers = (terrainScale = 1): GlyphMapLayer[] => [
  { type: "raster", id: "terrain", source: terrain(terrainScale) },
  { type: "fill-extrusion", id: "blocks", source: { features: buildings }, heightProperty: "height", baseOffsetProperty: "base", heightScale: 2,
    color: "#94a3b8", outline: "braille", fill: false, blank: true },
  { type: "line", id: "braille-road", color: "#e8c988", experimentalGlyphStrategy: "braille", source: { features: [road(0.0004), road(-0.0006)] } },
  { type: "line", id: "box-road", color: "#ff5533", experimentalGlyphStrategy: "box", source: { features: [road(0.0013)] } },
];

function mount(extra: Partial<GlyphMapOptions> = {}): Map {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { queue.set(++next, cb); return next; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => queue.delete(id));
  vi.stubGlobal("requestIdleCallback", (cb: (typeof idleQueue)[number]) => { idleQueue.push(cb); return idleQueue.length; });
  vi.stubGlobal("cancelIdleCallback", () => { idleQueue = []; });
  if (!vi.isMockFunction(HTMLElement.prototype.getBoundingClientRect)) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const pre = this.tagName === "PRE";
      const lines = this.textContent?.split("\n") ?? [];
      const width = pre ? Math.max(0, ...lines.map(s => s.length)) * 8 : 640;
      const height = pre ? lines.length * 16 : 320;
      return { width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON() {} };
    });
  }
  const host = document.createElement("div"); document.body.append(host);
  const m = createGlyphMap(host, {
    view: { center: [CENTRE[0], CENTRE[1]], span: 0.006, cols: 80, rows: 20 },
    projection: glyphMapEquirectangular({ exaggeration: 24 }), tilt: 40, compositorPan: true, layers: sceneLayers(),
    ...extra,
  });
  maps.push(m);
  return m;
}
async function ready(m: Map) {
  await m.idle();
  globalThis.__glyphRenderStage = stage => { if (stage === "base-validate") stagedRenders++; };
  stagedRenders = 0;
}
const element = (m: Map) => m.scene.output.parentElement!;
const text = (m: Map) => m.scene.output.innerHTML;

beforeEach(() => {
  Object.assign(glyphMapPrerenderTuning, { sliceMs: Infinity, restSliceMs: Infinity, restPrepare: false });
});
afterEach(() => {
  Object.assign(glyphMapPrerenderTuning, tuning);
  globalThis.__glyphRenderStage = undefined;
  for (const m of maps.splice(0)) { m.destroy(); m.host.remove(); }
  vi.restoreAllMocks(); vi.unstubAllGlobals(); queue.clear(); idleQueue = []; stagedRenders = 0;
});

/** A map with its compositor frame created: one pointer-down and a first move. */
async function framed(extra: Partial<GlyphMapOptions> = {}) {
  const m = mount(extra); await ready(m);
  pointer(m, "pointerdown", 200); pointer(m, "pointermove", 201); frame();
  return m;
}

it.each(["flat", "globe"] as const)("a render that consumes a prepared plan is byte-identical to one that computes it (%s)", async kind => {
  const projection = kind === "flat" ? glyphMapEquirectangular({ exaggeration: 24 }) : glyphMapGlobe({ exaggeration: 24 });
  const a = await framed({ projection }), b = await framed({ projection });
  // The premise: there is something to prepare, and the plan really is consumed by the render.
  expect(seam(a).prepare("anchor")).toBe(true);
  expect(seam(a).plans()).toBe(2);
  seam(a).renderLive();
  expect(seam(a).plans()).toBe(0);
  seam(b).renderLive();
  expect(text(a)).toBe(text(b));
  // Drapes, outlines and both strategies actually drew, or the equality is empty.
  expect(text(a)).toContain("#e8c988");
  expect(text(a)).toContain("#ff5533");
  expect(text(a)).toMatch(/[⠁-⣿]/u);
});

it.each([
  ["target", (m: Map) => { const c = m.scene.camera; c.target = [c.target[0] + 0.0004, c.target[1], c.target[2]]; }],
  ["rotY", (m: Map) => { m.scene.camera.rotY += 0.7; }],
  ["zoom", (m: Map) => { m.scene.camera.zoom *= 1.004; }],
] as const)("never reuses a plan prepared under a different camera %s", async (_name, change) => {
  const a = await framed(), b = await framed();
  const before = (seam(a).renderLive(), text(a));
  expect(seam(a).prepare("anchor")).toBe(true);
  expect(seam(a).plans()).toBe(2);
  change(a);
  seam(a).renderLive();
  // Stale vertices would be consumed here; the key must refuse them, so a map
  // that never prepared anything and sits in the same state draws the same bytes.
  change(b);
  seam(b).renderLive();
  expect(text(a)).toBe(text(b));
  expect(text(a)).not.toBe(before);
});

it("re-anchors at a prepared snapshot pose with the bytes of a direct render there and the live camera as its translation", async () => {
  const a = await framed(), b = await framed();
  const drag = [] as number[];
  let x = 201, anchored: readonly [number, number, number] | null = null;
  for (; x < 330 && !anchored; ) {
    x += 20;
    for (const m of [a, b]) { pointer(m, "pointermove", x); frame(); }
    if (seam(a).plans() > 0) anchored = [...a.scene.camera.target] as [number, number, number];
    drag.push(x);
  }
  // The job started past a third of the margin and finished inside the frame that started it.
  expect(anchored, "a job prepared during the pan").not.toBeNull();
  expect(seam(b).plans()).toBe(seam(a).plans());
  seam(b).discardPlans();
  seam(b).renderLive();
  const direct = text(b);

  stagedRenders = 0;
  const to = x + 25;
  pointer(a, "pointermove", to); frame();
  expect(stagedRenders).toBe(1);
  expect(seam(a).plans()).toBe(0);
  expect(a.scene.camera.target).not.toEqual(anchored);
  expect(text(a)).toBe(direct);

  // A render at the LIVE pose is a different picture, so the equality above is not vacuous.
  pointer(b, "pointermove", to); frame();
  seam(b).renderLive();
  expect(text(b)).not.toBe(direct);

  // The displayed offset is the live camera's own view of the anchor, so every world point sits where it should.
  const cam = a.scene.camera;
  const metrics = { cellWidth: 8, cellHeight: 16, centerCol: 40, centerRow: 10 };
  const at = (target: readonly number[], world: [number, number, number]) => {
    const saved = cam.target; cam.target = [...target] as [number, number, number];
    try { return cam.project(world, 80, 20, 2, metrics); } finally { cam.target = saved; }
  };
  const [tx, ty] = element(a).style.transform.match(/-?[\d.]+(?=px)/g)!.map(Number) as [number, number];
  for (const world of [[0, 0, 0], [0.0005, -0.0003, 12], [-0.0004, 0.0007, 30]] as [number, number, number][]) {
    const posed = at(anchored!, world), live = at(cam.target, world);
    expect(posed[0] * 8 + (tx + 20 * 8), `col of ${world}`).toBeCloseTo(live[0] * 8, 6);
    expect(posed[1] * 16 + (ty + 5 * 16), `row of ${world}`).toBeCloseTo(live[1] * 16, 6);
  }
});

it("never anchors at a prepared pose once the live pose has left the frame's validity", async () => {
  const a = await framed(), b = await framed();
  seam(a).prepare("anchor");
  // A zoom changes what the plans were made for: the pan ends and the next render is the ordinary one.
  a.setView({ span: 0.005 }); b.setView({ span: 0.005 });
  await Promise.all([a.idle(), b.idle()]);
  expect(seam(a).plans()).toBe(0);
  expect(text(a)).toBe(text(b));
});

it("a drag's first frame renders at the rest pose from plans prepared in idle time, with the bytes of the unprepared drag", async () => {
  glyphMapPrerenderTuning.restPrepare = true;
  const a = mount(); await ready(a);
  flushIdle();
  expect(seam(a).plans()).toBe(2);
  glyphMapPrerenderTuning.restPrepare = false;
  const b = mount(); await ready(b);

  // A zero-length first move leaves the live pose AT the rest pose, so the prepared render and the plain one are of the same camera.
  for (const m of [a, b]) { pointer(m, "pointerdown", 200); pointer(m, "pointermove", 200); }
  stagedRenders = 0;
  frame();
  expect(stagedRenders).toBe(2);
  expect(seam(a).plans()).toBe(0);
  expect(text(a)).toBe(text(b));
  expect(element(a).style.transform).toBe(element(b).style.transform);
});

it("anchors a drag's first frame at the rest pose and slides it to where the live camera already is", async () => {
  glyphMapPrerenderTuning.restPrepare = true;
  const a = mount(); await ready(a);
  flushIdle();
  glyphMapPrerenderTuning.restPrepare = false;
  const b = mount(), c = mount(); await Promise.all([ready(b), ready(c)]);
  // `b` renders the frame at the rest pose (zero-length move); `a` and `c` have already moved 5px.
  pointer(b, "pointerdown", 200); pointer(b, "pointermove", 200); frame();
  for (const m of [a, c]) { pointer(m, "pointerdown", 200); pointer(m, "pointermove", 205); }
  frame();
  expect(text(a)).toBe(text(b));
  expect(text(c)).not.toBe(text(b));
  // 5px of drag is 5px of slide off the rest-pose picture; the plain render is anchored at the live pose instead.
  expect(Number(element(a).style.transform.match(/translate\(([-.\d]+)px/)![1])).toBeCloseTo(-155, 6);
  expect(element(b).style.transform).toBe("translate(-160px, -80px)");
  expect(element(c).style.transform).toBe("translate(-160px, -80px)");
});

/** Venice with water that lands after the rest pose was prepared: its terrain commit changes the ground and renders without going through `scene.rerender`. */
it("prepares the rest pose again when a water commit makes the finished job stale, so the next drag still starts prepared", async () => {
  const root = path.resolve(__dirname, "../fixtures/openfreemap/venice");
  const water: GlyphMapVectorTile = { z: 8, x: 136, y: 91, bounds: glyphMapMercatorTileBounds(8, 136, 91), source: "OpenFreeMap", simplify: "mvt-source",
    layers: glyphMapDecodeMVT(readFileSync(path.join(root, "8_136_91.pbf")), 8, 136, 91, ["water"]) };
  let open!: () => void;
  const gate = new Promise<void>(resolve => { open = resolve; });
  const source: GlyphMapVectorProvider = { id: "water-fixture", zooms: [{ z: 8, cols: 256, rows: 256, tileLonSpan: 360 / 256, tileLatSpan: 180 / 256, tileCols: 256, tileRows: 256 }],
    bounds: glyphMapMercatorTileBounds, tileRange: () => ({ x0: 136, x1: 136, y0: 91, y1: 91 }), loadTile: async () => { await gate; return water; } };
  const ground = glyphMapDecodeGeoTileInt16(readFileSync(path.join(root, "terrain-4-8-3.bin")), {
    bounds: { west: 0, east: 22.5, south: 45, north: 56.25 }, cols: 180, rows: 90, source: "ETOPO1", sampler: "bilinear" });
  glyphMapPrerenderTuning.restPrepare = true;
  const a = mount({ view: { center: [12.3376, 45.4394], span: 1.1, cols: 80, rows: 20 }, tilt: 0,
    layers: [{ type: "raster", id: "terrain", source: ground, minElevation: 0, classifier: glyphMapBreaks([0]), colors: ["#2a55a8", "#2f5a36"] },
      ...glyphMapOpenMapTilesLayers(source, { include: ["omt-water"], waterTerrain: true }),
      { type: "line", id: "road", color: "#e8c988", experimentalGlyphStrategy: "braille",
        source: { features: [{ id: "r", geometryType: "line", rings: [[[12.2, 45.4], [12.3, 45.45], [12.45, 45.43]]] }] } }] });
  flushIdle();
  expect(seam(a).restPrepared()).toBe(true);
  open(); await a.idle();
  flushIdle();
  expect(seam(a).restPrepared()).toBe(true);
});

it.each([
  ["a terrain tile landing", (m: Map) => m.addLayer({ type: "raster", id: "terrain-fine", source: terrain(3) })],
  ["a layer's source being replaced", (m: Map) => m.setLayerSource("braille-road", { features: [road(0.0009)] })],
  ["a layer being removed", (m: Map) => m.removeLayer("box-road")],
] as const)("never uses a plan from before %s", async (_name, change) => {
  glyphMapPrerenderTuning.restPrepare = true;
  glyphMapPrerenderTuning.restSliceMs = 0;
  const a = mount(); await ready(a);
  flushIdle(1); // restSliceMs 0: one step per idle callback, so one layer's plan exists and the rest of the job is still owed when the change lands
  expect(seam(a).plans()).toBe(1);
  change(a); await a.idle();
  flushIdle(); // the job runs to completion across the change, either as the same job or a restarted one
  glyphMapPrerenderTuning.restPrepare = false;
  const b = mount({ layers: undefined }); await ready(b);
  for (const layer of sceneLayers()) b.addLayer(layer);
  await b.idle();
  change(b); await b.idle();

  const unchanged = mount(); await ready(unchanged);
  for (const m of [a, b, unchanged]) { pointer(m, "pointerdown", 200); pointer(m, "pointermove", 200); frame(); }
  expect(text(a)).toBe(text(b));
  // The change is visible in the picture, so a plan from before it could not pass for one after it.
  expect(text(b)).not.toBe(text(unchanged));
});

it("a plan carries each vertex's ground slack: real desert relief keeps the same border ink with and without preparing", async () => {
  const fixture = JSON.parse(readFileSync(path.resolve(__dirname, "../fixtures/sahara-border.json"), "utf8")) as
    { bounds: GlyphMapGeoTile["bounds"]; cols: number; rows: number; elevation: number[]; source: string; sampler: string };
  const tile: GlyphMapGeoTile = { ...fixture, elevation: Float32Array.from(fixture.elevation) } as GlyphMapGeoTile;
  const options: Partial<GlyphMapOptions> = {
    view: { center: [26.677342, 25.465411], span: 16.810437949565824, cols: 80, rows: 20 },
    projection: glyphMapGlobe({ exaggeration: 24 }), tilt: 0,
    layers: [
      { type: "raster", id: "terrain", source: tile },
      { type: "line", id: "borders", color: "#ffffff", experimentalGlyphStrategy: "braille",
        source: { features: [{ geometryType: "line", rings: [[[24.2, 22], [31.8, 22]]] }, { geometryType: "line", rings: [[[25, 20.2], [25, 27.8]]] }] } },
    ],
  };
  const a = await framed(options), b = await framed(options);
  expect(seam(a).prepare("anchor")).toBe(true);
  seam(a).renderLive(); seam(b).renderLive();
  expect(text(a)).toBe(text(b));
  expect(text(a)).toContain("#ffffff");
}, 30000);

/** Rolling hills over the view, enough quads that contours cross the screen in many segments. */
function hills(): GlyphMapField {
  const cols = 64, rows = 48, values = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) values[r * cols + c] = 400 + 300 * Math.sin(c / 5) * Math.cos(r / 4) + 8 * c;
  return { bounds: { west: CENTRE[0] - 0.02, east: CENTRE[0] + 0.02, south: CENTRE[1] - 0.015, north: CENTRE[1] + 0.015 }, cols, rows, values,
    noData: new Uint8Array(cols * rows), kind: "continuous", min: 400 - 300, max: 400 + 300 + 8 * cols };
}
const contourLayers = (): GlyphMapLayer[] => [
  { type: "contour", id: "contours", source: hills(), levels: 7, color: "#33ccff", labels: true },
];

it("a contour layer's prepared polylines are consumed byte-for-byte and refused under another camera", async () => {
  const a = await framed({ layers: contourLayers() }), b = await framed({ layers: contourLayers() });
  expect(seam(a).prepare("anchor")).toBe(true);
  expect(seam(a).plans()).toBe(1);
  seam(a).renderLive(); seam(b).renderLive();
  expect(seam(a).plans()).toBe(0);
  expect(text(a)).toBe(text(b));
  expect(text(a)).toContain("#33ccff");

  expect(seam(a).prepare("anchor")).toBe(true);
  for (const m of [a, b]) { const c = m.scene.camera; c.target = [c.target[0] + 0.0003, c.target[1], c.target[2]]; }
  const stale = text(a);
  seam(a).renderLive(); seam(b).renderLive();
  expect(text(a)).toBe(text(b));
  expect(text(a)).not.toBe(stale);
});

it("spreads a pan's preparation over animation frames, stops asking for frames once it is done, and re-anchors on the next move", async () => {
  glyphMapPrerenderTuning.sliceMs = 0; // one step per frame
  const m = await framed();
  pointer(m, "pointermove", 270); frame(); // past a third of the 20-column margin: a job starts, one step in
  expect(seam(m).plans()).toBe(1);
  let frames = 0;
  while (queue.size && frames < 10) { frame(); frames++; }
  // Two stroke layers, the outline surface and its edge samples: four steps, the first already taken.
  expect(frames).toBe(3);
  expect(seam(m).plans()).toBe(2);
  expect(queue.size).toBe(0);
  stagedRenders = 0;
  pointer(m, "pointermove", 275); frame();
  expect(stagedRenders).toBe(1);
  expect(seam(m).plans()).toBe(0);
});

it("renders once in a motion frame whose live pose has outrun the prepared anchor's margin, and draws what an unprepared map draws", async () => {
  const a = await framed(), b = await framed();
  expect(seam(a).prepare("anchor")).toBe(true);
  expect(seam(a).plans()).toBe(2);
  // Translation, not zoom: the frame stays valid, only the prepared anchor is too far from where the pointer now is.
  stagedRenders = 0;
  pointer(a, "pointermove", 500); frame();
  expect(stagedRenders).toBe(1);
  expect(seam(a).plans()).toBe(0);
  pointer(b, "pointermove", 500); frame();
  expect(text(a)).toBe(text(b));
  expect(element(a).style.transform).toBe(element(b).style.transform);
});

it("replays a prepared line plan only while filterAtResolution still answers every feature as it did when the plan was built", async () => {
  const flags = [{ include: true }, { include: true }];
  const layersFor = (flag: { include: boolean }): GlyphMapLayer[] => sceneLayers().map(layer =>
    layer.id === "braille-road" ? { ...layer, filterAtResolution: () => flag.include } as GlyphMapLayer : layer);
  const a = await framed({ layers: layersFor(flags[0]!) }), b = await framed({ layers: layersFor(flags[1]!) });
  expect(seam(a).prepare("anchor")).toBe(true);
  expect(seam(a).plans()).toBe(2);
  // Closure state the plan key cannot see: the same camera, features and grids, a different answer.
  flags[0]!.include = false; flags[1]!.include = false;
  seam(a).renderLive(); seam(b).renderLive();
  expect(text(a)).toBe(text(b));
  expect(text(a)).not.toContain("#e8c988");
  expect(text(a)).toContain("#ff5533");
  // Unchanged answers still reuse the plan (the filter is checked, not a reason to never prepare).
  flags[0]!.include = true; flags[1]!.include = true;
  expect(seam(a).prepare("anchor")).toBe(true);
  expect(seam(a).plans()).toBe(2);
  seam(a).renderLive(); seam(b).renderLive();
  expect(seam(a).plans()).toBe(0);
  expect(text(a)).toBe(text(b));
  expect(text(a)).toContain("#e8c988");
});

const outlineScene = (variant: "blank" | "filled", relief: number): GlyphMapLayer[] => sceneLayers(relief).map(layer =>
  layer.id === "blocks" ? (variant === "blank" ? layer : { ...layer, fill: undefined, blank: undefined } as GlyphMapLayer) : layer);

it.each([
  ["flat, outline only, blank", glyphMapEquirectangular({ exaggeration: 24 }), "blank", 1, 40],
  ["flat, filled roofs", glyphMapEquirectangular({ exaggeration: 24 }), "filled", 1, 40],
  ["flat, buildings partly behind terrain", glyphMapEquirectangular({ exaggeration: 24 }), "blank", 14, 55],
  ["flat, top-down", glyphMapEquirectangular({ exaggeration: 24 }), "blank", 1, 0],
  ["globe, tilted", glyphMapGlobe({ exaggeration: 24 }), "blank", 1, 40],
] as const)("prepared outline samples draw the bytes of an unprepared render at several poses (%s)", async (_name, projection, variant, relief, tilt) => {
  const options = { projection, tilt, layers: outlineScene(variant, relief) };
  const a = await framed(options), b = await framed(options);
  let drawn = 0;
  for (const x of [0, 17, 41, 83]) {
    if (x) for (const m of [a, b]) { pointer(m, "pointermove", 201 + x); frame(); }
    expect(seam(a).prepare("anchor")).toBe(true);
    expect(seam(a).outlinePlanned(), `pose ${x}`).toBe(true);
    seam(b).discardPlans();
    expect(seam(b).outlinePlanned()).toBe(false);
    seam(a).renderLive(); seam(b).renderLive();
    expect(text(a), `pose ${x}`).toBe(text(b));
    drawn += (text(a).match(/#94a3b8/g) ?? []).length;
  }
  expect(drawn).toBeGreaterThan(0);
});

it.each([
  ["a terrain tile landing", (m: Map) => m.addLayer({ type: "raster", id: "terrain-fine", source: terrain(3) })],
  ["a layer's source being replaced", (m: Map) => m.setLayerSource("braille-road", { features: [road(0.0009)] })],
] as const)("prepares the rest pose again after %s has made the finished job stale, so the next drag still starts prepared", async (_name, change) => {
  glyphMapPrerenderTuning.restPrepare = true;
  const a = mount(); await ready(a);
  flushIdle();
  expect(seam(a).restPrepared()).toBe(true);
  change(a); await a.idle();
  flushIdle();
  expect(seam(a).restPrepared()).toBe(true);
});

// ── Content landing during a pan ────────────────────────────────────────

/** A vector pyramid whose tile set grows from one tile to two when `phase.n` becomes 1: the second tile's roads "land" at the next sweep. */
function lateProvider(phase: { n: number }): GlyphMapVectorProvider {
  const world = { west: -180, east: 180, south: -90, north: 90 };
  return {
    id: "late-roads", zooms: [{ z: 1, cols: 2, rows: 1, tileLonSpan: 180, tileLatSpan: 180, tileCols: 256, tileRows: 256 }],
    bounds: () => world, tileRange: () => ({ x0: 0, x1: phase.n, y0: 0, y1: 0 }),
    async loadTile(z, x, y): Promise<GlyphMapVectorTile> {
      return { z, x, y, bounds: world, source: "test", layers: { road: x === 0 ? [] : [road(0.0021)] } };
    },
  };
}
const lateLayers = (phase: { n: number }): GlyphMapLayer[] =>
  [...sceneLayers(), { type: "line", id: "late-road", color: "#33ccff", experimentalGlyphStrategy: "braille", source: lateProvider(phase) }];
const LATE = "#33ccff";
/** Pumps animation frames until the map reports idle: a deferred render needs them to happen at all. */
async function settle(m: Map) {
  let done = false;
  void m.idle().then(() => { done = true; });
  await vi.waitFor(() => { frame(); expect(done).toBe(true); }, { timeout: 8000, interval: 4 });
}

it("a tile landing mid-pan re-anchors the live frame from a prepared job instead of ending the pan, and settles to a fresh map's bytes", async () => {
  const phase = { n: 0 }, fresh = { n: 1 };
  const a = mount({ layers: lateLayers(phase) }); await ready(a);
  const b = mount({ layers: lateLayers(fresh) }); await ready(b);
  expect(text(a)).not.toContain(LATE);
  expect(text(b)).toContain(LATE);
  pointer(a, "pointerdown", 200); pointer(a, "pointermove", 201); frame();
  const grid = a.scene.getOptions().cols;
  expect(element(a).style.willChange).toBe("transform");

  const sizes = new Set<number | undefined>();
  let landingRenders = 0;
  globalThis.__glyphRenderStage = stage => { if (stage === "base-validate") { landingRenders++; sizes.add(a.scene.getOptions().cols); } };
  phase.n = 1;
  // The next sweep fetches the second tile; the road it carries lands while the pointer is still down.
  await vi.waitFor(() => { frame(); expect(text(a)).toContain(LATE); }, { timeout: 8000, interval: 4 });
  await a.idle();
  // Still the same oversized frame: nothing rendered at true size and nothing recreated it.
  expect(element(a).style.willChange).toBe("transform");
  expect(a.scene.getOptions().cols).toBe(grid);
  expect(seam(a).contentPending()).toBe(false);
  // Every render the landing caused was the oversized frame's: a true-size render (the pan ending) would show up as another grid.
  expect([...sizes]).toEqual([grid]);
  // ...and each was a displayed frame's one render: the landing's re-anchor, nothing else.
  expect(landingRenders).toBe(1);

  globalThis.__glyphRenderStage = undefined;
  for (const m of [a, b]) { if (m === b) { pointer(b, "pointerdown", 200); pointer(b, "pointermove", 201); frame(); } pointer(m, "pointerup", 201); }
  await Promise.all([settle(a), settle(b)]);
  expect(element(a).style.willChange).toBe("");
  expect(text(a)).toBe(text(b));
}, 30000);

/** Gates a layer's tile load: the load starts at once and lands when `release()` is called. */
function gate() {
  let release!: () => void;
  const open = new Promise<void>(r => { release = r; });
  return { open, release: () => release() };
}
function gatedTerrain(g: { open: Promise<void> }): GlyphMapProvider {
  const base = terrain(3);
  return { ...base, id: "gated-terrain", async loadTile(z, x, y) { await g.open; return base.loadTile(z, x, y); } };
}
const FILL = "#cc33aa";
function gatedFill(g: { open: Promise<void> }): GlyphMapVectorProvider {
  const world = { west: -180, east: 180, south: -90, north: 90 };
  const square = ring(CENTRE[0], CENTRE[1], 0.0012);
  return {
    id: "gated-fill", zooms: [{ z: 1, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 256, tileRows: 256 }],
    bounds: () => world, tileRange: () => ({ x0: 0, x1: 0, y0: 0, y1: 0 }),
    async loadTile(z, x, y): Promise<GlyphMapVectorTile> {
      await g.open;
      return { z, x, y, bounds: world, source: "test", layers: { area: [{ id: "a", geometryType: "polygon", rings: [square], polygons: [[square]] }] } };
    },
  };
}
const landings = [
  ["terrain tile", (g: ReturnType<typeof gate>): GlyphMapLayer => ({ type: "raster", id: "late-terrain", source: gatedTerrain(g) }), "terrain"],
  ["filled feature batch", (g: ReturnType<typeof gate>): GlyphMapLayer => ({ type: "fill", id: "late-fill", color: FILL, sourceLayer: "area", source: gatedFill(g) } as GlyphMapLayer), "fill"],
] as const;

it.each(landings)("a %s landing mid-pan renders nothing until the motion loop re-anchors, then once, and settles to a fresh map's bytes", async (_name, layerOf) => {
  const g = gate(), open = gate(); open.release();
  const a = mount(); await ready(a);
  const b = mount({ layers: [...sceneLayers(), layerOf(open)] }); await ready(b);
  a.addLayer(layerOf(g));
  pointer(a, "pointerdown", 200); pointer(a, "pointermove", 201); frame();
  expect(element(a).style.willChange).toBe("transform");
  const before = text(a);
  stagedRenders = 0;
  g.release();
  // Microtasks and timers drain WITHOUT an animation frame: the scene's own queued render must not run.
  await vi.waitFor(() => expect(seam(a).contentPending()).toBe(true), { timeout: 8000, interval: 2 });
  await new Promise<void>(r => setTimeout(r, 20));
  expect(stagedRenders).toBe(0);
  expect(text(a)).toBe(before);
  expect(element(a).style.willChange).toBe("transform");
  // The motion loop re-anchors: this frame's one render.
  let frames = 0;
  while (seam(a).contentPending() && frames < 10) { frame(); frames++; }
  await Promise.resolve(); await Promise.resolve();
  expect(stagedRenders).toBe(1);
  expect(text(a)).not.toBe(before);
  expect(element(a).style.willChange).toBe("transform");

  pointer(a, "pointerup", 201); pointer(b, "pointerdown", 200); pointer(b, "pointermove", 201); frame(); pointer(b, "pointerup", 201);
  await Promise.all([settle(a), settle(b)]);
  expect(text(a)).toBe(text(b));
}, 30000);

it.each(landings)("a %s landing between pointer release and the settle frame joins the settle render instead of rendering first", async (_name, layerOf) => {
  const g = gate(), open = gate(); open.release();
  const a = mount(); await ready(a);
  const b = mount({ layers: [...sceneLayers(), layerOf(open)] }); await ready(b);
  a.addLayer(layerOf(g));
  pointer(a, "pointerdown", 200); pointer(a, "pointermove", 201); frame();
  pointer(a, "pointerup", 201);
  // Released: the settle frame is owed, but no animation frame has run. The landing resolves now.
  stagedRenders = 0;
  g.release();
  await new Promise<void>(r => setTimeout(r, 20));
  expect(stagedRenders).toBe(0);
  frame();
  await Promise.resolve(); await Promise.resolve();
  expect(stagedRenders).toBe(1);
  await settle(a);
  pointer(b, "pointerdown", 200); pointer(b, "pointermove", 201); frame(); pointer(b, "pointerup", 201);
  await settle(b);
  expect(text(a)).toBe(text(b));
}, 30000);

/** A line source whose one tile lands when the gate opens: no mesh, so its landing alone claims no scene render. */
function gatedRoad(g: ReturnType<typeof gate>): GlyphMapVectorProvider {
  const world = { west: -180, east: 180, south: -90, north: 90 };
  return {
    id: "gated-road", zooms: [{ z: 1, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 256, tileRows: 256 }],
    bounds: () => world, tileRange: () => ({ x0: 0, x1: 0, y0: 0, y1: 0 }),
    async loadTile(z, x, y): Promise<GlyphMapVectorTile> {
      await g.open;
      return { z, x, y, bounds: world, source: "test", layers: { road: [road(0.0021)] } };
    },
  };
}
const overlapping = (g: ReturnType<typeof gate>): GlyphMapLayer[] => [
  { type: "line", id: "gated-road", color: LATE, experimentalGlyphStrategy: "braille", sourceLayer: "road", source: gatedRoad(g) } as GlyphMapLayer,
  { type: "fill", id: "gated-fill", color: FILL, sourceLayer: "area", source: gatedFill(g) } as GlyphMapLayer,
];

it.each(["mid-pan", "in the settle window"] as const)("a line and a fill landing %s from one shared gate render nothing until the motion frame, then once, and settle to a fresh map's bytes", async when => {
  const g = gate(), open = gate(); open.release();
  const a = mount(); await ready(a);
  const b = mount({ layers: [...sceneLayers(), ...overlapping(open)] }); await ready(b);
  for (const layer of overlapping(g)) a.addLayer(layer);
  pointer(a, "pointerdown", 200); pointer(a, "pointermove", 201); frame();
  if (when === "in the settle window") pointer(a, "pointerup", 201);
  const before = text(a);
  stagedRenders = 0;
  g.release();
  // Both landings resolve in the same turns; no animation frame runs, so no render may.
  await new Promise<void>(r => setTimeout(r, 40));
  expect(stagedRenders).toBe(0);
  expect(text(a)).toBe(before);
  // The motion loop takes the landings: preparing the re-anchor may span frames, but only one of them renders.
  for (let frames = 0; frames < 12 && stagedRenders === 0; frames++) { frame(); await Promise.resolve(); await Promise.resolve(); }
  expect(stagedRenders).toBe(1);
  expect(text(a)).not.toBe(before);
  if (when === "mid-pan") pointer(a, "pointerup", 201);
  await settle(a);
  pointer(b, "pointerdown", 200); pointer(b, "pointermove", 201); frame(); pointer(b, "pointerup", 201);
  await settle(b);
  expect(text(a)).toBe(text(b));
  expect(text(a)).toContain(LATE);
}, 30000);

it("a vector source landing between pointer release and the settle frame joins the settle render instead of rendering first", async () => {
  const phase = { n: 0 }, fresh = { n: 1 };
  const a = mount({ layers: lateLayers(phase) }); await ready(a);
  const b = mount({ layers: lateLayers(fresh) }); await ready(b);
  pointer(a, "pointerdown", 200); pointer(a, "pointermove", 201); frame();
  phase.n = 1;
  const inner = lateProvider(phase);
  let loaded = 0;
  a.setLayerSource("late-road", { ...inner, async loadTile(z, x, y) { const t = await inner.loadTile(z, x, y); if (x === 1) loaded++; return t; } });
  pointer(a, "pointerup", 201);
  stagedRenders = 0;
  await vi.waitFor(() => expect(loaded).toBeGreaterThan(0), { timeout: 8000, interval: 2 });
  await new Promise<void>(r => setTimeout(r, 20));
  expect(stagedRenders).toBe(0);
  frame();
  await Promise.resolve(); await Promise.resolve();
  expect(stagedRenders).toBe(1);
  await settle(a);
  pointer(b, "pointerdown", 200); pointer(b, "pointermove", 201); frame(); pointer(b, "pointerup", 201);
  await settle(b);
  expect(text(a)).toBe(text(b));
}, 30000);

it("keeps idle() unresolved while landed content waits for its re-anchor, then renders it within a bounded number of frames", async () => {
  glyphMapPrerenderTuning.sliceMs = 0; // one step per frame
  glyphMapPrerenderTuning.contentWaitFrames = 3;
  const phase = { n: 0 };
  const a = mount({ layers: lateLayers(phase) }); await ready(a);
  pointer(a, "pointerdown", 200); pointer(a, "pointermove", 201); frame();
  phase.n = 1;
  a.setLayerSource("late-road", lateProvider(phase));
  await vi.waitFor(() => expect(seam(a).contentPending()).toBe(true), { timeout: 8000 });
  let resolved = false;
  void a.idle().then(() => { resolved = true; });
  for (let i = 0; i < 5; i++) await new Promise<void>(r => setTimeout(r, 0));
  expect(resolved).toBe(false);
  expect(text(a)).not.toContain(LATE);
  // Preparation takes more steps than the wait allows: the frame renders synchronously instead, still as the same pan.
  let frames = 0;
  while (seam(a).contentPending() && frames < 10) { frame(); frames++; }
  expect(frames).toBeLessThanOrEqual(5);
  expect(seam(a).contentPending()).toBe(false);
  expect(element(a).style.willChange).toBe("transform");
  await vi.waitFor(() => { frame(); expect(text(a)).toContain(LATE); }, { timeout: 8000, interval: 4 });
  await vi.waitFor(() => { frame(); expect(resolved).toBe(true); }, { timeout: 8000, interval: 4 });
}, 30000);

it("renders the frame once, at the live pose, when the pointer outruns the margin while new content waits", async () => {
  glyphMapPrerenderTuning.sliceMs = 0;
  glyphMapPrerenderTuning.contentWaitFrames = 100;
  const phase = { n: 0 };
  const a = mount({ layers: lateLayers(phase) }); await ready(a);
  pointer(a, "pointerdown", 200); pointer(a, "pointermove", 201); frame();
  phase.n = 1;
  a.setLayerSource("late-road", lateProvider(phase));
  await vi.waitFor(() => expect(seam(a).contentPending()).toBe(true), { timeout: 8000 });
  stagedRenders = 0;
  pointer(a, "pointermove", 600); frame();
  expect(stagedRenders).toBe(1);
  expect(seam(a).contentPending()).toBe(false);
  expect(text(a)).toContain(LATE);
  expect(element(a).style.willChange).toBe("transform");
}, 30000);

it("a job restarted for new content keeps the plans whose keys still match and prepares nothing twice", async () => {
  let calls = 0;
  const layers = sceneLayers().map(layer => layer.id === "braille-road" ? { ...layer, filterAtResolution: () => { calls++; return true; } } as GlyphMapLayer : layer);
  const m = await framed({ layers });
  const before = calls;
  expect(seam(m).prepare("anchor")).toBe(true);
  const built = calls - before;
  expect(built).toBeGreaterThan(0);
  expect(seam(m).prepare("anchor", true)).toBe(true);
  expect(calls - before).toBe(built);
  expect(seam(m).plans()).toBe(2);
  // A restart replaces its slot's outline plan; it does not stack another beside it.
  expect(seam(m).outlinePlans("anchor")).toBe(1);
  expect(seam(m).prepare("anchor")).toBe(true);
  expect(calls - before).toBe(built * 2);
});

// ── A glide's end is predicted by running its stepping forward (snapPan: the lattice makes the pose a function of whole cells) ──

/** A pointer event stamped with the test clock, so a throw's speed is a function of the test and not of the machine. */
function touch(m: Map, type: string, x: number, y = 150) {
  const e = new PointerEvent(type, { pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(e, "timeStamp", { value: time });
  m.host.dispatchEvent(e);
}
/** Three 30 px moves a frame apart, then the release: a fling that glides. */
function throwMap(m: Map) {
  touch(m, "pointerdown", 200); touch(m, "pointermove", 230); frame(); touch(m, "pointermove", 260); frame(); touch(m, "pointermove", 290); frame();
  touch(m, "pointerup", 290);
}
const settled = (m: Map) => element(m).style.transform === "";
/** Frames until the compositor frame is gone (the settle render), returning the prepare-capable stamps and plan hits of that frame alone. */
function glideToSettle(m: Map, each?: (frameNo: number) => void, step = 16) {
  let before = seam(m).stats(), frames = 0;
  while (!settled(m) && frames < 400) { before = seam(m).stats(); each?.(frames++); frame(step); }
  expect(settled(m), "the glide reached its settle").toBe(true);
  const after = seam(m).stats();
  return { stamps: after.stamps - before.stamps, hits: after.hits - before.hits, frames };
}
const poseOf = (m: Map) => { const c = m.scene.camera; return { view: m.getView(), rotX: c.rotX, rotY: c.rotY, zoom: c.zoom, target: [...c.target] }; };

it("a glide's settle render consumes plans prepared for its predicted end pose and draws the bytes of an unprepared glide", async () => {
  const a = mount({ snapPan: true }), b = mount({ snapPan: true }); await Promise.all([ready(a), ready(b)]);
  throwMap(a);
  let preparedBefore = -1;
  const withPlans = glideToSettle(a, () => { preparedBefore = seam(a).plans("settle"); });
  // The premise: plans existed for the settle frame before it rendered, and every prepare-capable layer took one.
  expect(preparedBefore).toBe(2);
  expect(withPlans.stamps).toBeGreaterThan(0);
  expect(withPlans.hits).toBe(withPlans.stamps);
  expect(seam(a).outlinePlanned()).toBe(true);
  expect(seam(a).plans("settle")).toBe(0);

  glyphMapPrerenderTuning.glidePrepare = false;
  throwMap(b);
  const without = glideToSettle(b);
  expect(without.stamps).toBeGreaterThan(0);
  expect(without.hits).toBe(0);
  expect(poseOf(a)).toEqual(poseOf(b));
  await Promise.all([a.idle(), b.idle()]);
  expect(text(a)).toBe(text(b));
  // Drapes, outlines and both strategies actually drew, or the equality is empty.
  expect(text(a)).toContain("#e8c988");
  expect(text(a)).toContain("#ff5533");
});

it("a grab right after the settle starts from a prepared oversized frame and draws the bytes of an unprepared grab", async () => {
  const a = mount({ snapPan: true }), b = mount({ snapPan: true }); await Promise.all([ready(a), ready(b)]);
  throwMap(a); glideToSettle(a);
  // No idle time has passed: the frame the next drag creates was prepared during the glide.
  expect(seam(a).restPrepared()).toBe(true);
  const grab = (m: Map) => { touch(m, "pointerdown", 200); touch(m, "pointermove", 200); const before = seam(m).stats(); frame(); const after = seam(m).stats(); return { stamps: after.stamps - before.stamps, hits: after.hits - before.hits }; };
  const prepared = grab(a);
  expect(prepared.stamps).toBeGreaterThan(0);
  expect(prepared.hits).toBe(prepared.stamps);

  glyphMapPrerenderTuning.glidePrepare = false;
  throwMap(b); glideToSettle(b);
  expect(seam(b).restPrepared()).toBe(false);
  expect(grab(b).hits).toBe(0);
  expect(poseOf(a)).toEqual(poseOf(b));
  expect(text(a)).toBe(text(b));
  expect(element(a).style.transform).toBe(element(b).style.transform);
});

it("never uses a plan prepared for a glide that was interrupted: the pan ends elsewhere and renders as an unprepared map does", async () => {
  const interrupt = (m: Map) => {
    throwMap(m);
    for (let i = 0; i < 12; i++) frame();
    // Grabbed mid-glide, dragged another way, held and released without a throw.
    touch(m, "pointerdown", 400); touch(m, "pointermove", 380); frame(); touch(m, "pointermove", 330); frame();
    time += 200; touch(m, "pointerup", 330);
  };
  const a = mount({ snapPan: true }), b = mount({ snapPan: true }); await Promise.all([ready(a), ready(b)]);
  throwMap(a); for (let i = 0; i < 12; i++) frame();
  expect(seam(a).plans("settle")).toBe(2);
  expect(seam(a).plans("landing")).toBe(2);
  touch(a, "pointerdown", 400);
  // The glide is over the moment the hand lands, and with it what was prepared for where it would have ended.
  expect(seam(a).plans("settle")).toBe(0);
  expect(seam(a).plans("landing")).toBe(0);
  touch(a, "pointermove", 380); frame(); touch(a, "pointermove", 330); frame(); time += 200; touch(a, "pointerup", 330);
  glyphMapPrerenderTuning.glidePrepare = false;
  interrupt(b);
  for (let i = 0; i < 20; i++) frame();
  await Promise.all([a.idle(), b.idle()]);
  expect(poseOf(a)).toEqual(poseOf(b));
  expect(text(a)).toBe(text(b));
});

it("a glide that ends away from its predicted pose keeps the live path: no plan is consumed and no stale rest frame is kept", async () => {
  // Every move nudges the camera, as a consumer's handler may: the glide cannot land where it was computed to.
  const nudge = (m: Map) => m.on("move", () => { m.scene.camera.rotY += 0.0007; });
  const a = mount({ snapPan: true }), b = mount({ snapPan: true }); await Promise.all([ready(a), ready(b)]);
  nudge(a); throwMap(a);
  const stray = glideToSettle(a);
  expect(stray.stamps).toBeGreaterThan(0);
  expect(stray.hits).toBe(0);
  expect(seam(a).restPrepared()).toBe(false);
  glyphMapPrerenderTuning.glidePrepare = false;
  nudge(b); throwMap(b); glideToSettle(b);
  await Promise.all([a.idle(), b.idle()]);
  expect(poseOf(a)).toEqual(poseOf(b));
  expect(text(a)).toBe(text(b));
});

it("releases every plan a glide kept once the frames they were for have rendered or the glide is abandoned", async () => {
  const a = mount({ snapPan: true }); await ready(a);
  throwMap(a);
  for (let i = 0; i < 12; i++) frame();
  expect(seam(a).outlinePlans("settle")).toBe(1);
  expect(seam(a).outlinePlans("landing")).toBe(1);
  glideToSettle(a);
  // The settle render spent its plans; the next drag's frame is still waiting for the drag.
  expect(seam(a).outlinePlans("settle")).toBe(0);
  expect(seam(a).outlinePlans("landing")).toBe(1);
  touch(a, "pointerdown", 200); touch(a, "pointermove", 200); frame();
  expect(seam(a).outlinePlans()).toBe(0);
  expect(seam(a).plans()).toBe(0);
  // Abandoned mid-glide: nothing is left holding the pose it would have ended in.
  touch(a, "pointermove", 260); frame(); touch(a, "pointermove", 320); frame(); touch(a, "pointerup", 320);
  for (let i = 0; i < 60 && !seam(a).glidePrepared().settle; i++) frame();
  expect(seam(a).outlinePlans("settle")).toBe(1);
  touch(a, "pointerdown", 100);
  expect(seam(a).outlinePlans("settle")).toBe(0);
  expect(seam(a).outlinePlans("landing")).toBe(0);
});

it("prepares a glide's frames in motion-frame slices and renders each displayed frame once", async () => {
  glyphMapPrerenderTuning.sliceMs = 0; // one step per frame
  const a = mount({ snapPan: true }); await ready(a);
  throwMap(a);
  let mostRenders = 0;
  const held = new Set<number>();
  glideToSettle(a, () => {
    mostRenders = Math.max(mostRenders, stagedRenders); stagedRenders = 0;
    held.add(seam(a).plans("settle"));
  });
  // A step per frame spreads the work over several frames instead of one block: the frame was seen holding some of its plans ...
  expect(held.has(1)).toBe(true);
  expect(held.has(2)).toBe(true);
  // ... and none of those frames rendered more than the one render a frame is owed.
  expect(mostRenders).toBeLessThanOrEqual(1);
});

it("a glide that ends before its preparation finishes still settles to the bytes of an unprepared one", async () => {
  glyphMapPrerenderTuning.sliceMs = 0;
  const short = (m: Map) => {
    touch(m, "pointerdown", 200); touch(m, "pointermove", 206); frame(); touch(m, "pointermove", 213); frame(); touch(m, "pointermove", 221); frame(); touch(m, "pointerup", 221);
  };
  const a = mount({ snapPan: true }), b = mount({ snapPan: true }); await Promise.all([ready(a), ready(b)]);
  short(a); glideToSettle(a);
  glyphMapPrerenderTuning.glidePrepare = false;
  short(b); glideToSettle(b);
  await Promise.all([a.idle(), b.idle()]);
  expect(poseOf(a)).toEqual(poseOf(b));
  expect(text(a)).toBe(text(b));
});

it("a fling into the edge of the world settles on prepared plans too: its clamp is part of the computed end", async () => {
  const options = { view: { center: [150, 10] as [number, number], span: 24, cols: 80, rows: 20 }, tilt: 0,
    layers: [{ type: "fill" as const, color: "#789abc", source: { features: [{ rings: [[[120, -10], [180, -10], [180, 30], [120, 30], [120, -10]]] as [number, number][][] }] } },
      { type: "line" as const, id: "road", color: "#e8c988", experimentalGlyphStrategy: "braille" as const, source: { features: [{ rings: [[[140, 0], [158, 12], [179, 8]]] as [number, number][][] }] } }] };
  const a = mount({ ...options, snapPan: true }), b = mount({ ...options, snapPan: true }); await Promise.all([ready(a), ready(b)]);
  const eastward = (m: Map) => { touch(m, "pointerdown", 500); touch(m, "pointermove", 440); frame(); touch(m, "pointermove", 380); frame(); touch(m, "pointermove", 320); frame(); touch(m, "pointerup", 320); };
  const start = a.getView().center[0];
  eastward(a);
  const run = glideToSettle(a);
  // The throw would carry the centre past the edge; it stops where the map ends.
  expect(a.getView().center[0] - start).toBeGreaterThan(5);
  expect(a.getView().center[0]).toBeCloseTo(168, 6);
  expect(run.hits).toBe(run.stamps);
  glyphMapPrerenderTuning.glidePrepare = false;
  eastward(b); glideToSettle(b);
  await Promise.all([a.idle(), b.idle()]);
  expect(poseOf(a)).toEqual(poseOf(b));
  expect(text(a)).toBe(text(b));
});

it.each([7, 33])("predicts the end of a glide at the frame cadence it is running at (%s ms a frame)", async step => {
  const a = mount({ snapPan: true }), b = mount({ snapPan: true }); await Promise.all([ready(a), ready(b)]);
  throwMap(a);
  const run = glideToSettle(a, undefined, step);
  expect(run.stamps).toBeGreaterThan(0);
  expect(run.hits).toBe(run.stamps);
  glyphMapPrerenderTuning.glidePrepare = false;
  throwMap(b); glideToSettle(b, undefined, step);
  await Promise.all([a.idle(), b.idle()]);
  expect(poseOf(a)).toEqual(poseOf(b));
  expect(text(a)).toBe(text(b));
});
