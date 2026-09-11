/**
 * The reported defect, third pass: "labels still flicker".
 *
 * ROOT CAUSE — the FIRST of the four candidate mechanisms after all
 * (the point runtime rebuilding), on the path the second pass never sampled.
 * `e60d3c5` traced `mount / down / drag… / up / settle` and correctly found
 * that nothing is removed or re-added DURING a drag. The rebuild happens
 * 180 ms AFTER it, on `scheduleTileUpdate`'s debounce — and
 * `createFeatureLayerRuntime.update()` calls `rebuild()` unconditionally,
 * even when the sweep resolved the very same cached tiles. Measured on the
 * reported view (a 40 px pan that fetched no tile at all), a
 * `MutationObserver` on `.glyph-hotspot-layer` recorded `+4298 -4298` after
 * every single gesture.
 *
 * That rebuild is what paints. A hotspot `<div>` is created with no
 * `opacity`, i.e. the CSS default 1, and only the declutter arbiter — which
 * runs at the END of the rebuild — writes `opacity: 0` on the labels it
 * dropped. In between, `sync()` reads layout (`projectionGrid()` is two
 * `getBoundingClientRect()` calls, and `project()` calls it PER RECORD), so
 * the browser RESOLVES STYLE for the freshly inserted elements while they
 * are still at opacity 1. Writing 0 afterwards is therefore a real change
 * between two resolved styles, and `/maps`' own
 * `.glyph-map-symbol { transition: opacity 120ms linear }` animates it: for
 * ~120 ms after every gesture every place name on Earth is painted over the
 * map and fades out.
 *
 * WHY A DOM TRACE CANNOT SEE IT: the DOM is correct at every frame boundary
 * — a `requestAnimationFrame` sampler reads `shown = 67` throughout. What
 * paints is the TRANSITION, off a computed style the DOM no longer holds. It
 * took a CDP screencast (12 consecutive composited frames, monotonically
 * shrinking PNGs — the fade) to see it at all.
 *
 * So this file pins the two properties that make the animation impossible
 * rather than the animation itself, which no DOM environment can observe:
 *
 *   1. A label is never INSERTED in a shown state. It is created already at
 *      `opacity: 0` and the arbiter raises the winners, so the first style
 *      the browser ever resolves for it is its final one.
 *   2. A rebuild resolves NO layout between the first insertion and the last
 *      opacity write — the grid is captured once, up front, before anything
 *      is removed — so there is no earlier resolved style for a transition to
 *      run from, and the rebuild stops paying two forced layouts per record.
 *   3. A sweep that resolved the same tiles does not rebuild at all, so the
 *      common case (every gesture that does not cross a tile boundary) costs
 *      no DOM churn whatsoever.
 *
 * FIXTURE: the real vendored OpenFreeMap world tile, decoded by the real
 * provider through an injected transport. No network.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import { glyphMapOpenFreeMapProvider } from "./vector/openfreemap";
import { glyphMapOpenMapTilesLayers } from "./vector/openmaptiles";
import type { GlyphMapVectorProvider } from "./vector/types";

const FIXTURE = path.resolve(__dirname, "../fixtures/openfreemap/z0-0-0.mvt");
const WORLD = readFileSync(FIXTURE);

const COLS = 140, ROWS = 63, CELL_W = 8, CELL_H = 16, BASE_FONT_PX = 13;
const rect = (w: number, h: number) =>
  ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
const EMPTY_RECT = rect(0, 0);
const stubbedHosts = new Set<HTMLElement>();
let layoutReads = 0;

/**
 * happy-dom has no layout, and glyphcss's own cell probe is a FRESH `<pre>`
 * per measurement, so the prototype is what has to answer — see
 * `widget.bearing.test.ts`, which this mirrors. `BASE_FONT_PX` is 13 rather
 * than 16 on purpose: that is what `createGlyphScene`'s `baseFontPx()` falls
 * back to when `getComputedStyle` gives nothing, and a stub that disagrees
 * with it makes the camera and the cell size scale by different factors the
 * moment anything changes the font.
 */
