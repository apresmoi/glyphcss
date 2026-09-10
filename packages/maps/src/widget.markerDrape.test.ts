/**
 * Markers are DRAPED on the terrain: a `symbol` label and a `circle` dot are
 * anchored at the ground elevation under their own lon/lat, not at the datum.
 *
 * THE DEFECT THIS PINS. `createPointFeatureRuntime` anchored every marker at
 * `projection.project(lon, lat, 0)` while everything else in a `/maps` scene
 * already stands on the exaggerated relief — the terrain mesh by
 * construction, a `fill-extrusion` since `d517143`, a `line`'s vertices since
 * the stroke drape. Under a tilt that relief has PARALLAX, so a label drawn
 * at sea level lands nowhere near the ground it names. Reported on the Peaks
 * row over the terrain raster ("we have they loop off"), but it is not a
 * peaks defect: every `symbol` and `circle` marker had it — places, water
 * labels, parks, POIs.
 *
 * WHICH HEIGHT, AND WHY IT IS NOT `ele`. A `mountain_peak` carries its own
 * `ele` in true metres and the raster pyramid under-samples a summit, so the
 * two disagree badly: measured on the real ETOPO1 pyramid this repo bakes,
 * `ele - sample` at the FINEST tier that exists (curated Switzerland z7,
 * ~1.2 km per sample) is 1,389 m for the Matterhorn, 1,246 m for the Eiger,
 * 911 m for the Jungfrau and 661 m for Piz Bernina. A label is a statement
 * about the surface the reader can SEE, and the surface the reader can see is
 * the raster's own sample — so `ele` (and `max(sample, ele)` with it) floats
 * the label above the drawn summit by that difference times the exaggeration:
 * at this file's own framing, 9 rows; at a city-scale alpine view (span
 * 0.05 deg, 27.6 m per cell) it is 388 rows, i.e. six screens of sky. The
 * terrain sample is the answer, and it is also the only one that GENERALISES
 * — `ele` exists on peaks and on nothing else, while a place, a lake label or
 * a POI has no elevation property at all and still has to stand on its
 * ground.
 *
 * THE EXPECTED ROW, ANALYTICALLY — same derivation as
 * `widget.strokeDrape.test.ts`, and for the same reason (no widget
 * internals, no hard-coded framing): `glyphMapGlobe.project(lon, lat, h)` is
 * `(1 + h*exaggeration / R_earth)` times `project(lon, lat, 0)`, purely
 * radial, and the widget's only camera is orthographic, whose `project()` is
 * affine in the world point. So with `b` the row the world ORIGIN maps to,
 * `row(k*P) = b + k*(row(P) - b)`, and `b` is recoverable from public API
 * alone through the ANTIPODE's own sea-level projection.
 *
 * happy-dom has no layout, hence `stubMonospaceMetrics` — which must also
 * answer glyphcss's OWN cell probe (a fresh hidden `<pre>` per measurement),
 * or the camera and the hotspot stager disagree about what a cell is.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { GLYPH_MAP_EARTH_RADIUS_M, glyphMapGlobe } from "./projection";
import type { GlyphMapProvider } from "./provider";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapVectorFeature } from "./vector/types";

const COLS = 140;
const ROWS = 63;
const CELL_W = 8;
const CELL_H = 16;
const BASE_FONT_PX = 16;
/** `/maps`' own default pitch — with no tilt the ground's parallax is zero and there is nothing to observe. */
const TILT = 40;
const EXAGGERATION = 24;
/** The Matterhorn. Its own `ele` on the OpenMapTiles wire is 4478. */
const PEAK: readonly [number, number] = [7.6586, 45.9763];
const PEAK_ELE = 4478;
/**
 * Real ETOPO1 samples under that exact point, read off the pyramid
 * `website/scripts/bake-geo-tiles.mjs` bakes: 2372.5 m at the global z4 tier
 * and 3089.1 m at the finest curated tier (Switzerland z7). Rounded here
 * because the fixture only needs two tiers that a render can tell apart, not
 * the decimals.
 */
const COARSE_M = 2372;
const FINE_M = 3089;
/**
 * ~167 km across. Chosen so the three candidate heights are all ON SCREEN and
 * mutually distinguishable — the datum, the coarse tier, the fine tier and
 * `ele` land ~20, ~5 and ~9 rows apart — which is what makes ruling `ele` out
 * an observation rather than an argument about a marker that fell off the
 * viewport anyway.
 */
