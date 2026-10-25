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
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createGlyphMap, type GlyphMapLayer, type GlyphMapOptions } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";
import { glyphMapPrerenderSeam, glyphMapPrerenderTuning, type GlyphMapPrerenderSeam } from "./prerender";
import type { GlyphMapProvider } from "./provider";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapVectorFeature } from "./vector/types";

type Map = ReturnType<typeof createGlyphMap>;
const seam = (m: Map): GlyphMapPrerenderSeam => (m as unknown as Record<symbol, GlyphMapPrerenderSeam>)[glyphMapPrerenderSeam]!;

const maps: Map[] = [];
let queue = new globalThis.Map<number, FrameRequestCallback>(), time = 100, next = 0, stagedRenders = 0;
let idleQueue: ((deadline: { timeRemaining(): number; didTimeout: boolean }) => void)[] = [];
const tuning = { ...glyphMapPrerenderTuning };

function frame() {
  const work = [...queue.values()]; queue.clear(); time += 16;
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
  glyphMapPrerenderTuning.restPrepare = false;
  const b = mount({ layers: undefined }); await ready(b);
  for (const layer of sceneLayers()) b.addLayer(layer);
  await b.idle();
  change(b); await b.idle();

  for (const m of [a, b]) { pointer(m, "pointerdown", 200); pointer(m, "pointermove", 200); frame(); }
  expect(text(a)).toBe(text(b));
});
