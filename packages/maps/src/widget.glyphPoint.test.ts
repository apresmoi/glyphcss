/**
 * The `glyph` layer end to end — point features drawn as GLYPHS IN THE GRID.
 *
 * Reported, on seeing the four live rows on `/maps` drawn as DOM circles:
 *
 * > "lets not use that for the live datasets, lets use glyphs for them :/
 * > also, the satellites are super tiny, don't we have also the height at
 * > which the satellites are orbiting? so we can make them at the right
 * > height? and maybe we can make them bigger?"
 *
 * Four separable properties come out of that, and each has its own clause
 * here because each can break without the others noticing:
 *
 * 1. **The mark is grid ink, not a node.** A `circle` adds a `<div>`; this
 *    must add none, and must change the `<pre>`.
 * 2. **It is occluded like the picture it is now part of** — by terrain in
 *    front of it, and by the globe's own limb.
 * 3. **Altitude is TRUE METRES**, exempt from the terrain's `exaggeration`
 *    exactly as a `fill-extrusion`'s height is. This is the load-bearing one:
 *    at `/maps`' default `exaggeration: 24` the exempt answer puts the ISS
 *    8.6% of a radius up and the un-exempt one puts it 207% up — two Earth
 *    radii past the far side of the planet.
 * 4. **Size varies with magnitude**, in CELLS, and the counts are of CELLS
 *    rather than of total ink: a count of non-blank characters is satisfied
 *    by a label, by the terrain, or by a neighbouring mark.
 *
 * The column trap every near/far assertion in this package has to respect
 * applies here too: `sin(180 - L) === sin(L)`, so a far-side point projects
 * onto its near-side twin's COLUMN. Every visibility clause below is keyed on
 * ROWS or on radial distance, never on a bare column match.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe, GLYPH_MAP_EARTH_RADIUS_M } from "./projection";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapVectorFeature } from "./vector/types";

const COLS = 120;
const ROWS = 48;
const CELL_W = 8;
const CELL_H = 16;
const BASE_FONT_PX = 16;
/** The altitude the reporter asked about — the ISS's own, near enough. 8.6% of Earth's radius. */
const ISS_ALT_KM = 550;

const EMPTY_RECT = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
const rect = (width: number, height: number): DOMRect =>
  ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
const stubbedHosts = new Set<Element>();

/**
 * happy-dom has no layout, so both the camera and glyphcss's own hidden
 * `<pre>` cell probe are given the same 8x16 cell. The `scene.output` `<pre>`
 * is stubbed too — unlike the stroke tests, this file resolves a POINTER
 * position against it (`pointerCell`), which is a no-op against a zero box.
 */
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
const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const m of mounted.splice(0)) m.destroy();
  for (const h of hosts.splice(0)) h.remove();
  vi.restoreAllMocks();
  stubbedHosts.clear();
  document.body.innerHTML = "";
});

function mount(opts: Partial<Parameters<typeof createGlyphMap>[1]> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: 150, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe(),
    tilt: 0,
    ...opts,
  });
  stubbedHosts.add(map.scene.output);
  mounted.push(map);
  return { host, map };
}

const point = (id: string, lon: number, lat: number, properties: Record<string, unknown> = {}): GlyphMapVectorFeature =>
  ({ id, geometryType: "point", properties, rings: [[[lon, lat]]] });

const frame = (map: { scene: { output: { textContent: string | null } } }): string => map.scene.output.textContent ?? "";
const gridRows = (map: { scene: { output: { textContent: string | null } } }): string[] => frame(map).split("\n");

/** Every cell this render CHANGED relative to `before` — i.e. the cells the glyph layer itself inked. */
function inkedCells(before: readonly string[], after: readonly string[]): { row: number; col: number }[] {
  const out: { row: number; col: number }[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if ((before[row]?.[col] ?? " ") !== (after[row]?.[col] ?? " ")) out.push({ row, col });
    }
  }
  return out;
}

