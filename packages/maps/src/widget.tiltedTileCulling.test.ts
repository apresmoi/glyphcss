/**
 * Regression for a real defect, reported as "the border layer disappears at
 * z > 6" on `/maps`.
 *
 * The two pyramids have different depths — terrain is global z0-z4 plus a
 * curated z5/z6/z7 over a place, borders are global z0-z3 plus a curated z4
 * — and `glyphMapTargetLOD` deliberately keeps the DEEPEST available level
 * when none is fine enough, so past the terrain's z4 the border layer simply
 * stops getting sharper. It must not stop being DRAWN.
 *
 * It did. `isBoundsVisible`'s complement case — "a SMALL, zoomed-in viewport
 * sitting entirely INSIDE a LARGE tile, where none of the tile's sparse
 * samples has to be on-screen for the tile to still cover the visible area"
 * — was answered by testing whether the tile contains `view.center`, on the
 * premise that "the view's own geographic CENTRE always projects to
 * dead-centre of the viewport by construction". That premise is FALSE for an
 * ORBIT projection under a nonzero `tilt`: `tilt` is additional camera pitch
 * on top of `cameraForCenter(lon, lat)`, and `applyDrag` subtracts it back
 * out of `camera.rotX` before calling `centerForCamera`, so `view.center` is
 * exactly `tilt` degrees of latitude away from the point actually at screen
 * centre. `/maps` ships `tilt: 40` by default.
 *
 * Consequences, measured through this harness before the fix (span 3, a
 * 160x64 grid, terrain resolving z7): the border sweep's only desired tile
 * was `4/8_0` — the z4 tile containing `view.center` up at latitude 86.5,
 * 40 degrees off-screen — while `4/8_3`, the tile the viewport actually
 * shows, was dropped because at 22.5x11.25 degrees it is far larger than the
 * 3-degree viewport and none of its own 3x3 samples lands on screen. Border
 * ink: 0.
 *
 * Terrain never showed the symptom because its curated z5/z6/z7 tiles are
 * small enough that their own samples do land on screen — which is exactly
 * why the threshold tracked the RASTER LOD readout the user was reading.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import { glyphMapCuratedProvider } from "./curated";
import { glyphMapCuratedVectorProvider } from "./vector/curated";
import { glyphMapDegreesPerCell, glyphMapTargetLOD, type GlyphMapProvider, type GlyphMapProviderZoomLevel } from "./provider";
import { glyphMapVectorTileBounds } from "./vector/tile";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapVectorProvider, GlyphMapVectorTile } from "./vector/types";

const COLS = 160;
const ROWS = 64;
const CELL_W = 8;
const CELL_H = 16;
const BASE_FONT_PX = 16;

/** `/maps`' own default pitch — the ingredient that makes `view.center` and the screen centre disagree. */
const TILT = 40;
/** Switzerland: real terrain has a curated z5-z7 overlay here, and the Swiss/Italian border crosses it. */
const PLACE = { west: 5.9, east: 10.5, south: 45.8, north: 47.9 };
/** The lon/lat the VIEWPORT CENTRE shows. `view.center` sits `TILT` degrees north of it (see this file's doc). */
const SCREEN_CENTRE: readonly [number, number] = [8.2, 46.5];

const EMPTY_RECT = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
function rect(width: number, height: number): DOMRect {
  return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
}
const stubbedHosts = new Set<HTMLElement>();
/** happy-dom has no layout, so without this the measured cell and the camera's own fallback cell disagree (same reason `widget.renderMode.test.ts` installs one). */
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

const TILE_COLS = 180;
const TILE_ROWS = 90;

function level(z: number): GlyphMapProviderZoomLevel {
  return { z, cols: 2 ** z, rows: 2 ** z, tileLonSpan: 360 / 2 ** z, tileLatSpan: 180 / 2 ** z, tileCols: TILE_COLS, tileRows: TILE_ROWS };
}

function tilesOverlapping(z: number, bounds: typeof PLACE): string[] {
  const n = 2 ** z;
  const lonSpan = 360 / n;
  const latSpan = 180 / n;
  const out: string[] = [];
  for (let y = Math.max(0, Math.floor((90 - bounds.north) / latSpan)); y <= Math.min(n - 1, Math.floor((90 - bounds.south) / latSpan)); y++) {
    for (let x = Math.max(0, Math.floor((bounds.west + 180) / lonSpan)); x <= Math.min(n - 1, Math.floor((bounds.east + 180) / lonSpan)); x++) out.push(`${x}_${y}`);
  }
  return out;
}

