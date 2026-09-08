/**
 * `GlyphMapSymbolLayer.textAnchor` / `textOffset` — WHERE a place label sits
 * relative to its own point, and the box the arbiter reserves for it there.
 *
 * THE DEFECT THIS OPENED WITH. glyphcss's `addHotspot` gives every hotspot a
 * `size` box, defaulting to `[1, 1]` — `width: 1ch; height: <aspect>ch` —
 * which is right for a click anchor and wrong for a label: a 6-character
 * name in a 1-character box overflows it, and `.glyph-hotspot`'s
 * `translate(-50%, -50%)` then centres the ONE-CHARACTER BOX on the point
 * while the text runs off to the right of it. That is the reported
 * "left-aligned" label, and it is why the WRAPPED path looked right while
 * the single-line path did not: `text-align: center` (set only when a label
 * wrapped) makes an overflowing line box overflow symmetrically, which
 * accidentally compensated for the box. The fix is the box, not the
 * alignment — a symbol label's element carries NO width or height, so it is
 * shrink-to-fit and the CSS rule centres the label itself.
 *
 * WHAT IS PINNED HERE.
 *
 *  1. THE BOX. A single-line label's element carries no `width`/`height`
 *     declaration at all, asserted as the whole `outerHTML`, together with
 *     the `translate(-50%, -50%)` in glyphcss's own injected rule that does
 *     the centring. Either half alone proves nothing.
 *  2. EVERY ANCHOR, as the inline `transform` that displaces the box, with
 *     `left`/`top` still on the projected point — the anchor moves the
 *     label, never the anchor point. happy-dom has no layout, so the
 *     staged position plus the percentage transform IS the rendered
 *     position; the arbiter tests below then check the same displacement
 *     numerically, in cells, where it can be measured.
 *  3. THE ARBITER RESERVES THE MOVED BOX. Two neighbours around one anchored
 *     label, both placed in degrees and both checked against the map's own
 *     projection first: one that only the MOVED box reaches must be
 *     suppressed, and one that only the CENTRED box reached must be kept.
 *     Either one alone passes for a half-fix — the pair is the
 *     discriminator, and it is the trap the wrap work hit. Note WHICH half
 *     of the placement can discriminate at all: the anchor displaces each
 *     label by a fraction of its OWN width, so labels of different widths
 *     move by different amounts, while `textOffset` is a layer-wide rigid
 *     translation and provably cannot change the kept set — its box move is
 *     pinned on the arbiter itself in `layers.test.ts`.
 *  4. THE DEFAULT IS BYTE-IDENTICAL. An omitted anchor, and an explicit
 *     `"center"` with a zero offset, against a map that never heard of the
 *     option: every symbol element's whole `outerHTML`, and the rendered
 *     `<pre>`.
 *  5. CONTOUR LABELS ARE UNTOUCHED. They share this arbiter and pass no
 *     anchor; their stamped cells are compared against a map whose symbol
 *     layer is anchored hard to one side.
 *
 * FIXTURE NOTE. `span === cols`, so one column is one degree of longitude at
 * the equator and the neighbour placements below are readable; every
 * position assertion still goes through `map.project`.
 */
import { describe, expect, it, vi } from "vitest";
import { injectGlyphBaseStyles } from "glyphcss";
import { createGlyphMap } from "./widget";
import { GLYPH_MAP_LABEL_ANCHORS, glyphMapLabelAnchorFraction, type GlyphMapLabelAnchor } from "./layers";
import { glyphMapEquirectangular } from "./projection";
import type { GlyphMapVectorFeature } from "./vector/types";
import type { GlyphMapField } from "./types";

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

function place(name: string, lon: number, lat: number, rank = 1): GlyphMapVectorFeature {
  return { id: name, geometryType: "point", properties: { name, population_rank: rank }, rings: [[[lon, lat]]] };
}

function mount(features: readonly GlyphMapVectorFeature[], layer: Record<string, unknown> = {}, opts: { metrics?: boolean } = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  if (opts.metrics) stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: COLS, cols: COLS, rows: ROWS },
    projection: glyphMapEquirectangular(),
    tilt: 0,
    layers: [{ type: "symbol", id: "places", source: { features }, textProperty: "name", ...layer }],
  });
  return { host, map, done: () => { map.destroy(); host.remove(); } };
}

/** glyphcss's own injected rule — the half of the centring this package does not own. */
function injectedCss(): string {
  const doc = document.implementation.createHTMLDocument("");
  injectGlyphBaseStyles(doc);
  return doc.getElementById("glyph-styles")?.textContent ?? "";
}

const symbols = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".glyph-map-symbol")];
const byText = (host: HTMLElement, text: string) =>
  symbols(host).find((el) => (el.textContent ?? "").replace(/\n/g, " ") === text)!;

