/**
 * `publishRendererState` (createGlyphScene.ts) used to copy the working-frame
 * shade cache into the persisted one via `shadeCache.iA.splice(0,
 * shadeCache.iA.length, ...nextShadeCache.iA)` (and the same for `iB`/`iC`/
 * `lit`). Spreading a large array as call arguments hits V8's argument-count
 * ceiling — measured safe under ~100k elements, throws `RangeError: Maximum
 * call stack size exceeded` at 200k+. A real ETOPO1 terrain mesh produces a
 * per-triangle shade cache around 294,124 elements, so every `rerender()`
 * (including the very first render, and every `removeLayer` on the /maps
 * page, which ends in one) threw and took the whole page down.
 *
 * This reproduces the real size regime directly through the public API —
 * not a token array — by rendering a mesh whose visible triangle count
 * exceeds the ceiling.
 */
import { describe, it, expect } from "vitest";
import { createGlyphScene } from "./createGlyphScene";
import type { Polygon } from "@glyphcss/core";

function makeDiv(): HTMLElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

// Same shape `createGlyphScene.test.ts`'s own `makeSinglePolygon()` uses —
// a small, front-facing triangle under the default orthographic camera.
function makeManyFrontFacingTriangles(count: number): Polygon[] {
  const out: Polygon[] = new Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = {
      vertices: [
        [0, 1, 0],
        [-1, -1, 0],
        [1, -1, 0],
      ],
      color: "#aaaaaa",
    };
  }
  return out;
}

describe("createGlyphScene — shade-cache publish at real terrain-mesh scale", () => {
  it(
    "rerenders a mesh whose visible triangle count exceeds V8's spread-call-argument ceiling without throwing",
    () => {
      const host = makeDiv();
      // 320k > the measured ~200k throw threshold, and above the ~294,124
      // figure measured on the real ETOPO1 terrain mesh that triggered this.
      const TRIANGLE_COUNT = 320_000;
      const scene = createGlyphScene(host, { cols: 4, rows: 2, useColors: false });
      scene.add(makeManyFrontFacingTriangles(TRIANGLE_COUNT));

      // `add()` only schedules a microtask render; `rerender()` forces the
      // real `doRenderTransaction` → `publishRendererState` path synchronously,
      // matching how a live page's `removeLayer` ends in a rerender.
      expect(() => scene.rerender()).not.toThrow();

      scene.destroy();
    },
    20_000,
  );
});
