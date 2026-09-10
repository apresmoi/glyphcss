/**
 * `setInteracting(true)` divides `options.cols`/`rows` IN PLACE, so
 * `getOptions()` reports the coarser RENDER grid for the whole of a gesture.
 * That is the honest answer for anything measured in rasterized cells, and the
 * wrong one for anything measured against the DOM: the downscale changes the
 * `<pre>`'s font size and nothing else on the page, so a consumer's own
 * overlay (`@glyphcss/maps`' `symbol` labels are the reference case) keeps its
 * CSS pixel size while the cell it is expressed in grows by the downscale.
 *
 * `getBaseResolution()` is the only way to recover the grid such an overlay is
 * actually laid out in while a gesture holds. It has to hold for an `autoSize`
 * scene too, which is why the base pair is captured on BOTH branches of
 * `setInteracting` even though only one of them restores from it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { createGlyphScene } from "./createGlyphScene";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import type { Polygon } from "@glyphcss/core";

const HOST_W = 640, HOST_H = 320, CELL_W = 8, CELL_H = 16, BASE_FONT_PX = 16;

function rect(width: number, height: number): DOMRect {
  return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
}

/**
 * The font size a probe would actually lay out at. happy-dom does no cascade,
 * and `measureCell`'s probe is a literal `font-size: inherit` `<span>` inside
 * the `<pre>` (only `measureCellOf`'s carries the size on itself), so the
 * walk up is what makes the size `setInteracting` writes reach the
 * measurement at all.
 */
function resolvedFontPx(el: HTMLElement): number {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const px = parseFloat(node.style.fontSize);
    if (Number.isFinite(px)) return px;
  }
  return BASE_FONT_PX;
}

/**
 * happy-dom has no layout, and `measureCellOf` creates its OWN hidden `<pre>`
 * probe per measurement — so without a prototype-level stub the `autoSize`
 * branch under test never runs at all and the case would pass whether or not
 * the fix is present (`createGlyphScene.hostRect.test.ts`'s own note). The
 * probe's reported advance follows the font-size `setInteracting` writes,
 * which is what makes `fitToHost()` actually re-fit to a coarser cell.
 */
function stubLayout(host: HTMLElement): void {
  // `fitToHost()` sizes from `clientWidth`/`clientHeight`, which happy-dom
  // reports as 0 and which no `getBoundingClientRect` stub reaches — without
  // these it returns early and `autoSize` never fits at all.
  Object.defineProperty(host, "clientWidth", { value: HOST_W, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: HOST_H, configurable: true });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (el === host) return rect(HOST_W, HOST_H);
    const k = resolvedFontPx(el) / BASE_FONT_PX;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

const QUAD: Polygon[] = [{ vertices: [[-3, -3, 0], [-3, 3, 0], [3, 3, 0], [3, -3, 0]], color: "#8899aa" }];

function mount(opts: { autoSize: boolean; interactiveDownscale?: number }) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  host.style.fontSize = `${BASE_FONT_PX}px`;
  stubLayout(host);
  const scene = createGlyphScene(host, {
    camera: createGlyphOrthographicCamera({ zoom: 20 }),
    cols: 60,
    rows: 20,
    autoSize: opts.autoSize,
    ...(opts.interactiveDownscale !== undefined ? { interactiveDownscale: opts.interactiveDownscale } : {}),
  });
  scene.add(QUAD);
  return { host, scene, done: () => { scene.destroy(); host.remove(); } };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("getBaseResolution", () => {
  it("equals getOptions()'s pair when the scene is not interacting", () => {
    const { scene, done } = mount({ autoSize: false, interactiveDownscale: 3 });
    try {
      const o = scene.getOptions();
      expect(scene.getBaseResolution()).toEqual({ cols: o.cols, rows: o.rows });
    } finally { done(); }
  });

  it("keeps reporting the pre-gesture grid while a fixed-size scene is downscaled", () => {
    const { scene, done } = mount({ autoSize: false, interactiveDownscale: 3 });
    try {
      const before = { cols: scene.getOptions().cols, rows: scene.getOptions().rows };
      expect(before).toEqual({ cols: 60, rows: 20 });

      scene.setInteracting(true);
      // The premise: the RENDER grid really did get coarser.
      expect(scene.getOptions().cols).toBeLessThan(before.cols);
      expect(scene.getOptions().rows).toBeLessThan(before.rows);
      // The guarantee: the base pair survives the gesture untouched.
      expect(scene.getBaseResolution()).toEqual(before);

      scene.setInteracting(false);
      expect({ cols: scene.getOptions().cols, rows: scene.getOptions().rows }).toEqual(before);
      expect(scene.getBaseResolution()).toEqual(before);
    } finally { done(); }
  });

  /**
   * The branch that has no `savedInteract*` restore of its own: an `autoSize`
   * scene re-derives cols/rows from the restored font on the way out, so the
   * base pair is only knowable if it was captured on the way IN.
   */
  it("holds for an autoSize scene, whose exit path re-fits rather than restoring", () => {
    const { scene, done } = mount({ autoSize: true, interactiveDownscale: 2 });
    try {
      const before = { cols: scene.getOptions().cols, rows: scene.getOptions().rows };
      expect(before.cols).toBeGreaterThan(2);

      scene.setInteracting(true);
      expect(scene.getOptions().cols).toBeLessThan(before.cols);
      expect(scene.getBaseResolution()).toEqual(before);

      scene.setInteracting(false);
      expect(scene.getBaseResolution()).toEqual(before);
    } finally { done(); }
  });

  /**
   * A gesture is not the only thing that can move the grid during a gesture:
   * a `ResizeObserver` fires `fit()` whenever the host changes, and on a
   * phone that is what a rotation or an address-bar collapse does mid-drag.
   * The base pair captured on the way IN is stale from that moment, and the
   * consumer reading it (`@glyphcss/maps`' label placement) reserves boxes at
   * the wrong scale for the rest of the gesture — silently, since the wrong
   * answer is a plausible grid.
   */
  it("follows a host resize that lands mid-gesture", () => {
    const { host, scene, done } = mount({ autoSize: true, interactiveDownscale: 2 });
    try {
      const before = { cols: scene.getOptions().cols, rows: scene.getOptions().rows };
      scene.setInteracting(true);
      expect(scene.getBaseResolution()).toEqual(before);

      // What the ResizeObserver does when the host doubles in width.
      Object.defineProperty(host, "clientWidth", { value: HOST_W * 2, configurable: true });
      scene.fit();

      // The render grid followed the host; the base pair has to as well, and
      // it is the grid the scene WOULD have fitted at full resolution — which
      // is what `setInteracting(false)` then actually fits.
      const duringCols = scene.getOptions().cols;
      expect(duringCols).toBeGreaterThan(scene.getOptions().rows);
      expect(scene.getBaseResolution().cols).toBeGreaterThan(before.cols);

      scene.setInteracting(false);
      expect(scene.getBaseResolution()).toEqual({ cols: scene.getOptions().cols, rows: scene.getOptions().rows });
    } finally { done(); }
  });

  it("is inert when interactiveDownscale is 1 — setInteracting changes nothing to recover", () => {
    const { scene, done } = mount({ autoSize: false });
    try {
      const before = { cols: scene.getOptions().cols, rows: scene.getOptions().rows };
      scene.setInteracting(true);
      expect({ cols: scene.getOptions().cols, rows: scene.getOptions().rows }).toEqual(before);
      expect(scene.getBaseResolution()).toEqual(before);
      scene.setInteracting(false);
      expect(scene.getBaseResolution()).toEqual(before);
    } finally { done(); }
  });
});