/** Cells this render changed inside a `radius`-cell box around `(col, row)` — counting CELLS, never total ink. */
function inkedNear(before: readonly string[], after: readonly string[], col: number, row: number, radius = 4): number {
  return inkedCells(before, after).filter((c) => Math.abs(c.col - col) <= radius * 2 && Math.abs(c.row - row) <= radius).length;
}

async function settle(map: { idle(): Promise<void>; scene: { rerender(): void } }): Promise<void> {
  await map.idle();
  map.scene.rerender();
}

describe("createGlyphMap — a `glyph` layer is grid ink, not a DOM node", () => {
  it("adds no hotspot element and changes the `<pre>` instead", async () => {
    const { host, map } = mount({ projection: glyphMapEquirectangular(), view: { center: [0, 0], span: 120, cols: COLS, rows: ROWS } });
    await settle(map);
    const before = gridRows(map);
    const hotspotsBefore = host.querySelectorAll(".glyph-hotspot").length;

    map.addLayer({ type: "glyph", id: "live", source: { features: [point("a", 0, 0), point("b", 20, 20)] }, color: "#ff6b4a" });
    await settle(map);

    // The whole point of the change: no element per feature.
    expect(host.querySelectorAll(".glyph-hotspot").length).toBe(hotspotsBefore);
    expect(host.querySelectorAll(".glyph-map-circle").length).toBe(0);
    // ...and the picture genuinely changed. A layer that silently drew
    // nothing would also add no elements.
    const ink = inkedCells(before, gridRows(map));
    expect(ink.length).toBeGreaterThanOrEqual(2);
    // The mark lands where the widget's own public `project` says the
    // feature is, within a cell.
    const at = map.project([20, 20]);
    expect(inkedNear(before, gridRows(map), at.col, at.row, 1)).toBeGreaterThan(0);
  });

  it("restores a byte-identical frame when the layer is removed", async () => {
    const { map } = mount({ projection: glyphMapEquirectangular(), view: { center: [0, 0], span: 120, cols: COLS, rows: ROWS } });
    await settle(map);
    const before = frame(map);
    const id = map.addLayer({ type: "glyph", source: { features: [point("a", 0, 0)] }, color: "#ff6b4a" });
    await settle(map);
    expect(frame(map)).not.toBe(before);
    map.removeLayer(id);
    await settle(map);
    expect(frame(map)).toBe(before);
  });
});

describe("createGlyphMap — a `glyph` mark's size is its magnitude", () => {
  it("draws more CELLS for a larger magnitude, at both a world view and a regional one", async () => {
    for (const span of [150, 12]) {
      const { map } = mount({ projection: glyphMapEquirectangular(), view: { center: [0, 0], span, cols: COLS, rows: ROWS } });
      await settle(map);
      const before = gridRows(map);
      // Two features far enough apart that their footprints cannot overlap,
      // carrying the range USGS' own weekly feed spans (2.5 to 5.6).
      map.addLayer({
        type: "glyph",
        source: { features: [point("small", -span / 5, 0, { mag: 2.5 }), point("big", span / 5, 0, { mag: 5.6 })] },
        color: "#ff6b4a",
        sizeProperty: "mag",
        sizeScale: 0.2,
      });
      await settle(map);
      const after = gridRows(map);
      const small = map.project([-span / 5, 0]);
      const big = map.project([span / 5, 0]);
      const smallCells = inkedNear(before, after, small.col, small.row);
      const bigCells = inkedNear(before, after, big.col, big.row);
      // Both drawn — a "bigger" that works by making the small one vanish is
      // not the property asked for.
      expect(smallCells, `span ${span}: the small mark`).toBeGreaterThan(0);
      expect(bigCells, `span ${span}: the big mark`).toBeGreaterThan(smallCells);
      // And the big one is genuinely MULTI-CELL, which is what "bigger" means
      // on a character grid — a ramp step alone would leave both at 1.
      expect(bigCells, `span ${span}: the big mark spans cells`).toBeGreaterThan(3);
      map.destroy();
    }
  });
});

