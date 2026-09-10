/**
 * The THIRD report of "the roads are on top of the buildings", and the first
 * one that is not about the depth allowance at all.
 *
 * The reported link (`/maps?m=…M1a1a1a1a1a1h1a1a1a1a…w1`) carries a MIXED
 * per-row OSM density tuple: nine rows at `1` and `omt-buildings` at `1.7`.
 * That one number is the whole defect. A mesh-backed layer whose `density`
 * differs from the scene's pops into its OWN `<pre>` (AGENTS.md's per-mesh
 * detail layers), while a `line` layer at density `1` is stamped into the
 * BASE grid by the composed `transformCells` hook — and the base grid's
 * `CellGrid.depth` is the base pass's own depth buffer, which contains no
 * detail-layer geometry whatsoever.
 *
 * So the road was not drawn through the building by a too-generous
 * allowance. It was drawn through a building the depth test could not see:
 * measured on this file's own fixture at `/maps`' pitch, all 23 cells of the
 * road inside the footprint inked, with the base grid reading `-Infinity`
 * (empty sky) at every one of them — the same 23 at `781486f` and at its
 * parent `2d27c55`, so the curvature allowance neither caused nor could
 * affect it.
 *
 * The cross-layer occlusion pass already knows the answer: it BLANKS exactly
 * those base cells because the detail layer owns them. It just could not say
 * so — a blanked cell is `char === " "`, `depth === -Infinity`, byte for byte
 * what open sky looks like. glyphcss now records it (`CellGrid.occluded`) and
 * `stroke.ts` honours it: a stamp paints a cell only in the grid whose layer
 * owns it. Nothing is lost by dropping the ink here, because the SAME stroke
 * hook also runs over the detail layer's own grid, where the building's real
 * depth is what it tests against.
 *
 * The reverse pairing (`fill-extrusion` at 1, `line` at 1.7) was already
 * correct and is pinned below so it stays that way: a stroke at a density of
 * its own goes to a meshless viewport overlay, whose depth pass is built from
 * every opaque mesh in the scene, base and detail alike.
 *
 * happy-dom has no layout, hence `stubMonospaceMetrics`; assertions are on
 * EXACT cells of the road's own row, never a row-wide ink count.
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
/** `/maps`' own default pitch. */
const TILT = 40;
/** Zurich, at a span where a city block is legible: ~670 m across. */
const CENTRE: readonly [number, number] = [8.54, 47.375];
const SPAN = 0.006;
/** Half-width of the building footprint in degrees (~89 m of latitude). */
const HALF = 0.0008;
const BUILDING_M = 60;
/** The reported link's own `omt-buildings` density — the only row of ten that is not `1`. */
const BUILDING_DENSITY = 1.7;

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

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hostsToRemove.push(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [CENTRE[0], CENTRE[1]], span: SPAN, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ exaggeration: 24 }),
    tilt: TILT,
  });
  mounted.push(map);
  return { host, map };
}

function squareRing(lon: number, lat: number, half: number): [number, number][] {
  return [[lon - half, lat - half], [lon + half, lat - half], [lon + half, lat + half], [lon - half, lat + half], [lon - half, lat - half]];
}

const building: GlyphMapVectorFeature = {
  id: "block",
  geometryType: "polygon",
  rings: [squareRing(CENTRE[0], CENTRE[1], HALF)],
  properties: { render_height: BUILDING_M },
};

/** A straight west-east road through the building, long enough to leave open road on both flanks. */
const road: GlyphMapVectorFeature = {
  id: "street",
  geometryType: "line",
  rings: [[[CENTRE[0] - 0.02, CENTRE[1]], [CENTRE[0] + 0.02, CENTRE[1]]]],
};

const rows = (map: { scene: { output: { textContent: string | null } } }): string[] => (map.scene.output.textContent ?? "").split("\n");

