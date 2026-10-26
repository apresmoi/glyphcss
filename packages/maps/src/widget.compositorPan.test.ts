import { afterEach, expect, it, vi } from "vitest";
import { createGlyphMap, type GlyphMapOptions } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";

const maps: ReturnType<typeof createGlyphMap>[] = [];
let queue = new Map<number, FrameRequestCallback>(), time = 100, next = 0, renders = 0;
function frame() {
  const work = [...queue.values()]; queue.clear(); time += 16;
  for (const cb of work) cb(time);
}
function pointer(m: ReturnType<typeof createGlyphMap>, type: string, x: number, y = 150) {
  m.host.dispatchEvent(new PointerEvent(type, { pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true }));
}
function mount(extra: Partial<GlyphMapOptions> = {}) {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { queue.set(++next, cb); return next; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => queue.delete(id));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const pre = this.tagName === "PRE";
    const lines = this.textContent?.split("\n") ?? [];
    const width = pre ? Math.max(0, ...lines.map(s => s.length)) * 8 : 640;
    const height = pre ? lines.length * 16 : 320;
    return { width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON() {} };
  });
  const host = document.createElement("div"); document.body.append(host);
  const m = createGlyphMap(host, {
    view: { center: [0, 0], span: 60, cols: 80, rows: 20 },
    projection: glyphMapEquirectangular(), tilt: 0, compositorPan: true,
    layers: [{ type: "fill", color: "#789abc", source: { features: [{ rings: [[[-30,-15],[25,-15],[25,15],[-30,15],[-30,-15]]] }] } }],
    ...extra,
  });
  maps.push(m);
  return m;
}
async function ready(m: ReturnType<typeof createGlyphMap>) {
  await m.idle();
  globalThis.__glyphRenderStage = stage => { if (stage === "base-validate") renders++; };
  renders = 0;
}
const element = (m: ReturnType<typeof createGlyphMap>) => m.scene.output.parentElement!;
afterEach(() => {
  globalThis.__glyphRenderStage = undefined;
  for (const m of maps.splice(0)) { m.destroy(); m.host.remove(); }
  vi.restoreAllMocks(); vi.unstubAllGlobals(); queue.clear(); renders = 0;
});

