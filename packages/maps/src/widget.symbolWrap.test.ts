/**
 * Long `symbol` labels wrap onto several lines — and the declutter arbiter
 * sees the box they actually occupy.
 *
 * THE DEFECT. A symbol label was one line of characters however long the
 * name was. `Region de Magallanes y de la Antartica Chilena` is 46 cells; a
 * whole city view is 140. One name took a third of the frame, and the greedy
 * arbiter then suppressed every neighbour inside that strip to make room for
 * it.
 *
 * WHAT IS PINNED HERE, and why each assertion is shaped the way it is.
 *
 *  1. THE LINES AS DRAWN. Asserted on the element's own text split on its
 *     newlines, plus the two declarations that make those newlines RENDER
 *     (`white-space: pre` beats the page's `.glyph-map-symbol {
 *     white-space: nowrap }`, and `text-align: center` centres the lines on
 *     each other inside a box `.glyph-hotspot`'s `translate(-50%, -50%)`
 *     has already centred on the anchor). Without either, the label is a
 *     string with an invisible newline in it, not a wrapped label — so
 *     asserting the array alone would pass on a broken render.
 *  2. BALANCE. The widest line is bounded well under the unwrapped width,
 *     and no line is a stub next to a full one — the property greedy filling
 *     fails and minimum-raggedness buys.
 *  3. SHORT LABELS ARE UNTOUCHED, asserted as the element's whole
 *     `outerHTML` against an exact literal: one text node, no `white-space`,
 *     no `text-align`, nothing else added.
 *  4. THE ARBITER MEASURES THE WRAPPED BOX. Two neighbours around one long
 *     label, positioned from the map's OWN projection rather than assumed:
 *     one under the label (inside the wrapped block's extra rows, outside
 *     the old one-row strip) must now be suppressed, and one out on the
 *     flank (inside the old 46-cell strip, outside the wrapped block) must
 *     now be kept. Either one alone passes for a half-fix — the pair is the
 *     discriminator.
 *
 * FIXTURE NOTE. `span === cols`, so one column is one degree of longitude at
 * the equator and the neighbour placements below are readable; every
 * position assertion still goes through `map.project`, which reads the same
 * camera the renderer does (happy-dom has no layout).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapDecodeMVT } from "./vector/pmtiles";
import { glyphMapOpenMapTilesLayers } from "./vector/openmaptiles";
import { GLYPH_MAP_LABEL_WRAP_CELLS, GLYPH_MAP_LABEL_WRAP_MAX_LINES } from "./layers";
import { glyphMapEquirectangular } from "./projection";
import type { GlyphMapVectorFeature } from "./vector/types";

const COLS = 140;
const ROWS = 63;

/** A real OpenStreetMap/OpenMapTiles place name, and the one the report named. */
const LONG = "Region de Magallanes y de la Antartica Chilena";

function mount(features: readonly GlyphMapVectorFeature[], layer: Record<string, unknown> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: COLS, cols: COLS, rows: ROWS },
    projection: glyphMapEquirectangular(),
    tilt: 0,
    layers: [{ type: "symbol", id: "places", source: { features }, textProperty: "name", ...layer }],
  });
  return { host, map, done: () => { map.destroy(); host.remove(); } };
}

function place(name: string, lon: number, lat: number, rank = 1): GlyphMapVectorFeature {
  return { id: name, geometryType: "point", properties: { name, population_rank: rank }, rings: [[[lon, lat]]] };
}

const symbols = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".glyph-map-symbol")];
const byText = (host: HTMLElement, startsWith: string) =>
  symbols(host).find((el) => (el.textContent ?? "").replace(/\n/g, " ").startsWith(startsWith))!;

