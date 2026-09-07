/**
 * Street-level WALK mode: RAISING THE VIEW.
 *
 * The reported defect: "when I raise the camera the whole rendering /
 * buildings disappear". Measured on a 300 m block standing 80 m in front of
 * the walker, at a 140x63 grid: 4,900 painted cells at every pitch up to
 * +0.01 deg, and ZERO from +0.1 deg upward — a cliff, not a fade, and one
 * that no amount of looking further up ever recovers from.
 *
 * ## The mechanism, which is one number
 *
 * `glyphMapGlobe.visible(world, depthOf)` is derived for the ORTHOGRAPHIC
 * camera and says so: it computes `axial = depthOf(world) - depthOf(origin)`,
 * takes `axial >= 0` as "in front of the sphere's centre plane" and otherwise
 * asks whether the point lies outside the silhouette CYLINDER of radius
 * `radius` about the view axis (`|world|^2 - axial^2 >= radius^2`). Both
 * halves assume the orthographic camera's own depth, which is the raw rotated
 * `z` in WORLD units — the same units as `|world|`, which is what makes that
 * comparison dimensionally legal at all.
 *
 * Walk mode installs a positioned CSS-perspective camera, whose `project()[2]`
 * is `r_z * BASE_TILE - distance`: 50x the world-unit axial. And the eye is ON
 * the sphere rather than infinitely far from it, so "behind the centre plane"
 * stops meaning "round the back of the world" and starts meaning "the view
 * axis has any upward tilt at all". Measured through the real camera at the
 * default walk entry (`axial` is dimensionless world units, radius 1):
 *
 * ```
 *   tilt   pitch    d=80m elev=0m    |world|^2 - axial^2 - 1   visible
 *   88     -2 deg   axial +1.7443    -3.0427                   true  (axial >= 0)
 *   90      0 deg   axial -6.28e-4   -3.94e-7                  FALSE
 *   90.1   +0.1     axial -8.79e-2   -7.73e-3                  false
 *   95     +5 deg   axial -4.3584    -18.996                   false
 * ```
 *
 * `axial` at pitch p is `-BASE_TILE * sin(p)` — 50 * sin(5 deg) = 4.358 — so
 * the test concludes the pavement 80 m ahead is four and a third EARTH RADII
 * off the view axis and therefore round the back of the planet. Every
 * consumer of that verdict rejects everything at once, which is why the whole
 * picture goes rather than a piece of it.
 *
 * Two consequences, both pinned below:
 *
 *  - **Buildings** survive level pitch only by accident. A wall is kept when
 *    ANY of its four corners passes, and at pitch exactly 0 a corner 300 m up
 *    has `|world|^2 - 1 = +9.4e-5` against an `axial^2` of 3.9e-7, so the TOP
 *    corners carry it. One tenth of a degree of pitch swamps that margin.
 *  - **A ground-level `line`** has no such margin: `|world|^2` is exactly
 *    `radius^2` at the datum, so the test needs `axial === 0` EXACTLY. A road
 *    30 m in front of the walker was already dark at the default entry pitch.
 *
 * The fix is the branch `walk.ts`'s header has always described and the
 * widget only had in `project()`: while walking, the near-side question is
 * the LOCAL horizon (`glyphMapWalkWithinHorizon`), not `projection.visible`.
 * `glyphMapGlobe.visible()` itself is NOT touched — `widget.farSideFill.test.ts`
 * and `widget.farSideStroke.test.ts` are the orthographic contract, and they
 * are what goes red if this branch ever leaks out of walk mode.
 *
 * Fixture traps (shared with `widget.walk.test.ts`): happy-dom has no layout,
 * so `getBoundingClientRect` is stubbed to give the widget real cell metrics.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { GLYPH_MAP_WALK_FAR_M, GLYPH_MAP_WALK_HORIZON_TILT_DEG } from "./walk";
import { GLYPH_MAP_EARTH_RADIUS_M, glyphMapGlobe } from "./projection";
import type { GlyphMapVectorFeature } from "./vector/types";

const COLS = 140, ROWS = 63, CELL_W = 8, CELL_H = 16, BASE_FONT_PX = 16;
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
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? String(BASE_FONT_PX));
    const k = fontPx / BASE_FONT_PX;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

function mount(opts: Parameters<typeof createGlyphMap>[1]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, opts);
  return { map, host, done: () => { map.destroy(); host.remove(); } };
}

const baseOpts = () => ({
  projection: glyphMapGlobe(),
  view: { center: ZURICH as [number, number], span: 0.01, cols: COLS, rows: ROWS },
});

/** Metres north of the walker, as a latitude offset. */
const degFor = (m: number) => (m / GLYPH_MAP_EARTH_RADIUS_M) * (180 / Math.PI);

