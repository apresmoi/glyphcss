/**
 * The glide's trajectory is frozen: its positions at every frame, at several
 * frame cadences, are the ones the per-frame stepping produced before
 * glide-end preparation existed (recorded from base commit 75760c53 into
 * fixtures/glideTrajectory.json). Preparing for a glide's end must never
 * change how it moves.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { glyphMapEquirectangular } from "./projection";

const FIXTURE = path.resolve(__dirname, "../fixtures/glideTrajectory.json");
const CADENCES: Record<string, () => number> = {
  "60hz": () => 16,
  "60hz-exact": () => 1000 / 60,
  "120hz": () => 1000 / 120,
  "144hz": () => 1000 / 144,
  irregular: (() => { const steps = [5, 31, 12, 44, 7, 16, 23]; let k = 0; return () => steps[k++ % steps.length]!; })(),
};

let queue = new Map<number, FrameRequestCallback>(), time = 100, next = 0;
const maps: { destroy(): void; host: HTMLElement }[] = [];
function frame(step: number) {
  const work = [...queue.values()]; queue.clear(); time += step;
  for (const cb of work) cb(time);
}
afterEach(() => {
  for (const m of maps.splice(0)) { m.destroy(); m.host.remove(); }
  vi.restoreAllMocks(); vi.unstubAllGlobals(); queue.clear();
});

async function record(snapPan: boolean) {
  const { createGlyphMap } = await import(/* @vite-ignore */ process.env.GLIDE_IMPL ?? "./widget");
  const out: Record<string, { frames: number; centers: [number, number][] }> = {};
  for (const [name, cadence] of Object.entries(CADENCES)) {
    time = 100; queue.clear();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { queue.set(++next, cb); return next; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => queue.delete(id));
    vi.spyOn(performance, "now").mockImplementation(() => time);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const pre = this.tagName === "PRE";
      const lines = this.textContent?.split("\n") ?? [];
      const width = pre ? Math.max(0, ...lines.map(s => s.length)) * 8 : 640;
      return { width, height: pre ? lines.length * 16 : 320, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, toJSON() {} };
    });
    const host = document.createElement("div"); document.body.append(host);
    const m = createGlyphMap(host, {
      view: { center: [0, 0], span: 60, cols: 80, rows: 20 }, projection: glyphMapEquirectangular(), tilt: 0, snapPan, compositorPan: true,
      layers: [{ type: "fill", color: "#789abc", source: { features: [{ rings: [[[-30, -15], [25, -15], [25, 15], [-30, 15], [-30, -15]]] }] } }],
    });
    maps.push(m);
    await m.idle();
    const touch = (type: string, x: number) => {
      const e = new PointerEvent(type, { pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: 150, bubbles: true });
      Object.defineProperty(e, "timeStamp", { value: time });
      host.dispatchEvent(e);
    };
    touch("pointerdown", 200); touch("pointermove", 230); frame(16); touch("pointermove", 260); frame(16); touch("pointermove", 290); frame(16); touch("pointerup", 290);
    const centers: [number, number][] = [];
    for (let i = 0; i < 4000 && queue.size; i++) { frame(cadence()); centers.push([...m.getView().center] as [number, number]); }
    out[name] = { frames: centers.length, centers };
    m.destroy(); host.remove(); maps.length = 0;
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
  return out;
}

it.each([false, true])("moves exactly as the base commit's glide did at every frame cadence (snapPan=%s)", async snapPan => {
  // Through JSON, as the fixture was stored: it does not keep the sign of a zero.
  const got = JSON.parse(JSON.stringify(await record(snapPan))) as Awaited<ReturnType<typeof record>>;
  if (process.env.GLIDE_RECORD) {
    const all = JSON.parse(readFileSync(FIXTURE, "utf8").trim() || "{}");
    all[String(snapPan)] = got;
    writeFileSync(FIXTURE, JSON.stringify(all));
    return;
  }
  const want = JSON.parse(readFileSync(FIXTURE, "utf8"))[String(snapPan)] as typeof got;
  for (const name of Object.keys(CADENCES)) {
    expect(got[name]!.frames, `${name}: frames`).toBeGreaterThan(20);
    expect(got[name]!.frames, `${name}: duration in frames`).toBe(want[name]!.frames);
    expect(got[name]!.centers, `${name}: positions`).toEqual(want[name]!.centers);
  }
});