function stubMonospaceMetrics(host: HTMLElement): void {
  stubbedHosts.add(host);
  if (vi.isMockFunction(Element.prototype.getBoundingClientRect)) return;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    layoutReads++;
    const el = this as HTMLElement;
    if (stubbedHosts.has(el)) return rect(COLS * CELL_W, ROWS * CELL_H);
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY_RECT;
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? String(BASE_FONT_PX));
    const k = fontPx / BASE_FONT_PX;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

/** The vendored world tile, served for whatever address the sweep asks for, with no network. */
function worldProvider(): GlyphMapVectorProvider {
  return glyphMapOpenFreeMapProvider({
    minZoom: 0, maxZoom: 0, layers: ["place"],
    fetchTile: async () => WORLD.buffer.slice(WORLD.byteOffset, WORLD.byteOffset + WORLD.byteLength),
  });
}

const labels = (h: HTMLElement) => [...h.querySelectorAll<HTMLElement>(".glyph-map-symbol")];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The layout reads and the label insertions of a rebuild, on ONE timeline.
 *
 * `glyphcss`'s `addHotspot` creates and appends the element itself, so the
 * widget cannot hand it an initial `opacity` — the earliest it can speak is
 * the statement after. What therefore has to hold is not "inserted at
 * opacity 0" but the property that makes that distinction invisible to the
 * browser: NO STYLE RESOLUTION between the first insertion and the arbiter's
 * verdict. A resolution is a `getBoundingClientRect()`, and the stub above
 * counts every one, so the timeline is the whole proof: if the count at the
 * first insertion equals the count at the end of the rebuild, the browser
 * only ever resolved these elements once, with their final opacity, and no
 * `transition: opacity` can have anything to run from.
 *
 * A `MutationObserver` cannot answer this — its callback is a microtask that
 * runs after the entire rebuild, by which time the arbiter has already
 * written the final value and the reads have already happened.
 */
function recordInsertions(): { readonly readsAtInsert: number[]; readonly opacityWhenNextArrived: string[]; restore: () => void } {
  const readsAtInsert: number[] = [];
  /**
   * The opacity the PREVIOUS hotspot carried at the instant the next one was
   * appended. That is how "hidden from the moment it exists" is observable at
   * all: `addHotspot` creates and appends the element, so the widget's own
   * write lands one statement later and an `appendChild` hook can only ever
   * see `""` for the element being inserted — but it sees the finished state
   * of the one before it.
   */
  const opacityWhenNextArrived: string[] = [];
  let previous: HTMLElement | null = null;
  const original = Node.prototype.appendChild;
  Node.prototype.appendChild = function <T extends Node>(this: Node, node: T): T {
    if ((this as HTMLElement)?.classList?.contains?.("glyph-hotspot-layer")) {
      readsAtInsert.push(layoutReads);
      if (previous) opacityWhenNextArrived.push(previous.style.opacity);
      previous = node as unknown as HTMLElement;
    }
    return original.call(this, node) as T;
  };
  return { readsAtInsert, opacityWhenNextArrived, restore: () => { Node.prototype.appendChild = original; } };
}

async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: 200, cols: COLS, rows: ROWS },
    projection: glyphMapEquirectangular(),
    tilt: 0,
  });
  const layer = glyphMapOpenMapTilesLayers(worldProvider(), { include: ["omt-places"] })[0]!;
  map.addLayer(layer);
  await vi.waitFor(() => expect(labels(host).length).toBeGreaterThan(100), { timeout: 5000 });
  return { host, map, teardown: () => { map.destroy(); host.remove(); } };
}

