/**
 * A `symbol` layer labelling a LINE feature — the reported "water labels is
 * enabled, I see it in the seas but not in the lakes, like the lake nahuel
 * huapi in bariloche doesn't show".
 *
 * WHAT THE DATA ACTUALLY SAYS. OpenMapTiles' `water_name` carries a label as
 * a POINT for a compact body and as a LINE for an elongated one — the path a
 * normal renderer runs the name along. Read off the live service over
 * Bariloche, every lake in the region is a line and only the straits and the
 * oceans are points: `Lago Nahuel Huapi` is a 95-vertex LINE at z10 (57 at
 * z9, 100 at z11), and the world view's four ocean labels are points. So the
 * `omt-water-labels` row's `geometry: "point"` was not narrowing a mixed
 * layer to the drawable half — it was dropping every lake on Earth and
 * keeping the seas, which is the report verbatim.
 *
 * THE ANCHOR. This renderer has no curved text, so a line label has to
 * become a point. `glyphMapLabelAnchorPoint` takes the ARC-LENGTH MIDPOINT
 * OF THE FEATURE'S LONGEST PART, and both halves of that are load-bearing
 * against real data in the fixtures below:
 *
 *  - ARC LENGTH, not the middle vertex: the tiles' own simplification varies
 *    the vertex density wildly for one lake (57/95/100 vertices for Nahuel
 *    Huapi at z9/z10/z11), so an index midpoint would slide along the lake
 *    with the zoom.
 *  - THE MIDPOINT, not the first vertex: a label line is CLIPPED at the tile
 *    buffer, so its first vertex is wherever the cut fell. Nahuel Huapi's is
 *    `-71.8238, -41.0196`, which is not inside any water polygon in its own
 *    tile at all — the name would sit on a mountainside, and a different
 *    mountainside in the neighbouring tile.
 *  - THE LONGEST PART, one label per FEATURE: `Brazo Huemul` arrives at z12
 *    as two parts, 64 vertices and 4. One hotspot per ring prints the name
 *    twice, the second time on a 0.005-degree stub in a corner of the arm.
 *
 * The alternative the arc-length midpoint was chosen over — the vertex
 * nearest the polyline's centroid — is measured here rather than argued: on
 * this very tile it puts `Brazo Blest` outside the water (`-71.7258,
 * -41.0236`), because a centroid of a bent arm lies off the arm and the
 * nearest vertex to it is at the bend, and it drags `Lago Nahuel Huapi`
 * 0.057 degrees down the Brazo Tristeza arm at z11. The midpoint is on the
 * polyline BY CONSTRUCTION, and the polyline is the label path the schema
 * drew down the middle of the water.
 *
 * FIXTURES. `z10-308-640-lakeline.mvt` is the live OpenFreeMap tile over
 * Bariloche and the only vendored witness to a lake's name as a line WITH
 * the water polygons under it and a `water_name` POINT (the `Angostura`
 * strait) in the same tile, so "the lake is named in its own water" and "the
 * point labels are untouched" are both assertable against one real tile.
 * `z12-1235-2560-multipart.mvt` is the only witness to a MULTI-PART label
 * line.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import { glyphMapLabelAnchorPoint } from "./layers";
import { glyphMapDecodeMVT } from "./vector/pmtiles";
import { glyphMapOpenFreeMapProvider } from "./vector/openfreemap";
import { glyphMapOpenMapTilesLayers } from "./vector/openmaptiles";
import type { GlyphMapSymbolLayer } from "./widget";
import type { GlyphMapVectorFeature } from "./vector/types";

const FIXTURES = path.resolve(__dirname, "../fixtures/openfreemap");
const mvt = (name: string, z: number, x: number, y: number) =>
  glyphMapDecodeMVT(readFileSync(path.join(FIXTURES, name)), z, x, y);

const COLS = 140;
const ROWS = 63;
const CELL_W = 8;
const CELL_H = 16;

const rect = (w: number, h: number) =>
  ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
const EMPTY_RECT = rect(0, 0);
const stubbedHosts = new Set<HTMLElement>();

/** happy-dom has no layout; this is the host rect the widget's own grid divides into cells. */
function stubMonospaceMetrics(host: HTMLElement): void {
  stubbedHosts.add(host);
  if (vi.isMockFunction(Element.prototype.getBoundingClientRect)) return;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (stubbedHosts.has(el)) return rect(COLS * CELL_W, ROWS * CELL_H);
    return EMPTY_RECT;
  });
}

