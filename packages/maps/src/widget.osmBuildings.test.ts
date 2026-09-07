/**
 * The OpenStreetMap buildings row, end to end through the real widget and the
 * real rasterizer — the three things `GLYPH_MAP_OPENMAPTILES_LAYERS` now turns
 * on for it, each asserted on what a reader SEES rather than on an option
 * having been set:
 *
 *  1. **`baseOffsetProperty: "render_min_height"`.** OpenMapTiles carries a
 *     structure's base beside its top, and a stepped mass (a tower on a
 *     podium, and — measured on the live `14/8296/5636` — all 35 parts of the
 *     Eiffel Tower) is expressed as several parts at several bases. Dropped,
 *     every part is drawn from the pavement and the structure collapses into
 *     nested boxes.
 *  2. **`colorVariation`.** Seeded per FOOTPRINT, because this schema emits
 *     every attribute-identical building as ONE multipolygon — 50 features
 *     carrying 1,991 buildings in the vendored `14/8579/5736`, so a
 *     per-feature seed paints a whole neighbourhood one tone.
 *  3. **`facade`.** What stops a block of flat-roofed boxes reading as two
 *     tones and a wedge at eye height.
 *
 * (1) is measured against the REAL vendored tile as well as against a
 * two-part synthetic stack, because the synthetic one cannot say that the
 * data really has this shape and the real one cannot say what the podium's
 * exact geometry should be.
 *
 * happy-dom has no layout, hence `stubMonospaceMetrics`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap, type GlyphMapFillExtrusionLayer } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";
import { glyphMapDecodeMVT } from "./vector/pmtiles";
import { glyphMapOpenFreeMapProvider } from "./vector/openfreemap";
import { glyphMapOpenMapTilesLayers } from "./vector/openmaptiles";
import type { GlyphMapVectorFeature } from "./vector/types";

const COLS = 140;
const ROWS = 63;
const CELL_W = 8;
const CELL_H = 16;
const BASE_FONT_PX = 16;
/** Oblique enough that walls, not roofs, are most of the ink — the street-level view the report is about. */
const TILT = 62;

const EMPTY_RECT = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
const rect = (width: number, height: number): DOMRect =>
  ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
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

const mounted: { destroy(): void }[] = [];
const hostsToRemove: HTMLElement[] = [];
afterEach(() => {
  for (const m of mounted.splice(0)) m.destroy();
  for (const h of hostsToRemove.splice(0)) h.remove();
  vi.restoreAllMocks();
  stubbedHosts.clear();
  document.body.innerHTML = "";
});

/** The one built row under test, so no assertion can pass against a layer the mapping does not produce. */
function osmBuildingsLayer(): GlyphMapFillExtrusionLayer {
  const built = glyphMapOpenMapTilesLayers(glyphMapOpenFreeMapProvider(), { include: ["omt-buildings"] })[0];
  return built as GlyphMapFillExtrusionLayer;
}

function mount(
  layer: GlyphMapFillExtrusionLayer,
  features: readonly GlyphMapVectorFeature[],
  view: { readonly center: readonly [number, number]; readonly span: number },
  tilt: number = TILT,
) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hostsToRemove.push(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [view.center[0], view.center[1]], span: view.span, cols: COLS, rows: ROWS },
    // A sheet, so an elevation is a pure vertical screen offset and "stands
    // off the ground" is a statement about ROWS with nothing else in it.
    projection: glyphMapEquirectangular({ exaggeration: 1 }),
    tilt,
  });
  mounted.push(map);
  map.addLayer({ ...layer, source: { features } } as GlyphMapFillExtrusionLayer);
  map.scene.rerender();
  return { host, map };
}

/** Straight down, where every visible face is a roof and no wall is in the picture. */
function mountFlat(
  layer: GlyphMapFillExtrusionLayer,
  features: readonly GlyphMapVectorFeature[],
  view: { readonly center: readonly [number, number]; readonly span: number },
) {
  return mount(layer, features, view, 0);
}

function text(host: HTMLElement): string {
  return Array.from(host.querySelectorAll("pre")).map((pre) => pre.textContent ?? "").join("\n");
}

/** The inked rows of the frame, top first — a building's own screen extent. */
function inkedRows(host: HTMLElement): number[] {
  return text(host)
    .split("\n")
    .map((row, i) => (row.trim() === "" ? -1 : i))
    .filter((i) => i >= 0);
}