describe("createGlyphMap — a `glyph` mark is occluded like the picture it is part of", () => {
  /**
   * `groundElevation: () => 0` PINS the mark at the datum. Without it a mark
   * stands ON the terrain under it, so a raised tile that is also its only
   * ground source cannot possibly occlude it — the same trap
   * `widget.stroke.test.ts` documents for a draped stroke.
   */
  it("is hidden behind terrain standing in front of it", async () => {
    const ridge: GlyphMapGeoTile = {
      bounds: { west: -6, east: 6, south: -20, north: 20 },
      cols: 4, rows: 4,
      elevation: new Float32Array(25).fill(2_000_000),
      source: "synthetic", sampler: "nearest",
    };
    // An equirectangular sheet's own X/Y are DEGREES, so a plateau's screen
    // height is `elev / R * exaggeration` degrees: at 24x this one stands 7.5
    // degrees tall over a 60-degree view, which is a real wall. At 1x it is
    // 0.31 degrees and could not occlude anything.
    const { map } = mount({
      projection: glyphMapEquirectangular({ exaggeration: 24 }),
      view: { center: [0, 0], span: 60, cols: COLS, rows: ROWS },
      tilt: 60,
      groundElevation: () => 0,
    });
    map.addLayer({ type: "raster", id: "ridge", source: ridge });
    await settle(map);
    const before = gridRows(map);

    map.addLayer({
      type: "glyph",
      id: "marks",
      color: "#ff0000",
      source: { features: [point("behind", 0, 0), point("clear", 25, 0)] },
    });
    await settle(map);
    const after = gridRows(map);

    const behind = map.project([0, 0]);
    const clear = map.project([25, 0]);
    // The premise: the ridge really does cover the first mark's cell.
    expect((before[Math.round(behind.row)]?.[Math.round(behind.col)] ?? " ")).not.toBe(" ");
    expect(inkedNear(before, after, behind.col, behind.row, 1)).toBe(0);
    // The negative control: an occlusion "fix" that stopped drawing the layer
    // would pass the clause above.
    expect(inkedNear(before, after, clear.col, clear.row, 1)).toBeGreaterThan(0);
  });

  it("is hidden round the limb of a globe", async () => {
    const { map } = mount();
    await settle(map);
    const before = gridRows(map);
    // lon 150 is 150 degrees from the sub-observer point — far side, with a
    // wide margin. Its near-side twin at lon 30 shares its COLUMN, which is
    // why the assertion below is on the twin's ROW too.
    const near = map.project([30, 40]);
    const far = map.project([150, -40]);
    expect(Math.round(near.col)).toBe(Math.round(far.col)); // the trap, asserted
    expect(Math.round(near.row)).not.toBe(Math.round(far.row)); // the discriminator
    expect(far.visible).toBe(false);

    map.addLayer({ type: "glyph", id: "marks", color: "#ff0000", source: { features: [point("far", 150, -40), point("near", 30, 40)] } });
    await settle(map);
    const after = gridRows(map);
    expect(inkedNear(before, after, far.col, far.row, 1)).toBe(0);
    expect(inkedNear(before, after, near.col, near.row, 1)).toBeGreaterThan(0);
  });
});

