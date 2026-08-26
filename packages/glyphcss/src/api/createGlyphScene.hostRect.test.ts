/**
 * `baseProjectionGrid()` re-centers an `autoSize` scene's projection from the
 * HOST element's box. That read is a forced synchronous layout flush, and it sat
 * on the per-render path: every camera frame measured the host again even though
 * its box only changes when the host resizes.
 *
 * Profiled in a real browser (a moving first-person scene, 353x120 cells), the
 * host measurement was the single largest cost in the frame — larger than the
 * rasteriser — at ~4.4ms/frame of layout, and caching it moved that scene from
 * 70fps to 98fps. So the host box is cached with the same lifetime as the cell
 * probes beside it: invalidated by `fitToHost()`, which is both the
 * ResizeObserver callback and the public `fit()`.
 *
 * Only width/height are read, so a scroll (which moves x/y and fires no resize)
 * cannot stale the cache.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { createGlyphScene } from "./createGlyphScene";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import type { Polygon } from "@glyphcss/core";

const HOST_W = 640;
const HOST_H = 320;

function rect(width: number, height: number): DOMRect {
  return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
}

/**
 * Counts layout reads against the HOST element only, so the base/detail cell
 * probes (hidden `<span>`/`<pre>` children) can't be mistaken for host reads.
 *
 * jsdom has no layout engine, so this also gives the probes a realistic
 * monospace advance — without it `measureCellOf`'s zero-size fallback leaves
 * `cell.measured` false and the `autoSize` branch under test never runs at all,
 * which would pass whether or not the fix is present.
 */
function countHostReads(host: HTMLElement): { calls: () => number; reset: () => void } {
  let n = 0;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (el === host) {
      n++;
      return rect(HOST_W, HOST_H);
    }
    const fontSizePx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? "16");
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(fontSizePx * 0.6, fontSizePx * 1.2 * lines);
  });
  return { calls: () => n, reset: () => { n = 0; } };
}

function quad(): Polygon[] {
  return [{ vertices: [[-3, -3, 0], [-3, 3, 0], [3, 3, 0], [3, -3, 0]], color: "#8899aa" }];
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("createGlyphScene — autoSize host measurement is not a per-frame layout flush", () => {
  it("does not re-measure the host on steady-state camera renders", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const probe = countHostReads(host);

    const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 1 });
    const scene = createGlyphScene(host, { autoSize: true, cols: 40, rows: 20, camera });
    scene.add(quad());
    scene.rerender(); // cold fill: the first frame after a fit legitimately measures once

    probe.reset();
    for (let i = 0; i < 12; i++) {
      camera.rotY = i * 3;
      scene.rerender();
    }

    // Before the fix this was one host layout flush per render (12).
    expect(probe.calls()).toBe(0);
  });

  it("re-measures the host after fit(), so a resize still re-centers", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const probe = countHostReads(host);

    const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 1 });
    const scene = createGlyphScene(host, { autoSize: true, cols: 40, rows: 20, camera });
    scene.add(quad());
    scene.rerender();

    probe.reset();
    scene.fit();
    scene.rerender();

    expect(probe.calls()).toBeGreaterThan(0);
  });
});
