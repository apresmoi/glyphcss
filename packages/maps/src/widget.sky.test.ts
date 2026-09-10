/**
 * The walk-mode SKY.
 *
 * Five properties, each asserted on RENDERED CELLS rather than on "a mesh
 * was added", because every one of them can be wired and still not paint:
 *
 *  1. **It exists only while walking.** Silent failures: a dome mounted at
 *     construction (which would put a hemisphere over the orbit view), and
 *     one never taken down (which would leave it inside the globe after the
 *     walk). Pinned by the render being byte-identical across a walk round
 *     trip, glyphs AND colour spans.
 *  2. **The sun disc is where the LIGHT is.** Silent failure: a disc painted
 *     at a hardcoded azimuth, or at the camera's own axis, which looks
 *     plausible until the terminator the same page draws disagrees with it.
 *     Pinned by projecting the light direction through the REAL camera and
 *     finding the disc there.
 *  3. **The gradient follows the sun's ALTITUDE.** Silent failure: a fixed
 *     blue sky, which is a lie at night. Pinned at three altitudes on the
 *     rendered colours, and independently on the pure palette.
 *  4. **Anything nearer occludes it.** This is the whole reason the sky is
 *     real geometry, so it gets a real building.
 *  5. **It follows the walker.** Silent failure: a dome pinned where the
 *     walk was entered, which a reader discovers only after walking a few
 *     hundred metres — so the test shrinks the dome (`far`) until "a few
 *     hundred metres" is a handful of frames.
 *
 * Fixture trap (shared with every other walk test): happy-dom has no layout,
 * so `getBoundingClientRect` is stubbed — the walk lens solves `zoom` from
 * `cols * cellWidth` and a zero-width host gives it nothing to solve from.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import {
  GLYPH_MAP_SKY_BANDS,
  GLYPH_MAP_SKY_DAY,
  GLYPH_MAP_SKY_DUSK,
  GLYPH_MAP_SKY_NIGHT,
  GLYPH_MAP_SKY_RADIUS_FRACTION,
  GLYPH_MAP_SKY_RINGS,
  GLYPH_MAP_SKY_SEGMENTS,
  glyphMapSkyDome,
  glyphMapSkyPalette,
  glyphMapSkyRecentreDistanceM,
  GLYPH_MAP_SKY_SUN_GLOW_DEG,
  glyphMapSkySunAltitude,
} from "./sky";
import { glyphMapSunDirection } from "./sun";
import { GLYPH_MAP_WALK_FAR_M } from "./walk";
import { GLYPH_MAP_EARTH_RADIUS_M } from "./projection";
import type { Vec3 } from "glyphcss";

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
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W, CELL_H * lines);
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

function key(host: HTMLElement, type: "keydown" | "keyup", k: string): void {
  host.ownerDocument!.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true }));
}

async function motionFrames(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
  }
}

/** Per-character `#rrggbb` of the rendered `<pre>`, row-major with `"\n"` kept as `null` (`widget.sun.test.ts`'s own reader). */
function renderedColors(pre: HTMLElement): (string | null)[] {
  const out: (string | null)[] = [];
  for (const node of Array.from(pre.childNodes)) {
    const text = node.textContent ?? "";
    let color: string | null = null;
    if (node.nodeType === 1) {
      const style = (node as HTMLElement).getAttribute("style") ?? "";
      const m = /color:\s*(#[0-9a-fA-F]{6})/.exec(style);
      color = m ? m[1].toLowerCase() : null;
    }
    for (const ch of text) out.push(ch === "\n" ? null : color);
  }
  return out;
}

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

/**
 * Every colour the banded gradient can produce at this sun altitude — the
 * DISCRIMINATOR the rendered assertions use. Derived from the exported pure
 * palette and the exported band count, so it is a statement about the
 * shipped constants rather than a copy of a magic list.
 */
function skyBandColors(altitudeDeg: number): Set<string> {
  const { horizon, zenith } = glyphMapSkyPalette(altitudeDeg);
  const out = new Set<string>();
  for (let band = 0; band < GLYPH_MAP_SKY_BANDS; band++) {
    const t = (band + 0.5) / GLYPH_MAP_SKY_BANDS;
    out.add(hex(
      horizon[0] + (zenith[0] - horizon[0]) * t,
      horizon[1] + (zenith[1] - horizon[1]) * t,
      horizon[2] + (zenith[2] - horizon[2]) * t,
    ));
  }
  return out;
}

/** The walker's local up, straight from the projection — the axis an altitude is measured against. */
function upAt(lon: number, lat: number): Vec3 {
  const projection = glyphMapGlobe();
  const a = projection.project(lon, lat, 0);
  const b = projection.project(lon, lat, 1);
  const v: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

const GRID = { cols: COLS, rows: ROWS, cellAspect: CELL_W / CELL_H, cellWidth: CELL_W, cellHeight: CELL_H, centerCol: COLS / 2, centerRow: ROWS / 2 };

afterEach(() => {
  vi.restoreAllMocks();
  stubbedHosts.clear();
  document.body.innerHTML = "";
});

describe("the sky is mounted only while WALKING", () => {
  it("paints no sky before the walk, fills the frame during it, and restores the render byte for byte after", () => {
    const { map, done } = mount(baseOpts());
    const day = skyBandColors(90);

    const beforeText = map.scene.output.textContent ?? "";
    const beforeHtml = map.scene.output.innerHTML;
    const beforeSky = renderedColors(map.scene.output).filter((c) => c && day.has(c)).length;
    // Nothing on an orbit map is a sky cell, and the reason is structural:
    // the dome is not built at all until walk mode is entered.
    expect(beforeSky).toBe(0);

    map.setWalk({});
    map.scene.rerender();
    const walkingColors = renderedColors(map.scene.output);
    const walkingSky = walkingColors.filter((c) => c && day.has(c)).length;
    // The sun is overhead by default (no sun mode, no headlight, no
    // consumer light) so the DAY palette is the one on screen. It fills the
    // upper half of a street-level frame, which is thousands of cells.
    expect(walkingSky).toBeGreaterThan(1000);

    map.setWalk(null);
    map.scene.rerender();
    expect(map.scene.output.textContent ?? "").toBe(beforeText);
    expect(map.scene.output.innerHTML).toBe(beforeHtml);
    done();
  });

  it("is GONE from the scene on the way out, not merely invisible", () => {
    // The rendered round trip above cannot see this on its own, and that is
    // worth stating: an inward-facing hemisphere is BACK-FACING from every
    // point outside it, so a dome left mounted after the walk paints nothing
    // from an orbit view and costs a polygon pass and a compositor layer
    // forever. Counted through glyphcss's own `__glyphPerf` seam (the render
    // bench's, so it is not a hook added for a test).
    const perf = globalThis as unknown as { __glyphPerf?: { raster: number[]; dom: number[]; polys: number[] } };
    const previous = perf.__glyphPerf;
    perf.__glyphPerf = { raster: [], dom: [], polys: [] };
    try {
      const { map, done } = mount(baseOpts());
      const polysNow = () => { perf.__glyphPerf!.polys.length = 0; map.scene.rerender(); return perf.__glyphPerf!.polys.at(-1)!; };
      const before = polysNow();
      map.setWalk({});
      const walking = polysNow();
      // Exactly one hemisphere's worth of quads arrived, and no more.
      expect(walking - before).toBe(GLYPH_MAP_SKY_RINGS * GLYPH_MAP_SKY_SEGMENTS);
      map.setWalk(null);
      expect(polysNow()).toBe(before);
      // And a second walk mounts ONE dome, not two.
      map.setWalk({});
      expect(polysNow()).toBe(walking);
      done();
    } finally {
      if (previous) perf.__glyphPerf = previous; else delete perf.__glyphPerf;
    }
  });

  it("mounts nothing at all when the walker declines it", () => {
    const perf = globalThis as unknown as { __glyphPerf?: { raster: number[]; dom: number[]; polys: number[] } };
    const previous = perf.__glyphPerf;
    perf.__glyphPerf = { raster: [], dom: [], polys: [] };
    try {
      const { map, done } = mount(baseOpts());
      const polysNow = () => { perf.__glyphPerf!.polys.length = 0; map.scene.rerender(); return perf.__glyphPerf!.polys.at(-1)!; };
      const before = polysNow();
      map.setWalk({ sky: false });
      // `sky: false` is byte-identical to a build without the feature: no
      // dome, no appearance program, nothing painted.
      expect(polysNow()).toBe(before);
      const day = skyBandColors(90);
      expect(renderedColors(map.scene.output).filter((c) => c && day.has(c)).length).toBe(0);
      done();
    } finally {
      if (previous) perf.__glyphPerf = previous; else delete perf.__glyphPerf;
    }
  });

  it("is skipped in a render mode the appearance program cannot run in", () => {
    // Mesh targeting reads `winnerMesh` and `worldPosition` is a hard
    // requirement, so both are solid-mode-only. A dome mounted where the
    // program is inactive would render as a Lambert-shaded hemisphere — the
    // one thing the effect exists to prevent — so it is not mounted at all.
    const { map, done } = mount({ ...baseOpts(), scene: { mode: "wireframe" } });
    map.setWalk({});
    map.scene.rerender();
    const day = skyBandColors(90);
    expect(renderedColors(map.scene.output).filter((c) => c && day.has(c)).length).toBe(0);
    done();
  });
});

describe("the sun is the scene's own", () => {
  it("puts the disc where getKeyLightDirection() points", () => {
    // A real subsolar instant, so the direction under test is the one the
    // terminator on the rest of the map is drawn from.
    const at = Date.UTC(2026, 5, 21, 11, 30);
    const { map, done } = mount({ ...baseOpts(), sun: { mode: "manual" as const, date: at } });

    const direction = map.getKeyLightDirection()!;
    expect(direction).not.toBeNull();
    const up = upAt(ZURICH[0], ZURICH[1]);
    const altitude = glyphMapSkySunAltitude(direction, up);
    expect(altitude).toBeGreaterThan(5);

    map.setWalk({});
    // Look UP at the sun's own altitude, then find the heading that puts it
    // in frame. Both are ordinary public calls; nothing here reaches into
    // the widget.
    map.setTilt(90 + Math.min(altitude, 80));

    const dome = glyphMapSkyDome({
      projection: glyphMapGlobe(),
      at: ZURICH,
      groundElevation: 0,
      radiusM: GLYPH_MAP_WALK_FAR_M * GLYPH_MAP_SKY_RADIUS_FRACTION,
    })!;
    const len = Math.hypot(direction[0], direction[1], direction[2]);
    const sunPoint: Vec3 = [
      dome.center[0] + (direction[0] / len) * dome.radiusWorld,
      dome.center[1] + (direction[1] / len) * dome.radiusWorld,
      dome.center[2] + (direction[2] / len) * dome.radiusWorld,
    ];

    let best: { bearing: number; cells: number[] } | null = null;
    for (let bearing = 0; bearing < 360; bearing += 10) {
      map.setBearing(bearing);
      map.scene.rerender();
      const text = (map.scene.output.textContent ?? "").split("\n").join("");
      const cells: number[] = [];
      for (let i = 0; i < text.length; i++) if (text[i] === "@") cells.push(i);
      if (!best || cells.length > best.cells.length) best = { bearing, cells };
    }
    // A disc exists at SOME heading — the sun is drawn, not merely intended.
    expect(best!.cells.length).toBeGreaterThan(0);

    map.setBearing(best!.bearing);
    map.scene.rerender();
    const projected = map.scene.camera.project(sunPoint, COLS, ROWS, GRID.cellAspect, GRID);
    const centroidCol = best!.cells.reduce((a, i) => a + (i % COLS), 0) / best!.cells.length;
    const centroidRow = best!.cells.reduce((a, i) => a + Math.floor(i / COLS), 0) / best!.cells.length;
    // The core's centroid IS the projected light direction, to within a
    // couple of cells — the disc's own core is a few cells across.
    expect(Math.abs(centroidCol - projected[0])).toBeLessThan(3);
    expect(Math.abs(centroidRow - projected[1])).toBeLessThan(3);
    done();
  });

  it("declines a HEADLIGHT — the sky is a statement about the world, not about the viewer", () => {
    // `getKeyLightDirection()` reports the headlight, and a headlight IS the
    // camera's view axis: taken as a sun it would put a disc in the middle of
    // the frame and make the sky's own altitude equal the reader's PITCH.
    // `/maps`' default (Sun "Full" on an orbit projection) is exactly this,
    // and it rendered the whole sky at dusk at every hour.
    const { map, done } = mount({ ...baseOpts(), keyLight: "headlight" as const });
    map.setWalk({});
    const day = skyBandColors(90);
    const dusk = skyBandColors(0);
    // Level, and well up — never DOWN: a 35 degree vertical field at eye
    // height has no sky in it at a steep downward pitch, which would test the
    // ground rather than the sky.
    for (const pitch of [0, 40, 80]) {
      map.setTilt(90 + pitch);
      map.scene.rerender();
      const colors = renderedColors(map.scene.output);
      // Broad daylight at every pitch, and never the dusk the headlight's own
      // altitude would have asked for at a level gaze.
      expect(colors.filter((c) => c && day.has(c)).length).toBeGreaterThan(500);
      expect(colors.filter((c) => c && dusk.has(c) && !day.has(c)).length).toBe(0);
      // And no disc: there is no sun in this world to draw.
      expect(map.scene.output.textContent ?? "").not.toContain("@");
    }
    done();
  });

  it("takes the CONSUMER's own light when the widget owns none", () => {
    // `keyLight: "fixed"` + `sun: "off"` is the default, and there the scene's
    // `directionalLight` is the vector every other surface was lit by — so it
    // is the vector the sky has to agree with. Written through `map.scene`,
    // which is the escape hatch `/maps`' azimuth/elevation sliders use.
    const { map, done } = mount(baseOpts());
    map.setWalk({});
    const up = upAt(ZURICH[0], ZURICH[1]);
    // Any unit vector perpendicular to `up`, to build a known altitude from.
    const t: Vec3 = [-up[1], up[0], 0];
    const tn = Math.hypot(t[0], t[1], t[2]);
    const at = (altDeg: number): Vec3 => {
      const s = Math.sin((altDeg * Math.PI) / 180), c = Math.cos((altDeg * Math.PI) / 180);
      return [up[0] * s + (t[0] / tn) * c, up[1] * s + (t[1] / tn) * c, up[2] * s + (t[2] / tn) * c];
    };
    const skyFor = (altDeg: number) => {
      map.scene.setOptions({ directionalLight: { direction: at(altDeg), intensity: 1 } });
      map.scene.rerender();
      const wanted = skyBandColors(altDeg);
      return renderedColors(map.scene.output).filter((c) => c && wanted.has(c)).length;
    };
    // The sky is the palette the CONSUMER's own elevation asks for, at both
    // ends — and the widget never wrote the light, so this is the only path
    // that could have carried it.
    expect(skyFor(70)).toBeGreaterThan(1000);
    expect(skyFor(0)).toBeGreaterThan(1000);
    expect(skyFor(-30)).toBeGreaterThan(1000);
    done();
  });

  it("draws no disc at all once the sun is below the horizon", () => {
    // The instant matters, and this is the whole reason it is SEARCHED for
    // rather than picked: a sun at local midnight is tens of degrees under
    // the rim, so no dome direction is within the glow's own angular radius
    // and "no disc" would hold with the altitude gate deleted. Just below
    // the horizon is the case that can only pass because of the gate — the
    // rim itself is inside the glow there.
    const projection = glyphMapGlobe();
    const up = upAt(ZURICH[0], ZURICH[1]);
    const altitudeAt = (t: number) => glyphMapSkySunAltitude(glyphMapSunDirection(projection, t)!, up);
    const findAltitude = (lo: number, hi: number): number => {
      const day = Date.UTC(2026, 5, 21);
      for (let m = 0; m < 24 * 60; m += 2) {
        const t = day + m * 60_000;
        const a = altitudeAt(t);
        if (a > lo && a < hi) return t;
      }
      throw new Error(`no instant with sun altitude in (${lo}, ${hi})`);
    };
    // Well inside the glow radius on either side of the crossing.
    const below = findAltitude(-GLYPH_MAP_SKY_SUN_GLOW_DEG / 2, -1);
    const above = findAltitude(1, GLYPH_MAP_SKY_SUN_GLOW_DEG / 2);

    const offPalette = (at: number) => {
      const { map, done } = mount({ ...baseOpts(), sun: { mode: "manual" as const, date: at } });
      map.setWalk({});
      const wanted = skyBandColors(altitudeAt(at));
      let outside = 0, discs = 0;
      for (let bearing = 0; bearing < 360; bearing += 30) {
        for (const pitch of [0, 20]) {
          map.setTilt(90 + pitch);
          map.setBearing(bearing);
          map.scene.rerender();
          // NOTHING is mounted but the dome, so every coloured cell is a
          // dome cell and its colour must be one the banded gradient can
          // produce. A disc or a glow is by construction not one of those.
          for (const c of renderedColors(map.scene.output)) if (c && !wanted.has(c)) outside++;
          discs += ((map.scene.output.textContent ?? "").match(/@/g) ?? []).length;
        }
      }
      done();
      return { outside, discs };
    };

    // Below the horizon: not one warmed cell anywhere, at any heading or
    // pitch. Above it: the glow is there, which is what makes the clause
    // above a statement rather than a tautology.
    expect(altitudeAt(below)).toBeLessThan(0);
    expect(offPalette(below)).toEqual({ outside: 0, discs: 0 });
    expect(altitudeAt(above)).toBeGreaterThan(0);
    expect(offPalette(above).outside).toBeGreaterThan(0);
  });
});

describe("the gradient follows the sun's altitude", () => {
  it("is night below civil twilight, warm at the horizon crossing and blue by day", () => {
    expect(glyphMapSkyPalette(-30)).toEqual(GLYPH_MAP_SKY_NIGHT);
    expect(glyphMapSkyPalette(0)).toEqual(GLYPH_MAP_SKY_DUSK);
    expect(glyphMapSkyPalette(60)).toEqual(GLYPH_MAP_SKY_DAY);
    // The whole point of a dusk palette: the horizon is WARM (red well
    // above blue) exactly when the sun crosses, and is not at either end.
    const warmth = (a: number) => {
      const { horizon } = glyphMapSkyPalette(a);
      return horizon[0] - horizon[2];
    };
    expect(warmth(0)).toBeGreaterThan(warmth(-30));
    expect(warmth(0)).toBeGreaterThan(warmth(60));
    // And the zenith is never brighter than the horizon — the atmospheric
    // fact the gradient states at every altitude.
    for (const a of [-30, -3, 0, 10, 60]) {
      const { horizon, zenith } = glyphMapSkyPalette(a);
      const lum = (c: readonly [number, number, number]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      expect(lum(zenith)).toBeLessThan(lum(horizon));
    }
  });

  it("renders the night sky dark and the day sky blue, from the SAME view", () => {
    const up = upAt(ZURICH[0], ZURICH[1]);
    const render = (at: number) => {
      const { map, done } = mount({ ...baseOpts(), sun: { mode: "manual" as const, date: at } });
      map.setWalk({});
      map.setBearing(0);
      map.scene.rerender();
      const altitude = glyphMapSkySunAltitude(map.getKeyLightDirection()!, up);
      const wanted = skyBandColors(altitude);
      const cells = renderedColors(map.scene.output).filter((c) => c && wanted.has(c)) as string[];
      done();
      return { altitude, cells };
    };

    const noon = render(Date.UTC(2026, 5, 21, 11, 30));
    const night = render(Date.UTC(2026, 5, 21, 23, 30));
    expect(noon.altitude).toBeGreaterThan(0);
    expect(night.altitude).toBeLessThan(0);
    expect(noon.cells.length).toBeGreaterThan(1000);
    expect(night.cells.length).toBeGreaterThan(1000);

    // The rendered sky is the palette the altitude asked for, and the two
    // are nowhere near each other: the brightest night cell is darker than
    // the darkest day one.
    const lum = (c: string) => 0.299 * parseInt(c.slice(1, 3), 16) + 0.587 * parseInt(c.slice(3, 5), 16) + 0.114 * parseInt(c.slice(5, 7), 16);
    expect(Math.max(...night.cells.map(lum))).toBeLessThan(Math.min(...noon.cells.map(lum)));
  });
});

describe("anything nearer occludes the sky", () => {
  it("a building in front of the walker cuts into the dome", () => {
    const degFor = (m: number) => (m / GLYPH_MAP_EARTH_RADIUS_M) * (180 / Math.PI);
    const half = degFor(60);
    const block = {
      id: "b",
      geometry: "polygon" as const,
      rings: [[
        [ZURICH[0] - half, ZURICH[1] + degFor(120) - half],
        [ZURICH[0] + half, ZURICH[1] + degFor(120) - half],
        [ZURICH[0] + half, ZURICH[1] + degFor(120) + half],
        [ZURICH[0] - half, ZURICH[1] + degFor(120) + half],
        [ZURICH[0] - half, ZURICH[1] + degFor(120) - half],
      ] as [number, number][]],
      properties: { render_height: 200 },
    };
    const skyCells = (features: (typeof block)[]) => {
      const { map, done } = mount({
        ...baseOpts(),
        layers: features.length
          ? [{ type: "fill-extrusion" as const, source: { features }, color: "#ffffff", heightProperty: "render_height" }]
          : [],
      });
      map.setWalk({});
      map.setBearing(0);
      map.scene.rerender();
      const day = skyBandColors(90);
      const colors = renderedColors(map.scene.output);
      const set = new Set<number>();
      for (let i = 0; i < colors.length; i++) if (colors[i] && day.has(colors[i]!)) set.add(i);
      done();
      return set;
    };

    const open = skyCells([]);
    const blocked = skyCells([block]);
    expect(open.size).toBeGreaterThan(1000);
    // The building took cells AWAY from the sky, and took no cell the sky
    // did not already own: a 200 m block 120 m ahead is entirely inside the
    // dome's silhouette.
    expect(blocked.size).toBeLessThan(open.size);
    for (const i of blocked) expect(open.has(i)).toBe(true);
    expect(open.size - blocked.size).toBeGreaterThan(100);
  });
});

describe("the sky follows the walker", () => {
  it("re-centres on the horizon slack, so a walk cannot leave the dome behind", async () => {
    // The rule, stated in metres: the slack between the dome's radius and
    // the horizon it sits inside.
    expect(glyphMapSkyRecentreDistanceM(GLYPH_MAP_WALK_FAR_M)).toBeCloseTo(GLYPH_MAP_WALK_FAR_M * (1 - GLYPH_MAP_SKY_RADIUS_FRACTION), 9);
    expect(glyphMapSkyRecentreDistanceM(GLYPH_MAP_WALK_FAR_M)).toBeGreaterThan(0);

    // A 12 m horizon shrinks the dome to 11.76 m, which a walker crosses in
    // a handful of frames — so "walked clean out of the sky" is reachable in
    // a test instead of after 33 seconds of running at the shipped radius.
    const { map, host, done } = mount(baseOpts());
    map.setWalk({ far: 12, speed: 5000 });
    map.setBearing(0);
    map.scene.rerender();
    const day = skyBandColors(90);
    const skyNow = () => renderedColors(map.scene.output).filter((c) => c && day.has(c)).length;
    const before = skyNow();
    expect(before).toBeGreaterThan(1000);
    const start = map.getView().center;

    key(host, "keydown", "w");
    await motionFrames(12);
    key(host, "keyup", "w");
    map.scene.rerender();

    const travelled = (map.getView().center[1] - start[1]) * (Math.PI / 180) * GLYPH_MAP_EARTH_RADIUS_M;
    // The premise: the walker went further than the dome's own radius, so a
    // dome pinned at the entry point would now be entirely behind them.
    expect(travelled).toBeGreaterThan(12 * GLYPH_MAP_SKY_RADIUS_FRACTION);
    // And the sky is still all around them.
    expect(skyNow()).toBeGreaterThan(before * 0.9);
    done();
  });
});
