/**
 * The FIFTH "the roads are on top of the buildings", and the one the previous
 * four could not see: a stroke layer at a density of its OWN, walked.
 *
 * A `line` at `density !== 1` is stamped into a meshless VIEWPORT OVERLAY
 * (AGENTS.md's "Meshless viewport overlays"), whose depth pass is
 * `buildSurfaceDepth` over every opaque mesh in the scene. That pass filled
 * its buffer with `camera.project()[2]` — the linear eye-space `cssZ` — while
 * a stroke vertex compares itself with `project()[3] ?? [2]`, the
 * screen-linear `1/denom` z-buffer every PAINT path (and therefore
 * `CellGrid.depth`) uses. Under an ORTHOGRAPHIC camera `[3]` is absent and the
 * two are the same number, which is why `widget.strokeDensityOcclusion.test.ts`
 * — the same pairing, orbiting — has always passed. Under the walk camera they
 * are different quantities in different units, so the comparison is
 * dimensionally meaningless and the overlay's depth test forgave everything:
 * measured at the entry pose below, a 60 m building 200 m ahead cut the road
 * from 140 inked cells to 109 at density 1 and took nothing at all at density 2.
 *
 * The discriminator is the same one the fourth report used and needs no
 * absolute count: **a building that hides part of the road at density 1 must
 * hide part of it at every other density too.** The two densities put the
 * stroke in different output grids, so nothing but the depth quantity is
 * shared between the clauses.
 *
 * Fixture trap: happy-dom has no layout, so `getBoundingClientRect` is stubbed
 * — the walk lens solves `zoom` from `cols * cellWidth` and a zero-width host
 * gives it nothing to solve from.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { GLYPH_MAP_EARTH_RADIUS_M, glyphMapGlobe } from "./projection";
import type { GlyphMapVectorFeature } from "./vector/types";

const COLS = 140, ROWS = 63, CELL_W = 8, CELL_H = 16;
const ZURICH: readonly [number, number] = [8.5445, 47.37418];

const rect = (w: number, h: number) =>
  ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
const EMPTY_RECT = rect(0, 0);
const stubbedHosts = new Set<HTMLElement>();

function stubMonospaceMetrics(host: HTMLElement): void {
  stubbedHosts.add(host);
  if (vi.isMockFunction(Element.prototype.getBoundingClientRect)) return;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (stubbedHosts.has(el)) return rect(COLS * CELL_W, ROWS * CELL_H);
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY_RECT;
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? "16");
    const k = fontPx / 16;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  stubbedHosts.clear();
  document.body.innerHTML = "";
});

const degFor = (m: number) => (m / GLYPH_MAP_EARTH_RADIUS_M) * (180 / Math.PI);
/** A 60 m block, 60 m across, standing 200 m in front of the walker. */
const AHEAD = degFor(200);
const HALF = degFor(30);
const building: GlyphMapVectorFeature = {
  id: "block",
  geometryType: "polygon",
  rings: [[
    [ZURICH[0] - HALF, ZURICH[1] + AHEAD - HALF],
    [ZURICH[0] + HALF, ZURICH[1] + AHEAD - HALF],
    [ZURICH[0] + HALF, ZURICH[1] + AHEAD + HALF],
    [ZURICH[0] - HALF, ZURICH[1] + AHEAD + HALF],
    [ZURICH[0] - HALF, ZURICH[1] + AHEAD - HALF],
  ]],
  properties: { render_height: 60 },
};
/** A west-east street through the building's own footprint. */
const road: GlyphMapVectorFeature = {
  id: "street",
  geometryType: "line",
  rings: [[[ZURICH[0] - 0.002, ZURICH[1] + AHEAD], [ZURICH[0] + 0.002, ZURICH[1] + AHEAD]]],
};

const buildingLayer = {
  type: "fill-extrusion" as const,
  id: "buildings",
  source: { features: [building] },
  color: "#94a3b8",
  heightProperty: "render_height",
};
const roadLayer = (density: number) => ({
  type: "line" as const,
  id: "roads",
  source: { features: [road] },
  color: "#e8c988",
  ...(density === 1 ? {} : { density }),
});

function mount(layers: Parameters<typeof createGlyphMap>[1]["layers"]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    projection: glyphMapGlobe(),
    view: { center: [ZURICH[0], ZURICH[1]] as [number, number], span: 0.01, cols: COLS, rows: ROWS },
    ...(layers ? { layers } : {}),
  });
  map.setWalk({});
  map.setBearing(0);
  map.scene.rerender();
  return { map, host, done: () => { map.destroy(); host.remove(); } };
}

/**
 * How many cells the ROAD layer inked, in whichever output grid it landed in.
 *
 * At density 1 a `line` is stamped into the BASE grid, so the count is the
 * base `<pre>`'s own diff against the identical map with no road layer. At any
 * other density it goes to a meshless VIEWPORT OVERLAY, which carries no
 * geometry at all — every non-blank character in it IS stroke ink, so it is
 * counted directly. Both are "cells this road painted", which is what the two
 * clauses compare.
 */
function roadInk(density: number, withBuilding: boolean): number {
  const base = withBuilding ? [buildingLayer] : [];
  const withRoad = mount([...base, roadLayer(density)]);
  const overlay = withRoad.host.querySelector("pre[data-glyph-overlay-density]");
  if (density !== 1) {
    if (!overlay) { withRoad.done(); throw new Error("expected a viewport overlay <pre> at density !== 1"); }
    const ink = Array.from(overlay.textContent ?? "").filter((ch) => ch !== " " && ch !== "\n").length;
    withRoad.done();
    return ink;
  }
  const after = (withRoad.map.scene.output.textContent ?? "").split("");
  withRoad.done();
  const without = mount(base);
  const before = (without.map.scene.output.textContent ?? "").split("");
  without.done();
  let ink = 0;
  for (let i = 0; i < Math.max(before.length, after.length); i++) if (before[i] !== after[i]) ink++;
  return ink;
}

describe("street-level walk — a stroke at its own density is still occluded by buildings", () => {
  it("the building hides part of the road at density 1 AND at density 2", () => {
    const openAt1 = roadInk(1, false);
    const hiddenAt1 = roadInk(1, true);
    const openAt2 = roadInk(2, false);
    const hiddenAt2 = roadInk(2, true);

    // Premise: the road draws in both grids, and the building really does
    // take cells from it in the base grid (the case that always worked).
    expect(openAt1).toBeGreaterThan(50);
    expect(openAt2).toBeGreaterThan(50);
    expect(openAt1 - hiddenAt1).toBeGreaterThan(10);

    // The claim: the SAME building takes cells from the SAME road when the
    // stroke was handed its own output grid — and takes the same PROPORTION
    // of it, which a bare "> 0" would not catch a partial fix on. Measured
    // 140 -> 109 (22.1%) and 280 -> 217 (22.5%); before the fix the second
    // pair was 280 -> 280.
    expect(openAt2 - hiddenAt2).toBeGreaterThan(10);
    const hiddenFractionAt1 = (openAt1 - hiddenAt1) / openAt1;
    const hiddenFractionAt2 = (openAt2 - hiddenAt2) / openAt2;
    expect(Math.abs(hiddenFractionAt2 - hiddenFractionAt1)).toBeLessThan(0.05);
  });
});
