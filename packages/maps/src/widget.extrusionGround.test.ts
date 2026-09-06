/**
 * A `fill-extrusion` stands on the TERRAIN under it, not on the datum.
 *
 * The reported defect, measured at `/maps`' own OSM view (globe,
 * `exaggeration: 24`, 40 degree tilt, 4.8 m per cell): with a `raster` layer
 * mounted over ground at 400 m, a 60 m building drew NOT ONE CELL — the whole
 * extrusion stack sat at sea level, 400 m of exaggerated relief above it, i.e.
 * 9,600 world-metres underground. A `line` at the same place still drew,
 * because `stroke.ts` had already been taught the ground offset.
 *
 * The fix reuses that same sampler (`widget.ts`'s `groundElevationSampler`,
 * read from the tiles the mounted `raster` layers actually have up) as the
 * extrusion's own base, and splits what used to be one `base` number into the
 * two different quantities it was conflating:
 *
 *  - the GROUND under the footprint — a terrain elevation, so it rides the
 *    terrain's `exaggeration` exactly like the relief mesh it stands on;
 *  - the structure's own base OFFSET (OSM's `min_height`) — a measured
 *    structure quantity in TRUE metres, exempt from `exaggeration` exactly
 *    like the height it shares its unit with.
 *
 * happy-dom has no layout, hence `stubMonospaceMetrics`. Assertions are on
 * EXACT cells and exact row bands, never a whole-grid ink count: a count is
 * satisfied by the terrain alone, which fills this view edge to edge.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import type { GlyphMapProvider } from "./provider";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapVectorFeature } from "./vector/types";

const COLS = 140;
const ROWS = 63;
const CELL_W = 8;
const CELL_H = 16;
const BASE_FONT_PX = 16;
/** `/maps`' own default pitch — the view the defect was measured at. */
const TILT = 40;
/** Zurich, at a span where a city block is legible: ~670 m across, 4.8 m per cell. */
const CENTRE: readonly [number, number] = [8.54, 47.375];
const SPAN = 0.006;
/** Half-width of the building footprint in degrees (~89 m of latitude). */
const HALF = 0.0008;
/** A real OSM `render_height` for a mid-rise block, in TRUE metres. */
const BUILDING_M = 60;
/** The ground the block stands on — Zurich is at ~400 m, which is what made this defect visible. */
const GROUND_M = 400;
/** The extrusion layer's own colour, the channel a plan-view roof is legible on. */
const BUILDING_COLOR = "#94a3b8";

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

function mount(tilt: number) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hostsToRemove.push(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [CENTRE[0], CENTRE[1]], span: SPAN, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ exaggeration: 24 }),
    tilt,
  });
  mounted.push(map);
  return map;
}

/** Uniform terrain at `elevM`, as a z0-z4 provider — the shape `bake-geo-tiles.mjs` produces. */
function terrainProvider(elevM: number): GlyphMapProvider {
  const zooms = [0, 1, 2, 3, 4].map((z) => ({
    z, cols: 2 ** z, rows: 2 ** z, tileLonSpan: 360 / 2 ** z, tileLatSpan: 180 / 2 ** z, tileCols: 32, tileRows: 32,
  }));
  const bounds = (z: number, x: number, y: number) => {
    const level = zooms[z];
    const west = -180 + x * level.tileLonSpan;
    const north = 90 - y * level.tileLatSpan;
    return { west, east: west + level.tileLonSpan, south: north - level.tileLatSpan, north };
  };
  return {
    id: "extrusion-ground-terrain",
    zooms,
    bounds,
    async loadTile(z, x, y): Promise<GlyphMapGeoTile> {
      return { bounds: bounds(z, x, y), cols: 32, rows: 32, elevation: new Float32Array(33 * 33).fill(elevM), source: "extrusion-ground", sampler: "nearest" };
    },
  };
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


const rows = (map: { scene: { output: { textContent: string | null } } }): string[] => (map.scene.output.textContent ?? "").split("\n");

/** Every cell this render CHANGED relative to `before` — i.e. the cells the extrusion itself painted. */
function changedCells(before: readonly string[], after: readonly string[]): { row: number; col: number }[] {
  const out: { row: number; col: number }[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if ((before[row]?.[col] ?? " ") !== (after[row]?.[col] ?? " ")) out.push({ row, col });
    }
  }
  return out;
}