describe("GlyphMapSymbolLayer — a label's box is the label", () => {
  it("gives a single-line label no width or height, so the CSS rule centres the TEXT on the point", () => {
    const { host, done } = mount([place("Zurich", 0, 0)]);
    try {
      const el = symbols(host)[0];
      // The defect, stated as the two things that have to be true together:
      // no box constraining the label...
      expect(el.style.width).toBe("");
      expect(el.style.height).toBe("");
      // ...and the rule that centres whatever box it does have.
      expect(injectedCss()).toMatch(/\.glyph-scene \.glyph-hotspot\s*{[^}]*transform:\s*translate\(-50%,\s*-50%\)/);
      // The whole element, so a stray declaration cannot creep back in.
      expect(el.outerHTML).toBe(
        '<div class="glyph-hotspot glyph-map-symbol" data-hotspot-id="glyph-map-layer-point-0" style="position: absolute; opacity: 1;">Zurich</div>',
      );
    } finally { done(); }
  });
});

describe("GlyphMapSymbolLayer.textAnchor — every anchor", () => {
  const expected: Record<GlyphMapLabelAnchor, string> = {
    center: "",
    left: "translate(0%, -50%)",
    right: "translate(-100%, -50%)",
    top: "translate(-50%, 0%)",
    bottom: "translate(-50%, -100%)",
    "top-left": "translate(0%, 0%)",
    "top-right": "translate(-100%, 0%)",
    "bottom-left": "translate(0%, -100%)",
    "bottom-right": "translate(-100%, -100%)",
  };

  it("covers the whole MapLibre vocabulary and nothing else", () => {
    expect([...GLYPH_MAP_LABEL_ANCHORS].sort()).toEqual(Object.keys(expected).sort());
  });

  for (const anchor of Object.keys(expected) as GlyphMapLabelAnchor[]) {
    it(`places the label ${anchor} of its own point, leaving the point where it was`, () => {
      const anchored = mount([place("Zurich", 0, 0)], { textAnchor: anchor });
      const plain = mount([place("Zurich", 0, 0)]);
      try {
        const a = symbols(anchored.host)[0];
        const b = symbols(plain.host)[0];
        // The anchor moves the LABEL, not the anchor point: the staged
        // position is glyphcss's own and is identical.
        expect([a.style.left, a.style.top]).toEqual([b.style.left, b.style.top]);
        expect(a.style.transform).toBe(expected[anchor]);
        // ...and the displacement is exactly the fraction of its own box
        // that the shared anchor table names, which is what the arbiter
        // below measures in cells.
        const f = glyphMapLabelAnchorFraction(anchor);
        if (anchor !== "center") {
          expect(a.style.transform).toBe(`translate(${-50 + f.x * 100}%, ${-50 + f.y * 100}%)`);
        }
      } finally { anchored.done(); plain.done(); }
    });
  }
});

describe("GlyphMapSymbolLayer.textOffset — cells, on top of the anchor", () => {
  it("nudges the label by whole cells of the map's own grid, in CSS pixels", () => {
    const { host, done } = mount([place("Zurich", 0, 0)], { textOffset: [2, -1] }, { metrics: true });
    try {
      // 2 cells right and 1 cell up, in the grid's own cell size (the host
      // is 140 x 63 cells over 1120 x 1008 px).
      expect(symbols(host)[0].style.transform).toBe(
        `translate(calc(-50% + ${2 * CELL_W}px), calc(-50% - ${CELL_H}px))`,
      );
    } finally { done(); }
  });

  it("composes with an anchor rather than replacing it", () => {
    const { host, done } = mount([place("Zurich", 0, 0)], { textAnchor: "left", textOffset: [1, 0] }, { metrics: true });
    try {
      expect(symbols(host)[0].style.transform).toBe(`translate(calc(0% + ${CELL_W}px), -50%)`);
    } finally { done(); }
  });

  it("writes nothing at all for a zero offset", () => {
    const { host, done } = mount([place("Zurich", 0, 0)], { textOffset: [0, 0] }, { metrics: true });
    try {
      expect(symbols(host)[0].style.transform).toBe("");
    } finally { done(); }
  });
});

/**
 * The trap. `Zurich` is 6 cells wide; centred on its own column it reserves
 * `[-3, +3]`, and anchored `left` it reserves `[0, +6]`. A neighbour at
 * `+5` is reached ONLY by the moved box, one at `-2` ONLY by the centred
 * one. If the arbiter kept reserving the centred strip, the first would
 * survive on top of the label and the second would be suppressed for nothing
 * — the map would look emptier AND collide more.
 */
