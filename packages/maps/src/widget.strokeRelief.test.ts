/**
 * A draped `line` must survive the terrain it is draped ON.
 *
 * The reported defect (`/maps?m=p3x5fvsday5f5t8js34cst10E1` — globe, centre
 * 26.677E 25.465N, span 16.81 degrees, `exaggeration: 24`, `tilt: 0`, terrain
 * and borders and nothing else): "the borders are not being shown cutting the
 * terrain anymore". Two thirds of every border over the Sahara was gone while
 * the crenellated Aegean ones a few rows above were intact.
 *
 * THE MECHANISM, and why an allowance could not close it. A `line` is stamped
 * post-raster and decides its own visibility by comparing its draped depth
 * against the terrain's depth buffer. Those are the SAME surface reached by
 * two different routes — the drape reads the elevation FIELD at a vertex, the
 * buffer holds the terrain MESH rasterized at cell resolution — and at a world
 * view one output cell spans 0.12 degrees, i.e. ~13 km of real ETOPO1 relief.
 * Measured on the reported view, `atStroke - depth` over every stamped sample
 * is centred on +3 m of ground with quartiles at -157 m and +172 m: symmetric
 * NOISE, several times the curvature allowance it is tested against. A
 * one-sided test against symmetric noise deletes about half of every stroke
 * that crosses rough ground, and all of one that crosses a lot of it.
 *
 * Two quantities produce that noise and each has its own gate here:
 *
 *  1. THE CHORD. `stampGlyphMapPolyline` interpolates depth linearly between
 *     drape vertices, and a simplified border has none to spare — Natural
 *     Earth bakes Egypt's 22 N parallel with Sudan as a RULER-STRAIGHT run
 *     whose interior the ground under it is never sampled at. Measured on the
 *     reported view the median stamped segment was 2 cells and the longest 49.
 *  2. THE CELL. Even sampled per cell, the stroke's point-sampled ground and
 *     the terrain's cell-resolution rasterization disagree, because the
 *     comparison reads the depth buffer over a +/-1 cell central difference
 *     evaluated up to half a cell away.
 *
 * The fixture is REAL ETOPO1 (`fixtures/sahara-border.json`, baked by
 * `bake-geo-tiles.mjs --fixture` at the 0.125-degree vertex spacing the z4
 * pyramid level actually ships) plus the two ruler-straight borders that cross
 * it — the geometry the report is about, at the resolution the map renders it.
 * The full z0-z4 pyramid under `website/public/data/geo-tiles/` is gitignored
 * and so can never be a test dependency.
 *
 * happy-dom has no layout, hence `stubMonospaceMetrics` — and it must answer
 * glyphcss's own hidden-`<pre>` cell probe too, or the camera and the
 * rasterizer disagree about cell size and no predicted cell lands.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapVectorFeature } from "./vector/types";

const COLS = 140;
const ROWS = 63;
const CELL_W = 8;
const CELL_H = 16;
const BASE_FONT_PX = 16;
/** The reported link, decoded. */
const CENTRE: readonly [number, number] = [26.677342, 25.465411];
const SPAN = 16.810437949565824;
const TILT = 0;
const EXAGGERATION = 24;

const fixture = JSON.parse(
  readFileSync(path.resolve(__dirname, "../fixtures/sahara-border.json"), "utf8"),
) as { bounds: GlyphMapGeoTile["bounds"]; cols: number; rows: number; elevation: number[]; source: string; sampler: string };

const terrain: GlyphMapGeoTile = {
  bounds: fixture.bounds,
  cols: fixture.cols,
  rows: fixture.rows,
  elevation: Float32Array.from(fixture.elevation),
  source: fixture.source,
  sampler: fixture.sampler,
};

/**
 * The two borders the report is about, with the vertex count the baker gives
 * them: a straight line between two points is exactly what Visvalingam-Whyatt
 * leaves of a border drawn along a parallel or a meridian, and it is why the
 * drape has nothing to say about the 8 degrees of relief in between.
 */
const parallel: GlyphMapVectorFeature = {
  id: "eg-sd",
  geometryType: "line",
  rings: [[[24.2, 22], [31.8, 22]]],
};
const meridian: GlyphMapVectorFeature = {
  id: "eg-ly",
  geometryType: "line",
  rings: [[[25, 20.2], [25, 27.8]]],
};

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
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
const frame = (map: { scene: { output: { textContent: string | null } } }): string[] =>
  (map.scene.output.textContent ?? "").split("\n");

/** Every cell the BORDER layer itself inked — the terrain frame before it, diffed against the frame after. */
function borderCells(before: readonly string[], after: readonly string[]): { row: number; col: number }[] {
  const out: { row: number; col: number }[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if ((before[row]?.[col] ?? " ") !== (after[row]?.[col] ?? " ")) out.push({ row, col });
    }
  }
  return out;
}

async function render(features: readonly GlyphMapVectorFeature[]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hostsToRemove.push(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [CENTRE[0], CENTRE[1]], span: SPAN, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ exaggeration: EXAGGERATION }),
    tilt: TILT,
    layers: [{ type: "raster", id: "terrain", source: terrain }],
  });
  mounted.push(map);
  await settle();
  map.scene.rerender();
  const before = frame(map);

  map.addLayer({ type: "line", id: "borders", source: { features: [...features] }, color: "#ffffff" });
  await settle();
  map.scene.rerender();
  const after = frame(map);
  return { map, inked: borderCells(before, after) };
}

describe("createGlyphMap — a draped border survives the relief it is draped on", () => {
  it("inks both ruler-straight desert borders across real ETOPO1 relief at the reported view", async () => {
    const { inked } = await render([parallel, meridian]);
    // Three numbers, all measured on this fixture. The stamp inks 92 cells
    // over 33 rows with the depth test removed entirely — that is the whole
    // border, and the ceiling. At `34bc007` it inked THREE, over 2 rows: the
    // two borders reduced to a stub in the one corner of the window whose
    // ground happens to be flat. Draping per cell and forgiving the ground's
    // own rise across the comparison's own support gives 79 over 33. The
    // floors sit between the defect and the fix with a wide margin either way.
    expect(inked.length).toBeGreaterThan(60);
    expect(new Set(inked.map((c) => c.row)).size).toBeGreaterThan(25);
  }, 30000);

  it("draws the 22 N parallel as a run, not as stubs at the ends", async () => {
    const { inked } = await render([parallel]);
    // The parallel is ONE straight segment 7.6 degrees long whose ink lands on
    // a single screen row (`tilt: 0`, and an orthographic camera sees a
    // globe's parallel edge-on only at the limb). Which row is whichever the
    // ink lands on; what the defect destroyed is the RUN — 2 columns on the
    // busiest row at `34bc007`, 47 after the fix, 60 with no depth test at
    // all. The second clause is what the count alone cannot say: the survivors
    // must be a stretch and not a scatter, so the widest gap between
    // consecutive inked columns on that row is bounded too (6 after the fix,
    // 1 with no depth test — and 1 at `34bc007` as well, which is exactly why
    // it is a clause BESIDE the count and never instead of it).
    const byRow = new Map<number, number[]>();
    for (const c of inked) byRow.set(c.row, [...(byRow.get(c.row) ?? []), c.col]);
    const busiest = [...byRow.values()].sort((a, b) => b.length - a.length)[0] ?? [];
    expect(busiest.length).toBeGreaterThan(35);
    const cols = [...busiest].sort((a, b) => a - b);
    const widestGap = cols.slice(1).reduce((worst, col, i) => Math.max(worst, col - cols[i]), 0);
    expect(widestGap).toBeLessThan(8);
  }, 30000);
});