/** An alpine ridge along lat 46.5 — real relief, so the stroke's depth test has something to be tested against. */
function elevAt(lon: number, lat: number): number {
  if (lat < 43 || lat > 50 || lon < 3 || lon > 13) return 150;
  return 150 + 3800 * Math.exp(-((lat - 46.5) ** 2) / 0.4);
}

function bakeTile(z: number, x: number, y: number): GlyphMapGeoTile {
  const b = glyphMapVectorTileBounds(z, x, y);
  const elevation = new Float32Array((TILE_COLS + 1) * (TILE_ROWS + 1));
  for (let r = 0; r <= TILE_ROWS; r++) {
    for (let c = 0; c <= TILE_COLS; c++) {
      elevation[r * (TILE_COLS + 1) + c] = elevAt(b.west + ((b.east - b.west) * c) / TILE_COLS, b.north - ((b.north - b.south) * r) / TILE_ROWS);
    }
  }
  return { bounds: b, cols: TILE_COLS, rows: TILE_ROWS, elevation, source: "tilt-culling-test", sampler: "mean" };
}

/** Terrain: global z0-z4 plus a curated z5/z6/z7 overlay over `PLACE` — `bake-geo-tiles.mjs`'s real shape. */
function makeRasterProvider(): GlyphMapProvider {
  const base: GlyphMapProvider = {
    id: "tilt-culling-raster",
    zooms: [0, 1, 2, 3, 4].map(level),
    bounds: (z, x, y) => glyphMapVectorTileBounds(z, x, y),
    async loadTile(z, x, y) { return bakeTile(z, x, y); },
  };
  return glyphMapCuratedProvider(base, [5, 6, 7].map((z) => ({
    zoom: level(z),
    tiles: new Set(tilesOverlapping(z, PLACE)),
    async loadTile(x: number, y: number) { return bakeTile(z, x, y); },
  })));
}

/** A dense border polyline running west-east straight through the viewport centre. */
function borderRing(): [number, number][] {
  const ring: [number, number][] = [];
  for (let lon = 5.0; lon <= 11.5; lon += 0.02) ring.push([lon, SCREEN_CENTRE[1] + 0.12 * Math.sin(lon * 3)]);
  return ring;
}

/** Borders: global z0-z3 plus a curated z4 over `PLACE` — `bake-vector-tiles.mjs`'s real shape, one level shallower than terrain's. */
function makeVectorProvider(): { provider: GlyphMapVectorProvider; requested: string[] } {
  const ring = borderRing();
  const requested: string[] = [];
  const tileAt = (z: number, x: number, y: number, simplify: string): GlyphMapVectorTile => {
    const b = glyphMapVectorTileBounds(z, x, y);
    const inside = ring.filter(([lon, lat]) => lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north);
    return { z, x, y, bounds: b, layers: { admin0: inside.length > 1 ? [{ id: "border", rings: [inside] }] : [] }, source: "tilt-culling-test", simplify };
  };
  const base: GlyphMapVectorProvider = {
    id: "tilt-culling-vector",
    zooms: [0, 1, 2, 3].map(level),
    bounds: (z, x, y) => glyphMapVectorTileBounds(z, x, y),
    async loadTile(z, x, y) { return tileAt(z, x, y, `vw-z${z}`); },
  };
  const curatedTiles = new Map<string, GlyphMapVectorTile>();
  for (const key of tilesOverlapping(4, PLACE)) {
    const [x, y] = key.split("_").map(Number);
    curatedTiles.set(key, tileAt(4, x, y, "curated-z4"));
  }
  const wrapped = glyphMapCuratedVectorProvider(base, { zoom: level(4), tiles: curatedTiles });
  return {
    provider: { ...wrapped, loadTile(z, x, y) { requested.push(`${z}/${x}_${y}`); return wrapped.loadTile(z, x, y); } },
    requested,
  };
}

/** The z4 tile the VIEWPORT actually shows (not the one `view.center` sits in). */
function screenCentreVectorTileKey(): string {
  const lvl = level(4);
  return `4/${Math.floor((SCREEN_CENTRE[0] + 180) / lvl.tileLonSpan)}_${Math.floor((90 - SCREEN_CENTRE[1]) / lvl.tileLatSpan)}`;
}

