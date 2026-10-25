/**
 * The debounced tile sweep starts every layer's update. With cached tiles each
 * layer's rebuild and render runs in the microtasks behind its start, so
 * starting them back to back made one task of every layer's cost; each layer
 * now starts in a task of its own and the renders that landings owe in between
 * are one render. The settled output is the unsplit sweep's.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createGlyphMap, type GlyphMapLayer } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import { glyphMapPrerenderTuning } from "./prerender";
import type { GlyphMapVectorFeature, GlyphMapVectorProvider, GlyphMapVectorTile } from "./vector/types";

type Map = ReturnType<typeof createGlyphMap>;
const maps: Map[] = [];
let renders = 0;
const tuning = { ...glyphMapPrerenderTuning };
const CENTRE: readonly [number, number] = [8.54, 47.375];

function mount(layers: GlyphMapLayer[]): Map {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const pre = this.tagName === "PRE";
    const lines = this.textContent?.split("\n") ?? [];
    const width = pre ? Math.max(0, ...lines.map(s => s.length)) * 8 : 640;
    return { width, height: pre ? lines.length * 16 : 320, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, toJSON() {} };
  });
  const host = document.createElement("div"); document.body.append(host);
  const m = createGlyphMap(host, {
    view: { center: [CENTRE[0], CENTRE[1]], span: 0.006, cols: 80, rows: 20 },
    projection: glyphMapEquirectangular({ exaggeration: 24 }), tilt: 0, layers,
  });
  maps.push(m);
  return m;
}
beforeEach(() => { Object.assign(glyphMapPrerenderTuning, { restPrepare: false }); });
afterEach(() => {
  Object.assign(glyphMapPrerenderTuning, tuning);
  globalThis.__glyphRenderStage = undefined;
  for (const m of maps.splice(0)) { m.destroy(); m.host.remove(); }
  vi.restoreAllMocks(); renders = 0;
});

const world = { west: -180, east: 180, south: -90, north: 90 };
const road = (dy: number): GlyphMapVectorFeature => ({
  id: `road${dy}`, geometryType: "line",
  rings: [[[CENTRE[0] - 0.02, CENTRE[1] + dy], [CENTRE[0], CENTRE[1] + dy * 1.4], [CENTRE[0] + 0.02, CENTRE[1] + dy]]],
});
/** A line pyramid whose tile set grows from one tile to two when `phase.n` becomes 1; `onSweep` runs at each sweep's start of this layer. */
function provider(id: string, phase: { n: number }, dy: number, onSweep: () => void): GlyphMapVectorProvider {
  return {
    id, zooms: [{ z: 1, cols: 2, rows: 1, tileLonSpan: 180, tileLatSpan: 180, tileCols: 256, tileRows: 256 }],
    bounds: () => world,
    tileRange: () => { onSweep(); return { x0: 0, x1: phase.n, y0: 0, y1: 0 }; },
    async loadTile(z, x, y): Promise<GlyphMapVectorTile> {
      return { z, x, y, bounds: world, source: "test", layers: { road: x === 0 ? [] : [road(dy)] } };
    },
  };
}
const COLORS = ["#33ccff", "#ffcc33", "#cc33ff"];
const layers = (phase: { n: number }, onSweep: (i: number) => void): GlyphMapLayer[] =>
  COLORS.map((color, i) => ({ type: "line", id: `late-${i}`, color, experimentalGlyphStrategy: "braille", sourceLayer: "road", source: provider(`late-${i}`, phase, 0.0002 * (i + 1), () => onSweep(i)) }) as GlyphMapLayer);

/** Runs the debounced sweep that follows a view nudge, with the tile sets growing, and reports in which task each layer started. */
async function sweep(split: boolean) {
  glyphMapPrerenderTuning.sweepSplit = split;
  const phase = { n: 0 };
  const marks: { fired: boolean }[] = [], separate: boolean[] = [];
  let armed = false;
  const m = mount(layers(phase, () => {
    if (!armed) return;
    const prev = marks[marks.length - 1];
    separate.push(prev ? prev.fired : true);
    const mark = { fired: false }; marks.push(mark);
    setTimeout(() => { mark.fired = true; }, 0);
  }));
  await m.idle();
  globalThis.__glyphRenderStage = stage => { if (stage === "base-validate") renders++; };
  phase.n = 1; armed = true; renders = 0;
  m.setView({ span: 0.00601 });
  renders = 0;
  await m.idle();
  return { m, separate, renders, html: m.scene.output.innerHTML };
}

it("starts each layer's sweep in a task of its own, and settles to the bytes of the unsplit sweep", async () => {
  const split = await sweep(true);
  // Three layers, three starts, each after the previous start's task had ended.
  expect(split.separate).toEqual([true, true, true]);
  const whole = await sweep(false);
  expect(whole.separate.slice(1)).toEqual([false, false]);
  for (const color of COLORS) expect(split.html).toContain(color);
  expect(split.html).toBe(whole.html);
});

it("renders the landings of one sweep's layers once, not once per layer", async () => {
  const split = await sweep(true);
  expect(split.renders).toBe(1);
});