describe("createGlyphMap — a `glyph` mark's altitude is TRUE METRES", () => {
  /**
   * The row/column a point at radial scale `k` reaches, from public API only:
   * the globe's `project` is purely radial and the orthographic camera is
   * affine, so `pos(k*P) = origin + k*(pos(P) - origin)`, and the ANTIPODE
   * recovers the origin's own screen position.
   */
  function radialAt(map: ReturnType<typeof createGlyphMap>, lon: number, lat: number, k: number): { col: number; row: number } {
    const near = map.project([lon, lat]);
    const far = map.project([lon + 180, -lat]);
    const originCol = (near.col + far.col) / 2;
    const originRow = (near.row + far.row) / 2;
    return { col: originCol + k * (near.col - originCol), row: originRow + k * (near.row - originRow) };
  }

  it("puts a satellite at its real orbital altitude, NOT at the terrain's exaggeration", async () => {
    // A modest exaggeration on purpose: at `/maps`' own 24x the un-exempt
    // answer is `k = 3.07`, i.e. off the grid entirely, and a test whose
    // wrong answer is "nothing drawn" cannot tell a missed exemption from a
    // missed feature. At 8x both candidates are on screen and the assertion
    // is a real discrimination between two drawn positions.
    const EXAG = 8;
    const { map } = mount({ projection: glyphMapGlobe({ exaggeration: EXAG }) });
    await settle(map);
    const before = gridRows(map);

    map.addLayer({
      type: "glyph",
      id: "sats",
      color: "#c9f0ff",
      ramp: ["★"],
      source: { features: [point("iss", 30, 0, { altKm: ISS_ALT_KM })] },
      altitudeProperty: "altKm",
      altitudeScale: 1000,
    });
    await settle(map);
    const ink = inkedCells(before, gridRows(map));
    expect(ink.length).toBeGreaterThan(0);

    const trueK = 1 + (ISS_ALT_KM * 1000) / GLYPH_MAP_EARTH_RADIUS_M;
    const exaggeratedK = 1 + ((ISS_ALT_KM * 1000) / GLYPH_MAP_EARTH_RADIUS_M) * EXAG;
    const expected = radialAt(map, 30, 0, trueK);
    const wrong = radialAt(map, 30, 0, exaggeratedK);
    const ground = radialAt(map, 30, 0, 1);
    // The premise: the three candidate positions are far enough apart that
    // landing on the right one is evidence.
    expect(Math.abs(wrong.col - expected.col)).toBeGreaterThan(5);
    expect(Math.abs(expected.col - ground.col)).toBeGreaterThan(1);

    const drawn = ink.reduce((best, c) => (Math.hypot(c.col - expected.col, c.row - expected.row) < Math.hypot(best.col - expected.col, best.row - expected.row) ? c : best));
    expect(Math.abs(drawn.col - expected.col)).toBeLessThanOrEqual(1);
    expect(Math.abs(drawn.row - expected.row)).toBeLessThanOrEqual(1);
    // Nothing was drawn at the exaggerated position, which is what a missing
    // `glyphMapTrueScaleElevation` would produce.
    expect(ink.filter((c) => Math.hypot(c.col - wrong.col, c.row - wrong.row) <= 1)).toEqual([]);
    // ...and it is genuinely ABOVE the surface, not on it.
    expect(ink.filter((c) => Math.hypot(c.col - ground.col, c.row - ground.row) <= 0.5)).toEqual([]);
  });

  it("clears the limb from altitude — the ship's mast before the hull — but is still hidden behind the Earth", async () => {
    // At 550 km the horizon reaches `acos(R / (R + h))` = 23.1 degrees past
    // the datum's own 90, so a satellite is visible out to ~113 degrees from
    // the sub-observer point and hidden beyond it. Both sides of that are
    // asserted, because a horizon test that simply passed everything would
    // satisfy the first clause alone.
    const { map } = mount({ projection: glyphMapGlobe({ exaggeration: 24 }) });
    await settle(map);
    const before = gridRows(map);
    map.addLayer({
      type: "glyph", id: "sats", color: "#c9f0ff", ramp: ["★"],
      source: { features: [point("over", 100, 0, { altKm: ISS_ALT_KM }), point("behind", 175, 0, { altKm: ISS_ALT_KM })] },
      altitudeProperty: "altKm", altitudeScale: 1000,
    });
    await settle(map);
    const ink = inkedCells(before, gridRows(map));

    // A self-calibrating limb radius in this grid's own columns: `[0, 0]` is
    // the sub-observer point and `[90, 0]` sits exactly ON the silhouette.
    const centre = map.project([0, 0]);
    const limb = map.project([90, 0]);
    const limbCols = Math.abs(limb.col - centre.col);
    expect(limbCols).toBeGreaterThan(1);

    // Exactly ONE object drew, and it drew BEYOND the datum's own silhouette
    // — nothing on the surface can reach those columns.
    expect(ink.length).toBeGreaterThan(0);
    expect(ink.every((c) => Math.abs(c.col - centre.col) > limbCols)).toBe(true);
    // The one at 175 degrees is behind the planet. Its column is the mirror
    // of the visible one's, so this is keyed on the count of distinct
    // clusters rather than on a column: all the ink is on one side.
    const sides = new Set(ink.map((c) => Math.sign(c.col - centre.col)));
    expect(sides.size).toBe(1);
  });

  it("buries a mark given a NEGATIVE altitude — the reason an earthquake's depth is not one", async () => {
    // USGS ships a quake's hypocentre depth in km, positive DOWNWARD, up to
    // 608 km in the vendored week. Fed to this axis it is a negative
    // altitude, and this is what that renders as: nothing at all, because
    // the surface the reader can see is in front of it. So the epicentre is
    // what the mark stands on and the depth stays a property.
    const { map } = mount({
      projection: glyphMapEquirectangular({ exaggeration: 1 }),
      view: { center: [0, 0], span: 60, cols: COLS, rows: ROWS },
      tilt: 0,
      groundElevation: () => 0,
    });
    map.addLayer({
      type: "raster", id: "ground",
      source: { bounds: { west: -30, east: 30, south: -15, north: 15 }, cols: 4, rows: 4, elevation: new Float32Array(25).fill(0), source: "synthetic", sampler: "nearest" } satisfies GlyphMapGeoTile,
    });
    await settle(map);
    const before = gridRows(map);
    map.addLayer({
      type: "glyph", id: "quakes", color: "#ff0000",
      source: { features: [point("deep", 0, 0, { depthKm: 600 }), point("surface", 10, 0, {})] },
      altitudeProperty: "depthKm", altitudeScale: -1000,
    });
    await settle(map);
    const after = gridRows(map);
    const deep = map.project([0, 0]);
    const surface = map.project([10, 0]);
    expect(inkedNear(before, after, deep.col, deep.row, 1)).toBe(0);
    expect(inkedNear(before, after, surface.col, surface.row, 1)).toBeGreaterThan(0);
  });
});