describe("a tile sweep must not re-create the labels it already has", () => {
  /**
   * The measured defect: a gesture that crosses no tile boundary still tore
   * down and re-created every label. Asserted as ELEMENT IDENTITY, not as a
   * count — the count was identical before and after (`+4298 -4298`), which
   * is exactly why the previous pass's count-based trace read clean.
   */
  it("keeps every label element across a sweep that resolves the same tiles", async () => {
    const { host, map, teardown } = await mount();
    try {
      const before = labels(host);
      expect(before.length).toBeGreaterThan(100);

      // A pan far too small to change the tile set — the reported gesture.
      map.setView({ center: [0.4, 0.2] });
      await sleep(400);

      const after = labels(host);
      expect(after.length).toBe(before.length);
      // Reference identity, element for element.
      expect(after.every((el, i) => el === before[i])).toBe(true);
    } finally { teardown(); }
  });

  /**
   * The half that makes a rebuild — when one is genuinely needed — safe.
   * From the moment the FIRST label enters the document to the moment the
   * arbiter has written every opacity, the rebuild resolves layout zero
   * times, so a fresh label's first and only computed style already carries
   * the verdict.
   *
   * Measured before the fix, on this fixture: 2 reads per record inside
   * `sync` alone, i.e. the count kept climbing for the whole rebuild.
   */
  it("resolves layout zero times between the first label insertion and the arbiter's verdict", async () => {
    const rec = recordInsertions();
    try {
      const { host, teardown } = await mount();
      try {
        const count = labels(host).length;
        expect(count).toBeGreaterThan(100);
        expect(rec.readsAtInsert.length).toBeGreaterThanOrEqual(count);
        const first = rec.readsAtInsert[0]!;
        // Every later insertion saw the same count...
        expect(rec.readsAtInsert.at(-1)).toBe(first);
        // ...and so did the verdict: nothing read layout after them either.
        expect(layoutReads).toBe(first);
        // And the verdict really was written — a rebuild that decided
        // nothing would satisfy the clause above vacuously.
        const opacities = new Set(labels(host).map((el) => el.style.opacity));
        expect(opacities.has("0")).toBe(true);
        expect(opacities.has("")).toBe(false);
        // Belt AND braces, and both are pinned: quite apart from nothing
        // resolving style in the window, a label is HIDDEN from the moment
        // it exists, so even a consumer that forces a layout mid-rebuild
        // (a `ResizeObserver`, devtools) cannot catch one in the shown state.
        expect(rec.opacityWhenNextArrived.length).toBe(count - 1);
        expect(new Set(rec.opacityWhenNextArrived)).toEqual(new Set(["0"]));
      } finally { teardown(); }
    } finally { rec.restore(); }
  });

  /**
   * The cost half of the same statement, stated in the units that made it
   * visible: a sweep used to force two synchronous layouts PER LABEL
   * (`project()` measures the grid itself, and `sync` calls it once per
   * record), which at the reported view is ~8,600 of them and a ~200 ms
   * stall after every gesture.
   *
   * `durationMs: 0` and `idle()` rather than a blend and a sleep: a
   * TRANSITION re-derives the framing and reprojects the geometry on every
   * animation frame, so a fixed sleep counts the frames that fit inside it
   * and not the rebuild this test is about — and the cheaper the rebuild
   * gets, the more frames fit. (Measured when the point runtime learned to
   * RECONCILE: the same 50 ms window went from 7 blend frames to 13, and the
   * count this asserts on doubled while the rebuild it names got strictly
   * cheaper.) An instant projection change is one forced rebuild and nothing
   * else, which is what the assertion has always meant.
   */
  it("measures the grid once for a whole rebuild, not once per label", async () => {
    const { host, map, teardown } = await mount();
    try {
      const count = labels(host).length;
      expect(count).toBeGreaterThan(100);
      layoutReads = 0;
      // A projection change re-derives every anchor's world position, so
      // this path may never be skipped — it is the forced rebuild.
      map.setProjection(glyphMapEquirectangular(), { durationMs: 0 });
      await map.idle();
      expect(labels(host).length).toBe(count);
      expect(layoutReads).toBeLessThan(count);
    } finally { teardown(); }
  });
});