describe("GlyphMapSymbolLayer — the arbiter reserves the box where the label LANDS", () => {
  const fixture = (layer: Record<string, unknown>) => mount([
    place("Zurich", 0, 0, 9),
    place("Rt", 5, 0, 1),
    place("Lt", -2, 0, 1),
  ], layer);

  const premise = (map: ReturnType<typeof createGlyphMap>) => {
    const anchor = map.project([0, 0]);
    const right = map.project([5, 0]);
    const left = map.project([-2, 0]);
    // Same row, and the two columns the box arithmetic above assumes.
    expect([right.row, left.row]).toEqual([anchor.row, anchor.row]);
    expect(right.col - anchor.col).toBe(5);
    expect(left.col - anchor.col).toBe(-2);
  };

  it("suppresses a neighbour only the anchored box reaches, and keeps one only the centred box reached", () => {
    const { host, map, done } = fixture({ textAnchor: "left" });
    try {
      premise(map);
      expect(byText(host, "Zurich").style.opacity).toBe("1");
      expect(byText(host, "Rt").style.opacity).toBe("0");
      expect(byText(host, "Lt").style.opacity).toBe("1");
    } finally { done(); }
  });

  it("is the exact mirror of the default, which reserves the centred box", () => {
    const { host, map, done } = fixture({});
    try {
      premise(map);
      expect(byText(host, "Zurich").style.opacity).toBe("1");
      expect(byText(host, "Rt").style.opacity).toBe("1");
      expect(byText(host, "Lt").style.opacity).toBe("0");
    } finally { done(); }
  });

  it("cannot change the kept set for a pure OFFSET, because that translates every box in the layer together", () => {
    // Worth stating rather than assuming, since it is what makes the anchor
    // the interesting half: `textOffset` is a LAYER option, so it moves every
    // candidate by the same vector — a rigid translation, which preserves
    // every pairwise overlap and therefore the whole greedy result. The
    // anchor discriminates precisely because its displacement is a fraction
    // of each label's OWN width, and `Zurich` is 6 cells where `Rt` is 2.
    // (That the offset does move the reserved BOX is pinned on the arbiter
    // itself, in `layers.test.ts`, where a single candidate can move alone.)
    const shifted = fixture({ textOffset: [3, -2] });
    const plain = fixture({});
    try {
      premise(shifted.map);
      const kept = (f: typeof shifted) => ["Zurich", "Rt", "Lt"].map((t) => byText(f.host, t).style.opacity);
      expect(kept(shifted)).toEqual(kept(plain));
      // ...and it is genuinely a different picture: every label moved.
      expect(byText(shifted.host, "Zurich").style.transform).not.toBe("");
      expect(byText(plain.host, "Zurich").style.transform).toBe("");
    } finally { shifted.done(); plain.done(); }
  });
});

describe("GlyphMapSymbolLayer — the default is byte-identical", () => {
  it("adds not one declaration and not one changed cell for an omitted, or an explicitly centred, anchor", () => {
    const features = [place("Zurich", 0, 0, 9), place("Bern", 6, 2, 5), place("Genf", -9, -3, 3)];
    const omitted = mount(features);
    const explicit = mount(features, { textAnchor: "center", textOffset: [0, 0] });
    try {
      const a = symbols(omitted.host).map((el) => el.outerHTML);
      const b = symbols(explicit.host).map((el) => el.outerHTML);
      expect(a).toHaveLength(3);
      expect(b).toEqual(a);
      expect(explicit.map.scene.output.textContent).toBe(omitted.map.scene.output.textContent);
    } finally { omitted.done(); explicit.done(); }
  });
});

/**
 * The two label paths share ONE arbiter, and a contour label never asks for
 * an anchor. So the anchor must be invisible to it — not "close enough",
 * cell for cell. The fixture is the sibling `widget.contourLabels.test.ts`
 * one, unchanged: elevation ramps with latitude, so every level inks one
 * whole row and a label is a gap with digits in it.
 */
describe("contour labels are untouched by the symbol anchor", () => {
  const CCOLS = 60, CROWS = 40, CSPAN = 40;

  function latRampField(min: number, max: number): GlyphMapField {
    const values = new Float32Array(CCOLS * CROWS);
    for (let row = 0; row < CROWS; row++) {
      const v = min + (max - min) * (row / (CROWS - 1));
      for (let col = 0; col < CCOLS; col++) values[row * CCOLS + col] = v;
    }
    return {
      bounds: { west: -CSPAN / 2, east: CSPAN / 2, south: -(CSPAN * CROWS) / CCOLS / 2, north: (CSPAN * CROWS) / CCOLS / 2 },
      cols: CCOLS, rows: CROWS, values, noData: new Uint8Array(CCOLS * CROWS), kind: "continuous", min, max,
    };
  }

  function contourMap(symbolLayer: Record<string, unknown> | null): { text: string; done: () => void } {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: CSPAN, cols: CCOLS, rows: CROWS },
      projection: glyphMapEquirectangular(),
      tilt: 0,
    });
    map.addLayer({ type: "contour", id: "c", source: latRampField(0, 13000), levels: { interval: 1000 }, labels: true, color: "#00aaff" });
    if (symbolLayer) map.addLayer({ type: "symbol", id: "places", source: { features: [place("Zurich", 0, 0, 9)] }, textProperty: "name", ...symbolLayer });
    map.scene.rerender();
    return { text: map.scene.output.textContent ?? "", done: () => { map.destroy(); host.remove(); } };
  }

  it("stamps the same cells with no symbol layer, a default one, and one anchored hard to the corner", () => {
    const bare = contourMap(null);
    const plain = contourMap({});
    const anchored = contourMap({ textAnchor: "bottom-right", textOffset: [4, 3] });
    try {
      // The fixture is doing real work — there are labels to disturb.
      expect(bare.text).toMatch(/\d/);
      expect(plain.text).toBe(bare.text);
      expect(anchored.text).toBe(bare.text);
    } finally { bare.done(); plain.done(); anchored.done(); }
  });
});
