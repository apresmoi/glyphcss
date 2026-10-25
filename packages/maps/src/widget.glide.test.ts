/**
 * The inertial glide is a function of elapsed time: where a fling lands does
 * not depend on how its frames fell, which is what makes its end pose
 * predictable while it is still moving.
 */
import { afterEach, expect, it, vi } from "vitest";
import { createGlyphMap, type GlyphMapOptions } from "./widget";
import { glyphMapEquirectangular } from "./projection";

type Map = ReturnType<typeof createGlyphMap>;
const maps: Map[] = [];
let queue = new globalThis.Map<number, FrameRequestCallback>(), time = 100, next = 0;
function frame(step = 16) {
  const work = [...queue.values()]; queue.clear(); time += step;
  for (const cb of work) cb(time);
}
function pointer(m: Map, type: string, x: number, y = 150) {
  m.host.dispatchEvent(new PointerEvent(type, { pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true }));
}
function mount(extra: Partial<GlyphMapOptions> = {}): Map {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { queue.set(++next, cb); return next; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => queue.delete(id));
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const pre = this.tagName === "PRE";
    const lines = this.textContent?.split("\n") ?? [];
    const width = pre ? Math.max(0, ...lines.map(s => s.length)) * 8 : 640;
    const height = pre ? lines.length * 16 : 320;
    return { width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON() {} };
  });
  const host = document.createElement("div"); document.body.append(host);
  const m = createGlyphMap(host, {
    view: { center: [0, 0], span: 60, cols: 80, rows: 20 }, projection: glyphMapEquirectangular(), tilt: 0,
    layers: [{ type: "fill", color: "#789abc", source: { features: [{ rings: [[[-30, -15], [25, -15], [25, 15], [-30, 15], [-30, -15]]] }] } }],
    ...extra,
  });
  maps.push(m);
  return m;
}
afterEach(() => {
  for (const m of maps.splice(0)) { m.destroy(); m.host.remove(); }
  vi.restoreAllMocks(); vi.unstubAllGlobals(); queue.clear();
});

/** A throw released at 2 px/ms, then driven with the given frame spacings until it stops. */
async function fling(m: Map, steps: () => number): Promise<void> {
  pointer(m, "pointerdown", 200); time += 16;
  pointer(m, "pointermove", 232); frame(); time += 16;
  pointer(m, "pointermove", 264); frame();
  pointer(m, "pointerup", 264);
  for (let i = 0; i < 2000 && queue.size; i++) frame(steps());
  expect(queue.size).toBe(0);
  await m.idle();
}

const pose = (m: Map) => { const c = m.scene.camera; return { center: m.getView().center, rotX: c.rotX, rotY: c.rotY, zoom: c.zoom, target: [...c.target], html: m.scene.output.innerHTML }; };

it.each([[false, false], [false, true], [true, false], [true, true]])("lands on the very same pose whatever frame timings carry the fling (compositorPan=%s, snapPan=%s)", async (compositorPan, snapPan) => {
  const a = mount({ compositorPan, snapPan }), b = mount({ compositorPan, snapPan }), c = mount({ compositorPan, snapPan });
  await Promise.all([a.idle(), b.idle(), c.idle()]);
  const start = a.getView().center[0];
  await fling(a, () => 16);
  let k = 0;
  const ragged = [5, 31, 12, 44, 7, 16, 23];
  await fling(b, () => ragged[k++ % ragged.length]!);
  await fling(c, () => 33);
  // It travelled (so agreement is not two maps that never moved) ...
  expect(Math.abs(a.getView().center[0] - start)).toBeGreaterThan(5);
  // ... and every schedule ended on the identical pose, to the last bit: preparation is keyed on exact equality.
  expect(pose(b)).toEqual(pose(a));
  expect(pose(c)).toEqual(pose(a));
});

it("computing where the glide ends leaves the live pose where the throw left it", async () => {
  const m = mount({ compositorPan: false }); await m.idle();
  pointer(m, "pointerdown", 200); time += 16;
  pointer(m, "pointermove", 232); frame(); time += 16;
  pointer(m, "pointermove", 264); frame();
  pointer(m, "pointerup", 264);
  const released = m.getView().center[0];
  const at: number[] = [];
  for (let i = 0; i < 3; i++) { frame(); at.push(m.getView().center[0] - released); }
  // Offsets after 16, 32 and 48 ms of the throw: the ratio is the law's, whatever the speed.
  const reach = (t: number) => 1 - Math.exp(-t / 220);
  expect(at[1]! / at[0]!).toBeCloseTo(reach(32) / reach(16), 9);
  expect(at[2]! / at[0]!).toBeCloseTo(reach(48) / reach(16), 9);
});