describe("createGlyphMap — a stamped mark is selected by hit test, never by an element", () => {
  function press(host: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }): void {
    const opts = { pointerId: 1, pointerType: "mouse", bubbles: true, button: 0 } as PointerEventInit;
    host.dispatchEvent(new PointerEvent("pointerdown", { ...opts, clientX: from.x, clientY: from.y }));
    host.dispatchEvent(new PointerEvent("pointermove", { ...opts, clientX: to.x, clientY: to.y }));
    host.dispatchEvent(new PointerEvent("pointerup", { ...opts, clientX: to.x, clientY: to.y }));
  }

  async function mountSelectable(onSelect: (f: GlyphMapVectorFeature) => void) {
    const { host, map } = mount({ projection: glyphMapEquirectangular(), view: { center: [0, 0], span: 120, cols: COLS, rows: ROWS } });
    await settle(map);
    map.addLayer({
      type: "glyph", id: "quakes", color: "#ff6b4a",
      source: { features: [point("q1", 30, 20, { url: "https://example.test/q1" })] },
      onSelect,
    });
    await settle(map);
    return { host, map };
  }

  it("calls onSelect with the feature under the click", async () => {
    const selected: GlyphMapVectorFeature[] = [];
    const { host, map } = await mountSelectable((f) => selected.push(f));
    const at = map.project([30, 20]);
    const x = at.col * CELL_W;
    const y = at.row * CELL_H;
    press(host, { x, y }, { x, y });
    expect(selected.map((f) => f.id)).toEqual(["q1"]);
    expect(selected[0]!.properties?.url).toBe("https://example.test/q1");
  });

  it("does NOT fire for a press that dragged — a pan is not a click", async () => {
    const selected: GlyphMapVectorFeature[] = [];
    const { host, map } = await mountSelectable((f) => selected.push(f));
    const at = map.project([30, 20]);
    const x = at.col * CELL_W;
    const y = at.row * CELL_H;
    // Past the widget's own 3 px click tolerance, ending back over the mark.
    press(host, { x: x - 40, y }, { x, y });
    expect(selected).toEqual([]);
  });

  it("does NOT fire for a click in open space", async () => {
    const selected: GlyphMapVectorFeature[] = [];
    const { host, map } = await mountSelectable((f) => selected.push(f));
    const at = map.project([30, 20]);
    // Well outside GLYPH_MAP_POINT_HIT_CELLS of the only mark.
    press(host, { x: (at.col + 30) * CELL_W, y: (at.row + 12) * CELL_H }, { x: (at.col + 30) * CELL_W, y: (at.row + 12) * CELL_H });
    expect(selected).toEqual([]);
  });

  it("leaves a layer with no onSelect inert — no hit test, no cursor", async () => {
    const { host, map } = mount({ projection: glyphMapEquirectangular(), view: { center: [0, 0], span: 120, cols: COLS, rows: ROWS } });
    await settle(map);
    map.addLayer({ type: "glyph", id: "sats", source: { features: [point("s1", 30, 20)] } });
    await settle(map);
    const at = map.project([30, 20]);
    host.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, pointerType: "mouse", bubbles: true, clientX: at.col * CELL_W, clientY: at.row * CELL_H }));
    expect(host.style.cursor).toBe("");
  });

  it("shows a pointer cursor over a selectable mark and takes it back off it", async () => {
    const { host, map } = await mountSelectable(() => {});
    const at = map.project([30, 20]);
    const move = (col: number, row: number) => host.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, pointerType: "mouse", bubbles: true, clientX: col * CELL_W, clientY: row * CELL_H }));
    move(at.col, at.row);
    expect(host.style.cursor).toBe("pointer");
    move(at.col + 30, at.row + 12);
    expect(host.style.cursor).toBe("");
  });
});