describe("GlyphMapSymbolLayer — long labels wrap", () => {
  it("draws a 46-character place name as balanced, centred lines instead of one 46-cell strip", () => {
    const { host, done } = mount([place(LONG, 0, 0)]);
    try {
      const el = symbols(host)[0];
      const lines = (el.textContent ?? "").split("\n");

      // More than one row, and no more than the cap.
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.length).toBeLessThanOrEqual(GLYPH_MAP_LABEL_WRAP_MAX_LINES);
      // The name itself survives the break — words only, nothing hyphenated
      // or dropped.
      expect(lines.join(" ")).toBe(LONG);
      // The block is far narrower than the strip it replaces.
      const widest = Math.max(...lines.map((l) => l.length));
      expect(widest).toBeLessThanOrEqual(GLYPH_MAP_LABEL_WRAP_CELLS);
      expect(widest).toBeLessThan(LONG.length / 2);
      // BALANCED, not greedy: greedy filling at 20 cells gives
      // `Region de Magallanes` / `y de la Antartica` / `Chilena` — a 7-cell
      // stub beside a 20-cell line. Minimum raggedness keeps every line
      // within a few cells of the widest.
      expect(Math.min(...lines.map((l) => l.length))).toBeGreaterThanOrEqual(widest / 2);
      expect(lines).toEqual(["Region de", "Magallanes y de la", "Antartica Chilena"]);

      // The newlines must actually render as breaks, and the lines must be
      // centred on each other — the page's own rule is `white-space: nowrap`.
      expect(el.style.whiteSpace).toBe("pre");
      expect(el.style.textAlign).toBe("center");
    } finally { done(); }
  });

  it("anchors the wrapped block on the feature's own point, exactly where the unwrapped label sat", () => {
    // Against the SHORT label's own staged position at the identical point,
    // not against a recomputed one: the anchor is glyphcss's, and the claim
    // is that wrapping does not move it.
    const wrapped = mount([place(LONG, 0, 0)]);
    const plain = mount([place("Zurich", 0, 0)]);
    try {
      const a = symbols(wrapped.host)[0];
      const b = symbols(plain.host)[0];
      expect(wrapped.map.project([0, 0])).toEqual(plain.map.project([0, 0]));
      expect([a.style.left, a.style.top]).toEqual([b.style.left, b.style.top]);
      // ...and it is the element's own box that grows, centred on that
      // anchor by `.glyph-hotspot`'s `translate(-50%, -50%)` plus the
      // `text-align: center` above — nothing here nudges it.
      expect(a.style.transform).toBe(b.style.transform);
      expect(a.style.marginLeft).toBe(b.style.marginLeft);
      expect(a.style.marginTop).toBe(b.style.marginTop);
    } finally { wrapped.done(); plain.done(); }
  });

  it("leaves a short label byte-identical — one text node, and not one declaration added", () => {
    const { host, done } = mount([place("Zurich", 0, 0)]);
    try {
      const el = symbols(host)[0];
      expect(el.textContent).toBe("Zurich");
      expect(el.childNodes).toHaveLength(1);
      expect(el.childNodes[0].nodeType).toBe(3);
      expect(el.style.whiteSpace).toBe("");
      expect(el.style.textAlign).toBe("");
      // The whole element, not a field of it: a wrap that leaked a style, a
      // class or a child onto the short path fails here.
      expect(el.outerHTML).toBe(
        '<div class="glyph-hotspot glyph-map-symbol" data-hotspot-id="glyph-map-layer-point-0" style="position: absolute; width: 1ch; height: 2ch; opacity: 1;">Zurich</div>',
      );
    } finally { done(); }
  });

  it("leaves a label exactly at the wrap width alone, and breaks the one character past it", () => {
    // The boundary itself, in two separate maps so neither label can be
    // mistaken for the other: 20 characters is untouched, 21 wraps.
    const at = "Aaaaaaaa Bbbbbbbbbbb";
    const past = "Cccccccc Ddddddddddd" + "d";
    expect([at.length, past.length]).toEqual([GLYPH_MAP_LABEL_WRAP_CELLS, GLYPH_MAP_LABEL_WRAP_CELLS + 1]);
    const first = mount([place(at, 0, 0)]);
    const second = mount([place(past, 0, 0)]);
    try {
      expect(symbols(first.host)[0].textContent).toBe(at);
      expect(symbols(first.host)[0].style.whiteSpace).toBe("");
      expect((symbols(second.host)[0].textContent ?? "").split("\n")).toEqual(["Cccccccc", "Dddddddddddd"]);
    } finally { first.done(); second.done(); }
  });

  it("never cuts a word: a single word longer than the wrap width overflows its own line", () => {
    const word = "Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch"; // 58, one word
    const { host, done } = mount([place(word, 0, 0)]);
    try {
      const el = symbols(host)[0];
      expect(el.textContent).toBe(word);
      expect(el.style.whiteSpace).toBe("");
    } finally { done(); }
  });
});