it("translates small moves without rasterizing and refreshes at the margin", async () => {
  const m = mount(); await ready(m);
  pointer(m, "pointerdown", 200);
  pointer(m, "pointermove", 201); frame();
  expect(renders).toBe(1);
  expect(m.scene.getOptions().cols).toBe(80);
  expect(m.getView().cols).toBe(80);
  expect(m.scene.output.textContent!.split("\n")[0]!.length).toBe(120);
  const text = m.scene.output.innerHTML;
  renders = 0;
  pointer(m, "pointermove", 221); frame();
  expect(renders).toBe(0);
  expect(m.scene.output.innerHTML).toBe(text);
  expect(Number(element(m).style.transform.match(/translate\(([-.\d]+)px/)![1])).toBeCloseTo(-140, 9);
  expect(element(m).style.willChange).toBe("transform");
  pointer(m, "pointermove", 340); frame();
  expect(renders).toBe(1);
  expect(element(m).style.transform).toBe("translate(-160px, -80px)");
});

const road = { type: "line" as const, id: "road", color: "#ff0000", experimentalGlyphStrategy: "braille" as const,
  source: { features: [{ rings: [[[-28, -12], [22, 13]] as [number, number][]] }] } };

it.each([false, true])("settles byte-for-byte like normal rendering (snapPan=%s), restores overlays/styles", async snapPan => {
  const m = mount({ snapPan, layers: [{ type: "fill", color: "#789abc", source: { features: [{ rings: [[[-30,-15],[25,-15],[25,15],[-30,15],[-30,-15]]] }] } }, road] }); await ready(m);
  const marker = m.addMarker({ at: [0, 0], label: "home" }); await m.idle();
  const hotspots = marker.el.parentElement!;
  const original = element(m).style.cssText;
  pointer(m, "pointerdown", 200); pointer(m, "pointermove", 201); frame();
  pointer(m, "pointermove", 225.3); frame();
  expect(hotspots.style.display).toBe("none");
  renders = 0;
  pointer(m, "pointercancel", 225.3); frame(); await m.idle();
  expect(renders).toBe(1);
  expect(hotspots.style.display).toBe("");
  expect(element(m).style.cssText).toBe(original);
  expect(m.host.style.overflow).toBe("");
  const final = m.scene.output.innerHTML;
  m.scene.rerender();
  expect(m.scene.output.innerHTML).toBe(final);
  // The settle render must already project strokes on the normal grid, not the
  // overscanned text still in the <pre> when it starts.
  expect(final).toContain("#ff0000");
  const reference = mount({ compositorPan: false, snapPan, layers: [{ type: "fill", color: "#789abc", source: { features: [{ rings: [[[-30,-15],[25,-15],[25,15],[-30,15],[-30,-15]]] }] } }, road] }); await reference.idle();
  // Identical navigation preserves snapPan's original lattice and remainder.
  pointer(reference, "pointerdown", 200); pointer(reference, "pointermove", 201); frame();
  pointer(reference, "pointermove", 225.3); frame(); pointer(reference, "pointercancel", 225.3); frame();
  await reference.idle();
  expect(reference.getView()).toEqual(m.getView());
  expect(reference.scene.output.innerHTML).toBe(final);
});

it("slides a fling's glide on the same cache and settles exactly once, at glide rest", async () => {
  const m = mount(); await ready(m);
  vi.spyOn(performance, "now").mockImplementation(() => time);
  pointer(m, "pointerdown", 200); time += 16;
  pointer(m, "pointermove", 208); frame();
  time += 16; pointer(m, "pointermove", 216); frame();
  renders = 0; pointer(m, "pointerup", 216); frame();
  // Settling on release and re-entering the overscan for the glide flickered.
  expect(element(m).style.transform).not.toBe("");
  expect(renders).toBe(0);
  const settled: boolean[] = [];
  for (let i = 0; i < 200 && queue.size; i++) { frame(); settled.push(element(m).style.transform === ""); }
  expect(settled.indexOf(true)).toBeGreaterThan(-1);
  expect(settled.slice(settled.indexOf(true)).every(Boolean)).toBe(true);
  expect(queue.size).toBe(0);
  await m.idle();
  expect(element(m).style.transform).toBe("");
  const html = m.scene.output.innerHTML; m.scene.rerender(); expect(m.scene.output.innerHTML).toBe(html);
});

it("refreshes globe rotation sooner than the pixel margin", async () => {
  const m = mount({ projection: glyphMapGlobe() }); await ready(m);
  pointer(m, "pointerdown", 200); pointer(m, "pointermove", 201); frame();
  renders = 0; pointer(m, "pointermove", 202); frame(); expect(renders).toBe(0);
  pointer(m, "pointermove", 235); frame(); expect(renders).toBe(1);
});

it.each(["zoom", "tilt", "bearing", "raw", "toggle", "fit"])("invalidates on %s", async action => {
  const m = mount(); await ready(m);
  pointer(m, "pointerdown", 200); pointer(m, "pointermove", 208); frame();
  if (action === "zoom") m.setView({ span: 40 });
  if (action === "tilt") m.setTilt(20);
  if (action === "bearing") m.setBearing(25);
  if (action === "raw") m.scene.rerender();
  if (action === "toggle") m.setCompositorPan(false);
  if (action === "fit") { m.scene.fit(); m.scene.rerender(); }
  expect(element(m).style.transform).toBe("");
  expect(m.scene.getOptions().cols).toBe(80);
});

it("keeps omitted and explicit false bytes identical through pointer moves", async () => {
  const a = mount({ compositorPan: undefined }), b = mount({ compositorPan: false });
  await Promise.all([a.idle(), b.idle()]);
  for (const m of [a,b]) { pointer(m, "pointerdown", 200); pointer(m, "pointermove", 220); frame(); }
  expect(a.scene.output.innerHTML).toBe(b.scene.output.innerHTML);
  expect(element(a).style.transform).toBe("");
  expect(a.getCompositorPan()).toBe(false);
});

it("settles even when released before the first motion frame", async () => {
  const m = mount(); await ready(m);
  pointer(m, "pointerdown", 200); pointer(m, "pointermove", 225);
  pointer(m, "pointercancel", 225); frame(); await m.idle();
  expect(element(m).style.transform).toBe("");
  expect(m.scene.output.textContent!.split("\n")[0]!.length).toBe(80);
});

it("moves detail and viewport text together and rebases a scene-owned render", async () => {
  const m = mount({ layers: [
    { type: "fill", density: 2, source: { features: [{ rings: [[[-20,-10],[20,-10],[20,10],[-20,10],[-20,-10]]] }] } },
    { type: "line", density: 1.5, source: { features: [{ rings: [[[-20,-10],[20,10]]] }] } },
  ] });
  await ready(m);
  pointer(m, "pointerdown", 200); pointer(m, "pointermove", 201); frame();
  const pres = Array.from(element(m).querySelectorAll<HTMLPreElement>("pre.glyph-output"));
  expect(pres.length).toBeGreaterThanOrEqual(3);
  const cached = pres.map(pre => [pre.innerHTML, pre.style.transform]);
  renders = 0; pointer(m, "pointermove", 220); frame();
  expect(renders).toBe(0);
  expect(pres.map(pre => [pre.innerHTML, pre.style.transform])).toEqual(cached);
  for (const pre of pres) expect(pre.parentElement).toBe(element(m));
  m.addMarker({ at: [0,0] }); await Promise.resolve(); await Promise.resolve();
  expect(renders).toBe(1);
  expect(element(m).style.transform).toBe("translate(-160px, -80px)");
  renders = 0; pointer(m, "pointermove", 221); frame(); expect(renders).toBe(0);
  expect(Number(element(m).style.transform.match(/translate\(([-.\d]+)px/)![1])).toBeCloseTo(-159, 8);
  pointer(m, "pointercancel", 221); frame(); await m.idle();
  const settled = pres.map(pre => pre.innerHTML);
  m.scene.rerender(); expect(pres.map(pre => pre.innerHTML)).toEqual(settled);
});

it.each([glyphMapEquirectangular, glyphMapGlobe])("settles tilted, bearing-rotated autoSize views exactly", async factory => {
  const options = { projection: factory(), tilt: 25, bearing: 33, autoSize: true };
  const a = mount(options), b = mount({ ...options, compositorPan: false });
  await Promise.all([a.idle(), b.idle()]);
  for (const m of [a,b]) {
    pointer(m, "pointerdown", 200); pointer(m, "pointermove", 208, 154); frame();
    pointer(m, "pointermove", 223, 162); frame(); pointer(m, "pointercancel", 223, 162); frame();
  }
  await Promise.all([a.idle(), b.idle()]);
  expect(a.getView()).toEqual(b.getView());
  expect(a.scene.output.innerHTML).toBe(b.scene.output.innerHTML);
});

it.each([false, true])("invalidates the cache on a host resize and cleans up its observer (autoSize=%s)", async autoSize => {
  const observers: { cb: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal("ResizeObserver", class {
    disconnect = vi.fn(); observe() {} unobserve() {}
    constructor(cb: ResizeObserverCallback) { observers.push({ cb, disconnect: this.disconnect }); }
  });
  const m = mount({ autoSize }); await ready(m);
  // The oracle: the same map without a compositor, panned and resized the same way.
  const plain = mount({ compositorPan: false, autoSize }); await plain.idle();
  for (const map of [m, plain]) { pointer(map, "pointerdown", 200); pointer(map, "pointermove", 208); frame(); }
  for (const map of [m, plain]) Object.defineProperty(map.host, "getBoundingClientRect", { value: () => ({ width: 800, height: 400 }) });
  renders = 0;
  for (const o of observers) o.cb([], {} as ResizeObserver);
  // An autoSize grid renders once more: it must commit normal-size text before it can measure it.
  expect(element(m).style.transform).toBe(""); expect(renders).toBe(autoSize ? 2 : 1);
  // A layout primed at the frame's 640 px host would centre the answer for the old width.
  expect(m.project([0, 0]).col).toBeCloseTo(plain.project([0, 0]).col, 6);
  expect(m.project([0, 0]).col).not.toBeCloseTo(41, 1);
  m.destroy(); plain.destroy();
  for (const o of observers) expect(o.disconnect).toHaveBeenCalled();
});

it("preserves cell size through public and wheel interaction with interactiveDownscale configured", async () => {
  const m = mount({ scene: { interactiveDownscale: 3 } }); await ready(m);
  pointer(m, "pointerdown", 200); pointer(m, "pointermove", 208); frame();
  const getBase = m.scene.getBaseResolution;
  m.scene.setInteracting(true);
  expect(m.scene.output.style.fontSize).toBe("");
  expect(getBase()).toEqual({ cols: 80, rows: 20 });
  m.host.dispatchEvent(new WheelEvent("wheel", { deltaY: -40, bubbles: true, cancelable: true }));
  frame();
  expect(m.scene.output.style.fontSize).toBe("");
  expect(element(m).style.transform).toBe("");
  expect(getBase()).toEqual({ cols: 80, rows: 20 });
  pointer(m, "pointercancel", 208); frame(); await m.idle();
});

it("keeps pinch anchors in the visible grid when a second finger arrives before settle", async () => {
  const a = mount(), b = mount({ compositorPan: false });
  await Promise.all([a.idle(), b.idle()]);
  for (const m of [a,b]) {
    const touch = (type: string, id: number, x: number) => m.host.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: "touch", clientX: x, clientY: 150, button: 0, buttons: 1, bubbles: true,
    }));
    touch("pointerdown", 1, 200); touch("pointermove", 1, 208); frame();
    if (m === a) {
      // happy-dom has no layout; emulate the cached pre's displaced box.
      Object.defineProperty(m.scene.output, "getBoundingClientRect", { configurable: true,
        value: () => ({ left: -160, top: -80, width: 960, height: 480 }) });
    }
    touch("pointerdown", 2, 288);
    touch("pointermove", 1, 204); touch("pointermove", 2, 292);
    touch("pointermove", 1, 200); touch("pointermove", 2, 296);
    touch("pointermove", 1, 196); touch("pointermove", 2, 300);
    touch("pointermove", 1, 192); touch("pointermove", 2, 304);
    touch("pointermove", 1, 188); touch("pointermove", 2, 308);
    if (m === a) delete (m.scene.output as unknown as Record<string, unknown>).getBoundingClientRect;
    touch("pointercancel", 2, 296); touch("pointercancel", 1, 200); frame();
  }
  await Promise.all([a.idle(), b.idle()]);
  expect(a.getView().span).toBeLessThan(60);
  expect(a.getView().span).toBeCloseTo(b.getView().span, 10);
  expect(a.getView().center[0]).toBeCloseTo(b.getView().center[0], 10);
  expect(a.getView().center[1]).toBeCloseTo(b.getView().center[1], 10);
});