/** The shipped `omt-water-labels` row, re-pointed at a static collection of one real tile's features. */
function waterLabelLayer(features: readonly GlyphMapVectorFeature[], override: Partial<GlyphMapSymbolLayer> = {}): GlyphMapSymbolLayer {
  const row = glyphMapOpenMapTilesLayers(glyphMapOpenFreeMapProvider(), { include: ["omt-water-labels"] })[0] as GlyphMapSymbolLayer;
  return { ...row, id: "water-labels", source: { features }, ...override };
}

function mount(layer: GlyphMapSymbolLayer, view: { center: [number, number]; span: number }) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: view.center, span: view.span, cols: COLS, rows: ROWS },
    projection: glyphMapEquirectangular(),
    tilt: 0,
    layers: [layer],
  });
  // A hotspot's `left`/`top` are written at a render's commit stage, so the
  // staged position only exists after one has run.
  map.scene.rerender();
  return { host, map, done: () => { map.destroy(); host.remove(); } };
}

const symbols = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".glyph-map-symbol")];
const byText = (host: HTMLElement, text: string) =>
  symbols(host).find((el) => (el.textContent ?? "").replace(/\n/g, " ") === text);
const drawn = (host: HTMLElement) => symbols(host).filter((el) => el.style.opacity !== "0");

/**
 * The staged pixel position of a hotspot.
 *
 * PIXELS, compared against another hotspot in the SAME map rather than
 * converted to cells: glyphcss measures its own cell size with a probe
 * `<pre>` of its own, which the host-rect stub above deliberately does not
 * cover, so the widget's cell arithmetic and the rasterizer's need not agree
 * on a number here. Two markers in one render do agree with each other, and
 * "the line's label is exactly where a point at this lon/lat would be" is
 * the claim worth making anyway.
 */
const pxOf = (el: HTMLElement) => [parseFloat(el.style.left), parseFloat(el.style.top)] as const;

/** A synthetic `water_name` POINT — a measuring stick for where a lon/lat lands on the grid. */
const pointAt = (name: string, lon: number, lat: number): GlyphMapVectorFeature =>
  ({ geometryType: "point", properties: { name }, rings: [[[lon, lat]]] });

type Ring = readonly (readonly [number, number])[];