describe("GlyphMapSymbolLayer — the arbiter reserves the WRAPPED box", () => {
  /**
   * One long, high-priority label at the centre and two lower-priority
   * neighbours placed by degrees-of-longitude/latitude, then checked against
   * the map's own projection before anything is concluded from them.
   */
  function fixture(): { host: HTMLElement; map: ReturnType<typeof createGlyphMap>; done: () => void } {
    return mount([
      place(LONG, 0, 0, 9),
      // Directly BELOW the anchor: outside a one-row strip, inside the
      // wrapped block's extra rows.
      place("Under", 0, -2, 1),
      // Out on the FLANK: inside the old 46-cell strip (half-width 23),
      // clear of the wrapped block (half-width ~9 plus its own).
      place("Flank", 16, 0, 1),
    ]);
  }

  it("suppresses a neighbour that the wrapped block's extra rows now cover", () => {
    const { host, map, done } = fixture();
    try {
      const anchor = map.project([0, 0]);
      const under = map.project([0, -2]);
      // The fixture's premise, asserted rather than assumed: `Under` is on a
      // different row, close enough that a 3-row block reaches it and a
      // 1-row one does not.
      expect(under.col).toBe(anchor.col);
      expect(Math.abs(under.row - anchor.row)).toBeGreaterThan(0);
      expect(Math.abs(under.row - anchor.row)).toBeLessThan(GLYPH_MAP_LABEL_WRAP_MAX_LINES);

      expect(byText(host, "Region").style.opacity).toBe("1");
      expect(byText(host, "Under").style.opacity).toBe("0");
    } finally { done(); }
  });

  it("keeps a neighbour that only ever collided with the UNWRAPPED strip", () => {
    const { host, map, done } = fixture();
    try {
      const anchor = map.project([0, 0]);
      const flank = map.project([16, 0]);
      const gap = Math.abs(flank.col - anchor.col);
      // Same row, and in the band that the 46-cell strip covered
      // (half-width 23, plus half of `Flank`'s own 5) but the wrapped block
      // does not (half-width <= 10, plus the same 2.5).
      expect(flank.row).toBe(anchor.row);
      expect(gap).toBeLessThan(LONG.length / 2 + "Flank".length / 2);
      expect(gap).toBeGreaterThan(GLYPH_MAP_LABEL_WRAP_CELLS / 2 + "Flank".length / 2);

      expect(byText(host, "Flank").style.opacity).toBe("1");
    } finally { done(); }
  });
});

/**
 * The same thing end to end on REAL data, through the REAL OpenMapTiles
 * table row — the check that wrapping is reached where a label is turned
 * into cells and not bolted onto one call site. Nothing here touches the
 * network: `z8-60-96-peaks.mvt` is bytes the live OpenFreeMap service
 * served, vendored under `fixtures/openfreemap/`.
 */
describe("GlyphMapSymbolLayer — a real OpenStreetMap name from a real tile", () => {
  const REAL = "Prairie Band Potawatomi Nation / Mshkodéniwek"; // 45 characters, `park` layer

  it("wraps `Prairie Band Potawatomi Nation / Mshkodéniwek` on the omt-parks row, with no table change", () => {
    const tile = glyphMapDecodeMVT(
      readFileSync(path.resolve(__dirname, "../fixtures/openfreemap/z8-60-96-peaks.mvt")),
      8, 60, 96,
    );
    expect(tile.park.some((f) => f.properties?.name === REAL)).toBe(true);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [-95.5, 40], span: 6, cols: COLS, rows: ROWS },
      projection: glyphMapEquirectangular(),
      tilt: 0,
    });
    try {
      // The table's own row, unmodified — `omt-parks` is `symbol`, named
      // points only.
      const [parks] = glyphMapOpenMapTilesLayers({ features: tile.park }, { include: ["omt-parks"] });
      map.addLayer(parks);
      const el = symbols(host).find((e) => (e.textContent ?? "").replace(/\n/g, " ") === REAL);
      expect(el).toBeDefined();
      // 12 / 17 / 14 — the OSM bilingual separator is treated as the word
      // it is tagged as and simply lands at the head of the last line.
      expect((el!.textContent ?? "").split("\n")).toEqual([
        "Prairie Band",
        "Potawatomi Nation",
        "/ Mshkodéniwek",
      ]);
      expect(el!.style.whiteSpace).toBe("pre");
      expect(el!.style.textAlign).toBe("center");
    } finally { map.destroy(); host.remove(); }
  });
});
