// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import type { GlyphMapField } from "./types";

const COLS = 80, ROWS = 40, SPAN = 40, FIELD = 320;

/** A tilted plane under fine ripple: four field samples per output cell, so the ripple is finer than a cell can draw. */
function ripple(): GlyphMapField {
  const values = new Float32Array(FIELD * (FIELD / 2));
  for (let r = 0; r < FIELD / 2; r++) for (let c = 0; c < FIELD; c++) values[r * FIELD + c] = c * 10 + 120 * Math.sin(c * 1.7) * Math.cos(r * 2.3);
  return {
    bounds: { west: -SPAN / 2, east: SPAN / 2, south: -SPAN / 4, north: SPAN / 4 },
    cols: FIELD, rows: FIELD / 2, values, noData: new Uint8Array(values.length), kind: "continuous", min: -120, max: FIELD * 10 + 120,
  };
}

const hosts: HTMLElement[] = [];
afterEach(() => { for (const h of hosts.splice(0)) h.remove(); });

function inked(generalize?: number): number {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const map = createGlyphMap(host, { view: { center: [0, 0], span: SPAN, cols: COLS, rows: ROWS }, projection: glyphMapEquirectangular(), tilt: 0 });
  map.addLayer({ type: "contour", id: "c", source: ripple(), levels: { interval: 400 }, color: "#00aaff", ...(generalize === undefined ? {} : { generalize }) });
  map.scene.rerender();
  const ink = (map.scene.output.textContent ?? "").replace(/\s/g, "").length;
  map.destroy();
  return ink;
}

describe("contour generalize", () => {
  it("draws the ripple's jitter natively and drops it when generalised", () => {
    const native = inked(), smooth = inked(2);
    expect(smooth).toBeGreaterThan(0);
    // The plane alone crosses each level once per row; the ripple multiplies that.
    expect(smooth).toBeLessThan(native * 0.7);
  });
  it("is the native cut at 0", () => {
    expect(inked(0)).toBe(inked());
  });
});
