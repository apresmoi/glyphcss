/**
 * The reported defect, verbatim: "when I drag and release all the labels
 * flicker and disappear", and "all labels, not just water".
 *
 * ROOT CAUSE — the third of the four candidate mechanisms, not the first.
 * Nothing is removed and nothing is re-added: every `symbol` hotspot survives
 * the whole gesture and keeps its position. What changes is the DECLUTTER
 * ARBITER'S FRAME. `/maps`' drag-density lever drives glyphcss's
 * `interactiveDownscale`, and `scene.setInteracting(true)` divides
 * `options.cols`/`rows` IN PLACE for the duration of the gesture, so
 * `projectionGrid()` — which reads them — reports a grid whose cells are
 * `downscale` times wider in CSS pixels. A label is a DOM sibling of the
 * `<pre>` (`.glyph-hotspot-layer`), taking its font from the consumer's
 * stylesheet, so the downscale does not resize it by one pixel; but the
 * arbiter measures its box as `label.length` CELLS, and so reserves three
 * times the screen width it occupies. Most labels then lose the arbitration
 * and are written `opacity: 0`.
 *
 * WHY THE EARLIER `pointermove`-ONLY FIX MISSED IT: that fix was about
 * STALENESS — `applyDrag` calling `syncNearSideDom()` synchronously so a
 * marker's near/far verdict is never one drag increment behind an
 * out-of-band `scene.rerender()`. Every sweep it added ran against the same
 * downscaled grid, so it made the wrong answer arrive PROMPTLY. It also
 * cannot see the second half of the report: at release the grid is restored
 * but the widget only re-sweeps from a motion frame, and a release that
 * starts no inertial glide schedules none — so the suppressed labels stay
 * suppressed indefinitely, which is the "disappear" as against the "flicker".
 *
 * FIXTURE TRAPS this file is written around:
 *   - happy-dom has no layout, so the host's box is mocked and every position
 *     assertion goes through the DOM the widget actually wrote.
 *   - The map is driven through its OWN pointer handlers, with
 *     `MapsWorkbench.tsx`'s `setInteracting` wiring reproduced exactly
 *     (`pointerdown` arms, the FIRST `pointermove` engages, `pointerup`
 *     settles and then calls `map.scene.rerender()` directly).
 *   - No network: the point pyramid comes from the real
 *     `glyphMapBuildVectorTile`/`glyphMapDecodeVectorTile` pair.
 */
import { describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import { glyphMapBuildVectorTile, glyphMapDecodeVectorTile, glyphMapVectorTileBounds } from "./vector/tile";
import type { GlyphMapVectorFeature, GlyphMapVectorProvider } from "./vector/types";
import type { GlyphMapProviderZoomLevel } from "./provider";
import type { GlyphMapSymbolLayer } from "./widget";

const COLS = 140, ROWS = 63, HOST_W = 1120, HOST_H = 1008;
/** `/maps`' own drag-density lever at 1/3 — the coarsest end of its slider. */
const DOWNSCALE = 3;

function mockHostRect(host: HTMLElement, width: number, height: number): void {
  Object.defineProperty(host, "getBoundingClientRect", {
    value: () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON() {} }),
    configurable: true,
  });
}

interface Place { readonly name: string; readonly lon: number; readonly lat: number; readonly pop: number }

/**
 * Eight names on a 2x4 lattice, spaced so that at the FULL grid every one of
 * them clears its neighbours and at `1/DOWNSCALE` most do not. That gap is
 * the whole discriminator: a fixture whose labels are far enough apart to
 * survive either frame would pass with or without the fix.
 */
const PLACES: readonly Place[] = [
  { name: "Alphaville", lon: -6, lat: 2, pop: 900 },
  { name: "Betatown", lon: -2, lat: 2, pop: 800 },
  { name: "Gammaburg", lon: 2, lat: 2, pop: 700 },
  { name: "Deltacity", lon: 6, lat: 2, pop: 600 },
  { name: "Epsilonia", lon: -6, lat: -2, pop: 500 },
  { name: "Zetaport", lon: -2, lat: -2, pop: 400 },
  { name: "Etaville", lon: 2, lat: -2, pop: 300 },
  { name: "Thetaford", lon: 6, lat: -2, pop: 200 },
];

function feature(p: Place): GlyphMapVectorFeature {
  return { id: p.name, geometryType: "point", properties: { name: p.name, pop: p.pop }, rings: [[[p.lon, p.lat]]] };
}