interface InkReport {
  readonly count: number;
  readonly rows: readonly number[];
}

function inkReport(before: string, after: string): InkReport {
  const a = before.split("\n");
  const b = after.split("\n");
  let count = 0;
  const rows = new Set<number>();
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if ((a[row]?.[col] ?? " ") !== (b[row]?.[col] ?? " ")) { count++; rows.add(row); }
    }
  }
  return { count, rows: [...rows].sort((p, q) => p - q) };
}

afterEach(() => {
  document.body.innerHTML = "";
  stubbedHosts.clear();
  vi.restoreAllMocks();
});

/**
 * `view.center` is `TILT` degrees NORTH of `SCREEN_CENTRE` because
 * `cameraForCenter(lon, lat)` gives `rotX = 90 - lat` and `tilt` is added on
 * top, putting the sub-observer point at `lat - tilt`. This is the state a
 * user reaches by dragging the globe to `SCREEN_CENTRE` with the page's
 * default pitch; the test asserts it rather than assuming it.
 */
async function mountAtSpan(span: number): Promise<{
  map: ReturnType<typeof createGlyphMap>;
  host: HTMLElement;
  rasterLod: number;
  vectorLod: number;
  ink: InkReport;
  vectorRequested: readonly string[];
}> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const raster = makeRasterProvider();
  const vector = makeVectorProvider();
  const map = createGlyphMap(host, {
    view: { center: [SCREEN_CENTRE[0], SCREEN_CENTRE[1] + TILT], span, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ exaggeration: 24 }),
    tilt: TILT,
  });
  map.addLayer({ type: "raster", id: "terrain", source: raster });
  await vi.waitFor(() => expect(map.scene.output.textContent ?? "").not.toBe(""), { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 300));
  map.scene.rerender();
  const before = map.scene.output.textContent ?? "";

  const degPerCell = glyphMapDegreesPerCell(map.getView());
  map.addLayer({ type: "line", id: "borders", source: vector.provider, color: "#ff0000" });
  await new Promise((r) => setTimeout(r, 400));
  map.scene.rerender();
  const after = map.scene.output.textContent ?? "";

  return {
    map, host,
    rasterLod: glyphMapTargetLOD(raster, degPerCell),
    vectorLod: glyphMapTargetLOD(vector.provider, degPerCell),
    ink: inkReport(before, after),
    vectorRequested: vector.requested,
  };
}

describe("createGlyphMap — a tilted orbit view keeps drawing borders past the vector pyramid's own max zoom", () => {
  // span -> the terrain LOD it resolves (the readout the bug was reported
  // against). The vector pyramid stops at its curated z4 for all of them.
  for (const [span, expectedRasterLod] of [[12, 5], [6, 6], [3, 7], [1.5, 7]] as const) {
    it(`inks the border at span ${span} (terrain z${expectedRasterLod}, borders pinned at their own z4)`, async () => {
      const { map, host, rasterLod, vectorLod, ink, vectorRequested } = await mountAtSpan(span);

      // The premise: the viewport really is showing SCREEN_CENTRE, and
      // `view.center` really is off-screen — otherwise this test would pass
      // for the wrong reason.
      const centre = map.unproject([COLS / 2, ROWS / 2]);
      expect(centre).not.toBeNull();
      expect(centre![0]).toBeCloseTo(SCREEN_CENTRE[0], 1);
      expect(centre![1]).toBeCloseTo(SCREEN_CENTRE[1], 1);
      expect(map.project(map.getView().center).visible).toBe(false);

      expect(rasterLod).toBe(expectedRasterLod);
      expect(vectorLod).toBe(4);

      // The tile the viewport shows is the one that gets fetched — the
      // mechanism, not just the symptom.
      expect(vectorRequested).toContain(screenCentreVectorTileKey());

      // Ink, and ink in the RIGHT PLACE. A far-side point shares its
      // near-side twin's COLUMN (`sin(180 - L) === sin(L)`), so the row band
      // is the load-bearing assertion: the border runs through
      // SCREEN_CENTRE's own latitude, which is the middle of the viewport.
      expect(ink.count).toBeGreaterThan(20);
      const middle = ink.rows.filter((r) => Math.abs(r - ROWS / 2) <= ROWS / 8);
      expect(middle.length).toBeGreaterThan(0);

      map.destroy();
      host.remove();
    });
  }
});