const SPAN = 2.16;

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

function mount(span = SPAN) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hostsToRemove.push(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [PEAK[0], PEAK[1]], span, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ exaggeration: EXAGGERATION }),
    tilt: TILT,
  });
  mounted.push(map);
  return { map, host };
}

/** Uniform terrain at `elevM`, as a z0-z4 provider — the shape `bake-geo-tiles.mjs` produces. */
function terrainProvider(elevM: number, id = "marker-drape-terrain"): GlyphMapProvider {
  return tieredTerrainProvider(elevM, elevM, id);
}

/**
 * The tiers DISAGREE on purpose — the coarse levels answer `coarseM`, the
 * deepest answers `fineM`. No real pyramid disagrees by 700 m over one point,
 * and it is the only way to observe which tier a render is actually reading.
 */
function tieredTerrainProvider(coarseM: number, fineM: number, id = "marker-drape-tiers"): GlyphMapProvider {
  const zooms = [0, 1, 2, 3, 4].map((z) => ({
    z, cols: 2 ** z, rows: 2 ** z, tileLonSpan: 360 / 2 ** z, tileLatSpan: 180 / 2 ** z, tileCols: 32, tileRows: 32,
  }));
  const bounds = (z: number, x: number, y: number) => {
    const level = zooms[z]!;
    const west = -180 + x * level.tileLonSpan;
    const north = 90 - y * level.tileLatSpan;
    return { west, east: west + level.tileLonSpan, south: north - level.tileLatSpan, north };
  };
  return {
    id,
    zooms,
    bounds,
    async loadTile(z, x, y): Promise<GlyphMapGeoTile> {
      const elev = z >= 4 ? fineM : coarseM;
      return { bounds: bounds(z, x, y), cols: 32, rows: 32, elevation: new Float32Array(33 * 33).fill(elev), source: id, sampler: "nearest" };
    },
  };
}

const peakFeature: GlyphMapVectorFeature = {
  id: "matterhorn",
  geometryType: "point",
  rings: [[[PEAK[0], PEAK[1]]]],
  properties: { name: "Matterhorn", ele: PEAK_ELE },
};

/** A place label with NO elevation property at all — the generalisation the mechanism has to serve. */
const placeFeature: GlyphMapVectorFeature = {
  id: "zermatt",
  geometryType: "point",
  rings: [[[PEAK[0], PEAK[1]]]],
  properties: { name: "Zermatt" },
};

/** A straight west-east line through the peak, draped by the shipped stroke drape. */
const ridgeRoad: GlyphMapVectorFeature = {
  id: "ridge-road",
  geometryType: "line",
  rings: [[[PEAK[0] - 0.6, PEAK[1]], [PEAK[0] + 0.6, PEAK[1]]]],
};

const rows = (map: { scene: { output: { textContent: string | null } } }): string[] => (map.scene.output.textContent ?? "").split("\n");

function inkedCells(before: readonly string[], after: readonly string[]): { row: number; col: number }[] {
  const out: { row: number; col: number }[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if ((before[row]?.[col] ?? " ") !== (after[row]?.[col] ?? " ")) out.push({ row, col });
    }
  }
  return out;
}

/** The row `(lon, lat)` reaches at elevation `elevM`, from public API only — see this file's header. */
function groundRowFor(map: ReturnType<typeof createGlyphMap>, lon: number, lat: number, elevM: number): number {
  const near = map.project([lon, lat]);
  const far = map.project([lon + 180, -lat]);
  const originRow = (near.row + far.row) / 2;
  const k = 1 + (elevM / GLYPH_MAP_EARTH_RADIUS_M) * EXAGGERATION;
  return originRow + k * (near.row - originRow);
}

/** The row/col glyphcss actually STAGED the marker element at — `(cell + 0.5) * cellSize` px. */
function stagedCell(el: HTMLElement): { col: number; row: number } {
  return { col: parseFloat(el.style.left) / CELL_W - 0.5, row: parseFloat(el.style.top) / CELL_H - 0.5 };
}

const marker = (host: HTMLElement, selector = ".glyph-map-symbol") => host.querySelector<HTMLElement>(selector)!;

