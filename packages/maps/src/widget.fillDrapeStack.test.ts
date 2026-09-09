/**
 * A draped `fill` is a SHEET LYING ON THE GROUND, and everything else that
 * stands on that same ground has to survive it: the building inside the park,
 * the road across the landuse polygon, the bridge over the river.
 *
 * THE DEFECT THIS PINS. `62100e2` gave a draped `fill` a lift so the terrain
 * drawn under it could not eat it cell by cell (`widget.fillDrape.test.ts`),
 * and that lift was added on the PROJECTION'S ELEVATION AXIS — the terrain's
 * own axis, which `exaggeration` multiplies. A `fill-extrusion`'s height is
 * TRUE metres and is exempt from that factor by design (AGENTS.md, and
 * `layers.extrusionHeight.test.ts`), so at `/maps`' own default
 * `exaggeration: 24` a 10-unit lift is 240 TRUE metres of world: every
 * ordinary building inside a residential or landcover polygon was drawn
 * BEHIND the polygon it stands in, and every draped road crossing one was
 * deleted. Measured before the fix, with `groundElevation: () => 0`:
 * a 6 m, a 30 m, a 100 m and a 200 m building each drew ZERO cells at
 * `tilt: 0`, and a road crossing the fill inked 0 of the 70-odd cells inside
 * it — while the same three layers with NO ground source (no drape, no lift)
 * drew all of them.
 *
 * Two things make this invisible to every gate that existed: no gate mounted
 * a `fill` BESIDE a `fill-extrusion` or a `line`, and the lift is inert
 * without a ground source, which `widget.strokeOcclusion.test.ts` and
 * `layers.extrusionHeight.test.ts` both go without.
 *
 * The fixture is `widget.strokeOcclusion.test.ts`'s — Zurich at a span where
 * a city block is legible — because that is the scale at which the units
 * actually differ: 240 m is invisible at a world view and four storeys of
 * error at a street one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import type { GlyphMapVectorFeature } from "./vector/types";

const COLS = 140;
const ROWS = 63;
const CELL_W = 8;
const CELL_H = 16;
const BASE_FONT_PX = 16;
const CENTRE: readonly [number, number] = [8.54, 47.375];
const SPAN = 0.006;
/** Half-width of the building footprint in degrees (~89 m). */
const HALF = 0.0008;
/** The landuse polygon around it — three times as wide, so the building sits well inside. */
const FILL_HALF = HALF * 3;

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

function squareRing(lon: number, lat: number, half: number): [number, number][] {
  return [[lon - half, lat - half], [lon + half, lat - half], [lon + half, lat + half], [lon - half, lat + half], [lon - half, lat - half]];
}

const landuse: GlyphMapVectorFeature = {
  id: "residential",
  geometryType: "polygon",
  rings: [squareRing(CENTRE[0], CENTRE[1], FILL_HALF)],
};
const building = (metres: number): GlyphMapVectorFeature => ({
  id: "block",
  geometryType: "polygon",
  rings: [squareRing(CENTRE[0], CENTRE[1], HALF)],
  properties: { render_height: metres },
});
/** West-east, so its own occlusion verdict is the plain one — this file is about the fill, not about the stroke's slack. */
const road: GlyphMapVectorFeature = {
  id: "street",
  geometryType: "line",
  rings: [[[CENTRE[0] - 0.02, CENTRE[1]], [CENTRE[0] + 0.02, CENTRE[1]]]],
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

/**
 * One CLASS per output cell, read off the base `<pre>`'s spans exactly as
 * `widget.fillDrape.test.ts` reads its own — and by hue RATIO, not by literal
 * hex, because Lambert scales all three channels and leaves the ordering
 * alone. Glyphs cannot do this job: at `tilt: 0` a flat cap and the flat
 * sheet under it share a normal, so they shade to the same character and
 * differ only in colour.
 */
type CellClass = "road" | "building" | "fill" | null;
function readClasses(map: { scene: { output: HTMLElement } }): CellClass[][] {
  const grid: (string | null)[][] = [[]];
  const walk = (node: Node, color: string | null): void => {
    if (node.nodeType === 3) {
      for (const ch of node.textContent ?? "") {
        if (ch === "\n") grid.push([]);
        else grid[grid.length - 1]!.push(ch === " " ? null : color);
      }
      return;
    }
    const el = node as HTMLElement;
    const own = el.style?.color || color;
    for (const child of Array.from(el.childNodes)) walk(child, own);
  };
  for (const child of Array.from(map.scene.output.childNodes)) walk(child, null);
  return grid.map((row) =>
    row.map((color): CellClass => {
      if (color === null) return null;
      const n = Number.parseInt(color.slice(1), 16);
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      if (b > g) return "building";
      if (r > g && g > b) return "road";
      return "fill";
    }),
  );
}

const count = (grid: CellClass[][], want: CellClass, within?: (row: number, col: number) => boolean): number => {
  let n = 0;
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < (grid[row]?.length ?? 0); col++) {
      if (grid[row]![col] === want && (!within || within(row, col))) n++;
    }
  }
  return n;
};