/** Even-odd point-in-ring, for asking the tile's OWN water polygons whether a label landed in the water. */
function inRing(ring: Ring, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function inWater(water: readonly GlyphMapVectorFeature[], lon: number, lat: number): boolean {
  for (const feature of water) {
    for (const group of feature.polygons ?? []) {
      if (group.length === 0) continue;
      if (inRing(group[0], lon, lat) && !group.slice(1).some((hole) => inRing(hole, lon, lat))) return true;
    }
  }
  return false;
}

/** The rejected alternative, implemented so its failure is measured rather than asserted in prose. */
function centroidNearestVertex(feature: GlyphMapVectorFeature): readonly [number, number] {
  const ring = [...feature.rings].sort((a, b) => b.length - a.length)[0];
  let sx = 0;
  let sy = 0;
  for (const [x, y] of ring) { sx += x; sy += y; }
  const cx = sx / ring.length;
  const cy = sy / ring.length;
  let best = ring[0];
  let bestD = Infinity;
  for (const p of ring) {
    const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

const BARILOCHE = { center: [-71.55, -41.05] as [number, number], span: 0.45 };
const lakeTile = () => mvt("z10-308-640-lakeline.mvt", 10, 308, 640);
const named = (features: readonly GlyphMapVectorFeature[], name: string) =>
  features.find((f) => f.properties?.name === name)!;

describe("a lake's name is a LINE, and the map now draws it", () => {
  it("draws `Lago Nahuel Huapi`, which the water-labels row dropped", () => {
    const tile = lakeTile();
    // The report's own premise, stated against the data: the lake is a line,
    // the strait beside it is a point, and only the point was ever drawn.
    expect(named(tile.water_name, "Lago Nahuel Huapi").geometryType).toBe("line");
    expect(named(tile.water_name, "Angostura").geometryType).toBe("point");

    const { host, map, done } = mount(waterLabelLayer(tile.water_name), BARILOCHE);
    try {
      const el = byText(host, "Lago Nahuel Huapi");
      expect(el, "the reported lake is labelled").toBeDefined();
      // Drawn, not merely present-and-suppressed.
      expect(el!.style.opacity).toBe("1");
      // And drawn INSIDE the frame the reader is looking at.
      const anchor = glyphMapLabelAnchorPoint(named(tile.water_name, "Lago Nahuel Huapi"))!;
      const at = map.project([anchor[0], anchor[1]]);
      expect(at.visible).toBe(true);
      expect(at.col).toBeGreaterThan(0);
      expect(at.col).toBeLessThan(COLS);
      expect(at.row).toBeGreaterThan(0);
      expect(at.row).toBeLessThan(ROWS);
    } finally {
      done();
    }
  });

  it("puts the name at the arc-length midpoint of its own label line, in the lake's own water", () => {
    const tile = lakeTile();
    const lake = named(tile.water_name, "Lago Nahuel Huapi");
    const anchor = glyphMapLabelAnchorPoint(lake)!;
    expect(anchor[0]).toBeCloseTo(-71.6121, 3);
    expect(anchor[1]).toBeCloseTo(-41.0353, 3);
    // The tile's OWN water polygons say it landed in the lake.
    expect(inWater(tile.water, anchor[0], anchor[1])).toBe(true);
    // ...and the naive first vertex, which is where the tile buffer cut the
    // label line, is not in any water in this tile.
    const first = lake.rings[0][0];
    expect(first[0]).toBeCloseTo(-71.8238, 3);
    expect(inWater(tile.water, first[0], first[1])).toBe(false);

    // Two measuring sticks in the same render: a point at the anchor and a
    // point at the cut, so "where the label landed" is a comparison between
    // markers rather than an assumption about cell size.
    const layer = waterLabelLayer([
      ...tile.water_name,
      pointAt("<anchor>", anchor[0], anchor[1]),
      pointAt("<cut>", first[0], first[1]),
    ]);
    const { host, map, done } = mount(layer, BARILOCHE);
    try {
      const el = byText(host, "Lago Nahuel Huapi")!;
      expect(pxOf(el)).toEqual(pxOf(byText(host, "<anchor>")!));
      // Not the first vertex by accident: that is 24 columns away on this frame.
      const cut = map.project([first[0], first[1]]);
      const at = map.project([anchor[0], anchor[1]]);
      expect(Math.hypot(at.col - cut.col, at.row - cut.row)).toBeGreaterThan(20);
      expect(pxOf(el)[0]).not.toBe(pxOf(byText(host, "<cut>")!)[0]);
    } finally {
      done();
    }
  });

  it("beats the vertex nearest the centroid, which puts `Brazo Blest` on the shore", () => {
    // The one alternative worth measuring rather than dismissing. A bent arm's
    // centroid lies OFF the arm, so the nearest vertex to it is at the bend.
    const tile = lakeTile();
    const blest = named(tile.water_name, "Brazo Blest");
    const anchor = glyphMapLabelAnchorPoint(blest)!;
    const rejected = centroidNearestVertex(blest);
    expect(inWater(tile.water, anchor[0], anchor[1])).toBe(true);
    expect(inWater(tile.water, rejected[0], rejected[1])).toBe(false);
  });

  it("prints a multi-part lake's name once, on its longest part", () => {
    const tile = mvt("z12-1235-2560-multipart.mvt", 12, 1235, 2560);
    const huemul = named(tile.water_name, "Brazo Huemul");
    // The witness: one feature, two parts, 64 vertices and 4.
    expect(huemul.rings.map((r) => r.length)).toEqual([64, 4]);

    const bare = mount(waterLabelLayer(tile.water_name), { center: [-71.42, -40.99], span: 0.2 });
    try {
      // Two features in this tile, two labels — not three.
      expect(tile.water_name).toHaveLength(2);
      expect(symbols(bare.host)).toHaveLength(2);
    } finally {
      bare.done();
    }

    const anchor = glyphMapLabelAnchorPoint(huemul)!;
    const { host, done } = mount(
      waterLabelLayer([...tile.water_name, pointAt("<anchor>", anchor[0], anchor[1])]),
      { center: [-71.42, -40.99], span: 0.2 },
    );
    try {
      const el = byText(host, "Brazo Huemul")!;
      expect(pxOf(el)).toEqual(pxOf(byText(host, "<anchor>")!));
      // The long part is FIRST in this tile, so ordering alone would pass:
      // the same feature with its parts swapped must answer the same point.
      const swapped: GlyphMapVectorFeature = { ...huemul, rings: [...huemul.rings].reverse() };
      expect(glyphMapLabelAnchorPoint(swapped)).toEqual(anchor);
      // And it is on the LONG part: every vertex of the 4-vertex stub is far away.
      for (const [lon, lat] of huemul.rings[1]) {
        expect(Math.hypot(anchor[0] - lon, anchor[1] - lat)).toBeGreaterThan(0.005);
      }
    } finally {
      done();
    }
  });
});

describe("the point labels the map already drew are untouched", () => {
  it("renders the world view's four ocean labels exactly as a point-only row does", () => {
    const z0 = mvt("z0-0-0.mvt", 0, 0, 0);
    expect(z0.water_name.every((f) => f.geometryType === "point")).toBe(true);

    const before = mount(
      waterLabelLayer(z0.water_name.filter((f) => f.geometryType === "point")),
      { center: [0, 0], span: 360 },
    );
    const beforeHtml = symbols(before.host).map((el) => el.outerHTML);
    before.done();

    const after = mount(waterLabelLayer(z0.water_name), { center: [0, 0], span: 360 });
    const afterHtml = symbols(after.host).map((el) => el.outerHTML);
    after.done();

    // Twelve elements, not four: each ocean's label is a MULTIPOINT repeated
    // across the world wrap, and one marker per point is what the layer has
    // always drawn. The number is asserted so a change to that would be seen.
    expect(beforeHtml).toHaveLength(12);
    expect(afterHtml).toEqual(beforeHtml);
  });

  it("keeps the `Angostura` point label's element and its place when the lake lines join it", () => {
    const tile = lakeTile();
    const points = tile.water_name.filter((f) => f.geometryType === "point");
    expect(points.map((f) => f.properties!.name)).toEqual(["Angostura"]);

    const before = mount(waterLabelLayer(points), BARILOCHE);
    const beforeEl = byText(before.host, "Angostura")!;
    const beforePos = [beforeEl.style.left, beforeEl.style.top];
    before.done();

    const after = mount(waterLabelLayer(tile.water_name), BARILOCHE);
    const afterEl = byText(after.host, "Angostura")!;
    expect([afterEl.style.left, afterEl.style.top]).toEqual(beforePos);
    expect(afterEl.style.color).toBe(beforeEl.style.color);
    expect(afterEl.style.width).toBe("");
    expect(afterEl.style.height).toBe("");
    after.done();
  });
});

describe("`glyphMapLabelAnchorPoint` on its own", () => {
  const line = (...points: (readonly [number, number])[]): GlyphMapVectorFeature =>
    ({ geometryType: "line", rings: [points] });

  it("is the arc-length midpoint, not the middle vertex", () => {
    // Nine vertices crammed into the first tenth of the line: an index
    // midpoint lands at x = 0.04, the arc-length one at the real middle.
    const dense = line([0, 0], [0.01, 0], [0.02, 0], [0.03, 0], [0.04, 0], [0.05, 0], [0.06, 0], [0.07, 0], [1, 0]);
    expect(glyphMapLabelAnchorPoint(dense)![0]).toBeCloseTo(0.5, 6);
  });

  it("weights longitude by the cosine of latitude, so the midpoint is a ground midpoint", () => {
    // An L at 60N, where one degree of longitude is half a degree of ground.
    // The east-west arm is 3 degrees of longitude = 1.5 of ground, the
    // north-south arm 1; the ground midpoint is 1.25 along, i.e. five sixths
    // of the way down the east-west arm at longitude 2.5. Unweighted degrees
    // would call the arms 3 and 1 and answer longitude 2 — inside the wrong
    // half of the bend.
    const bent = line([0, 60], [3, 60], [3, 61]);
    const [lon, lat] = glyphMapLabelAnchorPoint(bent)!;
    expect(lon).toBeCloseTo(2.5, 6);
    expect(lat).toBeCloseTo(60, 6);
  });

  it("takes the longest part of a multi-part line and ignores the stubs", () => {
    const multi: GlyphMapVectorFeature = { geometryType: "line", rings: [[[10, 0], [10.001, 0]], [[0, 0], [1, 0]]] };
    expect(glyphMapLabelAnchorPoint(multi)![0]).toBeCloseTo(0.5, 6);
  });

  it("crosses the antimeridian without landing on the far side of the world", () => {
    // The midpoint of 179E..179W is the antimeridian itself, normalized into
    // [-180, 180) — and emphatically not longitude 0, which is what measuring
    // that segment the long way round would give.
    const crossing = line([179, 0], [-179, 0]);
    expect(glyphMapLabelAnchorPoint(crossing)![0]).toBeCloseTo(-180, 6);
  });

  it("answers a degenerate line with its own vertex, and an empty one with null", () => {
    expect(glyphMapLabelAnchorPoint(line([5, 5], [5, 5], [5, 5]))).toEqual([5, 5]);
    expect(glyphMapLabelAnchorPoint({ geometryType: "line", rings: [] })).toBeNull();
    expect(glyphMapLabelAnchorPoint({ geometryType: "line", rings: [[]] })).toBeNull();
  });

  it("refuses a POLYGON, whose boundary midpoint would be on its own rim", () => {
    // A polygon label needs a pole of inaccessibility, which is a different
    // problem; answering with a boundary point would be a wrong answer rather
    // than no answer.
    const square: GlyphMapVectorFeature = { geometryType: "polygon", rings: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
    expect(glyphMapLabelAnchorPoint(square)).toBeNull();
  });
});

describe("the label budget the line labels spend", () => {
  it("turns one drawn label into five at the Bariloche view, and the arbiter suppresses none of them", () => {
    const tile = lakeTile();
    const points = tile.water_name.filter((f) => f.geometryType === "point");
    // The whole cost, stated: nine `water_name` features over Bariloche, one
    // of them a point. Eight new candidates reach the arbiter.
    expect(tile.water_name).toHaveLength(9);
    expect(points).toHaveLength(1);

    const before = mount(waterLabelLayer(points), BARILOCHE);
    const beforeDrawn = drawn(before.host).map((el) => el.textContent);
    before.done();

    const after = mount(waterLabelLayer(tile.water_name), BARILOCHE);
    const afterDrawn = drawn(after.host).map((el) => el.textContent);
    const candidates = symbols(after.host).length;
    after.done();

    // The map used to name one strait in the middle of a lake district.
    expect(beforeDrawn).toEqual(["Angostura"]);
    // It now names the lake and its arms — and still the strait, which is the
    // point half of the report holding under the new load.
    expect(afterDrawn).toEqual([
      "Lago Nahuel Huapi", "Brazo Tristeza", "Brazo Blest", "Brazo Huemul", "Angostura",
    ]);
    // The four that do not draw are off the frame, not decluttered: nothing
    // that was in view lost its place to a new label.
    expect(candidates).toBe(9);
    const off = ["Lago Todos Los Santos", "Lago Mascardi", "Lago Correntoso", "Embalse Alicur\u00e1"];
    const view = mount(waterLabelLayer(tile.water_name), BARILOCHE);
    for (const name of off) {
      const anchor = glyphMapLabelAnchorPoint(named(tile.water_name, name))!;
      const at = view.map.project([anchor[0], anchor[1]]);
      expect(at.col < 0 || at.col > COLS || at.row < 0 || at.row > ROWS, name).toBe(true);
    }
    view.done();
  });
});