function zoomLevel(z: number): GlyphMapProviderZoomLevel {
  return { z, cols: 2 ** z, rows: 2 ** z, tileLonSpan: 360 / 2 ** z, tileLatSpan: 180 / 2 ** z, tileCols: 180, tileRows: 90 };
}

/** Real bake -> real decode, exactly like the baked `place-tiles` pyramid. */
function placeProvider(): GlyphMapVectorProvider {
  const features = PLACES.map(feature);
  return {
    id: "places-downscale-test",
    zooms: [0, 1, 2].map(zoomLevel),
    bounds: glyphMapVectorTileBounds,
    async loadTile(z, x, y) {
      return glyphMapDecodeVectorTile(glyphMapBuildVectorTile({ places: features }, z, x, y, { source: "t", simplify: "none" }));
    },
  };
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function firePointer(host: HTMLElement, type: string, x: number, y: number): void {
  host.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
}

function labels(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(".glyph-map-symbol")];
}

/** Labels the arbiter kept — the widget writes `opacity: 0` on the ones it dropped. */
function shownCount(host: HTMLElement): number {
  return labels(host).filter((el) => el.style.opacity !== "0").length;
}

async function mount(symbol: Partial<GlyphMapSymbolLayer> = {}, downscale = DOWNSCALE) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  mockHostRect(host, HOST_W, HOST_H);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: 24, cols: COLS, rows: ROWS },
    projection: glyphMapEquirectangular(),
    tilt: 0,
    ...(downscale > 1 ? { scene: { interactiveDownscale: downscale } } : {}),
    layers: [{ type: "symbol", source: placeProvider(), sourceLayer: "places", textProperty: "name", priorityProperty: "pop", ...symbol } as GlyphMapSymbolLayer],
  });
  await vi.waitFor(() => expect(labels(host).length).toBe(PLACES.length));
  return { host, map, teardown: () => { map.destroy(); host.remove(); } };
}

/**
 * `MapsWorkbench.tsx`'s drag-density wiring, reproduced verbatim: the widget
 * owns its own pointer handlers and never calls `setInteracting` for a drag,
 * so the page drives it from the same native events, engaging on the FIRST
 * `pointermove` (never on `pointerdown`) and settling with a direct
 * `map.scene.rerender()` on release.
 */