/** A square building `metresAhead` due north of the walker, `heightM` tall. */
function block(metresAhead: number, halfM: number, heightM: number): GlyphMapVectorFeature {
  const lat = ZURICH[1] + degFor(metresAhead);
  const half = degFor(halfM);
  return {
    id: `b${metresAhead}`,
    geometry: "polygon",
    rings: [[
      [ZURICH[0] - half, lat - half], [ZURICH[0] + half, lat - half],
      [ZURICH[0] + half, lat + half], [ZURICH[0] - half, lat + half],
      [ZURICH[0] - half, lat - half],
    ] as [number, number][]],
    properties: { render_height: heightM },
  };
}

/** A straight east-west road `metresAhead` due north of the walker, at the datum. */
function road(metresAhead: number): GlyphMapVectorFeature {
  const lat = ZURICH[1] + degFor(metresAhead);
  return {
    id: `r${metresAhead}`,
    geometry: "line",
    rings: [[[ZURICH[0] - 0.002, lat], [ZURICH[0] + 0.002, lat]] as [number, number][]],
    properties: {},
  };
}

/** Painted (non-whitespace) cells in the base grid. */
const painted = (map: ReturnType<typeof createGlyphMap>): number =>
  (map.scene.output.textContent ?? "").replace(/[\s\n]/g, "").length;

afterEach(() => {
  vi.restoreAllMocks();
  stubbedHosts.clear();
});

describe("walk mode — raising the view", () => {
  it("keeps drawing the building in front of the walker at every pitch it can look up to", () => {
    const { map, done } = mount({
      ...baseOpts(),
      layers: [{
        type: "fill-extrusion" as const,
        source: { features: [block(80, 40, 300)] },
        color: "#ffffff",
        heightProperty: "render_height",
      }],
    });
    map.setWalk({});
    map.setBearing(0);

    const at = (pitch: number): number => {
      map.setTilt(GLYPH_MAP_WALK_HORIZON_TILT_DEG + pitch);
      map.scene.rerender();
      return painted(map);
    };

    // Level: the reference. A 300 m block 80 m away subtends 75 degrees, so
    // it covers most of the grid however the lens is pointed within its span.
    const level = at(0);
    expect(level).toBeGreaterThan(1000);

    // Raising the view. Every one of these used to be exactly 0 — the block
    // is not merely dimmer, it is GONE, from a tenth of a degree upward.
    for (const pitch of [0.1, 1, 5, 15, 30, 45, 60]) {
      const cells = at(pitch);
      expect(cells, `pitch +${pitch} deg`).toBeGreaterThan(0);
      // And it is still the building, not a stray cell or two: past 45 deg
      // of pitch the frame is mostly sky above a 75-degree-tall block, so
      // the floor is deliberately loose while staying far from zero.
      expect(cells, `pitch +${pitch} deg`).toBeGreaterThan(200);
    }

    // Looking back DOWN restores the level picture exactly — the state is a
    // pitch, not a latch.
    expect(at(0)).toBe(level);
    done();
  });

  it("keeps drawing the road under the walker's feet at and above the level pitch", () => {
    const { map, done } = mount({
      ...baseOpts(),
      layers: [{ type: "line" as const, source: { features: [road(30)] }, color: "#ff0000" }],
    });
    map.setWalk({});
    map.setBearing(0);

    const at = (pitch: number): number => {
      map.setTilt(GLYPH_MAP_WALK_HORIZON_TILT_DEG + pitch);
      map.scene.rerender();
      return painted(map);
    };

    // A ground-level stroke has no elevation margin to carry it past the
    // cylinder test, so this one was dark at the DEFAULT entry pitch — the
    // walk started with its roads already missing.
    expect(at(-2)).toBeGreaterThan(0);
    expect(at(0)).toBeGreaterThan(0);
    // 30 m ahead is 3.2 degrees below the horizontal, so it leaves the frame
    // on its own once the lens is pointed well above it; a few degrees of
    // pitch is still squarely in shot and used to draw nothing.
    expect(at(3)).toBeGreaterThan(0);
    expect(at(10)).toBeGreaterThan(0);
    done();
  });

  it("still refuses everything past the local horizon, at every pitch", () => {
    // The far-field cap is the LOCAL HORIZON and must survive the fix: the
    // accidental cull this replaces (the cylinder test rejecting anything a
    // few hundred metres out) is exactly what `far` is for.
    const { map, done } = mount({
      ...baseOpts(),
      layers: [{
        type: "fill-extrusion" as const,
        source: { features: [block(GLYPH_MAP_WALK_FAR_M * 6, 40, 300)] },
        color: "#ffffff",
        heightProperty: "render_height",
      }],
    });
    map.setWalk({});
    map.setBearing(0);
    for (const pitch of [-10, 0, 0.1, 5, 30]) {
      map.setTilt(GLYPH_MAP_WALK_HORIZON_TILT_DEG + pitch);
      map.scene.rerender();
      expect(painted(map), `pitch ${pitch} deg`).toBe(0);
    }
    done();
  });
});