// A rotation slid as a translation drifts away from the pivot; past half a
// cell the next render snaps it back (the reported globe "jumping").
// Measured here: 12 px is ~1.9 degrees, under the old fixed 2-degree cap, yet
// the view's edge is ~0.67 cells off the slid picture.
it("re-renders a tilted wide globe once the slide drifts more than half a cell", async () => {
  const globe = { projection: glyphMapGlobe(), tilt: 40, view: { center: [0, 30] as [number, number], span: 90, cols: 80, rows: 20 } };
  const m = mount(globe); await ready(m);
  pointer(m, "pointerdown", 200); pointer(m, "pointermove", 201); frame();
  renders = 0; pointer(m, "pointermove", 205); frame(); expect(renders).toBe(0);
  pointer(m, "pointermove", 213); frame(); expect(renders).toBe(1);
});

it("under snapPan the slide carries the sub-cell remainder while the frame stays on the lattice", async () => {
  const m = mount({ snapPan: true }); await ready(m);
  const tx = () => Number(element(m).style.transform.match(/translate\(([-.\d]+)px/)![1]);
  pointer(m, "pointerdown", 200);
  pointer(m, "pointermove", 201); frame();
  const text = m.scene.output.innerHTML;
  renders = 0;
  // 3.5 px is under half of the 8 px cell: the lattice has not stepped, so only the remainder can move the frame.
  pointer(m, "pointermove", 204.5); frame();
  expect(renders).toBe(0);
  expect(m.scene.output.innerHTML).toBe(text);
  expect(tx() % 8).not.toBe(0);
  expect(tx()).toBeCloseTo(-160 + 3.5, 6);
});

const SUB = -160 + 3.5;
function subCellDrag(m: ReturnType<typeof createGlyphMap>) {
  pointer(m, "pointerdown", 200);
  pointer(m, "pointermove", 201); frame();
  pointer(m, "pointermove", 204.5); frame();
}

it("under snapPan, release eases the sub-cell remainder out inside the live frame instead of snapping back", async () => {
  const m = mount({ snapPan: true }); await ready(m);
  const tx = () => Number(element(m).style.transform.match(/translate\(([-.\d]+)px/)![1]);
  subCellDrag(m);
  expect(tx()).toBeCloseTo(SUB, 6);
  const text = m.scene.output.innerHTML;
  pointer(m, "pointercancel", 204.5); frame(); frame();
  // Not yet settled: still the overscanned frame, moved part-way toward the lattice.
  expect(m.scene.output.innerHTML).toBe(text);
  expect(tx()).toBeGreaterThan(-160); expect(tx()).toBeLessThan(SUB);
  let last = tx();
  for (let i = 0; i < 12 && element(m).style.willChange === "transform"; i++) {
    frame();
    if (element(m).style.willChange !== "transform") break;
    expect(tx()).toBeLessThanOrEqual(last + 1e-9); last = tx();
  }
  for (let i = 0; i < 12; i++) frame();
  await m.idle();
  expect(m.scene.output.textContent!.split("\n")[0]!.length).toBe(80);
  expect(element(m).style.willChange).not.toBe("transform");
});

it("under snapPan, project() answers for the displayed (exact) frame mid-drag", async () => {
  const m = mount({ snapPan: true }); await ready(m);
  const rest = m.project([0, 0]);
  subCellDrag(m);
  // The whole 4.5 px drag (0.5625 of an 8 px cell) is displayed, not just the lattice steps.
  expect(m.project([0, 0]).col - rest.col).toBeCloseTo(4.5 / 8, 2);
});

it("under snapPan, project() follows the displayed frame through the release ease", async () => {
  const m = mount({ snapPan: true }); await ready(m);
  const tx = () => Number(element(m).style.transform.match(/translate\(([-.\d]+)px/)![1]);
  const onScreen = () => m.project([0, 0]).col * 8 - tx();
  subCellDrag(m);
  const exact = onScreen();
  pointer(m, "pointercancel", 204.5); frame(); frame();
  const samples: number[] = [];
  for (let i = 0; i < 12 && element(m).style.willChange === "transform"; i++) {
    samples.push(tx(), onScreen());
    frame();
  }
  expect(samples.length).toBeGreaterThan(2);
  // The frame moved, and the answer moved with it: a point stays where the text draws it.
  expect(new Set(samples.filter((_, i) => i % 2 === 0)).size).toBeGreaterThan(1);
  for (let i = 1; i < samples.length; i += 2) expect(samples[i]).toBeCloseTo(exact, 6);
});

it("under snapPan, a scene-owned render mid-drag keeps the remainder", async () => {
  const m = mount({ snapPan: true }); await ready(m);
  const tx = () => Number(element(m).style.transform.match(/translate\(([-.\d]+)px/)![1]);
  subCellDrag(m);
  expect(tx()).toBeCloseTo(SUB, 6);
  m.addMarker({ at: [1, 1], label: "x" });
  await Promise.resolve(); await Promise.resolve(); await m.idle();
  expect(tx()).toBeCloseTo(SUB, 6);
});

it("resolves road hierarchy from the visible grid, not the enlarged overscan grid, mid-pan", async () => {
  const seen: number[] = [];
  const m = mount({ layers: [{ ...road, filterAtResolution: (_f: unknown, degPerCell: number) => { seen.push(degPerCell); return true; } }] });
  await ready(m);
  seen.length = 0;
  pointer(m, "pointerdown", 200); pointer(m, "pointermove", 201); frame(); await m.idle();
  expect(element(m).style.willChange).toBe("transform");
  expect(seen.length).toBeGreaterThan(0);
  for (const d of seen) expect(d).toBeCloseTo(60 / 80, 12);
});