/**
 * The cells painted in `color`, read off the `<pre>`'s own colour spans.
 *
 * The GLYPH cannot answer this one on its own in plan view: a cap's normal is
 * the terrain's normal, so a building's roof shades to exactly the character
 * the ground around it does. Colour is what separates them, and it is the
 * channel a reader sees too.
 */
function cellsColored(output: HTMLElement, color: string): { row: number; col: number }[] {
  const out: { row: number; col: number }[] = [];
  let row = 0, col = 0;
  for (const node of Array.from(output.childNodes)) {
    const own = node.nodeType === 1 ? /color:\s*(#[0-9a-fA-F]{6})/.exec((node as HTMLElement).getAttribute("style") ?? "")?.[1] : undefined;
    for (const ch of node.textContent ?? "") {
      if (ch === "\n") { row++; col = 0; continue; }
      if (own?.toLowerCase() === color) out.push({ row, col });
      col++;
    }
  }
  return out;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

/**
 * Terrain first, then the building — the same order `/maps` mounts them in,
 * and the order that makes `changedCells` mean "what the extrusion painted".
 */
async function renderOverTerrain(groundM: number, tilt: number, feature: GlyphMapVectorFeature = building) {
  const map = mount(tilt);
  map.addLayer({ type: "raster", id: "terrain", source: terrainProvider(groundM) });
  await settle();
  map.scene.rerender();
  const before = rows(map);
  map.addLayer({ type: "fill-extrusion", id: "buildings", source: { features: [feature] }, color: BUILDING_COLOR, heightProperty: "render_height" });
  await settle();
  map.scene.rerender();
  return { map, before, after: rows(map), changed: changedCells(before, rows(map)) };
}

describe("createGlyphMap — a fill-extrusion stands on the terrain under it", () => {
  it("paints a 60 m building on 400 m of ground, over its own footprint", async () => {
    // PLAN VIEW on purpose. An orthographic camera looking straight down at
    // the globe has its view axis through the view centre, and a radial lift
    // there is exactly along it — so 400 m of ground (9,600 world metres at
    // `/maps`' `exaggeration: 24`) moves this building's image not one cell,
    // and the assertion is about being DRAWN, uncontaminated by the parallax
    // a tilted camera legitimately gives anything standing on exaggerated
    // relief (which the next test measures on its own).
    const { map } = await renderOverTerrain(GROUND_M, 0);

    const west = map.project([CENTRE[0] - HALF, CENTRE[1]]);
    const east = map.project([CENTRE[0] + HALF, CENTRE[1]]);
    const north = map.project([CENTRE[0], CENTRE[1] + HALF]);
    const south = map.project([CENTRE[0], CENTRE[1] - HALF]);
    const left = Math.ceil(Math.min(west.col, east.col));
    const right = Math.floor(Math.max(west.col, east.col));
    const top = Math.ceil(Math.min(north.row, south.row));
    const bottom = Math.floor(Math.max(north.row, south.row));
    expect(right - left).toBeGreaterThan(10);

    const painted = cellsColored(map.scene.output as HTMLElement, BUILDING_COLOR);
    // The defect: at the datum the whole stack sat 400 m of EXAGGERATED relief
    // underground and painted NOT ONE CELL, while a `line` at the same place
    // still drew.
    expect(painted.length).toBeGreaterThan(0);
    // Cell-exact, not a count: every cell it painted is inside its own
    // footprint, and it covers that footprint's interior.
    for (const cell of painted) {
      expect(cell.col).toBeGreaterThanOrEqual(left - 1);
      expect(cell.col).toBeLessThanOrEqual(right + 1);
      expect(cell.row).toBeGreaterThanOrEqual(top - 1);
      expect(cell.row).toBeLessThanOrEqual(bottom + 1);
    }
    const inside = new Set(painted.map((c) => `${c.row}/${c.col}`));
    for (let row = top + 1; row < bottom; row++) {
      for (let col = left + 1; col < right; col++) expect(inside.has(`${row}/${col}`)).toBe(true);
    }
  });

  it("rides the ground's own elevation, and keeps its true-metre height doing it", async () => {
    // A TILTED camera is where a base elevation becomes visible as position:
    // the image of anything standing on relief is displaced by that relief's
    // own parallax. The grounds are small (5 m and 10 m) for one reason — at
    // `exaggeration: 24` and 4.8 m per cell they are already 8 and 16 rows of
    // displacement, and 400 m would put the building 2,000 rows off screen,
    // which is a true statement about 24x relief under a tilted camera and
    // not something this test can observe.
    const flat = await renderOverTerrain(0, TILT);
    const low = await renderOverTerrain(5, TILT);
    const high = await renderOverTerrain(10, TILT);
    const band = (cells: { row: number }[]) => ({ top: Math.min(...cells.map((c) => c.row)), bottom: Math.max(...cells.map((c) => c.row)) });
    const f = band(flat.changed), l = band(low.changed), h = band(high.changed);

    // Height is TRUE metres, so the block covers the same number of rows on
    // every ground it stands on.
    expect(l.bottom - l.top).toBe(f.bottom - f.top);
    expect(h.bottom - h.top).toBe(f.bottom - f.top);

    // ...and it MOVED, by exactly what the ground under it did: twice the
    // ground, twice the displacement. A base pinned to the datum shifts by
    // nothing; a base that inherited the height's true-metre exemption shifts
    // by 1/24 of this.
    const shiftLow = f.top - l.top;
    const shiftHigh = f.top - h.top;
    expect(shiftLow).toBeGreaterThan(0);
    expect(shiftHigh).toBe(shiftLow * 2);
  });

  it("is byte-identical to the pre-ground-planting render when no raster layer is mounted", async () => {
    const map = mount(TILT);
    map.addLayer({ type: "fill-extrusion", id: "buildings", source: { features: [building] }, color: BUILDING_COLOR, heightProperty: "render_height" });
    await settle();
    map.scene.rerender();
    const frame = map.scene.output.textContent ?? "";
    // Captured from the build at `9191e4b`, BEFORE ground planting existed:
    // with no `raster` layer mounted `groundElevationSampler()` is `null`, no
    // `groundElevation` option is passed at all, and not one extra projection
    // runs anywhere.
    let hash = 5381;
    for (let i = 0; i < frame.length; i++) hash = ((hash * 33) ^ frame.charCodeAt(i)) >>> 0;
    expect({ hash, length: frame.length }).toEqual({ hash: 309047941, length: 8882 });
  });

  it("re-plants a building mounted before its terrain arrived", async () => {
    // The order a real page hits: the OSM extract is static and its mesh is
    // built once, so a `fill-extrusion` mounted while the terrain is still in
    // flight would otherwise stand at the datum for the life of the map —
    // `scheduleTileUpdate` never rebuilds a static feature layer.
    const map = mount(0);
    map.addLayer({ type: "fill-extrusion", id: "buildings", source: { features: [building] }, color: BUILDING_COLOR, heightProperty: "render_height" });
    await settle();
    map.scene.rerender();
    expect(cellsColored(map.scene.output as HTMLElement, BUILDING_COLOR).length).toBeGreaterThan(0);

    map.addLayer({ type: "raster", id: "terrain", source: terrainProvider(GROUND_M) });
    await settle();
    map.scene.rerender();
    // Still drawn — it was re-planted onto the ground that arrived under it,
    // rather than left at the datum and buried by it.
    expect(cellsColored(map.scene.output as HTMLElement, BUILDING_COLOR).length).toBeGreaterThan(0);
  });
});