/** Distinct non-blank characters in the frame. */
function glyphSet(host: HTMLElement): Set<string> {
  return new Set([...text(host)].filter((c) => c !== " " && c !== "\n"));
}

/** The frame as it actually reaches the DOM — glyphs AND their colour spans. */
function html(host: HTMLElement): string {
  return Array.from(host.querySelectorAll("pre")).map((pre) => pre.innerHTML).join("");
}

function colorSet(host: HTMLElement): Set<string> {
  return new Set([...html(host).matchAll(/color:\s*(#[0-9a-fA-F]{3,6})/g)].map((m) => m[1]!.toLowerCase()));
}

function meanRun(host: HTMLElement): number {
  let runs = 0, total = 0;
  for (const row of text(host).split("\n")) {
    let i = 0;
    while (i < row.length) {
      const c = row[i]!;
      let j = i;
      while (j < row.length && row[j] === c) j++;
      if (c !== " ") { runs++; total += j - i; }
      i = j;
    }
  }
  return runs ? total / runs : 0;
}

// ---------------------------------------------------------------- synthetic

const STACK_CENTRE: readonly [number, number] = [8.54, 47.375];
const STACK_SPAN = 0.001;
/** The Eiffel Tower's own shaft section, as the live `14/8296/5636` tile expresses it: `115 → 277 m`. */
const PODIUM_M = 115;
const TOP_M = 277;

/** One footprint, as OSM expresses a tower on a podium: two parts sharing it, at two bases. */
function stack(): GlyphMapVectorFeature[] {
  const w = 0.00016, h = 0.00011;
  const [lon, lat] = [STACK_CENTRE[0] - w / 2, STACK_CENTRE[1] - h / 2];
  const ring: [number, number][] = [[lon, lat], [lon + w, lat], [lon + w, lat + h], [lon, lat + h], [lon, lat]];
  return [
    { id: "podium", geometryType: "polygon", properties: { render_height: PODIUM_M, render_min_height: 0 }, rings: [ring], polygons: [[ring]] },
    { id: "tower", geometryType: "polygon", properties: { render_height: TOP_M, render_min_height: PODIUM_M }, rings: [ring], polygons: [[ring]] },
  ];
}

/** The upper part on its own, so nothing else can be paying for the rows under it. */
const UPPER_ONLY = [stack()[1]!];

describe("`render_min_height` is honoured, and on the same datum as `render_height`", () => {
  const view = { center: STACK_CENTRE, span: STACK_SPAN };

  it("a part with a base renders standing OFF the ground, not from it", () => {
    const honoured = mount(osmBuildingsLayer(), UPPER_ONLY, view);
    const dropped = mount({ ...osmBuildingsLayer(), baseOffsetProperty: undefined }, UPPER_ONLY, view);
    const bottom = (host: HTMLElement) => Math.max(...inkedRows(host));
    // Rows grow downward, so honouring the base lifts the LOWEST inked row.
    expect(bottom(honoured.host)).toBeLessThan(bottom(dropped.host));
  });

  it("and does not make it taller — the top stays where `render_height` puts it", () => {
    // The whole distinction between the two datums. Adding the base instead
    // of subtracting it would put this part's top at 30 + 90 m and lift the
    // roof; on the shared datum only the FLOOR moves.
    const honoured = mount(osmBuildingsLayer(), UPPER_ONLY, view);
    const dropped = mount({ ...osmBuildingsLayer(), baseOffsetProperty: undefined }, UPPER_ONLY, view);
    expect(Math.min(...inkedRows(honoured.host))).toBe(Math.min(...inkedRows(dropped.host)));
  });

  it("draws a podium and its tower as ONE stack rather than two boxes from the pavement", () => {
    // Both parts share a footprint, so with the base dropped the taller one
    // simply swallows the shorter and the pair is indistinguishable from the
    // tower alone. Honoured, the podium is the only thing under 30 m and the
    // frame differs.
    const both = mount(osmBuildingsLayer(), stack(), view);
    const towerOnly = mount(osmBuildingsLayer(), UPPER_ONLY, view);
    expect(text(both.host)).not.toBe(text(towerOnly.host));

    const droppedBoth = mount({ ...osmBuildingsLayer(), baseOffsetProperty: undefined }, stack(), view);
    const droppedTower = mount({ ...osmBuildingsLayer(), baseOffsetProperty: undefined }, UPPER_ONLY, view);
    expect(text(droppedBoth.host)).toBe(text(droppedTower.host));
  });

  it("a feature with no base at all renders identically either way", () => {
    const ground = [stack()[0]!];
    expect(text(mount(osmBuildingsLayer(), ground, view).host))
      .toBe(text(mount({ ...osmBuildingsLayer(), baseOffsetProperty: undefined }, ground, view).host));
  });
});

// --------------------------------------------------------------- real tile

const FIXTURE = path.resolve(__dirname, "../fixtures/openfreemap/z14-8579-5736.mvt");
/** The vendored tile's own address, so its geographic window is derived and not typed twice. */
const TILE = { z: 14, x: 8579, y: 5736 } as const;
const TILE_CENTRE: readonly [number, number] = [8.514404296875, 47.39091153623038];
/**
 * The south edge of the tile's tallest building (81 m, 59 x 51 m), so a walker
 * placed a few metres south of it is looking straight at a real wall. Read out
 * of the fixture, not invented.
 */
const WALL: readonly [number, number] = [8.514335, 47.387923];
/**
 * The tile's own stepped tower — 126 m, with parts based at 28, 35, 56 and
 * 91 m. Read out of the fixture; it is the only structure in it that
 * `render_min_height` has much to say about.
 */
const STEPPED_TOWER: readonly [number, number] = [8.51730, 47.38610];

function realBuildings(): readonly GlyphMapVectorFeature[] {
  return glyphMapDecodeMVT(readFileSync(FIXTURE), TILE.z, TILE.x, TILE.y).building;
}

/** The walker's own view: a perspective camera at 1.7 m, `metres` south of {@link WALL}, facing it. */
function street(layer: GlyphMapFillExtrusionLayer, metres: number) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hostsToRemove.push(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [WALL[0], WALL[1] - metres / 111320], span: 0.01, cols: COLS, rows: ROWS },
    // Walk mode needs a projection navigated by orbiting the camera.
    projection: glyphMapGlobe({ exaggeration: 1 }),
  });
  mounted.push(map);
  map.addLayer({ ...layer, source: { features: realBuildings() } } as GlyphMapFillExtrusionLayer);
  map.setWalk({});
  map.scene.rerender();
  return { host, map };
}

/** Cells that carry a character. A facade must never REDUCE this: a hole in a wall is not texture. */
function ink(host: HTMLElement): number {
  return [...text(host)].filter((c) => c !== " " && c !== "\n").length;
}

describe("the buildings row against the real OpenFreeMap tile it will mount", () => {
  const view = { center: TILE_CENTRE, span: 0.004 };

  it("paints far more distinct tones than the tile has FEATURES", () => {
    // The discriminator for per-FOOTPRINT seeding. This tile carries 1,991
    // buildings in 50 features, so a per-FEATURE seed is capped at 50 tones
    // however large the variation is, and in a street-level frame at far
    // fewer still — a whole neighbourhood in one colour, which is the report
    // this answers.
    const features = realBuildings();
    expect(features.length).toBe(50);
    const varied = colorSet(mount(osmBuildingsLayer(), features, view).host);
    const flat = colorSet(mount({ ...osmBuildingsLayer(), colorVariation: 0 }, features, view).host);
    expect(varied.size).toBeGreaterThan(features.length);
    expect(varied.size).toBeGreaterThan(flat.size * 3);
  });

  it("paints the same palette every time — a pan or a re-tile cannot make a street shimmer", () => {
    const features = realBuildings();
    const a = [...colorSet(mount(osmBuildingsLayer(), features, view).host)].sort();
    const b = [...colorSet(mount(osmBuildingsLayer(), features, view).host)].sort();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(1);
  });

  it("changes the frame — every one of the three reaches the rasterizer", () => {
    // Individually, from a walker's own position: each option is stripped on
    // its own so a failure names which link in the chain dropped it, and the
    // view is the street one because that is where all three have something
    // to say (a `render_min_height` band 115 m up is not in an overhead frame
    // at all).
    // Compared on the rendered HTML, not on the characters: `colorVariation`
    // is a statement about COLOUR alone, and a tone that stays inside its own
    // ramp step legitimately paints the same glyph.
    const wired = html(street(osmBuildingsLayer(), 30).host);
    for (const [what, stripped] of [
      ["facade", { facade: false }],
      ["colorVariation", { colorVariation: 0 }],
    ] as [string, Partial<GlyphMapFillExtrusionLayer>][]) {
      expect(html(street({ ...osmBuildingsLayer(), ...stripped }, 30).host), what).not.toBe(wired);
    }
  });

  it("and the base reaches it too, framed on the tile's own stepped tower", () => {
    // Only 8 of this tile's 50 features carry a non-zero `render_min_height`,
    // and they are not on the street the two above are measured from — so
    // this one is framed on the real one: a 126 m tower whose parts start at
    // 28, 35, 56 and 91 m, which is exactly the structure the column exists
    // to express.
    const features = realBuildings();
    const tower = { center: STEPPED_TOWER, span: 0.0012 };
    expect(html(mount({ ...osmBuildingsLayer(), baseOffsetProperty: undefined }, features, tower).host))
      .not.toBe(html(mount(osmBuildingsLayer(), features, tower).host));
  });
});

describe("the facade at EYE HEIGHT, which is the view it is judged in", () => {
  // The tile's own constants were chosen against an orbit view, before walk
  // mode existed. These are the three properties that make it read as a
  // facade rather than as noise from a walker's own position.
  const DISTANCES = [12, 30, 90];

  it("never takes a cell out of a wall", () => {
    // The defect the original tile had: a window texel at 0.23 of the surface
    // dropped the cell below the render's own ink floor, so the facade punched
    // HOLES in the building. Measured across five standing points and four
    // distances it cost 1,519 cells; the whole point of a facade is to add
    // information to a wall, never to remove the wall.
    for (const metres of DISTANCES) {
      expect(ink(street(osmBuildingsLayer(), metres).host))
        .toBe(ink(street({ ...osmBuildingsLayer(), facade: false }, metres).host));
    }
  });

  it("turns the solid ramp's dither into RUNS instead of adding more of it", () => {
    // A flat wall is one Lambert value, which the ramp dithers into
    // `=-=-=-=-` — maximum transition density, zero information. A facade has
    // to REPLACE that with structure, and mean glyph run is what separates a
    // pier-window-pier rhythm from a second dither laid over the first.
    //
    // A high-contrast tile at a distance where a 3.6 m bay is under one cell
    // wide merely aliases, and measured on this tile the original one made
    // the wall NOISIER than no facade at all (mean run 0.71x the untextured
    // wall across five standing points and four distances, against 0.88x
    // now).
    //
    // The 30% margin is asserted at the distance a reader is actually reading
    // a facade FROM; further out a bay stops being resolvable at all and the
    // honest claim is only that it does not go backwards.
    const [near, ...far] = DISTANCES;
    const flatNear = meanRun(street({ ...osmBuildingsLayer(), facade: false }, near!).host);
    expect(flatNear).toBeGreaterThan(0);
    expect(meanRun(street(osmBuildingsLayer(), near!).host)).toBeGreaterThan(flatNear * 1.3);
    for (const metres of far) {
      const flat = meanRun(street({ ...osmBuildingsLayer(), facade: false }, metres).host);
      expect(meanRun(street(osmBuildingsLayer(), metres).host)).toBeGreaterThan(flat);
    }
  });

  it("puts more distinct characters on the wall, so it survives `useColors: false`", () => {
    for (const metres of DISTANCES) {
      const flat = glyphSet(street({ ...osmBuildingsLayer(), facade: false }, metres).host);
      expect(glyphSet(street(osmBuildingsLayer(), metres).host).size).toBeGreaterThan(flat.size);
    }
  });
});

describe("a facade is a WALL texture — a roof must not inherit it", () => {
  it("is byte-identical looking straight down, where every visible face is a cap", () => {
    // `glyphMapVectorMesh` authors UVs on walls only, and this is the
    // end-to-end statement of it: a flat roof read from above is the one face
    // that already reads, and a bay/floor rhythm on a horizontal surface is
    // meaningless — it would only alias.
    const features = realBuildings();
    const overhead = { center: TILE_CENTRE, span: 0.004 };
    const withFacade = mountFlat(osmBuildingsLayer(), features, overhead);
    const without = mountFlat({ ...osmBuildingsLayer(), facade: false }, features, overhead);
    expect(text(withFacade.host)).toBe(text(without.host));
    expect(ink(withFacade.host)).toBeGreaterThan(0);
  });
});