/**
 * A settled frame. This used to poll for a frame that repeated three times in
 * a row, up to 4 s — a stability heuristic, which is the same wall-clock
 * guess a fixed sleep is: two identical frames mid-sweep read as settled, and
 * a slow runner spends the budget re-rendering. `map.idle()` is the widget's
 * own account of being done; the `rerender()` after it is kept because these
 * tests read staged marker ELEMENTS, which are positioned by a commit.
 */
async function settleFrames(map: { idle(): Promise<void>; scene: { rerender(): void } }): Promise<void> {
  await map.idle();
  map.scene.rerender();
}

describe("createGlyphMap — a marker is anchored on the ground under it", () => {
  it("puts a peak's label on the terrain's own row, not the datum's", async () => {
    const { map, host } = mount();
    map.addLayer({ type: "raster", id: "terrain", source: terrainProvider(FINE_M) });
    map.addLayer({ type: "symbol", id: "peaks", source: { features: [peakFeature] }, color: "#fbbf24", textProperty: "name" });
    await settleFrames(map);

    const datumRow = map.project(PEAK).row;
    const groundRow = groundRowFor(map, PEAK[0], PEAK[1], FINE_M);
    // The premise: at this framing the ground is genuinely somewhere else on
    // screen, and still on screen.
    expect(Math.abs(groundRow - datumRow)).toBeGreaterThan(8);
    expect(groundRow).toBeGreaterThan(0);
    expect(groundRow).toBeLessThan(ROWS - 1);

    const cell = stagedCell(marker(host));
    expect(Math.abs(cell.row - groundRow)).toBeLessThanOrEqual(1);
    expect(Math.abs(cell.row - datumRow)).toBeGreaterThan(8);
    // A radial lift under an orthographic camera moves a point along the ROW
    // axis only, so the column is unchanged by the drape.
    expect(Math.abs(cell.col - map.project(PEAK).col)).toBeLessThanOrEqual(1);
  });

  it("reads the terrain SAMPLE, never the feature's own `ele` — the label sits on the drawn summit, not the real one", async () => {
    const { map, host } = mount();
    map.addLayer({ type: "raster", id: "terrain", source: terrainProvider(FINE_M) });
    map.addLayer({ type: "symbol", id: "peaks", source: { features: [peakFeature] }, color: "#fbbf24", text: (f) => `${f.properties?.name} ${f.properties?.ele}` });
    await settleFrames(map);

    // The label really does carry `ele`, so a mechanism that read it had
    // every chance to.
    expect(marker(host).textContent).toContain(String(PEAK_ELE));

    const sampleRow = groundRowFor(map, PEAK[0], PEAK[1], FINE_M);
    const eleRow = groundRowFor(map, PEAK[0], PEAK[1], PEAK_ELE);
    // 4478 m of summit against 3089 m of ETOPO1 under it, at 24x: the two
    // are 9 rows apart here, and both are on screen.
    expect(Math.abs(eleRow - sampleRow)).toBeGreaterThan(6);
    expect(eleRow).toBeGreaterThan(0);

    const cell = stagedCell(marker(host));
    expect(Math.abs(cell.row - sampleRow)).toBeLessThanOrEqual(1);
    expect(Math.abs(cell.row - eleRow)).toBeGreaterThan(6);
  });

  it("coincides with a draped stroke through the same point — the rendered cells the label has to sit on", async () => {
    const { map, host } = mount();
    map.addLayer({ type: "raster", id: "terrain", source: terrainProvider(FINE_M) });
    await settleFrames(map);
    const before = rows(map);

    map.addLayer({ type: "line", id: "ridge", source: { features: [ridgeRoad] }, color: "#e8c988" });
    map.addLayer({ type: "symbol", id: "peaks", source: { features: [peakFeature] }, color: "#fbbf24", textProperty: "name" });
    await settleFrames(map);
    const after = rows(map);

    const inked = inkedCells(before, after);
    expect(inked.length).toBeGreaterThan(20);
    const strokeRows = new Set(inked.map((c) => c.row));
    const cell = stagedCell(marker(host));
    // The label's own row is a row the draped stroke actually inked.
    expect([...strokeRows].some((r) => Math.abs(r - cell.row) <= 1)).toBe(true);
    // ...and the datum's row is not.
    const datumRow = Math.round(map.project(PEAK).row);
    expect([...strokeRows].some((r) => Math.abs(r - datumRow) <= 1)).toBe(false);
  });

  it("drapes a `circle` dot and a label with no elevation property at all", async () => {
    const { map, host } = mount();
    map.addLayer({ type: "raster", id: "terrain", source: terrainProvider(FINE_M) });
    map.addLayer({ type: "symbol", id: "places", source: { features: [placeFeature] }, color: "#ffffff", textProperty: "name" });
    map.addLayer({ type: "circle", id: "pois", source: { features: [placeFeature] }, color: "#f59e0b" });
    await settleFrames(map);

    const groundRow = groundRowFor(map, PEAK[0], PEAK[1], FINE_M);
    const datumRow = map.project(PEAK).row;
    for (const selector of [".glyph-map-symbol", ".glyph-map-circle"]) {
      const cell = stagedCell(marker(host, selector));
      expect(Math.abs(cell.row - groundRow), selector).toBeLessThanOrEqual(1);
      expect(Math.abs(cell.row - datumRow), selector).toBeGreaterThan(8);
    }
  });

  it("moves onto the finer tier's ground when that tier lands, instead of holding the coarse one", async () => {
    const { map, host } = mount();
    // Wide enough that the target LOD is a coarse level, so the first settled
    // render reads the 2,372 m tiers.
    map.setView({ center: [PEAK[0], PEAK[1]], span: 40, cols: COLS, rows: ROWS });
    map.addLayer({ type: "raster", id: "terrain", source: tieredTerrainProvider(COARSE_M, FINE_M) });
    map.addLayer({ type: "symbol", id: "peaks", source: { features: [peakFeature] }, color: "#fbbf24", textProperty: "name" });
    await settleFrames(map);

    // Now zoom to where z4 is the target LOD, and let it land.
    map.setView({ center: [PEAK[0], PEAK[1]], span: SPAN, cols: COLS, rows: ROWS });
    await settleFrames(map);

    const fineRow = groundRowFor(map, PEAK[0], PEAK[1], FINE_M);
    const coarseRow = groundRowFor(map, PEAK[0], PEAK[1], COARSE_M);
    // The two tiers are ~5 rows apart here, so "it followed" and "it stuck"
    // are cell-exactly distinguishable.
    expect(Math.abs(fineRow - coarseRow)).toBeGreaterThan(3);

    const cell = stagedCell(marker(host));
    expect(Math.abs(cell.row - fineRow)).toBeLessThanOrEqual(1);
    expect(Math.abs(cell.row - coarseRow)).toBeGreaterThan(3);
  });

  it("is byte-identical to the pre-drape render when no raster layer is mounted", async () => {
    const { map, host } = mount();
    map.addLayer({ type: "line", id: "ridge", source: { features: [ridgeRoad] }, color: "#e8c988" });
    map.addLayer({ type: "symbol", id: "peaks", source: { features: [peakFeature] }, color: "#fbbf24", textProperty: "name" });
    map.addLayer({ type: "circle", id: "pois", source: { features: [placeFeature] }, color: "#f59e0b" });
    await settleFrames(map);

    // Captured from the build BEFORE markers were draped: with no `raster`
    // layer mounted `groundElevationSampler()` is `null`, the ground is the
    // datum for every marker, and not one extra lookup or projection runs.
    expect(marker(host).outerHTML).toBe(GOLDEN_SYMBOL_HTML);
    expect(marker(host, ".glyph-map-circle").outerHTML).toBe(GOLDEN_CIRCLE_HTML);
    const frame = map.scene.output.textContent ?? "";
    let hash = 5381;
    for (let i = 0; i < frame.length; i++) hash = ((hash * 33) ^ frame.charCodeAt(i)) >>> 0;
    expect({ hash, length: frame.length }).toEqual(GOLDEN_FRAME);
  });
});

const GOLDEN_SYMBOL_HTML = '<div class="glyph-hotspot glyph-map-symbol" data-hotspot-id="glyph-map-layer-point-0" style="position: absolute; opacity: 1; color: #fbbf24; left: 564px; top: 512px; z-index: 0;">Matterhorn</div>';
const GOLDEN_CIRCLE_HTML = '<div class="glyph-hotspot glyph-map-circle" data-hotspot-id="glyph-map-layer-point-1" style="position: absolute; width: 4px; height: 4px; color: #f59e0b; border-radius: 50%; background-color: #f59e0b; left: 564px; top: 512px; z-index: 0;"></div>';
const GOLDEN_FRAME = { hash: 123306501, length: 8882 };