function wirePageDragDensity(host: HTMLElement, map: ReturnType<typeof createGlyphMap>): () => void {
  let pointerDown = false, dragging = false;
  const onDown = (): void => { pointerDown = true; };
  const onMove = (): void => { if (!pointerDown || dragging) return; dragging = true; map.scene.setInteracting(true); };
  const onUp = (): void => {
    pointerDown = false;
    if (!dragging) return;
    dragging = false;
    map.scene.setInteracting(false);
    map.scene.rerender();
  };
  host.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  return () => {
    host.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
}

describe("symbol labels survive a drag under interactiveDownscale", () => {
  /**
   * The reported gesture end to end, sampled at EVERY frame it produces. The
   * count is asserted per frame rather than only at rest, because the defect
   * is a window: measured before the fix this printed
   * `8, 8, 4, 4, 4, 4, 4, 4, 4, 8, 8, ...` — full at mount and at pointerdown,
   * four for every drag frame, still four at the instant of release (the grid
   * is already restored there, and nothing has re-swept), and back to eight
   * only once the inertial glide's first motion frame ran.
   */
  it("never drops a label between mount and settle, at any frame of a drag-and-release", async () => {
    const { host, map, teardown } = await mount();
    const unwire = wirePageDragDensity(host, map);
    try {
      const counts: { at: string; shown: number; cols: number }[] = [];
      const sample = (at: string): void => { counts.push({ at, shown: shownCount(host), cols: map.scene.getOptions().cols ?? COLS }); };

      sample("mount");
      firePointer(host, "pointerdown", 400, 300);
      sample("pointerdown");
      for (let i = 1; i <= 6; i++) {
        firePointer(host, "pointermove", 400 + i * 4, 300);
        await frame();
        sample(`drag-${i}`);
      }
      firePointer(host, "pointerup", 400 + 24, 300);
      sample("pointerup");
      for (let i = 1; i <= 5; i++) { await frame(); sample(`settle-${i}`); }

      // The premise: the render grid really did coarsen for the drag, so the
      // case cannot pass by never engaging the mechanism it is about.
      const dragCols = counts.filter((c) => c.at.startsWith("drag-")).map((c) => c.cols);
      expect(new Set(dragCols)).toEqual(new Set([Math.max(2, Math.round(COLS / DOWNSCALE))]));
      expect(counts[0]!.cols).toBe(COLS);
      expect(counts.at(-1)!.cols).toBe(COLS);

      // The guarantee: not one frame of the gesture lost a label.
      expect(counts.map((c) => `${c.at}:${c.shown}`)).toEqual(counts.map((c) => `${c.at}:${PLACES.length}`));
      // And nothing was rebuilt to achieve it — same elements throughout.
      expect(labels(host)).toHaveLength(PLACES.length);
    } finally { unwire(); teardown(); }
  });

  /**
   * The "disappear" half, as against the "flicker" half. A release that
   * starts no inertial glide schedules no motion frame, and the widget's
   * marker sweep only runs from one — so before the fix the suppression that
   * began at the first `pointermove` outlived the gesture entirely, with no
   * later event able to heal it.
   */
  it("a paused release, which starts no glide and therefore no motion frame, leaves every label shown", async () => {
    const { host, map, teardown } = await mount();
    const unwire = wirePageDragDensity(host, map);
    try {
      firePointer(host, "pointerdown", 400, 300);
      for (let i = 1; i <= 4; i++) { firePointer(host, "pointermove", 400 + i * 5, 300); await frame(); }
      // Longer than the widget's own 60ms fling window, so `pointerup` takes
      // the no-inertia branch.
      await sleep(120);
      firePointer(host, "pointerup", 420, 300);

      expect(map.scene.getOptions().cols).toBe(COLS);
      expect(shownCount(host)).toBe(PLACES.length);
      // Still nothing hidden well after any frame or debounce could have run.
      await frame(); await sleep(250); await frame();
      expect(shownCount(host)).toBe(PLACES.length);
    } finally { unwire(); teardown(); }
  });

  /**
   * `textOffset` is documented in CELLS, and the widget turns it into CSS
   * pixels with the cell size it reads. Under the live grid that length
   * tripled on grab and shrank back on release, so a placed label visibly slid
   * and slid back — the same root cause reaching the other half of the DOM
   * write. Asserted as an exact per-frame position, not merely as "present".
   */
  it("holds a textOffset label at the same pixel displacement for every frame of the gesture", async () => {
    const { host, map, teardown } = await mount({ textAnchor: "left", textOffset: [2, 0] });
    const unwire = wirePageDragDensity(host, map);
    try {
      const at = (): string => labels(host)[0]!.style.transform;
      // The offset is 2 cells of the BASE grid, and `projectionGrid()` defines
      // the cell as the rendered width over `cols`.
      const expected = `translate(calc(0% + ${2 * (HOST_W / COLS)}px), -50%)`;
      expect(at()).toBe(expected);

      firePointer(host, "pointerdown", 400, 300);
      for (let i = 1; i <= 5; i++) {
        firePointer(host, "pointermove", 400 + i * 4, 300);
        await frame();
        expect(at()).toBe(expected);
      }
      firePointer(host, "pointerup", 420, 300);
      expect(at()).toBe(expected);
      await frame();
      expect(at()).toBe(expected);
    } finally { unwire(); teardown(); }
  });

  /**
   * The conversion is exactly `1` on both axes whenever the scene is not
   * interacting, so a map that never downscales — every map built before this
   * option was reachable — arbitrates on exactly the numbers it always did.
   * Pinned against the same gesture run with no `interactiveDownscale` at all,
   * cell for cell rather than as a count.
   */
  it("is inert for a map with no interactiveDownscale — identical opacities frame by frame", async () => {
    const plain = await mount({}, 1);
    const unwirePlain = wirePageDragDensity(plain.host, plain.map);
    const withDs = await mount({}, DOWNSCALE);
    const unwireDs = wirePageDragDensity(withDs.host, withDs.map);
    try {
      const opacities = (h: HTMLElement): string[] => labels(h).map((el) => el.style.opacity);
      const trace: { plain: string[][]; ds: string[][] } = { plain: [], ds: [] };

      for (const [tag, target] of [["plain", plain], ["ds", withDs]] as const) {
        firePointer(target.host, "pointerdown", 400, 300);
        for (let i = 1; i <= 4; i++) {
          firePointer(target.host, "pointermove", 400 + i * 6, 300);
          await frame();
          trace[tag].push(opacities(target.host));
        }
        firePointer(target.host, "pointerup", 424, 300);
        trace[tag].push(opacities(target.host));
      }

      expect(plain.map.scene.getOptions().cols).toBe(COLS);
      expect(trace.ds).toEqual(trace.plain);
    } finally { unwirePlain(); unwireDs(); plain.teardown(); withDs.teardown(); }
  });
});