describe("createGlyphMap — a `glyph` layer's labels are rationed by the arbiter, its marks are not", () => {
  it("draws every mark but drops colliding labels, keeping the higher priority", async () => {
    const { map } = mount({ projection: glyphMapEquirectangular(), view: { center: [0, 0], span: 120, cols: COLS, rows: ROWS } });
    await settle(map);
    const before = gridRows(map);
    // Two features one degree apart: their marks cannot collide (a mark is a
    // cell) but their 12-character labels certainly do.
    map.addLayer({
      type: "glyph", id: "quakes", color: "#ff6b4a",
      source: { features: [point("big", 30, 20, { title: "BIGQUAKEXXXX", score: 9 }), point("small", 31, 20, { title: "SMALLQUAKEYY", score: 1 })] },
      textProperty: "title",
      priorityProperty: "score",
      textAnchor: "top",
      textOffset: [0, -1],
    });
    await settle(map);
    const after = gridRows(map);
    const text = after.join("\n");
    expect(text).toContain("BIGQUAKEXXXX");
    expect(text).not.toContain("SMALLQUAKEYY");
    // Both MARKS are still drawn — only the names compete.
    const big = map.project([30, 20]);
    const small = map.project([31, 20]);
    expect(inkedNear(before, after, big.col, big.row, 1)).toBeGreaterThan(0);
    expect(inkedNear(before, after, small.col, small.row, 1)).toBeGreaterThan(0);
  });
});