/** The columns of `row` this render CHANGED relative to `before` — i.e. the cells the stroke layer itself inked. */
function inkedColumns(before: readonly string[], after: readonly string[], row: number): number[] {
  const out: number[] = [];
  for (let col = 0; col < COLS; col++) {
    if ((before[row]?.[col] ?? " ") !== (after[row]?.[col] ?? " ")) out.push(col);
  }
  return out;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

/** Every `<pre>` glyphcss has published for this host, base plus detail/overlay outputs. */
const outputs = (host: HTMLElement): HTMLPreElement[] => Array.from(host.querySelectorAll("pre.glyph-output"));

describe("createGlyphMap — a separated (density) building layer still occludes a base-grid road", () => {
  /**
   * `buildingDensity` / `roadDensity` are the two axes the defect lives on:
   * the road is only unoccluded when the BUILDING left the base grid and the
   * ROAD did not. Both matched densities and the reverse mismatch were
   * already correct and are pinned here so a fix cannot trade one for
   * another.
   */
  const roadIsHiddenByTheBuilding = async (buildingDensity: number, roadDensity: number) => {
    const { host, map } = mount();
    map.addLayer({
      type: "fill-extrusion",
      id: "buildings",
      source: { features: [building] },
      color: "#94a3b8",
      heightProperty: "render_height",
      ...(buildingDensity === 1 ? {} : { density: buildingDensity }),
    });
    await settle();
    map.scene.rerender();
    const before = rows(map);
    const preCountBefore = outputs(host).length;

    map.addLayer({
      type: "line",
      id: "roads",
      source: { features: [road] },
      color: "#e8c988",
      ...(roadDensity === 1 ? {} : { density: roadDensity }),
    });
    await settle();
    map.scene.rerender();
    const after = rows(map);

    // The framing is asserted, not assumed — see `widget.strokeOcclusion.test.ts`.
    const centre = map.project([CENTRE[0], CENTRE[1]]);
    const roadRow = Math.floor(centre.row);
    const west = map.project([CENTRE[0] - HALF, CENTRE[1]]);
    const east = map.project([CENTRE[0] + HALF, CENTRE[1]]);
    const footprintWest = Math.ceil(Math.min(west.col, east.col));
    const footprintEast = Math.floor(Math.max(west.col, east.col));
    expect(footprintEast - footprintWest).toBeGreaterThan(10);

    // The premise: a building at a density of its own really did leave the
    // base grid. Without this the clause below would pass on a scene where
    // nothing separated at all.
    if (buildingDensity !== 1) {
      expect(preCountBefore).toBeGreaterThan(1);
      expect(before[roadRow]?.slice(footprintWest + 1, footprintEast).trim()).toBe("");
    }

    const inked = inkedColumns(before, after, roadRow);

    // 1. Not one BASE-grid cell strictly inside the building's own footprint
    //    is inked by the road. Cell-exact: a count over the row would pass on
    //    the flanks alone.
    expect(inked.filter((col) => col > footprintWest && col < footprintEast)).toEqual([]);

    // 2. The same road inks normally in the open, on BOTH sides — an
    //    occlusion "fix" that simply stopped drawing the layer would pass (1).
    //    A road at its own density lives in a viewport overlay, not the base
    //    `<pre>`, so its open-road ink is counted in whichever output the
    //    stamp reached.
    const openWest = (r: readonly string[], a: readonly string[]) => inkedColumns(r, a, roadRow).filter((col) => col < footprintWest - 1).length;
    if (roadDensity === 1) {
      expect(openWest(before, after)).toBeGreaterThan(20);
      expect(inked.filter((col) => col > footprintEast + 1).length).toBeGreaterThan(20);
    } else {
      const overlay = outputs(host).find((el) => el.dataset.glyphOverlayDensity === String(roadDensity));
      expect(overlay).toBeDefined();
      const ink = (overlay!.textContent ?? "").split("").filter((ch) => ch !== " " && ch !== "\n").length;
      expect(ink).toBeGreaterThan(40);
    }

    // 3. The building is still drawn across those footprint cells — in the
    //    base `<pre>` when it never separated, in its own detail `<pre>` when
    //    it did — so (1) is occlusion and not a hole punched through both.
    const buildingInk = outputs(host)
      .filter((el) => buildingDensity === 1 ? el === map.scene.output : el !== map.scene.output && el.dataset.glyphOverlayDensity === undefined)
      .reduce((n, el) => n + (el.textContent ?? "").split("").filter((ch) => ch !== " " && ch !== "\n").length, 0);
    expect(buildingInk).toBeGreaterThan(100);
  };

  it("buildings at 1.7, roads at 1 — the reported link's own pairing", async () => {
    await roadIsHiddenByTheBuilding(BUILDING_DENSITY, 1);
  });

  it("both at 1 — the base-grid case that always worked", async () => {
    await roadIsHiddenByTheBuilding(1, 1);
  });

  it("both at 1.7 — the road's own viewport overlay, whose depth pass already saw the detail layer", async () => {
    await roadIsHiddenByTheBuilding(BUILDING_DENSITY, BUILDING_DENSITY);
  });

  it("buildings at 1, roads at 1.7 — the mismatch the other way round", async () => {
    await roadIsHiddenByTheBuilding(1, BUILDING_DENSITY);
  });
});