function mount(tilt: number, ground: boolean | (() => number | null)) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hostsToRemove.push(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [CENTRE[0], CENTRE[1]], span: SPAN, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ exaggeration: 24 }),
    tilt,
    ...(ground ? { groundElevation: typeof ground === "function" ? ground : () => 0 } : {}),
  });
  mounted.push(map);
  return map;
}

describe("createGlyphMap — a draped `fill` does not bury what stands on the same ground", () => {
  /**
   * The SAME three layers with and without a ground source. Without one there
   * is no drape and no lift anywhere, so the reference is what the picture
   * has always been; with one, everything sits on a ground that answers ZERO,
   * so the world is the same world and the building must still be there.
   */
  const buildingSurvivesTheFill = async (metres: number, tilt: number) => {
    const render = async (ground: boolean) => {
      const map = mount(tilt, ground);
      map.addLayer({ type: "fill", id: "landuse", source: { features: [landuse] }, color: "#3f6212" });
      map.addLayer({ type: "fill-extrusion", id: "buildings", source: { features: [building(metres)] }, color: "#94a3b8", heightProperty: "render_height" });
      await settle();
      map.scene.rerender();
      return readClasses(map);
    };
    const reference = count(await render(false), "building");
    // The premise: the building genuinely draws a block when nothing is
    // draped, so a zero below is the fill burying it and not a framing
    // accident.
    expect(reference).toBeGreaterThan(200);
    expect(count(await render(true), "building")).toBeGreaterThan(reference * 0.6);
  };

  it("a 6 m building inside a landuse polygon — an ordinary two-storey block", async () => {
    await buildingSurvivesTheFill(6, 0);
  });

  it("the same at `/maps`' own pitch", async () => {
    await buildingSurvivesTheFill(6, 40);
  });

  it("a 30 m building — the lift buried everything up to 240 m, so the height axis has to hold too", async () => {
    await buildingSurvivesTheFill(30, 0);
  });

  it("a 200 m tower", async () => {
    await buildingSurvivesTheFill(200, 0);
  });

  /**
   * `GlyphMapOptions.groundElevation`'s own contract: "`null` (or a
   * non-finite number) means 'I have no ground for that point', and the
   * caller takes the DATUM there ... a source that answers for some points
   * and not others is therefore fine and needs no bounds of its own."
   *
   * A `fill-extrusion` was the one consumer that did not honour it. The
   * widget handed the sampler's `NaN` straight to `glyphMapVectorMesh`'s
   * `groundElevation`, whose OWN contract is "crop, don't clamp" — a
   * non-finite ground discards the group, which is right for a projection
   * that cannot place a point and wrong for a caller saying "I don't know".
   * `layers.ts` then read it as `(ground ?? 0) + baseOffset`, and `??` does
   * not catch NaN, so every vertex projected to NaN and the whole building
   * was discarded. `line`, markers and a draped `fill` all fell back to the
   * datum; the extrusion drew NOTHING.
   *
   * Measured before the fix, 60 m building, tilt 40: 450 cells with the
   * option absent, 450 with `() => 0`, and 0 with either `() => null` or
   * `() => NaN`. That is a consumer draping on a PARTIAL DEM — the exact use
   * case the option was added for — losing every building outside it.
   */
  const buildingStandsOnTheDatum = async (answer: () => number | null) => {
    const render = async (ground: boolean | (() => number | null)) => {
      const map = mount(40, ground);
      map.addLayer({ type: "fill-extrusion", id: "buildings", source: { features: [building(60)] }, color: "#94a3b8", heightProperty: "render_height" });
      await settle();
      map.scene.rerender();
      return count(readClasses(map), "building");
    };
    const reference = await render(false);
    expect(reference).toBeGreaterThan(200);
    // The datum is what the option promises here, so the picture is the
    // no-ground picture exactly.
    expect(await render(answer)).toBe(reference);
  };

  it("a ground source answering `null` plants the building on the datum, it does not delete it", async () => {
    await buildingStandsOnTheDatum(() => null);
  });

  it("and the same for a non-finite number", async () => {
    await buildingStandsOnTheDatum(() => NaN);
  });

  it("a road crossing the landuse polygon still inks inside it", async () => {
    const map = mount(0, true);
    map.addLayer({ type: "fill", id: "landuse", source: { features: [landuse] }, color: "#3f6212" });
    map.addLayer({ type: "line", id: "roads", source: { features: [road] }, color: "#e8c988" });
    await settle();
    map.scene.rerender();
    const grid = readClasses(map);

    const west = map.project([CENTRE[0] - FILL_HALF, CENTRE[1]]);
    const east = map.project([CENTRE[0] + FILL_HALF, CENTRE[1]]);
    const inside = Math.ceil(Math.min(west.col, east.col));
    const outside = Math.floor(Math.max(west.col, east.col));
    expect(outside - inside).toBeGreaterThan(30);
    // The road draws OUTSIDE the polygon either way — what the lift deleted
    // is the stretch INSIDE it, which is the whole of the crossing.
    expect(count(grid, "road", (_row, col) => col < inside - 1)).toBeGreaterThan(10);
    expect(count(grid, "road", (_row, col) => col > inside && col < outside)).toBeGreaterThan(20);
  });
});
