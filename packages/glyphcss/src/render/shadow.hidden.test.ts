/**
 * A `hidden` polygon casts NOTHING — not a depth sample, and not a corner of
 * the light-space volume the 256 shadow texels are divided across.
 *
 * `Polygon.hidden` is the consumer-driven cull the solid rasterizer already
 * honours before any projection, shading or scan-fill. The shadow pass used
 * to ignore it, so a caster the consumer had culled away went on darkening
 * the ground AND went on stretching the fitted volume — which at
 * `@glyphcss/maps`' street level is a whole city's worth of buildings beyond
 * the walker's own horizon, since a `fill-extrusion`'s per-frame wall cull is
 * written exactly this way.
 *
 * Three clauses, because each covers a failure the others do not see:
 *
 *  1. **Hidden equals ABSENT, for a caster whose own shadow is on screen.**
 *     Not "hidden is lighter than visible" — the bar is bit-for-bit identity
 *     with a scene that never held the polygon, which is what makes the cull
 *     an optimisation rather than a change.
 *  2. **The fixture really casts.** Silent failure: nothing in the picture
 *     is a shadow, and clause 1 is vacuously true. Pinned by leaving the same
 *     caster VISIBLE and requiring the render to differ.
 *  3. **The VOLUME clause, which the depth raster alone would pass.** A
 *     caster 300 units away paints no shadow anywhere near the camera, but
 *     including it in the light-space bounding box makes every texel ~100x
 *     coarser and wrecks the shadow that IS on screen. Hidden must keep it
 *     out of the box as well as out of the raster.
 */
import { describe, it, expect } from "vitest";
import { rasterize } from "./rasterize";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { createGlyphPerspectiveCamera } from "../api/createGlyphCamera";
import type { Polygon, Vec3 } from "@glyphcss/core";

const CAMERA = createGlyphPerspectiveCamera({ rotX: 55, rotY: 30, zoom: 250, distance: 20 });
const GRID = { cols: 60, rows: 30, cellAspect: 2.0 };
const DIR_LIGHT = { direction: [0.35, 0.25, 0.9] as Vec3, intensity: 1 };
const AMB_LIGHT = { intensity: 0.3 };

/** Two triangles forming one upright quad standing on the ground. */
function wall(x: number, y: number): Polygon[] {
  return [
    { vertices: [[x, y, 0], [x + 1.2, y, 0], [x + 1.2, y, 2.2]], color: "#cccccc" },
    { vertices: [[x, y, 0], [x + 1.2, y, 2.2], [x, y, 2.2]], color: "#cccccc" },
  ];
}

function ground(): Polygon[] {
  return [
    { vertices: [[-6, -6, 0], [6, -6, 0], [6, 6, 0]], color: "#888888" },
    { vertices: [[-6, -6, 0], [6, 6, 0], [-6, 6, 0]], color: "#888888" },
  ];
}

/** Everything before `groundAt` casts; the ground receives. */
function render(polygons: Polygon[], groundAt: number): string {
  return rasterize(buildRasterizeContext({
    camera: CAMERA, grid: GRID, polygons,
    mode: "solid",
    directionalLight: DIR_LIGHT,
    ambientLight: AMB_LIGHT,
    useColors: true,
    doubleSided: true,
    shadow: { opacity: 0.8 },
    castShadowFlags: polygons.map((_, i) => i < groundAt),
    receiveShadowFlags: polygons.map((_, i) => i >= groundAt),
  }));
}

/**
 * Four walls near the corners of the visible ground. They exist to FIX the
 * light-space bounding box, so the clauses below about the depth raster are
 * not silently passed by the volume clause instead: a caster inside this box
 * is inside it whether or not it is hidden, and the only thing that can keep
 * its shadow off the ground is the raster's own skip.
 */
const frame = [...wall(-4.5, 4.2), ...wall(3.2, 4.2), ...wall(-4.5, -4.4), ...wall(3.2, -4.4)];
const inner = wall(-0.6, 0.4);
const distant = wall(300, 300);
const floor = ground();
const hide = (ps: Polygon[]): Polygon[] => ps.map((p) => ({ ...p, hidden: true }));

describe("shadow map — a hidden caster", () => {
  it("renders exactly as a scene that never held it", () => {
    expect(render([...frame, ...hide(inner), ...floor], frame.length + inner.length))
      .toBe(render([...frame, ...floor], frame.length));
  });

  it("differs from the same caster left VISIBLE — the fixture really does cast", () => {
    expect(render([...frame, ...inner, ...floor], frame.length + inner.length))
      .not.toBe(render([...frame, ...hide(inner), ...floor], frame.length + inner.length));
  });

  it("is kept out of the fitted light-space volume, not just out of the depth raster", () => {
    // 300 units away: its own shadow is nowhere near the grid, so a pass that
    // skipped it only in the raster would still blow the bounding box out and
    // change the frame's shadows. Hidden has to keep it out of both.
    expect(render([...frame, ...hide(distant), ...floor], frame.length + distant.length))
      .toBe(render([...frame, ...floor], frame.length));
    expect(render([...frame, ...distant, ...floor], frame.length + distant.length))
      .not.toBe(render([...frame, ...floor], frame.length));
  });
});
